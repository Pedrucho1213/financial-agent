// #11 + #12: una orden CON monto que da 202 y termina preguntando; la pregunta sale en el siguiente dictado.
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { llamada, preparar, texto } from "../test/ayuda";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("borra el café de 85 (hay dos) lento, y luego otro dictado", async () => {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({
    doGenerate: async ({ prompt }: any) => {
      const u = JSON.stringify(prompt.findLast((m: any) => m.role === "user"));
      if (u.includes("borra")) { await dormir(150); return texto("Hay dos cafés de $85, ¿cuál borro, el de Starbucks o el de Cielito?"); }
      if (prompt.at(-1).role === "user") return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: Number(u.match(/(\d+)/)![1]) }] });
      return texto("Listo.");
    },
  });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", espera: { registroMs: 30, preguntaMs: 30 } } as any);
  const hablar = async (t: string, id: string) => {
    const r = await app.request("/v1/hablar", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ texto: t, client_id: id }) });
    return { status: r.status, cuerpo: (await r.json()) as any };
  };
  const a = await hablar("borra el café de 85", "con-monto-0001");
  console.log("1)", a.status, a.cuerpo.respuesta, "| esperar:", a.cuerpo.esperar);
  await dormir(300);
  const b = await hablar("Gasté 40 en tacos", "con-monto-0002");
  console.log("2)", b.status, b.cuerpo.respuesta, "| seguir:", b.cuerpo.seguir);
  expect(b.cuerpo.respuesta).toContain("¿cuál borro");
  expect(b.cuerpo.seguir).toBe(true);
});
