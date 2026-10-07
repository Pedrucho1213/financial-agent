// Re-prueba adversarial del PR #7. Correr desde apps/server: bun test qa/adv7.test.ts
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { movimientos } from "../src/db/schema";
import { crearMovimiento, editarMovimiento, deshacer } from "../src/finanzas/movimientos";
import { llamada, preparar, texto } from "../test/ayuda";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Resp = Record<string, any>;

function montar(doGenerate: any, extra: Record<string, unknown> = {}) {
  const { db, usuario } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN", ...extra } as any);
  const pedir = async (ruta: string, init: RequestInit = {}) => {
    const r = await app.request(ruta, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
    return { status: r.status, cuerpo: (await r.json().catch(() => null)) as Resp };
  };
  const hablar = (c: Record<string, unknown>) => pedir("/v1/hablar", { method: "POST", body: JSON.stringify(c) });
  return { db, pedir, hablar };
}

describe("PR #7 adversarial", () => {
  test("'deshaz eso' que falla en segundo plano no deshace el dictado que llegó después", async () => {
    let fallas = 0;
    const { hablar, pedir } = montar(async ({ prompt }: any) => {
      const dictado = JSON.stringify(prompt.findLast((m: any) => m.role === "user"));
      if (prompt.at(-1).role === "user") {
        if (dictado.includes("deshaz")) {
          if (fallas++ === 0) { await dormir(60); throw new Error("Ollama se cayó"); }
          return llamada("deshacer", {});
        }
        return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: Number(dictado.match(/(\d+)/)?.[1]) }] });
      }
      return texto("Listo.");
    }, { reintentosMs: [60_000], espera: { registroMs: 20, preguntaMs: 1000 } });
    await hablar({ texto: "gasté 100", client_id: "adv-0000001" });
    await hablar({ texto: "gasté 200", client_id: "adv-0000002" });
    const r = await hablar({ texto: "deshaz eso y ya", client_id: "adv-0000003" });
    // Desde el PR #11 una orden espera como pregunta: si la IA falla dentro de la espera, 503 y el iPhone lo guarda.
    expect([202, 503]).toContain(r.status);
    await dormir(120); // falla y queda esperando reintento (en la Mac y/o en la cola del iPhone)
    await hablar({ texto: "gasté 300", client_id: "adv-0000004" }); // sale bien y adelanta el reintento
    await dormir(200);
    if (r.status === 503) await hablar({ texto: "deshaz eso y ya", client_id: "adv-0000003" }); // el iPhone lo reenvía
    await dormir(100);
    const lista = await pedir("/v1/movimientos?periodo=todo");
    // Quien dijo "deshaz eso" quería quitar el de 200, no el de 300.
    const montos = lista.cuerpo.movimientos.map((m: Resp) => String(m.monto).replace(/\D/g, ""));
    console.log("quedan:", montos);
    expect(montos.sort()).toEqual(["100", "300"]);
  });

  test("'borra el último' reintentado borra el de antes, no el que llegó después; la app después tampoco cuenta", async () => {
    let fallas = 0;
    const { hablar, pedir } = montar(async ({ prompt }: any) => {
      const dictado = JSON.stringify(prompt.findLast((m: any) => m.role === "user"));
      if (prompt.at(-1).role === "user") {
        if (dictado.includes("borra")) {
          if (fallas++ === 0) { await dormir(60); throw new Error("Ollama se cayó"); }
          return llamada("eliminar_movimiento", { buscar: { mas_reciente: true } });
        }
        return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: Number(dictado.match(/(\d+)/)?.[1]) }] });
      }
      return texto("Listo.");
    }, { reintentosMs: [60_000], espera: { registroMs: 20, preguntaMs: 1000 } });
    await hablar({ texto: "gasté 100", client_id: "adb-0000001" });
    await hablar({ texto: "gasté 200", client_id: "adb-0000002" });
    const rb = await hablar({ texto: "borra el último porfa", client_id: "adb-0000003" });
    expect([202, 503]).toContain(rb.status);
    await dormir(120);
    await dormir(5);
    await pedir("/v1/movimientos", { method: "POST", body: JSON.stringify({ tipo: "gasto", monto: 400 }) });
    await hablar({ texto: "gasté 300", client_id: "adb-0000004" });
    await dormir(200);
    if (rb.status === 503) await hablar({ texto: "borra el último porfa", client_id: "adb-0000003" }); // el iPhone lo reenvía
    await dormir(100);
    const montos = (await pedir("/v1/movimientos?periodo=todo")).cuerpo.movimientos.map((m: Resp) => String(m.monto).replace(/\D/g, ""));
    console.log("quedan (borra):", montos);
    expect(montos.sort()).toEqual(["100", "300", "400"]);
  });

  test("una corrección sí enseña al comercio y la frase con otra categoría la vence", () => {
    const { ctx } = preparar();
    const a = crearMovimiento({ ...ctx, textoOriginal: "compras en el Oxxo 80" }, { tipo: "gasto", monto: 80, comercio: "Oxxo" });
    editarMovimiento(ctx, a.id, { categoria: "Despensa" });
    const b = crearMovimiento({ ...ctx, textoOriginal: "Oxxo 50" }, { tipo: "gasto", monto: 50, comercio: "Oxxo" });
    const c = crearMovimiento({ ...ctx, textoOriginal: "recarga de celular en el Oxxo 200" }, { tipo: "gasto", monto: 200, comercio: "Oxxo" });
    console.log("aprendida:", b.categoria, "| recarga:", c.categoria);
    expect(b.categoria).toBe("Comida > Súper");
    expect(c.categoria).not.toBe("Comida > Súper");
  });

  test("ingreso → gasto → ingreso no deja categoría del tipo equivocado", () => {
    const { ctx } = preparar();
    const m = crearMovimiento({ ...ctx, textoOriginal: "me cayó un reembolso de 300" }, { tipo: "ingreso", monto: 300, descripcion: "reembolso" });
    const g = editarMovimiento(ctx, m.id, { tipo: "gasto" });
    const i = editarMovimiento(ctx, m.id, { tipo: "ingreso" });
    const t = editarMovimiento(ctx, m.id, { tipo: "transferencia" });
    const v = editarMovimiento(ctx, m.id, { tipo: "ingreso" });
    console.log("inicio:", m.categoria, "| gasto:", g.categoria, "| ingreso:", i.categoria, "| transf:", t.categoria, "| ingreso:", v.categoria);
    expect(i.categoria).toContain("Reembolso");
    expect(t.categoria).toBeUndefined();
  });

  test("fecha futura al registrar y al editar", () => {
    const { ctx, db } = preparar();
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 50, fecha: "2026-10-20" });
    expect(m.revisar).toBe(true);
    const n = crearMovimiento(ctx, { tipo: "gasto", monto: 50, categoria: "Café" });
    editarMovimiento(ctx, n.id, { fecha: "2026-12-25" });
    const fila = db.select().from(movimientos).all().find((x) => x.id === n.id)!;
    console.log("editado a futuro, revisar =", fila.revisar);
  });

  test("deshacer, deshacer otra vez: va hacia atrás, sin rehacer", () => {
    const { ctx } = preparar();
    crearMovimiento({ ...ctx, entradaId: "e1" }, { tipo: "gasto", monto: 1 });
    crearMovimiento({ ...ctx, entradaId: "e2" }, { tipo: "gasto", monto: 2 });
    deshacer({ ...ctx, entradaId: "e3" });
    deshacer({ ...ctx, entradaId: "e4" });
    expect(deshacer({ ...ctx, entradaId: "e5" }).deshecho).toBe(false);
  });

  test("montos límite y paginación rara", async () => {
    const { ctx } = preparar();
    expect(() => crearMovimiento(ctx, { tipo: "gasto", monto: 0.004 })).toThrow();
    expect(crearMovimiento(ctx, { tipo: "gasto", monto: 0.005 }).monto).toBeDefined();
    expect(() => crearMovimiento(ctx, { tipo: "gasto", monto: Number.NaN })).toThrow();
    const { pedir } = montar(async () => texto("x"));
    for (const q of ["limite=abc", "limite=-5", "limite=99999", "offset=-3", "offset=abc", "limite=1.5"]) {
      const r = await pedir(`/v1/movimientos?periodo=todo&${q}`);
      expect(r.status).toBe(200);
    }
  });
});
