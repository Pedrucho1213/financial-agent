// Confirmar los cobros de suscripciones y pagos fijos. Cuando llega la fecha de un pago fijo, su cobro queda
// pendiente hasta que se confirma: en la app (con su monto o con otro), por voz ("ya pagué Netflix"), o porque llega
// un gasto que coincide (dictado o de Apple Pay). Nunca se anota solo, salvo los que tienen confirmar_solo.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { bitacora, cobros, comercios, configuracion, cuentas, movimientos, recurrentes, usuarios } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { fechaLocal, sumarDias } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import type { Contexto } from "./contexto";
import { crearMovimiento, ErrorFinanzas, registrarEnBitacora } from "./movimientos";
import {
  cobrosEntre,
  editarRecurrenteApp,
  encontrarRecurrente,
  esPagoDe,
  type GastoParaEmpatar,
  inicioDelCiclo,
  proximoCobro,
  type Recurrente,
} from "./recurrentes";

export type Cobro = typeof cobros.$inferSelect;
type Origen = "app" | "voz" | "apple_pay";

/**
 * Si la confirmación de cobros (y el centro de avisos) está abierta para este usuario. Abierta a todas las cuentas
 * desde el 14-oct-2026; CONFIRMAR_COBROS=dueno la regresa a solo la cuenta dueña (la que se creó primero) y
 * CONFIRMAR_COBROS=0 la apaga.
 */
export function cobrosHabilitado(db: Db, usuarioId: string, entorno: string | undefined = process.env.CONFIRMAR_COBROS): boolean {
  const modo = (entorno ?? "").trim().toLowerCase();
  if (modo === "0" || modo === "no" || modo === "apagado") return false;
  if (modo !== "dueno" && modo !== "dueño") return true;
  const dueno = db.select({ id: usuarios.id }).from(usuarios).orderBy(usuarios.creadoEn, sql`rowid`).limit(1).get();
  return dueno?.id === usuarioId;
}

// Una notificación por cobro al día, a lo mucho tres; una semana después de su fecha ya no se pregunta por push.
export const MAX_NOTIFICACIONES_COBRO = 3;
export const DIAS_PARA_PREGUNTAR = 7;
// Hasta cuántos días después de su fecha un gasto todavía cuenta como el pago de ese cobro.
const DIAS_DE_GRACIA = 7;

/**
 * El primer día con confirmación de cobros para este usuario: no se crean pendientes de antes, para no llenarle la
 * app de cobros viejos al prenderla.
 */
function inicio(ctx: Contexto): string {
  const clave = `cobros_inicio:${ctx.usuarioId}`;
  const guardado = ctx.db.select().from(configuracion).where(eq(configuracion.clave, clave)).get();
  if (guardado) return guardado.valor as string;
  ctx.db.insert(configuracion).values({ clave, valor: ctx.hoy }).onConflictDoNothing().run();
  return ctx.db.select().from(configuracion).where(eq(configuracion.clave, clave)).get()!.valor as string;
}

function activosDeGasto(ctx: Contexto): Recurrente[] {
  return ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn)))
    .all()
    .filter((r) => r.tipo !== "ingreso");
}

type Gasto = GastoParaEmpatar & { id: string; fecha: string; cuentaId: string | null; moneda: string };

/** Los gastos vigentes entre dos días, con el texto y el comercio en que se buscan los pagos fijos. */
function gastosEntre(ctx: Contexto, desde: string, hasta: string): Gasto[] {
  const filas = ctx.db
    .select({ m: movimientos, comercio: comercios.nombreNormalizado })
    .from(movimientos)
    .leftJoin(comercios, eq(comercios.id, movimientos.comercioId))
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        eq(movimientos.tipo, "gasto"),
        isNull(movimientos.eliminadoEn),
        isNull(movimientos.msiId),
        gte(movimientos.fecha, desde),
        lte(movimientos.fecha, hasta),
      ),
    )
    .all();
  return filas.map(({ m, comercio }) => ({
    id: m.id,
    fecha: m.fecha,
    cuentaId: m.cuentaId,
    moneda: m.moneda,
    recurrenteId: m.recurrenteId,
    montoCentavos: m.montoCentavos,
    texto: normalizar([m.descripcion, m.textoOriginal].filter(Boolean).join(" ")),
    comercio: comercio ?? "",
    comercioId: m.comercioId,
  }));
}

/** Los gastos que ya pagan algún cobro: no pueden pagar otro. */
function gastosUsados(ctx: Contexto): Set<string> {
  return new Set(
    ctx.db
      .select({ id: cobros.movimientoId })
      .from(cobros)
      .where(and(eq(cobros.usuarioId, ctx.usuarioId), eq(cobros.estado, "pagado"), isNotNull(cobros.movimientoId)))
      .all()
      .map((c) => c.id!),
  );
}

/** De varios gastos que podrían ser el pago, el único (o el único de monto exacto). Si hay duda, ninguno. */
function elUnico<T extends { montoCentavos: number }>(candidatos: T[], esperado: number): T | undefined {
  if (candidatos.length === 1) return candidatos[0];
  const exactos = candidatos.filter((c) => c.montoCentavos === esperado);
  return exactos.length === 1 ? exactos[0] : undefined;
}

function fechaLocalDe(ctx: Contexto, iso: string) {
  return fechaLocal(new Date(iso), ctx.zonaHoraria);
}

