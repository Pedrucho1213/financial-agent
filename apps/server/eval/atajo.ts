// El Atajo de punta a punta con el modelo real: notificaciones activas en el iPhone y la espera real.
// Revisa que un registro conteste rápido (con confirmación variada) y que una corrección, un cambio o un
// borrado espere a la IA y diga qué cambió.
// Uso: bun eval/atajo.ts [--repeticiones 3] [--frase "texto"]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { crearModelo, despertarModelo } from "../src/ai/modelo";
import { crearApp, RESPUESTAS_RAPIDAS } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { crearContexto } from "../src/finanzas/contexto";
import { buscarMovimientos } from "../src/finanzas/movimientos";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { repeticiones: { type: "string", default: "1" }, frase: { type: "string" } },
});

type Mov = ReturnType<typeof buscarMovimientos>["movimientos"][number];
type Caso = {
  tipo: "registro" | "correccion" | "sin palabra";
  /** Lo que dictó antes, cada uno en su propio Atajo. */
  antes?: string[];
  frase: string;
  verificar: (movs: Mov[], respuesta: string) => true | string;
};

const motivo = (ok: boolean, detalle: unknown) => (ok ? true : JSON.stringify(detalle));
const plano = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[,\s]/g, "");
const dice = (respuesta: string, ...textos: string[]) => textos.some((t) => plano(respuesta).includes(plano(t)));
const montos = (movs: Mov[]) => movs.map((m) => m.monto).sort();
const de = (movs: Mov[], texto: string) => movs.filter((m) => plano(`${m.comercio ?? ""} ${m.categoria ?? ""}`).includes(plano(texto)));

const unGasto = (monto: string, cual: string) => (movs: Mov[]) => {
  const m = de(movs, cual);
  return motivo(movs.length === 1 && m[0]?.monto === monto, movs);
};

