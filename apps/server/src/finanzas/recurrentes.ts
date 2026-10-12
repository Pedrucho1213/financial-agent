import { and, eq, isNull, like } from "drizzle-orm";
import { avisos, cuentas, ESTADOS_RECURRENTE, FRECUENCIAS, recurrentes, TIPOS_RECURRENTE } from "../db/schema";
import { aCentavos, formatearMonto } from "../lib/dinero";
import { armarFecha, diaSemana, partes, sumarDias, sumarMeses } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import { encontrarCategoria, encontrarOCrearCuenta, listarCategorias } from "./catalogos";
import type { Contexto } from "./contexto";
import { cambioDeCuenta, ErrorFinanzas, registrarEnBitacora } from "./movimientos";

export type Recurrente = typeof recurrentes.$inferSelect;
export type EstadoRecurrente = (typeof ESTADOS_RECURRENTE)[number];

export type DatosRecurrente = {
  nombre: string;
  tipo: (typeof TIPOS_RECURRENTE)[number];
  monto: number;
  moneda?: string;
  frecuencia: (typeof FRECUENCIAS)[number];
  dia: number;
  mes?: number;
  categoria?: string;
  cuenta?: string;
};

/** Próxima fecha de cobro (o de pago, si es un ingreso) a partir de hoy, hoy incluido. */
export function proximoCobro(r: Pick<Recurrente, "frecuencia" | "dia" | "mes">, hoy: string): string {
  const { anio, mes } = partes(hoy);
  switch (r.frecuencia) {
    case "semanal": {
      const faltan = (r.dia - diaSemana(hoy) + 7) % 7;
      return sumarDias(hoy, faltan);
    }
    case "quincenal": {
      // Dos cobros al mes: el día indicado y quince días después (o fin de mes).
      const candidatos = [0, 1].flatMap((desplazamiento) => {
        const base = sumarMeses(armarFecha(anio, mes, 1), desplazamiento, 1);
        const p = partes(base);
        return [armarFecha(p.anio, p.mes, r.dia), armarFecha(p.anio, p.mes, r.dia + 15)];
      });
      return candidatos.filter((f) => f >= hoy).sort()[0]!;
    }
    case "mensual": {
      const este = armarFecha(anio, mes, r.dia);
      return este >= hoy ? este : sumarMeses(armarFecha(anio, mes, 1), 1, r.dia);
    }
    case "anual": {
      const este = armarFecha(anio, r.mes ?? mes, r.dia);
      return este >= hoy ? este : armarFecha(anio + 1, r.mes ?? mes, r.dia);
    }
  }
}

/** Cuánto pesa al mes, para sumar suscripciones de distinta frecuencia. */
export function montoMensual(r: Pick<Recurrente, "frecuencia" | "montoCentavos">): number {
  switch (r.frecuencia) {
    case "semanal":
      return Math.round((r.montoCentavos * 52) / 12);
    case "quincenal":
      return r.montoCentavos * 2;
    case "mensual":
      return r.montoCentavos;
    case "anual":
      return Math.round(r.montoCentavos / 12);
  }
}

function describir(ctx: Contexto, r: Recurrente) {
  return {
    id: r.id,
    nombre: r.nombre,
    tipo: r.tipo,
    monto: formatearMonto(r.montoCentavos, r.moneda),
    frecuencia: r.frecuencia,
    proximo_cobro: proximoCobro(r, ctx.hoy),
  };
}

function validar(datos: Pick<DatosRecurrente, "monto" | "frecuencia" | "dia">) {
  if (!(datos.monto > 0)) throw new ErrorFinanzas("El monto debe ser mayor a cero.");
  const maximo = datos.frecuencia === "semanal" ? 7 : 31;
  if (!Number.isInteger(datos.dia) || datos.dia < 1 || datos.dia > maximo) {
    throw new ErrorFinanzas(`El día debe estar entre 1 y ${maximo}.`);
  }
}

