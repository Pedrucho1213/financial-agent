import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { bitacora, comercios, cuentas, entradas, movimientos, recurrentes, TIPOS_MOVIMIENTO } from "../db/schema";
import { aCentavos, formatearMonto } from "../lib/dinero";
import { mediodiaUtc, resolverFecha, resolverPeriodo } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import {
  categoriaPorDefecto,
  encontrarCategoria,
  encontrarOCrearComercio,
  encontrarOCrearCuenta,
  fraseRespalda,
  hojasMencionadas,
  idsConHijas,
  inferirSubcategoria,
  listarCategorias,
  nombreCompleto,
  type Categoria,
} from "./catalogos";
import type { Contexto } from "./contexto";

export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];
export type Movimiento = typeof movimientos.$inferSelect;

export class ErrorFinanzas extends Error {}

export type DatosMovimiento = {
  tipo: TipoMovimiento;
  monto: number;
  moneda?: string;
  categoria?: string;
  comercio?: string;
  descripcion?: string;
  cuenta?: string;
  fecha?: string;
  /** La app elige la categoría de una lista; la IA la nombra con texto (`categoria`). null la quita. */
  categoriaId?: string | null;
  origen?: Movimiento["origen"];
};

/** La categoría elegida en la app, si es del usuario y del tipo correcto. */
function categoriaElegida(cats: Categoria[], tipo: TipoMovimiento, categoriaId: string) {
  const cat = cats.find((c) => c.id === categoriaId);
  if (!cat) throw new ErrorFinanzas("Esa categoría no existe.");
  const tipoCat = tipo === "ingreso" ? "ingreso" : "gasto";
  if (cat.tipo !== tipoCat) throw new ErrorFinanzas(`"${cat.nombre}" es una categoría de ${cat.tipo}.`);
  return cat;
}

/** Cómo se le muestra un movimiento a la IA y a la app. */
export function describir(ctx: Contexto, m: Movimiento, cats = listarCategorias(ctx.db, ctx.usuarioId)) {
  const comercio = m.comercioId
    ? ctx.db.select().from(comercios).where(eq(comercios.id, m.comercioId)).get()?.nombre
    : undefined;
  const cuenta = m.cuentaId
    ? ctx.db.select().from(cuentas).where(eq(cuentas.id, m.cuentaId)).get()?.nombre
    : undefined;
  return {
    id: m.id,
    fecha: m.fecha,
    tipo: m.tipo,
    monto: formatearMonto(m.montoCentavos, m.moneda),
    categoria: nombreCompleto(cats, m.categoriaId) ?? undefined,
    comercio,
    descripcion: m.descripcion ?? undefined,
    cuenta,
    lugar: m.lugar ?? undefined,
  };
}

function elegirCategoria(
  cats: Categoria[],
  tipo: TipoMovimiento,
  categoria: string | undefined,
  categoriaDelComercio: string | null | undefined,
  pistas: (string | null | undefined)[],
) {
  if (tipo === "transferencia" || tipo === "pago_tarjeta") return { id: null, revisar: false };
  const tipoCat = tipo === "ingreso" ? "ingreso" : "gasto";
  // Lo aprendido de tus correcciones manda sobre la suposición del modelo, salvo que la frase nombre
  // otra categoría: en el Oxxo compras café, pero "recarga de celular en el Oxxo" es teléfono.
  const aprendida = categoriaDelComercio ? cats.find((c) => c.id === categoriaDelComercio) : undefined;
  if (aprendida && aprendida.tipo === tipoCat) {
    const dichas = hojasMencionadas(cats, pistas.at(-1), tipoCat);
    if (!(dichas.length === 1 && dichas[0]!.id !== aprendida.id)) return { id: aprendida.id, revisar: false };
  }
  // Una categoría de ingreso en un gasto (o al revés) no sirve.
  const nombrada = encontrarCategoria(cats, categoria, tipoCat);
  const encontrada = nombrada?.tipo === tipoCat ? nombrada : undefined;
  const porDefecto = categoriaPorDefecto(cats, tipoCat);
  // Los modelos chicos suelen quedarse en la categoría general ("Transporte"); las palabras
  // de la frase dicen cuál hija es ("Uber" es Taxi y apps).
  const esPadre = !!encontrada && cats.some((c) => c.padreId === encontrada.id);
  if (!encontrada || esPadre || encontrada.id === porDefecto?.id) {
    const hija = inferirSubcategoria(cats, pistas, tipoCat, esPadre ? encontrada : undefined);
    if (hija) return { id: hija.id, revisar: false };
  }
  if (encontrada) {
    // El modelo eligió una hija que la frase no menciona ("gasolina" para "pagué el gas"), pero
    // la frase nombra otra sin ambigüedad: manda la frase.
    const frase = pistas.at(-1);
    const dichas = hojasMencionadas(cats, frase, tipoCat);
    const apoyada = [pistas[0], frase].some((p) => fraseRespalda(cats, encontrada, p));
    if (!esPadre && !apoyada && dichas.length === 1) return { id: dichas[0]!.id, revisar: false };
    return { id: encontrada.id, revisar: false };
  }
  return { id: porDefecto?.id ?? null, revisar: true };
}

