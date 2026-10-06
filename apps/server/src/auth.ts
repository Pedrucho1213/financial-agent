import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Db } from "./db/client";
import { dispositivos, usuarios } from "./db/schema";

export type VariablesAuth = { usuarioId: string; dispositivoId: string };

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** Token secreto por dispositivo. Solo se guarda su hash. */
export function generarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `fa_${Buffer.from(bytes).toString("base64url")}`;
}

export function crearDispositivo(db: Db, usuarioId: string, nombre: string) {
  const token = generarToken();
  db.insert(dispositivos).values({ usuarioId, nombre, tokenHash: hashToken(token) }).run();
  return token;
}

export function crearUsuario(db: Db, nombre: string) {
  return db.insert(usuarios).values({ nombre }).returning().get();
}

export const requiereToken = (db: Db) =>
  createMiddleware<{ Variables: VariablesAuth }>(async (c, next) => {
    const encabezado = c.req.header("authorization") ?? "";
    const token = encabezado.startsWith("Bearer ") ? encabezado.slice(7).trim() : "";
    const dispositivo = token
      ? db
          .select()
          .from(dispositivos)
          .where(and(eq(dispositivos.tokenHash, hashToken(token)), isNull(dispositivos.revocadoEn)))
          .get()
      : undefined;
    if (!dispositivo) return c.json({ error: "Token inválido o revocado." }, 401);
    db.update(dispositivos)
      .set({ ultimoUso: new Date().toISOString() })
      .where(eq(dispositivos.id, dispositivo.id))
      .run();
    c.set("usuarioId", dispositivo.usuarioId);
    c.set("dispositivoId", dispositivo.id);
    await next();
  });
