import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { comercios, cuentas, movimientos, recurrentes } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { sumarDias } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import { listarCategorias, type Categoria } from "./catalogos";
import type { Contexto } from "./contexto";

/** Algo que el usuario paga o recibe siempre por lo mismo: Netflix, la renta, la quincena. */
export type Habito = {
  nombre: string;
  tipo: "gasto" | "ingreso";
  montoCentavos: number;
  moneda: string;
  /** Para registrarlo: Netflix es un comercio; "Quincena" o "Renta" son una descripción. */
  comercio?: string;
  descripcion?: string;
  categoriaId: string | null;
  cuentaId: string | null;
  /**
   * Un pago fijo que el usuario dio de alta, o el mismo monto varias veces seguidas: se anota sin
   * preguntar. Si no, solo se pagó una vez y el monto se propone ("¿fue de 3,500, como la vez pasada?").
   */
  seguro: boolean;
};

// Categorías donde el monto suele repetirse: con dos veces iguales seguidas ya es costumbre.
// En las demás (café, Uber, Oxxo) hacen falta tres, y una sola vez no dice nada.
const CATEGORIAS_FIJAS = new Set(
  ["Sueldo", "Rentas cobradas", "Renta", "Internet y teléfono", "Streaming", "Música", "Software", "Otras suscripciones", "Suscripciones", "Gimnasio", "Seguro", "Educación"].map(
    normalizar,
  ),
);
// Pagos fijos que no son un comercio: se anotan como descripción ("Quincena"), no como tienda.
const SIN_COMERCIO = /^(la |el |mi )?(quincena|nomina|salario|sueldo|renta|luz|agua|gas|internet|telefono|celular|colegiatura|mantenimiento|predial|tenencia|seguro)$/;
// Palabras que nombran un pago fijo por su categoría, sin decir a quién: la categoría (normalizada) a la que apuntan.
const GENERICAS: Record<string, string> = {
  quincena: "sueldo",
  nomina: "sueldo",
  salario: "sueldo",
  casero: "renta",
  gym: "gimnasio",
  internet: "internet y telefono",
  telefono: "internet y telefono",
  celular: "internet y telefono",
  colegiatura: "educacion",
};
const DIAS_HISTORIAL = 180;
const MAX_HISTORIAL = 500;

const esFija = (cats: Categoria[], categoriaId: string | null) => {
  const cat = categoriaId ? cats.find((c) => c.id === categoriaId) : undefined;
  return !!cat && CATEGORIAS_FIJAS.has(normalizar(cat.nombre));
};

