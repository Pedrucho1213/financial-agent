// Suscripciones de cada dispositivo y envío de notificaciones a todos los de una cuenta.
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { configuracion, dispositivos, suscripcionesPush } from "../db/schema";
import { type ClavesVapid, endpointValido, enviarPush, generarClavesVapid, MAX_MENSAJE, type OpcionesEnvio, type ResultadoEnvio, type Suscripcion } from "./webpush";

/** Lo que muestra el iPhone. `url` es la ruta de la app que se abre al tocarla. */
export type Notificacion = {
  titulo: string;
  cuerpo: string;
  url?: string;
  /** Una notificación nueva con la misma etiqueta reemplaza a la anterior en el centro de notificaciones. */
  etiqueta?: string;
  urgencia?: OpcionesEnvio["urgencia"];
  /** Cuánto guarda Apple la notificación si el iPhone está apagado (segundos). */
  ttl?: number;
};

export type EnviarPush = (
  suscripcion: Suscripcion,
  mensaje: string,
  claves: ClavesVapid,
  contacto: string,
  opciones?: OpcionesEnvio,
) => Promise<ResultadoEnvio>;

const CLAVE_VAPID = "vapid";

/** Las llaves VAPID del servidor; se crean la primera vez. Cambiarlas invalidaría todas las suscripciones. */
export function clavesVapid(db: Db): ClavesVapid {
  const guardadas = db.select().from(configuracion).where(eq(configuracion.clave, CLAVE_VAPID)).get();
  if (guardadas) return guardadas.valor as ClavesVapid;
  const nuevas = generarClavesVapid();
  // Si dos peticiones llegan a la vez, gana la primera que se guardó.
  db.insert(configuracion).values({ clave: CLAVE_VAPID, valor: nuevas }).onConflictDoNothing().run();
  return db.select().from(configuracion).where(eq(configuracion.clave, CLAVE_VAPID)).get()!.valor as ClavesVapid;
}

export class ErrorSuscripcion extends Error {}

/** Guarda (o actualiza) la suscripción de este dispositivo. Un dispositivo tiene a lo más una. */
export function suscribir(db: Db, usuarioId: string, dispositivoId: string, datos: Suscripcion & { contacto: string }) {
  if (!endpointValido(datos.endpoint)) throw new ErrorSuscripcion("Ese servicio de notificaciones no está permitido.");
  db.transaction((tx) => {
    tx.delete(suscripcionesPush).where(eq(suscripcionesPush.dispositivoId, dispositivoId)).run();
    tx.delete(suscripcionesPush).where(eq(suscripcionesPush.endpoint, datos.endpoint)).run();
    tx.insert(suscripcionesPush)
      .values({ usuarioId, dispositivoId, endpoint: datos.endpoint, p256dh: datos.p256dh, auth: datos.auth, contacto: datos.contacto })
      .run();
  });
}

export function desuscribir(db: Db, dispositivoId: string) {
  db.delete(suscripcionesPush).where(eq(suscripcionesPush.dispositivoId, dispositivoId)).run();
}

/** Suscripciones vigentes de la cuenta: las de dispositivos revocados no cuentan. */
function suscripcionesDe(db: Db, usuarioId: string) {
  return db
    .select({ s: suscripcionesPush })
    .from(suscripcionesPush)
    .innerJoin(dispositivos, eq(dispositivos.id, suscripcionesPush.dispositivoId))
    .where(and(eq(suscripcionesPush.usuarioId, usuarioId), isNull(dispositivos.revocadoEn)))
    .all()
    .map((f) => f.s);
}

export function tieneSuscripciones(db: Db, usuarioId: string): boolean {
  return suscripcionesDe(db, usuarioId).length > 0;
}

/**
 * Si algún dispositivo de la cuenta recibe notificaciones: el Atajo puede contestar corto y avisar por ahí.
 * Una suscripción cuyo último envío falló no cuenta, para que el Atajo vuelva a contestar en voz; se le
 * sigue mandando todo y en cuanto una llega, vuelve a contar.
 */
export function tienePush(db: Db, usuarioId: string): boolean {
  return suscripcionesDe(db, usuarioId).some((s) => !s.ultimoError);
}

/** Estado para la app: si este dispositivo está suscrito y la llave para suscribirse. */
export function estadoPush(db: Db, usuarioId: string, dispositivoId: string) {
  const propias = suscripcionesDe(db, usuarioId);
  const esta = propias.find((s) => s.dispositivoId === dispositivoId);
  return {
    clave: clavesVapid(db).publica,
    activo: !!esta,
    endpoint: esta?.endpoint ?? null,
    otros: propias.filter((s) => s.dispositivoId !== dispositivoId).length,
    ultimoError: esta?.ultimoError ?? null,
  };
}

/** Corta un texto para que el mensaje quepa en una notificación. */
function recortar(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1).trimEnd()}…`;
}

export function mensajeDe(n: Notificacion): string {
  const datos = { titulo: recortar(n.titulo, 120), cuerpo: recortar(n.cuerpo, 600), url: n.url ?? "/", etiqueta: n.etiqueta };
  const json = JSON.stringify(datos);
  // Muy improbable con estos recortes, pero el cifrado no acepta más.
  return new TextEncoder().encode(json).length <= MAX_MENSAJE ? json : JSON.stringify({ ...datos, cuerpo: recortar(n.cuerpo, 200) });
}

/**
 * Manda la notificación a todos los dispositivos de la cuenta y olvida los que ya no existen.
 * Devuelve a cuántos llegó. No lanza.
 */
export async function notificar(db: Db, usuarioId: string, n: Notificacion, enviar: EnviarPush = enviarPush): Promise<number> {
  const lista = suscripcionesDe(db, usuarioId);
  if (!lista.length) return 0;
  const claves = clavesVapid(db);
  const mensaje = mensajeDe(n);
  const resultados = await Promise.all(
    lista.map(async (s) => {
      const r = await enviar(s, mensaje, claves, s.contacto, { urgencia: n.urgencia, ttl: n.ttl, tema: n.etiqueta }).catch(
        (error: Error): ResultadoEnvio => ({ ok: false, estado: 0, vencida: false, detalle: error.message }),
      );
      if (r.vencida) {
        db.delete(suscripcionesPush).where(eq(suscripcionesPush.id, s.id)).run();
      } else {
        const error = r.ok ? null : `${r.estado} ${r.detalle ?? ""}`.trim();
        db.update(suscripcionesPush)
          .set({ ultimoEnvio: new Date().toISOString(), ultimoError: error })
          .where(eq(suscripcionesPush.id, s.id))
          .run();
        if (!r.ok) console.error(`Push a ${new URL(s.endpoint).host} falló: ${error}`);
      }
      return r.ok;
    }),
  );
  return resultados.filter(Boolean).length;
}
