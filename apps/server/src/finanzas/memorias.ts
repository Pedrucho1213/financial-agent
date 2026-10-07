import { and, asc, eq, inArray } from "drizzle-orm";
import { memorias } from "../db/schema";
import { normalizar } from "../lib/texto";
import type { Contexto } from "./contexto";
import { ErrorFinanzas } from "./movimientos";

// Lo que se recuerda va completo en las instrucciones de cada dictado: pocas cosas y cortas.
export const MAX_MEMORIAS = 50;
export const MAX_LARGO_MEMORIA = 200;

// Palabras que no sirven para encontrar qué olvidar: "olvida lo del Oxxo" busca "oxxo".
const VACIAS = new Set("que de del la el los las lo un una en con y mi mis por para al eso esto sobre".split(" "));

export function listarMemorias(ctx: Contexto) {
  return ctx.db
    .select({ id: memorias.id, texto: memorias.texto })
    .from(memorias)
    .where(eq(memorias.usuarioId, ctx.usuarioId))
    .orderBy(asc(memorias.creadoEn))
    .all();
}

/** "Recuerda que el Oxxo lo pago en efectivo": queda en las instrucciones de la IA. */
export function recordar(ctx: Contexto, texto: string) {
  const limpio = texto.trim().replace(/\s+/g, " ");
  if (!limpio) throw new ErrorFinanzas("No dijiste qué recordar.");
  if (limpio.length > MAX_LARGO_MEMORIA) throw new ErrorFinanzas(`Resúmelo en menos de ${MAX_LARGO_MEMORIA} letras.`);
  const existentes = listarMemorias(ctx);
  if (existentes.some((m) => normalizar(m.texto) === normalizar(limpio))) return { recordado: limpio, ya_lo_sabia: true };
  if (existentes.length >= MAX_MEMORIAS) {
    throw new ErrorFinanzas(`Ya recuerdo ${MAX_MEMORIAS} cosas; pide al usuario que te diga cuál olvidar.`);
  }
  ctx.db.insert(memorias).values({ usuarioId: ctx.usuarioId, texto: limpio }).run();
  return { recordado: limpio };
}

/** "Olvida lo del Oxxo": borra lo recordado que tenga esas palabras. Con `todas`, aunque sean varias. */
export function olvidar(ctx: Contexto, buscar: string, todas = false) {
  const palabras = normalizar(buscar)
    .split(" ")
    .filter((p) => p.length > 1 && !VACIAS.has(p));
  const existentes = listarMemorias(ctx);
  const coinciden = palabras.length ? existentes.filter((m) => palabras.every((p) => normalizar(m.texto).includes(p))) : [];
  if (coinciden.length === 0) {
    const lista = existentes.map((m) => m.texto).join("; ") || "nada";
    throw new ErrorFinanzas(`No recuerdo nada sobre "${buscar}". Lo que recuerdo: ${lista}.`);
  }
  if (coinciden.length > 1 && !todas) {
    throw new ErrorFinanzas(`Coinciden varias: ${coinciden.map((m) => m.texto).join("; ")}. Pregunta cuál, o usa todas si pidió olvidarlas todas.`);
  }
  ctx.db
    .delete(memorias)
    .where(and(eq(memorias.usuarioId, ctx.usuarioId), inArray(memorias.id, coinciden.map((m) => m.id))))
    .run();
  return { olvidado: coinciden.map((m) => m.texto) };
}
