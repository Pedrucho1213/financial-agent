// Cuándo comenta la IA al registrar un gasto, con el modelo real y un mes de historial.
// Uso: bun eval/comentario.ts [--repeticiones 3]
// Mide cuántas veces comenta en gastos normales (debería ser casi nunca) y en gastos fuera de lo normal,
// si el comentario pasa el filtro de cifras y cuánto tarda contra el mismo dictado sin costumbre.
import { parseArgs } from "node:util";
import { hablar } from "../src/ai/asistente";
import { crearModelo, despertarModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { marcarComentario, olvidarComentarios } from "../src/finanzas/comentario";
import { crearContexto } from "../src/finanzas/contexto";
import { crearMovimiento } from "../src/finanzas/movimientos";
import { fijarPresupuesto } from "../src/finanzas/planes";
import { sumarDias } from "../src/lib/fechas";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { repeticiones: { type: "string", default: "2" } } });
const repeticiones = Math.max(1, Number(values.repeticiones) || 1);

const NORMALES = ["gasté 120 en Uber", "gasolina 700", "comida 250 en el Vips", "45 de un agua en el Oxxo", "súper 1,300 en Walmart", "pagué 90 de estacionamiento"];
const FUERA_DE_LO_NORMAL = ["gasté 4,500 en Liverpool", "pagué 3,200 en el dentista", "8 mil de una tele en Best Buy", "café 85 en Starbucks", "comida 900 en el Sonora Grill"];

function base() {
  const db = abrirBaseDatos(":memory:");
  const usuario = crearUsuario(db, "Pedro");
  sembrarCategorias(db, usuario.id);
  const datos = { db, usuarioId: usuario.id, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
  const ctx = crearContexto(datos);
  // Un mes normal: café casi diario, Uber, comidas y el súper cada semana. Starbucks 4 veces esta semana.
  for (let d = 1; d <= 30; d++) {
    const fecha = sumarDias(ctx.hoy, -d);
    if (d % 2) crearMovimiento(ctx, { tipo: "gasto", monto: 85, comercio: "Starbucks", categoria: "Café", fecha });
    if (d % 3 === 0) crearMovimiento(ctx, { tipo: "gasto", monto: 120, comercio: "Uber", categoria: "Taxi y apps", fecha });
    if (d % 2 === 0) crearMovimiento(ctx, { tipo: "gasto", monto: 250, comercio: "Vips", categoria: "Restaurantes", fecha });
    if (d % 7 === 0) crearMovimiento(ctx, { tipo: "gasto", monto: 1300, comercio: "Walmart", categoria: "Súper", fecha });
  }
  crearMovimiento(ctx, { tipo: "gasto", monto: 85, comercio: "Starbucks", categoria: "Café" });
  fijarPresupuesto(ctx, { categoria: "Restaurantes", monto: 5000 });
  return { datos, ctx };
}

const mediana = (l: number[]) => [...l].sort((a, b) => a - b)[Math.floor(l.length / 2)] ?? 0;

const ia = config.ia;
await despertarModelo(ia, ia.modelo);
const modelo = crearModelo(ia, ia.modelo);
const tiempos = { con: [] as number[], sin: [] as number[] };
const comentados = { normales: 0, fuera: 0 };
const propuestos = { normales: 0, fuera: 0 };

async function dictar(frase: string, conCostumbre: boolean) {
  olvidarComentarios();
  const { datos, ctx } = base();
  // Con el tope del día alcanzado, la IA no ve la costumbre: es el mismo dictado de antes de este cambio.
  if (!conCostumbre) for (let i = 0; i < 2; i++) marcarComentario(ctx);
  const inicio = performance.now();
  const r = await hablar({ ...datos, modelo }, datos.usuarioId, { texto: frase, clientId: crypto.randomUUID() });
  const ms = Math.round(performance.now() - inicio);
  const propuesto = r.acciones.map((a) => (a.argumentos as { comentario?: string } | undefined)?.comentario).find(Boolean);
  return { ms, r, propuesto };
}

for (let rep = 0; rep < repeticiones; rep++) {
  for (const [grupo, frases] of [["normales", NORMALES], ["fuera", FUERA_DE_LO_NORMAL]] as const) {
    for (const frase of frases) {
      const sin = await dictar(frase, false);
      const con = await dictar(frase, true);
      tiempos.sin.push(sin.ms);
      tiempos.con.push(con.ms);
      if (con.propuesto) propuestos[grupo]++;
      if (con.r.comentario) comentados[grupo]++;
      const nota = con.propuesto ? (con.r.comentario ? "dice" : "descartado") : "sin comentario";
      console.log(`${grupo.padEnd(8)} ${String(con.ms).padStart(5)} ms (sin costumbre ${String(sin.ms).padStart(5)} ms)  ${frase}  →  ${con.r.respuesta}  [${nota}${con.propuesto && !con.r.comentario ? `: ${con.propuesto}` : ""}]`);
    }
  }
}

const total = (g: "normales" | "fuera") => (g === "normales" ? NORMALES : FUERA_DE_LO_NORMAL).length * repeticiones;
console.log(`\nComenta en gastos normales: ${comentados.normales}/${total("normales")} (propuso ${propuestos.normales})`);
console.log(`Comenta fuera de lo normal: ${comentados.fuera}/${total("fuera")} (propuso ${propuestos.fuera})`);
console.log(`Mediana con costumbre ${mediana(tiempos.con)} ms, sin costumbre ${mediana(tiempos.sin)} ms`);
