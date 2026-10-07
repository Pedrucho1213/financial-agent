// PR #12 (QA-027 opción b): la pregunta que nadie oyó se dice en la siguiente respuesta.
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { llamada, preparar, texto } from "../test/ayuda";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
function montar() {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({
    doGenerate: async ({ prompt }: any) => {
      const u = JSON.stringify(prompt.findLast((m: any) => m.role === "user"));
      if (u.includes("quincena") && !u.includes("mil")) { await dormir(150); return texto("¿De cuánto fue la quincena?"); }
      if (prompt.at(-1).role === "user") {
        const monto = Number(u.match(/(\d+)/)?.[1] ?? 0) * (u.includes("mil") ? 1000 : 1);
        return llamada("registrar_movimientos", { movimientos: [{ tipo: u.includes("quincena") ? "ingreso" : "gasto", monto }] });
      }
      return texto("Listo.");
    },
  });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", espera: { registroMs: 30, preguntaMs: 30 } } as any);
  const hablar = async (t: string, id: string) => {
    const r = await app.request("/v1/hablar", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ texto: t, client_id: id }) });
    return { status: r.status, cuerpo: (await r.json()) as any };
  };
  return { hablar };
}

test("la pregunta perdida sale en la siguiente respuesta, una sola vez", async () => {
  const { hablar } = montar();
  const a = await hablar("Me llegó la quincena", "sin-oir-00001");
  console.log("1)", a.status, a.cuerpo.respuesta, "| esperar:", a.cuerpo.esperar);
  await dormir(300); // termina en segundo plano; el Atajo (sin PR #11) ya se cerró
  const b = await hablar("Gasté 85 en un café", "sin-oir-00002");
  console.log("2)", b.status, b.cuerpo.respuesta, "| seguir:", b.cuerpo.seguir);
  const c = await hablar("Gasté 40 en un taco", "sin-oir-00003");
  console.log("3)", c.status, c.cuerpo.respuesta, "| seguir:", c.cuerpo.seguir);
  expect(b.cuerpo.respuesta).toContain("quincena");
  expect(c.cuerpo.respuesta).not.toContain("quincena");
});

test("si la quincena ya se registró después, ¿se pregunta igual?", async () => {
  const { hablar } = montar();
  await hablar("Me llegó la quincena", "sin-oir-00011");
  await dormir(300);
  const b = await hablar("Me llegó la quincena de 15 mil", "sin-oir-00012");
  console.log("ya contestada:", b.cuerpo.respuesta);
});

test("reenvío de la cola sin conexión: la respuesta no se dice, pero cuenta como entregada", async () => {
  const { hablar } = montar();
  // El dictado se procesó en segundo plano y luego el Atajo lo reenvía desde la cola (no lo dice en voz alta).
  await hablar("Me llegó la quincena", "sin-oir-00021");
  await dormir(300);
  await hablar("Me llegó la quincena", "sin-oir-00021"); // reenvío: duplicado
  const c = await hablar("Gasté 85 en un café", "sin-oir-00022");
  console.log("tras reenvío de cola:", c.cuerpo.respuesta);
});
