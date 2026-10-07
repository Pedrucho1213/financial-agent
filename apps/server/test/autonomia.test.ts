import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { construirInstrucciones } from "../src/ai/instrucciones";
import { crearHerramientas } from "../src/ai/herramientas";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import type { Contexto } from "../src/finanzas/contexto";
import { cuentaHabitual, habitoMencionado, habitos } from "../src/finanzas/habitos";
import { listarMemorias } from "../src/finanzas/memorias";
import { buscarMovimientos, crearMovimiento } from "../src/finanzas/movimientos";
import { crearRecurrente } from "../src/finanzas/recurrentes";
import { AHORA, llamada, preparar, texto } from "./ayuda";

const llamar = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const dictado = (ctx: Contexto, frase: string): Contexto => ({ ...ctx, textoOriginal: frase, entradaId: crypto.randomUUID() });
const todos = (ctx: Contexto) => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos;

/** La app con un modelo falso, sobre la base de `preparar` para poder sembrar datos antes. */
function montar(respuestas: unknown[]) {
  const { db, usuario, ctx } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
  let n = 0;
  const hablar = async (frase: string, conversacion_id?: string) => {
    const r = await app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      // Dictado el mismo día que los datos de prueba, no el día en que corre la prueba.
      body: JSON.stringify({ texto: frase, client_id: `autonomia-${String(++n).padStart(4, "0")}`, conversacion_id, capturado_en: AHORA.toISOString() }),
    });
    return (await r.json()) as { respuesta: string; conversacion_id: string; acciones: { herramienta: string }[] };
  };
  return { ctx, modelo, hablar };
}

describe("montos de siempre", () => {
  test("salen de los pagos fijos y de lo que se repite en el historial", () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 20 });
    // Dos nóminas iguales seguidas ya son costumbre; un solo gimnasio solo se propone.
    crearMovimiento(ctx, { tipo: "ingreso", monto: 3500, categoria: "Sueldo", fecha: "2026-09-30" });
    crearMovimiento(ctx, { tipo: "ingreso", monto: 3500, categoria: "Sueldo", fecha: "2026-09-15" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 600, categoria: "Gimnasio", comercio: "Smart Fit", fecha: "2026-09-10" });
    // En un café hacen falta tres veces iguales: dos no bastan.
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", comercio: "Starbucks", fecha: "2026-10-01" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", comercio: "Starbucks", fecha: "2026-10-02" });
    const lista = habitos(ctx).map((h) => [h.nombre, h.montoCentavos / 100, h.seguro]);
    expect(lista).toContainEqual(["Netflix", 219, true]);
    expect(lista).toContainEqual(["Sueldo", 3500, true]);
    expect(lista).toContainEqual(["Smart Fit", 600, false]);
    expect(lista.find(([nombre]) => nombre === "Starbucks")).toBeUndefined();
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", comercio: "Starbucks", fecha: "2026-10-03" });
    expect(habitoMencionado(ctx, "un café en el Starbucks")?.montoCentavos).toBe(8500);
  });

  test("se reconocen por nombre o por la categoría que se menciona", () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 20 });
    crearRecurrente(ctx, { nombre: "Disney", tipo: "suscripcion", monto: 159, frecuencia: "mensual", dia: 3, categoria: "Streaming" });
    crearRecurrente(ctx, { nombre: "Quincena", tipo: "ingreso", monto: 8000, frecuencia: "quincenal", dia: 15 });
    expect(habitoMencionado(ctx, "Ya pagué Netflix")?.nombre).toBe("Netflix");
    expect(habitoMencionado(ctx, "me depositaron la nómina", "ingreso")?.nombre).toBe("Quincena");
    // Dos suscripciones de streaming: no sabe cuál.
    expect(habitoMencionado(ctx, "pagué el streaming")).toBeUndefined();
    // "La renta" que me pagan no es un gasto de renta.
    expect(habitoMencionado(ctx, "Ya pagué Netflix", "ingreso")).toBeUndefined();
  });

  test("si un pago fijo se cobró después por otro monto, ese se propone en vez de anotarse", () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Spotify", tipo: "suscripcion", monto: 115, frecuencia: "mensual", dia: 20 });
    crearMovimiento(ctx, { tipo: "gasto", monto: 129, comercio: "Spotify", fecha: "2026-09-20" });
    const h = habitoMencionado(ctx, "pagué Spotify");
    expect([h?.montoCentavos, h?.seguro]).toEqual([12900, false]);
  });

  test("sin monto en la frase, el de siempre manda sobre el que inventó el modelo", async () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 20, cuenta: "Nu" });
    const r = await llamar(dictado(ctx, "Ya pagué Netflix"), "registrar_movimientos", {
      movimientos: [{ tipo: "gasto", monto: 199, comercio: "Netflix" }],
    });
    expect(r.registrados[0]).toMatchObject({ monto: "$219", comercio: "Netflix", cuenta: "Nu", categoria: "Suscripciones > Streaming", monto_de_siempre: true });
    // Si dice cuánto, manda lo que dijo.
    const otro = await llamar(dictado(ctx, "Netflix me cobró 249"), "registrar_movimientos", {
      movimientos: [{ tipo: "gasto", monto: 249, comercio: "Netflix" }],
    });
    expect(otro.registrados[0].monto).toBe("$249");
    expect(otro.registrados[0].monto_de_siempre).toBeUndefined();
    // Lo que pidió recordar es más nuevo que el pago fijo.
    await llamar(ctx, "recordar", { texto: "Netflix ahora le cuesta 299" });
    const recordado = await llamar(dictado(ctx, "Ya pagué Netflix"), "registrar_movimientos", {
      movimientos: [{ tipo: "gasto", monto: 299, comercio: "Netflix" }],
    });
    expect(recordado.registrados[0].monto).toBe("$299");
  });
});