/** `cuentaId`: la app ya eligió la cuenta (o ninguna, con null); la voz la busca por nombre. */
export function crearRecurrente(ctx: Contexto, datos: DatosRecurrente, cuentaId?: string | null) {
  validar(datos);
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const tipoCat = datos.tipo === "ingreso" ? "ingreso" : "gasto";
  const categoria =
    encontrarCategoria(cats, datos.categoria, tipoCat) ??
    encontrarCategoria(cats, datos.nombre, tipoCat) ??
    (datos.tipo === "suscripcion" ? encontrarCategoria(cats, "Suscripciones", "gasto") : undefined) ??
    (datos.tipo === "renta" ? encontrarCategoria(cats, "Renta", "gasto") : undefined);
  const fila = ctx.db
    .insert(recurrentes)
    .values({
      usuarioId: ctx.usuarioId,
      nombre: datos.nombre.trim(),
      tipo: datos.tipo,
      montoCentavos: aCentavos(datos.monto),
      moneda: datos.moneda?.toUpperCase() || ctx.monedaBase,
      frecuencia: datos.frecuencia,
      dia: datos.dia,
      mes: datos.mes,
      categoriaId: categoria?.id,
      cuentaId:
        cuentaId !== undefined ? cuentaId : encontrarOCrearCuenta(ctx.db, ctx.usuarioId, datos.cuenta, { alCambiar: cambioDeCuenta(ctx) })?.id,
      entradaId: ctx.entradaId,
    })
    .returning()
    .get();
  registrarEnBitacora(ctx, "recurrentes", fila.id, "crear", undefined, fila);
  return describir(ctx, fila);
}

function activos(ctx: Contexto) {
  return ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn)))
    .all();
}

/** Todos los que no se borraron, en cualquier estado. */
function delUsuario(ctx: Contexto) {
  return ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), isNull(recurrentes.eliminadoEn)))
    .all();
}

/** Recurrentes activos ordenados por próximo cobro; con `dias`, solo los que vencen en ese plazo. */
export function listarRecurrentes(ctx: Contexto, opciones: { dias?: number; tipo?: Recurrente["tipo"] } = {}) {
  let filas = activos(ctx);
  if (opciones.tipo) filas = filas.filter((r) => r.tipo === opciones.tipo);
  const gastos = filas.filter((r) => r.tipo !== "ingreso");
  // Los que se cobran en otra moneda no se suman a los pesos: se listan aparte.
  const enBase = gastos.filter((r) => r.moneda === ctx.monedaBase);
  const otras = gastos.filter((r) => r.moneda !== ctx.monedaBase).map((r) => `${r.nombre}: ${formatearMonto(montoMensual(r), r.moneda)}`);
  const limite = opciones.dias !== undefined ? sumarDias(ctx.hoy, opciones.dias) : undefined;
  const lista = filas
    .map((r) => describir(ctx, r))
    .filter((r) => !limite || r.proximo_cobro <= limite)
    .sort((a, b) => a.proximo_cobro.localeCompare(b.proximo_cobro));
  // Las pausadas no se cobran ni suman, pero se dicen si pregunta qué suscripciones tiene.
  const pausadas = delUsuario(ctx)
    .filter((r) => r.estado === "pausada" && (!opciones.tipo || r.tipo === opciones.tipo))
    .map((r) => r.nombre);
  return {
    recurrentes: lista,
    total_mensual_gastos: formatearMonto(enBase.reduce((s, r) => s + montoMensual(r), 0), ctx.monedaBase),
    total_mensual_otras_monedas: otras.length ? otras : undefined,
    pausadas: pausadas.length ? pausadas : undefined,
  };
}

/** El recurrente que el usuario nombra ("Netflix", "la renta"), o un error que dice cuáles hay. */
function encontrarRecurrente(
  ctx: Contexto,
  nombre: string,
  estados: readonly EstadoRecurrente[] = ["activa", "pausada"],
): Recurrente {
  const filas = delUsuario(ctx).filter((r) => estados.includes(r.estado));
  const buscado = normalizar(nombre).replace(/^(el|la|los|las|mi|mis) /, "");
  const exactos = filas.filter((r) => normalizar(r.nombre) === buscado);
  const parecidos = exactos.length ? exactos : filas.filter((r) => normalizar(r.nombre).includes(buscado) || buscado.includes(normalizar(r.nombre)));
  if (parecidos.length === 1) return parecidos[0]!;
  const nombres = filas.map((r) => r.nombre).join(", ") || "ninguno";
  if (parecidos.length === 0) throw new ErrorFinanzas(`No tengo un pago recurrente llamado "${nombre}". Los que hay: ${nombres}.`);
  throw new ErrorFinanzas(`Coinciden ${parecidos.map((r) => r.nombre).join(", ")}. Pregunta cuál.`);
}

export type CambiosRecurrente = Partial<Pick<DatosRecurrente, "nombre" | "monto" | "moneda" | "frecuencia" | "dia" | "mes">>;

