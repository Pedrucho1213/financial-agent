// QA del PR #44: con una sola tarjeta, "mi tarjeta de crédito ahora/solo/… tengo X" es esa tarjeta (QA-100).
// otraTarjetaNombrada toma la palabra que sigue a "tarjeta de crédito" como nombre de otra tarjeta.
// Correr desde apps/server: bun test qa/pr44.test.ts
import { describe, expect, test } from "bun:test";
import { crearHerramientas } from "../src/ai/herramientas";
import type { Contexto } from "../src/finanzas/contexto";
import { estadosDeCuentas, fijarCuenta } from "../src/finanzas/cuentas";
import { AHORA, preparar } from "../test/ayuda";

let reloj = 0;
const dictado = (ctx: Contexto, texto?: string): Contexto => {
  reloj += 1;
  return { ...ctx, ahoraIso: new Date(AHORA.getTime() + reloj * 60_000).toISOString(), textoOriginal: texto, entradaId: `qa44-${reloj}` };
};
const llamar = async (ctx: Contexto, nombre: string, args: unknown) =>
  (crearHerramientas(ctx, []) as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<any> }>)[nombre]!.execute(args, {});

const conNu = () => {
  const { ctx } = preparar();
  fijarCuenta(dictado(ctx), { cuenta: "Nu", tipo: "credito", limite: 30000, deuda: 12000 } as never);
  return ctx;
};

describe("QA-100: una sola tarjeta y un adverbio después de 'tarjeta de crédito'", () => {
  for (const frase of [
    "En mi tarjeta de crédito ahora tengo 7 mil disponibles",
    "En mi tarjeta de crédito solo tengo 7 mil disponibles",
    "En mi tarjeta de crédito nada más tengo 7 mil disponibles",
    "En mi tarjeta de crédito todavía tengo 7 mil disponibles",
    "En mi tarjeta de crédito hoy tengo 7 mil disponibles",
    "En mi tarjeta de crédito apenas tengo 7 mil disponibles",
    "En mi tarjeta de crédito llevo 7 mil",
  ]) {
    test(`"${frase}" con solo la Nu: no pregunta cuál`, async () => {
      const ctx = conNu();
      const r = await llamar(dictado(ctx, frase), "cuentas", { cuentas: [{ cuenta: "Nu", disponible: 7000 }] });
      expect(r.error).toBeUndefined();
      expect(estadosDeCuentas(ctx).map((e) => e.nombre)).toEqual(["Nu"]);
    });
  }
  test("control: 'tarjeta de crédito Invex' con solo la Nu sí pregunta", async () => {
    const ctx = conNu();
    const r = await llamar(dictado(ctx, "En mi tarjeta de crédito Invex tengo 7 mil disponibles"), "cuentas", { cuentas: [{ cuenta: "Nu", disponible: 7000 }] });
    expect(r.error).toContain("Nombró otra tarjeta");
  });
});
