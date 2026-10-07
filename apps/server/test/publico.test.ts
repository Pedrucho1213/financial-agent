import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo, crearInvitacion } from "../src/auth";
import { preparar, texto } from "./ayuda";

// Lo que queda expuesto cuando el servidor se abre a internet (Tailscale Funnel): QA-023 a QA-025.

const HOST = "https://finanzas.tu-red.ts.net";

function montar() {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const app = crearApp({
    db,
    modelo: new MockLanguageModelV4({ doGenerate: async () => texto("x") }),
    zonaHoraria: "America/Mexico_City",
    monedaBase: "MXN",
    firmarAtajo: async () => new TextEncoder().encode("firmado"),
  });
  const pedir = (ruta: string, opciones: { cuerpo?: unknown; token?: string; ip?: string; crudo?: string } = {}) =>
    app.request(`${HOST}${ruta}`, {
      method: opciones.cuerpo !== undefined || opciones.crudo !== undefined ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}),
        ...(opciones.ip ? { "x-forwarded-for": opciones.ip } : {}),
      },
      body: opciones.crudo ?? (opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined),
    });
  return { db, usuario, token, app, pedir };
}

describe("superficie pública", () => {
  test("quien adivina códigos se bloquea solo, sin bloquear a los demás (QA-023)", async () => {
    const { db, usuario, pedir } = montar();
    for (let i = 0; i < 20; i++) await pedir(`/v1/invitaciones/ZZZZZ${i % 10}`, { ip: "203.0.113.9" });
    expect((await pedir("/v1/invitaciones/ZZZZZZ", { ip: "203.0.113.9" })).status).toBe(429);
    // Escribir otra IP antes de la que agrega Tailscale no lo libera: cuenta la última.
    expect((await pedir("/v1/invitaciones/ZZZZZZ", { ip: "198.51.100.1, 203.0.113.9" })).status).toBe(429);
    const { codigo } = crearInvitacion(db, { usuarioId: usuario.id });
    const r = await pedir("/v1/registro", { cuerpo: { codigo, dispositivo: "iPhone 13" }, ip: "198.51.100.7" });
    expect(r.status).toBe(201);
  });

  test("un cuerpo enorme se rechaza sin leerlo (QA-024)", async () => {
    const { pedir, token } = montar();
    const grande = JSON.stringify({ codigo: "ABCDEF", dispositivo: "x".repeat(20_000_000) });
    expect((await pedir("/v1/registro", { crudo: grande })).status).toBe(413);
    expect((await pedir("/v1/hablar", { crudo: grande, token })).status).toBe(413);
  });

  test("el enlace del Atajo sirve pocas veces y solo para este servidor (QA-025)", async () => {
    const { pedir, token, app } = montar();
    expect((await pedir("/v1/atajo", { cuerpo: { servidor: "http://atacante.example" }, token })).status).toBe(400);
    const r = await pedir("/v1/atajo", { cuerpo: { servidor: HOST }, token });
    expect(r.status).toBe(201);
    const { url } = (await r.json()) as { url: string };
    for (let i = 0; i < 3; i++) expect((await app.request(url)).status).toBe(200);
    expect((await app.request(url)).status).toBe(410);
  });

  test("canjear un código para el Atajo con un servidor ajeno no lo gasta (QA-025)", async () => {
    const { db, usuario, pedir } = montar();
    const { codigo } = crearInvitacion(db, { usuarioId: usuario.id });
    expect((await pedir("/v1/atajo/canjear", { cuerpo: { codigo, servidor: "http://atacante.example" } })).status).toBe(400);
    expect((await pedir("/v1/atajo/canjear", { cuerpo: { codigo, servidor: HOST } })).status).toBe(201);
  });

  test("manda cabeceras de seguridad (QA-025)", async () => {
    const { pedir } = montar();
    const r = await pedir("/salud");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
  });

  test("una cuenta no puede crear códigos sin límite (QA-025)", async () => {
    const { pedir, token } = montar();
    for (let i = 0; i < 5; i++) expect((await pedir("/v1/invitaciones", { cuerpo: { para: "usuario" }, token })).status).toBe(201);
    expect((await pedir("/v1/invitaciones", { cuerpo: { para: "usuario" }, token })).status).toBe(429);
    // Los de otro dispositivo tuyo llevan su propia cuenta.
    expect((await pedir("/v1/invitaciones", { cuerpo: { para: "dispositivo" }, token })).status).toBe(201);
  });
});
