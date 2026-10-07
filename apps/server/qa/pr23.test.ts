// QA PR #23: sondas del lado servidor (detalle por id, /v1/estado, CSP del mapa, cuenta).
// Re-prueba tras 62a4d60/9bcad2d: las antiguas "reproduce:" (QA-064, QA-065, código sin el actual) ahora afirman el comportamiento corregido.
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp, type OpcionesApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { esOllama, estadoModelo } from "../src/ai/modelo";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";

type Json = Record<string, any>;

function montar(extra: Partial<OpcionesApp> = {}) {
  const db = abrirBaseDatos(":memory:");
  const modelo = new MockLanguageModelV4({ doGenerate: [] as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", ...extra });
  const cuenta = (nombre: string) => {
    const u = crearUsuario(db, nombre);
    sembrarCategorias(db, u.id);
    return { id: u.id, token: crearDispositivo(db, u.id, `iPhone de ${nombre}`) };
  };
  const pedir = async (ruta: string, o: { metodo?: string; cuerpo?: unknown; token?: string } = {}) => {
    const r = await app.request(`https://mac.tu-red.ts.net${ruta}`, {
      method: o.metodo ?? (o.cuerpo ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
      body: o.cuerpo ? JSON.stringify(o.cuerpo) : undefined,
    });
    const tipo = r.headers.get("content-type") ?? "";
    return { estado: r.status, cuerpo: (tipo.includes("json") ? await r.json() : await r.text()) as Json, r };
  };
  return { db, app, pedir, cuenta };
}

describe("GET /v1/movimientos/:id", () => {
  test("sin token 401; el de otra cuenta 404 (no 403, no filtra que existe); el propio 200", async () => {
    const { pedir, cuenta } = montar();
    const pedro = cuenta("Pedro");
    const ana = cuenta("Ana");
    const m = await pedir("/v1/movimientos", { cuerpo: { tipo: "gasto", monto: 50, comercio: "Oxxo" }, token: pedro.token });
    expect(m.estado).toBe(201);
    expect((await pedir(`/v1/movimientos/${m.cuerpo.id}`)).estado).toBe(401);
    const ajeno = await pedir(`/v1/movimientos/${m.cuerpo.id}`, { token: ana.token });
    expect(ajeno.estado).toBe(404);
    expect(JSON.stringify(ajeno.cuerpo)).not.toContain("Oxxo");
    expect((await pedir(`/v1/movimientos/${m.cuerpo.id}`, { token: pedro.token })).estado).toBe(200);
  });

  test("ids raros (vacío codificado, muy largo, comillas, SQL) dan 404, nunca 500", async () => {
    const { pedir, cuenta } = montar();
    const { token } = cuenta("Pedro");
    for (const id of ["%20", "x".repeat(5000), "'%20OR%201=1--", "..%2F..%2Fyo", "%00", "%E2%80%AE"]) {
      const r = await pedir(`/v1/movimientos/${id}`, { token });
      expect([404]).toContain(r.estado);
    }
  });

  test("un movimiento borrado (deshacer) ya no se ve en el detalle", async () => {
    const { pedir, cuenta } = montar();
    const { token } = cuenta("Pedro");
    const m = await pedir("/v1/movimientos", { cuerpo: { tipo: "gasto", monto: 10 }, token });
    expect((await pedir(`/v1/movimientos/${m.cuerpo.id}`, { metodo: "DELETE", token })).estado).toBe(200);
    expect((await pedir(`/v1/movimientos/${m.cuerpo.id}`, { token })).estado).toBe(404);
  });
});

describe("GET /v1/estado", () => {
  test("requiere token", async () => {
    const { pedir } = montar({ estadoIa: async () => ({ modelo: "m", disponible: true, cargada: true }) });
    expect((await pedir("/v1/estado")).estado).toBe(401);
  });

  test("QA-064: solo el dueño (primera cuenta) ve modelo, commit y arranque; un invitado no", async () => {
    const { pedir, cuenta } = montar({
      estadoIa: async () => ({ modelo: "gemma4:12b-it-qat", disponible: true, cargada: true }),
      version: { commit: "2958a9a", commitEn: "2026-10-07T03:52:00Z" },
    });
    const dueno = cuenta("Pedro");
    const invitado = cuenta("Invitado");
    const r = await pedir("/v1/estado", { token: invitado.token });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.servidor).toBeNull();
    expect(r.cuerpo.ia).toEqual({ disponible: true, cargada: true });
    const texto = JSON.stringify(r.cuerpo);
    expect(texto).not.toContain("gemma4");
    expect(texto).not.toContain("2958a9a");
    expect(texto).not.toContain("arrancadoEn");
    const d = await pedir("/v1/estado", { token: dueno.token });
    expect(d.cuerpo.ia.modelo).toBe("gemma4:12b-it-qat");
    expect(d.cuerpo.servidor.commit).toBe("2958a9a");
    expect(typeof d.cuerpo.servidor.arrancadoEn).toBe("string");
    // Nada de rutas, IPs ni llaves, ni para el dueño:
    expect(JSON.stringify(d.cuerpo)).not.toMatch(/\/Users\/|\/home\/|https?:\/\/|apiKey|Bearer|\d+\.\d+\.\d+\.\d+/);
  });

  test("QA-064: el dueño sigue siendo la primera cuenta aunque la segunda se cree en el mismo milisegundo", async () => {
    const { pedir, cuenta } = montar({
      estadoIa: async () => ({ modelo: "m", disponible: true, cargada: true }),
      version: { commit: "abc", commitEn: null as any },
    });
    const a = cuenta("Primero");
    const b = cuenta("Segundo");
    expect((await pedir("/v1/estado", { token: a.token })).cuerpo.servidor).not.toBeNull();
    expect((await pedir("/v1/estado", { token: b.token })).cuerpo.servidor).toBeNull();
  });

  test("QA-064: 25 GET /v1/estado (dos cuentas) = 1 consulta a la IA; pasados 10 s vuelve a consultar", async () => {
    let llamadas = 0;
    const { pedir, cuenta } = montar({
      estadoIa: async () => {
        llamadas++;
        return { modelo: "m", disponible: true, cargada: false };
      },
    });
    const a = cuenta("Pedro");
    const b = cuenta("Ana");
    await Promise.all(Array.from({ length: 25 }, (_, i) => pedir("/v1/estado", { token: i % 2 ? a.token : b.token })));
    expect(llamadas).toBe(1);
    const ahora = Date.now;
    try {
      Date.now = () => ahora() + 10_500;
      await pedir("/v1/estado", { token: a.token });
      expect(llamadas).toBe(2);
    } finally {
      Date.now = ahora;
    }
  });

  test("QA-064: si la IA falla (rechaza) no se rompe /v1/estado", async () => {
    const { pedir, cuenta } = montar({ estadoIa: async () => { throw new Error("caída"); } });
    const { token } = cuenta("Pedro");
    const r = await pedir("/v1/estado", { token });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.ia).toEqual({ modelo: "", disponible: false, cargada: false });
  });
});

describe("estadoModelo (Ollama)", () => {
  test("disponible/cargada se leen de /api/tags y /api/ps", async () => {
    const ollama = Bun.serve({
      port: 0,
      fetch: (req) => {
        const p = new URL(req.url).pathname;
        if (p === "/api/tags") return Response.json({ models: [{ name: "gemma4:12b-it-qat" }] });
        if (p === "/api/ps") return Response.json({ models: [] });
        return new Response("no", { status: 404 });
      },
    });
    const url = `http://localhost:${ollama.port}`;
    const ia = { url: `${url}/v1`, ollamaUrl: url, modelo: "gemma4:12b-it-qat", apiKey: "ollama" } as any;
    expect(await estadoModelo(ia)).toEqual({ modelo: "gemma4:12b-it-qat", disponible: true, cargada: false });
    ollama.stop(true);
  });

  test("QA-065: IA_URL con 127.0.0.1 y OLLAMA_URL localhost es el mismo Ollama: lee /api/ps y /api/tags", async () => {
    const pedidas: string[] = [];
    const ollama = Bun.serve({
      port: 0,
      fetch: (req) => {
        const p = new URL(req.url).pathname;
        pedidas.push(p);
        if (p === "/v1/models") return Response.json({ data: [{ id: "gemma4:12b-it-qat" }] });
        if (p === "/api/ps") return Response.json({ models: [] });
        return Response.json({ models: [{ name: "gemma4:12b-it-qat" }] });
      },
    });
    const ia = {
      url: `http://127.0.0.1:${ollama.port}/v1`,
      ollamaUrl: `http://localhost:${ollama.port}`,
      modelo: "gemma4:12b-it-qat",
      apiKey: "ollama",
    } as any;
    const e = await estadoModelo(ia);
    expect(pedidas.sort()).toEqual(["/api/ps", "/api/tags"]);
    expect(e).toEqual({ modelo: "gemma4:12b-it-qat", disponible: true, cargada: false });
    ollama.stop(true);
  });

  test("QA-065: esOllama compara protocolo/host/puerto, no prefijos", () => {
    const o = "http://localhost:11434";
    expect(esOllama({ url: "http://127.0.0.1:11434/v1", ollamaUrl: o })).toBe(true);
    expect(esOllama({ url: "http://localhost:11434/v1", ollamaUrl: "http://127.0.0.1:11434" })).toBe(true);
    expect(esOllama({ url: "http://[::1]:11434/v1", ollamaUrl: o })).toBe(true);
    expect(esOllama({ url: "http://LOCALHOST:11434/v1", ollamaUrl: o })).toBe(true);
    expect(esOllama({ url: "https://localhost:11434/v1", ollamaUrl: o })).toBe(false);
    expect(esOllama({ url: "http://localhost:11435/v1", ollamaUrl: o })).toBe(false);
    expect(esOllama({ url: "http://localhost:11434@evil.com/v1", ollamaUrl: o })).toBe(false);
    expect(esOllama({ url: "http://mac.tu-red.ts.net:11434/v1", ollamaUrl: "http://mac.tu-red.ts.net:11434" })).toBe(true);
    expect(esOllama({ url: "", ollamaUrl: o })).toBe(false);
  });
});

describe("CSP con el mapa", () => {
  test("solo se abren imágenes de CARTO; scripts y conexiones siguen en 'self'; no se manda Referer", async () => {
    const { pedir } = montar();
    const r = await pedir("/salud");
    const csp = r.r.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("img-src 'self' data: blob: https://*.basemaps.cartocdn.com;");
    expect(r.r.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("cuenta: cambiar/quitar el código pide el actual (QA-062 lado servidor)", () => {
  test("con solo el token no se cambia el código; con el actual sí; uno equivocado da 403", async () => {
    const { pedir, cuenta } = montar();
    const pedro = cuenta("Pedro");
    const otro = cuenta("Otro");
    expect((await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { usuario: "pedro" }, token: pedro.token })).estado).toBe(200);
    const primero = await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: "frase-del-dueno-1" }, token: pedro.token });
    expect(primero.estado).toBe(200);
    const sinActual = await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: "codigo-del-ladron" }, token: pedro.token });
    expect(sinActual.estado).toBe(400);
    const malo = await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: "codigo-del-ladron", actual: "no-es-este-1" }, token: pedro.token });
    expect(malo.estado).toBe(403);
    expect((await pedir("/v1/entrar", { cuerpo: { usuario: "pedro", codigo: "codigo-del-ladron", dispositivo: "Laptop" } })).estado).toBe(401);
    // Otro dispositivo de Pedro, para cerrarOtros:
    const laptop = await pedir("/v1/entrar", { cuerpo: { usuario: "pedro", codigo: "frase-del-dueno-1", dispositivo: "Laptop" } });
    expect(laptop.estado).toBe(201);
    const bien = await pedir("/v1/yo/codigo", {
      metodo: "PUT",
      cuerpo: { codigo: "frase-nueva-del-dueno-2", actual: "frase-del-dueno-1", cerrarOtros: true },
      token: pedro.token,
    });
    expect(bien.estado).toBe(200);
    expect(bien.cuerpo.cerrados).toBeGreaterThanOrEqual(1);
    expect((await pedir("/v1/yo", { token: laptop.cuerpo.token })).estado).toBe(401);
    expect((await pedir("/v1/yo", { token: pedro.token })).estado).toBe(200);
    expect((await pedir("/v1/yo", { token: otro.token })).estado).toBe(200); // otras cuentas no se tocan
    // Quitar: sin actual 400, con uno equivocado 403, con el bueno 200.
    expect((await pedir("/v1/yo/codigo", { metodo: "DELETE", token: pedro.token })).estado).toBe(400);
    expect((await pedir("/v1/yo/codigo", { metodo: "DELETE", cuerpo: { actual: "frase-del-dueno-1" }, token: pedro.token })).estado).toBe(403);
    expect((await pedir("/v1/yo/codigo", { metodo: "DELETE", cuerpo: { actual: "frase-nueva-del-dueno-2" }, token: pedro.token })).estado).toBe(200);
    expect((await pedir("/v1/entrar", { cuerpo: { usuario: "pedro", codigo: "frase-nueva-del-dueno-2", dispositivo: "X" } })).estado).toBe(401);
  });
});
