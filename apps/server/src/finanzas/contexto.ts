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
  /**
   * Si la frase contesta una pregunta ("¿cuál café?" → "el de ahorita") o la corrección ya eligió el más
   * reciente, `mas_reciente` se respeta aunque la frase no diga "el último".
   */
  confiarEnMasReciente?: boolean;
  /** Hay mensajes anteriores en esta conversación: el modelo puede traer datos de turnos pasados. */
  enConversacion?: boolean;
  /** De dónde salen los movimientos que se registren (un dictado o un pago con Apple Pay). */
  origen?: "voz" | "apple_pay";
};

export function crearContexto(
  datos: Omit<Contexto, "hoy" | "ahoraIso"> & { ahora?: Date },
): Contexto {
  const ahora = datos.ahora ?? new Date();
  const { ahora: _, ...resto } = datos;
  return { ...resto, hoy: fechaLocal(ahora, datos.zonaHoraria), ahoraIso: ahora.toISOString() };
}