/** Liga un gasto con su cobro: el cobro queda pagado y el gasto marcado como de ese pago fijo. */
function ligar(
  ctx: Contexto,
  c: Cobro,
  gasto: { id: string; montoCentavos: number },
  datos: { por: NonNullable<Cobro["confirmadoPor"]>; creado: boolean; bitacora: boolean; precioAnterior?: number | null },
): Cobro {
  const despues = ctx.db
    .update(cobros)
    .set({
      estado: "pagado",
      movimientoId: gasto.id,
      movimientoCreado: datos.creado,
      montoRealCentavos: gasto.montoCentavos,
      confirmadoPor: datos.por,
      confirmadoEn: new Date().toISOString(),
      precioAnteriorCentavos: datos.precioAnterior ?? null,
      posponerHasta: null,
    })
    .where(eq(cobros.id, c.id))
    .returning()
    .get()!;
  ctx.db.update(movimientos).set({ recurrenteId: c.recurrenteId }).where(eq(movimientos.id, gasto.id)).run();
  if (datos.bitacora) registrarEnBitacora(ctx, "cobros", c.id, "editar", c, despues);
  return despues;
}

/** El cobro de un pago fijo en una fecha; si no existe, se crea pendiente. */
function cobroDe(ctx: Contexto, r: Recurrente, fecha: string): Cobro {
  const existente = ctx.db.select().from(cobros).where(and(eq(cobros.recurrenteId, r.id), eq(cobros.fecha, fecha))).get();
  if (existente) return existente;
  ctx.db
    .insert(cobros)
    .values({ usuarioId: ctx.usuarioId, recurrenteId: r.id, fecha, montoEsperadoCentavos: r.montoCentavos, moneda: r.moneda })
    .onConflictDoNothing()
    .run();
  return ctx.db.select().from(cobros).where(and(eq(cobros.recurrenteId, r.id), eq(cobros.fecha, fecha))).get()!;
}

/** Un gasto anotado sin bitácora: lo hizo el servidor solo, y "deshaz eso" no debe tocarlo. */
function crearGastoDelCobro(ctx: Contexto, r: Recurrente, c: Cobro, datos: { montoCentavos?: number; cuentaId?: string | null; origen: Origen | "importacion" }) {
  const cuentaId = datos.cuentaId === undefined ? r.cuentaId : datos.cuentaId;
  const cuenta = cuentaId
    ? ctx.db.select({ nombre: cuentas.nombre }).from(cuentas).where(and(eq(cuentas.id, cuentaId), eq(cuentas.usuarioId, ctx.usuarioId))).get()
    : undefined;
  if (cuentaId && !cuenta) throw new ErrorFinanzas("Esa cuenta no existe.");
  const montoCentavos = datos.montoCentavos ?? c.montoEsperadoCentavos;
  const creado = crearMovimiento(
    { ...ctx, textoOriginal: undefined },
    {
      tipo: "gasto",
      monto: montoCentavos / 100,
      moneda: c.moneda,
      comercio: r.nombre,
      categoriaId: r.categoriaId ?? undefined,
      cuenta: cuenta?.nombre,
      // El gasto es del día del cobro (si ya pasó), no del día en que se confirma.
      fecha: c.fecha <= ctx.hoy ? c.fecha : ctx.hoy,
      origen: datos.origen,
    },
  );
  return { id: creado.id, montoCentavos };
}

/** Un gasto borrado (o deshecho por voz) deja su cobro pendiente otra vez. */
function soltarBorrados(ctx: Contexto) {
  const sueltos = ctx.db
    .select({ c: cobros })
    .from(cobros)
    .innerJoin(movimientos, eq(movimientos.id, cobros.movimientoId))
    .where(and(eq(cobros.usuarioId, ctx.usuarioId), eq(cobros.estado, "pagado"), isNotNull(movimientos.eliminadoEn)))
    .all();
  for (const { c } of sueltos) {
    ctx.db
      .update(cobros)
      .set({ estado: "pendiente", movimientoId: null, movimientoCreado: false, montoRealCentavos: null, confirmadoPor: null, confirmadoEn: null })
      .where(eq(cobros.id, c.id))
      .run();
  }
}

/**
 * Pone al día los cobros del usuario: crea el pendiente de cada pago fijo cuya fecha llegó, lo da por pagado si ya
 * hay un gasto que coincide, y suelta los que quedaron pagados con un gasto que después se borró. Es barato y se
 * llama antes de leerlos.
 */
