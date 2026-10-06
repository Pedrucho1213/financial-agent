import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import type { Config } from "../config";

/**
 * El modelo vive detrás de una API compatible con OpenAI. Cambiar de Ollama a LM Studio,
 * Osaurus o un proveedor en la nube es solo cambiar IA_URL, IA_MODELO e IA_API_KEY.
 */
export function crearModelo(ia: Config["ia"], modelo = ia.modelo): LanguageModel {
  const base = createOpenAICompatible({ name: "local", baseURL: ia.url, apiKey: ia.apiKey }).chatModel(modelo);
  const opciones: Record<string, string> = {};
  // Se manda como reasoning_effort; Ollama lo usa en los modelos que razonan.
  if (ia.razonamiento && ia.razonamiento !== "no") opciones.reasoningEffort = ia.razonamiento;
  // keep_alive solo lo entiende Ollama; a otro proveedor no se le manda.
  if (ia.url.startsWith(ia.ollamaUrl)) opciones.keep_alive = ia.mantenerCargado;
  if (Object.keys(opciones).length === 0) return base;
  return wrapLanguageModel({
    model: base,
    middleware: defaultSettingsMiddleware({ settings: { providerOptions: { local: opciones } } }),
  });
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
