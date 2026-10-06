import { describe, expect, test } from "bun:test";
import { crearContexto } from "../src/finanzas/contexto";
import {
  buscarMovimientos,
  crearMovimiento,
  deshacer,
  editarMovimiento,
  eliminarMovimiento,
  ErrorFinanzas,
  resumir,
} from "../src/finanzas/movimientos";
import { crearRecurrente, listarRecurrentes } from "../src/finanzas/recurrentes";
import { AHORA, preparar } from "./ayuda";

describe("registrar", () => {
  test("elige la categoría, guarda el comercio y la fecha", () => {
    const { ctx } = preparar();
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "café", comercio: "Starbucks" });
    expect(m).toMatchObject({ monto: "$85", categoria: "Comida > Café", comercio: "Starbucks", fecha: "2026-10-07" });
    expect(m.revisar).toBeUndefined();
  });

  test("entiende sinónimos y fechas relativas", () => {
    const { ctx } = preparar();
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 230, categoria: "Uber", fecha: "ayer" });
    expect(m).toMatchObject({ categoria: "Transporte > Taxi y apps", fecha: "2026-10-06" });
  });

  test("si no reconoce la categoría la marca para revisar", () => {
    const { ctx } = preparar();
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 10, categoria: "cosas raras" });
    expect(m).toMatchObject({ categoria: "Otros gastos", revisar: true });
  });

  test("ingresos van a categorías de ingreso", () => {
    const { ctx } = preparar();
    const m = crearMovimiento(ctx, { tipo: "ingreso", monto: 12000, categoria: "quincena" });
    expect(m.categoria).toBe("Sueldo");
  });

  test("la cuenta es opcional, y si se menciona se crea una sola vez", () => {
    const { ctx } = preparar();
    expect(crearMovimiento(ctx, { tipo: "gasto", monto: 1, categoria: "Súper" }).cuenta).toBeUndefined();
    expect(crearMovimiento(ctx, { tipo: "gasto", monto: 1, cuenta: "con la BBVA" }).cuenta).toBe("BBVA");
    expect(crearMovimiento(ctx, { tipo: "gasto", monto: 1, cuenta: "bbva" }).cuenta).toBe("BBVA");
    expect(crearMovimiento(ctx, { tipo: "gasto", monto: 1, cuenta: "efectivo" }).cuenta).toBe("Efectivo");
  });

  test("rechaza montos inválidos", () => {
    const { ctx } = preparar();
    expect(() => crearMovimiento(ctx, { tipo: "gasto", monto: 0 })).toThrow(ErrorFinanzas);
  });

  test("guarda otras monedas sin mezclarlas en el total", () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 20, moneda: "usd", categoria: "Software" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 100, categoria: "Café" });
    expect(resumir(ctx, {})).toMatchObject({ total: "$100", cantidad: 1, otras_monedas: ["20 USD"] });
  });
});

describe("editar y aprender", () => {
  test("corregir la categoría enseña al comercio", () => {
    const { ctx } = preparar();
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 47.5, categoria: "Súper", comercio: "Oxxo" });
    editarMovimiento(ctx, m.id, { categoria: "Antojos" });
    const otro = crearMovimiento(ctx, { tipo: "gasto", monto: 30, categoria: "Súper", comercio: "OXXO" });
    expect(otro.categoria).toBe("Comida > Antojos");
  });

  test("no deja editar movimientos de otro usuario", () => {
    const a = preparar();
    const m = crearMovimiento(a.ctx, { tipo: "gasto", monto: 50 });
    const otroUsuario = crearContexto({ ...a.ctx, usuarioId: "otro", ahora: AHORA });
    expect(() => editarMovimiento(otroUsuario, m.id, { monto: 1 })).toThrow(ErrorFinanzas);
  });
});

