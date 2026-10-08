// QA del PR #36: con notificaciones, el Atajo espera a la IA en correcciones y la confirmación rápida rota.
// Correr desde apps/server: bun test qa/pr36.test.ts
// "OK" afirma lo pedido; "HALLAZGO" reproduce lo que sigue mal (afirma lo actual para que quede reproducido).
// La IA es falsa y lenta (40 ms): un registro rápido no la espera, una corrección sí.
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import * as servidor from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { movimientos } from "../src/db/schema";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { esOrdenSobreLoAnotado } from "../src/lib/texto";
import { llamada, preparar } from "../test/ayuda";

const { crearApp } = servidor;
const RAPIDAS: string[] = [...((servidor as any).RESPUESTAS_RAPIDAS ?? [(servidor as any).RESPUESTA_RAPIDA])];
const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMtsHJWSeD1h4ztT4fjpQ";
const LLAVES = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

const registro = (monto: number, comercio = "Starbucks", categoria = "Café") =>
  llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto, comercio, categoria }] });
const edicion = (de: number, a: number) => llamada("editar_movimiento", { buscar: { texto: "Starbucks", monto: de }, cambios: { monto: a } });

function montar(respuestas: unknown[]) {
  const { db, usuario } = preparar({ ahora: new Date() });
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const ana = crearUsuario(db, "Ana");
  sembrarCategorias(db, ana.id);
  const tokenAna = crearDispositivo(db, ana.id, "iPhone Ana");
  const enviadas: string[] = [];
  const app = crearApp({
    db,
    modelo: new MockLanguageModelV4({ doGenerate: async () => (await Bun.sleep(40), respuestas.shift()) as never }),
    zonaHoraria: "America/Mexico_City",
    monedaBase: "MXN",
    espera: { registroMs: 5000, preguntaMs: 30000 },
    enviarPush: async (_s: unknown, m: string) => (enviadas.push(JSON.parse(m).cuerpo ?? m), { ok: true, estado: 201, vencida: false }),
  } as any);
  const pedir = async (ruta: string, metodo: string, cuerpo: unknown, tk = token) => {
    const r = await app.request(ruta, {
      method: metodo,
      headers: { authorization: `Bearer ${tk}`, "content-type": "application/json", host: "finanzas.ejemplo.ts.net", "user-agent": "Shortcuts/4000 CFNetwork Darwin" },
      body: JSON.stringify(cuerpo),
    });
    return { status: r.status, respuesta: ((await r.json()) as { respuesta: string }).respuesta };
  };
  const activar = (tk = token) =>
    pedir("/v1/push/suscripcion", "POST", { endpoint: `${ENDPOINT}${tk.slice(-4)}`, keys: LLAVES, origen: "https://finanzas.ejemplo.ts.net", en_iphone: true }, tk);
  let n = 0;
  const dictar = (texto: string, tk = token) => pedir("/v1/hablar", "POST", { texto, client_id: `qa36-${String(n++).padStart(6, "0")}` }, tk);
  const montos = () => db.select().from(movimientos).all().filter((m) => m.usuarioId === usuario.id && !m.eliminadoEn).map((m) => m.montoCentavos / 100);
  return { activar, dictar, montos, enviadas, tokenAna };
}

async function hasta(condicion: () => boolean, ms = 2000) {
  const fin = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > fin) throw new Error("No pasó a tiempo.");
    await Bun.sleep(5);
  }
}