export function sincronizarCobros(ctx: Contexto): void {
  if (!cobrosHabilitado(ctx.db, ctx.usuarioId)) return;
  const desde = inicio(ctx);
  soltarBorrados(ctx);

  let gastos: Gasto[] | undefined;
  let usados: Set<string> | undefined;
  const todos = activosDeGasto(ctx);
  // Un gasto que también podría ser de otro pago fijo ("Apple" con Apple Music y Apple TV) solo cuenta si es el monto exacto.
  const deOtroTambien = (r: Recurrente, g: Gasto) =>
    g.montoCentavos !== r.montoCentavos && todos.some((o) => o.id !== r.id && o.moneda === g.moneda && esPagoDe(o, g));
  for (const r of todos) {
    const fecha = cobrosEntre(r, sumarDias(ctx.hoy, r.frecuencia === "anual" ? -370 : -40), ctx.hoy).at(-1);
    // Ni de antes de prenderlo, ni de antes de que existiera el pago fijo.
    if (!fecha || fecha < desde || fecha < fechaLocalDe(ctx, r.creadoEn)) continue;
    const existia = ctx.db.select({ id: cobros.id }).from(cobros).where(and(eq(cobros.recurrenteId, r.id), eq(cobros.fecha, fecha))).get();
    let c = cobroDe(ctx, r, fecha);
    if (c.estado === "pendiente" && (c.montoEsperadoCentavos !== r.montoCentavos || c.moneda !== r.moneda)) {
      c = ctx.db.update(cobros).set({ montoEsperadoCentavos: r.montoCentavos, moneda: r.moneda }).where(eq(cobros.id, c.id)).returning().get()!;
    }
    // Uno de un ciclo anterior que nadie contestó ya no se pregunta.
    ctx.db
      .update(cobros)
      .set({ estado: "sin_confirmar" })
      .where(and(eq(cobros.recurrenteId, r.id), eq(cobros.estado, "pendiente"), sql`${cobros.fecha} < ${fecha}`))
      .run();
    if (c.estado !== "pendiente") continue;
    // ¿Ya está anotado? (la renta del 10 pagada el 5, o el Netflix dictado esta mañana).
    gastos ??= gastosEntre(ctx, sumarDias(ctx.hoy, -45), ctx.hoy);
    usados ??= gastosUsados(ctx);
    const inicioCiclo = inicioDelCiclo(r, fecha);
    const pago = elUnico(
      gastos.filter(
        (g) =>
          g.fecha >= inicioCiclo &&
          !usados!.has(g.id) &&
          g.moneda === r.moneda &&
          (!g.recurrenteId || g.recurrenteId === r.id) &&
          esPagoDe(r, g) &&
          (g.recurrenteId === r.id || !deOtroTambien(r, g)),
      ),
      c.montoEsperadoCentavos,
    );
    if (pago) {
      ligar(ctx, c, pago, { por: "empate", creado: false, bitacora: false });
      usados.add(pago.id);
    } else if (r.confirmarSolo && !existia) {
      const creado = crearGastoDelCobro(ctx, r, c, { origen: "importacion" });
      ctx.db.delete(bitacora).where(and(eq(bitacora.usuarioId, ctx.usuarioId), eq(bitacora.registroId, creado.id))).run();
      ligar(ctx, c, creado, { por: "auto", creado: true, bitacora: false });
    }
  }
}

/** La fecha de cobro a la que pertenece un gasto de un pago fijo: la de su ciclo, si aún no se paga. */
function fechaDelCicloDe(ctx: Contexto, r: Recurrente, dia: string, desde: string): string | undefined {
  const siguiente = proximoCobro(r, dia);
  const fechas = [...cobrosEntre(r, sumarDias(dia, -DIAS_DE_GRACIA), sumarDias(dia, -1)), siguiente];
  for (const f of fechas) {
    if (f < desde || dia < inicioDelCiclo(r, f) || dia > sumarDias(f, DIAS_DE_GRACIA)) continue;
    const c = ctx.db.select({ estado: cobros.estado }).from(cobros).where(and(eq(cobros.recurrenteId, r.id), eq(cobros.fecha, f))).get();
    if (!c || c.estado === "pendiente" || c.estado === "sin_confirmar") return f;
  }
  return undefined;
}

export type Empate = { cobroId: string; recurrenteId: string; nombre: string; fecha: string; esperadoCentavos: number; realCentavos: number; moneda: string };

/**
 * Después de anotar un gasto (dictado, Apple Pay o la app): si es el pago de un pago fijo que falta, lo da por pagado.
 * Si dos pagos fijos podrían ser, gana el de monto exacto; si sigue la duda, no liga nada (mejor preguntar que ligar mal).
 */
export function empatarGasto(ctx: Contexto, movimientoId: string): Empate | undefined {
  if (!cobrosHabilitado(ctx.db, ctx.usuarioId)) return undefined;
  // Antes que la sincronización: así queda como pagado por voz (o Apple Pay) y con bitácora de este dictado.
  soltarBorrados(ctx);
  const m = ctx.db.select().from(movimientos).where(and(eq(movimientos.id, movimientoId), eq(movimientos.usuarioId, ctx.usuarioId))).get();
  if (!m || m.tipo !== "gasto" || m.eliminadoEn || m.msiId) return undefined;
  if (gastosUsados(ctx).has(m.id)) return undefined;
  const [gasto] = gastosEntre(ctx, m.fecha, m.fecha).filter((g) => g.id === m.id);
  if (!gasto) return undefined;
  const desde = inicio(ctx);
  const candidatos = activosDeGasto(ctx)
    .filter((r) => r.moneda === m.moneda && (!m.recurrenteId || m.recurrenteId === r.id) && esPagoDe(r, gasto))
    .flatMap((r) => {
      const fecha = fechaDelCicloDe(ctx, r, m.fecha, desde);
      return fecha ? [{ r, fecha, montoCentavos: r.montoCentavos }] : [];
    });
  const elegido = elUnico(candidatos, m.montoCentavos);
  if (!elegido) return undefined;
  const c = ligar(ctx, cobroDe(ctx, elegido.r, elegido.fecha), gasto, {
    por: m.origen === "apple_pay" ? "apple_pay" : m.origen === "app" ? "app" : "voz",
    creado: false,
    bitacora: true,
  });
  return {
    cobroId: c.id,
    recurrenteId: elegido.r.id,
    nombre: elegido.r.nombre,
    fecha: c.fecha,
    esperadoCentavos: c.montoEsperadoCentavos,
    realCentavos: m.montoCentavos,
    moneda: m.moneda,
  };
}

// ---------------------------------------------------------------- La app

export type SugerenciaCobro = { movimientoId: string; titulo: string; montoCentavos: number; moneda: string; fecha: string; cuenta: string | null };

