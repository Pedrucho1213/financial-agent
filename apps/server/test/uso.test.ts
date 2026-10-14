import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { hablar, precalentar } from "../src/ai/asistente";
import {
  avisoDeConsultas,
  avisosDeGasto,
  bloqueoIa,
  type LimitesIa,
  consultasDelDia,
  costoDelMes,
  costoMicroUsd,
  MAX_DICTADO,
  RESPUESTA_MUY_LARGO,
  RESPUESTA_SIN_CONSULTAS,
  respuestaSinIa,
  sinModeloDificil,
  usoDeHoy,
} from "../src/ai/uso";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { usoIa } from "../src/db/schema";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { fechaLocal } from "../src/lib/fechas";
import { preparar } from "./ayuda";

// Consultas de IA por día, su costo y los topes por cuenta (ai/uso.ts).

const ZONA = "America/Mexico_City";
const hoy = () => fechaLocal(new Date(), ZONA);

const uso = (entrada: number, salida: number, lectura = 0, escritura = 0) => ({
  inputTokens: { total: entrada + lectura + escritura, noCache: entrada, cacheRead: lectura, cacheWrite: escritura },
  outputTokens: { total: salida, text: salida, reasoning: undefined },
});

/** Modelo falso que registra el monto dictado y contesta como si fuera Claude Haiku. */
function modeloHaiku() {
  let llamadas = 0;
  const modelo = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      llamadas++;
      const primerPaso = prompt.at(-1)?.role === "user";
      const respuesta = { modelId: "claude-haiku-5-5" };
      if (!primerPaso) return { content: [{ type: "text", text: "Listo." }], finishReason: { unified: "stop", raw: undefined }, usage: uso(1000, 20), warnings: [], response: respuesta };
      const dictado = JSON.stringify(prompt.findLast((m) => m.role === "user")?.content ?? "");
      const monto = Number(dictado.match(/\d+/)?.[0] ?? 1);
      return {
        content: [{ type: "tool-call", toolCallId: crypto.randomUUID(), toolName: "registrar_movimientos", input: JSON.stringify({ movimientos: [{ tipo: "gasto", monto, descripcion: "tacos" }] }) }],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: uso(2000, 50, 6000),
        warnings: [],
        response: respuesta,
      };
    },
  });
  return { modelo, llamadas: () => llamadas };
}

function montar(limites?: LimitesIa) {
  const { db, usuario: pedro } = preparar();
  const ana = crearUsuario(db, "Ana");
  sembrarCategorias(db, ana.id);
  const ia = modeloHaiku();
  const deps = { db, modelo: ia.modelo, zonaHoraria: ZONA, monedaBase: "MXN", limitesIa: limites };
  return { db, pedro, ana, ia, deps };
}

