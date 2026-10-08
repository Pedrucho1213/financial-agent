import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import type { Config } from "../config";

/**
 * El modelo vive detrás de una API compatible con OpenAI. Cambiar de Ollama a LM Studio,
 * Osaurus o un proveedor en la nube es solo cambiar IA_URL, IA_MODELO e IA_API_KEY.
 */
export function crearModelo(ia: Config["ia"], modelo = ia.modelo, alUsar?: () => void): LanguageModel {
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
  return middleware.length === 0 ? base : wrapLanguageModel({ model: base, middleware });
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
  if (esOllama(ia)) {
    const [ps, tags] = await Promise.all([pedir(`${ia.ollamaUrl}/api/ps`), pedir(`${ia.ollamaUrl}/api/tags`)]);
    const nombres = (r: unknown) => ((r as { models?: { name?: string }[] } | null)?.models ?? []).map((m) => m.name);
    return { modelo, disponible: nombres(tags).includes(modelo), cargada: nombres(ps).includes(modelo) };
  }
  const lista = await pedir(`${ia.url}/models`, { authorization: `Bearer ${ia.apiKey}` });
  return { modelo, disponible: lista !== null, cargada: lista !== null };
}