describe("cuenta de siempre", () => {
  test("si en ese comercio siempre paga con la misma, se pone sola", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 120, comercio: "Uber", cuenta: "Nu", fecha: "2026-10-01" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 95, comercio: "Uber", fecha: "2026-10-02" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 140, comercio: "Uber", cuenta: "Nu", fecha: "2026-10-03" });
    expect(cuentaHabitual(ctx, "uber")).toBe("Nu");
    const r = await llamar(dictado(ctx, "Uber 130"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 130, comercio: "Uber" }] });
    expect(r.registrados[0].cuenta).toBe("Nu");
    // Lo que dice manda.
    const bbva = await llamar(dictado(ctx, "Uber 80 con la BBVA"), "registrar_movimientos", {
      movimientos: [{ tipo: "gasto", monto: 80, comercio: "Uber", cuenta: "BBVA" }],
    });
    expect(bbva.registrados[0].cuenta).toBe("BBVA");
    // Ya no es siempre la misma: no adivina.
    expect(cuentaHabitual(ctx, "Uber")).toBeUndefined();
  });

  test("con una sola vez no adivina", () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 120, comercio: "Oxxo", cuenta: "Efectivo" });
    expect(cuentaHabitual(ctx, "Oxxo")).toBeUndefined();
  });
});

