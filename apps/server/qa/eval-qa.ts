// Frases difíciles de QA contra el modelo real (Ollama). Corre desde apps/server:
//   bun qa/eval-qa.ts [--modelo gemma4:12b-it-qat@none] [--frase "texto"] [--traza]
// --traza muestra cada llamada al modelo de la frase final: ms, tokens y qué hizo (herramienta o texto).
// Cada caso arranca con una base vacía en memoria; no toca la base de Pedro.
import { parseArgs } from "node:util";
import { wrapLanguageModel } from "ai";
import { hablar } from "../src/ai/asistente";
import { crearModelo, despertarModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { type Contexto, crearContexto } from "../src/finanzas/contexto";
import { buscarMovimientos, crearMovimiento } from "../src/finanzas/movimientos";
import { crearRecurrente, listarRecurrentes } from "../src/finanzas/recurrentes";
import { esPregunta } from "../src/lib/texto";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { modelo: { type: "string", default: `${config.ia.modelo}@${config.ia.razonamiento}` }, frase: { type: "string" }, traza: { type: "boolean", default: false } },
});

type Mov = ReturnType<typeof buscarMovimientos>["movimientos"][number];
type R = { respuesta: string; movimientos: Mov[]; recurrentes: ReturnType<typeof listarRecurrentes>["recurrentes"]; herramientas: string[]; ctx: Contexto };
type Caso = { id: string; frase: string; previos?: string[]; preparar?: (ctx: Contexto) => void; verificar: (r: R) => true | string };

const previa = (ctx: Contexto) => ({ ...ctx, entradaId: "previa", textoOriginal: undefined });
const ejemplo = (ctx: Contexto) => {
  const c = previa(ctx);
  crearMovimiento(c, { tipo: "gasto", monto: 60, categoria: "Café", comercio: "Starbucks", fecha: "ayer" });
  crearMovimiento(c, { tipo: "gasto", monto: 45, categoria: "Café", comercio: "Oxxo", fecha: "ayer" });
  crearMovimiento(c, { tipo: "gasto", monto: 30, categoria: "Café", comercio: "Cielito" });
  crearMovimiento(c, { tipo: "gasto", monto: 1850, categoria: "Súper", comercio: "Walmart" });
  crearMovimiento(c, { tipo: "gasto", monto: 230, categoria: "Taxi y apps", comercio: "Uber", fecha: "ayer" });
  crearMovimiento(c, { tipo: "ingreso", monto: 12000, categoria: "Sueldo" });
};
const plano = (s: string) => s.replace(/[,\s]/g, "");
const dice = (r: R, ...t: string[]) => t.every((x) => plano(r.respuesta).includes(plano(x)));
const ok = (cond: boolean, detalle: unknown) => (cond ? true : JSON.stringify(detalle).slice(0, 400));
const cat = (m: Mov | undefined, n: string) => !!m?.categoria?.split(" > ").includes(n);
const nuevos = (r: R) => r.movimientos.filter((m) => !["$60", "$45", "$30", "$1,850", "$230", "$12,000"].includes(m.monto));
const pregunta = (r: R) => r.respuesta.includes("?");