export type CobroApp = {
  id: string;
  recurrenteId: string;
  nombre: string;
  tipo: Recurrente["tipo"];
  fecha: string;
  montoCentavos: number;
  moneda: string;
  cuentaId: string | null;
  cuenta: string | null;
  estado: Cobro["estado"];
  /** "Todavía no": hasta mañana no se vuelve a preguntar. */
  pospuesto: boolean;
  montoRealCentavos: number | null;
  movimientoId: string | null;
  confirmadoPor: Cobro["confirmadoPor"];
  confirmadoEn: string | null;
  /** Lo que se pagó la vez anterior, si fue otro monto: la app propone actualizar el precio si se repite. */
  anteriorDistintoCentavos: number | null;
  /** Gastos ya anotados que podrían ser este pago ("¿Ya lo anotaste?"). */
  sugerencias: SugerenciaCobro[];
};

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

function sugerenciasPara(ctx: Contexto, r: Recurrente, c: Cobro, gastos: Gasto[], usados: Set<string>, nombres: Map<string, string>): SugerenciaCobro[] {
  const desde = inicioDelCiclo(r, c.fecha);
  const hasta = sumarDias(c.fecha, DIAS_DE_GRACIA);
  const titulos = new Map<string, string>();
  const parecidos = gastos.filter((g) => {
    if (g.fecha < desde || g.fecha > hasta || usados.has(g.id) || g.moneda !== c.moneda) return false;
    if (g.recurrenteId && g.recurrenteId !== r.id) return false;
    // Por su nombre o comercio, o cualquier gasto del mismo monto exacto ("APPLE.COM/BILL" de 49 para iCloud de 49).
    return esPagoDe(r, g) || g.montoCentavos === c.montoEsperadoCentavos;
  });
  if (!parecidos.length) return [];
  const filas = ctx.db
    .select({ id: movimientos.id, descripcion: movimientos.descripcion, comercio: comercios.nombre })
    .from(movimientos)
    .leftJoin(comercios, eq(comercios.id, movimientos.comercioId))
    .where(inArray(movimientos.id, parecidos.map((g) => g.id)))
    .all();
  for (const f of filas) titulos.set(f.id, f.comercio ?? f.descripcion ?? "Gasto");
  return parecidos
    .sort((a, b) => Math.abs(a.montoCentavos - c.montoEsperadoCentavos) - Math.abs(b.montoCentavos - c.montoEsperadoCentavos))
    .slice(0, 3)
    .map((g) => ({
      movimientoId: g.id,
      titulo: titulos.get(g.id) ?? "Gasto",
      montoCentavos: g.montoCentavos,
      moneda: g.moneda,
      fecha: g.fecha,
      cuenta: (g.cuentaId && nombres.get(g.cuentaId)) || null,
    }));
}

function cobroApp(ctx: Contexto, c: Cobro, r: Recurrente, extras: { nombres: Map<string, string>; gastos?: Gasto[]; usados?: Set<string> }): CobroApp {
  const anterior = ctx.db
    .select({ real: cobros.montoRealCentavos, esperado: cobros.montoEsperadoCentavos })
    .from(cobros)
    .where(and(eq(cobros.recurrenteId, r.id), eq(cobros.estado, "pagado"), sql`${cobros.fecha} < ${c.fecha}`))
    .orderBy(desc(cobros.fecha))
    .limit(1)
    .get();
  const pendiente = c.estado === "pendiente";
  return {
    id: c.id,
    recurrenteId: r.id,
    nombre: r.nombre,
    tipo: r.tipo,
    fecha: c.fecha,
    montoCentavos: c.montoEsperadoCentavos,
    moneda: c.moneda,
    cuentaId: r.cuentaId,
    cuenta: (r.cuentaId && extras.nombres.get(r.cuentaId)) || null,
    estado: c.estado,
    pospuesto: pendiente && !!c.posponerHasta && c.posponerHasta > ctx.hoy,
    montoRealCentavos: c.montoRealCentavos,
    movimientoId: c.movimientoId,
    confirmadoPor: c.confirmadoPor,
    confirmadoEn: c.confirmadoEn,
    anteriorDistintoCentavos: anterior?.real && anterior.real !== c.montoEsperadoCentavos ? anterior.real : null,
    sugerencias: pendiente && extras.gastos && extras.usados ? sugerenciasPara(ctx, r, c, extras.gastos, extras.usados, extras.nombres) : [],
  };
}

/** Los cobros pendientes que ya llegaron (de pagos fijos activos), del más viejo al más nuevo. */
function pendientesDeHoy(ctx: Contexto) {
  return ctx.db
    .select({ c: cobros, r: recurrentes })
    .from(cobros)
    .innerJoin(recurrentes, eq(recurrentes.id, cobros.recurrenteId))
    .where(
      and(
        eq(cobros.usuarioId, ctx.usuarioId),
        eq(cobros.estado, "pendiente"),
        lte(cobros.fecha, ctx.hoy),
        eq(recurrentes.activo, true),
        isNull(recurrentes.eliminadoEn),
      ),
    )
    .orderBy(cobros.fecha, recurrentes.nombre)
    .all();
}

/** Cuántos cobros esperan respuesta hoy (lo que muestra el número del ícono). */
export function cobrosPorConfirmar(ctx: Contexto): number {
  if (!cobrosHabilitado(ctx.db, ctx.usuarioId)) return 0;
  sincronizarCobros(ctx);
  return pendientesDeHoy(ctx).filter(({ c }) => !c.posponerHasta || c.posponerHasta <= ctx.hoy).length;
}

