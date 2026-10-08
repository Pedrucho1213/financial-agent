import { and, asc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { bitacora, comercios, comprasMsi, cuentas, metas, movimientos, prestamosPersonales, presupuestos, recurrentes } from "../db/schema";
import { aCentavos, formatearMonto } from "../lib/dinero";
import { armarFecha, partes, resolverFecha, resolverPeriodo, sumarDias, sumarMeses, ultimoDiaDelMes } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import { encontrarCategoria, encontrarOCrearCuenta, idsConHijas, listarCategorias, nombreCompleto, type Categoria } from "./catalogos";
import type { Contexto } from "./contexto";
import { cambioDeCuenta, crearMovimiento, ErrorFinanzas, registrarEnBitacora } from "./movimientos";
import { estadosDeCuentas, totalesDeCuentas } from "./cuentas";
import { proximoCobro } from "./recurrentes";

// Presupuestos, metas de ahorro, préstamos entre personas y compras a meses sin intereses.
// Todo se calcula aquí; la IA solo lee los resultados ya hechos.

/** El presupuesto general (todo lo que se gasta en el mes) no tiene categoría. */
export const GENERAL = "*";

export type Presupuesto = typeof presupuestos.$inferSelect;
export type Meta = typeof metas.$inferSelect;
export type Prestamo = typeof prestamosPersonales.$inferSelect;
export type CompraMsi = typeof comprasMsi.$inferSelect;

function validarMonto(monto: number, que = "El monto") {
  if (!Number.isFinite(monto) || aCentavos(monto) < 1) throw new ErrorFinanzas(`${que} debe ser mayor a cero.`);
}

/** Primer y último día del mes ("2026-10") o del mes de hoy. */
export function limitesDelMes(ctx: Contexto, mes = ctx.hoy.slice(0, 7)) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErrorFinanzas(`Mes inválido: ${mes}. Usa AAAA-MM.`);
  const [anio, m] = mes.split("-").map(Number) as [number, number];
  return { mes, desde: armarFecha(anio, m, 1), hasta: armarFecha(anio, m, ultimoDiaDelMes(anio, m)) };
}

/** Gastos en la moneda base entre dos fechas, sin los borrados. */
function gastosEntre(ctx: Contexto, desde: string, hasta: string) {
  return ctx.db
    .select()
    .from(movimientos)
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        isNull(movimientos.eliminadoEn),
        eq(movimientos.tipo, "gasto"),
        eq(movimientos.moneda, ctx.monedaBase),
        gte(movimientos.fecha, desde),
        lte(movimientos.fecha, hasta),
      ),
    )
    .all();
}

// ---------------------------------------------------------------- Presupuestos

function presupuestosActivos(ctx: Contexto) {
  return ctx.db
    .select()
    .from(presupuestos)
    .where(and(eq(presupuestos.usuarioId, ctx.usuarioId), isNull(presupuestos.eliminadoEn)))
    .orderBy(asc(presupuestos.creadoEn))
    .all();
}

// "En general", "del mes", "total": el presupuesto de todo lo que gasta.
const ES_GENERAL = /^(general|total|todo|todos|global|mensual|del mes|al mes|mes|gastos|mis gastos|gasto|en general|de todo)$/;

/** La categoría de gasto de un presupuesto ("comida", "el súper"), o GENERAL si no nombra ninguna. */
function categoriaDelPresupuesto(cats: Categoria[], categoria: string | null | undefined): string {
  const texto = normalizar(categoria ?? "").replace(/^(el|la|los|las|mi|mis|de|en) /, "");
  if (!texto || ES_GENERAL.test(texto)) return GENERAL;
  const encontrada = encontrarCategoria(cats.filter((c) => c.tipo === "gasto"), texto, "gasto");
  if (!encontrada) {
    const principales = cats.filter((c) => c.tipo === "gasto" && !c.padreId).map((c) => c.nombre);
    throw new ErrorFinanzas(`No existe la categoría "${categoria}". Las principales: ${principales.join(", ")}.`);
  }
  return encontrada.id;
}

function nombreDelPresupuesto(cats: Categoria[], categoriaId: string) {
  return categoriaId === GENERAL ? "General" : (nombreCompleto(cats, categoriaId) ?? "Sin categoría");
}

/** Cuánto se gastó en el mes en lo que cubre un presupuesto (con subcategorías). */
function gastadoEn(cats: Categoria[], categoriaId: string, gastos: (typeof movimientos.$inferSelect)[]) {
  if (categoriaId === GENERAL) return gastos.reduce((s, m) => s + m.montoCentavos, 0);
  const ids = new Set(idsConHijas(cats, categoriaId));
  return gastos.filter((m) => m.categoriaId && ids.has(m.categoriaId)).reduce((s, m) => s + m.montoCentavos, 0);
}

function estadoDe(porcentaje: number): "bien" | "cerca" | "excedido" {
  return porcentaje > 100 ? "excedido" : porcentaje >= 80 ? "cerca" : "bien";
}

function verPresupuesto(
  ctx: Contexto,
  p: Presupuesto,
  cats: Categoria[],
  gastos: (typeof movimientos.$inferSelect)[],
  dias: { diaDelMes: number; diasDelMes: number },
) {
  const gastado = gastadoEn(cats, p.categoriaId, gastos);
  const porcentaje = Math.round((gastado / p.limiteCentavos) * 100);
  return {
    id: p.id,
    categoriaId: p.categoriaId === GENERAL ? null : p.categoriaId,
    categoria: nombreDelPresupuesto(cats, p.categoriaId),
    limiteCentavos: p.limiteCentavos,
    gastadoCentavos: gastado,
    restanteCentavos: p.limiteCentavos - gastado,
    porcentaje,
    // Al ritmo que lleva, cuánto habrá gastado al cerrar el mes.
    proyeccionCentavos: Math.round((gastado / dias.diaDelMes) * dias.diasDelMes / 100) * 100,
    estado: estadoDe(porcentaje),
  };
}

export type PresupuestoApp = ReturnType<typeof verPresupuesto>;

