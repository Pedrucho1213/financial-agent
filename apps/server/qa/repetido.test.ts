// QA: el mismo dictado dos veces seguidas ("Gasté 120 en tacos"). Trazas reales del A/B M (07:35Z):
// el modelo contesta "Ya registré … hace un momento" sin herramienta; el reintento con aviso a veces registra.
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { buscarMovimientos } from "../src/finanzas/movimientos";
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
      body: JSON.stringify({ texto: frase, client_id: `rep-${String(++n).padStart(6, "0")}`, conversacion_id, capturado_en: AHORA.toISOString() }),
    });
    return (await r.json()) as { respuesta: string; conversacion_id: string };
  };
  return { ctx, hablar, modelo };
}
const tacos = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 120, categoria: "Antojos", descripcion: "tacos" }] });
const cuenta = (ctx: any) => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos.length;

for (const [nombre, segunda, esperado] of [
  ["B r2: solo texto, con pregunta de cortesía", [texto("Ya registré los tacos de $120 hace un momento. ¿Quieres que registre algo más?")], 1],
  ["A r1/r2: texto, aviso, texto otra vez", [texto("Ya registré los tacos de $120 en Antojos hace un momento."), texto("Ya registré tus tacos de $120 hace un momento.")], 1],
  ["B r1: texto, aviso, y el modelo registra", [texto("Ya registré los tacos de $120 en Antojos hace un momento."), tacos], 1],
] as const) {
  test(nombre, async () => {
    const { ctx, hablar, modelo } = montar([tacos, ...segunda]);
    const r1 = await hablar("Gasté 120 en tacos");
    const r2 = await hablar("Gasté 120 en tacos", r1.conversacion_id);
    console.log(`  ${nombre}: llamadas=${modelo.doGenerateCalls.length}, movimientos=${cuenta(ctx)}, respuesta="${r2.respuesta}"`);
    expect(cuenta(ctx)).toBe(esperado);
  });
}

test("tras '¿Es otra compra?', 'Sí' registra la segunda (el modelo recibe la pregunta en el historial)", async () => {
  const { ctx, hablar, modelo } = montar([tacos, tacos, texto("Listo, anoté otros tacos de 120.")]);
  const r1 = await hablar("Gasté 120 en tacos");
  const r2 = await hablar("Gasté 120 en tacos", r1.conversacion_id);
  expect(r2.respuesta).toContain("otra compra");
  const r3 = await hablar("Sí", r1.conversacion_id);
  const prompt = JSON.stringify(modelo.doGenerateCalls.at(-1)?.prompt ?? "");
  console.log(`  Sí → "${r3.respuesta}", movimientos=${cuenta(ctx)}, llamadas=${modelo.doGenerateCalls.length}, historial con la pregunta=${prompt.includes("otra compra")}`);
  expect(prompt).toContain("otra compra");
  expect(cuenta(ctx)).toBe(2);
});

test("borrado el primero, repetir ya no pregunta y va al modelo", async () => {
  const borrar = llamada("eliminar_movimiento", { buscar: { texto: "tacos", mas_reciente: true } });
  const { ctx, hablar } = montar([tacos, borrar, tacos]);
  const r1 = await hablar("Gasté 120 en tacos");
  await hablar("Borra eso", r1.conversacion_id);
  const r3 = await hablar("Gasté 120 en tacos", r1.conversacion_id);
  console.log(`  tras borrar → "${r3.respuesta}", movimientos=${cuenta(ctx)}`);
  expect(r3.respuesta).not.toContain("otra compra");
  expect(cuenta(ctx)).toBe(1);
});

// Desde el #44 el Atajo sigue la conversación media hora: repetir ahí pregunta (lo cubre test/repetido.test.ts).
// En otra conversación (la app, o el Atajo pasada la media hora) no pregunta.
test("otra conversación no pregunta", async () => {
  const { ctx, hablar } = montar([tacos, tacos]);
  await hablar("Gasté 120 en tacos", "conv-a");
  const r2 = await hablar("Gasté 120 en tacos", "conv-b");
  expect(r2.respuesta).not.toContain("otra compra");
  expect(cuenta(ctx)).toBe(2);
});
