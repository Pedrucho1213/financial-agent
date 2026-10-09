import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import type { Config } from "../config";
import { INSTRUCCIONES_CLAUDE } from "./instrucciones";

type Modelo = ReturnType<typeof wrapLanguageModel>;
type Opciones = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"];
type Mensaje = Opciones["prompt"][number];

/** Los modelos de Claude van por la API de Anthropic; todo lo demás, por la API compatible con OpenAI (Ollama). */
export const esNube = (modelo: string) => modelo.startsWith("claude-");

/** El modelo de Ollama que se usa: el principal, o el respaldo cuando el principal es Claude. */
export function modeloLocal(ia: Pick<Config["ia"], "modelo" | "respaldo">): string | undefined {
  if (!esNube(ia.modelo)) return ia.modelo;
  return ia.respaldo && ia.respaldo !== "no" && !esNube(ia.respaldo) ? ia.respaldo : undefined;
}

/**
 * Con un modelo de Ollama, todo va a la API compatible con OpenAI: cambiar a LM Studio u Osaurus es solo
 * cambiar IA_URL, IA_MODELO e IA_API_KEY. Con un modelo de Claude (IA_MODELO=claude-...), va a la API de
 * Anthropic; si falla (sin internet, sin créditos), contesta el modelo de Ollama de IA_RESPALDO.
 */
export function crearModelo(ia: Config["ia"], modelo = ia.modelo, alUsar?: () => void): LanguageModel {
  return esNube(modelo) ? crearModeloNube(ia, modelo, alUsar) : crearModeloLocal(ia, modelo, alUsar);
}

function crearModeloLocal(ia: Config["ia"], modelo: string, alUsar?: () => void): Modelo {
  const base = createOpenAICompatible({ name: "local", baseURL: ia.url, apiKey: ia.apiKey }).chatModel(modelo);
  const opciones: Record<string, string> = {};
  // Se manda como reasoning_effort; Ollama lo usa en los modelos que razonan.
  if (ia.razonamiento && ia.razonamiento !== "no") opciones.reasoningEffort = ia.razonamiento;
  // keep_alive solo lo entiende Ollama; a otro proveedor no se le manda.
  if (esOllama(ia)) opciones.keep_alive = ia.mantenerCargado;
  const middleware: LanguageModelMiddleware[] = [];
  if (Object.keys(opciones).length > 0) middleware.push(defaultSettingsMiddleware({ settings: { providerOptions: { local: opciones } } }));
  // El interruptor de la IA (ai/encendido.ts) se entera de cada uso, termine bien o mal.
  if (alUsar)
    middleware.push({
      wrapGenerate: async ({ doGenerate }) => {
        try {
          return await doGenerate();
        } finally {
          alUsar();
        }
      },
    });
  return wrapLanguageModel({ model: base, middleware });
}

/**
 * Claude, con el modelo de IA_MODELO_DIFICIL para lo que asistente.ts manda a razonar (saldos, tarjetas,
 * correcciones) y el de Ollama como respaldo. Lo que asistente.ts le pide al modelo local (reasoningEffort,
 * temperatura) aquí se traduce a lo que entiende Claude.
 */
