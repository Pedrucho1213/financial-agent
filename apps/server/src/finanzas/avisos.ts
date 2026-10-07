import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { avisos, recurrentes, TIPOS_AVISO } from "../db/schema";
import { fechaLocal, partes, sumarDias } from "../lib/fechas";
import type { Contexto } from "./contexto";
import { ErrorFinanzas } from "./movimientos";

export type Aviso = typeof avisos.$inferSelect;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

export type AvisoNuevo = {
  tipo: TipoAviso;
  /** Identifica el hallazgo: el mismo hallazgo con la misma clave no se guarda dos veces. */
  clave: string;
  titulo: string;
  texto: string;
  vence?: string | null;
  prioridad?: 1 | 2 | 3;
  enlace?: string | null;
};

/** Guarda el aviso si no existía uno con la misma clave. Devuelve true si es nuevo. */
export function guardarAviso(ctx: Contexto, a: AvisoNuevo): boolean {
  const filas = ctx.db
    .insert(avisos)
    .values({
      usuarioId: ctx.usuarioId,
      tipo: a.tipo,
      clave: a.clave,
      titulo: a.titulo,
      texto: a.texto,
      fecha: ctx.hoy,
      vence: a.vence ?? null,
      prioridad: a.prioridad ?? 2,
      enlace: a.enlace ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: avisos.id })
    .all();
  return filas.length > 0;
}

/**
 * Los avisos de cobros se guardan con el día exacto ("El jueves 8 se cobra Netflix") para que no
 * envejezcan; al leerlos el mismo día o la víspera se dicen "Hoy" o "Mañana".
 */
function conDiaRelativo(texto: string, vence: string | null, hoy: string | undefined) {
  if (!vence || !hoy) return texto;
  const relativo = vence === hoy ? "Hoy" : vence === sumarDias(hoy, 1) ? "Mañana" : undefined;
  return relativo ? texto.replace(new RegExp(`^El [a-záéíóúñ]+ ${partes(vence).dia}\\b`), relativo) : texto;
}

export function avisoApp(a: Aviso, hoy?: string) {
  return {
    id: a.id,
    tipo: a.tipo,
    titulo: conDiaRelativo(a.titulo, a.vence, hoy),
    texto: conDiaRelativo(a.texto, a.vence, hoy),
    fecha: a.fecha,
    vence: a.vence,
    prioridad: a.prioridad,
    enlace: a.enlace,
    creadoEn: a.creadoEn,
    enviadoEn: a.enviadoEn,
    dichoEn: a.dichoEn,
    leidoEn: a.leidoEn,
  };
}

export type AvisoApp = ReturnType<typeof avisoApp>;

const vigente = (hoy: string) => or(isNull(avisos.vence), gte(avisos.vence, hoy));

/** Avisos de los últimos 7 días que siguen vigentes y no se descartaron; sin `todos`, solo los no leídos. */
export function listarAvisos(ctx: Contexto, opciones: { todos?: boolean } = {}) {
  const condiciones = [
    eq(avisos.usuarioId, ctx.usuarioId),
    isNull(avisos.descartadoEn),
    gte(avisos.fecha, sumarDias(ctx.hoy, -7)),
    vigente(ctx.hoy),
  ];
  if (!opciones.todos) condiciones.push(isNull(avisos.leidoEn));
  const filas = ctx.db
    .select()
    .from(avisos)
    .where(and(...condiciones))
    .orderBy(desc(avisos.fecha), avisos.prioridad, desc(avisos.creadoEn))
    .all();
  return { avisos: filas.map((a) => avisoApp(a, ctx.hoy)) };
}

function propio(ctx: Contexto, id: string): Aviso {
  const fila = ctx.db
    .select()
    .from(avisos)
    .where(and(eq(avisos.id, id), eq(avisos.usuarioId, ctx.usuarioId)))
    .get();
  if (!fila) throw new ErrorFinanzas("No encontré ese aviso.");
  return fila;
}