function darDeBaja(ctx: Contexto, antes: Recurrente) {
  const despues = ctx.db
    .update(recurrentes)
    .set({ eliminadoEn: new Date().toISOString() })
    .where(eq(recurrentes.id, antes.id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "recurrentes", antes.id, "eliminar", antes, despues);
}

/**
 * Pausar, cancelar o archivar deja de cobrarlo, recordarlo y sumarlo; activar lo regresa. Los avisos
 * de cobro que ya había para él se descartan, para que no llegue una push de algo pausado.
 */
function cambiarEstado(ctx: Contexto, antes: Recurrente, estado: EstadoRecurrente): Recurrente {
  if (antes.estado === estado) return antes;
  const despues = ctx.db
    .update(recurrentes)
    .set({ estado, activo: estado === "activa", estadoEn: new Date().toISOString() })
    .where(eq(recurrentes.id, antes.id))
    .returning()
    .get()!;
  if (estado !== "activa") {
    ctx.db
      .update(avisos)
      .set({ descartadoEn: new Date().toISOString() })
      .where(and(eq(avisos.usuarioId, ctx.usuarioId), like(avisos.clave, `cobro:${antes.id}:%`), isNull(avisos.descartadoEn)))
      .run();
  }
  registrarEnBitacora(ctx, "recurrentes", antes.id, "editar", antes, despues);
  return despues;
}

/** "Cancelé Netflix": deja de contarse y de recordarse, y queda en Canceladas en la app. Se puede deshacer. */
export function cancelarRecurrente(ctx: Contexto, nombre: string) {
  const antes = encontrarRecurrente(ctx, nombre);
  cambiarEstado(ctx, antes, "cancelada");
  return { nombre: antes.nombre, monto: formatearMonto(antes.montoCentavos, antes.moneda), frecuencia: antes.frecuencia };
}

/** "Pausa Spotify" (pausar) o "reactiva Spotify" (reanudar, también una cancelada). */
export function pausarRecurrente(ctx: Contexto, nombre: string, pausar: boolean) {
  const antes = encontrarRecurrente(ctx, nombre, pausar ? ["activa"] : ["pausada", "cancelada"]);
  const despues = cambiarEstado(ctx, antes, pausar ? "pausada" : "activa");
  return pausar
    ? { pausado: antes.nombre }
    : { reanudado: describir(ctx, despues) };
}

/**
 * "Spotify subió a 129": se cancela el anterior y se crea uno con los cambios, así deshacer
 * (que restaura o cancela recurrentes completos) también regresa al monto de antes.
 */
export function editarRecurrente(ctx: Contexto, nombre: string, cambios: CambiosRecurrente) {
  const antes = encontrarRecurrente(ctx, nombre);
  const datos = {
    nombre: cambios.nombre?.trim() || antes.nombre,
    monto: cambios.monto ?? antes.montoCentavos / 100,
    moneda: cambios.moneda?.toUpperCase() || antes.moneda,
    frecuencia: cambios.frecuencia ?? antes.frecuencia,
    dia: cambios.dia ?? antes.dia,
    mes: cambios.mes ?? antes.mes,
  };
  validar(datos);
  if (
    datos.nombre === antes.nombre &&
    aCentavos(datos.monto) === antes.montoCentavos &&
    datos.moneda === antes.moneda &&
    datos.frecuencia === antes.frecuencia &&
    datos.dia === antes.dia &&
    datos.mes === antes.mes
  ) {
    throw new ErrorFinanzas("No indicaste qué cambiar.");
  }
  darDeBaja(ctx, antes);
  const { id: _, creadoEn: __, eliminadoEn: ___, ...resto } = antes;
  const fila = ctx.db
    .insert(recurrentes)
    .values({
      ...resto,
      nombre: datos.nombre,
      montoCentavos: aCentavos(datos.monto),
      moneda: datos.moneda,
      frecuencia: datos.frecuencia,
      dia: datos.dia,
      mes: datos.mes,
      entradaId: ctx.entradaId,
    })
    .returning()
    .get();
  registrarEnBitacora(ctx, "recurrentes", fila.id, "crear", undefined, fila);
  return describir(ctx, fila);
}

const NOMBRES_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/**
 * Cobros que vienen (hoy, mañana, o dentro de los días de aviso de cada uno) de los que todavía no
 * se avisó: "Ojo: mañana se cobra Netflix de $219." `marcar` los da por avisados para no repetirlo.
 * `pagados`: lo que se acaba de registrar ("Netflix", "Renta"); de eso no se avisa y queda como avisado.
 */
export function cobrosPorAvisar(ctx: Contexto, pagados: string[] = []): { aviso?: string; marcar: () => void } | undefined {
  const yaPagado = new Set(pagados.map(normalizar));
  const pendientes = activos(ctx)
    .filter((r) => r.tipo !== "ingreso")
    .map((r) => ({ r, fecha: proximoCobro(r, ctx.hoy) }))
    .filter(({ r, fecha }) => fecha <= sumarDias(ctx.hoy, r.avisarDiasAntes) && r.avisadoPara !== fecha);
  if (pendientes.length === 0) return undefined;
  const recienPagados = pendientes.filter(({ r }) => yaPagado.has(normalizar(r.nombre)));
  const proximos = pendientes
    .filter(({ r }) => !yaPagado.has(normalizar(r.nombre)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 2);
  // Solo lo que se pagó o se dijo: un tercer cobro queda para el siguiente dictado.
  const marcar = () => {
    for (const { r, fecha } of [...recienPagados, ...proximos]) {
      ctx.db.update(recurrentes).set({ avisadoPara: fecha }).where(eq(recurrentes.id, r.id)).run();
      // El aviso del revisor sobre ese mismo cobro ya no hace falta mandarlo por push.
      ctx.db
        .update(avisos)
        .set({ dichoEn: new Date().toISOString() })
        .where(and(eq(avisos.usuarioId, ctx.usuarioId), eq(avisos.clave, `cobro:${r.id}:${fecha}`), isNull(avisos.dichoEn)))
        .run();
    }
  };
  if (proximos.length === 0) return { marcar };
  const cuando = (fecha: string) =>
    fecha === ctx.hoy ? "hoy" : fecha === sumarDias(ctx.hoy, 1) ? "mañana" : `el ${NOMBRES_DIA[diaSemana(fecha)]}`;
  const cobro = ({ r }: (typeof proximos)[number]) => `${r.nombre} de ${formatearMonto(r.montoCentavos, r.moneda)}`;
  const [a, b] = proximos as [(typeof proximos)[number], (typeof proximos)[number] | undefined];
  const aviso = !b
    ? `Ojo: ${cuando(a.fecha)} se cobra ${cobro(a)}.`
    : a.fecha === b.fecha
      ? `Ojo: ${cuando(a.fecha)} se cobran ${cobro(a)} y ${cobro(b)}.`
      : `Ojo: ${cuando(a.fecha)} se cobra ${cobro(a)} y ${cuando(b.fecha)}, ${cobro(b)}.`;
  return { aviso, marcar };
}

// ---------------------------------------------------------------- La app (#suscripciones)

export type RecurrenteApp = {
  id: string;
  nombre: string;
  tipo: Recurrente["tipo"];
  montoCentavos: number;
  moneda: string;
  frecuencia: Recurrente["frecuencia"];
  dia: number;
  mes: number | null;
  categoriaId: string | null;
  categoria: string | null;
  cuentaId: string | null;
  cuenta: string | null;
  estado: EstadoRecurrente;
  estadoEn: string | null;
  /** Solo de las activas. */
  proximoCobro: string | null;
  mensualCentavos: number;
  creadoEn: string;
};

function nombresDe(ctx: Contexto) {
  const cats = new Map(listarCategorias(ctx.db, ctx.usuarioId).map((c) => [c.id, c.nombre]));
  const ctas = new Map(
    ctx.db
      .select({ id: cuentas.id, nombre: cuentas.nombre })
      .from(cuentas)
      .where(eq(cuentas.usuarioId, ctx.usuarioId))
      .all()
      .map((c) => [c.id, c.nombre]),
  );
  return { cats, ctas };
}

function recurrenteApp(ctx: Contexto, r: Recurrente, nombres = nombresDe(ctx)): RecurrenteApp {
  return {
    id: r.id,
    nombre: r.nombre,
    tipo: r.tipo,
    montoCentavos: r.montoCentavos,
    moneda: r.moneda,
    frecuencia: r.frecuencia,
    dia: r.dia,
    mes: r.mes,
    categoriaId: r.categoriaId,
    categoria: (r.categoriaId && nombres.cats.get(r.categoriaId)) || null,
    cuentaId: r.cuentaId,
    cuenta: (r.cuentaId && nombres.ctas.get(r.cuentaId)) || null,
    estado: r.estado,
    estadoEn: r.estadoEn,
    proximoCobro: r.estado === "activa" ? proximoCobro(r, ctx.hoy) : null,
    mensualCentavos: montoMensual(r),
    creadoEn: r.creadoEn,
  };
}

/** Todos los pagos fijos en cualquier estado; las activas primero, por próximo cobro. */
export function recurrentesApp(ctx: Contexto) {
  const nombres = nombresDe(ctx);
  const orden: Record<EstadoRecurrente, number> = { activa: 0, pausada: 1, cancelada: 2, archivada: 3 };
  const lista = delUsuario(ctx)
    .map((r) => recurrenteApp(ctx, r, nombres))
    .sort(
      (a, b) =>
        orden[a.estado] - orden[b.estado] ||
        (a.proximoCobro ?? "").localeCompare(b.proximoCobro ?? "") ||
        (b.estadoEn ?? "").localeCompare(a.estadoEn ?? "") ||
        a.nombre.localeCompare(b.nombre),
    );
  // Lo que se va al mes en la moneda base: solo gastos activos.
  const mensualCentavos = lista
    .filter((r) => r.estado === "activa" && r.tipo !== "ingreso" && r.moneda === ctx.monedaBase)
    .reduce((s, r) => s + r.mensualCentavos, 0);
  return { recurrentes: lista, mensualCentavos, moneda: ctx.monedaBase };
}

function propio(ctx: Contexto, id: string): Recurrente {
  const r = ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.id, id), eq(recurrentes.usuarioId, ctx.usuarioId), isNull(recurrentes.eliminadoEn)))
    .get();
  if (!r) throw new ErrorFinanzas("Ese pago fijo no existe.");
  return r;
}