/** Para la app: los que esperan respuesta y lo que se resolvió en los últimos 40 días (el ciclo anterior). */
export function cobrosApp(ctx: Contexto) {
  sincronizarCobros(ctx);
  const nombres = nombresDeCuentas(ctx);
  const gastos = gastosEntre(ctx, sumarDias(ctx.hoy, -60), ctx.hoy);
  const usados = gastosUsados(ctx);
  const porConfirmar = pendientesDeHoy(ctx).map(({ c, r }) => cobroApp(ctx, c, r, { nombres, gastos, usados }));
  const recientes = ctx.db
    .select({ c: cobros, r: recurrentes })
    .from(cobros)
    .innerJoin(recurrentes, eq(recurrentes.id, cobros.recurrenteId))
    .where(
      and(
        eq(cobros.usuarioId, ctx.usuarioId),
        inArray(cobros.estado, ["pagado", "saltado", "sin_confirmar"]),
        gte(cobros.fecha, sumarDias(ctx.hoy, -40)),
      ),
    )
    .orderBy(desc(cobros.fecha), desc(cobros.confirmadoEn))
    .limit(20)
    .all()
    .map(({ c, r }) => cobroApp(ctx, c, r, { nombres }));
  return {
    porConfirmar,
    recientes,
    insignia: porConfirmar.filter((c) => !c.pospuesto).length,
  };
}

function propio(ctx: Contexto, id: string) {
  const fila = ctx.db
    .select({ c: cobros, r: recurrentes })
    .from(cobros)
    .innerJoin(recurrentes, eq(recurrentes.id, cobros.recurrenteId))
    .where(and(eq(cobros.id, id), eq(cobros.usuarioId, ctx.usuarioId)))
    .get();
  if (!fila) throw new ErrorFinanzas("Ese cobro no existe.");
  return fila;
}

function resultado(ctx: Contexto, id: string) {
  const { c, r } = propio(ctx, id);
  return cobroApp(ctx, c, r, { nombres: nombresDeCuentas(ctx) });
}

export type DatosConfirmacion = {
  /** Otro monto ("fueron 249"); sin él, el esperado. */
  monto?: number;
  /** Con qué se pagó; sin él, la cuenta del pago fijo. null: sin cuenta. */
  cuentaId?: string | null;
  /** Un gasto ya anotado que es este pago: se liga en vez de anotar otro. */
  movimientoId?: string;
  /** Desde ahora cuesta lo que se pagó. */
  actualizarPrecio?: boolean;
  origen?: Origen;
};

/** "Sí, se pagó": anota el gasto (o liga el que ya estaba) y deja el cobro pagado. */
function confirmar(ctx: Contexto, c: Cobro, r: Recurrente, datos: DatosConfirmacion): Cobro {
  if (c.estado === "pagado") return c;
  const origen = datos.origen ?? "app";
  let gasto: { id: string; montoCentavos: number };
  let creado = false;
  if (datos.movimientoId) {
    const m = ctx.db
      .select()
      .from(movimientos)
      .where(and(eq(movimientos.id, datos.movimientoId), eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn)))
      .get();
    if (!m || m.tipo !== "gasto") throw new ErrorFinanzas("Ese gasto no existe.");
    if (gastosUsados(ctx).has(m.id)) throw new ErrorFinanzas("Ese gasto ya es el pago de otro cobro.");
    gasto = { id: m.id, montoCentavos: m.montoCentavos };
    // Si llegó con otro nombre ("APPLE.COM/BILL" para iCloud), se aprende para la próxima.
    if (m.comercioId && !r.comercioId) {
      const comercio = ctx.db.select({ n: comercios.nombreNormalizado }).from(comercios).where(eq(comercios.id, m.comercioId)).get()?.n ?? "";
      const porNombre = esPagoDe({ ...r, comercioId: null }, { recurrenteId: null, montoCentavos: r.montoCentavos, texto: "", comercio });
      if (!porNombre) ctx.db.update(recurrentes).set({ comercioId: m.comercioId }).where(eq(recurrentes.id, r.id)).run();
    }
  } else {
    if (datos.monto !== undefined && !(datos.monto > 0)) throw new ErrorFinanzas("El monto debe ser mayor a cero.");
    const montoCentavos = datos.monto !== undefined ? Math.round(datos.monto * 100) : undefined;
    gasto = crearGastoDelCobro(ctx, r, c, { montoCentavos, cuentaId: datos.cuentaId, origen });
    creado = true;
  }
  let precioAnterior: number | null = null;
  if (datos.actualizarPrecio && gasto.montoCentavos !== r.montoCentavos && c.moneda === r.moneda) {
    precioAnterior = r.montoCentavos;
    editarRecurrenteApp(ctx, r.id, { monto: gasto.montoCentavos / 100 });
  }
  return ligar(ctx, c, gasto, { por: origen, creado, bitacora: true, precioAnterior });
}

export function confirmarCobro(ctx: Contexto, id: string, datos: DatosConfirmacion = {}) {
  const { c, r } = propio(ctx, id);
  confirmar(ctx, c, r, datos);
  return { cobro: resultado(ctx, id) };
}

/** "Todo se pagó": cada uno con su monto y su cuenta de siempre. */
export function confirmarVarios(ctx: Contexto, ids: string[]) {
  return { cobros: ids.map((id) => confirmarCobro(ctx, id).cobro) };
}

/** "Todavía no": se vuelve a preguntar mañana. */
export function posponerCobro(ctx: Contexto, id: string) {
  const { c } = propio(ctx, id);
  if (c.estado !== "pendiente") throw new ErrorFinanzas("Ese cobro ya no está pendiente.");
  ctx.db.update(cobros).set({ posponerHasta: sumarDias(ctx.hoy, 1) }).where(eq(cobros.id, c.id)).run();
  return { cobro: resultado(ctx, id) };
}

