// Manda por push los avisos del revisor nocturno en la mañana, no a la hora en que los genera.
import type { Db } from "../db/client";
import { avisosPorEnviar, marcarEnviados } from "../finanzas/avisos";
import { fechaLocal } from "../lib/fechas";
import { type EnviarPush, notificar, tieneSuscripciones } from "./notificaciones";

/** Desde qué hora y hasta cuál (locales) se pueden mandar avisos. */
export const HORARIO_AVISOS = { desde: 9, hasta: 21 };

// Si todo falla (sin red, Apple caído), se reintenta unas cuantas veces al día y no cada 5 minutos.
const MAX_INTENTOS_DIA = 3;
const intentos = new Map<string, number>();

/** El revisor guarda enlaces como "#presupuestos"; la notificación abre una ruta de la app. */
const rutaDe = (enlace: string | null) => (!enlace ? "/#inicio" : enlace.startsWith("#") ? `/${enlace}` : enlace);

function horaLocal(instante: Date, zonaHoraria: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: zonaHoraria, hour: "numeric", hourCycle: "h23" }).format(instante));
}

/**
 * Para cada cuenta con avisos sin enviar, manda el más importante (y cuántos más hay) en una sola
 * notificación. Los que el Atajo ya dijo o la app ya mostró no salen. Devuelve cuántas notificaciones salieron.
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
  for (const clave of intentos.keys()) if (!clave.endsWith(`:${hoy}`)) intentos.delete(clave);
  // Vienen ordenados por prioridad (1 primero): el primero de cada cuenta es el principal.
  const porUsuario = new Map<string, ReturnType<typeof avisosPorEnviar>>();
  for (const a of avisosPorEnviar(db, zonaHoraria, ahora)) {
    porUsuario.set(a.usuarioId, [...(porUsuario.get(a.usuarioId) ?? []), a]);
  }
  let enviadas = 0;
  for (const [usuarioId, pendientes] of porUsuario) {
    const [principal] = pendientes;
    // Sin notificaciones activas se esperan: si las activa más tarde, todavía le llegan.
    if (!principal || !tieneSuscripciones(db, usuarioId)) continue;
    const clave = `${usuarioId}:${hoy}`;
    const fallidos = intentos.get(clave) ?? 0;
    if (fallidos >= MAX_INTENTOS_DIA) continue;
    const mas = pendientes.length - 1;
    const llegaron = await notificar(
      db,
      usuarioId,
      {
        titulo: principal.titulo,
        cuerpo: mas > 0 ? `${principal.texto} Y ${mas === 1 ? "un aviso más" : `${mas} avisos más`} en la app.` : principal.texto,
        url: rutaDe(principal.enlace),
        etiqueta: `avisos-${hoy}`,
        ttl: 12 * 3600,
      },
      enviar,
    );
    if (llegaron > 0) {
      marcarEnviados(db, pendientes.map((a) => a.id));
      enviadas++;
    } else {
      intentos.set(clave, fallidos + 1);
    }
  }
  return enviadas;
}
