import type { Db } from "../db/client";
import { fechaLocal } from "../lib/fechas";

/** Todo lo que una operación necesita saber de quién habla, cuándo y dónde. */
export type Contexto = {
  db: Db;
  usuarioId: string;
  zonaHoraria: string;
  monedaBase: string;
  /** Fecha local de hoy (YYYY-MM-DD). */
  hoy: string;
  /** Momento en que se dictó, en UTC. */
  ahoraIso: string;
  entradaId?: string;
  textoOriginal?: string;
  ubicacion?: { lat?: number; lon?: number; lugar?: string };
};

export function crearContexto(
  datos: Omit<Contexto, "hoy" | "ahoraIso"> & { ahora?: Date },
): Contexto {
  const ahora = datos.ahora ?? new Date();
  const { ahora: _, ...resto } = datos;
  return { ...resto, hoy: fechaLocal(ahora, datos.zonaHoraria), ahoraIso: ahora.toISOString() };
}
