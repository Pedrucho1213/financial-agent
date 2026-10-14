import { eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { configuracion } from "./db/schema";

/**
 * Última ubicación conocida de cada dispositivo: la que su Atajo ya manda con cada dictado o pago (la misma
 * que queda en el registro). No se pide nada nuevo al iPhone; solo se recuerda de qué dispositivo llegó.
 * Va en `configuracion` (una fila por dispositivo) para no necesitar una migración.
 */
export type UbicacionDispositivo = { lat: number; lon: number; lugar: string | null; en: string };

const PREFIJO = "ubicacion_dispositivo:";
const clave = (dispositivoId: string) => `${PREFIJO}${dispositivoId}`;

function leer(valor: unknown): UbicacionDispositivo | null {
  const v = valor as Partial<UbicacionDispositivo> | null;
  if (!v || typeof v.lat !== "number" || typeof v.lon !== "number" || typeof v.en !== "string") return null;
  return { lat: v.lat, lon: v.lon, lugar: typeof v.lugar === "string" ? v.lugar : null, en: v.en };
}

/** Guarda dónde estaba el dispositivo. Un dictado viejo que la cola reenvía tarde no pisa uno más nuevo. */
export function guardarUbicacion(
  db: Db,
  dispositivoId: string,
  u: { lat?: number; lon?: number; lugar?: string; en?: string },
) {
  if (u.lat === undefined || u.lon === undefined) return;
  const en = u.en ?? new Date().toISOString();
  const previa = leer(db.select().from(configuracion).where(eq(configuracion.clave, clave(dispositivoId))).get()?.valor);
  if (previa && previa.en > en) return;
  const valor: UbicacionDispositivo = { lat: u.lat, lon: u.lon, lugar: u.lugar ?? null, en };
  db.insert(configuracion)
    .values({ clave: clave(dispositivoId), valor })
    .onConflictDoUpdate({ target: configuracion.clave, set: { valor } })
    .run();
}

export function ubicacionesDe(db: Db, dispositivoIds: string[]): Map<string, UbicacionDispositivo> {
  const mapa = new Map<string, UbicacionDispositivo>();
  if (!dispositivoIds.length) return mapa;
  const filas = db
    .select()
    .from(configuracion)
    .where(inArray(configuracion.clave, dispositivoIds.map(clave)))
    .all();
  for (const f of filas) {
    const u = leer(f.valor);
    if (u) mapa.set(f.clave.slice(PREFIJO.length), u);
  }
  return mapa;
}

/** Al quitar un dispositivo se olvida también dónde estuvo. */
export function olvidarUbicacion(db: Db, dispositivoId: string) {
  db.delete(configuracion).where(eq(configuracion.clave, clave(dispositivoId))).run();
}
