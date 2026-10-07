// Cuánto tarda el primer dictado con el modelo descargado, con y sin precalentar (lo que hace /despertar),
// y en qué se va ese tiempo: cargar el modelo o procesar las instrucciones y herramientas.
// Uso: bun run eval:arranque [-- --modelo gemma4:12b-it-qat]
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { parseArgs } from "node:util";
import { hablar, precalentar } from "../src/ai/asistente";
import { crearModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { modelo: { type: "string", default: config.ia.modelo } } });
const nombre = values.modelo!;
const modelo = crearModelo(config.ia, nombre);
const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function descargar() {
  await fetch(`${config.ia.ollamaUrl}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model: nombre, keep_alive: 0 }),
  });
  await Bun.sleep(2000);
}

function base() {
  const db = abrirBaseDatos(":memory:");
  const usuario = crearUsuario(db, "Prueba");
  sembrarCategorias(db, usuario.id);
  return { deps: { db, modelo, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda }, usuarioId: usuario.id };
}

async function medir<T>(trabajo: () => Promise<T>) {
  const inicio = performance.now();
  await trabajo();
  return performance.now() - inicio;
}

const dictar = (b: ReturnType<typeof base>) => () =>
  hablar(b.deps, b.usuarioId, { texto: "Gasté 85 pesos en un café", clientId: crypto.randomUUID() });

await descargar();
const sinPrecalentar = await medir(dictar(base()));
const caliente = await medir(dictar(base()));

await descargar();
const b = base();
const precalentado = await medir(() => precalentar(b.deps, b.usuarioId));
const despues = await medir(dictar(b));

console.log(`Modelo ${nombre}`);
console.log(`Primer dictado con el modelo descargado: ${segundos(sinPrecalentar)}`);
console.log(`Precalentar (mientras dictas): ${segundos(precalentado)}; el dictado después: ${segundos(despues)}`);
console.log(`Dictado con todo en caliente: ${segundos(caliente)}`);

// Desglose con la API nativa de Ollama, que reporta cuánto tardó cada parte.
type Peticion = { messages: unknown[]; tools?: unknown[] };
async function peticionReal(): Promise<Peticion> {
  let capturada: Peticion | undefined;
  const espia = createOpenAICompatible({
    name: "local",
    baseURL: "http://espia/v1",
    fetch: (async (_url: unknown, init: { body: string }) => {
      capturada = JSON.parse(init.body);
      return Response.json({
        id: "x",
        created: 0,
        model: nombre,
        choices: [{ index: 0, message: { role: "assistant", content: "Hola." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    }) as never,
  }).chatModel(nombre);
  const b = base();
  await hablar({ ...b.deps, modelo: espia }, b.usuarioId, { texto: "Gasté 85 pesos en un café", clientId: crypto.randomUUID() });
  return capturada!;
}

async function nativo(peticion: Peticion) {
  const r = await fetch(`${config.ia.ollamaUrl}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model: nombre, ...peticion, stream: false, think: false, options: { num_predict: 1 } }),
  });
  const j = (await r.json()) as { load_duration: number; prompt_eval_count: number; prompt_eval_duration: number };
  return { carga: j.load_duration / 1e6, tokens: j.prompt_eval_count, procesar: j.prompt_eval_duration / 1e6 };
}

const peticion = await peticionReal();
await descargar();
const frio = await nativo(peticion);
const repetido = await nativo(peticion);
await descargar();
const sinHerramientas = await nativo({ messages: peticion.messages });
console.log(
  `Desglose en frío: cargar ${segundos(frio.carga)}; procesar ${frio.tokens} tokens en ${segundos(frio.procesar)} ` +
    `(${Math.round(frio.tokens / (frio.procesar / 1000))} tokens/s)`,
);
console.log(`Repetido en caliente: cargar ${segundos(repetido.carga)}; procesar ${repetido.tokens} tokens en ${segundos(repetido.procesar)}`);
console.log(`Solo instrucciones, sin herramientas: ${sinHerramientas.tokens} tokens`);