function saltar(ctx: Contexto, c: Cobro, origen: Origen): { sugerirPausa: boolean } {
  if (c.estado === "pagado") throw new ErrorFinanzas("Ese cobro ya está pagado; si no se pagó, primero deshazlo.");
  const despues = ctx.db
    .update(cobros)
    .set({ estado: "saltado", confirmadoPor: origen, confirmadoEn: new Date().toISOString(), posponerHasta: null })
    .where(eq(cobros.id, c.id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "cobros", c.id, "editar", c, despues);
  // Dos ciclos seguidos sin pagarlo: quizá ya no lo usa.
  const anterior = ctx.db
    .select({ estado: cobros.estado })
    .from(cobros)
    .where(and(eq(cobros.recurrenteId, c.recurrenteId), sql`${cobros.fecha} < ${c.fecha}`))
    .orderBy(desc(cobros.fecha))
    .limit(1)
    .get();
  return { sugerirPausa: anterior?.estado === "saltado" };
}

/** "Este mes no se pagó". Si tampoco se pagó el anterior, la app ofrece pausarlo. */
export function saltarCobro(ctx: Contexto, id: string) {
  const { c } = propio(ctx, id);
  const { sugerirPausa } = saltar(ctx, c, "app");
  return { cobro: resultado(ctx, id), sugerirPausa };
}

/** Deshace una confirmación o un "no se pagó": el cobro vuelve a estar pendiente (y el gasto que anotó, se borra). */
export function deshacerCobro(ctx: Contexto, id: string) {
  const { c } = propio(ctx, id);
  if (c.estado === "pendiente") return { cobro: resultado(ctx, id) };
  if (c.estado === "pagado" && c.movimientoId) {
    if (c.movimientoCreado) {
      const m = ctx.db.select().from(movimientos).where(eq(movimientos.id, c.movimientoId)).get();
      if (m && !m.eliminadoEn) {
        const despues = ctx.db.update(movimientos).set({ eliminadoEn: new Date().toISOString() }).where(eq(movimientos.id, m.id)).returning().get()!;
        registrarEnBitacora(ctx, "movimientos", m.id, "eliminar", m, despues);
      }
    } else {
      ctx.db.update(movimientos).set({ recurrenteId: null }).where(eq(movimientos.id, c.movimientoId)).run();
    }
  }
  if (c.precioAnteriorCentavos) editarRecurrenteApp(ctx, c.recurrenteId, { monto: c.precioAnteriorCentavos / 100 });
  const despues = ctx.db
    .update(cobros)
    .set({
      estado: "pendiente",
      movimientoId: null,
      movimientoCreado: false,
      montoRealCentavos: null,
      confirmadoPor: null,
      confirmadoEn: null,
      precioAnteriorCentavos: null,
      posponerHasta: null,
    })
    .where(eq(cobros.id, c.id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "cobros", c.id, "editar", c, despues);
  return { cobro: resultado(ctx, id) };
}

// ---------------------------------------------------------------- La voz

/**
 * El cobro del que habla quien dice "ya pagué Netflix": el pendiente que ya llegó, si hay; si no, el del ciclo en
 * que estamos (la renta del 10 pagada el 5 es la de este mes, no la del pasado).
 */
function cobroDelCiclo(ctx: Contexto, r: Recurrente): Cobro {
  sincronizarCobros(ctx);
  const pendiente = ctx.db
    .select()
    .from(cobros)
    .where(and(eq(cobros.recurrenteId, r.id), inArray(cobros.estado, ["pendiente", "sin_confirmar"]), lte(cobros.fecha, ctx.hoy), gte(cobros.fecha, sumarDias(ctx.hoy, -40))))
    .orderBy(desc(cobros.fecha))
    .limit(1)
    .get();
  if (pendiente) return pendiente;
  const siguiente = proximoCobro(r, ctx.hoy);
  const ultimo = cobrosEntre(r, sumarDias(ctx.hoy, r.frecuencia === "anual" ? -370 : -40), sumarDias(ctx.hoy, -1)).at(-1);
  const fecha = !ultimo || ctx.hoy >= inicioDelCiclo(r, siguiente) ? siguiente : ultimo;
  return cobroDe(ctx, r, fecha);
}

/** Desde qué hora del día del cobro la voz pregunta si ya se cobró. */
const HORA_PREGUNTA_VOZ = 14;

const mesDe = (fecha: string) =>
  ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(fecha.slice(5, 7)) - 1];

/**
 * Por voz: "ya pagué Netflix" (pagado), "pagué Netflix pero fueron 249" (pagado con otro monto) o "este mes no pagué
 * Spotify" (no se pagó). Si ya estaba anotado, lo liga en vez de anotarlo otra vez.
 */
export function marcarCobroPorVoz(
  ctx: Contexto,
  datos: { nombre: string; pagado: boolean; monto?: number; cuenta?: string },
): Record<string, unknown> {
  if (!cobrosHabilitado(ctx.db, ctx.usuarioId)) throw new ErrorFinanzas("Eso se anota con registrar_movimientos.");
  const r = encontrarRecurrente(ctx, datos.nombre, ["activa"]);
  if (r.tipo === "ingreso") throw new ErrorFinanzas(`${r.nombre} es un ingreso: regístralo con registrar_movimientos.`);
  const c = cobroDelCiclo(ctx, r);
  const de = `${r.nombre} de ${mesDe(c.fecha)}`;
  if (c.estado === "pagado") {
    const monto = formatearMonto(c.montoRealCentavos ?? c.montoEsperadoCentavos, c.moneda);
    return { ya_estaba: `${de} ya estaba pagado (${monto}). No anotes otro.`, confirmacion: `${de} ya estaba pagado, con ${monto}.` };
  }
  const origen: Origen = ctx.origen === "apple_pay" ? "apple_pay" : "voz";
  if (!datos.pagado) {
    saltar(ctx, c, origen);
    return { sin_pagar: de, confirmacion: `Va, ${de} queda como no pagado.` };
  }
  // ¿Ya lo anotó antes sin que se ligara? Ese es el pago.
  const montoCentavos = datos.monto !== undefined ? Math.round(datos.monto * 100) : undefined;
  const usados = gastosUsados(ctx);
  const yaAnotado = elUnico(
    gastosEntre(ctx, inicioDelCiclo(r, c.fecha), ctx.hoy).filter(
      (g) => !usados.has(g.id) && (!g.recurrenteId || g.recurrenteId === r.id) && esPagoDe(r, g) && (montoCentavos === undefined || g.montoCentavos === montoCentavos),
    ),
    c.montoEsperadoCentavos,
  );
  let cuentaId: string | null | undefined;
  if (datos.cuenta?.trim()) {
    const buscada = normalizar(datos.cuenta);
    const lista = ctx.db.select({ id: cuentas.id, nombre: cuentas.nombre }).from(cuentas).where(eq(cuentas.usuarioId, ctx.usuarioId)).all();
    cuentaId = lista.find((x) => normalizar(x.nombre) === buscada)?.id ?? lista.find((x) => normalizar(x.nombre).includes(buscada))?.id;
    if (!cuentaId) throw new ErrorFinanzas(`No tengo una cuenta llamada "${datos.cuenta}".`);
  }
  const hecho = confirmar(ctx, c, r, { monto: datos.monto, cuentaId, movimientoId: yaAnotado?.id, origen });
  const real = hecho.montoRealCentavos ?? c.montoEsperadoCentavos;
  const monto = formatearMonto(real, c.moneda);
  return {
    pagado: { nombre: r.nombre, mes: mesDe(c.fecha), monto, ya_estaba_anotado: yaAnotado ? true : undefined },
    ...(real !== c.montoEsperadoCentavos ? { esperado: formatearMonto(c.montoEsperadoCentavos, c.moneda) } : {}),
    confirmacion: yaAnotado ? `Listo, ya lo tenías anotado: ${de} queda pagado.` : `Listo, ${de} quedó pagado con ${monto}.`,
  };
}

/** Lo que se le pregunta por voz sobre un cobro, para reconocer el "sí" o el "no" que contesta. */
export function textoPreguntaPago(c: Pick<Cobro, "montoEsperadoCentavos" | "moneda">, nombre: string) {
  return `Por cierto, ¿ya se cobró ${nombre} de ${formatearMonto(c.montoEsperadoCentavos, c.moneda)}?`;
}

export function textoPreguntaPrecio(nombre: string, realCentavos: number, moneda: string) {
  return `¿Ahora ${nombre} cuesta ${formatearMonto(realCentavos, moneda)} cada vez?`;
}

/**
 * Un cobro que ya llegó y del que la voz todavía no preguntó hoy: "Por cierto, ¿ya se cobró Netflix de $219?".
 * `marcar` lo guarda como preguntado (llamarlo solo si de verdad se va a oír).
 */
export function preguntaDeCobro(ctx: Contexto, pagadosAhora: string[] = []): { pregunta: string; marcar: () => void } | undefined {
  if (!cobrosHabilitado(ctx.db, ctx.usuarioId)) return undefined;
  sincronizarCobros(ctx);
  const recien = new Set(pagadosAhora);
  // El mismo día del cobro, solo desde la tarde: en la mañana el cargo suele no verse todavía en el banco.
  const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: ctx.zonaHoraria, hour: "numeric", hourCycle: "h23" }).format(new Date(ctx.ahoraIso)));
  const elegido = pendientesDeHoy(ctx).find(
    ({ c }) =>
      !recien.has(c.recurrenteId) &&
      (c.fecha < ctx.hoy || hora >= HORA_PREGUNTA_VOZ) &&
      (!c.posponerHasta || c.posponerHasta <= ctx.hoy) &&
      c.fecha >= sumarDias(ctx.hoy, -DIAS_PARA_PREGUNTAR) &&
      (!c.preguntadoEn || fechaLocalDe(ctx, c.preguntadoEn) !== ctx.hoy),
  );
  if (!elegido) return undefined;
  return {
    pregunta: textoPreguntaPago(elegido.c, elegido.r.nombre),
    marcar: () =>
      ctx.db.update(cobros).set({ pregunta: "pago", preguntadoEn: new Date().toISOString() }).where(eq(cobros.id, elegido.c.id)).run(),
  };
}

