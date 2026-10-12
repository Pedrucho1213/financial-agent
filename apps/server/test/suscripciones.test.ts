import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearHerramientas } from "../src/ai/herramientas";
import { crearApp } from "../src/app";
import { crearInvitacion, crearUsuario } from "../src/auth";
import { abrirBaseDatos } from "../src/db/client";
import { cuentas } from "../src/db/schema";
import { listarAvisos } from "../src/finanzas/avisos";
import type { Contexto } from "../src/finanzas/contexto";
import { deshacer } from "../src/finanzas/movimientos";
import {
  cancelarRecurrente,
  cobrosPorAvisar,
  crearRecurrente,
  editarRecurrenteApp,
  eliminarRecurrenteApp,
  listarRecurrentes,
  pausarRecurrente,
  recurrentesApp,
} from "../src/finanzas/recurrentes";
import { revisar } from "../src/finanzas/revisor";
import { tablero } from "../src/finanzas/vista";
import { preparar } from "./ayuda";

const llamar = (ctx: Contexto, nombre: "editar_recurrente" | "listar_recurrentes", args: unknown) =>
  (crearHerramientas(ctx, [])[nombre].execute as (a: unknown, o: unknown) => Promise<any>)(args, {});

// Hoy es miércoles 7 de octubre: Netflix (día 8) se cobra mañana.
function conNetflix() {
  const p = preparar({ entradaId: "e1" });
  crearRecurrente(p.ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 8 });
  crearRecurrente(p.ctx, { nombre: "Spotify", tipo: "suscripcion", monto: 129, frecuencia: "mensual", dia: 20 });
  return p;
}
const estadoDe = (ctx: Contexto, nombre: string) => recurrentesApp(ctx).recurrentes.find((r) => r.nombre === nombre)?.estado;

