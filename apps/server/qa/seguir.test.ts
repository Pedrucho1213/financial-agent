// PR #9: "seguir" en la API y acciones del Atajo generado. Correr desde apps/server: bun test qa/seguir.test.ts
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { construirAtajo } from "../src/atajo/generar";
import { preparar, texto } from "../test/ayuda";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
function montar(responder: (t: string) => Promise<string> | string) {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: async ({ prompt }: any) => texto(await responder(JSON.stringify(prompt.findLast((m: any) => m.role === "user")))) });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", espera: { registroMs: 30, preguntaMs: 30 } } as any);
  const pedir = async (ruta: string, cuerpo?: unknown) => {
    const r = await app.request(ruta, { method: cuerpo ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, cuerpo: (await r.json()) as any };
  };
  return { pedir };
}

test("seguir según cómo termina la respuesta", async () => {
  const resp: Record<string, string> = { a: "¿De cuánto fue?", b: "Listo, café de $85.", c: "¿Cuál borro? ", d: "¿Cuál de los dos? El de $85 o el de $60.", e: "¿Cuál borro?”", f: "¿De cuánto fue? 🙂" };
  const { pedir } = montar((t) => resp[t.match(/caso-(\w)/)![1]!]!);
  const salida: string[] = [];
  for (const k of Object.keys(resp)) {
    const r = await pedir("/v1/hablar", { texto: `caso-${k}`, client_id: `seg-${k}-000001` });
    salida.push(`${JSON.stringify(resp[k])} → seguir=${r.cuerpo.seguir ?? "—"}`);
  }
  console.log(salida.join("\n"));
});

test("202 pendiente no sigue; /v1/entradas con la respuesta final sí", async () => {
  const { pedir } = montar(async () => { await dormir(120); return "¿Cuál de los dos?"; });
  const r = await pedir("/v1/hablar", { texto: "borra el café", client_id: "seg-pend-0001" });
  console.log("hablar:", r.status, "seguir=", r.cuerpo.seguir, "esperar=", r.cuerpo.esperar);
  expect(r.cuerpo.seguir).toBeUndefined(); expect(r.cuerpo.esperar).toBe(true);
  const e = await pedir("/v1/entradas/seg-pend-0001?esperar_ms=2000");
  console.log("entradas:", e.status, e.cuerpo.estado, "seguir=", e.cuerpo.seguir);
  expect(e.cuerpo.seguir).toBe(true);
});

test("el Atajo generado no tiene acciones de borrar archivos", () => {
  const atajo = construirAtajo({ servidor: "https://finanzas.example", token: "fa_x", nombre: "Pedro" } as any);
  const ids = JSON.stringify(atajo).match(/is\.workflow\.actions\.[\w.]+/g) ?? [];
  const unicos = [...new Set(ids)].sort();
  console.log(unicos.join(" "));
  expect(unicos.some((i) => /file\.delete|deletefile|file\.(?!s)/.test(i))).toBe(false);
});
