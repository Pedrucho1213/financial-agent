// Sondas de QA para el PR #21 (planes, avisos y revisor nocturno). No es parte de la suite normal.
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { crearHerramientas } from "../src/ai/herramientas";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { avisos, movimientos } from "../src/db/schema";
import { guardarAviso, listarAvisos } from "../src/finanzas/avisos";
import { listarCategorias, sembrarCategorias } from "../src/finanzas/catalogos";
import { type Contexto, crearContexto } from "../src/finanzas/contexto";
import { crearMovimiento, deshacer } from "../src/finanzas/movimientos";
import {
  abonarPrestamo,
  crearMeta,
  estadoPresupuestos,
  fijarPresupuesto,
  listarMsi,
  listarPrestamos,
  registrarMsi,
  registrarPrestamo,
} from "../src/finanzas/planes";
import { revisar, revisarPendientes } from "../src/finanzas/revisor";
import { preparar } from "../test/ayuda";

const llamar = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const en = (ctx: Contexto, iso: string, extra: Partial<Contexto> = {}): Contexto => ({
  ...crearContexto({ db: ctx.db, usuarioId: ctx.usuarioId, zonaHoraria: ctx.zonaHoraria, monedaBase: ctx.monedaBase, ahora: new Date(iso) }),
  ...extra,
});

describe("PR21: 'mi último gasto no fue en dólares'", () => {
  test("[QA corregido] edita un ingreso posterior en vez del último gasto (buscar no tiene tipo ni moneda)", async () => {
    const { ctx } = preparar();
    // 9:00 gasto de 20 USD; 9:30 registra un ingreso.
    const usd = crearMovimiento(en(ctx, "2026-10-07T15:00:00Z", { entradaId: "e1" }), { tipo: "gasto", monto: 20, moneda: "USD", comercio: "Uber" });
    const ingreso = crearMovimiento(en(ctx, "2026-10-07T15:30:00Z", { entradaId: "e2" }), { tipo: "ingreso", monto: 500, descripcion: "venta" });
    const c = en(ctx, "2026-10-07T16:00:00Z", { entradaId: "e3", textoOriginal: "mi último gasto no fue en dólares" });
    // Lo que pide la instrucción nueva: mas_reciente y moneda.
    const r = await llamar(c, "editar_movimiento", { buscar: { mas_reciente: true, moneda: "USD" }, cambios: { moneda: "MXN" } });
    expect(r.editado?.id).toBe(usd.id); // QA-042 corregido: se edita el gasto en dólares
    expect(ctx.db.select().from(movimientos).where(eq(movimientos.id, ingreso.id)).get()!.moneda).toBe("MXN");
    expect(ctx.db.select().from(movimientos).where(eq(movimientos.id, usd.id)).get()!.moneda).toBe("MXN");
  });

  test("[QA corregido] 'el más reciente' se ordena por fecha del gasto, no por cuándo se dictó", async () => {
    const { ctx } = preparar();
    const cafe = crearMovimiento(en(ctx, "2026-10-07T15:00:00Z", { entradaId: "e1" }), { tipo: "gasto", monto: 50, comercio: "Starbucks" });
    // Después dicta un gasto de ayer en dólares.
    const usd = crearMovimiento(en(ctx, "2026-10-07T15:30:00Z", { entradaId: "e2" }), { tipo: "gasto", monto: 20, moneda: "USD", comercio: "Uber", fecha: "ayer" });
    const c = en(ctx, "2026-10-07T16:00:00Z", { entradaId: "e3", textoOriginal: "mi último gasto no fue en dólares" });
    const r = await llamar(c, "editar_movimiento", { buscar: { mas_reciente: true }, cambios: { moneda: "MXN" } });
    expect(r.editado?.id).toBe(usd.id); // lo último anotado, no la fecha más nueva
    expect(ctx.db.select().from(movimientos).where(eq(movimientos.id, cafe.id)).get()!.moneda).toBe("MXN");
  });
});

describe("PR21: préstamos", () => {
  test("[QA corregido] 'Juan me pagó 600' reparte el abono entre dos Juanes distintos sin preguntar", () => {
    const { ctx } = preparar();
    registrarPrestamo(ctx, { persona: "Juan Pérez", direccion: "me_deben", monto: 500 });
    registrarPrestamo(ctx, { persona: "Juan López", direccion: "me_deben", monto: 300 });
    expect(listarPrestamos(ctx).prestamos.map((p) => p.persona)).toEqual(["Juan Pérez", "Juan López"]);
    expect(() => abonarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 600 })).toThrow(/Coinciden/);
    expect(listarPrestamos(ctx, { todos: true }).prestamos.every((p) => p.pagadoCentavos === 0)).toBe(true);
  });
});

describe("PR21: meses sin intereses", () => {
  test("[QA corregido] deshacer la compra deja vivas las mensualidades que creó el revisor", () => {
    const { ctx } = preparar();
    registrarMsi(en(ctx, "2026-10-07T16:00:00Z", { entradaId: "msi", textoOriginal: "pantalla de 12 mil a 12 msi" }), {
      descripcion: "pantalla",
      total: 12000,
      meses: 12,
    });
    const nov = en(ctx, "2026-11-07T16:00:00Z");
    expect(revisar(nov).mensualidades).toBe(1);
    expect(deshacer(nov).deshecho).toBe(true);
    expect(listarMsi(nov, { todas: true }).compras).toHaveLength(0);
    const vivas = ctx.db
      .select()
      .from(movimientos)
      .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNotNull(movimientos.msiId), isNull(movimientos.eliminadoEn)))
      .all();
    expect(vivas).toHaveLength(0); // QA-044 corregido
  });

  test("[QA corregido] el aviso de la última mensualidad dice el monto sin el ajuste de centavos", () => {
    const { ctx } = preparar();
    const c = registrarMsi(ctx, { descripcion: "audífonos", total: 1000, meses: 3, fecha: "2026-08-08" });
    expect(c.proximoCargo).toBe("2026-10-08");
    expect(c.restanteCentavos).toBe(33334); // la última es de 333.34
    revisar(ctx);
    const aviso = listarAvisos(ctx).avisos.find((a) => a.tipo === "msi")!;
    expect(aviso.texto).toContain("mensualidad 3 de 3");
    expect(aviso.texto).toContain("333.34");
  });

  test("[QA corregido] 'a 6 meses con intereses' se trata como meses sin intereses", async () => {
    const { ctx } = preparar();
    const c = en(ctx, "2026-10-07T16:00:00Z", { entradaId: "x", textoOriginal: "compré una lavadora de 8000 a 6 meses con intereses" });
    const r = await llamar(c, "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 8000, descripcion: "lavadora" }] });
    expect(r.error ?? "").not.toMatch(/compra_msi/);
  });
});