describe("estado de las suscripciones", () => {
  test("una pausada no se cobra, no se recuerda ni se suma, pero la IA sabe que está pausada", () => {
    const { ctx } = conNetflix();
    revisar(ctx);
    expect(listarAvisos(ctx).avisos.some((a) => a.titulo.includes("Netflix"))).toBe(true);

    const id = recurrentesApp(ctx).recurrentes.find((r) => r.nombre === "Netflix")!.id;
    editarRecurrenteApp({ ...ctx, entradaId: undefined }, id, { estado: "pausada" });

    expect(listarRecurrentes(ctx).recurrentes.map((r) => r.nombre)).toEqual(["Spotify"]);
    expect(listarRecurrentes(ctx).total_mensual_gastos).toBe("$129");
    expect(listarRecurrentes(ctx).pausadas).toEqual(["Netflix"]);
    expect(cobrosPorAvisar(ctx)?.aviso).toBeUndefined();
    expect(tablero(ctx).recurrentesProximos.map((r) => r.nombre)).toEqual(["Spotify"]);
    // El aviso de "mañana se cobra Netflix" que ya existía no llega.
    expect(listarAvisos(ctx).avisos.some((a) => a.titulo.includes("Netflix"))).toBe(false);
    revisar(ctx);
    expect(listarAvisos(ctx).avisos.some((a) => a.titulo.includes("Netflix"))).toBe(false);

    const app = recurrentesApp(ctx);
    expect(app.mensualCentavos).toBe(12900);
    expect(app.recurrentes.map((r) => [r.nombre, r.estado, r.proximoCobro])).toEqual([
      ["Spotify", "activa", "2026-10-20"],
      ["Netflix", "pausada", null],
    ]);
  });

  test("por voz: pausa, reactiva y cancela; cancelar queda en Canceladas y deshacer lo regresa", async () => {
    const { ctx } = conNetflix();
    expect(await llamar({ ...ctx, entradaId: "e2" }, "editar_recurrente", { nombre: "netflix", pausar: true })).toMatchObject({ pausado: "Netflix" });
    expect(estadoDe(ctx, "Netflix")).toBe("pausada");
    const reanudado = await llamar({ ...ctx, entradaId: "e3" }, "editar_recurrente", { nombre: "Netflix", pausar: false });
    expect(reanudado.reanudado).toMatchObject({ nombre: "Netflix", proximo_cobro: "2026-10-08" });
    expect(estadoDe(ctx, "Netflix")).toBe("activa");

    expect(await llamar({ ...ctx, entradaId: "e4" }, "editar_recurrente", { nombre: "Netflix", cancelar: true })).toMatchObject({
      cancelado: { nombre: "Netflix" },
    });
    expect(estadoDe(ctx, "Netflix")).toBe("cancelada");
    expect(listarRecurrentes(ctx).recurrentes.map((r) => r.nombre)).toEqual(["Spotify"]);

    deshacer({ ...ctx, entradaId: "e5" });
    expect(estadoDe(ctx, "Netflix")).toBe("activa");
    expect(listarRecurrentes(ctx).recurrentes.map((r) => r.nombre)).toEqual(["Netflix", "Spotify"]);
  });

  test("reactivar una cancelada por voz; pausar algo que no está activo dice cuáles hay", async () => {
    const { ctx } = conNetflix();
    cancelarRecurrente(ctx, "Spotify");
    expect((await llamar(ctx, "editar_recurrente", { nombre: "Spotify", pausar: true })).error).toContain("Netflix");
    await llamar(ctx, "editar_recurrente", { nombre: "Spotify", pausar: false });
    expect(estadoDe(ctx, "Spotify")).toBe("activa");
  });

  test("cambiar el monto por voz a una pausada la deja pausada", async () => {
    const { ctx } = conNetflix();
    pausarRecurrente(ctx, "Netflix", true);
    await llamar({ ...ctx, entradaId: "e2", textoOriginal: "Netflix subió a 249" }, "editar_recurrente", { nombre: "Netflix", cambios: { monto: 249 } });
    expect(recurrentesApp(ctx).recurrentes.find((r) => r.nombre === "Netflix")).toMatchObject({ estado: "pausada", montoCentavos: 24900 });
  });

  test("archivada y eliminada", () => {
    const { ctx } = conNetflix();
    const id = recurrentesApp(ctx).recurrentes.find((r) => r.nombre === "Netflix")!.id;
    editarRecurrenteApp(ctx, id, { estado: "archivada" });
    expect(estadoDe(ctx, "Netflix")).toBe("archivada");
    expect(listarRecurrentes(ctx).recurrentes.map((r) => r.nombre)).toEqual(["Spotify"]);
    eliminarRecurrenteApp(ctx, id);
    expect(estadoDe(ctx, "Netflix")).toBeUndefined();
    expect(() => editarRecurrenteApp(ctx, id, { estado: "activa" })).toThrow("no existe");
  });
});

describe("editar desde la app", () => {
  test("cambia monto, día y cuenta en su lugar, y deshacer regresa lo de antes", () => {
    const { ctx, db, usuario } = conNetflix();
    const nu = db.insert(cuentas).values({ usuarioId: usuario.id, nombre: "Nu", tipo: "credito" }).returning().get();
    const antes = recurrentesApp(ctx).recurrentes.find((r) => r.nombre === "Netflix")!;
    const despues = editarRecurrenteApp({ ...ctx, entradaId: "e2" }, antes.id, { monto: 249, dia: 12, cuentaId: nu.id });
    expect(despues).toMatchObject({ id: antes.id, montoCentavos: 24900, dia: 12, cuenta: "Nu", proximoCobro: "2026-10-12" });
    expect(recurrentesApp(ctx).recurrentes).toHaveLength(2);

    deshacer({ ...ctx, entradaId: "e3" });
    expect(recurrentesApp(ctx).recurrentes.find((r) => r.id === antes.id)).toMatchObject({ montoCentavos: 21900, dia: 8, cuentaId: null });
  });

  test("valida día, mes de un anual y que la cuenta sea suya", () => {
    const { ctx, db } = conNetflix();
    const id = recurrentesApp(ctx).recurrentes[0]!.id;
    expect(() => editarRecurrenteApp(ctx, id, { frecuencia: "semanal" })).toThrow("entre 1 y 7");
    expect(() => editarRecurrenteApp(ctx, id, { frecuencia: "anual" })).toThrow("mes");
    expect(editarRecurrenteApp(ctx, id, { frecuencia: "anual", mes: 3 })).toMatchObject({ frecuencia: "anual", mes: 3, proximoCobro: "2027-03-08" });
    const otra = crearUsuario(db, "Ana");
    const suya = db.insert(cuentas).values({ usuarioId: otra.id, nombre: "BBVA", tipo: "debito" }).returning().get();
    expect(() => editarRecurrenteApp(ctx, id, { cuentaId: suya.id })).toThrow("cuenta no existe");
  });
});