export function registrarEnBitacora(
  ctx: Contexto,
  tabla: "movimientos" | "recurrentes",
  registroId: string,
  accion: "crear" | "editar" | "eliminar",
  antes?: Record<string, unknown>,
  despues?: Record<string, unknown>,
) {
  ctx.db
    .insert(bitacora)
    .values({ usuarioId: ctx.usuarioId, entradaId: ctx.entradaId, tabla, registroId, accion, antes, despues })
    .run();
}

/** Un monto que, redondeado a centavos, no queda en cero. */
function validarMonto(monto: number) {
  if (!(monto > 0)) throw new ErrorFinanzas("El monto debe ser mayor a cero.");
  if (aCentavos(monto) < 1) throw new ErrorFinanzas("El monto debe ser de al menos un centavo.");
}

export function crearMovimiento(ctx: Contexto, datos: DatosMovimiento) {
  validarMonto(datos.monto);
  const fechaResuelta = resolverFecha(datos.fecha, ctx.hoy);
  const fecha = fechaResuelta ?? ctx.hoy;
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const comercio = encontrarOCrearComercio(ctx.db, ctx.usuarioId, datos.comercio);
  const categoria = datos.categoriaId
    ? { id: categoriaElegida(cats, datos.tipo, datos.categoriaId).id, revisar: false }
    : elegirCategoria(cats, datos.tipo, datos.categoria, comercio?.categoriaId, [
        datos.comercio,
        datos.descripcion,
        ctx.textoOriginal,
      ]);
  // El comercio solo aprende de tus correcciones (editarMovimiento): Oxxo, Walmart o Amazon venden
  // de todo y la primera compra no dice a qué categoría van las demás.
  const cuenta = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, datos.cuenta);

  const fila = ctx.db
    .insert(movimientos)
    .values({
      usuarioId: ctx.usuarioId,
      tipo: datos.tipo,
      montoCentavos: aCentavos(datos.monto),
      moneda: datos.moneda?.toUpperCase() || ctx.monedaBase,
      categoriaId: categoria.id,
      comercioId: comercio?.id,
      cuentaId: cuenta?.id,
      descripcion: datos.descripcion?.trim() || null,
      fecha,
      ocurridoEn: fecha === ctx.hoy ? ctx.ahoraIso : mediodiaUtc(fecha, ctx.zonaHoraria),
      lat: ctx.ubicacion?.lat,
      lon: ctx.ubicacion?.lon,
      lugar: ctx.ubicacion?.lugar,
      origen: datos.origen,
      textoOriginal: ctx.textoOriginal,
      entradaId: ctx.entradaId,
      // Una fecha que no entendimos o que aún no llega ("20 de octubre" dicho el 6) se marca para revisar.
      revisar: categoria.revisar || fechaResuelta === null || fecha > ctx.hoy,
    })
    .returning()
    .get();
  registrarEnBitacora(ctx, "movimientos", fila.id, "crear", undefined, fila);
  return { ...describir(ctx, fila, cats), revisar: fila.revisar || undefined };
}