function crearModeloNube(ia: Config["ia"], modelo: string, alUsar?: () => void): Modelo {
  const anthropic = createAnthropic({ apiKey: ia.claveNube });
  const claude = (nombre: string, razonamiento: string) =>
    wrapLanguageModel({ model: anthropic(nombre), middleware: { transformParams: async ({ params }) => paraClaude(params, nombre, razonamiento) } });
  const principal = claude(modelo, ia.razonamiento);
  const dificil = claude(ia.modeloDificil && esNube(ia.modeloDificil) ? ia.modeloDificil : modelo, ia.razonamientoDificil);
  const local = modeloLocal({ modelo, respaldo: ia.respaldo });
  const respaldo = local ? crearModeloLocal(ia, local, alUsar) : undefined;
  const elegir = (params: Opciones) => {
    const pedido = (params.providerOptions?.local as { reasoningEffort?: unknown } | undefined)?.reasoningEffort;
    const marcado = (params.providerOptions?.nube as { dificil?: unknown } | undefined)?.dificil === true;
    return marcado || (pedido && pedido !== "none") ? dificil : principal;
  };
  // Si la nube no contesta, el dictado no se pierde: lo contesta el modelo de la Mac, como antes.
  const conRespaldo = async <T>(params: Opciones, nube: () => PromiseLike<T>, enLocal: () => PromiseLike<T>) => {
    try {
      return await nube();
    } catch (error) {
      if (!respaldo || params.abortSignal?.aborted) throw error;
      console.warn(`Claude no contestó (${motivo(error)}); contesta ${local}.`);
      return enLocal();
    }
  };
  return wrapLanguageModel({
    model: principal,
    middleware: {
      wrapGenerate: ({ params }) => conRespaldo(params, () => elegir(params).doGenerate(params), () => respaldo!.doGenerate(params)),
      wrapStream: ({ params }) => conRespaldo(params, () => elegir(params).doStream(params), () => respaldo!.doStream(params)),
    },
  });
}

function motivo(error: unknown): string {
  const e = error as { statusCode?: number; name?: string; message?: string };
  return e.statusCode ? `HTTP ${e.statusCode}` : (e.name ?? "error");
}

/**
 * Lo que cambia para Claude:
 * - Sin temperatura: los modelos 5.5 solo aceptan la de siempre.
 * - Razonar: "none" lo apaga (Sonnet solo deja apagarlo entre herramientas; Opus no deja); "low", "medium"... es el esfuerzo.
 * - Caché del prefijo (instrucciones, herramientas e historial): cada dictado solo paga lo nuevo.
 * - Los mensajes de sistema que no van al principio (datos del usuario, resumen de los últimos días) pasan como
 *   texto del usuario: Claude solo acepta esos mensajes justo después de uno del usuario.
 * - Lo que razonó en turnos anteriores no se reenvía: solo vale dentro del mismo turno y del mismo modelo.
 * - Después de las instrucciones va INSTRUCCIONES_CLAUDE: qué ya está claro, para que no pregunte de más.
 */
export function paraClaude(params: Opciones, modelo: string, razonamiento: string): Opciones {
  const apagado = !razonamiento || razonamiento === "none" || razonamiento === "no";
  const thinking = !apagado
    ? { type: "adaptive" as const }
    : modelo.includes("sonnet")
      ? { type: "between_tools" as const }
      : modelo.includes("opus") || modelo.includes("fable")
        ? { type: "adaptive" as const }
        : { type: "disabled" as const };
  const effort = !apagado ? razonamiento : thinking.type === "adaptive" ? "low" : undefined;
  return {
    ...params,
    // Lo que piensa cuenta en el límite de salida: con 600 se cortaría antes de contestar.
    ...(thinking.type === "adaptive" ? { maxOutputTokens: Math.max(params.maxOutputTokens ?? 0, 4000) } : {}),
    temperature: undefined,
    topP: undefined,
    topK: undefined,
    prompt: promptParaClaude(params.prompt),
    providerOptions: {
      ...params.providerOptions,
      anthropic: {
        ...params.providerOptions?.anthropic,
        thinking,
        ...(effort ? { effort } : {}),
        cacheControl: { type: "ephemeral" },
      },
    },
  } as Opciones;
}

const ID_VALIDO = /[^a-zA-Z0-9_-]/g;

