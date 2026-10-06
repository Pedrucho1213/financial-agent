import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { entradas, usuarios } from "../src/db/schema";
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
    const { hablar, get } = montar([
      llamada("registrar_movimientos", {
        movimientos: [
          { tipo: "gasto", monto: 60, categoria: "Café" },
          { tipo: "gasto", monto: 800, categoria: "Gasolina" },
        ],
      }),
      texto("**Listo**, café de $60 y gasolina de $800."),
    ]);
    const r = await hablar({ texto: "café 60 y gasolina 800", client_id: "dictado-0001", lat: 19.43, lon: -99.13, lugar: "" });
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as { respuesta: string; conversacion_id: string; acciones: unknown[] };
    expect(cuerpo.respuesta).toBe("Listo, café de $60 y gasolina de $800.");
    expect(cuerpo.acciones).toHaveLength(1);
    const lista = (await (await get("/v1/movimientos")).json()) as { encontrados: number };
    expect(lista.encontrados).toBe(2);
  });

  test("el mismo dictado reenviado por la cola no se registra dos veces", async () => {
    const { hablar, get, modelo } = montar([
      llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }),
      texto("Listo."),
    ]);
    const cuerpo = { texto: "gasté 85 en café", client_id: "dictado-0002" };
    await hablar(cuerpo);
    const segunda = (await (await hablar(cuerpo)).json()) as { duplicado?: boolean };
    expect(segunda.duplicado).toBe(true);
    expect(modelo.doGenerateCalls).toHaveLength(2);
    expect(((await (await get("/v1/movimientos")).json()) as { encontrados: number }).encontrados).toBe(1);
  });

  test("si la IA falla responde 503, no deja registros a medias y el reintento funciona", async () => {
    let intento = 0;
    const { db, usuario } = preparar();
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const modelo = new MockLanguageModelV4({
      doGenerate: async () => {
        intento++;
        if (intento === 1) return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 50 }] });
        if (intento === 2) throw new Error("Ollama no responde");
        if (intento === 3) return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 50 }] });
        return texto("Listo.");
      },
    });
    const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const pedir = () =>
      app.request("/v1/hablar", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ texto: "gasté 50", client_id: "dictado-0003" }),
      });
    expect((await pedir()).status).toBe(503);
    const vacia = await app.request("/v1/movimientos", { headers: { authorization: `Bearer ${token}` } });
    expect(((await vacia.json()) as { encontrados: number }).encontrados).toBe(0);
    expect((await pedir()).status).toBe(200);
    const llena = await app.request("/v1/movimientos", { headers: { authorization: `Bearer ${token}` } });
    expect(((await llena.json()) as { encontrados: number }).encontrados).toBe(1);
  });

  test("la conversación recuerda lo anterior", async () => {
    const { hablar, modelo } = montar([texto("Gastaste $105 en café."), texto("En Uber gastaste $230.")]);
    const primera = (await (await hablar({ texto: "¿cuánto gasté en café?", client_id: "dictado-0004" })).json()) as {
      conversacion_id: string;
    };
    await hablar({ texto: "¿y en Uber?", client_id: "dictado-0005", conversacion_id: primera.conversacion_id });
    const prompt = JSON.stringify(modelo.doGenerateCalls[1]?.prompt);
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

  test("valida la petición", async () => {
    const { hablar } = montar([]);
    expect((await hablar({ texto: "", client_id: "x" })).status).toBe(400);
  });
});
