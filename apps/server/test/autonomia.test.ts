import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { datosDelUsuario } from "../src/ai/instrucciones";
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
    // Lo aprendido va justo antes del dictado y las instrucciones no cambian: Ollama reutiliza lo ya procesado.
    const [antes, despues] = [modelo.doGenerateCalls[0]!.prompt, modelo.doGenerateCalls[1]!.prompt];
    expect(despues[0]).toEqual(antes[0]!);
    expect(despues.at(-2)).toMatchObject({ role: "system", content: expect.stringContaining("Paga el Oxxo en efectivo") });
    expect(despues.at(-1)).toMatchObject({ role: "user" });
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
    expect(datosDelUsuario(ctx) ?? "").not.toContain("Lo que sabes del usuario:");
  });
});

describe("preguntas de más", () => {
  test("no ofrece más ayuda ni pregunta con qué pagó, y la pregunta del monto se queda", async () => {
    const { hablar } = montar([
      texto("¡Hola! ¿En qué puedo ayudarte con tus finanzas hoy?"),
      texto("Entendido. ¿Algo más en lo que te pueda ayudar?"),
      texto("¿De cuánto fue el gasto y con qué pagaste?"),
    ]);
    expect((await hablar("Hola")).respuesta).toBe("¡Hola!");
    expect((await hablar("Regla")).respuesta).toBe("Entendido.");
    expect((await hablar("Gasté en el súper")).respuesta).toBe("¿De cuánto fue el gasto?");
  });

  test("las preguntas con \"¿quieres que...?\" que piden decidir algo se quedan (QA-033)", async () => {
    const preguntas = [
      "Hay dos cafés de 85 pesos. ¿Quieres que borre el de las 9 o el de las 11?",
      "¿Te gustaría registrarlo como pago de la Nu o de la BBVA?",
      "Hoy tienes 4 gastos. ¿Deseas que los borre todos?",
    ];
    const { hablar } = montar(preguntas.map((p) => texto(p)));
    for (const p of preguntas) expect((await hablar("Borra todo lo de hoy")).respuesta).toBe(p);
  });

  test("'borra el café' con varios cafés pregunta cuál; 'el último' borra el más reciente", async () => {
    const borrar = (buscar: unknown) => llamada("eliminar_movimiento", { buscar });
    const { ctx, hablar } = montar([
      borrar({ texto: "café", mas_reciente: true }),
      texto("¿Cuál café, el de $60 o el de $85?"),
      borrar({ texto: "café", mas_reciente: true }),
    ]);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    expect((await hablar("Borra el café")).respuesta).toBe("¿Cuál café, el de 60 pesos o el de 85 pesos?");
    expect(todos(ctx)).toHaveLength(2);
    expect((await hablar("Borra el último café")).respuesta).toBe("Listo, borré café de 60 pesos.");
    expect(todos(ctx).map((m) => m.monto)).toEqual(["$85"]);
  });

  test("al contestar \"¿cuál?\", el modelo ya sabe cuál y no vuelve a preguntar (QA-034)", async () => {
    const borrar = (buscar: unknown) => llamada("eliminar_movimiento", { buscar });
    const { ctx, hablar } = montar([
      borrar({ texto: "café", mas_reciente: true }),
      texto("¿Cuál café, el de $60 o el de $85?"),
      borrar({ texto: "café", mas_reciente: true }),
      texto("Listo, borré el café de $60."),
    ]);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    const pregunta = await hablar("Borra el café");
    await hablar("El segundo", pregunta.conversacion_id);
    expect(todos(ctx).map((m) => m.monto)).toEqual(["$85"]);
  });

  test("en el chat de la app, una conversación sin pregunta previa no basta para elegir el más reciente (QA-036)", async () => {
    const borrar = llamada("eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } });
    const { ctx, hablar } = montar([
      llamada("consultar_gastos", { periodo: "este_mes", texto: "café" }),
      texto("Llevas $145 en café este mes."),
      borrar,
      texto("¿Cuál café, el de $60 o el de $85?"),
    ]);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    const consulta = await hablar("¿Cuánto llevo en café?");
    expect((await hablar("Borra el café", consulta.conversacion_id)).respuesta).toBe("¿Cuál café, el de 60 pesos o el de 85 pesos?");
    expect(todos(ctx)).toHaveLength(2);
  });

  test("una pregunta anterior que no pide elegir tampoco basta", async () => {
    const borrar = llamada("eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } });
    const { ctx, hablar } = montar([texto("¿De cuánto fue el súper?"), borrar, texto("¿Cuál café, el de $60 o el de $85?")]);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    const pregunta = await hablar("Fui al súper");
    expect((await hablar("Borra el café", pregunta.conversacion_id)).respuesta).toBe("¿Cuál café, el de 60 pesos o el de 85 pesos?");
    expect(todos(ctx)).toHaveLength(2);
  });

  test("al editar, \"el café\" con varios pregunta cuál; \"fueron 70\" a secas es lo último (QA-035)", async () => {
    const editar = (buscar: unknown, monto: number) => llamada("editar_movimiento", { buscar, cambios: { monto } });
    const { ctx, hablar } = montar([
      editar({ texto: "café", mas_reciente: true }, 95),
      texto("¿Cuál café, el de $60 o el de $85?"),
      editar({ mas_reciente: true }, 70),
    ]);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    expect((await hablar("Cambia el café a 95")).respuesta).toBe("¿Cuál café, el de 60 pesos o el de 85 pesos?");
    expect((await hablar("No, fueron 70")).respuesta).toBe("Listo, quedó café de 70 pesos.");
    expect(todos(ctx).map((m) => m.monto)).toEqual(["$70", "$85"]);
  });
});

describe("cuándo no usar el monto de siempre (revisión del PR)", () => {
  test("una pregunta o un cambio de precio no se anotan como pago", async () => {
    const { ctx, hablar } = montar([texto("¿A cuánto subió Netflix?"), texto("¿Cuánto te cobran ahora?")]);
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 20 });
    expect((await hablar("Netflix subió de precio")).respuesta).toBe("¿A cuánto subió Netflix?");
    expect((await hablar("Cuánto me cuesta Netflix")).respuesta).toBe("¿Cuánto te cobran ahora?");
    expect(todos(ctx)).toHaveLength(0);
  });

  test("Netflix no es el Disney Plus que también es de streaming", async () => {
    const { ctx, hablar } = montar([texto("¿De cuánto fue Netflix?")]);
    crearRecurrente(ctx, { nombre: "Disney Plus", tipo: "suscripcion", monto: 159, frecuencia: "mensual", dia: 20, categoria: "Streaming" });
    expect((await hablar("Ya pagué Netflix")).respuesta).toBe("¿De cuánto fue Netflix?");
    const r = await llamar(dictado(ctx, "Ya pagué Netflix"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 199, comercio: "Netflix" }] });
    expect(r.registrados[0]).toMatchObject({ monto: "$199", comercio: "Netflix" });
    expect(r.registrados[0].monto_de_siempre).toBeUndefined();
  });

  test("no pisa un monto que viene de la conversación, de \"la mitad\" o de \"dos meses\"", async () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 20 });
    crearRecurrente(ctx, { nombre: "Renta", tipo: "renta", monto: 7000, frecuencia: "mensual", dia: 1 });
    const monto = async (c: Contexto, comercio: string, m: number) =>
      (await llamar(c, "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: m, comercio }] })).registrados[0].monto;
    expect(await monto({ ...dictado(ctx, "con la Nu"), enConversacion: true }, "Netflix", 300)).toBe("$300");
    expect(await monto(dictado(ctx, "Pagué dos meses de Netflix"), "Netflix", 438)).toBe("$438");
    expect(await monto(dictado(ctx, "Pagué la mitad de la renta"), "Renta", 3500)).toBe("$3,500");
  });

  test("no avisa del cobro que se acaba de pagar, y no lo vuelve a avisar", async () => {
    const registrarCafe = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] });
    const { ctx, hablar } = montar([texto("¿De cuánto fue?"), registrarCafe]);
    // Hoy es miércoles 7 y Netflix se cobra hoy.
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 7 });
    expect((await hablar("Ya pagué Netflix")).respuesta).toBe("Listo, Netflix de 219 pesos en Streaming, como siempre.");
    expect((await hablar("Café 85")).respuesta).toBe("Listo, café de 85 pesos.");
  });
});

