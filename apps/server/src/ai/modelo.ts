import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Config } from "../config";

/**
 * El modelo vive detrás de una API compatible con OpenAI. Cambiar de Ollama a LM Studio,
 * Osaurus o un proveedor en la nube es solo cambiar IA_URL, IA_MODELO e IA_API_KEY.
 */
export function crearModelo(ia: Config["ia"], modelo = ia.modelo): LanguageModel {
  return createOpenAICompatible({ name: "local", baseURL: ia.url, apiKey: ia.apiKey }).chatModel(modelo);
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
