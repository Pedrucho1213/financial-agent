import { describe, expect, test } from "bun:test";
import { crearHerramientas } from "../src/ai/herramientas";
import type { Contexto } from "../src/finanzas/contexto";
import { buscarMovimientos, crearMovimiento } from "../src/finanzas/movimientos";
import { crearRecurrente } from "../src/finanzas/recurrentes";
import { preparar } from "./ayuda";

const llamar = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const dictado = (ctx: Contexto, frase: string): Contexto => ({ ...ctx, textoOriginal: frase, entradaId: crypto.randomUUID() });
const todos = (ctx: Contexto) => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos;

describe("un registro repetido", () => {
  const cafe = { tipo: "gasto", monto: 85, comercio: "Starbucks", categoria: "Café" } as never;

  test("con dos idénticos, borra el repetido sin preguntar cuál", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, cafe);
    const segundo = crearMovimiento(ctx, cafe);
    const r = await llamar(dictado(ctx, "El café de 85 lo anotaste dos veces"), "eliminar_movimiento", { buscar: { texto: "café", monto: 85 } });
    expect(r.error).toBeUndefined();
    expect(r.eliminado.id).toBe(segundo.id);
    expect(todos(ctx)).toHaveLength(1);
  });

  test("si se distinguen (otro día, otra cuenta), sigue preguntando cuál", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, cafe);
    crearMovimiento(ctx, { ...(cafe as object), fecha: "ayer" } as never);
    crearMovimiento(ctx, { ...(cafe as object), cuenta: "Nu" } as never);
    const r = await llamar(dictado(ctx, "Borra el café de 85"), "eliminar_movimiento", { buscar: { texto: "café", monto: 85 } });
    expect(r.error).toContain("Coinciden 3");
    expect(todos(ctx)).toHaveLength(3);
  });

  test("si pidió borrar varios, no se queda con uno solo", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, cafe);
    crearMovimiento(ctx, cafe);
    const r = await llamar(dictado(ctx, "Borra los cafés de 85"), "eliminar_movimiento", { buscar: { texto: "café", monto: 85 } });
    expect(r.error).toContain("Coinciden 2");
  });
});

describe("corregir algo que no es un pago fijo", () => {
  test('"ajusta la renta a 9 mil" sin renta fija le dice a la IA cuál movimiento corregir', async () => {
    const { ctx } = preparar();
    const renta = crearMovimiento(ctx, { tipo: "gasto", monto: 8500, descripcion: "Renta", categoria: "Renta" } as never);
    const r = await llamar(dictado(ctx, "Ajusta la renta a 9 mil"), "editar_recurrente", { nombre: "renta", cambios: { monto: 9000 } });
    expect(r.error).toContain(`editar_movimiento con id ${renta.id}`);
    expect(r.error).toContain("$8,500");
  });

  test('"la renta subió a 9 mil" no reescribe la renta que ya pagó: pregunta', async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 8500, descripcion: "Renta", categoria: "Renta" } as never);
    const r = await llamar(dictado(ctx, "La renta subió a 9 mil"), "editar_recurrente", { nombre: "renta", cambios: { monto: 9000 } });
    expect(r.error).toContain("No cambies nada: pregunta si corrige ese movimiento o la guarda como pago fijo de $9,000");
    expect(r.error).not.toContain("editar_movimiento");
    expect(todos(ctx)[0]!.monto).toBe("$8,500");
  });

  test("una renta de hace semanas tampoco se corrige sin preguntar", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 8500, descripcion: "Renta", categoria: "Renta", fecha: "2026-09-01" } as never);
    const r = await llamar(dictado(ctx, "Ajusta la renta a 9 mil"), "editar_recurrente", { nombre: "renta", cambios: { monto: 9000 } });
    expect(r.error).toContain("pregunta si corrige ese movimiento");
    expect(r.error).toContain("del 2026-09-01");
  });

  test("con una renta fija guardada, cambia la fija", async () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Renta", tipo: "gasto", monto: 8500, frecuencia: "mensual", dia: 1 } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 8500, descripcion: "Renta", categoria: "Renta" } as never);
    const r = await llamar(dictado(ctx, "La renta subió a 9 mil"), "editar_recurrente", { nombre: "renta", cambios: { monto: 9000 } });
    expect(r.error).toBeUndefined();
    expect(r.cambiado).toBeDefined();
  });

  test("sin nada que se llame así, el error es el de siempre", async () => {
    const { ctx } = preparar();
    const r = await llamar(dictado(ctx, "Cancela Netflix"), "editar_recurrente", { nombre: "Netflix", cancelar: true });
    expect(r.error).toContain('No tengo un pago recurrente llamado "Netflix"');
  });
});

describe("el último movimiento no es el que nombra", () => {
  test('"ajusta la renta a 9 mil" con solo mas_reciente no le pone 9 mil al café', async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 8500, descripcion: "Renta", categoria: "Renta", fecha: "ayer" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café" } as never);
    const c = dictado(ctx, "Ajusta la renta a 9 mil");
    const r = await llamar(c, "editar_movimiento", { buscar: { mas_reciente: true }, cambios: { monto: 9000 } });
    expect(r.error).toContain('buscar con texto "renta"');
    expect(todos(ctx).map((m) => m.monto).sort()).toEqual(["$8,500", "$85"]);
    // Buscándola por nombre, sí.
    const bien = await llamar(c, "editar_movimiento", { buscar: { texto: "renta" }, cambios: { monto: 9000 } });
    expect(bien.error).toBeUndefined();
    expect(todos(ctx).map((m) => m.monto).sort()).toEqual(["$85", "$9,000"]);
  });

  test("borrar con solo mas_reciente tampoco borra otro", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, comercio: "Uber", categoria: "Taxi y apps" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café" } as never);
    const r = await llamar(dictado(ctx, "Borra el Uber"), "eliminar_movimiento", { buscar: { mas_reciente: true } });
    expect(r.error).toContain('"uber"');
    expect(todos(ctx)).toHaveLength(2);
  });

  test("si nombra lo que tiene el último, o lo que le va a poner, o nada, edita el último", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, comercio: "Uber", categoria: "Taxi y apps" } as never);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café" } as never);
    expect((await llamar(dictado(ctx, "El café fueron 95"), "editar_movimiento", { buscar: { mas_reciente: true }, cambios: { monto: 95 } })).error).toBeUndefined();
    expect((await llamar(dictado(ctx, "Fueron 90"), "editar_movimiento", { buscar: { mas_reciente: true }, cambios: { monto: 90 } })).error).toBeUndefined();
    expect(
      (await llamar(dictado(ctx, "Cámbialo a Regalos"), "editar_movimiento", { buscar: { mas_reciente: true }, cambios: { categoria: "Regalos" } })).error,
    ).toBeUndefined();
  });
});