describe("frases que fallaron con la IA real", () => {
  test("\"recuerda que cada 15 me cobran 199 de Spotify\" es un pago fijo, no un recuerdo", async () => {
    const { ctx } = preparar();
    const r = await llamar(dictado(ctx, "Recuerda que cada día 15 me cobran 199 de Spotify"), "recordar", { texto: "Cada día 15 cobran 199 de Spotify" });
    expect(r.error).toContain("registrar_recurrente");
    expect(listarMemorias(ctx)).toHaveLength(0);
  });

  test("\"borra los dos cafés de ayer\" los borra sin preguntar cuál", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 45, categoria: "Café", comercio: "Oxxo", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café", comercio: "Starbucks", fecha: "ayer" });
    const c = dictado(ctx, "Borra los dos cafés de ayer");
    for (let i = 0; i < 2; i++) {
      const r = await llamar(c, "eliminar_movimiento", { buscar: { texto: "café", periodo: "ayer", mas_reciente: true } });
      expect(r.eliminado).toBeDefined();
    }
    expect(todos(ctx)).toHaveLength(0);
    // Sin sustantivo también: "borra los dos de hoy".
    crearMovimiento(ctx, { tipo: "gasto", monto: 30, categoria: "Café" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 40, categoria: "Café" });
    const hoy = dictado(ctx, "Borra los dos de hoy");
    for (let i = 0; i < 2; i++) {
      expect((await llamar(hoy, "eliminar_movimiento", { buscar: { texto: "café", periodo: "hoy", mas_reciente: true } })).eliminado).toBeDefined();
    }
  });
});

