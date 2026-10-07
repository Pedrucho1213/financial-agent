// Manda por push los avisos del día en la mañana, no a la hora en que los genera el revisor nocturno.
import { isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { avisos } from "../db/schema";
import { avisosPorNotificar, marcarNotificado } from "../finanzas/avisos";
import { fechaLocal } from "../lib/fechas";
import { type EnviarPush, notificar, tienePush } from "./notificaciones";

/** Desde qué hora y hasta cuál (locales) se pueden mandar avisos. */
export const HORARIO_AVISOS = { desde: 9, hasta: 21 };

function horaLocal(instante: Date, zonaHoraria: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: zonaHoraria, hour: "numeric", hourCycle: "h23" }).format(instante));
}

/**
 * Para cada cuenta con avisos de hoy sin notificar, manda el más importante (y cuántos más hay).
 * Los de días pasados ya no se mandan: se marcan para no volver a revisarlos. Devuelve cuántas notificaciones salieron.
 */
export async function enviarAvisosDelDia(
  db: Db,
  zonaHoraria: string,
  ahora = new Date(),
  enviar?: EnviarPush,
): Promise<number> {
  const hora = horaLocal(ahora, zonaHoraria);
  if (hora < HORARIO_AVISOS.desde || hora >= HORARIO_AVISOS.hasta) return 0;
  const hoy = fechaLocal(ahora, zonaHoraria);
  const usuarios = new Set(
    db.select({ usuarioId: avisos.usuarioId }).from(avisos).where(isNull(avisos.notificadoEn)).all().map((f) => f.usuarioId),
  );
  let enviadas = 0;
  for (const usuarioId of usuarios) {
    const pendientes = avisosPorNotificar(db, usuarioId, hoy);
    const viejos = pendientes.filter((a) => a.fecha < hoy);
    if (viejos.length) marcarNotificado(db, viejos.map((a) => a.id));
    const deHoy = pendientes.filter((a) => a.fecha === hoy);
    const [principal] = deHoy;
    // Sin notificaciones activas se esperan: si las activa más tarde, todavía le llegan hoy.
    if (!principal || !tienePush(db, usuarioId)) continue;
    const mas = deHoy.length - 1;
    const llegaron = await notificar(
      db,
      usuarioId,
      {
        titulo: principal.titulo,
        cuerpo: mas > 0 ? `${principal.texto} Y ${mas === 1 ? "un aviso más" : `${mas} avisos más`} en la app.` : principal.texto,
        url: principal.url ?? "/#inicio",
        etiqueta: `avisos-${hoy}`,
        ttl: 12 * 3600,
      },
      enviar,
    );
    if (llegaron > 0) {
      marcarNotificado(db, deHoy.map((a) => a.id));
      enviadas++;
    }
  }
  return enviadas;
}
