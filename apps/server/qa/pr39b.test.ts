// QA del PR #39 (cae98a8): guardias en código para lo que M3 y W2 encontraron con el modelo real.
// QA-097: un monto que nadie dijo no se guarda. M3: "ajusta la renta" no edita el último café.
// Correr desde apps/server: bun test qa/pr39b.test.ts
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { movimientos } from "../src/db/schema";
import { crearMovimiento } from "../src/finanzas/movimientos";
import { llamada, preparar, texto } from "../test/ayuda";

async function dictar(frase: string, respuestas: unknown[], sembrar?: (ctx: any) => void) {
  const { db, usuario, ctx } = preparar({ ahora: new Date() }) as any;
  sembrar?.(ctx);
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const cola = [...respuestas, texto("¿De cuánto fue?"), texto("¿De cuánto fue?")];
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: async () => cola.shift() as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" } as any);
  const r = await app.request("/v1/hablar", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ texto: frase, client_id: `qa39b-${crypto.randomUUID()}` }),
  });
  const cuerpo = (await r.json()) as { respuesta: string };
  const movs = db.select().from(movimientos).all().filter((m: any) => !m.eliminadoEn);
  return { respuesta: cuerpo.respuesta, movs };
}

describe("QA-097: montos inventados", () => {
  for (const [frase, tipo, monto] of [
    ["Me llegó la quincena", "ingreso", 20000],
    ["Ya me pagaron", "ingreso", 15000],
    ["Fui al súper", "gasto", 1200],
    ["Pagué la luz", "gasto", 450],
  ] as const) {
    test(`"${frase}" sin cifra: no guarda los ${monto} que puso el modelo`, async () => {
      const { respuesta, movs } = await dictar(frase, [llamada("registrar_movimientos", { movimientos: [{ tipo, monto, categoria: tipo === "ingreso" ? "Sueldo" : "Súper" }] })]);
      console.log(frase, "→", respuesta, movs.length);
      expect(movs).toHaveLength(0);
    });
  }

  test("con cifra en la frase sí guarda (no rompe lo normal)", async () => {
    const { movs } = await dictar("Me llegó la quincena de 15 mil", [llamada("registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 15000, categoria: "Sueldo" }] }), texto("Listo.")]);
    expect(movs.map((m: any) => m.montoCentavos)).toEqual([15000_00]);
  });

  test("cifra en letra ('dos mil') sí guarda", async () => {
    const { movs } = await dictar("Gasté dos mil en el súper", [llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 2000, categoria: "Súper" }] }), texto("Listo.")]);
    expect(movs.map((m: any) => m.montoCentavos)).toEqual([2000_00]);
  });
});