/** Los hábitos del usuario: sus pagos fijos y lo que el historial muestra que repite. */
export function habitos(ctx: Contexto, cats = listarCategorias(ctx.db, ctx.usuarioId)): Habito[] {
  const filas = ctx.db
    .select()
    .from(movimientos)
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        isNull(movimientos.eliminadoEn),
        inArray(movimientos.tipo, ["gasto", "ingreso"]),
        gte(movimientos.fecha, sumarDias(ctx.hoy, -DIAS_HISTORIAL)),
      ),
    )
    .orderBy(desc(movimientos.ocurridoEn), desc(movimientos.creadoEn))
    .limit(MAX_HISTORIAL)
    .all();
  // Del más reciente al más antiguo, por comercio; sin comercio, por categoría fija ("la quincena").
  const grupos = new Map<string, typeof filas>();
  for (const m of filas) {
    const clave = m.comercioId ? `c${m.comercioId}` : esFija(cats, m.categoriaId) ? `k${m.categoriaId}` : undefined;
    if (clave) grupos.set(clave, [...(grupos.get(clave) ?? []), m]);
  }
  const nombresComercio = new Map(
    ctx.db
      .select({ id: comercios.id, nombre: comercios.nombre })
      .from(comercios)
      .where(eq(comercios.usuarioId, ctx.usuarioId))
      .all()
      .map((c) => [c.id, c.nombre]),
  );
  /** El último cobro de cada comercio, para saber si un pago fijo ya cambió de precio. */
  const ultimoDelComercio = new Map<string, (typeof filas)[number]>();

  const historial: Habito[] = [];
  for (const [clave, grupo] of grupos) {
    const ultimo = grupo[0]!;
    const comercio = clave.startsWith("c") ? nombresComercio.get(ultimo.comercioId!) : undefined;
    if (comercio) ultimoDelComercio.set(normalizar(comercio), ultimo);
    const fija = esFija(cats, ultimo.categoriaId);
    const distinto = grupo.findIndex(
      (m) => m.montoCentavos !== ultimo.montoCentavos || m.moneda !== ultimo.moneda || m.tipo !== ultimo.tipo,
    );
    const seguidas = distinto === -1 ? grupo.length : distinto;
    if (!fija && seguidas < 3) continue;
    const nombre = comercio ?? cats.find((c) => c.id === ultimo.categoriaId)?.nombre;
    if (!nombre) continue;
    historial.push({
      nombre,
      tipo: ultimo.tipo as Habito["tipo"],
      montoCentavos: ultimo.montoCentavos,
      moneda: ultimo.moneda,
      comercio,
      descripcion: comercio ? undefined : nombre,
      categoriaId: ultimo.categoriaId,
      cuentaId: null,
      seguro: seguidas >= (fija ? 2 : 3),
    });
  }

  const fijos: Habito[] = ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn)))
    .all()
    .map((r) => {
      const tipo = r.tipo === "ingreso" ? "ingreso" : "gasto";
      // "Quincena" o "Renta" nombran qué es; "Netflix" es a quién se le paga.
      const nombre = normalizar(r.nombre);
      const esCategoria = SIN_COMERCIO.test(nombre) || cats.some((c) => normalizar(c.nombre) === nombre);
      // Si después de darlo de alta se cobró otro monto (subió de precio), ese se propone en vez de anotarse.
      const ultimo = ultimoDelComercio.get(normalizar(r.nombre));
      const cambio =
        !!ultimo && ultimo.creadoEn > r.creadoEn && (ultimo.montoCentavos !== r.montoCentavos || ultimo.moneda !== r.moneda);
      return {
        nombre: r.nombre,
        tipo,
        montoCentavos: cambio ? ultimo.montoCentavos : r.montoCentavos,
        moneda: cambio ? ultimo.moneda : r.moneda,
        comercio: esCategoria ? undefined : r.nombre,
        descripcion: esCategoria ? r.nombre : undefined,
        categoriaId: r.categoriaId,
        cuentaId: r.cuentaId,
        seguro: !cambio,
      };
    });
  return [...fijos, ...historial];
}

/**
 * Los hábitos que nombra la frase ("ya pagué Netflix", "me cayó la quincena"). Si alguno se nombra
 * por su nombre, solo cuentan esos; si no, los de la categoría que se menciona ("la nómina" es Sueldo).
 * Un pago fijo que el usuario dio de alta gana sobre lo que dice el historial del mismo nombre.
 */
export function habitosMencionados(ctx: Contexto, texto: string, tipo?: Habito["tipo"]): Habito[] {
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const todos = habitos(ctx, cats).filter((h) => !tipo || h.tipo === tipo);
  const plano = ` ${normalizar(texto)} `;
  const porNombre = todos.filter((h) => {
    const nombre = normalizar(h.nombre);
    return nombre.length > 2 && plano.includes(` ${nombre} `);
  });
  let elegidos = porNombre;
  if (!elegidos.length) {
    // Por categoría solo con palabras genéricas ("la nómina", "la renta"): "Netflix" es sinónimo de
    // Streaming, pero no es el Disney Plus que también va ahí.
    const dichas = new Set(
      cats
        .filter((c) => {
          const nombre = normalizar(c.nombre);
          return plano.includes(` ${nombre} `) || Object.entries(GENERICAS).some(([palabra, cat]) => cat === nombre && plano.includes(` ${palabra} `));
        })
        .map((c) => c.id),
    );
    elegidos = todos.filter((h) => h.categoriaId && dichas.has(h.categoriaId) && esFija(cats, h.categoriaId));
  }
  const unicos = new Map<string, Habito>();
  for (const h of elegidos) {
    const clave = normalizar(h.nombre);
    const previo = unicos.get(clave);
    if (!previo || (h.seguro && !previo.seguro)) unicos.set(clave, h);
  }
  return [...unicos.values()];
}

