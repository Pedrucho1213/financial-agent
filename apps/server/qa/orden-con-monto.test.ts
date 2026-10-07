// QA-029 (PR #13): borrar o cambiar algo con monto espera como pregunta; registrar con monto sigue a los 5 s.
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { esOrdenSobreLoAnotado } from "../src/lib/texto";
import { llamada, preparar, texto } from "../test/ayuda";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
function montar() {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({
    doGenerate: async ({ prompt }: any) => {
      await dormir(150);
      const u = JSON.stringify(prompt.findLast((m: any) => m.role === "user"));
      if (/b[oó]rra|c[aá]mbia/i.test(u)) return texto("Hay dos cafés de $85, ¿cuál, el de Starbucks o el de Cielito?");
      if (prompt.at(-1).role === "user") return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: Number(u.match(/(\d+)/)![1]) }] });
      return texto("Listo.");
    },
  });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", espera: { registroMs: 30, preguntaMs: 2000 } } as any);
  return async (t: string, id: string) => {
    const r = await app.request("/v1/hablar", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ texto: t, client_id: id }) });
    return { status: r.status, cuerpo: (await r.json()) as any };
  };
}

test("borra/cambia con monto: 200 con la pregunta y seguir", async () => {
  const hablar = montar();
  for (const [t, id] of [["borra el café de 85", "ocm-000001"], ["Cámbialo a 95", "ocm-000002"], ["El café de 85 bórralo", "ocm-000003"]]) {
    const r = await hablar(t!, id!);
    console.log(t, "→", r.status, "seguir:", r.cuerpo.seguir);
    expect(r.status).toBe(200);
    expect(r.cuerpo.seguir).toBe(true);
  }
});

test("registrar con monto sigue contestando rápido (202)", async () => {
  const hablar = montar();
  const r = await hablar("Gasté 40 en tacos", "ocm-000010");
  console.log("registro →", r.status);
  expect(r.status).toBe(202);
});

test("falsos positivos (solo esperan más, no es grave)", () => {
  for (const f of ["Pagué 300 del cambio de aceite", "Gasté 200 en la cancha", "Me cobraron 50 por cancelación", "Compré un mueble de 3 mil", "Pasé al Oxxo, 45", "Quité 500 del cajero"])
    console.log(esOrdenSobreLoAnotado(f) ? "espera 30 s" : "5 s       ", f);
});
