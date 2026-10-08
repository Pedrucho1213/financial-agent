// Etiquetas: marcas libres que cruzan categorías y cuentas ("viaje a Oaxaca", "trabajo", "deducible").
// Un movimiento guarda los ids de las suyas; una etiqueta activa se pone sola en los gastos de esos días.
import { and, eq, isNull } from "drizzle-orm";
import { etiquetas, movimientos } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { resolverFecha, sumarDias } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import type { Contexto } from "./contexto";
import { editarMovimiento, ErrorFinanzas, registrarEnBitacora } from "./movimientos";

export type Etiqueta = typeof etiquetas.$inferSelect;

const MAX_LARGO = 40;

/** "#Viaje Oaxaca", "la etiqueta viaje" → "viaje oaxaca" / "viaje". */
function limpiar(nombre: string): string {
  return nombre
    .replace(/#/g, " ")
    .replace(/^\s*(la |el |mi )?(etiqueta|tag)s?( de| del)?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LARGO)
    .trim();
}

function todas(ctx: Contexto): Etiqueta[] {
  return ctx.db.select().from(etiquetas).where(eq(etiquetas.usuarioId, ctx.usuarioId)).all();
}

export function listarVigentes(ctx: Contexto): Etiqueta[] {
  return todas(ctx).filter((e) => !e.eliminadoEn);
}

/** La palabra y su singular posible: "viajes" → viajes, viaje, viaj. */
const formas = (x: string) => [x, x.replace(/s$/, ""), x.replace(/es$/, "")];

/** La etiqueta con ese nombre (sin importar acentos ni mayúsculas), también si estaba borrada. */
function buscar(ctx: Contexto, nombre: string): Etiqueta | undefined {
  const clave = normalizar(limpiar(nombre));
  if (!clave) return undefined;
  const lista = todas(ctx);
  return (
    lista.find((e) => e.nombreNormalizado === clave && !e.eliminadoEn) ??
    lista.find((e) => e.nombreNormalizado === clave) ??
    // "viajes" es "viaje" y "regalos" es "regalo".
    lista.find((e) => !e.eliminadoEn && formas(e.nombreNormalizado).some((f) => formas(clave).includes(f)))
  );
}

function crear(ctx: Contexto, nombre: string): Etiqueta {
  const limpio = limpiar(nombre);
  const clave = normalizar(limpio);
  if (!clave) throw new ErrorFinanzas("La etiqueta necesita un nombre.");
  const borrada = todas(ctx).find((e) => e.nombreNormalizado === clave);
  if (borrada) {
    const revivida = ctx.db.update(etiquetas).set({ eliminadoEn: null }).where(eq(etiquetas.id, borrada.id)).returning().get()!;
    registrarEnBitacora(ctx, "etiquetas", borrada.id, "editar", borrada, revivida);
    return revivida;
  }
  const fila = ctx.db
    .insert(etiquetas)
    .values({ usuarioId: ctx.usuarioId, nombre: limpio.charAt(0).toUpperCase() + limpio.slice(1), nombreNormalizado: clave })
    .returning()
    .get();
  registrarEnBitacora(ctx, "etiquetas", fila.id, "crear", undefined, fila);
  return fila;
}

/** Los ids de esas etiquetas; las que no existen se crean, salvo con `soloExistentes`. */
export function idsDeEtiquetas(ctx: Contexto, nombres: string[], opciones: { soloExistentes?: boolean } = {}): string[] {
  const ids: string[] = [];
  for (const nombre of nombres) {
    if (!limpiar(nombre)) continue;
    const e = buscar(ctx, nombre);
    if (e && !e.eliminadoEn) ids.push(e.id);
    else if (!opciones.soloExistentes) ids.push(crear(ctx, nombre).id);
  }
  return [...new Set(ids)];
}

/** Solo los ids que son etiquetas vigentes del usuario (la app manda ids). */
export function soloPropias(ctx: Contexto, ids: string[]): string[] {
  const propias = new Set(listarVigentes(ctx).map((e) => e.id));
  return [...new Set(ids)].filter((id) => propias.has(id));
}

/** Los nombres de esos ids, sin las borradas. */
export function nombresDeEtiquetas(ctx: Contexto, ids: string[] | null | undefined): string[] {
  if (!ids?.length) return [];
  const porId = new Map(listarVigentes(ctx).map((e) => [e.id, e.nombre]));
  return ids.map((id) => porId.get(id)).filter((n): n is string => !!n);
}

/** Ids de las etiquetas que se ponen solas en un gasto de ese día. */
export function etiquetasActivas(ctx: Contexto, fecha: string): string[] {
  return listarVigentes(ctx)
    .filter((e) => e.activaDesde && e.activaHasta && e.activaDesde <= fecha && fecha <= e.activaHasta)
    .map((e) => e.id);
}

const MAX_DIAS_ACTIVA = 92;

/**
 * "Estoy de viaje en Oaxaca hasta el domingo": desde hoy (o `desde`) hasta `hasta`, cada gasto nuevo lleva la
 * etiqueta. Sin `hasta`, una semana. Los gastos de esos días que ya estaban anotados también la reciben.
 */
export function activarEtiqueta(ctx: Contexto, datos: { nombre: string; desde?: string; hasta?: string }) {
  const desde = datos.desde ? resolverFecha(datos.desde, ctx.hoy) : ctx.hoy;
  if (!desde) throw new ErrorFinanzas(`No entendí la fecha "${datos.desde}".`);
  let hasta = datos.hasta ? resolverFecha(datos.hasta, ctx.hoy) : sumarDias(desde, 6);
  if (!hasta) throw new ErrorFinanzas(`No entendí la fecha "${datos.hasta}".`);
  // "Hasta el domingo" dicho el lunes es el que viene, no el que pasó.
  if (hasta < desde && datos.hasta && !/\d{4}/.test(datos.hasta)) hasta = sumarDias(hasta, 7);
  if (hasta < desde) throw new ErrorFinanzas("La fecha final es antes de la de inicio.");
  if (Date.parse(hasta) - Date.parse(desde) > MAX_DIAS_ACTIVA * 86_400_000) {
    throw new ErrorFinanzas(`Una etiqueta se activa por ${MAX_DIAS_ACTIVA} días como máximo.`);
  }
  const [id] = idsDeEtiquetas(ctx, [datos.nombre]);
  const antes = ctx.db.select().from(etiquetas).where(eq(etiquetas.id, id!)).get()!;
  const despues = ctx.db.update(etiquetas).set({ activaDesde: desde, activaHasta: hasta }).where(eq(etiquetas.id, id!)).returning().get()!;
  registrarEnBitacora(ctx, "etiquetas", id!, "editar", antes, despues);
  const ya = etiquetar(ctx, { nombre: despues.nombre, desde, hasta: hasta < ctx.hoy ? hasta : ctx.hoy, tipo: "gasto" }).cambiados;
  return { etiqueta: despues.nombre, desde, hasta, yaAnotados: ya };
}

export function desactivarEtiqueta(ctx: Contexto, nombre: string) {
  const e = buscar(ctx, nombre);
  if (!e || e.eliminadoEn) throw new ErrorFinanzas(`No tienes la etiqueta "${limpiar(nombre)}".`);
  if (!e.activaHasta || e.activaHasta < ctx.hoy) return { etiqueta: e.nombre, yaEstabaInactiva: true };
  // Termina ayer: lo de hoy que ya la lleva, la conserva. Si ni había empezado, deja de estar activa.
  const ayer = sumarDias(ctx.hoy, -1);
  const empezo = !!e.activaDesde && e.activaDesde <= ayer;
  const despues = ctx.db
    .update(etiquetas)
    .set(empezo ? { activaHasta: ayer } : { activaDesde: null, activaHasta: null })
    .where(eq(etiquetas.id, e.id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "etiquetas", e.id, "editar", e, despues);
  return { etiqueta: e.nombre };
}

/**
 * Pone (o quita) una etiqueta en todos los movimientos que coinciden: "etiqueta como viaje lo del fin de
 * semana", "lo de Uber de esta semana es de trabajo". Cada cambio queda en la bitácora: se puede deshacer.
 */
export function etiquetar(
  ctx: Contexto,
  datos: { nombre: string; ids?: string[]; desde?: string; hasta?: string; tipo?: "gasto" | "ingreso"; filtrar?: (m: typeof movimientos.$inferSelect) => boolean; quitar?: boolean },
) {
  const [id] = datos.quitar ? idsDeEtiquetas(ctx, [datos.nombre], { soloExistentes: true }) : idsDeEtiquetas(ctx, [datos.nombre]);
  if (!id) throw new ErrorFinanzas(`No tienes la etiqueta "${limpiar(datos.nombre)}".`);
  let filas = ctx.db
    .select()
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn)))
    .all();
  if (datos.ids) filas = filas.filter((m) => datos.ids!.includes(m.id));
  if (datos.desde) filas = filas.filter((m) => m.fecha >= datos.desde!);
  if (datos.hasta) filas = filas.filter((m) => m.fecha <= datos.hasta!);
  if (datos.tipo) filas = filas.filter((m) => m.tipo === datos.tipo);
  if (datos.filtrar) filas = filas.filter(datos.filtrar);
  filas = filas.filter((m) => m.etiquetas.includes(id) === !!datos.quitar);
  for (const m of filas) {
    editarMovimiento(ctx, m.id, datos.quitar ? { etiquetaIds: m.etiquetas.filter((e) => e !== id) } : { etiquetaIds: [...m.etiquetas, id] });
  }
  const nombre = nombresDeEtiquetas(ctx, [id])[0] ?? limpiar(datos.nombre);
  return { etiqueta: nombre, cambiados: filas.length, centavos: filas.filter((m) => m.moneda === ctx.monedaBase).reduce((s, m) => s + m.montoCentavos, 0) };
}