function cuentaPropia(ctx: Contexto, id: string | null | undefined): string | null | undefined {
  if (!id) return id === undefined ? undefined : null;
  const c = ctx.db
    .select({ id: cuentas.id })
    .from(cuentas)
    .where(and(eq(cuentas.id, id), eq(cuentas.usuarioId, ctx.usuarioId)))
    .get();
  if (!c) throw new ErrorFinanzas("Esa cuenta no existe.");
  return c.id;
}

export type DatosRecurrenteApp = {
  nombre: string;
  tipo: Recurrente["tipo"];
  monto: number;
  frecuencia: Recurrente["frecuencia"];
  dia: number;
  mes?: number | null;
  cuentaId?: string | null;
};

export function crearRecurrenteApp(ctx: Contexto, datos: DatosRecurrenteApp) {
  validar(datos);
  if (datos.frecuencia === "anual" && !datos.mes) throw new ErrorFinanzas("Di en qué mes se cobra.");
  const { cuentaId, mes, ...resto } = datos;
  const creado = crearRecurrente(ctx, { ...resto, mes: mes ?? undefined }, cuentaPropia(ctx, cuentaId) ?? null);
  return recurrenteApp(ctx, propio(ctx, creado.id));
}

/** Edita en su lugar; `estado` pausa, cancela, archiva o reactiva. */
export function editarRecurrenteApp(
  ctx: Contexto,
  id: string,
  cambios: Partial<DatosRecurrenteApp> & { estado?: EstadoRecurrente },
) {
  let fila = propio(ctx, id);
  const { estado, ...resto } = cambios;
  if (Object.values(resto).some((v) => v !== undefined)) {
    const datos = {
      nombre: resto.nombre?.trim() || fila.nombre,
      tipo: resto.tipo ?? fila.tipo,
      monto: resto.monto ?? fila.montoCentavos / 100,
      frecuencia: resto.frecuencia ?? fila.frecuencia,
      dia: resto.dia ?? fila.dia,
      mes: resto.mes === undefined ? fila.mes : resto.mes,
    };
    validar(datos);
    if (datos.frecuencia === "anual" && !datos.mes) throw new ErrorFinanzas("Di en qué mes se cobra.");
    const cuentaId = cuentaPropia(ctx, resto.cuentaId);
    const despues = ctx.db
      .update(recurrentes)
      .set({
        nombre: datos.nombre,
        tipo: datos.tipo,
        montoCentavos: aCentavos(datos.monto),
        frecuencia: datos.frecuencia,
        dia: datos.dia,
        mes: datos.frecuencia === "anual" ? datos.mes : null,
        ...(cuentaId !== undefined ? { cuentaId } : {}),
        // Cambió el cobro: el aviso de "mañana se cobra" vuelve a valer.
        avisadoPara: null,
      })
      .where(eq(recurrentes.id, fila.id))
      .returning()
      .get()!;
    registrarEnBitacora(ctx, "recurrentes", fila.id, "editar", fila, despues);
    fila = despues;
  }
  if (estado) fila = cambiarEstado(ctx, fila, estado);
  return recurrenteApp(ctx, fila);
}

export function eliminarRecurrenteApp(ctx: Contexto, id: string) {
  darDeBaja(ctx, propio(ctx, id));
}
