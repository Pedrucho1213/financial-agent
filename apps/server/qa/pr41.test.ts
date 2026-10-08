// QA del PR #41: pesos y otra moneda en la misma frase. Los pesos se guardan; por la otra moneda solo se pregunta,
// diciendo la cifra completa (con comas de miles incluidas).
// Correr desde apps/server: bun test qa/pr41.test.ts
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { crearContexto } from "../src/finanzas/contexto";
import { estadosDeCuentas } from "../src/finanzas/cuentas";
import { llamada, preparar } from "../test/ayuda";

const fin = { content: [{ type: "text" as const, text: "Listo." }], finishReason: { unified: "stop" as const, raw: undefined }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] };

async function dictar(texto: string, cuentas: unknown[]) {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const respuestas = [llamada("cuentas", { cuentas }), fin, fin];
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: async () => respuestas.shift() as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" } as any);
  const r = await app.request("/v1/hablar", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ texto, client_id: `qa41-${crypto.randomUUID()}` }),
  });
  const cuerpo = (await r.json()) as { respuesta: string; acciones?: { resultado?: { confirmacion?: string } }[] };
  const ctx = crearContexto({ db, usuarioId: usuario.id, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" } as never);
  const saldos = Object.fromEntries(estadosDeCuentas(ctx).map((e) => [e.nombre, e.saldoCentavos === null ? null : e.saldoCentavos / 100]));
  const dicho = [cuerpo.respuesta, ...(cuerpo.acciones ?? []).map((a) => a.resultado?.confirmacion ?? "")].join(" ");
  return { saldos, dicho };
}

const CASOS = [
  { texto: "Tengo 300 dólares en Wise y 10 mil en Bancomer", cuentas: [{ cuenta: "Wise", saldo: 300 }, { cuenta: "Bancomer", saldo: 10000 }], cifra: "300", pesos: { Bancomer: 10000 } },
  { texto: "Tengo 1,500 dólares en Wise y 10 mil en Bancomer", cuentas: [{ cuenta: "Wise", saldo: 1500 }, { cuenta: "Bancomer", saldo: 10000 }], cifra: "1,500", pesos: { Bancomer: 10000 } },
  { texto: "Tengo 1,500 dólares en Wise y 10,000 pesos en Bancomer", cuentas: [{ cuenta: "Wise", saldo: 1500 }, { cuenta: "Bancomer", saldo: 10000 }], cifra: "1,500", pesos: { Bancomer: 10000 } },
  { texto: "Tengo 10,000 pesos en Bancomer y 2,000 USD en Wise", cuentas: [{ cuenta: "Bancomer", saldo: 10000 }, { cuenta: "Wise", saldo: 2000 }], cifra: "2,000", pesos: { Bancomer: 10000 } },
  { texto: "En Bancomer tengo 12,500 y en Wise 2,000 dólares", cuentas: [{ cuenta: "Bancomer", saldo: 12500 }, { cuenta: "Wise", saldo: 2000 }], cifra: "2,000", pesos: { Bancomer: 12500 } },
  { texto: "Tengo 2,000 USD en Wise", cuentas: [{ cuenta: "Wise", saldo: 2000 }], cifra: "2,000", pesos: {} },
  { texto: "Tengo 1,234.50 dólares en Wise y 3,000 en Revolut", cuentas: [{ cuenta: "Wise", saldo: 1234.5 }, { cuenta: "Revolut", saldo: 3000 }], cifra: "1,234.5", pesos: { Revolut: 3000 } },
];

describe("PR #41: pesos y otra moneda en una frase", () => {
  for (const c of CASOS) {
    test(`"${c.texto}": guarda los pesos, no guarda la otra moneda como pesos y pregunta por ${c.cifra}`, async () => {
      const { saldos, dicho } = await dictar(c.texto, c.cuentas);
      console.log(c.texto, "→", saldos, "|", dicho);
      for (const [cuenta, saldo] of Object.entries(c.pesos)) expect(saldos[cuenta]).toBe(saldo);
      expect(saldos.Wise ?? null).toBeNull();
      expect(dicho).toContain(`${c.cifra} d`);
      expect(dicho).toContain("?");
    });
  }
});