describe("segunda revisión del PR", () => {
  test("\"ya pagué el internet\" no es el Telcel que también es de internet", async () => {
    const { ctx, hablar } = montar([texto("¿De cuánto fue el internet?")]);
    crearRecurrente(ctx, { nombre: "Telcel", tipo: "servicio", monto: 299, frecuencia: "mensual", dia: 20, categoria: "Internet y teléfono" });
    expect((await hablar("Ya pagué el internet")).respuesta).toBe("¿De cuánto fue el internet?");
    expect(todos(ctx)).toHaveLength(0);
  });

  test("con tres cobros mañana avisa de dos y deja el tercero para después", async () => {
    const cafe = () => llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] });
    const { ctx, hablar } = montar([cafe(), cafe()]);
    for (const [nombre, monto] of [["Netflix", 219], ["Spotify", 129], ["Disney", 159]] as const) {
      crearRecurrente(ctx, { nombre, tipo: "suscripcion", monto, frecuencia: "mensual", dia: 8 });
    }
    expect((await hablar("Café 85")).respuesta).toBe("Listo, café de 85 pesos. Ojo: mañana se cobran Netflix de 219 pesos y Spotify de 129 pesos.");
    expect((await hablar("Otro café de 85")).respuesta).toBe("Listo, café de 85 pesos. Ojo: mañana se cobra Disney de 159 pesos.");
  });

  test("una hora o un plural que no son \"varios\" no eligen el más reciente (QA-037)", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 45, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    for (const frase of ["Borra el café de las dos de ayer", "Borra el café de las tres", "Borra lo de los cafés", "Quita el café de los martes"]) {
      const r = await llamar(dictado(ctx, frase), "eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } });
      expect(r.error).toContain("Coinciden 2");
    }
    expect(todos(ctx)).toHaveLength(2);
  });
});