describe("API /v1/recurrentes", () => {
  async function montar() {
    const db = abrirBaseDatos(":memory:");
    const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: [] as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const pedir = async (ruta: string, token: string, metodo = "GET", cuerpo?: unknown) => {
      const r = await app.request(`https://mac.tu-red.ts.net${ruta}`, {
        method: metodo,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      return { estado: r.status, cuerpo: (await r.json()) as any };
    };
    const registrar = async (nombre: string) => {
      const { codigo } = crearInvitacion(db);
      const r = await app.request("https://mac.tu-red.ts.net/v1/registro", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codigo, nombre, dispositivo: "iPhone" }),
      });
      return ((await r.json()) as { token: string }).token;
    };
    return { db, pedir, registrar };
  }

  test("crear, listar todos, pausar, editar y borrar; cada quien ve solo lo suyo", async () => {
    const { pedir, registrar } = await montar();
    const pedro = await registrar("Pedro");
    const ana = await registrar("Ana");

    const creado = await pedir("/v1/recurrentes", pedro, "POST", { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 8 });
    expect(creado.estado).toBe(201);
    expect(creado.cuerpo).toMatchObject({ nombre: "Netflix", estado: "activa", montoCentavos: 21900, categoria: expect.any(String) });
    const id = creado.cuerpo.id as string;

    expect((await pedir("/v1/recurrentes", pedro, "POST", { nombre: "", tipo: "suscripcion", monto: 0, frecuencia: "mensual", dia: 8 })).estado).toBe(400);

    const pausada = await pedir(`/v1/recurrentes/${id}`, pedro, "PATCH", { estado: "pausada" });
    expect(pausada.cuerpo).toMatchObject({ estado: "pausada", proximoCobro: null });
    expect((await pedir("/v1/recurrentes", pedro)).cuerpo.recurrentes).toEqual([]);
    expect((await pedir("/v1/recurrentes?todos=1", pedro)).cuerpo).toMatchObject({ mensualCentavos: 0, recurrentes: [{ id, estado: "pausada" }] });

    // Ana no ve ni toca lo de Pedro.
    expect((await pedir("/v1/recurrentes?todos=1", ana)).cuerpo.recurrentes).toEqual([]);
    expect((await pedir(`/v1/recurrentes/${id}`, ana, "PATCH", { estado: "activa" })).estado).toBe(400);
    expect((await pedir(`/v1/recurrentes/${id}`, ana, "DELETE")).estado).toBe(400);

    const editada = await pedir(`/v1/recurrentes/${id}`, pedro, "PATCH", { monto: 249, estado: "activa" });
    expect(editada.cuerpo).toMatchObject({ montoCentavos: 24900, estado: "activa" });
    expect((await pedir(`/v1/recurrentes/${id}`, pedro, "PATCH", { estado: "borrada" })).estado).toBe(400);

    expect((await pedir(`/v1/recurrentes/${id}`, pedro, "DELETE")).estado).toBe(200);
    expect((await pedir("/v1/recurrentes?todos=1", pedro)).cuerpo.recurrentes).toEqual([]);
  });
});