/** Los cobros que tocó un dictado (los pagó, ligó o saltó). */
export function cobrosDeLaEntrada(ctx: Contexto, entradaId: string) {
  const ids = ctx.db
    .select({ id: bitacora.registroId })
    .from(bitacora)
    .where(and(eq(bitacora.usuarioId, ctx.usuarioId), eq(bitacora.entradaId, entradaId), eq(bitacora.tabla, "cobros"), isNull(bitacora.deshechoEn)))
    .all()
    .map((b) => b.id);
  if (!ids.length) return [];
  return ctx.db.select({ c: cobros, r: recurrentes }).from(cobros).innerJoin(recurrentes, eq(recurrentes.id, cobros.recurrenteId)).where(inArray(cobros.id, ids)).all();
}

/**
 * Si el dictado pagó un pago fijo con otro monto ("pagué Netflix pero fueron 249"): "¿Ahora Netflix cuesta $249
 * cada vez?". `marcar` guarda que se preguntó, para entender el "sí" que conteste.
 */
export function preguntaDePrecio(ctx: Contexto, entradaId: string): { pregunta: string; marcar: () => void } | undefined {
  if (!cobrosHabilitado(ctx.db, ctx.usuarioId)) return undefined;
  const distinto = cobrosDeLaEntrada(ctx, entradaId).find(
    ({ c, r }) => c.estado === "pagado" && !!c.montoRealCentavos && c.moneda === r.moneda && c.montoRealCentavos !== r.montoCentavos && !c.precioAnteriorCentavos,
  );
  if (!distinto) return undefined;
  return {
    pregunta: textoPreguntaPrecio(distinto.r.nombre, distinto.c.montoRealCentavos!, distinto.c.moneda),
    marcar: () =>
      ctx.db.update(cobros).set({ pregunta: "precio", preguntadoEn: new Date().toISOString() }).where(eq(cobros.id, distinto.c.id)).run(),
  };
}