describe("PR21: presupuestos", () => {
  test("[OBSERVACIÓN] los gastos en otra moneda no cuentan contra ningún presupuesto", () => {
    const { ctx } = preparar();
    fijarPresupuesto(ctx, { categoria: "Comida", monto: 1000 });
    crearMovimiento(ctx, { tipo: "gasto", monto: 100, moneda: "USD", categoria: "Restaurantes" });
    expect(estadoPresupuestos(ctx).presupuestos[0]!.gastadoCentavos).toBe(0);
  });

  test("(ok) 'semanal' no se confunde con el presupuesto general del mes", () => {
    const { ctx } = preparar();
    expect(() => fijarPresupuesto(ctx, { categoria: "semanal", monto: 2000 })).toThrow(/No existe la categoría/);
  });
});

describe("PR21: metas por la app", () => {
  test("[QA corregido] una fecha límite AAAA-MM-DD pasada se mueve un año sin avisar (en vez de 400)", async () => {
    const { db, usuario } = preparar();
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: [] as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const r = await app.request("/v1/metas", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ nombre: "Viaje", objetivo: 1000, fecha_limite: "2025-01-15" }),
    });
    expect(r.status).toBe(400); // QA-047 corregido
  });
});

describe("PR21: aislamiento entre usuarios (debe pasar)", () => {
  test("un usuario no puede tocar presupuestos, metas ni avisos de otro", async () => {
    const { db, usuario: a, ctx: ctxA } = preparar();
    const b = crearUsuario(db, "Ana");
    sembrarCategorias(db, b.id);
    const tokenB = crearDispositivo(db, b.id, "iPhone");
    const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: [] as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const pedir = async (ruta: string, metodo = "GET", cuerpo?: unknown) => {
      const r = await app.request(ruta, {
        method: metodo,
        headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      return { estado: r.status, cuerpo: (await r.json()) as any };
    };
    const comidaA = listarCategorias(db, a.id).find((c) => c.nombre === "Comida")!;
    const presA = fijarPresupuesto(ctxA, { categoria: "Comida", monto: 1000 });
    const metaA = crearMeta(ctxA, { nombre: "Viaje", objetivo: 1000 });
    guardarAviso(ctxA, { tipo: "hormiga", clave: "k", titulo: "t", texto: "x" });
    const avisoA = ctxA.db.select().from(avisos).get()!;
    expect((await pedir("/v1/presupuestos", "PUT", { categoria_id: comidaA.id, limite: 5 })).estado).toBe(400);
    expect((await pedir(`/v1/presupuestos/${presA.id}`, "DELETE")).estado).toBe(400);
    expect((await pedir(`/v1/metas/${metaA.id}/aportes`, "POST", { monto: 5 })).estado).toBe(400);
    expect((await pedir(`/v1/metas/${metaA.id}`, "DELETE")).estado).toBe(400);
    expect((await pedir(`/v1/avisos/${avisoA.id}/leido`, "POST")).estado).toBe(400);
    expect((await pedir(`/v1/avisos/${avisoA.id}/descartar`, "POST")).estado).toBe(400);
    expect((await pedir("/v1/presupuestos")).cuerpo.presupuestos).toHaveLength(0);
    expect((await pedir("/v1/metas")).cuerpo.metas).toHaveLength(0);
    expect((await pedir("/v1/avisos?todos=1")).cuerpo.avisos).toHaveLength(0);
    // Sin token: 401.
    expect((await app.request("/v1/presupuestos")).status).toBe(401);
    expect((await pedir("/v1/presupuestos?mes=2026-13")).estado).toBe(400);
  });

  test("el revisor corre para todos, no duplica avisos y no truena sin datos", () => {
    const { db, ctx } = preparar();
    const b = crearUsuario(db, "Ana");
    sembrarCategorias(db, b.id);
    for (let i = 0; i < 8; i++) crearMovimiento(ctx, { tipo: "gasto", monto: 65, comercio: "Starbucks", categoria: "Café", fecha: `2026-10-0${(i % 7) + 1}` });
    const opciones = { db, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" };
    const hora = new Date("2026-10-07T10:00:00Z");
    expect(revisarPendientes(opciones, hora).sort()).toEqual([ctx.usuarioId, b.id].sort());
    expect(revisarPendientes(opciones, hora)).toEqual([]);
    const n = db.select().from(avisos).all();
    expect(n.every((x) => x.usuarioId === ctx.usuarioId)).toBe(true);
    // Al otro día vuelve a correr y el gasto hormiga del mismo mes no se repite.
    expect(revisarPendientes(opciones, new Date("2026-10-08T10:00:00Z")).length).toBe(2);
    expect(db.select().from(avisos).all().filter((x) => x.tipo === "hormiga")).toHaveLength(1);
  });
});