// "La mitad de la renta", "dos meses de Netflix", "una parte": no es el monto de siempre aunque no diga cuánto.
const OTRO_MONTO = /\b(mitad|medio|media|doble|triple|parte|partes|meses|semanas|quincenas|anos|veces|cada uno|cada una|entre|resto|abono|adelanto|anticipo)\b/;

/** Si la frase dice algo que cambia el monto sin decir cuánto ("la mitad", "dos meses"). */
export function hablaDeOtroMonto(texto: string): boolean {
  return OTRO_MONTO.test(normalizar(texto));
}

/** El hábito que nombra la frase, si es uno solo. */
export function habitoMencionado(ctx: Contexto, texto: string, tipo?: Habito["tipo"]): Habito | undefined {
  const lista = habitosMencionados(ctx, texto, tipo);
  return lista.length === 1 ? lista[0] : undefined;
}

/** Para las instrucciones de la IA: "Netflix: gasto de $219". Solo los que se anotan sin preguntar. */
export function montosDeSiempre(ctx: Contexto, maximo = 8): string[] {
  return habitos(ctx)
    .filter((h) => h.seguro)
    .slice(0, maximo)
    .map((h) => `${h.nombre}: ${h.tipo} de ${formatearMonto(h.montoCentavos, h.moneda)}`);
}

export function nombreDeCuenta(ctx: Contexto, cuentaId: string | null): string | undefined {
  if (!cuentaId) return undefined;
  return ctx.db
    .select({ nombre: cuentas.nombre })
    .from(cuentas)
    .where(and(eq(cuentas.id, cuentaId), eq(cuentas.usuarioId, ctx.usuarioId)))
    .get()?.nombre;
}

/**
 * Con qué paga siempre en ese comercio: si las últimas veces que dijo con qué pagó (al menos dos,
 * hasta tres) fue con la misma cuenta. Así "Uber 120" queda con la Nu si los Uber anteriores fueron con la Nu.
 * Solo cuentan las veces en que el usuario la eligió (en la app, al dictar o al corregir), no las que se
 * pusieron solas; y no las cuentas archivadas.
 */
export function cuentaHabitual(ctx: Contexto, comercio: string | undefined): string | undefined {
  if (!comercio?.trim()) return undefined;
  const fila = ctx.db
    .select({ id: comercios.id })
    .from(comercios)
    .where(and(eq(comercios.usuarioId, ctx.usuarioId), eq(comercios.nombreNormalizado, normalizar(comercio))))
    .get();
  if (!fila) return undefined;
  const recientes = ctx.db
    .select({
      cuentaId: movimientos.cuentaId,
      origen: movimientos.origen,
      textoOriginal: movimientos.textoOriginal,
      actualizadoEn: movimientos.actualizadoEn,
      nombre: cuentas.nombre,
      alias: cuentas.alias,
    })
    .from(movimientos)
    .innerJoin(cuentas, eq(cuentas.id, movimientos.cuentaId))
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        eq(movimientos.comercioId, fila.id),
        isNull(movimientos.eliminadoEn),
        isNotNull(movimientos.cuentaId),
        eq(cuentas.archivada, false),
      ),
    )
    .orderBy(desc(movimientos.ocurridoEn), desc(movimientos.creadoEn))
    .limit(10)
    .all();
  const elegidas = recientes
    .filter((m) => {
      if (m.origen !== "voz" || m.actualizadoEn || !m.textoOriginal) return true;
      const dicho = ` ${normalizar(m.textoOriginal)} `;
      return [m.nombre, ...m.alias].some((n) => normalizar(n).length > 0 && dicho.includes(` ${normalizar(n)} `));
    })
    .slice(0, 3);
  if (elegidas.length < 2 || new Set(elegidas.map((u) => u.cuentaId)).size !== 1) return undefined;
  return elegidas[0]!.nombre;
}