/** Cómo va cada presupuesto en el mes ("2026-10"); el mes actual por omisión. */
export function estadoPresupuestos(ctx: Contexto, mesPedido?: string) {
  const { mes, desde, hasta } = limitesDelMes(ctx, mesPedido);
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const gastos = gastosEntre(ctx, desde, hasta);
  const diasDelMes = partes(hasta).dia;
  // Un mes pasado ya terminó; uno futuro todavía no empieza.
  const diaDelMes = ctx.hoy < desde ? 1 : ctx.hoy > hasta ? diasDelMes : partes(ctx.hoy).dia;
  const lista = presupuestosActivos(ctx).map((p) => verPresupuesto(ctx, p, cats, gastos, { diaDelMes, diasDelMes }));
  // El general primero; luego del más apretado al más holgado.
  lista.sort((a, b) => Number(b.categoriaId === null) - Number(a.categoriaId === null) || b.porcentaje - a.porcentaje);
  const general = lista.find((p) => p.categoriaId === null);
  // "Comida > Restaurantes" ya cuenta dentro de "Comida" si las dos tienen presupuesto.
  const conPresupuesto = lista.filter((p) => p.categoriaId !== null).map((p) => p.categoriaId!);
  const porCategoria = lista.filter(
    (p) => p.categoriaId !== null && !conPresupuesto.some((otra) => otra !== p.categoriaId && idsConHijas(cats, otra).includes(p.categoriaId!)),
  );
  return {
    mes,
    hoy: ctx.hoy,
    diasDelMes,
    diaDelMes,
    presupuestos: lista,
    total: general
      ? { limiteCentavos: general.limiteCentavos, gastadoCentavos: general.gastadoCentavos }
      : {
          limiteCentavos: porCategoria.reduce((s, p) => s + p.limiteCentavos, 0),
          gastadoCentavos: porCategoria.reduce((s, p) => s + p.gastadoCentavos, 0),
        },
  };
}

/** "Mi presupuesto de comida es de 3 mil": crea o cambia el límite mensual de esa categoría. */
export function fijarPresupuesto(ctx: Contexto, datos: { categoria?: string | null; categoriaId?: string | null; monto: number }) {
  validarMonto(datos.monto, "El presupuesto");
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  let categoriaId: string;
  if (datos.categoriaId !== undefined) {
    categoriaId = datos.categoriaId ?? GENERAL;
    const cat = cats.find((c) => c.id === categoriaId);
    if (categoriaId !== GENERAL && cat?.tipo !== "gasto") throw new ErrorFinanzas("Esa categoría de gasto no existe.");
  } else {
    categoriaId = categoriaDelPresupuesto(cats, datos.categoria);
  }
  const limite = aCentavos(datos.monto);
  const antes = presupuestosActivos(ctx).find((p) => p.categoriaId === categoriaId);
  let fila: Presupuesto;
  if (antes) {
    fila = ctx.db.update(presupuestos).set({ limiteCentavos: limite }).where(eq(presupuestos.id, antes.id)).returning().get()!;
    registrarEnBitacora(ctx, "presupuestos", fila.id, "editar", antes, fila);
  } else {
    fila = ctx.db.insert(presupuestos).values({ usuarioId: ctx.usuarioId, categoriaId, limiteCentavos: limite }).returning().get();
    registrarEnBitacora(ctx, "presupuestos", fila.id, "crear", undefined, fila);
  }
  return presupuestoApp(ctx, fila, cats);
}

function presupuestoApp(ctx: Contexto, p: Presupuesto, cats = listarCategorias(ctx.db, ctx.usuarioId)) {
  const { desde, hasta } = limitesDelMes(ctx);
  return verPresupuesto(ctx, p, cats, gastosEntre(ctx, desde, hasta), { diaDelMes: partes(ctx.hoy).dia, diasDelMes: partes(hasta).dia });
}