export function obtenerPropio(ctx: Contexto, id: string): Movimiento {
  const fila = ctx.db
    .select()
    .from(movimientos)
    .where(and(eq(movimientos.id, id), eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn)))
    .get();
  if (!fila) throw new ErrorFinanzas(`No encontré el movimiento ${id}. Búscalo primero con buscar_movimientos.`);
  return fila;
}

export type FiltroMovimientos = {
  texto?: string;
  categoria?: string;
  periodo?: string;
  tipo?: TipoMovimiento;
  monto?: number;
  limite?: number;
};

// Palabras que no ayudan a encontrar un movimiento: "el Uber de ayer" busca solo "uber".
const PALABRAS_VACIAS = new Set(
  "de del la el los las lo un una en con y que mi mis por para al hoy ayer antier anteayer gasto gastos pago compra".split(" "),
);

function filtrar(ctx: Contexto, filtro: FiltroMovimientos, cats: Categoria[]) {
  const periodo = filtro.periodo ? resolverPeriodo(filtro.periodo, ctx.hoy) : null;
  if (filtro.periodo && !periodo) throw new ErrorFinanzas(`No entendí el periodo "${filtro.periodo}".`);
  const condiciones = [eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn)];
  if (periodo) condiciones.push(gte(movimientos.fecha, periodo.desde), lte(movimientos.fecha, periodo.hasta));
  if (filtro.tipo) condiciones.push(eq(movimientos.tipo, filtro.tipo));
  if (filtro.monto !== undefined) condiciones.push(eq(movimientos.montoCentavos, aCentavos(filtro.monto)));
  let filas = ctx.db
    .select()
    .from(movimientos)
    .where(and(...condiciones))
    .orderBy(desc(movimientos.ocurridoEn), desc(movimientos.creadoEn))
    .all();

  if (filtro.categoria) {
    const cat = encontrarCategoria(cats, filtro.categoria, filtro.tipo === "ingreso" ? "ingreso" : "gasto");
    if (!cat) throw new ErrorFinanzas(`No existe la categoría "${filtro.categoria}".`);
    const ids = new Set(idsConHijas(cats, cat.id));
    filas = filas.filter((m) => m.categoriaId && ids.has(m.categoriaId));
  }
  const palabras = normalizar(filtro.texto ?? "")
    .split(" ")
    .filter((p) => p && !PALABRAS_VACIAS.has(p));
  if (palabras.length) {
    const nombresComercio = new Map(
      ctx.db
        .select()
        .from(comercios)
        .where(eq(comercios.usuarioId, ctx.usuarioId))
        .all()
        .map((c) => [c.id, c.nombreNormalizado]),
    );
    filas = filas.filter((m) => {
      const textos = [
        m.comercioId ? nombresComercio.get(m.comercioId) : undefined,
        m.descripcion,
        m.textoOriginal,
        nombreCompleto(cats, m.categoriaId),
      ];
      const plano = normalizar(textos.filter(Boolean).join(" "));
      return palabras.every((p) => plano.includes(p));
    });
  }
  return { filas, periodo };
}

export function buscarMovimientos(ctx: Contexto, filtro: FiltroMovimientos) {
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const { filas } = filtrar(ctx, filtro, cats);
  const limite = Math.min(Math.max(filtro.limite ?? 5, 1), 50);
  return { encontrados: filas.length, movimientos: filas.slice(0, limite).map((m) => describir(ctx, m, cats)) };
}

export type Busqueda = FiltroMovimientos & { mas_reciente?: boolean };

/**
 * Si un dictado se reintenta más tarde, "deshaz eso" y "el último" se refieren a lo que había cuando
 * lo dijiste, no a lo que hicieron los dictados (o la app) que llegaron después.
 */
function vinoDespues(ctx: Contexto): (fila: { entradaId: string | null; creadoEn: string }) => boolean {
  if (!ctx.entradaId) return () => false;
  const propia = ctx.db
    .select({ creadoEn: entradas.creadoEn, orden: sql<number>`rowid` })
    .from(entradas)
    .where(and(eq(entradas.id, ctx.entradaId), eq(entradas.usuarioId, ctx.usuarioId)))
    .get();
  if (!propia) return () => false;
  const posteriores = new Set(
    ctx.db
      .select({ id: entradas.id })
      .from(entradas)
      .where(and(eq(entradas.usuarioId, ctx.usuarioId), sql`rowid > ${propia.orden}`))
      .all()
      .map((e) => e.id),
  );
  return (fila) => (fila.entradaId ? posteriores.has(fila.entradaId) : fila.creadoEn > propia.creadoEn);
}