describe("buscar y resumir", () => {
  test("busca por texto, del más reciente al más antiguo", () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 800, categoria: "Gasolina" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 45, categoria: "Café" });
    const r = buscarMovimientos(ctx, { texto: "cafe" });
    expect(r.encontrados).toBe(2);
    expect(r.movimientos.map((m) => m.monto)).toEqual(["$45", "$60"]);
  });

  test("suma por periodo y por categoría padre", () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 45.5, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 1200, categoria: "Súper" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 800, categoria: "Gasolina" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 500, categoria: "Café", fecha: "2026-09-20" });
    crearMovimiento(ctx, { tipo: "ingreso", monto: 12000, categoria: "Sueldo" });

    expect(resumir(ctx, { periodo: "ayer", categoria: "café" })).toMatchObject({ total: "$105.50", cantidad: 2 });
    expect(resumir(ctx, { periodo: "este_mes", categoria: "Comida" })).toMatchObject({ total: "$1,305.50" });
    const porCategoria = resumir(ctx, { periodo: "este_mes", agruparPor: "categoria" });
    expect(porCategoria.total).toBe("$2,105.50");
    expect(porCategoria.grupos?.[0]).toEqual({ nombre: "Comida", total: "$1,305.50", cantidad: 3 });
    expect(resumir(ctx, { periodo: "este_mes", tipo: "ingreso" }).total).toBe("$12,000");
  });
});

describe("eliminar y deshacer", () => {
  test("eliminar es reversible", () => {
    const { ctx } = preparar({ entradaId: "e1" });
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 85 });
    const ctx2 = { ...ctx, entradaId: "e2" };
    eliminarMovimiento(ctx2, m.id);
    expect(buscarMovimientos(ctx2, {}).encontrados).toBe(0);
    const ctx3 = { ...ctx, entradaId: "e3" };
    expect(deshacer(ctx3).deshecho).toBe(true);
    expect(buscarMovimientos(ctx3, {}).encontrados).toBe(1);
  });

  test("deshacer revierte todo lo de la última entrada, no la actual", () => {
    const { ctx } = preparar({ entradaId: "e1" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 800, categoria: "Gasolina" });
    const ctx2 = { ...ctx, entradaId: "e2" };
    const m = crearMovimiento(ctx2, { tipo: "gasto", monto: 10 });
    editarMovimiento(ctx2, m.id, { monto: 15 });

    const ctx3 = { ...ctx, entradaId: "e3" };
    deshacer(ctx3); // revierte la entrada e2: la edición y la creación
    expect(buscarMovimientos(ctx3, {}).encontrados).toBe(2);
    deshacer(ctx3); // revierte la entrada e1
    expect(buscarMovimientos(ctx3, {}).encontrados).toBe(0);
    expect(deshacer(ctx3).deshecho).toBe(false);
  });

  test("deshacer una edición restaura el valor anterior", () => {
    const { ctx } = preparar({ entradaId: "e1" });
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café" });
    editarMovimiento({ ...ctx, entradaId: "e2" }, m.id, { monto: 95 });
    deshacer({ ...ctx, entradaId: "e3" });
    expect(buscarMovimientos(ctx, {}).movimientos[0]?.monto).toBe("$85");
  });
});

describe("recurrentes", () => {
  test("lista los próximos cobros y el total mensual", () => {
    const { ctx } = preparar({ entradaId: "e1" });
    crearRecurrente(ctx, { nombre: "Spotify", tipo: "suscripcion", monto: 199, frecuencia: "mensual", dia: 15 });
    crearRecurrente(ctx, { nombre: "Renta", tipo: "renta", monto: 9500, frecuencia: "mensual", dia: 1 });
    crearRecurrente(ctx, { nombre: "Quincena", tipo: "ingreso", monto: 12000, frecuencia: "quincenal", dia: 15 });
    const r = listarRecurrentes(ctx);
    expect(r.total_mensual_gastos).toBe("$9,699");
    expect(r.recurrentes.map((x) => x.nombre)).toEqual(["Spotify", "Quincena", "Renta"]);
    expect(listarRecurrentes(ctx, { dias: 10 }).recurrentes.map((x) => x.nombre)).toEqual(["Spotify", "Quincena"]);
  });

  test("valida el día", () => {
    const { ctx } = preparar();
    expect(() =>
      crearRecurrente(ctx, { nombre: "X", tipo: "otro", monto: 1, frecuencia: "semanal", dia: 9 }),
    ).toThrow(ErrorFinanzas);
  });
});