/** Quita un presupuesto por id (la app) o por categoría (la voz). */
export function quitarPresupuesto(ctx: Contexto, datos: { id?: string; categoria?: string | null }) {
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const activos = presupuestosActivos(ctx);
  // "Quita el presupuesto" sin decir cuál: solo si hay uno. "Quita el general" sí dice cuál.
  if (!datos.id && !datos.categoria?.trim() && activos.length > 1) {
    throw new ErrorFinanzas(`Hay varios presupuestos: ${activos.map((p) => nombreDelPresupuesto(cats, p.categoriaId)).join(", ")}. Pregunta cuál.`);
  }
  const antes = datos.id
    ? activos.find((p) => p.id === datos.id)
    : !datos.categoria?.trim() && activos.length === 1
      ? activos[0]
      : activos.find((p) => p.categoriaId === categoriaDelPresupuesto(cats, datos.categoria));
  if (!antes) {
    const hay = activos.map((p) => nombreDelPresupuesto(cats, p.categoriaId)).join(", ") || "ninguno";
    throw new ErrorFinanzas(`No hay un presupuesto así. Los que hay: ${hay}.`);
  }
  const despues = ctx.db
    .update(presupuestos)
    .set({ eliminadoEn: new Date().toISOString() })
    .where(eq(presupuestos.id, antes.id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "presupuestos", antes.id, "eliminar", antes, despues);
  return { categoria: nombreDelPresupuesto(cats, antes.categoriaId), limite: formatearMonto(antes.limiteCentavos, ctx.monedaBase) };
}

/**
 * Lo que cambió en los presupuestos con los gastos que se acaban de registrar, solo si importa:
 * "Vas en 82% de tu presupuesto de Comida." o "Ya te pasaste de tu presupuesto de Comida por $120."
 * Se dice al cruzar el 80% o el 100% del mes, no en cada gasto.
 */
export function datoDePresupuesto(ctx: Contexto, nuevos: { categoriaId: string | null; montoCentavos: number; fecha: string; moneda: string }[]) {
  const activos = presupuestosActivos(ctx);
  if (activos.length === 0) return undefined;
  const { desde, hasta } = limitesDelMes(ctx);
  const delMes = nuevos.filter((n) => n.moneda === ctx.monedaBase && n.fecha >= desde && n.fecha <= hasta);
  if (delMes.length === 0) return undefined;
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const gastos = gastosEntre(ctx, desde, hasta);
  const cubre = (p: Presupuesto, categoriaId: string | null) =>
    p.categoriaId === GENERAL || (!!categoriaId && idsConHijas(cats, p.categoriaId).includes(categoriaId));
  const cruces = activos.flatMap((p) => {
    const nuevo = delMes.filter((n) => cubre(p, n.categoriaId)).reduce((s, n) => s + n.montoCentavos, 0);
    if (nuevo === 0) return [];
    const despues = gastadoEn(cats, p.categoriaId, gastos);
    const antes = despues - nuevo;
    const pct = (c: number) => (c / p.limiteCentavos) * 100;
    const nombre = p.categoriaId === GENERAL ? "tu presupuesto del mes" : `tu presupuesto de ${nombreDelPresupuesto(cats, p.categoriaId).split(" > ").at(-1)}`;
    if (pct(antes) <= 100 && pct(despues) > 100) {
      return [{ peso: 2 + pct(despues) / 1000, texto: `Ya te pasaste de ${nombre} por ${formatearMonto(despues - p.limiteCentavos, ctx.monedaBase)}.` }];
    }
    if (pct(antes) < 80 && pct(despues) >= 80) {
      // Redondeado hacia abajo: "100%" solo cuando de verdad llegó al límite.
      return [{ peso: 1 + pct(despues) / 1000, texto: `Vas en ${Math.floor(pct(despues))}% de ${nombre}.` }];
    }
    return [];
  });
  return cruces.sort((a, b) => b.peso - a.peso)[0]?.texto;
}

// ---------------------------------------------------------------- Metas

function metasActivas(ctx: Contexto) {
  return ctx.db
    .select()
    .from(metas)
    .where(and(eq(metas.usuarioId, ctx.usuarioId), isNull(metas.eliminadoEn)))
    .orderBy(asc(metas.creadoEn))
    .all();
}

/** Cuántos meses quedan para la fecha límite, contando el actual. */
function mesesHasta(hoy: string, fecha: string) {
  const a = partes(hoy);
  const b = partes(fecha);
  return Math.max(1, (b.anio - a.anio) * 12 + (b.mes - a.mes) + 1);
}

export function metaApp(ctx: Contexto, m: Meta) {
  const faltan = Math.max(0, m.objetivoCentavos - m.ahorradoCentavos);
  return {
    id: m.id,
    nombre: m.nombre,
    objetivoCentavos: m.objetivoCentavos,
    ahorradoCentavos: m.ahorradoCentavos,
    porcentaje: Math.min(100, Math.floor((m.ahorradoCentavos / m.objetivoCentavos) * 100)),
    fechaLimite: m.fechaLimite,
    // Cuánto apartar al mes para llegar a tiempo.
    mensualSugeridoCentavos: m.fechaLimite && faltan > 0 && m.fechaLimite >= ctx.hoy ? Math.ceil(faltan / mesesHasta(ctx.hoy, m.fechaLimite) / 100) * 100 : null,
    completada: m.ahorradoCentavos >= m.objetivoCentavos,
  };
}

export type MetaApp = ReturnType<typeof metaApp>;

export function listarMetas(ctx: Contexto) {
  return { metas: metasActivas(ctx).map((m) => metaApp(ctx, m)) };
}

/** "Para diciembre", "en marzo", "2027-06-30", "el 15 de diciembre": el último día de ese plazo. */
export function fechaLimiteDe(ctx: Contexto, texto: string | null | undefined): string | null {
  if (!texto?.trim()) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(texto.trim());
  if (iso && !esFechaValida(texto.trim())) throw new ErrorFinanzas(`La fecha "${texto}" no existe.`);
  let fecha = iso ? texto.trim() : fechaLimiteDicha(ctx, texto);
  if (fecha >= ctx.hoy) return fecha;
  // Una meta siempre es a futuro: "para marzo" dicho en octubre es el marzo que viene. Un AAAA-MM-DD de
  // hace menos de un año es el mismo día del año que viene (la IA a veces calcula mal el año); con un año
  // dicho, o más viejo, ya pasó.
  const conAnio = !iso && /\b20\d\d\b/.test(texto);
  if (conAnio || (iso && sumarMeses(fecha, 12) < ctx.hoy)) throw new ErrorFinanzas("La fecha límite ya pasó.");
  while (fecha < ctx.hoy) fecha = unAnioDespues(fecha);
  return fecha;
}

/** El mismo día un año después; un fin de mes sigue siendo fin de mes (28 de febrero → 29 si toca). */
function unAnioDespues(fecha: string) {
  const { anio, mes, dia } = partes(fecha);
  return armarFecha(anio + 1, mes, dia === ultimoDiaDelMes(anio, mes) ? ultimoDiaDelMes(anio + 1, mes) : dia);
}

/** Un AAAA-MM-DD que de verdad existe (sin 2026-02-30 ni 2026-13-01). */
export function esFechaValida(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= ultimoDiaDelMes(anio, mes);
}

function fechaLimiteDicha(ctx: Contexto, texto: string): string {
  const limpio = normalizar(texto).replace(/^(para|en|antes de|a|hasta)( el)? /, "");
  const anioDicho = limpio.match(/\b(20\d\d)\b/)?.[1];
  const sinAnio = limpio.replace(/\s*(de |del )?20\d\d\b/, "").trim();
  const periodo = resolverPeriodo(sinAnio, ctx.hoy);
  const dia = resolverFecha(sinAnio, ctx.hoy);
  let fecha = periodo?.hasta ?? dia;
  if (!fecha) throw new ErrorFinanzas(`No entendí la fecha "${texto}". Usa un mes ("diciembre") o AAAA-MM-DD.`);
  if (anioDicho && !fecha.startsWith(anioDicho)) fecha = `${anioDicho}${fecha.slice(4)}`;
  return fecha;
}

const PREFIJO_META = /^(el|la|los|las|mi|mis|meta|metas|para|de|del|al|a) /;
const VACIAS = new Set(["del", "las", "los", "para", "meta", "mis", "con", "que", "una", "por"]);

/** La meta que nombra ("el viaje", "mi fondo de emergencia"); si solo hay una y no la nombra, esa. */
function encontrarMeta(ctx: Contexto, nombre: string | undefined, id?: string): Meta {
  const activas = metasActivas(ctx);
  if (id) {
    const porId = activas.find((m) => m.id === id);
    if (!porId) throw new ErrorFinanzas("No encontré esa meta.");
    return porId;
  }
  // "La meta del viaje" → "viaje".
  let buscado = normalizar(nombre ?? "");
  while (PREFIJO_META.test(buscado)) buscado = buscado.replace(PREFIJO_META, "");
  if (!buscado && activas.length === 1) return activas[0]!;
  if (!buscado) throw new ErrorFinanzas(activas.length ? `Hay varias metas: ${activas.map((m) => m.nombre).join(", ")}. Pregunta cuál.` : "No hay metas.");
  const exactas = activas.filter((m) => normalizar(m.nombre) === buscado);
  const palabras = buscado.split(" ").filter((p) => p.length > 2 && !VACIAS.has(p));
  const parecidas = exactas.length
    ? exactas
    : activas.filter((m) => {
        const n = normalizar(m.nombre);
        return (buscado && (n.includes(buscado) || buscado.includes(n))) || palabras.some((p) => n.split(" ").includes(p));
      });
  if (parecidas.length === 1) return parecidas[0]!;
  const nombres = activas.map((m) => m.nombre).join(", ") || "ninguna";
  if (parecidas.length === 0) throw new ErrorFinanzas(`No tengo una meta llamada "${nombre ?? ""}". Las que hay: ${nombres}. Si es nueva, créala.`);
  throw new ErrorFinanzas(`Coinciden ${parecidas.map((m) => m.nombre).join(", ")}. Pregunta cuál.`);
}

export function crearMeta(ctx: Contexto, datos: { nombre: string; objetivo: number; ahorrado?: number; fechaLimite?: string | null }) {
  const nombre = datos.nombre.trim().replace(/^(mi|la|el|una|un) /i, "");
  if (!nombre) throw new ErrorFinanzas("Falta el nombre de la meta.");
  validarMonto(datos.objetivo, "El objetivo");
  if (datos.ahorrado !== undefined && datos.ahorrado < 0) throw new ErrorFinanzas("Lo ahorrado no puede ser negativo.");
  if (metasActivas(ctx).some((m) => normalizar(m.nombre) === normalizar(nombre))) {
    throw new ErrorFinanzas(`Ya hay una meta "${nombre}". Para cambiarla, edítala.`);
  }
  const fila = ctx.db
    .insert(metas)
    .values({
      usuarioId: ctx.usuarioId,
      nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
      objetivoCentavos: aCentavos(datos.objetivo),
      ahorradoCentavos: aCentavos(datos.ahorrado ?? 0),
      fechaLimite: fechaLimiteDe(ctx, datos.fechaLimite),
    })
    .returning()
    .get();
  registrarEnBitacora(ctx, "metas", fila.id, "crear", undefined, fila);
  return metaApp(ctx, fila);
}

/** "Aparté 500 para el viaje" (monto positivo) o "saqué 200 del fondo" (negativo). */
export function aportarMeta(ctx: Contexto, datos: { nombre?: string; id?: string; monto: number }) {
  if (!Number.isFinite(datos.monto) || aCentavos(datos.monto) === 0) throw new ErrorFinanzas("El monto no puede ser cero.");
  const antes = encontrarMeta(ctx, datos.nombre, datos.id);
  const ahorrado = antes.ahorradoCentavos + aCentavos(datos.monto);
  if (ahorrado < 0) {
    throw new ErrorFinanzas(`En "${antes.nombre}" solo hay ${formatearMonto(antes.ahorradoCentavos, ctx.monedaBase)}; no se puede sacar más.`);
  }
  const fila = ctx.db.update(metas).set({ ahorradoCentavos: ahorrado }).where(eq(metas.id, antes.id)).returning().get()!;
  registrarEnBitacora(ctx, "metas", fila.id, "editar", antes, fila);
  return { ...metaApp(ctx, fila), aportadoCentavos: aCentavos(datos.monto), recienCompletada: antes.ahorradoCentavos < antes.objetivoCentavos && fila.ahorradoCentavos >= fila.objetivoCentavos };
}

export function editarMeta(
  ctx: Contexto,
  datos: { nombre?: string; id?: string; cambios: { nombre?: string; objetivo?: number; fechaLimite?: string | null } },
) {
  const antes = encontrarMeta(ctx, datos.nombre, datos.id);
  const { cambios } = datos;
  if (cambios.objetivo !== undefined) validarMonto(cambios.objetivo, "El objetivo");
  const nuevoNombre = cambios.nombre?.trim();
  if (nuevoNombre && metasActivas(ctx).some((m) => m.id !== antes.id && normalizar(m.nombre) === normalizar(nuevoNombre))) {
    throw new ErrorFinanzas(`Ya hay otra meta "${nuevoNombre}".`);
  }
  const valores = {
    nombre: nuevoNombre || antes.nombre,
    objetivoCentavos: cambios.objetivo !== undefined ? aCentavos(cambios.objetivo) : antes.objetivoCentavos,
    fechaLimite: cambios.fechaLimite === undefined ? antes.fechaLimite : fechaLimiteDe(ctx, cambios.fechaLimite),
  };
  const fila = ctx.db.update(metas).set(valores).where(eq(metas.id, antes.id)).returning().get()!;
  registrarEnBitacora(ctx, "metas", fila.id, "editar", antes, fila);
  return metaApp(ctx, fila);
}

export function eliminarMeta(ctx: Contexto, datos: { nombre?: string; id?: string }) {
  const antes = encontrarMeta(ctx, datos.nombre, datos.id);
  const despues = ctx.db.update(metas).set({ eliminadoEn: new Date().toISOString() }).where(eq(metas.id, antes.id)).returning().get()!;
  registrarEnBitacora(ctx, "metas", antes.id, "eliminar", antes, despues);
  return { nombre: antes.nombre, ahorrado: formatearMonto(antes.ahorradoCentavos, ctx.monedaBase) };
}

// ---------------------------------------------------------------- Préstamos entre personas

export type Direccion = Prestamo["direccion"];

function prestamosAbiertos(ctx: Contexto) {
  return ctx.db
    .select()
    .from(prestamosPersonales)
    .where(and(eq(prestamosPersonales.usuarioId, ctx.usuarioId), isNull(prestamosPersonales.eliminadoEn), isNull(prestamosPersonales.saldadoEn)))
    .orderBy(asc(prestamosPersonales.creadoEn))
    .all();
}

const limpiarPersona = (persona: string) => persona.trim().replace(/^(a|al|a la|la|el|mi|con|de) /i, "").trim();
const mismaPersona = (a: string, b: string) => {
  const x = normalizar(limpiarPersona(a));
  const y = normalizar(limpiarPersona(b));
  return x === y || x.split(" ")[0] === y || y.split(" ")[0] === x;
};

/**
 * Los préstamos de quien nombra. El nombre exacto manda; si solo dice el nombre de pila ("Juan") y
 * hay dos Juanes, no adivina: pide que pregunte cuál.
 */
function deLaPersona(filas: Prestamo[], persona: string): Prestamo[] {
  const exactas = filas.filter((p) => normalizar(p.persona) === normalizar(limpiarPersona(persona)));
  if (exactas.length) return exactas;
  const parecidas = filas.filter((p) => mismaPersona(p.persona, persona));
  const nombres = [...new Set(parecidas.map((p) => p.persona))];
  if (nombres.length > 1) throw new ErrorFinanzas(`Coinciden ${nombres.join(" y ")}. Pregunta cuál.`);
  return parecidas;
}

export function prestamoApp(p: Prestamo) {
  return {
    id: p.id,
    persona: p.persona,
    direccion: p.direccion,
    montoCentavos: p.montoCentavos,
    pagadoCentavos: p.pagadoCentavos,
    pendienteCentavos: p.montoCentavos - p.pagadoCentavos,
    descripcion: p.descripcion,
    creadoEn: p.creadoEn,
    saldadoEn: p.saldadoEn,
  };
}

/** Préstamos sin saldar (con `todos`, también los saldados) y cuánto le deben y cuánto debe. */
export function listarPrestamos(ctx: Contexto, opciones: { todos?: boolean; persona?: string } = {}) {
  let filas = opciones.todos
    ? ctx.db
        .select()
        .from(prestamosPersonales)
        .where(and(eq(prestamosPersonales.usuarioId, ctx.usuarioId), isNull(prestamosPersonales.eliminadoEn)))
        .orderBy(asc(prestamosPersonales.creadoEn))
        .all()
    : prestamosAbiertos(ctx);
  if (opciones.persona) filas = deLaPersona(filas, opciones.persona);
  const lista = filas.map(prestamoApp);
  const abiertos = lista.filter((p) => !p.saldadoEn);
  const suma = (d: Direccion) => abiertos.filter((p) => p.direccion === d).reduce((s, p) => s + p.pendienteCentavos, 0);
  return { prestamos: lista, meDebenCentavos: suma("me_deben"), deboCentavos: suma("debo") };
}

/** "Le presté 500 a Juan" (me_deben) o "Juan me prestó 1000" (debo). */
export function registrarPrestamo(ctx: Contexto, datos: { persona: string; direccion: Direccion; monto: number; descripcion?: string }) {
  const persona = limpiarPersona(datos.persona);
  if (!persona) throw new ErrorFinanzas("Falta a quién.");
  validarMonto(datos.monto);
  // Mismo nombre que un préstamo anterior: se escribe igual para que se sumen. "Juan" es "Juan Pérez" si
  // es el único Juan; "Juan López" no es el "Juan" que ya estaba.
  const abiertos = prestamosAbiertos(ctx);
  const exacta = abiertos.find((p) => normalizar(p.persona) === normalizar(persona))?.persona;
  const dePila = [...new Set(abiertos.filter((p) => normalizar(p.persona).split(" ")[0] === normalizar(persona)).map((p) => p.persona))];
  if (!exacta && dePila.length > 1) throw new ErrorFinanzas(`Coinciden ${dePila.join(" y ")}. Pregunta cuál.`);
  const conocida = exacta ?? dePila[0];
  const fila = ctx.db
    .insert(prestamosPersonales)
    .values({
      usuarioId: ctx.usuarioId,
      persona: conocida ?? persona.charAt(0).toUpperCase() + persona.slice(1),
      direccion: datos.direccion,
      montoCentavos: aCentavos(datos.monto),
      descripcion: datos.descripcion?.trim() || null,
    })
    .returning()
    .get();
  registrarEnBitacora(ctx, "prestamos_personales", fila.id, "crear", undefined, fila);
  const total = listarPrestamos(ctx, { persona: fila.persona }).prestamos.filter((p) => p.direccion === fila.direccion);
  return { ...prestamoApp(fila), totalPendienteCentavos: total.reduce((s, p) => s + p.pendienteCentavos, 0) };
}

/**
 * "Juan me pagó 200" o "ya le pagué a Juan": abona a sus préstamos, del más antiguo al más nuevo.
 * Sin monto, salda todo lo pendiente con esa persona.
 */
export function abonarPrestamo(ctx: Contexto, datos: { persona: string; direccion?: Direccion; monto?: number }) {
  if (datos.monto !== undefined) validarMonto(datos.monto);
  const abiertos = deLaPersona(prestamosAbiertos(ctx), datos.persona);
  const direcciones = new Set(abiertos.map((p) => p.direccion));
  if (abiertos.length === 0) {
    const hay = [...new Set(prestamosAbiertos(ctx).map((p) => p.persona))].join(", ") || "nadie";
    throw new ErrorFinanzas(`No hay préstamos pendientes con "${datos.persona}". Hay con: ${hay}.`);
  }
  const direccion = datos.direccion ?? (direcciones.size === 1 ? [...direcciones][0]! : undefined);
  if (!direccion) throw new ErrorFinanzas(`Con ${abiertos[0]!.persona} hay préstamos en los dos sentidos. Pregunta si él le pagó o si el usuario le pagó.`);
  const filas = abiertos.filter((p) => p.direccion === direccion);
  if (filas.length === 0) throw new ErrorFinanzas(`Con ${abiertos[0]!.persona} no hay préstamos en ese sentido.`);
  const pendiente = filas.reduce((s, p) => s + p.montoCentavos - p.pagadoCentavos, 0);
  let resto = datos.monto !== undefined ? aCentavos(datos.monto) : pendiente;
  if (resto > pendiente) {
    throw new ErrorFinanzas(`Con ${filas[0]!.persona} solo quedan ${formatearMonto(pendiente, ctx.monedaBase)} pendientes; el abono es mayor.`);
  }
  const ahora = new Date().toISOString();
  for (const antes of filas) {
    if (resto === 0) break;
    const abono = Math.min(resto, antes.montoCentavos - antes.pagadoCentavos);
    resto -= abono;
    const pagado = antes.pagadoCentavos + abono;
    const fila = ctx.db
      .update(prestamosPersonales)
      .set({ pagadoCentavos: pagado, saldadoEn: pagado >= antes.montoCentavos ? ahora : null })
      .where(eq(prestamosPersonales.id, antes.id))
      .returning()
      .get()!;
    registrarEnBitacora(ctx, "prestamos_personales", fila.id, "editar", antes, fila);
  }
  const queda = pendiente - (datos.monto !== undefined ? aCentavos(datos.monto) : pendiente);
  return { persona: filas[0]!.persona, direccion, abonadoCentavos: pendiente - queda, pendienteCentavos: queda, saldado: queda === 0 };
}

// ---------------------------------------------------------------- Meses sin intereses

function nombresDeCuentas(ctx: Contexto) {
  return new Map(
    ctx.db
      .select({ id: cuentas.id, nombre: cuentas.nombre })
      .from(cuentas)
      .where(eq(cuentas.usuarioId, ctx.usuarioId))
      .all()
      .map((c) => [c.id, c.nombre]),
  );
}

function comprasActivas(ctx: Contexto) {
  return ctx.db
    .select()
    .from(comprasMsi)
    .where(and(eq(comprasMsi.usuarioId, ctx.usuarioId), isNull(comprasMsi.eliminadoEn)))
    .orderBy(asc(comprasMsi.primerCargo))
    .all();
}

/** Fecha del cargo número `n` (0 = el primero), cada mes el mismo día. */
const fechaDelCargo = (c: Pick<CompraMsi, "primerCargo">, n: number) => sumarMeses(c.primerCargo, n, partes(c.primerCargo).dia);

/** Cuántos cargos ya llegaron (hasta hoy, incluido). */
function cargosHechos(c: CompraMsi, hoy: string) {
  let n = 0;
  while (n < c.meses && fechaDelCargo(c, n) <= hoy) n++;
  return n;
}

/** El último cargo, que absorbe el redondeo: 1,000 a 3 meses son 333.33 + 333.33 + 333.34. */
const montoDelCargo = (c: CompraMsi, n: number) =>
  n === c.meses - 1 ? c.totalCentavos - c.mensualidadCentavos * (c.meses - 1) : c.mensualidadCentavos;

export function msiApp(ctx: Contexto, c: CompraMsi, cuentas?: Map<string, string>) {
  const pagadas = cargosHechos(c, ctx.hoy);
  const pagado = Array.from({ length: pagadas }, (_, n) => montoDelCargo(c, n)).reduce((s, x) => s + x, 0);
  return {
    id: c.id,
    descripcion: c.descripcion,
    totalCentavos: c.totalCentavos,
    meses: c.meses,
    mensualidadCentavos: c.mensualidadCentavos,
    primerCargo: c.primerCargo,
    pagadas,
    restanteCentavos: c.totalCentavos - pagado,
    proximoCargo: pagadas < c.meses ? fechaDelCargo(c, pagadas) : null,
    proximoMontoCentavos: pagadas < c.meses ? montoDelCargo(c, pagadas) : null,
    cuenta: c.cuentaId ? (cuentas?.get(c.cuentaId) ?? null) : null,
  };
}

/** Compras a meses que todavía tienen cargos por venir, y cuánto suman al mes. */
export function listarMsi(ctx: Contexto, opciones: { todas?: boolean } = {}) {
  const cuentasUsuario = nombresDeCuentas(ctx);
  const lista = comprasActivas(ctx).map((c) => msiApp(ctx, c, cuentasUsuario));
  const vigentes = lista.filter((c) => c.proximoCargo !== null);
  return { compras: opciones.todas ? lista : vigentes, mensualCentavos: vigentes.reduce((s, c) => s + c.mensualidadCentavos, 0) };
}

/**
 * Cada mensualidad que ya llegó queda como un gasto (con msi_id), para que el mes muestre lo que de
 * verdad sale de la cartera. Corre al registrar la compra y en el revisor diario. Devuelve cuántos creó.
 */
export function registrarMensualidades(ctx: Contexto, opciones: { soloCompra?: string; sinBitacora?: boolean } = {}): number {
  const { soloCompra, sinBitacora } = opciones;
  let creados = 0;
  for (const c of comprasActivas(ctx)) {
    if (soloCompra && c.id !== soloCompra) continue;
    const hechos = cargosHechos(c, ctx.hoy);
    if (hechos === 0) continue;
    // También las borradas: si el usuario quitó o movió una mensualidad, no se vuelve a crear.
    const anteriores = ctx.db
      .select({ fecha: movimientos.fecha, descripcion: movimientos.descripcion, categoriaId: movimientos.categoriaId, eliminadoEn: movimientos.eliminadoEn })
      .from(movimientos)
      .where(and(eq(movimientos.usuarioId, ctx.usuarioId), eq(movimientos.msiId, c.id)))
      .orderBy(asc(movimientos.fecha))
      .all();
    // Cada mensualidad se reconoce por su número ("3 de 12 MSI"); si le cambiaron el texto, por su fecha.
    const yaRegistradas = new Set(
      anteriores.map((m) => {
        const k = m.descripcion?.match(/\((\d+) de \d+ MSI\)$/)?.[1];
        return k ? Number(k) - 1 : Array.from({ length: c.meses }, (_, n) => n).find((n) => fechaDelCargo(c, n) === m.fecha) ?? -1;
      }),
    );
    // La categoría de la mensualidad anterior (quizá ya corregida) vale para las siguientes.
    let categoriaId = anteriores.filter((m) => !m.eliminadoEn).at(-1)?.categoriaId ?? undefined;
    const cuenta = c.cuentaId ? nombresDeCuentas(ctx).get(c.cuentaId) : undefined;
    // Solo las de los últimos dos meses: una compra vieja dada de alta hoy no llena el historial.
    const desde = sumarMeses(ctx.hoy, -2);
    for (let n = 0; n < hechos; n++) {
      const fecha = fechaDelCargo(c, n);
      if (fecha < desde || yaRegistradas.has(n)) continue;
      const creado = crearMovimiento(
        { ...ctx, textoOriginal: undefined },
        {
          tipo: "gasto",
          monto: montoDelCargo(c, n) / 100,
          descripcion: `${c.descripcion} (${n + 1} de ${c.meses} MSI)`,
          categoriaId,
          cuenta,
          fecha,
          origen: "importacion",
        },
      );
      ctx.db.update(movimientos).set({ msiId: c.id }).where(eq(movimientos.id, creado.id)).run();
      // Lo que agrega el revisor no es algo que el usuario dijo: "deshaz eso" no debe tocarlo.
      if (sinBitacora) ctx.db.delete(bitacora).where(and(eq(bitacora.usuarioId, ctx.usuarioId), eq(bitacora.registroId, creado.id))).run();
      categoriaId ??= ctx.db.select({ c: movimientos.categoriaId }).from(movimientos).where(eq(movimientos.id, creado.id)).get()?.c ?? undefined;
      creados++;
    }
  }
  return creados;
}

/** Los meses sin intereses son de tarjeta de crédito: una cuenta sin tipo con la que se compra así lo es. */
function tarjetaDeLaCompra(ctx: Contexto, texto: string | undefined): string | undefined {
  const cuenta = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, texto, { alCambiar: cambioDeCuenta(ctx) });
  if (cuenta?.tipo === "otra") {
    registrarEnBitacora(ctx, "cuentas", cuenta.id, "editar", { tipo: "otra" }, { tipo: "credito" });
    ctx.db.update(cuentas).set({ tipo: "credito" }).where(eq(cuentas.id, cuenta.id)).run();
  }
  return cuenta?.id;
}

