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
