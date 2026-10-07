import { and, eq, gt, lt, sql } from "drizzle-orm";
import { hashToken } from "../auth";
import type { Db } from "../db/client";
import { descargasAtajo } from "../db/schema";

// El enlace del Atajo vive en la base para que un reinicio (una actualización) no lo rompa. El archivo
// lleva el token del dispositivo: se cifra con una clave que sale del id del enlace, que solo conoce
// quien pidió el Atajo, y de ese id solo se guarda el hash.

const clave = async (id: string) =>
  crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`atajo:${id}`)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );

const ahora = () => new Date().toISOString();

/** Borra los enlaces vencidos. */
export function limpiarDescargas(db: Db) {
  db.delete(descargasAtajo).where(lt(descargasAtajo.expiraEn, ahora())).run();
}

/** Guarda el Atajo firmado y devuelve el id del enlace, que no queda en la base. */
export async function guardarDescarga(db: Db, usuarioId: string, archivo: Uint8Array, vigenciaMs: number) {
  limpiarDescargas(db);
  const id = crypto.randomUUID();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await clave(id), archivo as Uint8Array<ArrayBuffer>));
  const expiraEn = new Date(Date.now() + vigenciaMs).toISOString();
  db.insert(descargasAtajo)
    .values({ idHash: hashToken(id), usuarioId, archivo: Buffer.concat([iv, cifrado]), expiraEn })
    .run();
  return { id, expiraEn };
}

/**
 * El Atajo de ese enlace, si sigue vigente. Cada descarga (`contar`) gasta una de las `maximo`; con la
 * última, el enlace se borra. Sin `contar` (un HEAD) solo revisa que exista.
 */
export async function tomarDescarga(db: Db, id: string, maximo: number, contar: boolean): Promise<Uint8Array | undefined> {
  limpiarDescargas(db);
  const idHash = hashToken(id);
  const vigente = and(eq(descargasAtajo.idHash, idHash), gt(descargasAtajo.expiraEn, ahora()), lt(descargasAtajo.descargas, maximo));
  const fila = contar
    ? db
        .update(descargasAtajo)
        .set({ descargas: sql`${descargasAtajo.descargas} + 1` })
        .where(vigente)
        .returning()
        .get()
    : db.select().from(descargasAtajo).where(vigente).get();
  if (!fila) {
    db.delete(descargasAtajo).where(eq(descargasAtajo.idHash, idHash)).run();
    return undefined;
  }
  if (fila.descargas >= maximo) db.delete(descargasAtajo).where(eq(descargasAtajo.idHash, idHash)).run();
  const datos = new Uint8Array(fila.archivo);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: datos.subarray(0, 12) }, await clave(id), datos.subarray(12)));
  } catch {
    return undefined;
  }
}
