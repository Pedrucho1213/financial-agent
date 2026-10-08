// consultar_gastos arma en código solo los totales sencillos. Si la pregunta trae un filtro que la
// herramienta no expresa (método, exclusión, "menos", hora del día), la redacta el modelo (QA-085).
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { hablar } from "../src/ai/asistente";
import { buscarMovimientos, crearMovimiento } from "../src/finanzas/movimientos";
import { AHORA, llamada, preparar, texto } from "./ayuda";

const MODELO = "<<lo redactó el modelo>>";

async function preguntar(frase: string, args: Record<string, unknown> = {}) {
  const { db, usuario, ctx } = preparar({ ahora: new Date() });
  crearMovimiento(ctx, { tipo: "gasto", monto: 12500, categoria: "Renta", descripcion: "Renta", cuenta: "BBVA" } as never);
  crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Taxi y apps", comercio: "Uber", cuenta: "Nu" } as never);
  crearMovimiento(ctx, { tipo: "gasto", monto: 900, categoria: "Súper", comercio: "Walmart", cuenta: "Nu" } as never);
  const resp = [llamada("consultar_gastos", { periodo: "este_mes", ...args }), texto(MODELO)];
  const modelo = new MockLanguageModelV4({ doGenerate: async () => resp.shift() as never });
  const deps = { db, usuarioId: usuario.id, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", modelo };
  return (await hablar(deps as never, usuario.id, { texto: frase, clientId: crypto.randomUUID() })).respuesta;
}

describe("PR #39: respuesta de consultar_gastos armada en código", () => {
  for (const [frase, args] of [
    ["¿Cuánto gasté en Uber este mes?", { texto: "Uber" }],
    ["¿Y en Uber?", { texto: "Uber" }],
    ["¿Cuánto llevo este mes?", {}],
    ["¿Cuánto gasté en septiembre?", { periodo: "septiembre" }],
  ] as const) {
    test(`OK: "${frase}" sencilla, la arma el código`, async () => {
      const r = await preguntar(frase, args);
      expect(r).not.toBe(MODELO);
    });
  }

  test("HALLAZGO QA-085: «¿En qué gasté menos?» no contesta «gastaste más en…»", async () => {
    const r = await preguntar("¿En qué gasté menos este mes?", { agrupar_por: "categoria" });
    expect(r).not.toMatch(/gastaste mas|gastaste más/i);
  });

  for (const frase of [
    "¿Cuánto gasté sin contar la renta?",
    "¿Cuánto gasté este mes aparte de la renta?",
    "¿Cuánto gasté con la Nu?",
    "¿Cuánto gasté con tarjeta de crédito este mes?",
    "¿Cuánto gasté en efectivo?",
    "¿Cuánto gasté en la mañana?",
    "¿Cuánto gasté en comida que no fuera del súper?",
  ]) {
    test(`HALLAZGO QA-085: "${frase}" trae un filtro que la herramienta no expresa: lo redacta el modelo`, async () => {
      expect(await preguntar(frase, frase.includes("comida") ? { categoria: "Comida" } : {})).toBe(MODELO);
    });
  }
});

describe("sin contar algo", () => {
  test("consultar_gastos con excluir deja fuera la renta y lo redacta el modelo", async () => {
    const { db, usuario, ctx } = preparar({ ahora: new Date() });
    crearMovimiento(ctx, { tipo: "gasto", monto: 12500, categoria: "Renta", descripcion: "Renta" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Taxi y apps", comercio: "Uber" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 900, categoria: "Súper", comercio: "Walmart" } as never);
    const resp = [llamada("consultar_gastos", { periodo: "este_mes", excluir: "renta" }), texto(MODELO)];
    const modelo = new MockLanguageModelV4({ doGenerate: async () => resp.shift() as never });
    const r = await hablar({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" }, usuario.id, {
      texto: "¿Cuánto gasté este mes sin contar la renta?",
      clientId: crypto.randomUUID(),
    });
    expect(r.respuesta).toBe(MODELO);
    const resultado = JSON.stringify(modelo.doGenerateCalls[1]!.prompt);
    expect(resultado).toContain("$1,200");
    expect(resultado).not.toContain("$13,700");
  });
});

describe("el gasto más grande", () => {
  async function preguntarMasGrande(frase: string, args: Record<string, unknown>) {
    const { db, usuario, ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Taxi y apps", comercio: "Uber", fecha: "2026-10-06" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 1400, categoria: "Súper", comercio: "Walmart", fecha: "2026-10-03" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "2026-10-07" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 9000, categoria: "Viajes", fecha: "2026-09-20" } as never);
    const resp = [llamada("buscar_movimientos", args), texto(MODELO)];
    const modelo = new MockLanguageModelV4({ doGenerate: async () => resp.shift() as never });
    const r = await hablar({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" }, usuario.id, {
      texto: frase,
      clientId: crypto.randomUUID(),
      capturadoEn: AHORA.toISOString(),
    });
    return { respuesta: r.respuesta, llamadas: modelo.doGenerateCalls.length };
  }

  test("con mas_grandes trae cuál fue y lo dice sin otra vuelta del modelo", async () => {
    const r = await preguntarMasGrande("¿Cuál fue mi gasto más grande este mes?", { periodo: "este_mes", mas_grandes: true, limite: 1 });
    expect(r.llamadas).toBe(1);
    expect(r.respuesta).toMatch(/^Este mes, tu gasto más grande fue Walmart, de (\$1,400|1,400 pesos), el 3 de octubre\.$/);
  });

  test("sin periodo es el de siempre", async () => {
    const r = await preguntarMasGrande("¿Cuál fue mi gasto más grande?", { mas_grandes: true });
    expect(r.respuesta).toMatch(/^Tu gasto más grande fue Viajes, de (\$9,000|9,000 pesos), el 20 de septiembre\.$/);
  });

  test("los tres más grandes, o sin mas_grandes, los dice el modelo", async () => {
    expect((await preguntarMasGrande("¿Cuáles fueron mis tres gastos más grandes?", { mas_grandes: true, limite: 3 })).respuesta).toBe(MODELO);
    expect((await preguntarMasGrande("¿Cuál fue mi gasto más grande?", { periodo: "este_mes" })).respuesta).toBe(MODELO);
  });

  test("buscar_movimientos con mas_grandes ordena por monto", () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Café" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 50, moneda: "USD", categoria: "Software" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 1400, categoria: "Súper" } as never);
    const montos = buscarMovimientos(ctx, { mas_grandes: true }).movimientos.map((m) => m.monto);
    expect(montos[0]).toBe("$1,400");
    expect(montos[1]).toBe("$300");
  });
});