const CASOS: Caso[] = [
  // Registros: confirmación rápida y lo anotado por notificación.
  { tipo: "registro", frase: "Gasté 85 en Starbucks", verificar: unGasto("$85", "Starbucks") },
  { tipo: "registro", frase: "Gasolina 700", verificar: unGasto("$700", "Gasolina") },
  { tipo: "registro", frase: "Uber de 120 con la BBVA", verificar: unGasto("$120", "Uber") },
  { tipo: "registro", frase: "Súper 1,300 en Walmart", verificar: unGasto("$1,300", "Walmart") },
  { tipo: "registro", frase: "Pagué doscientos cincuenta de tacos", verificar: (m) => motivo(m.length === 1 && m[0]?.monto === "$250", m) },
  { tipo: "registro", frase: "Farmacia 260 con tarjeta", verificar: unGasto("$260", "Farmacia") },
  { tipo: "registro", frase: "Me pagaron 5 mil de un trabajo", verificar: (m) => motivo(m.length === 1 && m[0]?.monto === "$5,000" && m[0]?.tipo === "ingreso", m) },
  { tipo: "registro", frase: "Café 45 y galletas 30", verificar: (m) => motivo(JSON.stringify(montos(m)) === JSON.stringify(["$30", "$45"]), m) },
  { tipo: "registro", frase: "Comida en Vips 380", verificar: unGasto("$380", "Vips") },
  { tipo: "registro", frase: "Oxxo 45", verificar: unGasto("$45", "Oxxo") },
  { tipo: "registro", antes: ["Gasté 85 en Starbucks"], frase: "Gasté 60 en un pan", verificar: (m) => motivo(JSON.stringify(montos(m)) === JSON.stringify(["$60", "$85"]), m) },
  { tipo: "registro", antes: ["Uber 120"], frase: "Otro Uber de 95", verificar: (m) => motivo(JSON.stringify(montos(m)) === JSON.stringify(["$120", "$95"]), m) },

  // Correcciones con monto que antes contestaban "Anotado".
  { tipo: "correccion", antes: ["Gasté 85 en Starbucks"], frase: "No eran 85, eran 95", verificar: (m, r) => motivo(unGasto("$95", "Starbucks")(m) === true && dice(r, "95"), { m, r }) },
  { tipo: "correccion", antes: ["Gasté 85 en Starbucks"], frase: "Fueron 95, no 85", verificar: (m, r) => motivo(unGasto("$95", "Starbucks")(m) === true && dice(r, "95"), { m, r }) },
  { tipo: "correccion", antes: ["Uber 120"], frase: "Me equivoqué, el Uber fue de 150", verificar: (m, r) => motivo(unGasto("$150", "Uber")(m) === true && dice(r, "150"), { m, r }) },
  { tipo: "correccion", antes: ["Súper 1,300 en Walmart"], frase: "En realidad fueron 1,350 del súper", verificar: (m, r) => motivo(unGasto("$1,350", "Walmart")(m) === true && dice(r, "1350"), { m, r }) },
  { tipo: "correccion", antes: ["Farmacia 405"], frase: "Perdón, eran 450 de la farmacia, no 405", verificar: (m, r) => motivo(unGasto("$450", "Farmacia")(m) === true && dice(r, "450"), { m, r }) },
  { tipo: "correccion", antes: ["Gasolina 800"], frase: "Modifica la gasolina, fueron 750", verificar: (m, r) => motivo(unGasto("$750", "Gasolina")(m) === true && dice(r, "750"), { m, r }) },
  { tipo: "correccion", antes: ["Súper 1,300 en Walmart"], frase: "Actualiza el súper a 1,250", verificar: (m, r) => motivo(unGasto("$1,250", "Walmart")(m) === true && dice(r, "1250"), { m, r }) },
  { tipo: "correccion", antes: ["Uber 120"], frase: "El último era de 135", verificar: (m, r) => motivo(unGasto("$135", "Uber")(m) === true && dice(r, "135"), { m, r }) },
  { tipo: "correccion", antes: ["Uber 120"], frase: "Corrige el Uber, eran 135", verificar: (m, r) => motivo(unGasto("$135", "Uber")(m) === true && dice(r, "135"), { m, r }) },
  { tipo: "correccion", antes: ["Pagué la renta de 8,500"], frase: "Ajusta la renta a 9 mil", verificar: (m, r) => motivo(m.length === 1 && m[0]?.monto === "$9,000" && dice(r, "9000"), { m, r }) },
  // Borrados y cambios.
  { tipo: "correccion", antes: ["Gasté 85 en Starbucks", "Gasolina 700"], frase: "Borra el café de 85", verificar: (m, r) => motivo(m.length === 1 && m[0]?.monto === "$700" && dice(r, "borr", "elimin", "quit"), { m, r }) },
  { tipo: "correccion", antes: ["Oxxo 45", "Gasolina 700"], frase: "Quita el Oxxo de 45", verificar: (m, r) => motivo(m.length === 1 && m[0]?.monto === "$700" && dice(r, "borr", "elimin", "quit"), { m, r }) },
  { tipo: "correccion", antes: ["Gasolina 700", "Gasté 85 en Starbucks"], frase: "Deshaz lo último", verificar: (m) => motivo(m.length === 1 && m[0]?.monto === "$700", m) },
  { tipo: "correccion", antes: ["Gasté 85 en Starbucks", "Gasté 85 en Starbucks"], frase: "El café de 85 lo anotaste dos veces", verificar: (m) => motivo(m.length === 1 && m[0]?.monto === "$85", m) },
  { tipo: "correccion", antes: ["Gasolina 700", "Gasté 85 en Starbucks"], frase: "Ese de 85 no lo anotes, era de prueba", verificar: (m) => motivo(m.length === 1 && m[0]?.monto === "$700", m) },
  { tipo: "correccion", antes: ["Gasté 85 en Starbucks"], frase: "No fue en efectivo, fue con la Nu", verificar: (m) => motivo(m.length === 1 && m[0]?.cuenta === "Nu", m) },
  { tipo: "correccion", antes: ["Gasté 85 en Starbucks"], frase: "El café de 85 cámbialo a la BBVA", verificar: (m) => motivo(m.length === 1 && m[0]?.cuenta === "BBVA", m) },
  { tipo: "correccion", antes: ["Gasté 85 en Starbucks"], frase: "Agrégale 20 de propina al café", verificar: (m, r) => motivo((m.length === 1 && m[0]?.monto === "$105") || JSON.stringify(montos(m)) === JSON.stringify(["$20", "$85"]), { m, r }) },

  // Sin palabra de corrección: el servidor no la ve venir. Solo informativo (no cuenta como fallo).
  { tipo: "sin palabra", antes: ["Gasté 85 en Starbucks"], frase: "El de Starbucks 95", verificar: (m) => motivo(m.length === 1 && m[0]?.monto === "$95", m) },
  { tipo: "correccion", antes: ["Gasté 85 en Starbucks"], frase: "Café 95 no 85", verificar: (m) => motivo(m.length === 1 && m[0]?.monto === "$95", m) },
];

const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMtsHJWSeD1h4ztT4fjpQ";
const LLAVES = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

const modelo = crearModelo(config.ia);

function montar() {
  const db = abrirBaseDatos(":memory:");
  const usuario = crearUsuario(db, "Prueba");
  sembrarCategorias(db, usuario.id);
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const enviadas: { cuerpo: string }[] = [];
  const app = crearApp({
    db,
    modelo,
    zonaHoraria: config.zonaHoraria,
    monedaBase: config.moneda,
    espera: config.espera,
    enviarPush: async (_s, mensaje) => (enviadas.push(JSON.parse(mensaje)), { ok: true, estado: 201, vencida: false }),
  });
  const pedir = (ruta: string, cuerpo: unknown) =>
    app.request(ruta, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", host: "finanzas.ejemplo.ts.net", "user-agent": "Shortcuts/1 CFNetwork Darwin" },
      body: JSON.stringify(cuerpo),
    });
  const ctx = crearContexto({ db, usuarioId: usuario.id, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda });
  return { pedir, enviadas, movimientos: () => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos };
}

