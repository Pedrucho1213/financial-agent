// QA del PR #18: varios usuarios a la vez. Correr desde apps/server: bun test qa/pr18.test.ts
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { hablar } from "../src/ai/asistente";
import { crearUsuario } from "../src/auth";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { llamada, preparar, texto } from "../test/ayuda";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
function montar(paralelo: number) {
  const { db, usuario } = preparar({ ahora: new Date() });
  const b = crearUsuario(db, "Ana");
  sembrarCategorias(db, b.id);
  let activos = 0, max = 0;
  const orden: string[] = [];
  const modelo = new MockLanguageModelV4({
    doGenerate: async ({ prompt }: any) => {
      const ultimo = prompt.at(-1);
      if (ultimo.role !== "user") return texto("Listo.") as never;
      const dicho = JSON.stringify(ultimo.content);
      activos++; max = Math.max(max, activos);
      try {
        await dormir(50);
        orden.push(dicho.match(/[AB]\d/)![0]);
        return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 10, descripcion: "x" }] }) as never;
      } finally { activos--; }
    },
  });
  const deps = { db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", reintentosMs: [20], paralelo };
  return { deps, a: usuario.id, b: b.id, orden, max: () => max };
}

test("con paralelo=1, B no espera a que A vacíe toda su cola de 6 dictados", async () => {
  const { deps, a, b, orden } = montar(1);
  const tareas = [0, 1, 2, 3, 4, 5].map((i) => hablar(deps, a, { texto: `gasto A${i} de 10`, clientId: `par-a-000${i}` }, { esperaMs: 60_000 } as any));
  await dormir(5);
  tareas.push(hablar(deps, b, { texto: "gasto B0 de 10", clientId: "par-b-0000" }, { esperaMs: 60_000 } as any));
  await Promise.all(tareas);
  console.log("orden:", orden.join(" "));
  expect(orden.indexOf("B0")).toBeLessThanOrEqual(2);
  expect(orden.filter((x) => x.startsWith("A"))).toEqual(["A0", "A1", "A2", "A3", "A4", "A5"]);
});

test("con paralelo=2, A y B van a la vez y los de A siguen en orden", async () => {
  const { deps, a, b, orden, max } = montar(2);
  const t0 = performance.now();
  await Promise.all([
    ...[0, 1, 2].map((i) => hablar(deps, a, { texto: `gasto A${i} de 10`, clientId: `pr2-a-000${i}` }, { esperaMs: 60_000 } as any)),
    ...[0, 1, 2].map((i) => hablar(deps, b, { texto: `gasto B${i} de 10`, clientId: `pr2-b-000${i}` }, { esperaMs: 60_000 } as any)),
  ]);
  const ms = performance.now() - t0;
  console.log("orden:", orden.join(" "), "| max a la vez:", max(), "|", Math.round(ms), "ms");
  expect(max()).toBe(2);
  expect(orden.filter((x) => x.startsWith("A"))).toEqual(["A0", "A1", "A2"]);
  expect(orden.filter((x) => x.startsWith("B"))).toEqual(["B0", "B1", "B2"]);
});