describe("tercera vuelta con la IA real", () => {
  const ids = (error: string) => [...error.matchAll(/\(id ([^)]+)\)/g)].map((m) => m[1]!);

  test("\"borra los tacos\" con dos tacos no borra solo uno: pide ir uno por uno con su id", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 120, descripcion: "Tacos", categoria: "Restaurantes", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 95, descripcion: "Tacos", categoria: "Restaurantes" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Súper" });
    const c = dictado(ctx, "Borra los tacos");
    const r = await llamar(c, "eliminar_movimiento", { buscar: { texto: "tacos", mas_reciente: true } });
    expect(r.error).toContain("Coinciden 2");
    expect(r.error).toContain("uno por uno");
    expect(r.error).not.toContain("Pregunta cuál");
    for (const id of ids(r.error)) expect((await llamar(c, "eliminar_movimiento", { id })).eliminado).toBeDefined();
    expect(todos(ctx).map((m) => m.monto)).toEqual(["$300"]);
  });

  test("\"bórralos\", \"todos\" y \"ambos\" también son varios; con muchos pregunta", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 45, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    for (const frase of ["Bórralos", "Borra todos los cafés", "Ambos", "Quítame las tortillas y los cafés"]) {
      const r = await llamar(dictado(ctx, frase), "eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } });
      expect(r.error).toContain("uno por uno");
    }
    crearMovimiento(ctx, { tipo: "gasto", monto: 30, categoria: "Café" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 35, categoria: "Café" });
    const r = await llamar(dictado(ctx, "Borra los cafés"), "eliminar_movimiento", { buscar: { texto: "café" } });
    expect(r.error).toContain("pregunta si son todos");
    expect(todos(ctx)).toHaveLength(4);
  });

  test("\"cambia los 300 del súper\" son pesos, no varios: con dos súper de 300 pregunta cuál", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Súper", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Súper" });
    for (const frase of ["Cambia los 300 del súper a 350", "Cambia los trescientos del súper a 350", "Corrige los mil del súper"]) {
      const r = await llamar(dictado(ctx, frase), "editar_movimiento", { buscar: { texto: "súper", monto: 300 }, cambios: { monto: 350 } });
      expect(r.error).toContain("Pregunta cuál");
    }
    expect(todos(ctx).map((m) => m.monto)).toEqual(["$300", "$300"]);
  });

  test("decir cuántos o señalar uno sigue igual", async () => {
    const { ctx } = preparar();
    for (const monto of [45, 60, 30]) crearMovimiento(ctx, { tipo: "gasto", monto, categoria: "Café" });
    for (const frase of ["Borra los últimos dos cafés", "Bórralo", "Borra el último café"]) {
      expect((await llamar(dictado(ctx, frase), "eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } })).eliminado).toBeDefined();
    }
    expect(todos(ctx)).toHaveLength(0);
  });

  test("\"el Uber de ayer lo pagué con la Nu\" se corrige aunque el modelo solo lo haya buscado", async () => {
    const { ctx, hablar } = montar([
      llamada("buscar_movimientos", { texto: "Uber", periodo: "ayer" }),
      texto("¿Te refieres al Uber de 230 pesos de ayer?"),
    ]);
    crearMovimiento(ctx, { tipo: "gasto", monto: 230, comercio: "Uber", categoria: "Transporte", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 50, categoria: "Café", cuenta: "Nu" });
    const r = await hablar("El Uber de ayer lo pagué con la Nu");
    expect(r.respuesta).toStartWith("Listo");
    expect(todos(ctx).find((m) => m.comercio === "Uber")?.cuenta).toBe("Nu");
  });
});