export function renombrarEtiqueta(ctx: Contexto, nombre: string, nuevo: string) {
  const e = buscar(ctx, nombre);
  if (!e || e.eliminadoEn) throw new ErrorFinanzas(`No tienes la etiqueta "${limpiar(nombre)}".`);
  const limpio = limpiar(nuevo);
  const clave = normalizar(limpio);
  if (!clave) throw new ErrorFinanzas("La etiqueta necesita un nombre.");
  const otra = todas(ctx).find((x) => x.nombreNormalizado === clave && x.id !== e.id);
  if (otra && !otra.eliminadoEn) throw new ErrorFinanzas(`Ya tienes la etiqueta "${otra.nombre}".`);
  // Una borrada con ese nombre deja de ocuparlo.
  if (otra) ctx.db.update(etiquetas).set({ nombreNormalizado: `${otra.nombreNormalizado}#${otra.id}` }).where(eq(etiquetas.id, otra.id)).run();
  const despues = ctx.db
    .update(etiquetas)
    .set({ nombre: limpio.charAt(0).toUpperCase() + limpio.slice(1), nombreNormalizado: clave })
    .where(eq(etiquetas.id, e.id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "etiquetas", e.id, "editar", e, despues);
  return despues;
}

/** Borra la etiqueta; los movimientos se quedan como estaban (sin mostrarla). Se puede deshacer. */
export function eliminarEtiqueta(ctx: Contexto, nombreOId: { nombre?: string; id?: string }) {
  const e = nombreOId.id ? todas(ctx).find((x) => x.id === nombreOId.id) : buscar(ctx, nombreOId.nombre ?? "");
  if (!e || e.eliminadoEn) throw new ErrorFinanzas("No existe esa etiqueta.");
  const despues = ctx.db.update(etiquetas).set({ eliminadoEn: new Date().toISOString() }).where(eq(etiquetas.id, e.id)).returning().get()!;
  registrarEnBitacora(ctx, "etiquetas", e.id, "editar", e, despues);
  return { etiqueta: e.nombre };
}

/** Las etiquetas con cuánto llevan: lo que muestra la app y lo que consulta la IA. */
export function resumenEtiquetas(ctx: Contexto, opciones: { desde?: string; hasta?: string } = {}) {
  const lista = listarVigentes(ctx);
  const filas = ctx.db
    .select()
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn)))
    .all()
    .filter((m) => m.etiquetas.length && (!opciones.desde || m.fecha >= opciones.desde) && (!opciones.hasta || m.fecha <= opciones.hasta));
  return lista
    .map((e) => {
      const suyas = filas.filter((m) => m.etiquetas.includes(e.id) && m.moneda === ctx.monedaBase);
      const gastos = suyas.filter((m) => m.tipo === "gasto");
      const ingresos = suyas.filter((m) => m.tipo === "ingreso");
      return {
        id: e.id,
        nombre: e.nombre,
        activaDesde: e.activaDesde,
        activaHasta: e.activaHasta,
        activa: !!e.activaDesde && !!e.activaHasta && e.activaDesde <= ctx.hoy && ctx.hoy <= e.activaHasta,
        cantidad: suyas.length,
        gastadoCentavos: gastos.reduce((s, m) => s + m.montoCentavos, 0),
        ingresadoCentavos: ingresos.reduce((s, m) => s + m.montoCentavos, 0),
        ultimoUso: suyas.reduce<string | null>((max, m) => (!max || m.fecha > max ? m.fecha : max), null),
      };
    })
    .sort((a, b) => b.gastadoCentavos - a.gastadoCentavos || a.nombre.localeCompare(b.nombre));
}

/** "En Viaje Oaxaca llevas $3,450 en 12 gastos." */
export function respuestaEtiqueta(ctx: Contexto, r: ReturnType<typeof resumenEtiquetas>[number]) {
  const $ = (c: number) => formatearMonto(c, ctx.monedaBase);
  if (!r.cantidad) return `Todavía no hay nada con la etiqueta ${r.nombre}.`;
  const gastos = r.gastadoCentavos ? `${$(r.gastadoCentavos)} de gastos` : "";
  const ingresos = r.ingresadoCentavos ? `${$(r.ingresadoCentavos)} de ingresos` : "";
  return `En ${r.nombre} llevas ${[gastos, ingresos].filter(Boolean).join(" y ") || "solo transferencias"}, en ${r.cantidad} ${r.cantidad === 1 ? "movimiento" : "movimientos"}.`;
}
