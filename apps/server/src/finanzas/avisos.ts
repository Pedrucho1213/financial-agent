// Avisos del día: los genera el revisor nocturno (fugas, presupuestos, cobros que vienen). El Atajo dice
// el más importante una sola vez, al final de la primera respuesta del día, y sale como notificación en la mañana.
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { avisos } from "../db/schema";

export type Aviso = typeof avisos.$inferSelect;

export type NuevoAviso = {
  usuarioId: string;
  /** Día local (YYYY-MM-DD) para el que es. */
  fecha: string;
  /** "fuga", "presupuesto", "cobro", "meta"... */
  tipo: string;
  /** Corto, para el título de la notificación. */
  titulo: string;
  /** Una o dos frases; puede llevar "$85" (la voz lo dice "85 pesos"). */
  texto: string;
  /** Ruta de la app a la que lleva tocar la notificación ("/#movimientos?categoria=..."). */
  url?: string;
  /** Mayor = más importante. Solo se dice uno por día. */
  prioridad?: number;
};

/** Guarda un aviso. El mismo usuario, día, tipo y título no se repite: devuelve el que ya estaba. */
export function crearAviso(db: Db, aviso: NuevoAviso): Aviso {
  const fila = db
    .insert(avisos)
    .values({ ...aviso, url: aviso.url ?? null, prioridad: aviso.prioridad ?? 0 })
    .onConflictDoNothing()
    .returning()
    .get();
  return (
    fila ??
    db
      .select()
      .from(avisos)
      .where(
        and(
          eq(avisos.usuarioId, aviso.usuarioId),
          eq(avisos.fecha, aviso.fecha),
          eq(avisos.tipo, aviso.tipo),
          eq(avisos.titulo, aviso.titulo),
        ),
      )
      .get()!
  );
}

/**
 * El aviso que el Atajo dice hoy: el más importante de hoy, si todavía no se ha dicho ninguno hoy.
 * Uno por día: si ya dijo uno, no dice otro aunque queden.
 */
export function avisoDelDia(db: Db, usuarioId: string, hoy: string): Aviso | undefined {
  const deHoy = db
    .select()
    .from(avisos)
    .where(and(eq(avisos.usuarioId, usuarioId), eq(avisos.fecha, hoy)))
    .orderBy(desc(avisos.prioridad), asc(avisos.creadoEn))
    .all();
  if (deHoy.some((a) => a.dichoEn)) return undefined;
  return deHoy[0];
}

export function marcarDicho(db: Db, id: string) {
  db.update(avisos).set({ dichoEn: new Date().toISOString() }).where(eq(avisos.id, id)).run();
}

/** Avisos de hoy o de antes que aún no salen como notificación, del más importante al menos. */
export function avisosPorNotificar(db: Db, usuarioId: string, hoy: string): Aviso[] {
  return db
    .select()
    .from(avisos)
    .where(and(eq(avisos.usuarioId, usuarioId), lte(avisos.fecha, hoy), isNull(avisos.notificadoEn)))
    .orderBy(desc(avisos.prioridad), asc(avisos.creadoEn))
    .all();
}

export function marcarNotificado(db: Db, ids: string[]) {
  const ahora = new Date().toISOString();
  for (const id of ids) db.update(avisos).set({ notificadoEn: ahora }).where(eq(avisos.id, id)).run();
}
