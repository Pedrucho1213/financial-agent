// QA-077: el mismo registro dictado otra vez a los pocos minutos en la misma conversación.
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { movimientos } from "../src/db/schema";
import { buscarMovimientos } from "../src/finanzas/movimientos";
import { AHORA, llamada, preparar, texto } from "./ayuda";

function montar(respuestas: unknown[]) {
  const { db, usuario, ctx } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
  let n = 0;
  const hablar = async (frase: string, conversacion_id?: string, minutos = 0) => {
    const capturado_en = new Date(AHORA.getTime() + minutos * 60_000).toISOString();
    const r = await app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ texto: frase, client_id: `rep-${String(++n).padStart(6, "0")}`, conversacion_id, capturado_en }),
    });
    return (await r.json()) as { respuesta: string; conversacion_id: string };
  };
  const cuantos = () => buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos.length;
  return { db, hablar, modelo, cuantos };
}

const tacos = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 120, categoria: "Antojos", descripcion: "tacos" }] });

test("el mismo dictado otra vez pregunta sin llamar al modelo; con un sí se anota el segundo", async () => {
  const { hablar, modelo, cuantos } = montar([tacos, tacos, texto("Listo, anoté otros tacos de $120.")]);
  const r1 = await hablar("Gasté 120 en tacos");
  const r2 = await hablar("Gasté 120 en tacos.", r1.conversacion_id, 1);
  expect(r2.respuesta).toContain("hace un momento. ¿Es otra compra?");
  expect(r2.respuesta).toContain("tacos");
  expect(r2.respuesta).not.toContain("No alcancé");
  expect(modelo.doGenerateCalls.length).toBe(1);
  expect(cuantos()).toBe(1);

  const r3 = await hablar("Sí, es otra", r1.conversacion_id, 2);
  expect(r3.respuesta).toContain("Listo");
  expect(modelo.doGenerateCalls.length).toBe(3);
  expect(cuantos()).toBe(2);
});

test("si el modelo dice que ya lo tenía y es cierto, pregunta en vez de reintentar o decir que no guardó", async () => {
  const { hablar, modelo, cuantos } = montar([tacos, texto("Ya registré los tacos de $120 en Antojos hace un momento."), tacos]);
  const r1 = await hablar("Gasté 120 en tacos");
  const r2 = await hablar("Gasté 120 pesos en unos tacos", r1.conversacion_id, 1);
  expect(r2.respuesta).toContain("¿Es otra compra?");
  expect(r2.respuesta).not.toContain("No alcancé");
  expect(modelo.doGenerateCalls.length).toBe(2);
  expect(cuantos()).toBe(1);
});

test("\"ya los tienes registrados\" (como lo dice Claude) también cuenta como que ya lo tenía", async () => {
  const { hablar, modelo, cuantos } = montar([tacos, texto("Ya tienes registrados unos tacos de $120 de hace un momento."), tacos]);
  const r1 = await hablar("Gasté 120 en tacos");
  const r2 = await hablar("Gasté 120 pesos en unos tacos", r1.conversacion_id, 1);
  expect(r2.respuesta).toContain("¿Es otra compra?");
  expect(modelo.doGenerateCalls.length).toBe(2);
  expect(cuantos()).toBe(1);
});

test("si el modelo dice que ya lo tenía y no hay nada igual, sí reintenta", async () => {
  const { hablar, modelo, cuantos } = montar([tacos, texto("Ya registré el café de $85 hace un momento."), llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, descripcion: "café" }] })]);
  const r1 = await hablar("Gasté 120 en tacos");
  await hablar("Gasté 85 en un café", r1.conversacion_id, 1);
  expect(modelo.doGenerateCalls.length).toBe(3);
  expect(cuantos()).toBe(2);
});

test("un dictado igual se procesa normal si el anterior se borró, es de otra conversación o pasó el rato", async () => {
  const { db, hablar, modelo, cuantos } = montar([tacos, tacos, tacos, tacos]);
  const r1 = await hablar("Gasté 120 en tacos");
  db.update(movimientos).set({ eliminadoEn: AHORA.toISOString() }).run();
  await hablar("Gasté 120 en tacos", r1.conversacion_id, 1);
  expect(modelo.doGenerateCalls.length).toBe(2);
  expect(cuantos()).toBe(1);

  // Otra conversación (la app con su propio chat, o un Atajo pasada la media hora).
  await hablar("Gasté 120 en tacos", "otra-conversacion", 2);
  expect(modelo.doGenerateCalls.length).toBe(3);
  expect(cuantos()).toBe(2);

  const r4 = await hablar("Gasté 120 en tacos", r1.conversacion_id, 13);
  expect(r4.respuesta).not.toContain("hace un momento");
  expect(modelo.doGenerateCalls.length).toBe(4);
  expect(cuantos()).toBe(3);
});

