import { describe, expect, test } from "bun:test";
import { crearHerramientas } from "../src/ai/herramientas";
import type { Contexto } from "../src/finanzas/contexto";
import { activarEtiqueta, desactivarEtiqueta, etiquetasActivas, idsDeEtiquetas, renombrarEtiqueta, resumenEtiquetas } from "../src/finanzas/etiquetas";
import { buscarMovimientos, crearMovimiento, deshacer, editarMovimiento, resumir } from "../src/finanzas/movimientos";
import { AHORA, preparar } from "./ayuda";

let reloj = 0;
const dictado = (ctx: Contexto, texto?: string): Contexto => {
  reloj += 1;
  return { ...ctx, ahoraIso: new Date(AHORA.getTime() + reloj * 60_000).toISOString(), textoOriginal: texto, entradaId: `e-${reloj}` };
};
const llamar = async (ctx: Contexto, nombre: string, args: unknown) =>
  (crearHerramientas(ctx, []) as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<any> }>)[nombre]!.execute(args, {});
const todos = (ctx: Contexto) => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos;

describe("etiquetas", () => {
  test("al registrar con etiquetas se crean una vez, sin importar acentos ni el #", async () => {
    const { ctx } = preparar();
    await llamar(dictado(ctx, "gasté 300 en tacos, etiquétalo como viaje"), "registrar_movimientos", {
      movimientos: [{ tipo: "gasto", monto: 300, comercio: "Tacos", etiquetas: ["Viaje"] }],
    });
    await llamar(dictado(ctx, "hotel 2 mil, del viaje"), "registrar_movimientos", {
      movimientos: [{ tipo: "gasto", monto: 2000, descripcion: "hotel", etiquetas: ["#viaje"] }],
    });
    expect(todos(ctx).map((m) => m.etiquetas)).toEqual([["Viaje"], ["Viaje"]]);
    expect(resumenEtiquetas(ctx)).toMatchObject([{ nombre: "Viaje", cantidad: 2, gastadoCentavos: 230000 }]);
    // Consultar por etiqueta y agrupar.
    expect(resumir(ctx, { etiqueta: "viaje", periodo: "este_mes" }).total).toBe("$2,300");
    expect(resumir(ctx, { periodo: "este_mes", agruparPor: "etiqueta" }).grupos).toEqual([{ nombre: "Viaje", total: "$2,300", cantidad: 2 }]);
  });

  test("activa: los gastos de esos días la llevan solos, también los ya anotados; desactivar la detiene", async () => {
    const { ctx } = preparar();
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 100, descripcion: "gasolina de hoy" });
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 50, descripcion: "café de antier", fecha: "antier" });
    const r = await llamar(dictado(ctx, "estoy de viaje en Oaxaca hasta el domingo"), "etiqueta", { accion: "activar", etiqueta: "Viaje Oaxaca", hasta: "domingo" });
    // Miércoles 7 → domingo 11.
    expect(r.confirmacion).toBe("Listo, hasta el 2026-10-11 todo lo que gastes lleva la etiqueta Viaje Oaxaca. También se la puse a un gasto de esos días.");
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 300, descripcion: "mezcal" });
    // Un ingreso o una transferencia no la llevan solos.
    crearMovimiento(dictado(ctx), { tipo: "ingreso", monto: 1000, descripcion: "reembolso" });
    expect(todos(ctx).filter((m) => m.etiquetas?.includes("Viaje Oaxaca")).map((m) => m.descripcion).sort()).toEqual(["gasolina de hoy", "mezcal"]);
    expect(etiquetasActivas(ctx, "2026-10-11")).toHaveLength(1);
    expect(etiquetasActivas(ctx, "2026-10-12")).toHaveLength(0);
    desactivarEtiqueta(dictado(ctx), "viaje oaxaca");
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 80, descripcion: "taxi" });
    expect(todos(ctx).find((m) => m.descripcion === "taxi")!.etiquetas).toBeUndefined();
  });

  test("poner una etiqueta a lo de un periodo y quitarla; deshacer regresa como estaba", async () => {
    const { ctx } = preparar();
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 120, comercio: "Uber" });
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 80, comercio: "Uber", fecha: "ayer" });
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 60, comercio: "Oxxo" });
    const r = await llamar(dictado(ctx, "los Uber de esta semana son de trabajo"), "etiqueta", { accion: "poner", etiqueta: "trabajo", texto: "Uber", periodo: "esta_semana" });
    expect(r.confirmacion).toBe("Listo, etiqueté 2 movimientos como Trabajo, $200 en total.");
    expect(todos(ctx).filter((m) => m.etiquetas).length).toBe(2);
    const q = await llamar(dictado(ctx, "¿cuánto llevo de trabajo?"), "etiqueta", { accion: "consultar", etiqueta: "trabajo" });
    expect(q.respuesta).toBe("En Trabajo llevas $200 de gastos, en 2 movimientos.");
    deshacer(dictado(ctx, "deshaz eso"));
    expect(todos(ctx).filter((m) => m.etiquetas).length).toBe(0);
    // A uno solo: "el último".
    const uno = await llamar(dictado(ctx, "ponle la etiqueta trabajo a eso"), "etiqueta", { accion: "poner", etiqueta: "trabajo", mas_reciente: true });
    expect(uno.confirmacion).toBe("Listo, etiqueté un movimiento como Trabajo.");
    const quitar = await llamar(dictado(ctx, "quítale la etiqueta trabajo"), "etiqueta", { accion: "quitar", etiqueta: "trabajo", mas_reciente: true });
    expect(quitar.confirmacion).toBe("Listo, le quité la etiqueta Trabajo a un movimiento.");
  });

  test("editar_movimiento agrega y quita etiquetas sin perder las otras", async () => {
    const { ctx } = preparar();
    const m = crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 500, descripcion: "cena", etiquetas: ["boda", "amigos"] });
    editarMovimiento(dictado(ctx), m.id, { etiquetas: ["regalo"], quitarEtiquetas: ["amigos"] });
    expect(todos(ctx)[0]!.etiquetas).toEqual(["Boda", "Regalo"]);
    expect(() => editarMovimiento(dictado(ctx), m.id, { etiquetas: ["boda"] })).toThrow("Ese movimiento ya tenía esas etiquetas.");
  });

  test("renombrar y no duplicar; los ids de otro usuario no se guardan", () => {
    const { ctx } = preparar();
    const otro = preparar();
    const ajena = idsDeEtiquetas(otro.ctx, ["secreta"]);
    const [id] = idsDeEtiquetas(ctx, ["viajes"]);
    expect(idsDeEtiquetas(ctx, ["viaje"])).toEqual([id!]);
    renombrarEtiqueta(dictado(ctx), "viajes", "Vacaciones");
    const m = crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 10, etiquetaIds: [id!, ...ajena] });
    expect(m.etiquetas).toEqual(["Vacaciones"]);
  });

  test("activar con fechas inválidas o demasiado largas se rechaza", () => {
    const { ctx } = preparar();
    expect(() => activarEtiqueta(dictado(ctx), { nombre: "x", hasta: "2027-06-01" })).toThrow(/92 días/);
    expect(() => activarEtiqueta(dictado(ctx), { nombre: "x", hasta: "mañanita" })).toThrow(/No entendí/);
  });
});