describe("M3: editar el último solo si es de lo que habla la frase", () => {
  const sembrar = (ctx: any) => {
    crearMovimiento(ctx, { tipo: "gasto", monto: 8500, categoria: "Renta", descripcion: "Renta", fecha: "2026-10-01" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", comercio: "Starbucks" } as never);
  };
  for (const frase of ["Ajusta la renta a 9 mil", "Cambia la renta a 9000", "La renta fue de 9 mil"]) {
    test(`"${frase}" con mas_reciente no le pone 9,000 al café`, async () => {
      const { respuesta, movs } = await dictar(frase, [llamada("editar_movimiento", { buscar: { mas_reciente: true }, cambios: { monto: 9000 } }), texto("Listo.")], sembrar);
      const montos = movs.map((m: any) => m.montoCentavos / 100);
      console.log(frase, "→", respuesta, montos);
      // El café sigue en 85; la renta queda en 8,500 o en 9,000, nunca el café en 9,000.
      expect(montos).toContain(85);
      expect(montos).toHaveLength(2);
    });
  }
  test("'Borra el café' con mas_reciente sí borra el café (no rompe lo normal)", async () => {
    const { movs } = await dictar("Borra el café", [llamada("eliminar_movimiento", { buscar: { mas_reciente: true } }), texto("Listo.")], sembrar);
    expect(movs.map((m: any) => m.montoCentavos / 100)).toEqual([8500]);
  });
});

// W3 (cae98a8, modelo real, 2/2): en una conversación con turnos previos la guardia no aplica (ctx.enConversacion =
// historial.length > 0), así que un monto dicho para otra cosa ("tengo 20 mil en Revolut") se usa como quincena, y
// "mi tarjeta de crédito" con dos tarjetas acepta la que eligió el modelo. Solo debería valer si el turno anterior
// del asistente PREGUNTÓ ("¿de cuánto?", "¿cuál tarjeta?").
async function conversacion(turnos: { frase: string; respuestas: unknown[] }[]) {
  const { db, usuario } = preparar({ ahora: new Date() }) as any;
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const cola: unknown[] = [];
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: async () => (cola.shift() ?? texto("¿De cuánto fue?")) as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" } as any);
  let conversacion_id: string | undefined;
  const salidas: string[] = [];
  for (const t of turnos) {
    cola.push(...t.respuestas);
    const r = await app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ texto: t.frase, client_id: `qa39c-${crypto.randomUUID()}`, conversacion_id }),
    });
    const c = (await r.json()) as { respuesta: string; conversacion_id: string };
    conversacion_id = c.conversacion_id;
    salidas.push(c.respuesta);
    cola.length = 0;
  }
  const movs = db.select().from(movimientos).all().filter((m: any) => !m.eliminadoEn);
  const ctx = (await import("../src/finanzas/contexto")).crearContexto({ db, usuarioId: usuario.id, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" } as never);
  const cuentas = (await import("../src/finanzas/cuentas")).estadosDeCuentas(ctx);
  return { salidas, movs, cuentas };
}

describe("W3: la guardia vale también con turnos previos que no preguntaron", () => {
  test("'Tengo 20 mil en Revolut…' y luego 'Me llegó la quincena': no guarda 20 mil de ingreso", async () => {
    const { salidas, movs } = await conversacion([
      { frase: "Tengo 20 mil pesos en mi cuenta de Revolut y 10 mil en Bancomer", respuestas: [llamada("cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 20000 }, { cuenta: "Bancomer", saldo: 10000 }] }), texto("Listo.")] },
      { frase: "Me llegó la quincena", respuestas: [llamada("registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 20000, categoria: "Sueldo", descripcion: "Quincena" }] }), texto("Listo, registré tu quincena de $20,000.")] },
    ]);
    console.log(salidas, movs.map((m: any) => `${m.tipo}:${m.montoCentavos / 100}`));
    expect(movs.filter((m: any) => m.tipo === "ingreso")).toHaveLength(0);
  });

  test("'¿De cuánto fue?' → '15 mil' sí guarda (el caso para el que existe la excepción)", async () => {
    const { movs } = await conversacion([
      { frase: "Me llegó la quincena", respuestas: [texto("¿De cuánto fue tu quincena?")] },
      { frase: "15 mil", respuestas: [llamada("registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 15000, categoria: "Sueldo" }] }), texto("Listo.")] },
    ]);
    expect(movs.map((m: any) => m.montoCentavos / 100)).toEqual([15000]);
  });

  test("dos tarjetas y 'Tengo 7000 disponibles en mi tarjeta de crédito': no se la asigna a la que eligió el modelo", async () => {
    const { salidas, cuentas } = await conversacion([
      { frase: "Mi tarjeta de crédito Nu tiene un límite de 30 mil y llevo usados 12 mil", respuestas: [llamada("cuentas", { cuentas: [{ cuenta: "Nu", tipo: "credito", limite: 30000, deuda: 12000 }] }), texto("Listo.")] },
      { frase: "Mi BBVA Azul tiene límite de 20 mil", respuestas: [llamada("cuentas", { cuentas: [{ cuenta: "BBVA Azul", tipo: "credito", limite: 20000 }] }), texto("Listo.")] },
      { frase: "Tengo 7000 disponibles en mi tarjeta de crédito", respuestas: [llamada("cuentas", { cuentas: [{ cuenta: "BBVA Azul", tipo: "credito", disponible: 7000, limite: 20000 }] }), texto("Listo, en BBVA Azul te quedan $7,000.")] },
    ]);
    const azul = cuentas.find((c: any) => c.nombre === "BBVA Azul");
    console.log(salidas.at(-1), azul);
    expect(azul?.disponibleCentavos ?? null).not.toBe(7000_00);
  });
});

// c4670ab: registrar_movimientos rechaza un registro si la frase es una corrección y ya hay uno con el otro monto.
// Que no se coma un gasto nuevo con autocorrección al dictar cuando hay otro de ese monto que no tiene nada que ver.
describe("c4670ab: corrección contra registro nuevo", () => {
  const conGasolina = (ctx: any) => {
    const hace = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    crearMovimiento(ctx, { tipo: "gasto", monto: 450, categoria: "Gasolina", comercio: "Pemex", fecha: hace } as never);
  };
  for (const [frase, nuevo, comercio] of [
    ["Gasté 450 en la farmacia, no, perdón, fueron 540", 540, "Farmacia"],
    ["Pagué 450 en el súper, no, espera, eran 540", 540, "Walmart"],
  ] as const) {
    test(`"${frase}" con un Pemex de 450 de hace días: guarda el nuevo y no toca el Pemex`, async () => {
      const { respuesta, movs } = await dictar(frase, [llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: nuevo, comercio, categoria: "Otros gastos" }] }), texto("Listo.")], conGasolina);
      const montos = movs.map((m: any) => m.montoCentavos / 100).sort((a: number, b: number) => a - b);
      console.log(frase, "→", respuesta, montos);
      expect(montos).toEqual([450, nuevo]);
    });
  }

  test('"El café de hoy fueron 95, no 85" con el café de 85 de hoy: no registra otro', async () => {
    const { movs } = await dictar(
      "El café de hoy fueron 95, no 85",
      [llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 95, comercio: "Starbucks", categoria: "Café" }] }), texto("Listo.")],
      (ctx: any) => crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", comercio: "Starbucks" } as never),
    );
    expect(movs).toHaveLength(1);
  });

  test('"Gasté 450 en la farmacia, no, perdón, fueron 540" con un Oxxo de 450 de HOY: guarda la farmacia', async () => {
    const { respuesta, movs } = await dictar(
      "Gasté 450 en la farmacia, no, perdón, fueron 540",
      [llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 540, comercio: "Farmacia", categoria: "Otros gastos" }] }), texto("Listo.")],
      (ctx: any) => crearMovimiento(ctx, { tipo: "gasto", monto: 450, categoria: "Súper", comercio: "Oxxo" } as never),
    );
    const montos = movs.map((m: any) => m.montoCentavos / 100).sort((a: number, b: number) => a - b);
    console.log("Oxxo hoy →", respuesta, montos);
    expect(montos).toEqual([450, 540]);
  });
});

