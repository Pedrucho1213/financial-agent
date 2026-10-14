// Lo que salió mal en los dictados de Pedro del 9 al 11 de octubre de 2026 (revisados el 12-oct).
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { cuentas, entradas, movimientos } from "../src/db/schema";
import { crearHerramientas, tituloCorto } from "../src/ai/herramientas";
import { analizar } from "../src/finanzas/analisis";
import type { Contexto } from "../src/finanzas/contexto";
import { crearMovimiento, resumir } from "../src/finanzas/movimientos";
import { listarRecurrentes } from "../src/finanzas/recurrentes";
import { sumarDias } from "../src/lib/fechas";
import { llamada, preparar, texto } from "./ayuda";

function montar(respuestas: unknown[]) {
  const { db, usuario, ctx } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
  let n = 0;
  const hablar = async (frase: string, extra: Record<string, unknown> = {}) => {
    const r = await app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ texto: frase, client_id: `hist-${String(++n).padStart(6, "0")}`, ...extra }),
    });
    return (await r.json()) as { respuesta: string; conversacion_id: string };
  };
  const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000).toISOString();
  const dictadoPrevio = (frase: string, respuesta: string, minutos: number, conversacionId: string, acciones: unknown[] = []) =>
    db
      .insert(entradas)
      .values({ usuarioId: usuario.id, clientId: crypto.randomUUID(), conversacionId, texto: frase, capturadoEn: hace(minutos), creadoEn: hace(minutos), estado: "listo", respuesta: { respuesta, conversacion_id: conversacionId, acciones } as never })
      .run();
  return { db, usuario, ctx, hablar, modelo, dictadoPrevio };
}

const X24 =
  "En la tienda X 24 compra algunas cositas de insumos como por ejemplo sueros con también en un pasito de proteína compra un yogur y me gasté un total de 100-3750 lo pagué con la tarjeta de crédito Revolut";
const PREGUNTA_X24 = 'Hay un monto confuso: "100-3750". No sé si el total fue 1003.75 o 3750 con descuento, así que pregunto antes de guardar: ¿cuánto fue el total exacto?';

test("'¿quedó algo pendiente?' repite la pregunta que quedó sin contestar, aunque sea de otra conversación", async () => {
  const { hablar, modelo, dictadoPrevio } = montar([]);
  dictadoPrevio(X24, PREGUNTA_X24, 50, "x24");
  const r = await hablar("Quedo algo pendiente ?");
  expect(r.respuesta).toStartWith("Sí. Cuando me dijiste «En la tienda X 24");
  expect(r.respuesta).toEndWith("¿cuánto fue el total exacto?");
  expect(modelo.doGenerateCalls).toHaveLength(0);
});

test("la pregunta puede ir a media respuesta: el gimnasio del 12-oct también quedó pendiente", async () => {
  const { hablar, modelo, dictadoPrevio } = montar([]);
  dictadoPrevio(
    "Son 500 pesos que transfería a mi gimnasio",
    "Son $500 de una transferencia a tu gimnasio. ¿Desde qué cuenta salió el dinero? Como es una transferencia a otra persona o negocio, lo registro como gasto en Gimnasio, pero dime si prefieres otra categoría.",
    87,
    "gimnasio",
  );
  const r = await hablar("Tenías una duda del último registro no");
  expect(r.respuesta).toBe("Sí. Cuando me dijiste «Son 500 pesos que transfería a mi gimnasio», te pregunté: ¿Desde qué cuenta salió el dinero?");
  expect(modelo.doGenerateCalls).toHaveLength(0);
});

test("sin preguntas abiertas no hay nada pendiente; una pregunta ya contestada tampoco cuenta", async () => {
  const { hablar, modelo, dictadoPrevio } = montar([]);
  dictadoPrevio(X24, PREGUNTA_X24, 50, "x24");
  dictadoPrevio("137.5 y la tienda fue x24", "Listo, X24 de $137.50 en Súper.", 49, "x24", [{ herramienta: "registrar_movimientos", resultado: {} }]);
  const r = await hablar("Tienes algún registro pendiente por hacer");
  expect(r.respuesta).toBe("No, no tengo nada pendiente: todo lo que me dictaste quedó anotado y no te debo ninguna pregunta.");
  expect(modelo.doGenerateCalls).toHaveLength(0);
});

