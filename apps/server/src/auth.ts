import { and, eq, gte, isNull, ne } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Db } from "./db/client";
import { dispositivos, invitaciones, usuarios } from "./db/schema";
import { sembrarCategorias } from "./finanzas/catalogos";

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
  return crearDispositivoConId(db, usuarioId, nombre).token;
}

function crearDispositivoConId(db: Db, usuarioId: string, nombre: string) {
  const token = generarToken();
  const fila = db.insert(dispositivos).values({ usuarioId, nombre, tokenHash: hashToken(token) }).returning().get();
  return { token, dispositivo: fila };
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
    if (!dispositivo) {
      // El Atajo conserva sus dictados pendientes (reintentar) y lee la respuesta en voz alta.
      return c.json(
        {
          error: "Token inválido o revocado.",
          respuesta: "Este Atajo ya no tiene acceso. Vuelve a instalarlo desde la app.",
          reintentar: true,
        },
        401,
      );
    }
    db.update(dispositivos)
      .set({ ultimoUso: new Date().toISOString() })
      .where(eq(dispositivos.id, dispositivo.id))
      .run();
    c.set("usuarioId", dispositivo.usuarioId);
    c.set("dispositivoId", dispositivo.id);
    await next();
  });

// Sin letras ni números que se confundan al dictarlos o leerlos (0/O, 1/I/L).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const HORAS_INVITACION = 24;

export class ErrorInvitacion extends Error {
  constructor(
    message: string,
    readonly estado: 400 | 404 | 410,
  ) {
    super(message);
  }
}

function generarCodigo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ALFABETO[b % ALFABETO.length]).join("");
}

export const normalizarCodigo = (codigo: string) => codigo.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Código para entrar desde otro dispositivo. Con `usuarioId`, el dispositivo se suma a esa cuenta. */
export function crearInvitacion(db: Db, opciones: { usuarioId?: string; creadaPor?: string; horas?: number } = {}) {
  const expiraEn = new Date(Date.now() + (opciones.horas ?? HORAS_INVITACION) * 3_600_000).toISOString();
  for (;;) {
    const codigo = generarCodigo();
    const existe = db.select().from(invitaciones).where(eq(invitaciones.codigo, codigo)).get();
    if (existe) continue;
    db.insert(invitaciones)
      .values({ codigo, usuarioId: opciones.usuarioId, creadaPor: opciones.creadaPor, expiraEn })
      .run();
    return { codigo, para: opciones.usuarioId ? ("dispositivo" as const) : ("usuario" as const), expiraEn };
  }
}

function invitacionVigente(db: Db, codigo: string) {
  const fila = db.select().from(invitaciones).where(eq(invitaciones.codigo, normalizarCodigo(codigo))).get();
  if (!fila) throw new ErrorInvitacion("Ese código no existe. Revísalo o pide uno nuevo.", 404);
  if (fila.usadaEn) throw new ErrorInvitacion("Ese código ya se usó. Pide uno nuevo.", 410);
  if (fila.expiraEn < new Date().toISOString()) throw new ErrorInvitacion("Ese código ya venció. Pide uno nuevo.", 410);
  return fila;
}

/** Para qué es un código, sin usarlo: la app pregunta el nombre solo si es una cuenta nueva. */
export function consultarInvitacion(db: Db, codigo: string) {
  const fila = invitacionVigente(db, codigo);
  if (!fila.usuarioId) return { para: "usuario" as const };
  const usuario = db.select().from(usuarios).where(eq(usuarios.id, fila.usuarioId)).get();
  return { para: "dispositivo" as const, nombre: usuario?.nombre };
}

/**
 * Usa el código: crea la cuenta (si es nueva) y el dispositivo, y devuelve su token.
 * Con `soloCuentaExistente` (el Atajo) un código de cuenta nueva no sirve.
 */
export function canjearInvitacion(
  db: Db,
  datos: { codigo: string; nombre?: string; dispositivo: string; soloCuentaExistente?: boolean },
) {
  return db.transaction((tx) => {
    const fila = invitacionVigente(tx as unknown as Db, datos.codigo);
    if (datos.soloCuentaExistente && !fila.usuarioId) {
      throw new ErrorInvitacion("Este código es para crear una cuenta. Ábrelo en la app.", 400);
    }
    let usuario = fila.usuarioId ? tx.select().from(usuarios).where(eq(usuarios.id, fila.usuarioId)).get() : undefined;
    if (!usuario) {
      const nombre = datos.nombre?.trim();
      if (!nombre) throw new ErrorInvitacion("Escribe tu nombre.", 400);
      usuario = crearUsuario(tx as unknown as Db, nombre);
      sembrarCategorias(tx as unknown as Db, usuario.id);
    }
    const { token, dispositivo } = crearDispositivoConId(tx as unknown as Db, usuario.id, datos.dispositivo.trim() || "Dispositivo");
    tx.update(invitaciones)
      .set({ usadaEn: new Date().toISOString(), dispositivoId: dispositivo.id })
      .where(eq(invitaciones.id, fila.id))
      .run();
    return {
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre },
      dispositivo: { id: dispositivo.id, nombre: dispositivo.nombre },
    };
  });
}

/**
 * Al preparar un Atajo nuevo, los que se prepararon hace poco y nunca se usaron sobran (instalaciones que
 * no terminaron). Solo los de la última media hora: uno más viejo puede estar instalado en otro iPhone.
 */
export function revocarAtajosSinUsar(db: Db, usuarioId: string, nombre: string, excepto: string) {
  const desde = new Date(Date.now() - 30 * 60_000).toISOString();
  db.update(dispositivos)
    .set({ revocadoEn: new Date().toISOString() })
    .where(
      and(
        eq(dispositivos.usuarioId, usuarioId),
        eq(dispositivos.nombre, nombre),
        isNull(dispositivos.ultimoUso),
        isNull(dispositivos.revocadoEn),
        gte(dispositivos.creadoEn, desde),
        ne(dispositivos.id, excepto),
      ),
    )
    .run();
}

/** Deshace un canje que no llegó a nada (la Mac no pudo firmar el Atajo): el código vuelve a servir. */
export function devolverInvitacion(db: Db, codigo: string, dispositivoId: string) {
  db.transaction((tx) => {
    tx.update(dispositivos).set({ revocadoEn: new Date().toISOString() }).where(eq(dispositivos.id, dispositivoId)).run();
    tx.update(invitaciones)
      .set({ usadaEn: null, dispositivoId: null })
      .where(and(eq(invitaciones.codigo, normalizarCodigo(codigo)), eq(invitaciones.dispositivoId, dispositivoId)))
      .run();
  });
}

export function listarDispositivos(db: Db, usuarioId: string) {
  return db
    .select()
    .from(dispositivos)
    .where(and(eq(dispositivos.usuarioId, usuarioId), isNull(dispositivos.revocadoEn)))
    .all();
}

/** Revoca un dispositivo propio; su token deja de servir de inmediato. */
export function revocarDispositivo(db: Db, usuarioId: string, dispositivoId: string): boolean {
  const fila = db
    .update(dispositivos)
    .set({ revocadoEn: new Date().toISOString() })
    .where(and(eq(dispositivos.id, dispositivoId), eq(dispositivos.usuarioId, usuarioId), isNull(dispositivos.revocadoEn)))
    .returning()
    .get();
  return !!fila;
}

/** Dispositivo nuevo para la misma cuenta, por ejemplo el Atajo que se instala desde la app. */
export function crearDispositivoPara(db: Db, usuarioId: string, nombre: string) {
  return crearDispositivoConId(db, usuarioId, nombre);
}