test("abrir el Atajo otra vez a los pocos minutos sigue la conversación: repetir el mismo dictado pregunta", async () => {
  const { hablar, modelo, cuantos } = montar([tacos]);
  const r1 = await hablar("Gasté 120 en tacos");
  // El Atajo no manda conversacion_id al abrirse otra vez.
  const r2 = await hablar("Gasté 120 en tacos", undefined, 1);
  expect(r2.conversacion_id).toBe(r1.conversacion_id);
  expect(r2.respuesta).toContain("¿Es otra compra?");
  expect(modelo.doGenerateCalls.length).toBe(1);
  expect(cuantos()).toBe(1);
});

// Lo que Investigación vio con Claude en la Mac (27dfbdd): pensó en voz alta en inglés o habló de sus reglas.
const PENSO_EN_INGLES =
  'This looks like a new dictated expense with an amount, identical to one from a few minutes ago. Per the rules, if it\'s identical to a recent one, I should ask whether it\'s another one rather than silently refusing. The recent log shows "gasté 50 pesos en un café" at 20:56 — this message is the same. I\'ll ask. ¿Otro café de 50 pesos, o es el mismo que ya registré hace un momento?';

test("lo que Claude piensa en voz alta (en inglés o sobre sus reglas) no se le dice", async () => {
  const { hablar, modelo } = montar([
    texto(PENSO_EN_INGLES),
    texto("Este mensaje es idéntico al de hace un momento, así que pregunto antes de guardar, como indican las reglas. ¿Es otro café de 50 pesos?"),
    texto("¿Otro café de 50 pesos?"),
  ]);
  const r1 = await hablar("Gasté 50 pesos en un café");
  expect(r1.respuesta).toBe("¿Otro café de 50 pesos, o es el mismo que ya registré hace un momento?");
  const r2 = await hablar("Gasté 50 pesos en un café", "otra-conversacion");
  expect(r2.respuesta).toBe("¿Es otro café de 50 pesos?");
  expect(modelo.doGenerateCalls.length).toBe(2);
  // Lo que se guarda de la conversación tampoco lo trae: el modelo no lo ve después para imitarlo.
  const r3 = await hablar("Gasté 50 pesos en un café", r1.conversacion_id, 1);
  expect(r3.respuesta).toBe("¿Otro café de 50 pesos?");
  const vistos = JSON.stringify(modelo.doGenerateCalls[2]!.prompt);
  expect(vistos).toContain("¿Otro café de 50 pesos, o es el mismo");
  expect(vistos).not.toContain("This looks like");
});

test("si todo lo que escribió era pensar en voz alta, contesta el modelo de la Mac", async () => {
  const { hablar, modelo } = montar([texto("This looks like a duplicate. I'll ask the user."), texto("¿Otro café de 50 pesos?")]);
  const r = await hablar("Gasté 50 pesos en un café");
  expect(r.respuesta).toBe("¿Otro café de 50 pesos?");
  expect(modelo.doGenerateCalls.length).toBe(2);
  expect(modelo.doGenerateCalls[1]!.providerOptions?.nube).toEqual({ enLaMac: true });
});

test("si dice que ya lo tenía de otra conversación (como el Atajo después de la app), pregunta si es otro", async () => {
  const { hablar, modelo, cuantos } = montar([tacos, texto("Ya quedó registrado tu gasto de 120 en tacos.")]);
  await hablar("Gasté 120 en tacos");
  const r2 = await hablar("Gasté 120 en tacos", "otra-conversacion", 1);
  expect(r2.respuesta).toContain("¿Es otra compra?");
  expect(r2.respuesta).not.toContain("No alcancé");
  expect(modelo.doGenerateCalls.length).toBe(2);
  expect(cuantos()).toBe(1);
});

test("si dice \"Listo\" sin anotar ni en el reintento y hace un momento se anotó lo mismo, pregunta si es otro", async () => {
  const { hablar, modelo, cuantos } = montar([tacos, texto("Listo, tacos de 120."), texto("Listo.")]);
  await hablar("Gasté 120 en tacos");
  const r2 = await hablar("Gasté 120 en tacos", "otra-conversacion", 1);
  expect(r2.respuesta).toContain("¿Es otra compra?");
  expect(modelo.doGenerateCalls.length).toBe(3);
  expect(cuantos()).toBe(1);
});