const CASOS: Caso[] = [
  { id: "QA-001", frase: "Oye, cuánto llevo gastado este mes", preparar: ejemplo, verificar: (r) => ok(dice(r, "2,215"), r.respuesta) },
  { id: "QA-001", frase: "Quiero saber cuánto gasté en Uber", preparar: ejemplo, verificar: (r) => ok(dice(r, "230"), r.respuesta) },
  { id: "QA-001", frase: "Me puedes decir cuánto me queda de lo que me pagaron", preparar: ejemplo, verificar: (r) => ok(r.movimientos.length === 6 && /\d/.test(r.respuesta), r.respuesta) },
  {
    id: "QA-006", frase: "Cancelé Netflix",
    preparar: (ctx) => crearRecurrente(previa(ctx), { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 12 }),
    verificar: (r) => ok(!r.recurrentes.some((x) => x.nombre === "Netflix") && r.movimientos.length === 0, { rec: r.recurrentes, mov: r.movimientos }),
  },
  {
    id: "QA-006", frase: "La renta subió a 10 mil",
    preparar: (ctx) => crearRecurrente(previa(ctx), { nombre: "Renta", tipo: "renta", monto: 9500, frecuencia: "mensual", dia: 1 }),
    verificar: (r) => ok(r.recurrentes.some((x) => x.monto === "$10,000") && r.movimientos.length === 0, { rec: r.recurrentes, mov: r.movimientos }),
  },
  { id: "QA-005", frase: "Spotify me cobra 10 dólares cada mes, el día 5", verificar: (r) => ok(r.recurrentes[0]?.monto === "10 USD", r.recurrentes) },
  { id: "QA-006", frase: "Compré una tele de 12 mil a 12 meses sin intereses con la Nu", verificar: (r) => ok(r.movimientos.length >= 1 && !pregunta(r), { mov: r.movimientos, resp: r.respuesta }) },
  { id: "QA-006", frase: "Le presté 500 a Juan", verificar: (r) => ok(!r.movimientos.some((m) => m.tipo === "gasto" && !cat(m, "Otros gastos")), r.movimientos) },
  { id: "nuevo", frase: "Saqué 500 del cajero", verificar: (r) => ok(!r.movimientos.some((m) => m.tipo === "gasto"), r.movimientos) },
  { id: "nuevo", frase: "Me llegó la quincena", verificar: (r) => ok(r.movimientos.length === 0 && pregunta(r), { mov: r.movimientos, resp: r.respuesta }) },
  { id: "QA-011", frase: "Gasté 200 en tacos, súper ricos", verificar: (r) => ok(!cat(r.movimientos[0], "Súper") && r.movimientos[0]?.monto === "$200", r.movimientos) },
  { id: "QA-011", frase: "Compré un agua de 20 en el Oxxo", verificar: (r) => ok(!cat(r.movimientos[0], "Agua") && r.movimientos[0]?.monto === "$20", r.movimientos) },
  { id: "QA-002", frase: "En el Oxxo recargué 200 de saldo al celular", preparar: ejemplo, verificar: (r) => ok(cat(nuevos(r)[0], "Internet y teléfono"), nuevos(r)) },
  {
    id: "QA-004", frase: "Lo de 500 de hoy no fue gasto, me lo pagaron",
    preparar: (ctx) => crearMovimiento(previa(ctx), { tipo: "gasto", monto: 500, categoria: "Café" }),
    verificar: (r) => ok(r.movimientos.length === 1 && r.movimientos[0]!.tipo === "ingreso" && !cat(r.movimientos[0], "Comida"), r.movimientos),
  },
  { id: "QA-009", frase: "Vendí mi coche en un millón doscientos mil", verificar: (r) => ok(r.movimientos[0]?.monto === "$1,200,000" && r.movimientos[0]?.tipo === "ingreso", r.movimientos) },
  { id: "QA-013", frase: "¿Cómo voy esta quincena?", preparar: ejemplo, verificar: (r) => ok(/\d/.test(r.respuesta) && !r.herramientas.some((h) => h.includes('"error"')), { resp: r.respuesta, h: r.herramientas }) },
  {
    id: "QA-013", frase: "¿Cuánto gasté en septiembre?",
    preparar: (ctx) => crearMovimiento(previa(ctx), { tipo: "gasto", monto: 700, categoria: "Súper", fecha: "2026-09-15" }),
    verificar: (r) => ok(dice(r, "700"), r.respuesta),
  },
  {
    id: "QA-013", frase: "Hace un mes pagué 900 en el dentista",
    verificar: (r) => {
      const m = r.movimientos[0];
      return ok(!!m && m.fecha < r.ctx.hoy && m.monto === "$900", r.movimientos);
    },
  },
  { id: "QA-012", frase: "Compré 2 libras de carne en 180", verificar: (r) => ok(r.movimientos[0]?.monto === "$180", r.movimientos) },
  { id: "nuevo", frase: "Borra todo lo de ayer", preparar: ejemplo, verificar: (r) => ok(r.movimientos.length === 6 && pregunta(r), { n: r.movimientos.length, resp: r.respuesta }) },
  { id: "nuevo", frase: "Pagué la tarjeta de crédito, 5 mil", verificar: (r) => ok(r.movimientos[0]?.tipo === "pago_tarjeta", r.movimientos) },
  {
    id: "nuevo", frase: "Ayer gasté 150 en el súper y 80 en gasolina",
    verificar: (r) => ok(r.movimientos.length === 2 && r.movimientos.every((m) => m.fecha < r.ctx.hoy), r.movimientos),
  },
  { id: "nuevo", frase: "Me cobraron 2 dólares de comisión", verificar: (r) => ok(r.movimientos[0]?.monto === "2 USD" && cat(r.movimientos[0], "Comisiones e intereses"), r.movimientos) },
  { id: "nuevo", frase: "Registra que gasté 0 pesos en nada", verificar: (r) => ok(r.movimientos.length === 0, r.movimientos) },
  { id: "nuevo", frase: "¿Cuánto debo de la tarjeta?", preparar: ejemplo, verificar: (r) => ok(r.movimientos.length === 6 && !/\$\d/.test(r.respuesta), r.respuesta) },
  {
    id: "nuevo", frase: "El súper de hoy fue con la tarjeta de crédito Nu", preparar: ejemplo,
    verificar: (r) => ok(r.movimientos.find((m) => m.monto === "$1,850")?.cuenta?.toLowerCase().includes("nu") === true, r.movimientos.find((m) => m.monto === "$1,850")),
  },
  { id: "QA-077", frase: "Gasté 120 en tacos", previos: ["Gasté 120 en tacos"], verificar: (r) => ok(r.movimientos.length === 1 && !/no alcanc/i.test(r.respuesta), { mov: r.movimientos.length, resp: r.respuesta }) },
  { id: "QA-077", frase: "Sí", previos: ["Gasté 120 en tacos", "Gasté 120 en tacos"], verificar: (r) => ok(r.movimientos.length === 2, { mov: r.movimientos.length, resp: r.respuesta }) },
  { id: "QA-077", frase: "No, es el mismo", previos: ["Gasté 120 en tacos", "Gasté 120 en tacos"], verificar: (r) => ok(r.movimientos.length === 1, { mov: r.movimientos.length, resp: r.respuesta }) },
  { id: "nuevo", frase: "Uber 89, Didi 120 y un Rappi de 250", verificar: (r) => ok(r.movimientos.length === 3 && r.movimientos.filter((m) => cat(m, "Taxi y apps")).length === 2 && r.movimientos.some((m) => cat(m, "Delivery")), r.movimientos) },
  { id: "nuevo", frase: "Gasté 450 en la farmacia, no, perdón, fueron 540", verificar: (r) => ok(r.movimientos.length === 1 && r.movimientos[0]!.monto === "$540", r.movimientos) },
];