describe("costo", () => {
  test("se calcula con el precio de cada modelo, en millonésimas de dólar", () => {
    const haiku = costoMicroUsd("claude-haiku-5-5", { inputTokens: 8000, inputTokenDetails: { noCacheTokens: 2000, cacheReadTokens: 6000, cacheWriteTokens: 0 }, outputTokens: 100, outputTokenDetails: { textTokens: 100, reasoningTokens: undefined }, totalTokens: 8100 });
    // 2000 × 0.10 + 6000 × 0.01 + 100 × 0.50
    expect(haiku).toBe(310);
    const sonnet = costoMicroUsd("claude-sonnet-5-5-20260901", { inputTokens: 1000, inputTokenDetails: { noCacheTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokens: 100, outputTokenDetails: { textTokens: 100, reasoningTokens: undefined }, totalTokens: 1100 });
    expect(sonnet).toBe(3000);
    // Lo que contesta la Mac no cuesta.
    expect(costoMicroUsd("gemma4:12b-it-qat", { inputTokens: 1000, inputTokenDetails: { noCacheTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokens: 100, outputTokenDetails: { textTokens: 100, reasoningTokens: undefined }, totalTokens: 1100 })).toBe(0);
  });
});

describe("consultas del día", () => {
  test("cada dictado que llega al modelo cuenta una vez y queda su costo", async () => {
    const { db, pedro, deps } = montar();
    await hablar(deps, pedro.id, { texto: "gasté 120 en tacos", clientId: "uso-0001" });
    await hablar(deps, pedro.id, { texto: "gasté 80 en café", clientId: "uso-0002" });
    // El mismo dictado reenviado por la cola no es otra consulta.
    await hablar(deps, pedro.id, { texto: "gasté 80 en café", clientId: "uso-0002" });
    expect(consultasDelDia(db, pedro.id, hoy())).toBe(2);
    const filas = db.select().from(usoIa).all();
    expect(filas.every((f) => f.modelo === "claude-haiku-5-5" && f.costoMicroUsd > 0)).toBe(true);
    expect(costoDelMes(db, hoy())).toBeGreaterThan(0);
  });

  test("al llegar al tope, ya no se llama al modelo y se le dice cuándo se renuevan", async () => {
    const { ana, ia, deps } = montar({ consultasDia: 2, topeDificilUsd: 0 });
    await hablar(deps, ana.id, { texto: "gasté 120 en tacos", clientId: "ana-0001" });
    const segunda = await hablar(deps, ana.id, { texto: "gasté 80 en café", clientId: "ana-0002" });
    expect(segunda.respuesta).toContain("Con esto usaste todas tus consultas de IA de hoy");
    const antes = ia.llamadas();
    const tercera = await hablar(deps, ana.id, { texto: "gasté 50 en pan", clientId: "ana-0003" });
    expect(tercera.respuesta).toBe(RESPUESTA_SIN_CONSULTAS(2));
    expect(ia.llamadas()).toBe(antes);
  });

  test("cada 500 caracteres cuentan como una consulta; el último dictado pasa aunque cueste más de lo que queda", async () => {
    const { db, ana, ia, deps } = montar({ consultasDia: 2, topeDificilUsd: 0 });
    await hablar(deps, ana.id, { texto: "gasté 120 en tacos", clientId: "ana-0201" });
    // 1,200 caracteres: 3 consultas, con solo 1 disponible. Se procesa y se avisa.
    const largo = `gasté 300 en el súper ${"y también compré algo más ".repeat(46)}`.slice(0, 1200);
    const r = await hablar(deps, ana.id, { texto: largo, clientId: "ana-0202" });
    expect(r.respuesta).toContain("Por lo largo, ese mensaje contó como 3 consultas.");
    expect(r.respuesta).toEndWith("Con esto usaste todas tus consultas de IA de hoy; mañana se renuevan.");
    expect(usoDeHoy(db, ana.id, hoy(), deps.limitesIa)).toEqual({ consultas: 4, limite: 2, quedan: 0 });
    // Ya no pasa nada más hoy: se pasó del tope solo por ese dictado.
    const antes = ia.llamadas();
    expect((await hablar(deps, ana.id, { texto: "gasté 50 en pan", clientId: "ana-0203" })).respuesta).toBe(RESPUESTA_SIN_CONSULTAS(2));
    expect(ia.llamadas()).toBe(antes);
  });

  test("con pocas consultas, la respuesta dice cuántas quedan", async () => {
    const { ana, deps } = montar({ consultasDia: 4, topeDificilUsd: 0 });
    const r = await hablar(deps, ana.id, { texto: "gasté 120 en tacos", clientId: "ana-0101" });
    expect(r.respuesta).toEndWith("Te quedan 3 consultas de IA por hoy.");
  });

  test("la cuenta dueña no tiene tope", async () => {
    const { db, pedro, deps } = montar({ consultasDia: 1, topeDificilUsd: 1 });
    await hablar(deps, pedro.id, { texto: "gasté 120 en tacos", clientId: "pedro-0001" });
    const r = await hablar(deps, pedro.id, { texto: "gasté 80 en café", clientId: "pedro-0002" });
    expect(r.respuesta).not.toContain("consultas");
    expect(usoDeHoy(db, pedro.id, hoy(), deps.limitesIa)).toEqual({ consultas: 2, limite: null, quedan: null });
  });

  test("avisoDeConsultas solo habla cuando quedan 5 o menos", () => {
    expect(avisoDeConsultas({ consultas: 10, limite: 40, quedan: 30 })).toBeUndefined();
    expect(avisoDeConsultas({ consultas: 39, limite: 40, quedan: 1 })).toBe("Te queda 1 consulta de IA por hoy.");
    expect(avisoDeConsultas({ consultas: 3, limite: null, quedan: null }, 3)).toBeUndefined();
    expect(avisoDeConsultas({ consultas: 12, limite: 40, quedan: 28 }, 2)).toBe("Por lo largo, ese mensaje contó como 2 consultas.");
  });
});

describe("tope del modelo difícil", () => {
  test("al gastar el tope del mes en Sonnet, deja de usarse (salvo la cuenta dueña)", () => {
    const { db, pedro, ana } = montar();
    const limites = { consultasDia: 0, topeDificilUsd: 2 };
    for (const usuarioId of [pedro.id, ana.id]) {
      db.insert(usoIa).values({ usuarioId, entradaId: "x", dia: hoy(), modelo: "claude-sonnet-5-5", costoMicroUsd: 2_100_000 }).run();
    }
    expect(sinModeloDificil(db, ana.id, hoy(), limites)).toBe(true);
    expect(sinModeloDificil(db, pedro.id, hoy(), limites)).toBe(false);
    expect(sinModeloDificil(db, ana.id, hoy(), { consultasDia: 0, topeDificilUsd: 0 })).toBe(false);
  });
});

describe("API", () => {
  test("un dictado demasiado largo no llega a la IA y /v1/estado dice cuántas consultas quedan", async () => {
    const { db, ana, ia, deps } = montar({ consultasDia: 40, topeDificilUsd: 2 });
    const app = crearApp({ ...deps, limitesIa: { ...deps.limitesIa!, presupuestoMesUsd: 50 } });
    const token = crearDispositivo(db, ana.id, "iPhone de Ana");
    const pedir = (ruta: string, cuerpo?: unknown) =>
      app.request(ruta, {
        method: cuerpo ? "POST" : "GET",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    const largo = await pedir("/v1/hablar", { texto: "a".repeat(MAX_DICTADO + 1), client_id: "ana-largo-1", espera_ms: 1000 });
    expect(largo.status).toBe(200);
    expect(((await largo.json()) as { respuesta: string }).respuesta).toBe(RESPUESTA_MUY_LARGO);
    expect(ia.llamadas()).toBe(0);

    await pedir("/v1/hablar", { texto: "gasté 120 en tacos", client_id: "ana-corto-1", espera_ms: 5000 });
    const estado = (await (await pedir("/v1/estado")).json()) as { uso: { consultas: number; limite: number; quedan: number; mes?: unknown } };
    expect(estado.uso).toMatchObject({ consultas: 1, limite: 40, quedan: 39, maxCaracteres: 1500, caracteresPorConsulta: 500 });
    // Lo gastado por todas las cuentas solo lo ve el dueño.
    expect(estado.uso.mes).toBeUndefined();
  });
});

/** Gasto ya anotado de una cuenta, en USD. */
const gastado = (db: ReturnType<typeof montar>["db"], usuarioId: string, usd: number, dia = hoy()) =>
  db.insert(usoIa).values({ usuarioId, entradaId: crypto.randomUUID(), dia, modelo: "claude-haiku-5-5", costoMicroUsd: Math.round(usd * 1e6) }).run();

describe("topes en USD y pausa de la app", () => {
  test("una cuenta que llega a su tope en USD del día ya no llama al modelo, aunque le queden consultas", async () => {
    const { db, ana, ia, deps } = montar({ consultasDia: 40, topeDificilUsd: 2, topeDiaUsd: 0.25 });
    gastado(db, ana.id, 0.26);
    const r = await hablar(deps, ana.id, { texto: "gasté 50 en pan", clientId: "ana-usd-1" });
    expect(r.respuesta).toBe(respuestaSinIa("dia", 40));
    expect(ia.llamadas()).toBe(0);
    expect(usoDeHoy(db, ana.id, hoy(), deps.limitesIa)).toMatchObject({ quedan: 0, aviso: respuestaSinIa("dia", 40) });
  });

  test("un día con gasto fuera de lo normal pausa a las demás cuentas, no a la dueña", async () => {
    const limites = { consultasDia: 40, topeDificilUsd: 2, topeDiaUsd: 0.25, presupuestoMesUsd: 50 };
    const { db, pedro, ana, ia, deps } = montar(limites);
    gastado(db, pedro.id, 10);
    expect(bloqueoIa(db, ana.id, hoy(), limites)).toBe("pausa-dia");
    expect(bloqueoIa(db, pedro.id, hoy(), limites)).toBeUndefined();
    expect((await hablar(deps, ana.id, { texto: "gasté 50 en pan", clientId: "ana-pausa-1" })).respuesta).toBe(respuestaSinIa("pausa-dia", 40));
    expect(ia.llamadas()).toBe(0);
    await hablar(deps, pedro.id, { texto: "gasté 50 en pan", clientId: "pedro-pausa-1" });
    expect(ia.llamadas()).toBeGreaterThan(0);
  });

  test("al 90% del presupuesto del mes, las demás cuentas se quedan sin IA hasta el próximo mes", () => {
    const limites = { consultasDia: 40, topeDificilUsd: 2, presupuestoMesUsd: 50 };
    const { db, pedro, ana } = montar(limites);
    // Lo gastado el día 1 cuenta en todo el mes.
    gastado(db, pedro.id, 45, `${hoy().slice(0, 7)}-01`);
    expect(bloqueoIa(db, ana.id, hoy(), limites)).toBe("pausa-mes");
    expect(bloqueoIa(db, pedro.id, hoy(), limites)).toBeUndefined();
  });

  test("la cuenta dueña tiene su propio tope por día, por si le roban un token", async () => {
    const { db, pedro, ia, deps } = montar({ consultasDia: 40, topeDificilUsd: 2, topeDiaDuenoUsd: 3 });
    gastado(db, pedro.id, 3);
    expect((await hablar(deps, pedro.id, { texto: "gasté 50 en pan", clientId: "pedro-robado-1" })).respuesta).toBe(respuestaSinIa("dia", 0));
    expect(ia.llamadas()).toBe(0);
  });

  test("sin IA por hoy, abrir el Atajo no precalienta (con Claude también cuesta)", async () => {
    const { db, ana, ia, deps } = montar({ consultasDia: 1, topeDificilUsd: 2 });
    await hablar(deps, ana.id, { texto: "gasté 120 en tacos", clientId: "ana-pre-1" });
    const antes = ia.llamadas();
    await precalentar(deps, ana.id);
    expect(ia.llamadas()).toBe(antes);
    expect(consultasDelDia(db, ana.id, hoy())).toBe(1);
  });

  test("al dueño le llega cada aviso de gasto una sola vez", () => {
    const limites = { consultasDia: 40, topeDificilUsd: 2, topeDiaUsd: 0.25, topeDiaDuenoUsd: 3, presupuestoMesUsd: 50 };
    const { db, pedro, ana } = montar(limites);
    gastado(db, pedro.id, 1);
    expect(avisosDeGasto(db, hoy(), limites)).toEqual([]);
    gastado(db, pedro.id, 24.5);
    expect(avisosDeGasto(db, hoy(), limites).map((a) => a.titulo)).toEqual([
      "Claude: 50% del presupuesto",
      "Gasto de IA fuera de lo normal",
      "Tu IA llegó a su tope de hoy",
    ]);
    expect(avisosDeGasto(db, hoy(), limites)).toEqual([]);
    gastado(db, ana.id, 0.3);
    const avisos = avisosDeGasto(db, hoy(), limites);
    expect(avisos.map((a) => a.titulo)).toEqual(["Ana llegó a su tope de IA de hoy"]);
    expect(avisos[0]!.cuerpo).toContain("$0.30 USD");
  });
});

describe("invitaciones", () => {
  test("solo la cuenta dueña crea códigos para cuentas nuevas, salvo con INVITAR_CUENTAS=todos", async () => {
    for (const invitarCuentas of ["dueno", "todos"] as const) {
      const { db, pedro, ana, deps } = montar();
      const app = crearApp({ ...deps, invitarCuentas });
      const pedir = (token: string, para: string) =>
        app.request("/v1/invitaciones", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ para }),
        });
      const deAna = crearDispositivo(db, ana.id, "iPhone de Ana");
      const dePedro = crearDispositivo(db, pedro.id, "iPhone de Pedro");
      const r = await pedir(deAna, "usuario");
      expect(r.status).toBe(invitarCuentas === "todos" ? 201 : 403);
      if (r.status === 403) expect(((await r.json()) as { error: string }).error).toContain("solo la cuenta principal");
      expect((await pedir(deAna, "dispositivo")).status).toBe(201);
      expect((await pedir(dePedro, "usuario")).status).toBe(201);
      const yo = (await (await app.request("/v1/yo", { headers: { authorization: `Bearer ${deAna}` } })).json()) as { puedeInvitar: boolean };
      expect(yo.puedeInvitar).toBe(invitarCuentas === "todos");
    }
  });
});