export function promptParaClaude(prompt: Opciones["prompt"]): Opciones["prompt"] {
  const ultimoUsuario = prompt.findLastIndex((m) => m.role === "user");
  const inicio = prompt.findIndex((m) => m.role !== "system");
  const salida: Mensaje[] = [];
  prompt.forEach((m, i) => {
    if (m.role === "system") {
      // Lo de Claude va pegado a las instrucciones: no cambia entre dictados y queda en la caché.
      if (i === 0) salida.push({ ...m, content: `${m.content}\n\n${INSTRUCCIONES_CLAUDE}` });
      else if (inicio === -1 || i < inicio) salida.push(m);
      else salida.push({ role: "user", content: [{ type: "text", text: `<sistema>\n${m.content}\n</sistema>` }] });
      return;
    }
    if (m.role === "assistant") {
      const content = m.content
        .filter((p) => !(i < ultimoUsuario && p.type === "reasoning"))
        .map((p) => (p.type === "tool-call" ? { ...p, toolCallId: p.toolCallId.replace(ID_VALIDO, "_") } : p));
      if (content.length === 0) return;
      // Claude no acepta una conversación que empieza con la IA (una pregunta que llegó por notificación).
      if (!salida.some((x) => x.role !== "system")) salida.push({ role: "user", content: [{ type: "text", text: "(Sigue la conversación.)" }] });
      salida.push({ ...m, content });
      return;
    }
    if (m.role === "tool") {
      salida.push({ ...m, content: m.content.map((p) => (p.type === "tool-result" ? { ...p, toolCallId: p.toolCallId.replace(ID_VALIDO, "_") } : p)) } as Mensaje);
      return;
    }
    salida.push(m);
  });
  return salida;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PUERTO_POR_OMISION: Record<string, string> = { "http:": "80", "https:": "443" };

/** Si IA_URL es el mismo Ollama que OLLAMA_URL (localhost y 127.0.0.1 cuentan como el mismo). */
export function esOllama(ia: Pick<Config["ia"], "url" | "ollamaUrl">): boolean {
  const lugar = (texto: string) => {
    try {
      const u = new URL(texto);
      const host = LOCAL.has(u.hostname) ? "local" : u.hostname;
      return `${u.protocol}//${host}:${u.port || PUERTO_POR_OMISION[u.protocol] || ""}`;
    } catch {
      return null;
    }
  };
  const a = lugar(ia.url);
  return a !== null && a === lugar(ia.ollamaUrl);
}

/** Carga el modelo en memoria de Ollama mientras el usuario todavía está dictando. */
export async function despertarModelo(ia: Config["ia"], modelo = ia.modelo): Promise<boolean> {
  // Claude no se carga: siempre está listo.
  if (esNube(modelo)) return true;
  try {
    const respuesta = await fetch(`${ia.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelo, keep_alive: ia.mantenerCargado }),
      signal: AbortSignal.timeout(60_000),
    });
    return respuesta.ok;
  } catch {
    return false;
  }
}

export type EstadoIa = { modelo: string; disponible: boolean; cargada: boolean };

/**
 * Para Ajustes: si el modelo responde y si ya está en memoria (Ollama /api/ps).
 * Con otro proveedor solo se sabe si contesta; "cargada" es lo mismo que disponible.
 */
export async function estadoModelo(ia: Config["ia"], modelo = ia.modelo): Promise<EstadoIa> {
  const pedir = (url: string, encabezados?: Record<string, string>) =>
    fetch(url, { headers: encabezados, signal: AbortSignal.timeout(2_000) })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .catch(() => null);
  if (esNube(modelo)) {
    const info = ia.claveNube
      ? await pedir(`https://api.anthropic.com/v1/models/${modelo}`, { "x-api-key": ia.claveNube, "anthropic-version": "2023-06-01" })
      : null;
    return { modelo, disponible: info !== null, cargada: info !== null };
  }
  if (esOllama(ia)) {
    const [ps, tags] = await Promise.all([pedir(`${ia.ollamaUrl}/api/ps`), pedir(`${ia.ollamaUrl}/api/tags`)]);
    const nombres = (r: unknown) => ((r as { models?: { name?: string }[] } | null)?.models ?? []).map((m) => m.name);
    return { modelo, disponible: nombres(tags).includes(modelo), cargada: nombres(ps).includes(modelo) };
  }
  const lista = await pedir(`${ia.url}/models`, { authorization: `Bearer ${ia.apiKey}` });
  return { modelo, disponible: lista !== null, cargada: lista !== null };
}