const casos = CASOS.filter((c) => !values.frase || c.frase.includes(values.frase));
const [nombre, razonamiento] = values.modelo!.split("@") as [string, string | undefined];
const ia = { ...config.ia, razonamiento: razonamiento ?? config.ia.razonamiento };
await despertarModelo(ia, nombre);
let trazando = false;
let paso = 0;
const corto = (v: unknown) => JSON.stringify(v ?? null).replace(/\s+/g, " ").slice(0, 160);
const modelo = !values.traza
  ? crearModelo(ia, nombre)
  : wrapLanguageModel({
      model: crearModelo(ia, nombre) as Parameters<typeof wrapLanguageModel>[0]["model"],
      middleware: {
        specificationVersion: "v3",
        wrapGenerate: async ({ doGenerate }) => {
          const t0 = performance.now();
          const r = await doGenerate();
          if (trazando) {
            const hizo = r.content
              .map((c: any) => (c.type === "tool-call" ? `${c.toolName}(${corto(c.input)})` : c.type === "text" ? `texto ${corto(c.text)}` : c.type))
              .join(" + ");
            console.log(`           paso ${++paso}: ${Math.round(performance.now() - t0)} ms, tokens ${(r.usage as any)?.inputTokens?.total ?? "?"}+${(r.usage as any)?.outputTokens?.total ?? "?"} → ${hizo || "nada"}`);
          }
          return r;
        },
      },
    });
let pasan = 0;
const tiempos: number[] = [];
for (const caso of casos) {
  const db = abrirBaseDatos(":memory:");
  const u = crearUsuario(db, "QA");
  sembrarCategorias(db, u.id);
  const base = { db, usuarioId: u.id, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
  const ctx = crearContexto({ ...base, entradaId: "previa" });
  caso.preparar?.(ctx);
  const deps = { ...base, modelo };
  let estado: true | string;
  let ms = 0;
  let respuesta = "";
  let herramientas: string[] = [];
  try {
    let conversacionId: string | undefined;
    for (const p of caso.previos ?? []) conversacionId = (await hablar(deps, u.id, { texto: p, clientId: crypto.randomUUID(), conversacionId })).conversacion_id;
    const t0 = performance.now();
    trazando = true;
    paso = 0;
    const r = await hablar(deps, u.id, { texto: caso.frase, clientId: crypto.randomUUID(), conversacionId }).finally(() => (trazando = false));
    ms = Math.round(performance.now() - t0);
    respuesta = r.respuesta;
    herramientas = r.acciones.map((a) => `${a.herramienta} ${JSON.stringify(a.argumentos)} => ${JSON.stringify(a.resultado)}`.slice(0, 300));
    estado = caso.verificar({ respuesta, herramientas, ctx, movimientos: buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos, recurrentes: listarRecurrentes(ctx).recurrentes });
  } catch (e) {
    estado = `error: ${e instanceof Error ? e.message : e}`;
  }
  if (estado === true) pasan++;
  tiempos.push(ms);
  const espera = esPregunta(caso.frase) ? config.espera.preguntaMs : config.espera.registroMs;
  console.log(`${estado === true ? "✓" : "✗"} ${String(ms).padStart(6)} ms${ms > espera ? " (>espera)" : ""}  [${caso.id}] ${caso.frase}`);
  if (estado !== true) console.log(`           ${estado}\n           respuesta: ${respuesta}\n           herramientas: ${herramientas.join(" | ") || "ninguna"}`);
}
tiempos.sort((a, b) => a - b);
console.log(`\n${values.modelo}: ${pasan}/${casos.length}; mediana ${(tiempos[Math.floor(tiempos.length / 2)]! / 1000).toFixed(1)} s, máx ${(tiempos.at(-1)! / 1000).toFixed(1)} s`);