/** "Compré una pantalla de 12 mil a 12 meses sin intereses con la BBVA". */
export function registrarMsi(ctx: Contexto, datos: { descripcion: string; total: number; meses: number; cuenta?: string; fecha?: string }) {
  const descripcion = datos.descripcion.trim();
  if (!descripcion) throw new ErrorFinanzas("Falta qué compró.");
  validarMonto(datos.total, "El total");
  if (!Number.isInteger(datos.meses) || datos.meses < 2 || datos.meses > 48) throw new ErrorFinanzas("Los meses deben estar entre 2 y 48.");
  let primerCargo = resolverFecha(datos.fecha, ctx.hoy) ?? ctx.hoy;
  // "El primer cargo es el 15 de noviembre" dicho en octubre es el que viene, no el del año pasado.
  if (primerCargo < ctx.hoy && !/\b20\d\d\b/.test(datos.fecha ?? "") && sumarMeses(primerCargo, 12) <= sumarMeses(ctx.hoy, 2)) {
    primerCargo = sumarMeses(primerCargo, 12);
  }
  const total = aCentavos(datos.total);
  const fila = ctx.db
    .insert(comprasMsi)
    .values({
      usuarioId: ctx.usuarioId,
      descripcion: descripcion.charAt(0).toUpperCase() + descripcion.slice(1),
      totalCentavos: total,
      meses: datos.meses,
      mensualidadCentavos: Math.floor(total / datos.meses),
      primerCargo,
      cuentaId: tarjetaDeLaCompra(ctx, datos.cuenta),
    })
    .returning()
    .get();
  registrarEnBitacora(ctx, "compras_msi", fila.id, "crear", undefined, fila);
  registrarMensualidades(ctx, { soloCompra: fila.id });
  return listarMsi(ctx, { todas: true }).compras.find((c) => c.id === fila.id)!;
}

