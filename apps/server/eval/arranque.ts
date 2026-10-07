// Cuánto tarda el primer dictado con el modelo descargado, con y sin precalentar (lo que hace /despertar),
// y en qué se va ese tiempo: cargar el modelo o procesar las instrucciones y herramientas.
// Uso: bun run eval:arranque [-- --modelo gemma4:12b-it-qat]
import { parseArgs } from "node:util";
import { hablar, precalentar } from "../src/ai/asistente";
import { crearModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { nativo, peticionReal } from "./ollama";

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
const peticion = await peticionReal(nombre);
await descargar();
const frio = await nativo(nombre, peticion);
const repetido = await nativo(nombre, peticion);
await descargar();
const sinHerramientas = await nativo(nombre, { messages: peticion.messages });
console.log(
  `Desglose en frío: cargar ${segundos(frio.carga)}; procesar ${frio.tokens} tokens en ${segundos(frio.procesar)} ` +
    `(${Math.round(frio.tokens / (frio.procesar / 1000))} tokens/s)`,
);
console.log(`Repetido en caliente: cargar ${segundos(repetido.carga)}; procesar ${repetido.tokens} tokens en ${segundos(repetido.procesar)}`);
console.log(`Solo instrucciones, sin herramientas: ${sinHerramientas.tokens} tokens`);
