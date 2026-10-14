// Pone las etiquetas automáticas a lo que ya estaba anotado, en todas las cuentas: viaje por la ubicación y, con lo
// que dijo cada quien al anotarlo, innecesario y las de contexto (Trabajo, Boda de Ana). Solo agrega etiquetas.
//
//   bun scripts/etiquetar-historial.ts              → prueba: dice qué pondría y guarda el plan; no escribe nada.
//   bun scripts/etiquetar-historial.ts --aplicar    → respalda la base y aplica el plan que guardó la prueba.
//   bun scripts/etiquetar-historial.ts --deshacer <marca>  → quita todo lo que agregó esa vez.
//
// La IA ve los gastos de cada cuenta en una sola consulta (o de 80 en 80); la prueba dice cuánto costó.
// De la cuenta dueña se muestra cada gasto; de las demás, solo cuántos.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { generateText } from "ai";
import { crearModelo } from "../src/ai/modelo";
import { costoMicroUsd } from "../src/ai/uso";
import { esDueno } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { movimientos, usuarios } from "../src/db/schema";
import { crearContexto } from "../src/finanzas/contexto";
import {
  type Agregado,
  aplicarPlan,
  describirGasto,
  deshacerEtiquetado,
  leerRespuesta,
  lineasParaIa,
  planDeViajes,
  preguntaParaIa,
  susEtiquetas,
} from "../src/finanzas/etiquetas-historial";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    aplicar: { type: "boolean", default: false },
    deshacer: { type: "string" },
    "sin-ia": { type: "boolean", default: false },
  },
});

const db = abrirBaseDatos(config.baseDatos);
const rutaPlan = join(dirname(config.baseDatos), "etiquetado-historial-plan.json");
const POR_CONSULTA = 80;

if (values.deshacer) {
  const quitados = deshacerEtiquetado(db, values.deshacer);
  console.log(`Listo: quité las etiquetas que agregó ${values.deshacer} de ${quitados} movimientos.`);
  process.exit(0);
}

type Plan = { marca: string; hecho: string; cuentas: { usuarioId: string; agregados: Agregado[] }[] };

let costo = 0;

async function armarPlan(): Promise<Plan> {
  const modelo = crearModelo(config.ia);
  const marca = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const plan: Plan = { marca, hecho: new Date().toISOString(), cuentas: [] };
  for (const u of db.select({ id: usuarios.id }).from(usuarios).all()) {
    const ctx = crearContexto({ db, usuarioId: u.id, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda });
    const agregados = planDeViajes(ctx);
    const lineas = lineasParaIa(ctx);
    if (!values["sin-ia"]) {
      const quePaso = describirGasto(ctx);
      for (let i = 0; i < lineas.length; i += POR_CONSULTA) {
        const tramo = lineas.slice(i, i + POR_CONSULTA);
        const r = await generateText({ model: modelo, prompt: preguntaParaIa(tramo.map((l) => l.linea), susEtiquetas(ctx)), temperature: 0, maxOutputTokens: 1200 });
        // La prueba no escribe en la base, ni el uso: el costo se dice al final.
        costo += costoMicroUsd(r.response.modelId, r.usage);
        agregados.push(...leerRespuesta(r.text, tramo, quePaso));
      }
    }
    plan.cuentas.push({ usuarioId: u.id, agregados });
  }
  return plan;
}

function mostrar(plan: Plan) {
  for (const { usuarioId, agregados } of plan.cuentas) {
    const nombre = db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, usuarioId)).get()?.nombre ?? usuarioId;
    const porMotivo = (m: string) => agregados.filter((a) => a.motivo === m).length;
    const resumen = `${agregados.length} etiquetas (viaje ${porMotivo("viaje")}, innecesario ${porMotivo("innecesario")}, contexto ${porMotivo("contexto")})`;
    if (!esDueno(db, usuarioId)) {
      console.log(`\nOtra cuenta: ${resumen}, ${new Set(agregados.map((a) => a.etiqueta)).size} nombres distintos.`);
      continue;
    }
    console.log(`\n${nombre}: ${resumen}`);
    for (const a of agregados) console.log(`  ${a.etiqueta} ← ${a.quePaso}`);
  }
}

if (!values.aplicar) {
  const plan = await armarPlan();
  writeFileSync(rutaPlan, JSON.stringify(plan, null, 2));
  mostrar(plan);
  if (!values["sin-ia"]) console.log(`\nLa IA costó unos ${(costo / 1_000_000).toFixed(4)} USD.`);
  console.log(`\nPrueba: no escribí nada en la base. Plan ${plan.marca} guardado; con --aplicar se aplica este mismo plan.`);
  process.exit(0);
}

if (!existsSync(rutaPlan)) {
  console.error("Primero corre la prueba (sin --aplicar): así se aplica justo lo que viste.");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(rutaPlan, "utf8")) as Plan;
const respaldo = `${config.baseDatos}.antes-etiquetado-${plan.marca}`;
db.$client.exec(`VACUUM INTO '${respaldo.replace(/'/g, "''")}'`);
console.log(`Respaldo de la base: ${respaldo}`);
let cambiados = 0;
for (const { usuarioId, agregados } of plan.cuentas) {
  const ctx = crearContexto({ db, usuarioId, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda });
  // Solo los que siguen ahí: si borró un gasto desde la prueba, no se toca.
  const vivos = agregados.filter((a) => db.select({ e: movimientos.eliminadoEn }).from(movimientos).where(eq(movimientos.id, a.movimientoId)).get()?.e === null);
  cambiados += aplicarPlan(ctx, vivos, plan.marca).cambiados;
}
// Ya aplicado: otro --aplicar no lo repite (y no pisa lo que --deshacer necesita).
renameSync(rutaPlan, `${rutaPlan}.aplicado-${plan.marca}`);
console.log(`Listo: etiqueté ${cambiados} movimientos. Para quitarlo todo: bun scripts/etiquetar-historial.ts --deshacer ${plan.marca}`);
