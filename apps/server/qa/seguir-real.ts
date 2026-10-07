// ¿Cuándo deja el micrófono abierto el Atajo (PR #9)? Corre desde apps/server con Ollama:
//   bun qa/seguir-real.ts
// "seguir" = la respuesta termina en "?" (conSeguir en app.ts). Base en memoria; no toca la de Pedro.
import { hablar } from "../src/ai/asistente";
import { crearModelo, despertarModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { crearContexto } from "../src/finanzas/contexto";
import { crearMovimiento } from "../src/finanzas/movimientos";

// [frase, ¿debería seguir escuchando?]
const CASOS: [string, boolean][] = [
  ["Gasté 85 en un café", false],
  ["Uber 120 con la Nu", false],
  ["Pagué la renta, 9 mil", false],
  ["Me cobraron Netflix, 299", false],
  ["Ayer gasté 150 en el súper y 80 en gasolina", false],
  ["Cuánto llevo gastado este mes", false],
  ["Cuánto gasté en café", false],
  ["Voy bien este mes", false],
  ["Qué suscripciones tengo", false],
  ["Borra el último", false],
  ["El café fueron 95, no 85", false],
  ["Me llegó la quincena", true],
  ["Gasté en el súper", true],
  ["Borra el café", true], // hay dos cafés: debe preguntar cuál
  ["Hola", false],
  ["Regla", false],
  ["Gracias", false],
];

const seguir = (r: { respuesta?: string; pendiente?: boolean }) => !r.pendiente && !!r.respuesta && r.respuesta.includes("?");
const ia = { ...config.ia };
await despertarModelo(ia, config.ia.modelo);
const modelo = crearModelo(ia, config.ia.modelo);
let bien = 0;
for (const [frase, esperado] of CASOS) {
  const db = abrirBaseDatos(":memory:");
  const u = crearUsuario(db, "QA");
  sembrarCategorias(db, u.id);
  const base = { db, usuarioId: u.id, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
  const ctx = { ...crearContexto({ ...base, entradaId: "previa" }), textoOriginal: undefined };
  crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", comercio: "Starbucks" });
  crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café", comercio: "Cielito" });
  crearMovimiento(ctx, { tipo: "gasto", monto: 1850, categoria: "Súper", comercio: "Walmart", fecha: "ayer" });
  const t0 = performance.now();
  const r = await hablar({ ...base, modelo }, u.id, { texto: frase, clientId: crypto.randomUUID() });
  const ms = Math.round(performance.now() - t0);
  const s = seguir(r);
  if (s === esperado) bien++;
  console.log(`${s === esperado ? "✓" : "✗"} seguir=${s ? "sí" : "no"} (esperado ${esperado ? "sí" : "no"}) ${String(ms).padStart(5)} ms  ${frase}\n     → ${r.respuesta}`);
}
console.log(`\n${bien}/${CASOS.length} con el micrófono como se esperaba`);
