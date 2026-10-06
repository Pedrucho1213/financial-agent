import { expect, test } from "bun:test";
import type { z } from "zod";
import { crearHerramientas } from "../src/ai/herramientas";
import type { Contexto } from "../src/finanzas/contexto";
import { buscarMovimientos, crearMovimiento } from "../src/finanzas/movimientos";
import { crearRecurrente } from "../src/finanzas/recurrentes";
import { fechaDelTexto } from "../src/lib/fechas";
import { preparar } from "./ayuda";

// Las herramientas se llaman directo, como lo haría el modelo.
const herramientas = (ctx: Contexto) => crearHerramientas(ctx, []);
const llamar = <N extends keyof ReturnType<typeof herramientas>>(ctx: Contexto, nombre: N, args: unknown) =>
  (herramientas(ctx)[nombre].execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const todos = (ctx: Contexto) => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos;
const dictado = (ctx: Contexto, texto: string): Contexto => ({ ...ctx, textoOriginal: texto, entradaId: "dictado" });

test("toma la fecha que dijo el usuario cuando solo hay una", () => {
  const hoy = "2026-10-07"; // miércoles
  expect(fechaDelTexto("Ayer gasté 230 en Uber", hoy)).toBe("2026-10-06");
  expect(fechaDelTexto("El viernes fui al cine y gasté 320", hoy)).toBe("2026-10-02");
  expect(fechaDelTexto("el lunes pasado pagué la luz", hoy)).toBe("2026-10-05");
  expect(fechaDelTexto("café 60 ayer y gasolina 800 hoy", hoy)).toBeNull();
  expect(fechaDelTexto("gasté 85 en café", hoy)).toBeNull();
});

test("corrige la fecha que el modelo calculó mal u omitió", async () => {
  const { ctx } = preparar();
  const cine = dictado(ctx, "El viernes fui al cine y gasté 320");
  await llamar(cine, "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 320, fecha: "2026-09-29" }] });
  const uber = dictado(ctx, "Ayer gasté 230 en Uber");
  await llamar(uber, "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 230, comercio: "Uber" }] });
  const fechas = todos(ctx).map((m) => m.fecha).sort();
  expect(fechas).toEqual(["2026-10-02", "2026-10-06"]);
});

test("respeta fechas distintas cuando la frase trae varias", async () => {
  const { ctx } = preparar();
  const c = dictado(ctx, "café 60 ayer y gasolina 800 hoy");
  await llamar(c, "registrar_movimientos", {
    movimientos: [
      { tipo: "gasto", monto: 60, categoria: "Café", fecha: "ayer" },
      { tipo: "gasto", monto: 800, categoria: "Gasolina" },
    ],
  });
  expect(todos(ctx).map((m) => [m.monto, m.fecha])).toContainEqual(["$60", "2026-10-06"]);
  expect(todos(ctx).map((m) => [m.monto, m.fecha])).toContainEqual(["$800", "2026-10-07"]);
});

test("baja de la categoría general a la subcategoría con las palabras de la frase", () => {
  const { ctx } = preparar();
  const casos: [string, string | undefined, string][] = [
    ["Ayer gasté 230 en Uber", "Transporte", "Transporte > Taxi y apps"],
    ["Dos mil quinientos de luz", "Vivienda", "Vivienda > Luz"],
    ["Le pagué la renta al casero, 9500", "Vivienda", "Vivienda > Renta"],
    ["El viernes fui al cine y gasté 320", "Entretenimiento", "Entretenimiento > Cine"],
    ["Compré unos tenis de 1,899 en Liverpool", "Compras", "Compras > Ropa y calzado"],
    ["Pagué 150 de estacionamiento en efectivo", undefined, "Transporte > Estacionamiento"],
    ["Me pagaron la quincena, 12 mil", "Otros ingresos", "Sueldo"],
  ];
  for (const [texto, categoria, esperada] of casos) {
    const tipo = texto.includes("quincena") ? "ingreso" : "gasto";
    const m = crearMovimiento(dictado(ctx, texto), { tipo, monto: 100, categoria });
    expect(m.categoria).toBe(esperada);
  }
});

test("no cambia una subcategoría que el modelo eligió ni adivina si hay dos opciones", () => {
  const { ctx } = preparar();
  expect(crearMovimiento(dictado(ctx, "unos tenis para regalo"), { tipo: "gasto", monto: 1, categoria: "Regalos" }).categoria).toBe("Regalos");
  const dudoso = crearMovimiento(dictado(ctx, "café 60 y gasolina 800"), { tipo: "gasto", monto: 60 });
  expect(dudoso.categoria).toBe("Otros gastos");
  expect(dudoso.revisar).toBe(true);
});

test("edita buscando por lo que dijo, sin pedir el id antes", async () => {
  const { ctx } = preparar();
  crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café" });
  crearMovimiento(ctx, { tipo: "gasto", monto: 800, categoria: "Gasolina" });
  const r = await llamar(dictado(ctx, "El café de hoy fueron 95, no 85"), "editar_movimiento", {
    buscar: { texto: "café de hoy", monto: 85 },
    cambios: { monto: 95 },
  });
  expect(r.editado.monto).toBe("$95");
  expect(todos(ctx)).toHaveLength(2);
});

test("encuentra 'el Uber de ayer' y le cambia la cuenta", async () => {
  const { ctx } = preparar();
  crearMovimiento(ctx, { tipo: "gasto", monto: 230, categoria: "Taxi y apps", comercio: "Uber", fecha: "ayer" });
  crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café", fecha: "ayer" });
  const r = await llamar(ctx, "editar_movimiento", { buscar: { texto: "el Uber de ayer" }, cambios: { cuenta: "la Nu" } });
  expect(r.editado).toMatchObject({ comercio: "Uber", cuenta: "Nu" });
});

test("si varios coinciden, pide aclarar o toma el más reciente", async () => {
  const { ctx } = preparar();
  crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café", fecha: "ayer" });
  crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café" });
  const dudosa = await llamar(ctx, "eliminar_movimiento", { buscar: { texto: "café" } });
  expect(dudosa.error).toContain("Coinciden 2");
  const ultima = await llamar(ctx, "eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } });
  expect(ultima.eliminado.monto).toBe("$85");
  const nada = await llamar(ctx, "eliminar_movimiento", { buscar: { texto: "Liverpool" } });
  expect(nada.error).toContain("No encontré");
});

test("si no hay gastos pero sí pagos fijos, sugiere listar_recurrentes", async () => {
  const { ctx } = preparar();
  crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 5 });
  const r = await llamar(ctx, "consultar_gastos", { periodo: "este_mes", categoria: "Suscripciones" });
  expect(r.nota).toContain("listar_recurrentes");
});

test("acepta el tipo de recurrente en plural", () => {
  const { ctx } = preparar();
  const esquema = herramientas(ctx).listar_recurrentes.inputSchema as unknown as z.ZodType;
  expect(esquema.parse({ tipo: "suscripciones" })).toEqual({ tipo: "suscripcion" });
  expect(esquema.parse({ tipo: "Rentas" })).toEqual({ tipo: "renta" });
});

test("la moneda dicha en la frase manda si el modelo la omite", async () => {
  const { ctx } = preparar();
  await llamar(dictado(ctx, "Pagué 20 dólares de una app"), "registrar_movimientos", {
    movimientos: [{ tipo: "gasto", monto: 20, moneda: "MXN" }],
  });
  await llamar(dictado(ctx, "Pagué 300 pesos, como 15 dólares"), "registrar_movimientos", {
    movimientos: [{ tipo: "gasto", monto: 300 }],
  });
  await llamar(dictado(ctx, "20 dólares de app y 300 de comida"), "registrar_movimientos", {
    movimientos: [
      { tipo: "gasto", monto: 20, moneda: "USD" },
      { tipo: "gasto", monto: 300 },
    ],
  });
  expect(todos(ctx).map((m) => m.monto).sort()).toEqual(["$300", "$300", "20 USD", "20 USD"]);
});

test("la frase corrige monto, tipo, fecha y subcategoría cuando el modelo se equivoca", async () => {
  const { ctx } = preparar();
  const registrar = async (texto: string, movimiento: Record<string, unknown>) =>
    (await llamar(dictado(ctx, texto), "registrar_movimientos", { movimientos: [movimiento] })).registrados[0];
  // Pierde el "mil".
  expect(await registrar("Mil doscientos cincuenta en la farmacia", { tipo: "gasto", monto: 250 })).toMatchObject({
    monto: "$1,250",
    categoria: "Salud > Farmacia",
  });
  // "Cargué" es un gasto aunque el modelo diga ingreso.
  expect(await registrar("Cargué 650 de magna", { tipo: "ingreso", monto: 650, categoria: "Freelance" })).toMatchObject({
    tipo: "gasto",
    categoria: "Transporte > Gasolina",
  });
  // Fecha inventada sin que la frase hable de ningún día: queda hoy.
  expect((await registrar("Compré unos tenis de 1,899 en Liverpool", { tipo: "gasto", monto: 1899, fecha: "2026-10-05" })).fecha).toBe(
    ctx.hoy,
  );
  expect((await registrar("El 1 de este mes pagué 350 de internet", { tipo: "gasto", monto: 350 })).fecha).toBe("2026-10-01");
  // "gas" no es "gasolina".
  expect((await registrar("Antier pagué el gas, 480", { tipo: "gasto", monto: 480, categoria: "Gasolina" })).categoria).toBe(
    "Vivienda > Gas",
  );
  // Si la frase no dice cuál, se respeta la del modelo; con cantidades ("dos cafés") no se toca el monto.
  expect(await registrar("Compré dos cafés de 60", { tipo: "gasto", monto: 120, categoria: "Café" })).toMatchObject({
    monto: "$120",
    categoria: "Comida > Café",
  });
});
