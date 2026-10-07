// QA del PR #16 (QA-030/031/032): preguntas de más y "borra el café" sin decir cuál.
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { buscarMovimientos, crearMovimiento } from "../src/finanzas/movimientos";
import { AHORA, llamada, preparar, texto } from "../test/ayuda";

function montar(respuestas: unknown[]) {
  const { db, usuario, ctx } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
  let n = 0;
  const hablar = async (frase: string, conversacion_id?: string) => {
    const r = await app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ texto: frase, client_id: `pr16-${String(++n).padStart(6, "0")}`, conversacion_id, capturado_en: AHORA.toISOString() }),
    });
    return (await r.json()) as { respuesta: string; conversacion_id: string; seguir?: boolean };
  };
  return { ctx, hablar };
}
const montos = (ctx: any) => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos.map((m: any) => m.monto);

describe("PR #16: preguntas que sí hay que contestar", () => {
  const casos: [string, string][] = [
    ["Gasté 500", "Hay dos cafés de 85 pesos. ¿Quieres que borre el de las 9 o el de las 11?"],
    ["Me depositaron 500", "¿Quieres que lo registre como ingreso o como un préstamo que te pagaron?"],
    ["Pon presupuesto de comida de 3000", "Ya tienes un presupuesto de comida de 2,500. ¿Quieres que lo cambie a 3,000?"],
    ["Borra todo lo de hoy", "Hoy tienes 4 gastos. ¿Deseas que los borre todos?"],
    ["Pagué la tarjeta", "¿Te gustaría registrarlo como pago de la Nu o de la BBVA?"],
  ];
  for (const [frase, respuesta] of casos) {
    test(`"${respuesta}"`, async () => {
      const { hablar } = montar([texto(respuesta)]);
      const r = await hablar(frase);
      console.log(`  ${frase} → ${r.respuesta} | seguir=${r.seguir}`);
      expect(r.seguir).toBe(true);
    });
  }
});

describe("PR #16: borrar sin decir cuál", () => {
  const borrar = (buscar: unknown) => llamada("eliminar_movimiento", { buscar });
  test("con un solo café, 'borra el café' lo borra sin preguntar", async () => {
    const { ctx, hablar } = montar([borrar({ texto: "café", mas_reciente: true }), texto("Listo, borré el café.")]);
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Súper" });
    await hablar("Borra el café");
    expect(montos(ctx)).toEqual(["$300"]);
  });
  for (const respuesta of ["El de ahorita", "El nuevo", "El de hace rato", "El segundo", "El más nuevo"]) {
    test(`tras "¿cuál?", "${respuesta}" no vuelve a preguntar`, async () => {
      const { ctx, hablar } = montar([
        borrar({ texto: "café", mas_reciente: true }),
        texto("¿Cuál café, el de 60 o el de 85?"),
        borrar({ texto: "café", mas_reciente: true }),
        texto("¿Cuál café, el de 60 o el de 85?"),
      ]);
      crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "ayer" });
      crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
      const a = await hablar("Borra el café");
      const b = await hablar(respuesta, a.conversacion_id);
      console.log(`  ${respuesta} → ${b.respuesta} | quedan ${montos(ctx)}`);
      expect(montos(ctx)).toEqual(["$85"]);
    });
  }
  test("'cambia el café a 95' con dos cafés (editar no tiene el mismo cuidado)", async () => {
    const { ctx, hablar } = montar([
      llamada("editar_movimiento", { buscar: { texto: "café", mas_reciente: true }, cambios: { monto: 95 } }),
      texto("Listo, café a 95 pesos."),
      texto("¿Cuál café, el de 60 o el de 85?"),
    ]);
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    const r = await hablar("Cambia el café a 95");
    console.log(`  editar → ${r.respuesta} | quedan ${montos(ctx)}`);
  });
});

describe("PR #16 (278f586): chat de la PWA, que conserva la conversación", () => {
  test("'borra el café' en una conversación que ya traía otra cosa también pregunta cuál", async () => {
    const { db, usuario, ctx } = preparar();
    const token = crearDispositivo(db, usuario.id, "iPhone");
    // El modelo falso contesta según el último mensaje: así no importa cuántas vueltas dé el servidor.
    const modelo = new MockLanguageModelV4({
      doGenerate: async ({ prompt }: any) => {
        const ultimo = prompt.at(-1);
        if (ultimo.role !== "user") return texto("¿Cuál café, el de 60 o el de 85?") as never;
        const dicho = JSON.stringify(ultimo.content);
        if (dicho.includes("Borra")) return llamada("eliminar_movimiento", { buscar: { texto: "café", mas_reciente: true } }) as never;
        return texto("Llevas 145 pesos en café este mes.") as never;
      },
    });
    const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const hablar = async (frase: string, client_id: string, conversacion_id?: string) =>
      (await (await app.request("/v1/hablar", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ texto: frase, client_id, conversacion_id, capturado_en: AHORA.toISOString() }),
      })).json()) as any;
    crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", fecha: "ayer" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 60, categoria: "Café" });
    const a = await hablar("¿Cuánto llevo en café?", "pwa-00000001");
    const b = await hablar("Borra el café", "pwa-00000002", a.conversacion_id);
    console.log(`  PWA → ${a.respuesta} / ${b.respuesta} | quedan ${montos(ctx)}`);
    expect(montos(ctx)).toHaveLength(2);
  });
});

describe("PR #16 (724799d): SENALA_UNO acepta plurales ('los dos cafés', 'ambos')", () => {
  const casos: [string, string][] = [
    ["Borra lo de los tacos", "Tacos"],
    ["Borra la compra de las tortillas", "Tortillas"],
    ["Borra el café de las tres", "Café"],
    ["Quita el Uber de los martes", "Uber"],
  ];
  for (const [frase, cosa] of casos) {
    test(`"${frase}" con dos que coinciden pregunta cuál`, async () => {
      const { ctx, hablar } = montar([
        llamada("eliminar_movimiento", { buscar: { texto: cosa, mas_reciente: true } }),
        texto("¿Cuál, el de 60 o el de 85?"),
        texto("¿Cuál, el de 60 o el de 85?"),
      ]);
      crearMovimiento(ctx, { tipo: "gasto", monto: 85, comercio: cosa, descripcion: cosa, fecha: "ayer" });
      crearMovimiento(ctx, { tipo: "gasto", monto: 60, comercio: cosa, descripcion: cosa });
      const r = await hablar(frase);
      console.log(`  ${frase} → ${r.respuesta} | quedan ${montos(ctx)}`);
      expect(montos(ctx)).toHaveLength(2);
    });
  }
});
