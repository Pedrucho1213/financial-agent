import { generateText, isStepCount, type LanguageModel, type ModelMessage } from "ai";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
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
  /** La Mac sigue procesando; la respuesta final se consulta en /v1/entradas/:client_id. */
  pendiente?: boolean;
  /** Con pendiente: era una pregunta y vale la pena esperar la respuesta en /v1/entradas/:client_id. */
  esperar?: boolean;
};

export type Dependencias = {
  db: Db;
  modelo: LanguageModel;
  zonaHoraria: string;
  monedaBase: string;
  /** Pausas entre reintentos de un dictado que falló en segundo plano. */
  reintentosMs?: number[];
};

export type OpcionesHablar = {
  /** Cuánto esperar antes de contestar "pendiente" y seguir en segundo plano. Sin valor, espera todo. */
  esperaMs?: number;
  /** Si es una pregunta, la respuesta "pendiente" invita a esperar en vez de decir "anotado". */
  esPregunta?: boolean;
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

// La IA corre en una sola Mac: los dictados se procesan de uno en uno y en orden de llegada.
// Así "deshaz eso" siempre va después de lo que deshace y nunca hay dos modelos cargados a la vez.
let cola: Promise<unknown> = Promise.resolve();
function enCola<T>(trabajo: () => Promise<T>): Promise<T> {
  const resultado = cola.then(trabajo, trabajo);
  cola = resultado.catch(() => {});
  return resultado;
}

/** Dictados que ya están en la cola, por id de entrada, para no procesar dos veces el mismo. */
const enCurso = new Map<string, Promise<Respuesta>>();

// Si la IA falla después de haber contestado "pendiente", la Mac reintenta sola.
const REINTENTOS_MS = [30_000, 120_000, 600_000];

const RESPUESTA_PENDIENTE = "Anotado. Lo termino de procesar en un momento.";
const RESPUESTA_PENDIENTE_PREGUNTA = "Dame un momento más, sigo revisando tus cuentas.";

/** Espera la promesa hasta `ms`; si no terminó, devuelve "tiempo" sin cancelarla. */
async function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T | "tiempo"> {
  let espera: ReturnType<typeof setTimeout> | undefined;
  const tiempo = new Promise<"tiempo">((listo) => {
    espera = setTimeout(() => listo("tiempo"), ms);
  });
  try {
    return await Promise.race([promesa, tiempo]);
  } finally {
    clearTimeout(espera);
  }
}

export async function hablar(
  deps: Dependencias,
  usuarioId: string,
  peticion: Peticion,
  opciones: OpcionesHablar = {},
): Promise<Respuesta> {
  const { db } = deps;
  // De aquí al insert no hay await: dos peticiones con el mismo client_id no pueden cruzarse.
  const previa = db
    .select()
    .from(entradas)
    .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.clientId, peticion.clientId)))
    .get();
  if (previa?.estado === "listo" && previa.respuesta) {
    return { ...(previa.respuesta as Respuesta), duplicado: true };
  }
  const existente = previa && enCurso.get(previa.id);
  if (!existente && previa?.estado === "procesando" && Date.now() - Date.parse(previa.creadoEn) < 2 * 60_000) {
    throw new ErrorEnProceso("Ese dictado todavía se está procesando.");
  }

  const entrada =
    previa ??
    db
      .insert(entradas)
      .values({
        usuarioId,
        clientId: peticion.clientId,
        conversacionId: peticion.conversacionId ?? crypto.randomUUID(),
        texto: peticion.texto,
        lat: peticion.lat,
        lon: peticion.lon,
        lugar: peticion.lugar,
        capturadoEn: (peticion.capturadoEn ? new Date(peticion.capturadoEn) : new Date()).toISOString(),
      })
      .returning()
      .get();
  if (previa && !existente) db.update(entradas).set({ estado: "procesando" }).where(eq(entradas.id, previa.id)).run();
  const trabajo = existente ?? encolar(deps, entrada);
  if (opciones.esperaMs === undefined) return trabajo;

  const resultado = await conLimite(trabajo, opciones.esperaMs);
  if (resultado !== "tiempo") return resultado;
  // Tardó más de lo que el iPhone espera: la Mac se queda con el dictado y lo termina sola.
  enSegundoPlano.add(entrada.id);
  return opciones.esPregunta
    ? { respuesta: RESPUESTA_PENDIENTE_PREGUNTA, conversacion_id: entrada.conversacionId, acciones: [], pendiente: true, esperar: true }
    : { respuesta: RESPUESTA_PENDIENTE, conversacion_id: entrada.conversacionId, acciones: [], pendiente: true };
}

