// QA PR #23: sondas del lado servidor (detalle por id, /v1/estado, CSP del mapa, cuenta).
// Convención: "reproduce:" = la prueba PASA mientras el hallazgo exista. Lo demás = comportamiento correcto.
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp, type OpcionesApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { estadoModelo } from "../src/ai/modelo";
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

  test("reproduce: cualquier cuenta (p. ej. un invitado) ve el modelo y el commit exacto desplegado", async () => {
    const { pedir, cuenta } = montar({
      estadoIa: async () => ({ modelo: "gemma4:12b-it-qat", disponible: true, cargada: true }),
      version: { commit: "2958a9a", commitEn: "2026-10-07T03:52:00Z" },
    });
    const invitado = cuenta("Invitado");
    const r = await pedir("/v1/estado", { token: invitado.token });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.ia.modelo).toBe("gemma4:12b-it-qat");
    expect(r.cuerpo.servidor.commit).toBe("2958a9a");
    // No expone rutas, IPs ni llaves:
    const texto = JSON.stringify(r.cuerpo);
    expect(texto).not.toMatch(/\/Users\/|\/home\/|https?:\/\/|apiKey|Bearer|\d+\.\d+\.\d+\.\d+/);
  });

  test("reproduce: cada GET /v1/estado consulta a la IA (sin caché); 25 peticiones = 25 consultas a Ollama/proveedor", async () => {
    let llamadas = 0;
    const { pedir, cuenta } = montar({
      estadoIa: async () => {
        llamadas++;
        return { modelo: "m", disponible: true, cargada: false };
      },
    });
    const { token } = cuenta("Pedro");
    await Promise.all(Array.from({ length: 25 }, () => pedir("/v1/estado", { token })));
    expect(llamadas).toBe(25);
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

  test("reproduce: IA_URL con 127.0.0.1 y OLLAMA_URL por omisión (localhost) se trata como 'otro proveedor': cargada=disponible aunque no esté en memoria", async () => {
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
    expect(pedidas).toEqual(["/v1/models"]);
    expect(e.cargada).toBe(true); // la app dirá "Lista" aunque el modelo no esté cargado
    ollama.stop(true);
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

describe("cuenta (solo si el servidor ya tiene PR #20)", () => {
  test("reproduce: con solo el token de un dispositivo (p. ej. el del Atajo) se pone un código nuevo sin pedir el actual, y se entra desde otro lado", async () => {
    const { pedir, cuenta } = montar();
    const pedro = cuenta("Pedro");
    const usuario = await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { usuario: "pedro" }, token: pedro.token });
    if (usuario.estado === 404) return; // PR #23 sin PR #20: no aplica
    const primero = await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: "frase-del-dueno-1" }, token: pedro.token });
    expect(primero.estado).toBe(200);
    // Quien tiene el token (no el código) lo cambia sin conocer el anterior:
    const robado = await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: "codigo-del-ladron" }, token: pedro.token });
    expect(robado.estado).toBe(200);
    const entra = await pedir("/v1/entrar", { cuerpo: { usuario: "pedro", codigo: "codigo-del-ladron", dispositivo: "Laptop" } });
    expect(entra.estado).toBe(201);
    const dueno = await pedir("/v1/entrar", { cuerpo: { usuario: "pedro", codigo: "frase-del-dueno-1", dispositivo: "iPhone" } });
    expect(dueno.estado).toBe(401);
  });
});