export function marcarLeido(ctx: Contexto, id: string) {
  const fila = propio(ctx, id);
  return avisoApp(
    ctx.db.update(avisos).set({ leidoEn: fila.leidoEn ?? new Date().toISOString() }).where(eq(avisos.id, id)).returning().get()!,
    ctx.hoy,
  );
}

export function descartarAviso(ctx: Contexto, id: string) {
  propio(ctx, id);
  ctx.db.update(avisos).set({ descartadoEn: new Date().toISOString() }).where(eq(avisos.id, id)).run();
  return { ok: true };
}

/**
 * Para el push: avisos de cualquier usuario creados en las últimas 24 horas que nadie ha visto,
 * enviado ni descartado, y que siguen vigentes. El push decide a qué hora mandarlos.
 */
export function avisosPorEnviar(db: Db, zonaHoraria: string, ahora = new Date()) {
  const hoy = fechaLocal(ahora, zonaHoraria);
  return db
    .select()
    .from(avisos)
    .where(
      and(
        isNull(avisos.enviadoEn),
        isNull(avisos.leidoEn),
        isNull(avisos.dichoEn),
        isNull(avisos.descartadoEn),
        gte(avisos.creadoEn, new Date(ahora.getTime() - 24 * 60 * 60_000).toISOString()),
        vigente(hoy),
      ),
    )
    .orderBy(avisos.prioridad, avisos.creadoEn)
    .all()
    .map((a) => ({ ...avisoApp(a, hoy), usuarioId: a.usuarioId }));
}

export function marcarEnviados(db: Db, ids: string[]) {
  if (ids.length === 0) return;
  db.update(avisos).set({ enviadoEn: new Date().toISOString() }).where(inArray(avisos.id, ids)).run();
}

/** El recurrente de un aviso de cobro (clave "cobro:<id>:<fecha>"). */
function cobroDelAviso(a: Pick<Aviso, "tipo" | "clave">) {
  const [tipo, id, fecha] = a.clave.split(":");
  return a.tipo === "cobro_proximo" && tipo === "cobro" && id && fecha ? { id, fecha } : undefined;
}

/**
 * El aviso que el Atajo dice al usarlo: el más importante de ayer u hoy que todavía no se dijo, leyó
 * ni descartó. `marcar` lo da por dicho (llamarlo solo si de verdad se va a oír). Un cobro del que la
 * voz ya avisó ("Ojo: mañana se cobra Netflix") no se repite.
 */
export function avisoDelDia(ctx: Contexto): { aviso: AvisoApp; marcar: () => void } | undefined {
  const candidatos = ctx.db
    .select()
    .from(avisos)
    .where(
      and(
        eq(avisos.usuarioId, ctx.usuarioId),
        isNull(avisos.dichoEn),
        isNull(avisos.leidoEn),
        isNull(avisos.descartadoEn),
        gte(avisos.fecha, sumarDias(ctx.hoy, -1)),
        vigente(ctx.hoy),
      ),
    )
    .orderBy(avisos.prioridad, desc(avisos.creadoEn))
    .all();
  const yaAvisado = (a: Aviso) => {
    const cobro = cobroDelAviso(a);
    if (!cobro) return false;
    const r = ctx.db.select({ avisadoPara: recurrentes.avisadoPara }).from(recurrentes).where(eq(recurrentes.id, cobro.id)).get();
    return r?.avisadoPara === cobro.fecha;
  };
  const elegido = candidatos.find((a) => !yaAvisado(a));
  if (!elegido) return undefined;
  return {
    aviso: avisoApp(elegido, ctx.hoy),
    marcar: () => {
      ctx.db.update(avisos).set({ dichoEn: new Date().toISOString() }).where(eq(avisos.id, elegido.id)).run();
      // Y la voz ya no lo repite al registrar algo.
      const cobro = cobroDelAviso(elegido);
      if (cobro) ctx.db.update(recurrentes).set({ avisadoPara: cobro.fecha }).where(eq(recurrentes.id, cobro.id)).run();
    },
  };
}