type Entrada = typeof entradas.$inferSelect;

/** Dictados que nadie está esperando: si fallan, la Mac los reintenta sola más tarde. */
const enSegundoPlano = new Set<string>();

function encolar(deps: Dependencias, entrada: Entrada, intento = 0): Promise<Respuesta> {
  const trabajo = enCola(() => procesar(deps, entrada));
  enCurso.set(entrada.id, trabajo);
  trabajo.then(
    () => {
      enCurso.delete(entrada.id);
      enSegundoPlano.delete(entrada.id);
    },
    () => {
      enCurso.delete(entrada.id);
      if (!enSegundoPlano.has(entrada.id)) return;
      const pausa = (deps.reintentosMs ?? REINTENTOS_MS)[intento];
      if (pausa === undefined) {
        enSegundoPlano.delete(entrada.id);
        return;
      }
      setTimeout(() => {
        const actual = deps.db.select().from(entradas).where(eq(entradas.id, entrada.id)).get();
        if (actual?.estado === "error") {
          deps.db.update(entradas).set({ estado: "procesando" }).where(eq(entradas.id, entrada.id)).run();
          encolar(deps, actual, intento + 1);
        }
      }, pausa).unref?.();
    },
  );
  return trabajo;
}

/**
 * Al arrancar, retoma lo que quedó a medias por un reinicio o un fallo de la IA en las últimas 24 horas.
 * Devuelve cuántos dictados volvió a poner en la cola.
 */
export function reanudarPendientes(deps: Dependencias): number {
  const desde = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const pendientes = deps.db
    .select()
    .from(entradas)
    .where(and(inArray(entradas.estado, ["procesando", "error"]), gte(entradas.creadoEn, desde)))
    .orderBy(asc(entradas.creadoEn))
    .all()
    .filter((e) => !enCurso.has(e.id));
  for (const e of pendientes) {
    deps.db.update(entradas).set({ estado: "procesando" }).where(eq(entradas.id, e.id)).run();
    encolar(deps, e);
    enSegundoPlano.add(e.id);
  }
  return pendientes.length;
}

export type EstadoEntrada = { estado: Entrada["estado"] } & Partial<Respuesta>;

/**
 * Estado de un dictado para el Atajo o la app: si ya terminó, su respuesta.
 * Con `esperaMs`, si sigue en la cola espera hasta ese tiempo a que termine.
 */
export async function consultarEntrada(
  db: Db,
  usuarioId: string,
  clientId: string,
  esperaMs = 0,
): Promise<EstadoEntrada | undefined> {
  const buscar = () =>
    db
      .select()
      .from(entradas)
      .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.clientId, clientId)))
      .get();
  const inicial = buscar();
  if (!inicial) return undefined;
  const trabajo = enCurso.get(inicial.id);
  if (trabajo && esperaMs > 0) await conLimite(trabajo.catch(() => undefined), esperaMs);
  const e = buscar() ?? inicial;
  return e.estado === "listo" ? { ...(e.respuesta as Respuesta), estado: e.estado } : { estado: e.estado };
}

async function procesar(deps: Dependencias, entrada: Entrada): Promise<Respuesta> {
  const { db } = deps;
  const usuarioId = entrada.usuarioId;
  const conversacionId = entrada.conversacionId;
  const ctx = crearContexto({
    db,
    usuarioId,
    zonaHoraria: deps.zonaHoraria,
    monedaBase: deps.monedaBase,
    entradaId: entrada.id,
    textoOriginal: entrada.texto,
    ubicacion: { lat: entrada.lat ?? undefined, lon: entrada.lon ?? undefined, lugar: entrada.lugar ?? undefined },
    ahora: new Date(entrada.capturadoEn),
  });
  // Un intento anterior que falló a medias no debe dejar registros duplicados.
  revertirEntrada(ctx, entrada.id);

  const acciones: Accion[] = [];
  const mensajeUsuario: ModelMessage = { role: "user", content: entrada.texto };
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
