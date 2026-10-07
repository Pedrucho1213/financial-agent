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
  revertirEntrada,
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

describe("hallazgos de QA", () => {
  test("la primera compra en un comercio no fija la categoría de las demás", () => {
    const { ctx } = preparar();
    crearMovimiento({ ...ctx, textoOriginal: "café en el Oxxo 35" }, { tipo: "gasto", monto: 35, comercio: "Oxxo", categoria: "Café" });
    const recarga = crearMovimiento(
      { ...ctx, textoOriginal: "recarga de celular en el Oxxo 200" },
      { tipo: "gasto", monto: 200, comercio: "Oxxo", categoria: "Internet y teléfono" },
    );
    expect(recarga.categoria).toBe("Vivienda > Internet y teléfono");
    crearMovimiento({ ...ctx, textoOriginal: "audífonos en Amazon 900" }, { tipo: "gasto", monto: 900, comercio: "Amazon", categoria: "Electrónica" });
    const playera = crearMovimiento({ ...ctx, textoOriginal: "una playera en Amazon 300" }, { tipo: "gasto", monto: 300, comercio: "Amazon", categoria: "Ropa y calzado" });
    expect(playera.categoria).toBe("Compras > Ropa y calzado");
  });

  test("lo aprendido de una corrección cede cuando la frase nombra otra categoría", () => {
    const { ctx } = preparar();
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 47.5, categoria: "Súper", comercio: "Oxxo" });
    editarMovimiento(ctx, m.id, { categoria: "Antojos" });
    const recarga = crearMovimiento(
      { ...ctx, textoOriginal: "recarga de celular en el Oxxo 200" },
      { tipo: "gasto", monto: 200, comercio: "Oxxo", categoria: "Internet y teléfono" },
    );
    expect(recarga.categoria).toBe("Vivienda > Internet y teléfono");
  });

  test("cambiar un gasto a ingreso no deja una categoría de gasto", () => {
    const { ctx } = preparar();
    const m = crearMovimiento({ ...ctx, textoOriginal: "gasté 500 en café" }, { tipo: "gasto", monto: 500, categoria: "Café" });
    expect(editarMovimiento(ctx, m.id, { tipo: "ingreso" }).categoria).toBe("Otros ingresos");
    const r = crearMovimiento({ ...ctx, textoOriginal: "me cayó el reembolso de 300" }, { tipo: "gasto", monto: 300 });
    expect(editarMovimiento(ctx, r.id, { tipo: "ingreso" }).categoria).toBe("Reembolsos");
    expect(editarMovimiento(ctx, r.id, { tipo: "transferencia" }).categoria).toBeUndefined();
  });

  test("un monto que se redondea a cero centavos no se guarda", () => {
    const { ctx } = preparar();
    expect(() => crearMovimiento(ctx, { tipo: "gasto", monto: 0.001 })).toThrow(ErrorFinanzas);
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 5 });
    expect(() => editarMovimiento(ctx, m.id, { monto: 0.004 })).toThrow(ErrorFinanzas);
  });

  test("una fecha que aún no llega se guarda como la dijo, marcada para revisar", () => {
    const { ctx } = preparar(); // 7 de octubre
    expect(crearMovimiento(ctx, { tipo: "gasto", monto: 80, categoria: "Café", fecha: "20 de octubre" })).toMatchObject({ fecha: "2026-10-20", revisar: true });
    expect(crearMovimiento(ctx, { tipo: "gasto", monto: 80, categoria: "Café", fecha: "ayer" }).revisar).toBeUndefined();
  });

  test("si 'deshaz eso' falla y se reintenta, no deshace dos cosas", () => {
    const { ctx } = preparar();
    crearMovimiento({ ...ctx, entradaId: "e1" }, { tipo: "gasto", monto: 100 });
    crearMovimiento({ ...ctx, entradaId: "e2" }, { tipo: "gasto", monto: 200 });
    const deshaz = { ...ctx, entradaId: "e3" };
    deshacer(deshaz);
    // La IA falló después de deshacer: el reintento primero revierte lo que hizo esa entrada...
    revertirEntrada(deshaz, "e3");
    const montos = () => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos.map((x) => x.monto).sort();
    expect(montos()).toEqual(["$100", "$200"]);
    // ...y al volver a deshacer, deshace lo mismo.
    deshacer(deshaz);
    expect(montos()).toEqual(["$100"]);
  });
});
