// QA del PR #38: la contabilidad de cuentas (gasto, transferencia, pago de tarjeta, ingreso a la tarjeta, borrar, editar, reanclar el saldo).
// Correr desde apps/server: bun test qa/pr38.test.ts
import { expect, test } from "bun:test";
import { crearContexto } from "../src/finanzas/contexto";
import * as C from "../src/finanzas/cuentas";
import { crearMovimiento, editarMovimiento, eliminarMovimiento } from "../src/finanzas/movimientos";
import { preparar } from "../test/ayuda";

test("cuentas: contabilidad básica", () => {
  const { db, usuario } = preparar({ ahora: new Date("2026-10-08T15:00:00Z") });
  const ctxEn = (min: number, texto = "") => crearContexto({ db, usuarioId: usuario.id, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", ahora: new Date(Date.parse("2026-10-08T15:00:00Z") + min * 60000), textoOriginal: texto } as never);
  C.fijarCuenta(ctxEn(0, "Tengo 20 mil en Revolut"), { cuenta: "Revolut", saldo: 20000 } as never);
  C.fijarCuenta(ctxEn(0, "y 10 mil en Bancomer"), { cuenta: "Bancomer", saldo: 10000 } as never);
  C.fijarCuenta(ctxEn(0, "Mi tarjeta de crédito Nu tiene límite de 30 mil y llevo usados 12 mil"), { cuenta: "Nu", tipo: "credito", limite: 30000, deuda: 12000 } as never);
  const ver = (min: number) => Object.fromEntries(C.estadosDeCuentas(ctxEn(min)).map((e) => [e.nombre, { s: e.saldoCentavos! / 100, d: e.deudaCentavos === null ? null : e.deudaCentavos / 100, disp: e.disponibleCentavos! / 100 }]));
  const g = crearMovimiento(ctxEn(1), { tipo: "gasto", monto: 300, categoria: "Antojos", cuenta: "Revolut" } as never);
  const t = crearMovimiento(ctxEn(2), { tipo: "transferencia", monto: 5000, cuenta: "Bancomer", cuentaDestino: "Revolut" } as never);
  const p = crearMovimiento(ctxEn(3), { tipo: "pago_tarjeta", monto: 2000, cuenta: "Revolut", cuentaDestino: "Nu" } as never);
  const n = crearMovimiento(ctxEn(4), { tipo: "gasto", monto: 1500, categoria: "Súper", cuenta: "Nu" } as never);
  const i = crearMovimiento(ctxEn(5), { tipo: "ingreso", monto: 1000, categoria: "Reembolsos", cuenta: "Nu" } as never);
  console.log("tras todo:", ver(10));
  expect(ver(10)).toEqual({ Revolut: { s: 22700, d: null, disp: 22700 }, Bancomer: { s: 5000, d: null, disp: 5000 }, Nu: { s: -10500, d: 10500, disp: 19500 } });
  eliminarMovimiento(ctxEn(11), (t as any).id ?? (t as any).movimiento?.id);
  console.log("sin la transferencia:", ver(12));
  expect(ver(12).Bancomer!.s).toBe(10000);
  expect(ver(12).Revolut!.s).toBe(17700);
  editarMovimiento(ctxEn(13), (g as any).id ?? (g as any).movimiento?.id, { monto: 500 } as never);
  console.log("gasto editado a 500:", ver(14));
  expect(ver(14).Revolut!.s).toBe(17500);
  // Decir el saldo de nuevo reancla: lo anterior ya va incluido.
  C.fijarCuenta(ctxEn(20, "Ahora tengo 15 mil en Revolut"), { cuenta: "Revolut", saldo: 15000 } as never);
  crearMovimiento(ctxEn(21), { tipo: "gasto", monto: 100, categoria: "Antojos", cuenta: "Revolut" } as never);
  expect(ver(22).Revolut!.s).toBe(14900);
  // Un gasto de ayer anotado hoy no cambia un saldo que se dijo hoy.
  crearMovimiento(ctxEn(23), { tipo: "gasto", monto: 999, categoria: "Antojos", cuenta: "Revolut", fecha: "2026-10-07" } as never);
  expect(ver(24).Revolut!.s).toBe(14900);
});
