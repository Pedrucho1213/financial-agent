// Qué cambios en la petición hacen que Ollama vuelva a procesar las herramientas.
// Ollama guarda el prefijo ya procesado; si algo cambia antes de las herramientas, las vuelve a leer
// (~2400 tokens, varios segundos). Mide cuántos tokens reprocesa según dónde cambie el dato.
// Uso: bun run eval:cache [-- --modelo gemma4:12b-it-qat]
import { parseArgs } from "node:util";
import { config } from "../src/config";
import { type Mensaje, nativo, type Peticion, peticionReal } from "./ollama";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { modelo: { type: "string", default: config.ia.modelo } } });
const nombre = values.modelo!;

// Dónde pone la plantilla del modelo las herramientas respecto al mensaje de sistema.
const show = (await (
  await fetch(`${config.ia.ollamaUrl}/api/show`, { method: "POST", body: JSON.stringify({ model: nombre }) })
).json()) as { template?: string };
const plantilla = show.template ?? "";
console.log(`Plantilla (${plantilla.length} caracteres), líneas con system o tools:`);
for (const linea of plantilla.split("\n").filter((l) => /system|tool/i.test(l)).slice(0, 25)) console.log(`  ${linea.trim().slice(0, 160)}`);

const base = await peticionReal(nombre);
const [sistema, ...resto] = base.messages as [Mensaje, ...Mensaje[]];
const usuario = resto.at(-1)!;
const historial = resto.slice(0, -1);
const DATO_A = "Lo que sabes del usuario:\n- En el Oxxo paga con la tarjeta Nu.\n";
const DATO_B = `${DATO_A}- Su quincena llega los días 15 y 30 a su cuenta BBVA.\n- Siempre paga la renta con transferencia.\n`;

const con = (mensajes: Mensaje[]): Peticion => ({ ...base, messages: mensajes });
const variantes: Record<string, (dato: string) => Peticion> = {
  "al final del sistema (hoy)": (d) => con([{ ...sistema, content: `${sistema.content}\n${d}` }, ...historial, usuario]),
  "en otro mensaje de sistema antes del dictado": (d) => con([sistema, ...historial, { role: "system", content: d }, usuario]),
  "al inicio del mensaje del usuario": (d) => con([sistema, ...historial, { ...usuario, content: `${d}\n${usuario.content}` }]),
};

await nativo(nombre, base);
console.log(`\nRepetir la misma petición: ${(await nativo(nombre, base)).tokens} tokens`);
const fecha = sistema.content.replace(/Hoy es [^.]+\./, "Hoy es domingo 1999-01-01.");
console.log(`Cambiar la fecha (inicio del sistema): ${(await nativo(nombre, con([{ ...sistema, content: fecha }, ...resto]))).tokens} tokens`);
for (const [donde, armar] of Object.entries(variantes)) {
  await nativo(nombre, armar(DATO_A));
  const cambio = await nativo(nombre, armar(DATO_B));
  console.log(`Dato nuevo ${donde}: ${cambio.tokens} tokens en ${(cambio.procesar / 1000).toFixed(1)} s`);
}