const hasta = async (listo: () => boolean, ms = 90_000) => {
  const fin = Date.now() + ms;
  while (!listo() && Date.now() < fin) await Bun.sleep(200);
  return listo();
};

type Resultado = { tipo: string; frase: string; ok: boolean; fallo?: string; ms: number; estado: number; respuesta: string; push: number };

async function correr(caso: Caso): Promise<Resultado> {
  const { pedir, enviadas, movimientos } = montar();
  await pedir("/v1/push/suscripcion", { endpoint: ENDPOINT, keys: LLAVES, origen: "https://finanzas.ejemplo.ts.net", en_iphone: true });
  // Lo de antes, como lo dictaría: cada uno espera a que su notificación llegue.
  for (const texto of caso.antes ?? []) {
    const antes = enviadas.length;
    const r = await pedir("/v1/hablar", { texto, client_id: crypto.randomUUID() });
    if (r.status === 202 || RESPUESTAS_RAPIDAS.includes(((await r.json()) as { respuesta: string }).respuesta as never)) {
      await hasta(() => enviadas.length > antes);
    }
  }
  const pushAntes = enviadas.length;
  const inicio = performance.now();
  const r = await pedir("/v1/hablar", { texto: caso.frase, client_id: crypto.randomUUID() });
  const ms = Math.round(performance.now() - inicio);
  const { respuesta } = (await r.json()) as { respuesta: string };
  const rapida = RESPUESTAS_RAPIDAS.includes(respuesta as never);
  // Lo que no se oyó llega por notificación: se espera para revisar lo guardado.
  if (rapida || r.status === 202) await hasta(() => enviadas.length > pushAntes);
  else await Bun.sleep(300);
  const push = enviadas.length - pushAntes;
  const guardado = caso.verificar(movimientos(), rapida ? (enviadas.at(-1)?.cuerpo ?? "") : respuesta);
  const fallos: string[] = [];
  if (guardado !== true) fallos.push(`guardado: ${guardado}`);
  if (caso.tipo === "registro") {
    if (!rapida) fallos.push(`esperaba confirmación rápida`);
    if (ms > 1500 && r.status === 202) fallos.push(`tardó ${ms} ms en contestar`);
    if (push !== 1) fallos.push(`${push} notificaciones`);
  }
  if (caso.tipo === "correccion") {
    if (rapida || r.status === 202) fallos.push(`contestó "${respuesta}" sin decir qué cambió (${r.status})`);
    if (push !== 0) fallos.push(`${push} notificaciones de más`);
  }
  return { tipo: caso.tipo, frase: caso.frase, ok: fallos.length === 0, fallo: fallos.join("; ") || undefined, ms, estado: r.status, respuesta, push };
}

const repeticiones = Math.max(1, Number(values.repeticiones) || 1);
const casos = CASOS.filter((c) => !values.frase || c.frase.includes(values.frase));
process.stdout.write(`Cargando ${config.ia.modelo}... `);
console.log((await despertarModelo(config.ia)) ? "listo" : "no se pudo precargar");
console.log(`Espera del iPhone: registro ${config.espera.registroMs} ms, pregunta ${config.espera.preguntaMs} ms\n`);

const resultados: (Resultado & { repeticion: number })[] = [];
for (let repeticion = 1; repeticion <= repeticiones; repeticion++) {
  if (repeticiones > 1) console.log(`-- repetición ${repeticion} de ${repeticiones}`);
  for (const caso of casos) {
    const r = await correr(caso);
    resultados.push({ ...r, repeticion });
    const marca = caso.tipo === "sin palabra" ? (r.ok ? "·" : "~") : r.ok ? "✓" : "✗";
    console.log(`${marca} ${String(r.ms).padStart(6)} ms ${r.estado} [${r.tipo}] ${r.frase} → "${r.respuesta}"`);
    if (r.fallo) console.log(`           ${r.fallo.slice(0, 400)}`);
  }
}

const percentil = (lista: number[], p: number) => [...lista].sort((a, b) => a - b)[Math.min(lista.length - 1, Math.floor((p / 100) * lista.length))] ?? 0;
const resumen = (["registro", "correccion", "sin palabra"] as const)
  .map((tipo) => {
    const del = resultados.filter((r) => r.tipo === tipo);
    if (!del.length) return undefined;
    const ms = del.map((r) => r.ms);
    return `${tipo}: ${del.filter((r) => r.ok).length}/${del.length} bien; contesta en mediana ${percentil(ms, 50)} ms, p90 ${percentil(ms, 90)} ms, máx ${Math.max(...ms)} ms`;
  })
  .filter(Boolean)
  .join("\n");
const rapidas = new Set(resultados.filter((r) => RESPUESTAS_RAPIDAS.includes(r.respuesta as never)).map((r) => r.respuesta));
console.log(`\nResumen\n${resumen}\nconfirmaciones rápidas distintas: ${[...rapidas].join(" | ")}`);
mkdirSync("eval/resultados", { recursive: true });
writeFileSync(`eval/resultados/atajo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ resumen, resultados }, null, 2));
process.exit(0);
