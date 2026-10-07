// Superficie pública (Funnel). Correr desde apps/server: bun test qa/publico.test.ts
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo, crearInvitacion } from "../src/auth";
import { preparar, texto } from "../test/ayuda";

function montar() {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: async () => texto("x") }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN", firmarAtajo: async (a: Uint8Array) => a } as any);
  return { db, usuario, token, app };
}

test("un extraño agota los intentos y el dueño ya no puede canjear su código válido", async () => {
  const { db, usuario, app } = montar();
  const { codigo } = crearInvitacion(db, { usuarioId: usuario.id });
  for (let i = 0; i < 20; i++) await app.request(`/v1/invitaciones/ZZZZZ${i % 10}`, { headers: { "x-forwarded-for": "203.0.113.9" } });
  const r = await app.request("/v1/registro", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" }, body: JSON.stringify({ codigo, dispositivo: "iPhone 13" }) });
  console.log("dueño tras 20 intentos de otro:", r.status, await r.text());
  expect(r.status).not.toBe(429);
});

test("rutas con datos sin token dan 401", async () => {
  const { app } = montar();
  for (const [m, ruta] of [["GET", "/v1/yo"], ["GET", "/v1/movimientos"], ["GET", "/v1/tablero"], ["GET", "/v1/resumen"], ["GET", "/v1/recurrentes"], ["GET", "/v1/categorias"], ["POST", "/v1/hablar"], ["POST", "/v1/deshacer"], ["POST", "/v1/invitaciones"], ["POST", "/v1/atajo"], ["GET", "/v1/entradas/x"], ["DELETE", "/v1/movimientos/x"], ["POST", "/v1/despertar"], ["GET", "/V1/yo"], ["GET", "/v1//yo"], ["GET", "/v1/yo/"], ["GET", "/v1/%79o"]] as const) {
    const r = await app.request(ruta, { method: m, headers: { authorization: "Bearer fa_x" } });
    console.log(m, ruta, r.status);
    if (ruta.startsWith("/v1/")) expect([401, 404]).toContain(r.status);
  }
});

test("cuerpo enorme en una ruta pública", async () => {
  const { app } = montar();
  const grande = JSON.stringify({ codigo: "ABCDEF", dispositivo: "x".repeat(20_000_000) });
  const t = performance.now();
  const r = await app.request("/v1/registro", { method: "POST", headers: { "content-type": "application/json" }, body: grande });
  console.log("20 MB a /v1/registro →", r.status, Math.round(performance.now() - t), "ms (se leyó entero)");
});

test("el enlace del Atajo sirve varias veces", async () => {
  const { app, token } = montar();
  const p = await app.request("https://finanzas.example/v1/atajo", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ servidor: "https://finanzas.example" }) });
  const { url } = (await p.json()) as any;
  const a = await app.request(url);
  const b = await app.request(url);
  const c3 = await app.request(url);
  const d = await app.request(url);
  console.log("descargas del mismo enlace:", a.status, b.status, c3.status, d.status);
});

test("canjear un código para el Atajo con un servidor ajeno", async () => {
  const { db, usuario, app } = montar();
  const { codigo } = crearInvitacion(db, { usuarioId: usuario.id });
  const r = await app.request("https://finanzas.example/v1/atajo/canjear", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo, servidor: "http://atacante.example" }) });
  console.log("canjear con servidor ajeno:", r.status);
});

test("límite por IP: rotar X-Forwarded-For desde fuera", async () => {
  const { db, usuario, app } = montar();
  const { codigo } = crearInvitacion(db, { usuarioId: usuario.id });
  let bloqueados = 0;
  for (let i = 0; i < 250; i++) {
    const r = await app.request(`/v1/invitaciones/ZZZZZ${i % 10}`, { headers: { "x-forwarded-for": `203.0.113.${i % 250}` } });
    if (r.status === 429) bloqueados++;
  }
  const r = await app.request("/v1/registro", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" }, body: JSON.stringify({ codigo, dispositivo: "iPhone 13" }) });
  console.log("250 intentos con IP rotada → 429:", bloqueados, "| dueño:", r.status);
});

test("cabeceras de seguridad", async () => {
  const { app } = montar();
  const r = await app.request("/salud");
  console.log("cabeceras /salud:", JSON.stringify(Object.fromEntries(r.headers)));
});
