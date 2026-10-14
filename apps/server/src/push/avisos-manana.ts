// Manda por push los avisos del revisor nocturno en la mañana, no a la hora en que los genera.
import type { Db } from "../db/client";
import { avisosPorEnviar, marcarEnviados } from "../finanzas/avisos";
import { cobrosHabilitado, cobrosPorConfirmar } from "../finanzas/cobros";
import { crearContexto } from "../finanzas/contexto";
import { fechaLocal } from "../lib/fechas";
import { type EnviarPush, notificar, tieneSuscripciones } from "./notificaciones";
import { enHorario, GRUPO_DE_AVISO, HORARIO_POR_OMISION, preferenciasDe } from "./preferencias";

/** Desde qué hora y hasta cuál (locales) se pueden mandar avisos, si la cuenta no eligió otro horario. */
export const HORARIO_AVISOS = HORARIO_POR_OMISION;

// Si todo falla (sin red, Apple caído), se reintenta unas cuantas veces al día y no cada 5 minutos.
const MAX_INTENTOS_DIA = 3;
const intentos = new Map<string, number>();

/** El revisor guarda enlaces como "#presupuestos"; la notificación abre una ruta de la app. */
const rutaDe = (enlace: string | null) => (!enlace ? "/#inicio" : enlace.startsWith("#") ? `/${enlace}` : enlace);

export function horaLocal(instante: Date, zonaHoraria: string): number {
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
  // Nadie puede pedir avisos de madrugada: antes de las 6 o después de las 23 no se revisa nada.
  if (hora < 6 || hora >= 23) return 0;
  const hoy = fechaLocal(ahora, zonaHoraria);
  for (const clave of intentos.keys()) if (!clave.endsWith(`:${hoy}`)) intentos.delete(clave);
  // Vienen ordenados por prioridad (1 primero): el primero de cada cuenta es el principal.
  const porUsuario = new Map<string, ReturnType<typeof avisosPorEnviar>>();
  for (const a of avisosPorEnviar(db, zonaHoraria, ahora)) {
    porUsuario.set(a.usuarioId, [...(porUsuario.get(a.usuarioId) ?? []), a]);
  }
  let enviadas = 0;
  for (const [usuarioId, todos] of porUsuario) {
    // Su horario y los tipos que quiere (Ajustes › Notificaciones); los que apagó se quedan solo en la app.
    const preferencias = preferenciasDe(db, usuarioId);
    if (!enHorario(preferencias, hora)) continue;
    const pendientes = todos.filter((a) => preferencias.tipos[GRUPO_DE_AVISO[a.tipo]] ?? true);
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
        insignia: insigniaDe(db, usuarioId, zonaHoraria, ahora),
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

/** El número del ícono de la app: los cobros que esperan respuesta. Solo con la confirmación de cobros abierta. */
export function insigniaDe(db: Db, usuarioId: string, zonaHoraria: string, ahora = new Date()): number | undefined {
  if (!cobrosHabilitado(db, usuarioId)) return undefined;
  return cobrosPorConfirmar(crearContexto({ db, usuarioId, zonaHoraria, monedaBase: "MXN", ahora }));
}
