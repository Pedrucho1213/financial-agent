import { generateText, isStepCount, type LanguageModel, type ModelMessage } from "ai";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { entradas, mensajes } from "../db/schema";
import { crearContexto } from "../finanzas/contexto";
import { revertirEntrada } from "../finanzas/movimientos";
import { construirInstrucciones } from "./instrucciones";
import { crearHerramientas, type Accion } from "./herramientas";

export type Peticion = {
  texto: string;
  /** Lo genera el iPhone; si el mismo dictado llega dos veces, se responde lo mismo sin repetir nada. */
  clientId: string;
  conversacionId?: string;
  lat?: number;
  lon?: number;
  lugar?: string;
  /** Cuándo se dictó (ISO). Importa cuando el dictado esperó en la cola sin conexión. */
  capturadoEn?: string;
};

export type Respuesta = {
  respuesta: string;
  conversacion_id: string;
  acciones: Accion[];
  duplicado?: boolean;
};

export type Dependencias = {
  db: Db;
  modelo: LanguageModel;
  zonaHoraria: string;
  monedaBase: string;
};

export class ErrorIA extends Error {}
/** El mismo dictado ya se está procesando (la cola lo reenvió antes de que terminara). */
export class ErrorEnProceso extends Error {}

// Una conversación se retoma si su último mensaje tiene menos de 30 minutos.
const VIGENCIA_CONVERSACION_MS = 30 * 60_000;
const MAX_MENSAJES_HISTORIAL = 24;

function cargarHistorial(db: Db, usuarioId: string, conversacionId: string): ModelMessage[] {
  const desde = new Date(Date.now() - VIGENCIA_CONVERSACION_MS).toISOString();
  const filas = db
    .select()
    .from(mensajes)
    .where(
      and(eq(mensajes.usuarioId, usuarioId), eq(mensajes.conversacionId, conversacionId), gte(mensajes.creadoEn, desde)),
    )
    .orderBy(asc(mensajes.creadoEn), asc(sql`rowid`))
    .all()
    .map((m) => m.contenido as ModelMessage);
  const recientes = filas.slice(-MAX_MENSAJES_HISTORIAL);
  // No empezar a media llamada de herramienta: el historial arranca en un mensaje del usuario.
  const inicio = recientes.findIndex((m) => m.role === "user");
  return inicio === -1 ? [] : recientes.slice(inicio);
}

/** Respuesta hablada cuando el modelo no dejó texto final. */
function respuestaPorOmision(acciones: Accion[]): string {
  return acciones.length ? "Listo." : "No entendí, ¿me lo repites?";
}

function limpiarParaVoz(texto: string): string {
  return texto
    .replace(/\*\*?|__|`|#+\s/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function hablar(deps: Dependencias, usuarioId: string, peticion: Peticion): Promise<Respuesta> {
  const { db } = deps;
  const previa = db
    .select()
    .from(entradas)
    .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.clientId, peticion.clientId)))
    .get();
  if (previa?.estado === "listo" && previa.respuesta) {
    return { ...(previa.respuesta as Respuesta), duplicado: true };
  }
  if (previa?.estado === "procesando" && Date.now() - Date.parse(previa.creadoEn) < 2 * 60_000) {
    throw new ErrorEnProceso("Ese dictado todavía se está procesando.");
  }

  const ahora = peticion.capturadoEn ? new Date(peticion.capturadoEn) : new Date();
  const conversacionId = peticion.conversacionId ?? previa?.conversacionId ?? crypto.randomUUID();
  const entrada =
    previa ??
    db
      .insert(entradas)
      .values({
        usuarioId,
        clientId: peticion.clientId,
        conversacionId,
        texto: peticion.texto,
        lat: peticion.lat,
        lon: peticion.lon,
        lugar: peticion.lugar,
        capturadoEn: ahora.toISOString(),
      })
      .returning()
      .get();

  const ctx = crearContexto({
    db,
    usuarioId,
    zonaHoraria: deps.zonaHoraria,
    monedaBase: deps.monedaBase,
    entradaId: entrada.id,
    textoOriginal: peticion.texto,
    ubicacion: { lat: peticion.lat, lon: peticion.lon, lugar: peticion.lugar },
    ahora,
  });
  // Un intento anterior que falló a medias no debe dejar registros duplicados.
  if (previa) revertirEntrada(ctx, entrada.id);

  const acciones: Accion[] = [];
  const mensajeUsuario: ModelMessage = { role: "user", content: peticion.texto };
  let texto: string;
  let mensajesRespuesta: ModelMessage[];
  try {
    const resultado = await generateText({
      model: deps.modelo,
      instructions: construirInstrucciones(ctx),
      messages: [...cargarHistorial(db, usuarioId, conversacionId), mensajeUsuario],
      tools: crearHerramientas(ctx, acciones),
      stopWhen: isStepCount(6),
      temperature: 0.2,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(90_000),
    });
    texto = resultado.text;
    mensajesRespuesta = resultado.response.messages;
  } catch (error) {
    revertirEntrada(ctx, entrada.id);
    db.update(entradas).set({ estado: "error" }).where(eq(entradas.id, entrada.id)).run();
    throw new ErrorIA(error instanceof Error ? error.message : String(error));
  }

  const respuesta: Respuesta = {
    respuesta: limpiarParaVoz(texto) || respuestaPorOmision(acciones),
    conversacion_id: conversacionId,
    acciones,
  };
  db.transaction((tx) => {
    for (const contenido of [mensajeUsuario, ...mensajesRespuesta]) {
      tx.insert(mensajes).values({ usuarioId, conversacionId, contenido }).run();
    }
    tx.update(entradas).set({ estado: "listo", respuesta }).where(eq(entradas.id, entrada.id)).run();
  });
  return respuesta;
}