const VIGENCIA_PREGUNTA_MS = 15 * 60_000;
const DICE_SI = /^(si|sip|simon|claro|ya|correcto|exacto|asi es|afirmativo|ok|okay|va|sale|aja|eso)( (ya|ya se (pago|cobro)|ya lo pague|ya quedo|se pago|se cobro|claro|por favor|asi es|gracias|cuesta eso))*$/;
const DICE_NO = /^(no|nop|nel|todavia no|aun no|no todavia|no aun|todavia|aun)( (todavia|aun|se ha cobrado|ha llegado|me ha llegado|gracias))*$/;

/**
 * El "sí" o el "no" a la pregunta que la voz acaba de hacer sobre un cobro, sin pasar por la IA: "sí" lo da por
 * pagado (o actualiza el precio), "todavía no" pregunta mañana. Lo demás ("sí, pero fueron 249") lo ve la IA.
 */
export function respuestaACobroSinModelo(ctx: Contexto, texto: string, anterior: string): { respuesta: string; resultado: Record<string, unknown> } | undefined {
  if (!cobrosHabilitado(ctx.db, ctx.usuarioId)) return undefined;
  const plano = normalizar(texto).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const si = DICE_SI.test(plano);
  const no = !si && DICE_NO.test(plano);
  if (!si && !no) return undefined;
  const fila = ctx.db
    .select({ c: cobros, r: recurrentes })
    .from(cobros)
    .innerJoin(recurrentes, eq(recurrentes.id, cobros.recurrenteId))
    .where(and(eq(cobros.usuarioId, ctx.usuarioId), isNotNull(cobros.pregunta), gte(cobros.preguntadoEn, new Date(Date.now() - VIGENCIA_PREGUNTA_MS).toISOString())))
    .orderBy(desc(cobros.preguntadoEn))
    .limit(1)
    .get();
  if (!fila) return undefined;
  const { c, r } = fila;
  // Que lo último que se le dijo sea esa pregunta, no otra.
  const esPago = c.pregunta === "pago" && anterior.includes(textoPreguntaPago(c, r.nombre).replace("Por cierto, ", ""));
  const esPrecio = c.pregunta === "precio" && !!c.montoRealCentavos && anterior.includes(textoPreguntaPrecio(r.nombre, c.montoRealCentavos, c.moneda));
  if (!esPago && !esPrecio) return undefined;
  ctx.db.update(cobros).set({ pregunta: null }).where(eq(cobros.id, c.id)).run();
  if (esPago) {
    if (c.estado !== "pendiente") return { respuesta: `${r.nombre} ya estaba resuelto.`, resultado: { ya_estaba: r.nombre } };
    if (no) {
      ctx.db.update(cobros).set({ posponerHasta: sumarDias(ctx.hoy, 1) }).where(eq(cobros.id, c.id)).run();
      return { respuesta: "Va, te pregunto mañana.", resultado: { pospuesto: r.nombre } };
    }
    const hecho = confirmar(ctx, c, r, { origen: "voz" });
    const monto = formatearMonto(hecho.montoRealCentavos ?? c.montoEsperadoCentavos, c.moneda);
    return { respuesta: `Listo, anoté ${r.nombre} de ${monto} como pagado.`, resultado: { pagado: { nombre: r.nombre, monto } } };
  }
  const nuevo = formatearMonto(c.montoRealCentavos!, c.moneda);
  if (no) return { respuesta: `Va, ${r.nombre} sigue en ${formatearMonto(r.montoCentavos, r.moneda)}.`, resultado: { precio_igual: r.nombre } };
  const actual = ctx.db.select().from(recurrentes).where(eq(recurrentes.id, r.id)).get()!;
  editarRecurrenteApp(ctx, actual.id, { monto: c.montoRealCentavos! / 100 });
  return { respuesta: `Listo, desde ahora ${r.nombre} es de ${nuevo}.`, resultado: { precio_nuevo: { nombre: r.nombre, monto: nuevo } } };
}

const PAGA = /\b(pague|pagamos|pago|pagado|pagada|cobraron|cobro|cobre|se cobro|me cobro|me cobraron|ya quedo|liquide|deposite)\b/;

/**
 * El pago fijo activo que nombra la frase ("ya pagué Netflix") y en qué va su cobro de este ciclo. Solo si la frase
 * habla de pagarlo; "Netflix subió" o "cancelé Netflix" no.
 */
export function pagoFijoNombrado(ctx: Contexto, texto: string | undefined): { r: Recurrente; cobro: Cobro } | undefined {
  if (!texto || !cobrosHabilitado(ctx.db, ctx.usuarioId)) return undefined;
  const plano = normalizar(texto);
  if (!PAGA.test(plano)) return undefined;
  const nombrados = activosDeGasto(ctx).filter((r) => {
    const nombre = normalizar(r.nombre);
    return nombre.length > 2 && new RegExp(`\\b${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(plano);
  });
  if (nombrados.length !== 1) return undefined;
  const r = nombrados[0]!;
  return { r, cobro: cobroDelCiclo(ctx, r) };
}
