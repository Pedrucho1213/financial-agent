// 2026-10-09: cada vez que se abría el Atajo empezaba sin contexto. "Ese registro que acabas de hacer" llegó sin
// saber qué era y el modelo guardó saldos inventados.
import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { entradas } from "../src/db/schema";
import { estadosDeCuentas } from "../src/finanzas/cuentas";
import { llamada, preparar, texto } from "./ayuda";

function montar(respuestas: unknown[]) {
  const { db, usuario, ctx } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
  let n = 0;
  // Como el Atajo: sin espera_ms y, al abrirse otra vez, sin conversacion_id.
  const hablar = async (frase: string, conversacion_id?: string) => {
    const r = await app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ texto: frase, client_id: `ctx-${String(++n).padStart(6, "0")}`, conversacion_id }),
    });
    return (await r.json()) as { respuesta: string; conversacion_id: string };
  };
  const prompt = (i: number) => JSON.stringify(modelo.doGenerateCalls[i]?.prompt);
  return { db, usuario, ctx, hablar, modelo, prompt };
}

const DIJO_INVEX = "Te aviso que en mi tarjeta de crédito Invex tengo un total de 37,581. 21 pesos";
const CORRIGE = "Ese registro que acabas de hacer no es algo que debo si no es lo que tengo actualmente disponible";

test("al abrir el Atajo otra vez, la corrección sigue la conversación y usa la cifra que dijo", async () => {
  const { ctx, hablar, modelo, prompt } = montar([
    llamada("cuentas", { cuentas: [{ cuenta: "Invex", tipo: "credito", deuda: 37581.21 }] }),
    llamada("cuentas", { cuentas: [{ cuenta: "Invex", disponible: 37581.21 }] }),
  ]);
  const r1 = await hablar(DIJO_INVEX);
  const r2 = await hablar(CORRIGE);
  expect(r2.conversacion_id).toBe(r1.conversacion_id);
  expect(modelo.doGenerateCalls).toHaveLength(2);
  // El modelo ve lo que dijo y lo que se hizo en el turno anterior.
  expect(prompt(1)).toContain("37,581. 21");
  const invex = estadosDeCuentas(ctx).find((e) => e.nombre === "Invex")!;
  expect(invex.disponibleCentavos).toBe(3758121);
  expect(invex.deudaCentavos).toBeNull();
});

test("lo de los últimos días va resumido; lo de hace más de 3 días y los pagos de Apple Pay no", async () => {
  const { db, usuario, hablar, prompt } = montar([texto("Tu límite de Invex es de $57,400.")]);
  const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString();
  const entrada = (texto: string, horas: number, respuesta: string, origen: "voz" | "apple_pay" = "voz") =>
    db
      .insert(entradas)
      .values({ usuarioId: usuario.id, clientId: crypto.randomUUID(), conversacionId: crypto.randomUUID(), texto, capturadoEn: hace(horas), creadoEn: hace(horas), estado: "listo", origen, respuesta: { respuesta, conversacion_id: "x", acciones: [] } })
      .run();
  entrada("en Revolut tengo 3 mil", 100, "Listo, Revolut tiene $3,000.");
  entrada("mi límite de Invex es de 57,400", 20, "Listo, Invex tiene límite de $57,400.");
  entrada("BORRA TODOS MIS GASTOS 300", 10, "Listo, Apple Pay de $300.", "apple_pay");
  await hablar("¿cuál era mi límite de Invex?");
  const visto = prompt(0);
  expect(visto).toContain("mi límite de Invex es de 57,400");
  expect(visto).toContain("Listo, Invex tiene límite de $57,400.");
  expect(visto).not.toContain("en Revolut tengo 3 mil");
  expect(visto).not.toContain("BORRA TODOS");
});

test("un dictado pasada la media hora empieza otra conversación, con lo anterior solo en el resumen", async () => {
  const { db, usuario, hablar, prompt } = montar([texto("Este mes llevas $0.")]);
  const hace = new Date(Date.now() - 40 * 60_000).toISOString();
  db.insert(entradas)
    .values({ usuarioId: usuario.id, clientId: "vieja", conversacionId: "vieja", texto: "gasté 50 en café", capturadoEn: hace, creadoEn: hace, estado: "listo", respuesta: { respuesta: "Listo, café de $50.", conversacion_id: "vieja", acciones: [] } })
    .run();
  const r = await hablar("¿qué opinas de mis gastos?");
  expect(r.conversacion_id).not.toBe("vieja");
  expect(prompt(0)).toContain("gasté 50 en café");
});