// ---------------------------------------------------------------- ¿Cuánto puedo gastar hoy?

/** Fechas de cobro de un recurrente entre dos días (incluidos). */
function cobrosEntre(r: Pick<typeof recurrentes.$inferSelect, "frecuencia" | "dia" | "mes">, desde: string, hasta: string) {
  const fechas: string[] = [];
  let dia = desde;
  while (dia <= hasta) {
    const proximo = proximoCobro(r, dia);
    if (proximo > hasta) break;
    fechas.push(proximo);
    dia = sumarDias(proximo, 1);
  }
  return fechas;
}

/** Los gastos desde una fecha, con el texto en que se buscan los pagos fijos (descripción, dictado y comercio). */
function pagosRecientes(ctx: Contexto, desde: string) {
  const nombresComercio = new Map(
    ctx.db
      .select({ id: comercios.id, nombre: comercios.nombreNormalizado })
      .from(comercios)
      .where(eq(comercios.usuarioId, ctx.usuarioId))
      .all()
      .map((c) => [c.id, c.nombre]),
  );
  return gastosEntre(ctx, desde, ctx.hoy).map((m) => ({
    fecha: m.fecha,
    recurrenteId: m.recurrenteId,
    montoCentavos: m.montoCentavos,
    texto: normalizar([m.descripcion, m.textoOriginal].filter(Boolean).join(" ")),
    comercio: m.comercioId ? (nombresComercio.get(m.comercioId) ?? "") : "",
  }));
}