/** El movimiento a editar o eliminar: por id, o con una búsqueda que deje uno solo. */
export function idDelMovimiento(ctx: Contexto, id?: string, buscar?: Busqueda): string {
  if (id) return id;
  if (!buscar) throw new ErrorFinanzas("Indica el id o qué buscar.");
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const despues = vinoDespues(ctx);
  const filas = filtrar(ctx, buscar, cats).filas.filter((m) => !despues(m));
  if (filas.length === 0) {
    throw new ErrorFinanzas("No encontré ningún movimiento con esos datos. Prueba con menos filtros.");
  }
  if (filas.length === 1 || buscar.mas_reciente) return filas[0]!.id;
  const opciones = filas.slice(0, 5).map((m) => {
    const d = describir(ctx, m, cats);
    return `${d.comercio ?? d.categoria ?? d.tipo} de ${d.monto} del ${d.fecha} (id ${d.id})`;
  });
  throw new ErrorFinanzas(`Coinciden ${filas.length}: ${opciones.join("; ")}. Pregunta cuál o usa su id.`);
}

export function editarMovimiento(ctx: Contexto, id: string, cambios: Partial<DatosMovimiento>) {
  const antes = obtenerPropio(ctx, id);
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const nuevo: Partial<Movimiento> = {};
  const tipo = cambios.tipo ?? antes.tipo;
  if (cambios.tipo) nuevo.tipo = cambios.tipo;
  if (cambios.monto !== undefined) {
    validarMonto(cambios.monto);
    nuevo.montoCentavos = aCentavos(cambios.monto);
  }
  if (cambios.moneda) nuevo.moneda = cambios.moneda.toUpperCase();
  if (cambios.descripcion !== undefined) nuevo.descripcion = cambios.descripcion || null;
  if (cambios.fecha) {
    const fecha = resolverFecha(cambios.fecha, ctx.hoy);
    if (!fecha) throw new ErrorFinanzas(`No entendí la fecha "${cambios.fecha}".`);
    nuevo.fecha = fecha;
    nuevo.ocurridoEn = mediodiaUtc(fecha, ctx.zonaHoraria);
  }
  // Vacío borra el dato (la app lo permite); sin el campo, no se toca.
  if (cambios.comercio !== undefined)
    nuevo.comercioId = cambios.comercio ? encontrarOCrearComercio(ctx.db, ctx.usuarioId, cambios.comercio)?.id : null;
  if (cambios.cuenta !== undefined)
    nuevo.cuentaId = cambios.cuenta ? encontrarOCrearCuenta(ctx.db, ctx.usuarioId, cambios.cuenta)?.id : null;
  if (cambios.categoriaId === null) nuevo.categoriaId = null;
  else if (cambios.categoria || cambios.categoriaId) {
    const cat = cambios.categoriaId
      ? categoriaElegida(cats, tipo, cambios.categoriaId)
      : encontrarCategoria(cats, cambios.categoria, tipo === "ingreso" ? "ingreso" : "gasto");
    if (!cat) throw new ErrorFinanzas(`No existe la categoría "${cambios.categoria}".`);
    nuevo.categoriaId = cat.id;
    nuevo.revisar = false;
    // Aprende: la próxima vez este comercio irá a esta categoría.
    const comercioId = nuevo.comercioId ?? antes.comercioId;
    if (comercioId) ctx.db.update(comercios).set({ categoriaId: cat.id }).where(eq(comercios.id, comercioId)).run();
  }
  // De gasto a ingreso (o al revés) la categoría anterior ya no sirve: se busca una del tipo nuevo
  // en la frase original o queda la general, para revisar.
  if (cambios.tipo && nuevo.categoriaId === undefined) {
    const actual = cats.find((c) => c.id === antes.categoriaId);
    const tipoCat = tipo === "ingreso" ? "ingreso" : "gasto";
    if (tipo === "transferencia" || tipo === "pago_tarjeta") {
      if (antes.categoriaId) nuevo.categoriaId = null;
    } else if (!actual || actual.tipo !== tipoCat) {
      const elegida = elegirCategoria(cats, tipo, undefined, null, [antes.descripcion, antes.textoOriginal]);
      nuevo.categoriaId = elegida.id;
      if (elegida.revisar) nuevo.revisar = true;
    }
  }
  if (nuevo.fecha && nuevo.fecha > ctx.hoy) nuevo.revisar = true;
  if (Object.keys(nuevo).length === 0) throw new ErrorFinanzas("No indicaste qué cambiar.");
  const despues = ctx.db
    .update(movimientos)
    .set({ ...nuevo, actualizadoEn: new Date().toISOString() })
    .where(eq(movimientos.id, id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "movimientos", id, "editar", antes, despues);
  return describir(ctx, despues, cats);
}

export function eliminarMovimiento(ctx: Contexto, id: string) {
  const antes = obtenerPropio(ctx, id);
  const despues = ctx.db
    .update(movimientos)
    .set({ eliminadoEn: new Date().toISOString() })
    .where(eq(movimientos.id, id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "movimientos", id, "eliminar", antes, despues);
  return describir(ctx, antes);
}

export type AgruparPor = "ninguno" | "categoria" | "subcategoria" | "comercio" | "dia";

/** Sumas y conteos calculados por código: la IA nunca suma por su cuenta. */
export function resumir(
  ctx: Contexto,
  opciones: FiltroMovimientos & { agruparPor?: AgruparPor },
) {
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const tipo = opciones.tipo ?? "gasto";
  const { filas, periodo } = filtrar(ctx, { ...opciones, tipo, periodo: opciones.periodo ?? "este_mes" }, cats);
  const enBase = filas.filter((m) => m.moneda === ctx.monedaBase);
  const total = enBase.reduce((s, m) => s + m.montoCentavos, 0);

  const nombreComercio = (id: string | null) =>
    id ? ctx.db.select().from(comercios).where(eq(comercios.id, id)).get()?.nombre : undefined;
  const clave = (m: Movimiento): string => {
    switch (opciones.agruparPor) {
      case "categoria": {
        const c = cats.find((x) => x.id === m.categoriaId);
        const padre = c?.padreId ? cats.find((x) => x.id === c.padreId) : c;
        return padre?.nombre ?? "Sin categoría";
      }
      case "subcategoria":
        return nombreCompleto(cats, m.categoriaId) ?? "Sin categoría";
      case "comercio":
        return nombreComercio(m.comercioId) ?? "Sin comercio";
      case "dia":
        return m.fecha;
      default:
        return "";
    }
  };
  let grupos: { nombre: string; total: string; cantidad: number }[] | undefined;
  if (opciones.agruparPor && opciones.agruparPor !== "ninguno") {
    const acumulado = new Map<string, { centavos: number; cantidad: number }>();
    for (const m of enBase) {
      const k = clave(m);
      const g = acumulado.get(k) ?? { centavos: 0, cantidad: 0 };
      g.centavos += m.montoCentavos;
      g.cantidad += 1;
      acumulado.set(k, g);
    }
    grupos = [...acumulado.entries()]
      .sort((a, b) => b[1].centavos - a[1].centavos)
      .slice(0, 10)
      .map(([nombre, g]) => ({ nombre, total: formatearMonto(g.centavos, ctx.monedaBase), cantidad: g.cantidad }));
  }
  const otrasMonedas = filas
    .filter((m) => m.moneda !== ctx.monedaBase)
    .map((m) => formatearMonto(m.montoCentavos, m.moneda));
  return {
    tipo,
    desde: periodo?.desde,
    hasta: periodo?.hasta,
    total: formatearMonto(total, ctx.monedaBase),
    cantidad: enBase.length,
    grupos,
    otras_monedas: otrasMonedas.length ? otrasMonedas : undefined,
  };
}

type CambioBitacora = typeof bitacora.$inferSelect;

/** `por`: la entrada que pidió deshacer, para poder rehacerlo si esa entrada falla. */
function revertir(ctx: Contexto, grupo: CambioBitacora[], por?: string) {
  const ahora = new Date().toISOString();
  const revertidos: string[] = [];
  ctx.db.transaction((tx) => {
    // El grupo ya viene del más reciente al más antiguo: una edición posterior no pisa a una anterior.
    for (const cambio of grupo) {
      if (cambio.tabla === "movimientos") {
        if (cambio.accion === "crear") {
          tx.update(movimientos).set({ eliminadoEn: ahora }).where(eq(movimientos.id, cambio.registroId)).run();
        } else if (cambio.antes) {
          const { id: _, ...valores } = cambio.antes as Movimiento;
          tx.update(movimientos).set(valores).where(eq(movimientos.id, cambio.registroId)).run();
        }
      } else {
        tx.update(recurrentes)
          .set({ eliminadoEn: cambio.accion === "crear" ? ahora : null })
          .where(eq(recurrentes.id, cambio.registroId))
          .run();
      }
      tx.update(bitacora).set({ deshechoEn: ahora, deshechoPor: por ?? null }).where(eq(bitacora.id, cambio.id)).run();
      revertidos.push(`${cambio.accion} en ${cambio.tabla}`);
    }
  });
  return revertidos;
}

/** Vuelve a aplicar lo que deshizo una entrada, del cambio más antiguo al más reciente. */
function rehacer(ctx: Contexto, grupo: CambioBitacora[]) {
  ctx.db.transaction((tx) => {
    for (const cambio of [...grupo].reverse()) {
      const despues = (cambio.despues ?? {}) as { eliminadoEn?: string | null };
      if (cambio.tabla === "movimientos") {
        if (cambio.accion === "crear") {
          tx.update(movimientos).set({ eliminadoEn: null }).where(eq(movimientos.id, cambio.registroId)).run();
        } else if (cambio.despues) {
          const { id: _, ...valores } = cambio.despues as Movimiento;
          tx.update(movimientos).set(valores).where(eq(movimientos.id, cambio.registroId)).run();
        }
      } else {
        tx.update(recurrentes)
          .set({ eliminadoEn: cambio.accion === "crear" ? null : (despues.eliminadoEn ?? new Date().toISOString()) })
          .where(eq(recurrentes.id, cambio.registroId))
          .run();
      }
      tx.update(bitacora).set({ deshechoEn: null, deshechoPor: null }).where(eq(bitacora.id, cambio.id)).run();
    }
  });
}

function pendientesDeDeshacer(ctx: Contexto) {
  return ctx.db
    .select()
    .from(bitacora)
    .where(and(eq(bitacora.usuarioId, ctx.usuarioId), isNull(bitacora.deshechoEn)))
    .orderBy(desc(bitacora.creadoEn), desc(sql`rowid`))
    .all();
}

/** Revierte todo lo que hizo la entrada anterior (la última cosa que dijiste). */
export function deshacer(ctx: Contexto) {
  const despues = vinoDespues(ctx);
  const pendientes = pendientesDeDeshacer(ctx).filter(
    (b) => !despues(b) && (!ctx.entradaId || b.entradaId !== ctx.entradaId),
  );
  const ultima = pendientes[0];
  if (!ultima) return { deshecho: false, mensaje: "No hay nada que deshacer." };
  const grupo = ultima.entradaId ? pendientes.filter((b) => b.entradaId === ultima.entradaId) : [ultima];
  return { deshecho: true, cambios_revertidos: revertir(ctx, grupo, ctx.entradaId) };
}

/**
 * Revierte lo que alcanzó a hacer una entrada que falló, antes de reintentarla. Si esa entrada
 * había deshecho algo ("deshaz eso"), lo rehace: si no, el reintento desharía otra cosa más.
 */
export function revertirEntrada(ctx: Contexto, entradaId: string) {
  const grupo = pendientesDeDeshacer(ctx).filter((b) => b.entradaId === entradaId);
  const revertidos = grupo.length ? revertir(ctx, grupo) : [];
  const deshechos = ctx.db
    .select()
    .from(bitacora)
    .where(and(eq(bitacora.usuarioId, ctx.usuarioId), eq(bitacora.deshechoPor, entradaId)))
    .orderBy(desc(bitacora.creadoEn), desc(sql`rowid`))
    .all();
  if (deshechos.length) rehacer(ctx, deshechos);
  return revertidos;
}