// Revisión sobre c4670ab (corregido en 01b74e6): la guardia de corrección, acotada al mismo comercio o categoría
// en los últimos días, y "los dos mil" no son dos movimientos.
describe("01b74e6: casos de Revisión", () => {
  test('"El café de hoy fueron 95, no 85" sin café de 85 y con un Uber de 85 de la semana pasada: el Uber no cambia', async () => {
    const hace = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const sembrar = (ctx: any) => crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Taxi y apps", comercio: "Uber", fecha: hace } as never);
    for (const respuestas of [
      [llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 95, comercio: "Café", categoria: "Café" }] }), texto("Listo.")],
      [llamada("editar_movimiento", { buscar: { mas_reciente: true }, cambios: { monto: 95 } }), texto("Listo.")],
      [llamada("editar_movimiento", { buscar: { monto: 85 }, cambios: { monto: 95 } }), texto("Listo.")],
    ]) {
      const { respuesta, movs } = await dictar("El café de hoy fueron 95, no 85", respuestas, sembrar);
      const montos = movs.map((m: any) => m.montoCentavos / 100);
      console.log("café sin café →", (respuestas[0] as any).content[0].toolName, respuesta, montos);
      expect(montos).toContain(85);
    }
  });

  test('"Cambia los dos mil del súper a 2,500" con dos súper de 2,000: no edita los dos sin preguntar', async () => {
    const sembrar = (ctx: any) => {
      crearMovimiento(ctx, { tipo: "gasto", monto: 2000, categoria: "Súper", comercio: "Walmart" } as never);
      crearMovimiento(ctx, { tipo: "gasto", monto: 2000, categoria: "Súper", comercio: "Soriana" } as never);
    };
    const { respuesta, movs } = await dictar(
      "Cambia los dos mil del súper a 2,500",
      [llamada("editar_movimiento", { buscar: { categoria: "Súper", monto: 2000 }, cambios: { monto: 2500 } }), texto("¿Cuál de los dos?")],
      sembrar,
    );
    const montos = movs.map((m: any) => m.montoCentavos / 100).sort((a: number, b: number) => a - b);
    console.log("los dos mil →", respuesta, montos);
    expect(montos).not.toEqual([2500, 2500]);
  });
});
