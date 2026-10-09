import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { precalentar } from "../src/ai/asistente";
import { crearHerramientas } from "../src/ai/herramientas";
import { crearApp } from "../src/app";
import { crearContexto } from "../src/finanzas/contexto";
import { crearDispositivo } from "../src/auth";
import { entradas, usuarios } from "../src/db/schema";
import { crearMovimiento } from "../src/finanzas/movimientos";
import { llamada, preparar, texto } from "./ayuda";

function montar(respuestas: Parameters<typeof llamada>[] | ReturnType<typeof texto>[] | unknown[]) {
  const { db, usuario } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
  const hablar = (cuerpo: Record<string, unknown>) =>
    app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  const get = (ruta: string) => app.request(ruta, { headers: { authorization: `Bearer ${token}` } });
  return { app, db, modelo, hablar, get };
}

describe("API", () => {
  test("salud no pide token; lo demás sí", async () => {
    const { app } = montar([]);
    expect((await app.request("/salud")).status).toBe(200);
    expect((await app.request("/v1/movimientos")).status).toBe(401);
    expect(
      (await app.request("/v1/movimientos", { headers: { authorization: "Bearer fa_falso" } })).status,
    ).toBe(401);
  });

  test("registra lo que se dicta y responde para leer en voz alta", async () => {
    const { hablar, get, modelo } = montar([
      llamada("registrar_movimientos", {
        movimientos: [
          { tipo: "gasto", monto: 60, categoria: "Café" },
          { tipo: "gasto", monto: 800, categoria: "Gasolina" },
        ],
      }),
    ]);
    const r = await hablar({ texto: "café 60 y gasolina 800", client_id: "dictado-0001", lat: 19.43, lon: -99.13, lugar: "" });
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as { respuesta: string; conversacion_id: string; acciones: unknown[] };
    expect(cuerpo.respuesta).toBe("Listo, café de 60 pesos y gasolina de 800 pesos.");
    expect(cuerpo.acciones).toHaveLength(1);
    // Solo registró: la confirmación sale de lo guardado, sin otra vuelta del modelo.
    expect(modelo.doGenerateCalls).toHaveLength(1);
    const lista = (await (await get("/v1/movimientos")).json()) as { total: number };
    expect(lista.total).toBe(2);
  });

  test("coordenadas con coma y fechas raras del iPhone no rechazan el dictado", async () => {
    const { hablar, db } = montar([
      llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }),
      llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }),
    ]);
    const r = await hablar({
      texto: "gasté 85 en café",
      client_id: "dictado-coma-01",
      lat: "19,4326",
      lon: "-99,1332",
      capturado_en: "6 de octubre de 2026, 17:20",
    });
    expect(r.status).toBe(200);
    const entrada = db.select().from(entradas).get()!;
    expect(entrada.lat).toBeCloseTo(19.4326);
    expect(entrada.lon).toBeCloseTo(-99.1332);
    const r2 = await hablar({ texto: "gasté 85 en café", client_id: "dictado-coma-02", lat: "norte", capturado_en: "2026-10-06T17:20:13-0600" });
    expect(r2.status).toBe(200);
  });

  test('el "Ubicación" genérico de iOS no se guarda como lugar', async () => {
    const { hablar, db } = montar([
      llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }),
      llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 40, categoria: "Café" }] }),
    ]);
    expect((await hablar({ texto: "gasté 85 en café", client_id: "dictado-lugar-01", lat: 19.53, lon: -96.88, lugar: "Ubicación" })).status).toBe(200);
    expect((await hablar({ texto: "gasté 40 en café", client_id: "dictado-lugar-02", lugar: "Café Bola de Oro" })).status).toBe(200);
    const lugares = db.select().from(entradas).all().map((e) => e.lugar);
    expect(lugares).toEqual([null, "Café Bola de Oro"]);
  });

  test("un dictado vacío contesta algo para leer en voz alta en vez de un error", async () => {
    const { hablar } = montar([]);
    const r = await hablar({ texto: "  ", client_id: "dictado-vacio-01", conversacion_id: "c1" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ respuesta: "No te escuché. ¿Me lo repites?", conversacion_id: "c1", acciones: [], seguir: true });
  });

  test("el Atajo sigue escuchando solo cuando la respuesta pregunta algo", async () => {
    const { hablar, get } = montar([
      texto("¿De cuánto fue el café?"),
      texto("¿Cuál de los dos? El de $85 o el de $60."),
      llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }),
    ]);
    const pregunta = (await (await hablar({ texto: "compré un café", client_id: "dictado-seguir-01" })).json()) as {
      seguir?: boolean;
    };
    expect(pregunta.seguir).toBe(true);
    // La pregunta también cuenta si no va al final.
    const enMedio = (await (await hablar({ texto: "borra el café", client_id: "dictado-seguir-03" })).json()) as { seguir?: boolean };
    expect(enMedio.seguir).toBe(true);
    const registro = (await (await hablar({ texto: "85 pesos", client_id: "dictado-seguir-02" })).json()) as Record<string, unknown>;
    expect(registro.respuesta).toBe("Listo, café de 85 pesos.");
    expect(registro).not.toHaveProperty("seguir");
    // La consulta de un dictado ya contestado también lo dice.
    expect(((await (await get("/v1/entradas/dictado-seguir-01")).json()) as { seguir?: boolean }).seguir).toBe(true);
    expect(await (await get("/v1/entradas/dictado-seguir-02")).json()).not.toHaveProperty("seguir");
  });

  test("el mismo dictado reenviado por la cola no se registra dos veces", async () => {
    const { hablar, get, modelo } = montar([
      llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }),
    ]);
    const cuerpo = { texto: "gasté 85 en café", client_id: "dictado-0002" };
    await hablar(cuerpo);
    const segunda = (await (await hablar(cuerpo)).json()) as { duplicado?: boolean };
    expect(segunda.duplicado).toBe(true);
    expect(modelo.doGenerateCalls).toHaveLength(1);
    expect(((await (await get("/v1/movimientos")).json()) as { total: number }).total).toBe(1);
  });

  test("si la IA falla responde 503, no deja registros a medias y el reintento funciona", async () => {
    let intento = 0;
    const { db, usuario } = preparar();
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const modelo = new MockLanguageModelV4({
      doGenerate: async () => {
        intento++;
        // Registra uno de los dos gastos y se cae antes del segundo.
        if (intento === 1) return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 50 }] });
        if (intento === 2) throw new Error("Ollama no responde");
        return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 50 }, { tipo: "gasto", monto: 30 }] });
      },
    });
    const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const pedir = () =>
      app.request("/v1/hablar", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ texto: "gasté 50 en tacos y 30 en refresco", client_id: "dictado-0003" }),
      });
    expect((await pedir()).status).toBe(503);
    const vacia = await app.request("/v1/movimientos", { headers: { authorization: `Bearer ${token}` } });
    expect(((await vacia.json()) as { total: number }).total).toBe(0);
    expect((await pedir()).status).toBe(200);
    const llena = await app.request("/v1/movimientos", { headers: { authorization: `Bearer ${token}` } });
    expect(((await llena.json()) as { total: number }).total).toBe(2);
  });

  test("precalentar manda las mismas instrucciones y herramientas sin ejecutar nada", async () => {
    const { db, usuario } = preparar();
    const modelo = new MockLanguageModelV4({
      doGenerate: [llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 50 }] }), texto("Listo.")] as never,
    });
    const deps = { db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" };
    // Abrir el Atajo varias veces seguidas precalienta una sola vez.
    await Promise.all([precalentar(deps, usuario.id), precalentar(deps, usuario.id), precalentar(deps, usuario.id)]);
    expect(modelo.doGenerateCalls).toHaveLength(1);
    expect(modelo.doGenerateCalls[0]?.maxOutputTokens).toBe(1);
    const ctx = crearContexto({ ...deps, usuarioId: usuario.id });
    expect(modelo.doGenerateCalls[0]?.tools).toHaveLength(Object.keys(crearHerramientas(ctx, [])).length);
    const app = crearApp(deps);
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const lista = await app.request("/v1/movimientos", { headers: { authorization: `Bearer ${token}` } });
    expect(((await lista.json()) as { total: number }).total).toBe(0);
  });

  test("la conversación recuerda lo anterior", async () => {
    // Por día: la respuesta la redacta el modelo (un total sencillo ya viene redactado, ver consultas.ts).
    const { hablar, modelo } = montar([
      llamada("consultar_gastos", { periodo: "este_mes", texto: "café", agrupar_por: "dia" }),
      texto("Gastaste $105 en café."),
      llamada("consultar_gastos", { periodo: "este_mes", texto: "Uber", agrupar_por: "dia" }),
      texto("En Uber gastaste $230."),
    ]);
    const primera = (await (await hablar({ texto: "¿cuánto gasté en café?", client_id: "dictado-0004" })).json()) as {
      conversacion_id: string;
    };
    await hablar({ texto: "¿y en Uber?", client_id: "dictado-0005", conversacion_id: primera.conversacion_id });
    const prompt = JSON.stringify(modelo.doGenerateCalls[2]?.prompt);
    expect(prompt).toContain("¿cuánto gasté en café?");
    expect(prompt).toContain("Gastaste $105 en café.");
  });

  test("si el mismo dictado sigue en proceso responde 409 sin repetirlo", async () => {
    const { db, hablar, modelo } = montar([texto("Listo.")]);
    const usuario = db.select().from(usuarios).get()!;
    db.insert(entradas)
      .values({ usuarioId: usuario.id, clientId: "dictado-0006", conversacionId: "c", texto: "x", capturadoEn: new Date().toISOString() })
      .run();
    expect((await hablar({ texto: "x", client_id: "dictado-0006" })).status).toBe(409);
    expect(modelo.doGenerateCalls).toHaveLength(0);
  });

  test("un 'Listo' sin haber guardado nada se reintenta una vez", async () => {
    const { hablar, get, modelo } = montar([
      texto("Listo, Netflix de $219."),
      llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 219, comercio: "Netflix" }] }),
    ]);
    const r = (await (await hablar({ texto: "Netflix me cobró 219", client_id: "dictado-0007" })).json()) as { respuesta: string };
    expect(r.respuesta).toStartWith("Listo, Netflix de 219 pesos");
    expect(JSON.stringify(modelo.doGenerateCalls[1]?.prompt)).toContain("no se guardó ni se consultó nada");
    expect(((await (await get("/v1/movimientos")).json()) as { total: number }).total).toBe(1);
  });

  test("si insiste en confirmar sin guardar, avisa que no guardó nada", async () => {
    const { hablar, get, modelo } = montar([texto("Listo, anotado."), texto("Listo, no te preocupes, ya quedó guardado.")]);
    const r = (await (await hablar({ texto: "gasté 300 en tacos", client_id: "dictado-0008" })).json()) as { respuesta: string };
    expect(r.respuesta).toBe("No alcancé a guardar nada. ¿Me lo repites?");
    expect(modelo.doGenerateCalls).toHaveLength(2);
    expect(((await (await get("/v1/movimientos")).json()) as { total: number }).total).toBe(0);
  });

  test("sin registros, '¿cuánto he gastado?' contesta lo que encontró y no 'no alcancé a guardar'", async () => {
    for (const frase of ["Cuánto he gastado hasta el momento", "¿Cuánto llevo gastado este mes?"]) {
      // Lo que redacta el modelo (por día)...
      const { hablar, modelo } = montar([llamada("consultar_gastos", { periodo: "este_mes", agrupar_por: "dia" }), texto("Aún no tienes gastos registrados.")]);
      const r = (await (await hablar({ texto: frase, client_id: "dictado-0012" })).json()) as { respuesta: string };
      expect(r.respuesta).toBe("Aún no tienes gastos registrados.");
      expect(modelo.doGenerateCalls).toHaveLength(2);
      // ...y lo que ya viene redactado (un total sencillo), en una sola vuelta.
      const directo = montar([llamada("consultar_gastos", { periodo: "este_mes" })]);
      const d = (await (await directo.hablar({ texto: frase, client_id: "dictado-0013" })).json()) as { respuesta: string };
      expect(d.respuesta).toBe("Este mes no tienes gastos registrados.");
      expect(directo.modelo.doGenerateCalls).toHaveLength(1);
    }
  });

  test("una pregunta que el modelo contesta sin consultar solo se cree si no hay registros", async () => {
    const vacio = montar([texto("No tienes gastos registrados."), texto("No tienes gastos registrados.")]);
    const r = (await (await vacio.hablar({ texto: "cuánto he gastado", client_id: "dictado-0013" })).json()) as { respuesta: string };
    expect(r.respuesta).toBe("No tienes gastos registrados.");

    const conDatos = montar([texto("No tienes gastos registrados."), texto("No tienes gastos registrados.")]);
    const usuarioId = conDatos.db.select().from(usuarios).get()!.id;
    const ctx = crearContexto({ db: conDatos.db, usuarioId, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Restaurantes", comercio: "Starbucks" });
    const r2 = (await (await conDatos.hablar({ texto: "cuánto he gastado", client_id: "dictado-0014" })).json()) as { respuesta: string };
    expect(r2.respuesta).toBe("No alcancé a revisar tus movimientos. ¿Me lo preguntas otra vez?");

    // Una cifra sin consultar no se cree ni con la base vacía.
    const inventa = montar([texto("Llevas $1,200 este mes."), texto("Llevas $1,200 este mes.")]);
    const r3 = (await (await inventa.hablar({ texto: "cuánto he gastado", client_id: "dictado-0015" })).json()) as { respuesta: string };
    expect(r3.respuesta).toBe("No alcancé a revisar tus movimientos. ¿Me lo preguntas otra vez?");
  });

  test('"borra los dos cafés" que el modelo pregunta sin buscar se reintenta y los borra; "borra todo" no', async () => {
    const { hablar, get, db, modelo } = montar([
      texto("¿Quieres que borre ambos cafés de ayer?"),
      llamada("eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } }),
      llamada("eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } }),
      texto("Listo, borré los dos cafés."),
      texto("¿Seguro que quieres borrar todo lo de ayer?"),
    ]);
    const usuarioId = db.select().from(usuarios).get()!.id;
    const ctx = crearContexto({ db, usuarioId, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 45, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Súper", fecha: "ayer" });
    await hablar({ texto: "Borra los dos cafés de ayer", client_id: "dictado-0016" });
    expect(JSON.stringify(modelo.doGenerateCalls[1]?.prompt)).toContain("No pidas confirmación");
    expect(((await (await get("/v1/movimientos")).json()) as { total: number }).total).toBe(1);
    const antes = modelo.doGenerateCalls.length;
    const r = (await (await hablar({ texto: "Borra todo lo de ayer", client_id: "dictado-0017" })).json()) as { respuesta: string };
    expect(r.respuesta).toBe("¿Seguro que quieres borrar todo lo de ayer?");
    expect(modelo.doGenerateCalls).toHaveLength(antes + 1);
  });

  test("la charla sin montos no se reintenta", async () => {
    const { hablar, modelo } = montar([texto("¡Hola! Listo para ayudarte.")]);
    await hablar({ texto: "Hola", client_id: "dictado-0009" });
    expect(modelo.doGenerateCalls).toHaveLength(1);
  });

  test("'el súper de hoy fue con la Nu' corrige la cuenta sin llamar al modelo (QA-020, QA-080)", async () => {
    const { hablar, get, db, modelo } = montar([texto("¿Con quién fuiste?")]);
    const usuarioId = db.select().from(usuarios).get()!.id;
    const ctx = crearContexto({ db, usuarioId, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 1850, categoria: "Súper", comercio: "Walmart" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 900, categoria: "Restaurantes", comercio: "Sonora Grill" });
    const r = (await (await hablar({ texto: "El súper de hoy fue con la tarjeta de crédito Nu", client_id: "dictado-0010" })).json()) as {
      respuesta: string;
    };
    expect(r.respuesta).toBe("Listo, quedó Walmart de 1,850 pesos en Súper con Nu.");
    expect(modelo.doGenerateCalls).toHaveLength(0);
    // "Con mis amigos" no es un medio de pago: no se toca nada y queda la respuesta del modelo.
    const r2 = (await (await hablar({ texto: "La cena de hoy fue con mis amigos", client_id: "dictado-0011" })).json()) as {
      respuesta: string;
    };
    expect(r2.respuesta).toBe("¿Con quién fuiste?");
    expect(modelo.doGenerateCalls).toHaveLength(1);
    const lista = (await (await get("/v1/movimientos")).json()) as { movimientos: { comercio: string; cuenta: string | null }[] };
    expect(lista.movimientos.map((m) => [m.comercio, m.cuenta])).toEqual([
      ["Sonora Grill", null],
      ["Walmart", "Nu"],
    ]);
  });

  test("'el súper fue con la Nu' sin un súper que corregir pasa al modelo sin dejar acciones (QA-080)", async () => {
    const { hablar, modelo } = montar([texto("No encontré un súper reciente. ¿De cuánto fue?")]);
    const r = (await (await hablar({ texto: "El súper de hoy fue con la Nu", client_id: "dictado-0012" })).json()) as {
      respuesta: string;
      acciones: unknown[];
    };
    expect(r.respuesta).toBe("No encontré un súper reciente. ¿De cuánto fue?");
    expect(r.acciones).toEqual([]);
    expect(modelo.doGenerateCalls).toHaveLength(1);
  });

  test("valida la petición", async () => {
    const { hablar } = montar([]);
    expect((await hablar({ texto: "café 50", client_id: "x" })).status).toBe(400);
    expect((await hablar({ texto: "café 50" })).status).toBe(400);
  });
});