describe("PR #36: correcciones con monto", () => {
  for (const frase of ["No eran 85, eran 95", "Me equivoqué, fue de 95", "Actualiza el Starbucks a 95", "Eran 95, no 85", "Corrige el café, fueron 95"]) {
    test(`OK: "${frase}" espera a la IA y se oye qué cambió`, async () => {
      const { activar, dictar, montos, enviadas } = montar([registro(85), edicion(85, 95)]);
      await activar();
      expect((await dictar("Gasté 85 en Starbucks")).respuesta).toBeOneOf(RAPIDAS);
      await hasta(() => enviadas.length === 1);
      const r = await dictar(frase);
      expect(r.status).toBe(200);
      expect(r.respuesta).not.toBeOneOf(RAPIDAS);
      expect(r.respuesta).toContain("95");
      expect(montos()).toEqual([95]);
      await Bun.sleep(60);
      expect(enviadas).toHaveLength(1);
    });
  }

  // Correcciones comunes que la expresión no reconoce: el Atajo dice "Listo"/"Anotado" sin esperar y lo
  // que cambió solo llega por notificación (lo mismo que antes del PR).
  for (const frase of ["No, fueron 95", "Siempre no, fueron 95", "Error, eran 95", "No, espera, eran 95", "Te dije 85 pero fueron 95", "Perdón, el café fue de 95", "Ponle 95 al café"]) {
    test(`HALLAZGO: "${frase}" no se reconoce como corrección: confirmación rápida sin oír el cambio`, async () => {
      expect(esOrdenSobreLoAnotado(frase)).toBe(false);
      const { activar, dictar, montos, enviadas } = montar([registro(85), edicion(85, 95)]);
      await activar();
      await dictar("Gasté 85 en Starbucks");
      await hasta(() => enviadas.length === 1);
      const r = await dictar(frase);
      expect(r.respuesta).toBeOneOf(RAPIDAS);
      await hasta(() => montos()[0] === 95);
    });
  }
});

describe("PR #36: registros que no son correcciones", () => {
  for (const frase of ["Gasté 120 en tacos", "Pagué 300 del cambio de aceite", "Me cobraron 50 por cancelación", "Le puse 500 de gasolina"]) {
    test(`OK: "${frase}" sigue siendo rápido`, async () => {
      expect(esOrdenSobreLoAnotado(frase)).toBe(false);
      const { activar, dictar } = montar([registro(100, "X", "Otros gastos")]);
      await activar();
      expect((await dictar(frase)).respuesta).toBeOneOf(RAPIDAS);
    });
  }

  // El infinitivo cuenta como orden ("arregla(r)", "actualiza(r)", "modifica(r)"): un gasto en arreglar algo
  // espera a la IA (más lento) y se salta la pregunta de dictado repetido y la nota del gasto.
  for (const frase of ["Pagué 500 de arreglar el coche", "Pagué 80 de actualizar la app", "Pagué 1,200 de modificar el traje", "El último fue el café de 85", "En realidad fue un buen día, gasté 200 en comida"]) {
    test(`HALLAZGO: "${frase}" (registro nuevo) se toma como corrección y espera a la IA`, async () => {
      expect(esOrdenSobreLoAnotado(frase)).toBe(true);
      const { activar, dictar } = montar([registro(500, "Taller", "Otros gastos")]);
      await activar();
      expect((await dictar(frase)).respuesta).not.toBeOneOf(RAPIDAS);
    });
  }
});

describe("PR #36: confirmación rápida que rota", () => {
  test("OK: rota por usuario: lo que dice a Pedro no adelanta la de Ana", async () => {
    const { activar, dictar, tokenAna } = montar([registro(1), registro(2), registro(3), registro(4)]);
    await activar();
    await activar(tokenAna);
    const p1 = (await dictar("Gasté 1 en chicles")).respuesta;
    const p2 = (await dictar("Gasté 2 en chicles")).respuesta;
    const a1 = (await dictar("Gasté 3 en chicles", tokenAna)).respuesta;
    const p3 = (await dictar("Gasté 4 en chicles")).respuesta;
    expect([p1, p2, p3]).toEqual(RAPIDAS.slice(0, 3));
    expect(a1).toBe(RAPIDAS[0]!);
  });

  test("OK: ninguna confirmación rápida suena a pregunta ni dice un monto", () => {
    for (const r of RAPIDAS) {
      expect(r).not.toContain("?");
      expect(r).not.toMatch(/\d/);
    }
  });
});