/**
 * Desde cuándo un gasto cuenta como pago del cobro de `fecha`: a la mitad entre el cobro anterior y
 * este. Así la renta del 10 pagada el 5 cuenta, y el Netflix de septiembre anotado un día tarde no.
 */
function inicioDelCiclo(r: Pick<typeof recurrentes.$inferSelect, "frecuencia" | "dia" | "mes">, fecha: string) {
  const anterior = cobrosEntre(r, sumarDias(fecha, r.frecuencia === "anual" ? -370 : -40), sumarDias(fecha, -1)).at(-1);
  if (!anterior) return sumarDias(fecha, -15);
  const dias = Math.round((Date.parse(fecha) - Date.parse(anterior)) / 86_400_000);
  return sumarDias(anterior, Math.floor(dias / 2));
}

const PALABRAS_VACIAS = new Set(["pago", "pagos", "cobro", "del", "las", "los", "para", "mensual", "mensualidad", "plan", "cuota"]);

/**
 * Si ya hay un gasto de este pago fijo en este ciclo, hasta hoy, de un monto parecido. Coincide por el
 * nombre en cualquier sentido ("renta" y "Renta del departamento"), por el comercio, o por la primera
 * palabra que distingue al pago.
 */
function yaSePago(
  r: Pick<typeof recurrentes.$inferSelect, "id" | "nombre" | "montoCentavos">,
  desde: string,
  hasta: string,
  pagos: ReturnType<typeof pagosRecientes>,
) {
  const nombre = normalizar(r.nombre);
  const clave = nombre.split(" ").find((p) => p.length > 3 && !PALABRAS_VACIAS.has(p));
  const contiene = (texto: string, parte: string) => !!parte && new RegExp(`\\b${parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(texto);
  return pagos.some((m) => {
    if (m.fecha < desde || m.fecha > hasta) return false;
    if (m.recurrenteId === r.id) return true;
    // Por el nombre solo si el monto se parece: "tenis para el gym" de 1,500 no es la mensualidad del Gym.
    if (m.montoCentavos < r.montoCentavos * 0.5 || m.montoCentavos > r.montoCentavos * 1.5) return false;
    if (contiene(m.texto, nombre) || (m.comercio.length > 3 && (contiene(nombre, m.comercio) || contiene(m.comercio, nombre)))) return true;
    return !!clave && (contiene(m.texto, clave) || contiene(m.comercio, clave));
  });
}

/**
 * Lo que falta pagar de hoy al fin de mes: pagos fijos y mensualidades. Un cobro que ya se anotó en
 * este ciclo (por su nombre) no se cuenta dos veces: la renta del 10 pagada el 5 ya está en lo gastado.
 */
export function porPagarEsteMes(ctx: Contexto, fijos = recurrentesActivosEnBase(ctx)): number {
  const { desde, hasta } = limitesDelMes(ctx);
  const pagados = pagosRecientes(ctx, sumarMeses(desde, -1));
  const porPagarFijos = fijos
    .filter((r) => r.tipo !== "ingreso")
    .flatMap((r) => cobrosEntre(r, ctx.hoy, hasta).map((f, i) => ({ r, f, i })))
    .filter(({ r, f, i }) => i > 0 || !yaSePago(r, inicioDelCiclo(r, f), ctx.hoy, pagados))
    .reduce((s, { r }) => s + r.montoCentavos, 0);
  const mensualidades = ctx.db
    .select({ fecha: movimientos.fecha, msiId: movimientos.msiId })
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNotNull(movimientos.msiId), isNull(movimientos.eliminadoEn), gte(movimientos.fecha, ctx.hoy)))
    .all();
  const porPagarMsi = comprasActivas(ctx)
    .flatMap((c) =>
      Array.from({ length: c.meses }, (_, n) => ({ c, n, f: fechaDelCargo(c, n) })).filter(
        ({ c, f }) => f >= ctx.hoy && f <= hasta && !mensualidades.some((m) => m.msiId === c.id && m.fecha === f),
      ),
    )
    .reduce((s, { c, n }) => s + montoDelCargo(c, n), 0);
  return porPagarFijos + porPagarMsi;
}

function recurrentesActivosEnBase(ctx: Contexto) {
  return ctx.db
    .select()
    .from(recurrentes)
    .where(
      and(
        eq(recurrentes.usuarioId, ctx.usuarioId),
        eq(recurrentes.activo, true),
        isNull(recurrentes.eliminadoEn),
        eq(recurrentes.moneda, ctx.monedaBase),
      ),
    )
    .all();
}

/**
 * Cuánto puede gastar hoy sin pasarse en el mes: lo que entra (ingresos registrados o la quincena
 * esperada, lo que sea mayor), menos lo gastado y lo que falta pagar (pagos fijos y mensualidades),
 * repartido entre los días que quedan. Sin ingresos, usa los presupuestos.
 */
export function disponible(ctx: Contexto) {
  const { desde, hasta } = limitesDelMes(ctx);
  const diasRestantes = partes(hasta).dia - partes(ctx.hoy).dia + 1;
  const gastos = gastosEntre(ctx, desde, hasta);
  const gastado = gastos.reduce((s, m) => s + m.montoCentavos, 0);
  const gastadoHoy = gastos.filter((m) => m.fecha === ctx.hoy).reduce((s, m) => s + m.montoCentavos, 0);

  const ingresosRegistrados = ctx.db
    .select()
    .from(movimientos)
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        isNull(movimientos.eliminadoEn),
        eq(movimientos.tipo, "ingreso"),
        eq(movimientos.moneda, ctx.monedaBase),
        gte(movimientos.fecha, desde),
        lte(movimientos.fecha, hasta),
      ),
    )
    .all()
    .reduce((s, m) => s + m.montoCentavos, 0);
  const fijos = recurrentesActivosEnBase(ctx);
  const ingresosEsperados = fijos
    .filter((r) => r.tipo === "ingreso")
    .reduce((s, r) => s + cobrosEntre(r, desde, hasta).length * r.montoCentavos, 0);
  const ingresos = Math.max(ingresosRegistrados, ingresosEsperados);

  let comprometido = porPagarEsteMes(ctx, fijos);

  let base: "ingresos" | "presupuestos" | "saldos" | null = null;
  let libreMes = 0;
  // Con presupuestos por categoría, lo gastado hoy fuera de ellos no cuenta contra lo que queda.
  let gastadoHoyBase = gastadoHoy;
  if (ingresos > 0) {
    base = "ingresos";
    libreMes = ingresos - gastado - comprometido;
  } else {
    const estado = estadoPresupuestos(ctx);
    const general = estado.presupuestos.find((p) => p.categoriaId === null);
    if (general) {
      base = "presupuestos";
      libreMes = general.limiteCentavos - general.gastadoCentavos - comprometido;
    } else if (estado.presupuestos.length) {
      base = "presupuestos";
      libreMes = estado.total.limiteCentavos - estado.total.gastadoCentavos;
      // Los presupuestos por categoría ya incluyen lo que se paga en ellas: no se aparta nada aparte.
      comprometido = 0;
      const cats = listarCategorias(ctx.db, ctx.usuarioId);
      const cubiertas = new Set(estado.presupuestos.flatMap((p) => idsConHijas(cats, p.categoriaId!)));
      gastadoHoyBase = gastos.filter((m) => m.fecha === ctx.hoy && m.categoriaId && cubiertas.has(m.categoriaId)).reduce((s, m) => s + m.montoCentavos, 0);
    } else {
      // Sin ingresos ni presupuestos, pero con el saldo de sus cuentas: lo que tiene hoy, menos lo que falta
      // pagar este mes. Lo gastado ya salió de esos saldos.
      const t = totalesDeCuentas(estadosDeCuentas(ctx));
      if (t.cuentasConSaldo) {
        base = "saldos";
        libreMes = t.dineroCentavos - comprometido;
      }
    }
  }
  // Lo de hoy se reparte como si el día empezara: así gastar hoy baja lo que queda hoy, no el promedio.
  const porDia = base ? Math.floor(Math.max(0, libreMes + gastadoHoyBase) / diasRestantes / 100) * 100 : 0;
  return {
    hoy: ctx.hoy,
    diasRestantes,
    porDiaCentavos: porDia,
    disponibleHoyCentavos: base ? porDia - gastadoHoyBase : 0,
    libreMesCentavos: libreMes,
    base,
    ingresosCentavos: ingresos,
    gastadoCentavos: gastado,
    gastadoHoyCentavos: gastadoHoyBase,
    comprometidoCentavos: comprometido,
  };
}

/** La respuesta hablada de "¿cuánto puedo gastar hoy?", armada con las cifras ya calculadas. */
export function respuestaDisponible(ctx: Contexto, d = disponible(ctx)): string {
  const $ = (c: number) => formatearMonto(c, ctx.monedaBase);
  if (!d.base) {
    return 'Para calcularlo necesito saber cuánto te entra, cuánto tienes o un presupuesto. Dime, por ejemplo, "me pagan 12 mil cada quincena", "tengo 20 mil en Revolut" o "mi presupuesto del mes es de 15 mil".';
  }
  if (d.libreMesCentavos <= 0) {
    return d.libreMesCentavos < 0
      ? `Este mes ya no te queda margen: con lo que falta pagar te pasas por ${$(-d.libreMesCentavos)}.`
      : "Este mes ya no te queda margen para gastar.";
  }
  const fijos = d.comprometidoCentavos > 0 ? `, ya apartando ${$(d.comprometidoCentavos)} de pagos que faltan` : "";
  if (d.disponibleHoyCentavos <= 0) {
    return `Hoy ya gastaste tu parte del día, que era de ${$(d.porDiaCentavos)}. Para cerrar bien el mes, mejor ya no gastes hoy.`;
  }
  if (d.gastadoHoyCentavos > 0) {
    return `Hoy te quedan ${$(d.disponibleHoyCentavos)} de los ${$(d.porDiaCentavos)} que te tocan por día${fijos}.`;
  }
  return `Hoy puedes gastar hasta ${$(d.porDiaCentavos)} para cerrar bien el mes${fijos}.`;
}