describe("por voz", () => {
  test("si el modelo pregunta cuánto y siempre es lo mismo, lo anota sin preguntar", async () => {
    const { ctx, hablar, modelo } = montar([texto("¿De cuánto fue Netflix?")]);
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 20 });
    const r = await hablar("Ya pagué Netflix");
    expect(r.respuesta).toBe("Listo, Netflix de 219 pesos en Streaming, como siempre.");
    expect(modelo.doGenerateCalls).toHaveLength(1);
    expect(todos(ctx).map((m) => m.monto)).toEqual(["$219"]);
    // Las instrucciones ya le dicen el monto de siempre.
    expect(JSON.stringify(modelo.doGenerateCalls[0]?.prompt)).toContain("Netflix: gasto de $219");
  });

  test("si solo lo pagó una vez, propone ese monto y con un sí lo anota", async () => {
    const { ctx, hablar } = montar([
      texto("¿De cuánto fue tu quincena?"),
      llamada("registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 3500, categoria: "Sueldo" }] }),
      texto("Listo, quincena de $3,500 en Sueldo."),
    ]);
    crearMovimiento(ctx, { tipo: "ingreso", monto: 3500, categoria: "Sueldo", fecha: "2026-09-30" });
    const r = await hablar("Ya me cayó la quincena");
    expect(r.respuesta).toBe("¿Fue de 3,500 pesos, como la vez pasada?");
    expect(todos(ctx)).toHaveLength(1);
    const si = await hablar("Sí", r.conversacion_id);
    expect(si.acciones.map((a) => a.herramienta)).toEqual(["registrar_movimientos"]);
    expect(todos(ctx).map((m) => m.monto)).toEqual(["$3,500", "$3,500"]);
  });

  test("sin un monto conocido, la pregunta del modelo se queda", async () => {
    const { ctx, hablar } = montar([texto("¿De cuánto fue el súper?")]);
    const r = await hablar("Fui al súper");
    expect(r.respuesta).toBe("¿De cuánto fue el súper?");
    expect(todos(ctx)).toHaveLength(0);
  });

  test("recuerda lo que le pides, lo usa en cada dictado y lo olvida", async () => {
    const { ctx, hablar, modelo } = montar([
      llamada("recordar", { texto: "Paga el Oxxo en efectivo" }),
      texto("¡Hola!"),
      llamada("olvidar", { buscar: "Oxxo" }),
    ]);
    expect((await hablar("Recuerda que el Oxxo lo pago en efectivo")).respuesta).toBe("Listo, lo voy a recordar.");
    expect(listarMemorias(ctx).map((m) => m.texto)).toEqual(["Paga el Oxxo en efectivo"]);
    await hablar("Hola");
    expect(JSON.stringify(modelo.doGenerateCalls[1]?.prompt)).toContain("Lo que sabes del usuario:\\n- Paga el Oxxo en efectivo");
    expect((await hablar("Olvida lo del Oxxo")).respuesta).toBe("Listo, ya lo olvidé.");
    expect(listarMemorias(ctx)).toHaveLength(0);
  });

  test("avisa una sola vez de un cobro que viene", async () => {
    const registrarCafe = () => llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] });
    const { ctx, hablar } = montar([registrarCafe(), registrarCafe()]);
    // Hoy es miércoles 7: Netflix se cobra mañana.
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 8 });
    crearRecurrente(ctx, { nombre: "Renta", tipo: "renta", monto: 9500, frecuencia: "mensual", dia: 1 });
    expect((await hablar("Café 85")).respuesta).toBe("Listo, café de 85 pesos. Ojo: mañana se cobra Netflix de 219 pesos.");
    expect((await hablar("Otro café de 85")).respuesta).toBe("Listo, café de 85 pesos.");
  });
});

describe("memorias", () => {
  test("no repite, pregunta cuál si hay varias y tiene un límite de largo", async () => {
    const { ctx } = preparar();
    await llamar(ctx, "recordar", { texto: "Paga el Oxxo en efectivo" });
    expect(await llamar(ctx, "recordar", { texto: "paga el oxxo en efectivo" })).toMatchObject({ ya_lo_sabia: true });
    await llamar(ctx, "recordar", { texto: "El Oxxo de la esquina cierra temprano" });
    expect(await llamar(ctx, "olvidar", { buscar: "Oxxo" })).toMatchObject({ error: expect.stringContaining("Coinciden varias") });
    expect(await llamar(ctx, "olvidar", { buscar: "Oxxo", todas: true })).toMatchObject({ olvidado: expect.any(Array) });
    expect(await llamar(ctx, "recordar", { texto: "x".repeat(201) })).toMatchObject({ error: expect.any(String) });
    expect(await llamar(ctx, "olvidar", { buscar: "gimnasio" })).toMatchObject({ error: expect.stringContaining("No recuerdo") });
    expect(construirInstrucciones(ctx)).not.toContain("Lo que sabes del usuario");
  });
});