test("lo pendiente de su dinero es otra pregunta: esa la contesta el modelo", async () => {
  for (const frase of [
    "¿tengo pagos pendientes?",
    "¿cuánto tengo pendiente en la tarjeta?",
    "¿tengo algo pendiente con la tarjeta Nu?",
    "¿qué me queda pendiente de la renta?",
    "¿qué suscripciones tengo pendientes este mes?",
    "¿qué servicios tengo pendientes?",
  ]) {
    const { hablar, modelo } = montar([texto("No tienes nada por pagar."), texto("No tienes nada por pagar.")]);
    await hablar(frase);
    expect([frase, modelo.doGenerateCalls.length > 0]).toEqual([frase, true]);
  }
});

test("después de 'Nueva conversación' en la app, empieza de cero", async () => {
  const { hablar } = montar([texto("¿Cuánto fue el total?"), texto("¿Cuánto fue el total?"), texto("¿De qué fue?"), texto("¿De qué fue?")]);
  const r1 = await hablar("gasté algo en X24");
  const r2 = await hablar("¿cómo voy?", { espera_ms: 5000, nueva: true });
  expect(r2.conversacion_id).not.toBe(r1.conversacion_id);
});

test("el resumen marca la pregunta sin contestar: no está hecha", async () => {
  const { hablar, modelo, dictadoPrevio } = montar([texto("Listo.")]);
  dictadoPrevio(X24, PREGUNTA_X24, 50, "x24");
  await hablar("137.5 y la tienda fue x24");
  expect(JSON.stringify(modelo.doGenerateCalls[0]?.prompt)).toContain("PREGUNTASTE y no se registró nada");
});

test("desde el chat de la app, sin conversación, sigue la de hace un minuto", async () => {
  const { hablar } = montar([texto("¿Cuánto fue el total?"), texto("¿Cuánto fue el total?"), texto("¿De qué fue?"), texto("¿De qué fue?")]);
  const r1 = await hablar("gasté algo en X24");
  const r2 = await hablar("137.5", { espera_ms: 5000 });
  expect(r2.conversacion_id).toBe(r1.conversacion_id);
});

const llamar = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});

test("'pues hoy' es el día de hoy para un cobro mensual; sin día ni 'hoy', se pregunta", async () => {
  const { ctx } = preparar();
  const spotify = { nombre: "Spotify", tipo: "suscripcion", monto: 139, frecuencia: "mensual" };
  const sinDia = await llamar({ ...ctx, textoOriginal: "Sí porfas" }, "registrar_recurrente", spotify);
  expect(sinDia.error).toContain("Falta el día");
  const r = await llamar({ ...ctx, textoOriginal: "Pues hoy" }, "registrar_recurrente", spotify);
  expect(r.error).toBeUndefined();
  expect(listarRecurrentes(ctx).recurrentes.map((x) => [x.nombre, x.proximo_cobro])).toEqual([["Spotify", ctx.hoy]]);
});

test("'¿en qué gasto más los sábados?': solo los sábados, por categoría; y por día de la semana", () => {
  const { ctx } = preparar();
  // AHORA es miércoles 7 de octubre: el sábado anterior es el 3.
  crearMovimiento(ctx, { tipo: "gasto", monto: 400, categoria: "Restaurantes", fecha: "2026-10-03" });
  crearMovimiento(ctx, { tipo: "gasto", monto: 100, categoria: "Súper", fecha: "2026-10-03" });
  crearMovimiento(ctx, { tipo: "gasto", monto: 900, categoria: "Súper", fecha: "2026-10-05" });
  const sabados = resumir(ctx, { periodo: "ultimos_30_dias", agruparPor: "categoria", diaSemana: "sábado" });
  expect(sabados.total).toBe("$500");
  expect(sabados.grupos?.[0]?.nombre).toBe("Comida");
  const porDia = resumir(ctx, { periodo: "ultimos_30_dias", agruparPor: "dia_semana" });
  expect(porDia.grupos?.map((g) => [g.nombre, g.total])).toEqual([
    ["lunes", "$900"],
    ["sábado", "$500"],
  ]);
});

test("con pocos días registrados, el 'al mes' de un recorte dice de dónde sale", () => {
  const { ctx } = preparar();
  for (const [dias, monto] of [[0, 334], [1, 189], [1, 702.9]] as const)
    crearMovimiento(ctx, { tipo: "gasto", monto, categoria: "Restaurantes", fecha: sumarDias(ctx.hoy, -dias) });
  const a = analizar(ctx, { enfoque: "ahorrar" });
  expect(a.respuesta).toContain("En Restaurantes llevas $1,225.90 en 2 días; a ese ritmo serían unos");
});

