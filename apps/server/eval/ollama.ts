// Utilidades para medir con la API nativa de Ollama, que reporta cuánto tardó cada parte.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { hablar } from "../src/ai/asistente";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos, type Db } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";

export type Mensaje = { role: string; content: string };
export type Peticion = { messages: Mensaje[]; tools?: unknown[] };

/** La petición que el servidor le manda de verdad al modelo para ese dictado (sin llamar a Ollama). */
export async function peticionReal(
  nombre: string,
  texto = "Gasté 85 pesos en un café",
  preparar?: (db: Db, usuarioId: string) => void,
): Promise<Peticion> {
  let capturada: Peticion | undefined;
  const espia = createOpenAICompatible({
    name: "local",
    baseURL: "http://espia/v1",
    fetch: (async (_url: unknown, init: { body: string }) => {
      capturada ??= JSON.parse(init.body);
      return Response.json({
        id: "x",
        created: 0,
        model: nombre,
        choices: [{ index: 0, message: { role: "assistant", content: "Hola." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    }) as never,
  }).chatModel(nombre);
  const db = abrirBaseDatos(":memory:");
  const usuario = crearUsuario(db, "Prueba");
  sembrarCategorias(db, usuario.id);
  preparar?.(db, usuario.id);
  const deps = { db, modelo: espia, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
  await hablar(deps, usuario.id, { texto, clientId: crypto.randomUUID() });
  return capturada!;
}

/** Manda la petición a /api/chat sin generar nada y dice cuánto tardó en cargar y cuántos tokens procesó. */
export async function nativo(nombre: string, peticion: Peticion) {
  const r = await fetch(`${config.ia.ollamaUrl}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model: nombre, ...peticion, stream: false, think: false, options: { num_predict: 1 } }),
  });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { load_duration: number; prompt_eval_count: number; prompt_eval_duration: number };
  return { carga: j.load_duration / 1e6, tokens: j.prompt_eval_count, procesar: j.prompt_eval_duration / 1e6 };
}
