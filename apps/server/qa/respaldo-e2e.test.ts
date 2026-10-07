// QA-020 respaldo: el modelo no usa herramientas y pregunta el monto. ¿Qué cuenta queda?
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { crearMovimiento } from "../src/finanzas/movimientos";
import { preparar, texto } from "../test/ayuda";

async function probar(frase: string, previos: (ctx: any) => void) {
  const { db, usuario, ctx } = preparar({ ahora: new Date() });
  previos(ctx);
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: async () => texto("¿De cuánto fue?") }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" } as any);
  const r = await app.request("/v1/hablar", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ texto: frase, client_id: "resp-" + Math.random().toString(36).slice(2, 12) }) });
  const cuerpo: any = await r.json();
  const movs: any = await (await app.request("/v1/movimientos?periodo=todo", { headers: { authorization: `Bearer ${token}` } })).json();
  const cuentas: any = await (await app.request("/v1/cuentas", { headers: { authorization: `Bearer ${token}` } })).json().catch(() => null);
  return { respuesta: cuerpo.respuesta, movs: movs.movimientos.map((m: any) => `${m.comercio ?? m.categoria}:${m.cuenta ?? "-"}`), cuentas: JSON.stringify(cuentas)?.slice(0, 300) };
}
const base = (ctx: any) => {
  crearMovimiento(ctx, { tipo: "gasto", monto: 1850, categoria: "Súper", comercio: "Walmart", cuenta: "BBVA" });
  crearMovimiento(ctx, { tipo: "gasto", monto: 230, categoria: "Taxi y apps", comercio: "Uber", fecha: "ayer", cuenta: "Efectivo" });
  crearMovimiento({ ...ctx }, { tipo: "gasto", monto: 99, categoria: "Café", comercio: "Starbucks", fecha: "antier", cuenta: "BBVA" });
};
for (const frase of [
  "El súper de hoy fue con la tarjeta de crédito Nu",
  "El súper de hoy fue con Nu, no con BBVA",
  "El súper fue con la Nu y el Uber con BBVA",
  "Lo del súper fue con tarjeta de crédito, no de débito",
  "El Starbucks de antier fue con la Nu",
  "El Uber de ayer lo pagué con la Nu",
  "El Walmart fue con efectivo",
]) {
  test(frase, async () => {
    const r = await probar(frase, base);
    console.log(JSON.stringify(frase), "→", r.respuesta, "|", r.movs.join(", "));
    expect(true).toBe(true);
  });
}