test("sin decir con qué pagó se le pregunta; 'con la tarjeta de crédito Revolut' se lo pone sin el modelo (14-oct)", async () => {
  const autozone = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 399, comercio: "AutoZone", categoria: "Auto" }] });
  const { hablar, modelo, db, usuario } = montar([autozone, texto("Listo, AutoZone de $399.")]);
  for (const [nombre, tipo] of [["Revolut", "debito"], ["Revolut crédito", "credito"], ["Nu", "credito"]] as const)
    db.insert(cuentas).values({ usuarioId: usuario.id, nombre, tipo }).run();
  const r1 = await hablar("gasté 399 en AutoZone", { espera_ms: 5000 });
  expect(r1.respuesta).toEndWith("¿Con qué lo pagaste?");
  const llamadas = modelo.doGenerateCalls.length;
  const r2 = await hablar("Pues con la tarjeta de crédito Revolut", { espera_ms: 5000 });
  expect(r2.conversacion_id).toBe(r1.conversacion_id);
  expect(r2.respuesta).toBe("Listo, quedó AutoZone de 399 pesos en Auto con Revolut crédito.");
  expect(modelo.doGenerateCalls).toHaveLength(llamadas);
  const cuenta = db.select().from(cuentas).all().find((c) => c.id === db.select().from(movimientos).get()!.cuentaId);
  expect(cuenta?.nombre).toBe("Revolut crédito");
});

test("si dice con qué pagó, o solo tiene una cuenta, no se pregunta", async () => {
  const conNu = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 120, comercio: "Oxxo", categoria: "Súper", cuenta: "Nu" }] });
  const { hablar, db, usuario } = montar([conNu, texto("Listo.")]);
  for (const nombre of ["Revolut", "Nu"]) db.insert(cuentas).values({ usuarioId: usuario.id, nombre, tipo: "debito" }).run();
  expect((await hablar("gasté 120 en el Oxxo con la Nu", { espera_ms: 5000 })).respuesta).not.toContain("?");
  const sinNu = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 80, comercio: "Oxxo", categoria: "Súper" }] });
  const una = montar([sinNu, texto("Listo.")]);
  una.db.insert(cuentas).values({ usuarioId: una.usuario.id, nombre: "Revolut", tipo: "debito" }).run();
  expect((await una.hablar("gasté 80 en el Oxxo", { espera_ms: 5000 })).respuesta).not.toContain("?");
});

test("'no sé' a '¿Con qué lo pagaste?' lo contesta el modelo y no toca el gasto", async () => {
  const autozone = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 399, comercio: "AutoZone", categoria: "Auto" }] });
  const { hablar, modelo, db, usuario } = montar([autozone, texto("Va, lo dejo sin cuenta."), texto("Va, lo dejo sin cuenta.")]);
  for (const nombre of ["Revolut", "Nu"]) db.insert(cuentas).values({ usuarioId: usuario.id, nombre, tipo: "debito" }).run();
  await hablar("gasté 399 en AutoZone", { espera_ms: 5000 });
  const llamadas = modelo.doGenerateCalls.length;
  expect((await hablar("no sé, no me acuerdo", { espera_ms: 5000 })).respuesta).toBe("Va, lo dejo sin cuenta.");
  expect(modelo.doGenerateCalls.length).toBeGreaterThan(llamadas);
  expect(db.select().from(movimientos).get()!.cuentaId).toBeNull();
});

test("el título del registro queda corto: lo de entre paréntesis pasa a la descripción (14-oct)", async () => {
  const { ctx } = preparar();
  const r = await llamar({ ...ctx, textoOriginal: "Acabo de transferir 2 mil pesos a un trabajador que vino a instalar un motor para mi portón" }, "registrar_movimientos", {
    movimientos: [{ tipo: "gasto", monto: 2000, comercio: "Trabajador (instalación de motor para portón)", categoria: "Mantenimiento" }],
  });
  expect([r.registrados[0].comercio, r.registrados[0].descripcion]).toEqual(["Trabajador", "Instalación de motor para portón"]);
  for (const [dicho, queda] of [
    ["Oxxo", "Oxxo"],
    ["7-Eleven", "7-Eleven"],
    ["Liverpool, Perisur", "Liverpool"],
    ["Motor del portón", "Motor del portón"],
  ]) expect(tituloCorto({ comercio: dicho }).comercio).toBe(queda);
  expect(tituloCorto({ comercio: "Plomero (fuga)", descripcion: "Arreglo del baño" }).descripcion).toBe("Arreglo del baño");
});
