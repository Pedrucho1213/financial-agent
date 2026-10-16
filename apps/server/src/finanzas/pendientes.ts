// Lo que quedó esperando al usuario: un pago o un dictado que la IA no pudo anotar, o sobre el que le preguntó
// algo. Se guarda como aviso de tipo "pendiente", uno por conversación, y no se quita con solo verlo: se va
// cuando lo contesta en esa conversación, cuando le pone la cuenta al pago o cuando lo descarta (2026-10-16).
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { avisos, entradas } from "../db/schema";
import { fechaLocal } from "../lib/fechas";

export const clavePendiente = (conversacionId: string) => `pendiente:${conversacionId}`;

/** La ruta de la app que abre el chat en esa conversación. */
export const enlaceDelChat = (conversacionId: string) => `#chat?conversacion=${encodeURIComponent(conversacionId)}`;

type Pendiente = { conversacionId: string; titulo: string; texto: string; zonaHoraria: string };

/**
 * Lo deja (o lo vuelve a dejar) pendiente. Ya salió por notificación: el envío de la mañana no lo repite.
 * Si esa conversación ya tenía uno, se actualiza con lo último y vuelve a aparecer aunque se hubiera visto.
 */
export function guardarPendiente(db: Db, usuarioId: string, p: Pendiente): void {
  const ahora = new Date();
  const datos = {
    titulo: p.titulo.slice(0, 120),
    texto: p.texto.slice(0, 400),
    fecha: fechaLocal(ahora, p.zonaHoraria),
    enlace: enlaceDelChat(p.conversacionId),
    enviadoEn: ahora.toISOString(),
    leidoEn: null,
    descartadoEn: null,
  };
  db.insert(avisos)
    .values({ usuarioId, tipo: "pendiente", clave: clavePendiente(p.conversacionId), prioridad: 1, ...datos })
    .onConflictDoUpdate({ target: [avisos.usuarioId, avisos.clave], set: datos })
    .run();
}

/** Ya lo atendió: se quita de Avisos y de Inicio. Devuelve si había uno. */
export function resolverPendiente(db: Db, usuarioId: string, conversacionId: string): boolean {
  const filas = db
    .update(avisos)
    .set({ descartadoEn: new Date().toISOString() })
    .where(and(eq(avisos.usuarioId, usuarioId), eq(avisos.clave, clavePendiente(conversacionId)), isNull(avisos.descartadoEn)))
    .returning({ id: avisos.id })
    .all();
  return filas.length > 0;
}

/** El pendiente de la conversación de ese dictado o pago (al corregir en la app lo que se preguntaba). */
export function resolverPendienteDeEntrada(db: Db, usuarioId: string, entradaId: string | null | undefined): boolean {
  if (!entradaId) return false;
  const entrada = db
    .select({ conversacionId: entradas.conversacionId })
    .from(entradas)
    .where(and(eq(entradas.id, entradaId), eq(entradas.usuarioId, usuarioId)))
    .get();
  return entrada ? resolverPendiente(db, usuarioId, entrada.conversacionId) : false;
}
