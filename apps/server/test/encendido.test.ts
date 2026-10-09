import { describe, expect, test } from "bun:test";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { crearControlIa, type ModeloCargado, type OllamaControl, SIEMPRE } from "../src/ai/encendido";
import { crearModelo } from "../src/ai/modelo";
import { crearApp } from "../src/app";
import { crearInvitacion } from "../src/auth";
import { abrirBaseDatos } from "../src/db/client";
import { configuracion } from "../src/db/schema";
import { texto } from "./ayuda";

const MODELO = "gemma4:12b-it-qat";
const AHORA = Date.parse("2026-10-08T20:00:00Z");
// Lo que Ollama reporta con keep_alive -1 (por ejemplo OLLAMA_KEEP_ALIVE=-1): una fecha a siglos.
const SIN_LIMITE = "2318-01-01T00:00:00Z";

/** Un Ollama falso que recuerda qué se le pidió y qué tiene en memoria. */
function ollamaFalso(inicial: ModeloCargado[] = []) {
  const pedidos: (number | string)[] = [];
  const estado = { memoria: [...inicial], contesta: true, descargado: true };
  const ollama: OllamaControl = {
    enMemoria: async () => (estado.contesta ? estado.memoria : null),
    descargados: async () => (estado.contesta ? (estado.descargado ? [MODELO] : []) : null),
    async cargar(keepAlive) {
      if (!estado.contesta) return false;
      pedidos.push(keepAlive);
      if (keepAlive === 0) estado.memoria = [];
      else {
        const [, n, unidad] = String(keepAlive).match(/^(\d+)([mh])$/) ?? [];
        const vence = new Date(AHORA + Number(n) * (unidad === "h" ? 3_600_000 : 60_000)).toISOString();
        estado.memoria = [{ name: MODELO, expires_at: vence, size: 8_200_000_000 }];
      }
      return true;
    },
  };
  return { ollama, pedidos, estado };
}

function preparar(inicial: ModeloCargado[] = [], porOmision?: { siempre?: boolean; minutos?: number }) {
  const db = abrirBaseDatos(":memory:");
  const falso = ollamaFalso(inicial);
  const control = crearControlIa({ db, modelo: MODELO, ollama: falso.ollama, porOmision, esperaTrasUsoMs: 5, ahora: () => AHORA });
  return { db, control, ...falso };
}

describe("interruptor de la IA", () => {
  test("sin nada guardado queda siempre encendida, como lo pidió el dueño", async () => {
    const { control } = preparar();
    expect(control.modo()).toEqual({ siempre: true, minutos: 10, apagadaAMano: false });
    expect(control.keepAlive()).toBe(SIEMPRE);
    expect(await control.estado()).toMatchObject({ siempre: true, cargada: false, disponible: true, hasta: null, modelo: MODELO });
  });

  test("encender la carga por un año (texto, no -1) y el estado lo muestra sin fecha", async () => {
    const { control, pedidos } = preparar();
    const e = await control.encender();
    expect(pedidos).toEqual([SIEMPRE]);
    expect(e).toMatchObject({ cargada: true, hasta: null, memoria: 8_200_000_000, apagadaAMano: false });
  });

  test("con plazo, encender la deja hasta N minutos y el estado dice hasta cuándo", async () => {
    const { control, pedidos } = preparar();
    await control.cambiar({ siempre: false, minutos: 30 });
    expect(pedidos).toEqual([]); // no estaba cargada: el plazo se aplica al próximo uso
    const e = await control.encender();
    expect(pedidos).toEqual(["30m"]);
    expect(e.hasta).toBe(new Date(AHORA + 30 * 60_000).toISOString());
    expect(e).toMatchObject({ siempre: false, minutos: 30 });
  });

  test("cambiar el plazo con el modelo cargado lo aplica ya; pasar a siempre lo carga", async () => {
    const { control, pedidos } = preparar([{ name: MODELO, expires_at: SIN_LIMITE }]);
    await control.cambiar({ siempre: false, minutos: 5 });
    expect(pedidos).toEqual(["5m"]);
    await control.cambiar({ minutos: 60 });
    expect(pedidos).toEqual(["5m", "60m"]);
    await control.cambiar({ siempre: true });
    expect(pedidos).toEqual(["5m", "60m", SIEMPRE]);
  });

  test("los minutos se acotan de 1 a 1440 y lo guardado sobrevive a un reinicio", async () => {
    const { db, control, ollama } = preparar();
    await control.cambiar({ siempre: false, minutos: 99_999 });
    expect(control.modo().minutos).toBe(1440);
    await control.cambiar({ minutos: 0 });
    expect(control.modo().minutos).toBe(1);
    const otro = crearControlIa({ db, modelo: MODELO, ollama });
    expect(otro.modo()).toEqual({ siempre: false, minutos: 1, apagadaAMano: false });
  });

  test("apagar la suelta y el vigilante no la vuelve a cargar hasta el próximo uso", async () => {
    const { control, pedidos } = preparar([{ name: MODELO, expires_at: SIN_LIMITE }]);
    const e = await control.apagar();
    expect(pedidos).toEqual([0]);
    expect(e).toMatchObject({ cargada: false, apagadaAMano: true, siempre: true });
    const parar = control.vigilar(5);
    await Bun.sleep(30);
    parar();
    expect(pedidos).toEqual([0]);
    // Un dictado la carga de nuevo y quita el "apagada a mano" en ese momento (Ajustes lo ve sin esperar).
    control.trasUsar();
    expect(control.modo().apagadaAMano).toBe(false);
    await Bun.sleep(30);
    expect(pedidos).toEqual([0, SIEMPRE]);
    expect(control.modo().apagadaAMano).toBe(false);
  });

  test("el vigilante la recarga si Ollama la soltó o la tiene con plazo, y no hace nada si ya está sin límite", async () => {
    const { control, pedidos, estado } = preparar();
    let parar = control.vigilar(5);
    await Bun.sleep(30);
    parar();
    expect(pedidos).toEqual([SIEMPRE]); // no estaba: la carga una vez y luego ya la ve sin límite

    // OLLAMA_KEEP_ALIVE de 5 min tras un dictado por /v1: la vuelve a dejar sin límite.
    estado.memoria = [{ name: MODELO, expires_at: new Date(AHORA + 5 * 60_000).toISOString() }];
    parar = control.vigilar(5);
    await Bun.sleep(30);
    parar();
    expect(pedidos).toEqual([SIEMPRE, SIEMPRE]);

    // Ollama apagado: no truena ni insiste.
    estado.contesta = false;
    estado.memoria = [];
    parar = control.vigilar(5);
    await Bun.sleep(30);
    parar();
    expect(pedidos).toEqual([SIEMPRE, SIEMPRE]);
  });

  test("en modo con plazo el vigilante no carga nada", async () => {
    const { control, pedidos } = preparar([], { siempre: false });
    const parar = control.vigilar(5);
    await Bun.sleep(30);
    parar();
    expect(pedidos).toEqual([]);
  });

  test("con plazo, si Ollama la tiene sin límite (OLLAMA_KEEP_ALIVE=-1) el vigilante le pone el plazo, una vez", async () => {
    const { control, pedidos, estado } = preparar([{ name: MODELO, expires_at: SIN_LIMITE }], { siempre: false, minutos: 10 });
    const parar = control.vigilar(5);
    await Bun.sleep(30);
    parar();
    expect(pedidos).toEqual(["10m"]);
    expect(estado.memoria[0]?.expires_at).toBe(new Date(AHORA + 10 * 60_000).toISOString());
  });

  test("con plazo, apagada a mano y cargada sin límite, el vigilante también le pone el plazo", async () => {
    const { db, control, pedidos } = preparar([{ name: MODELO, expires_at: SIN_LIMITE }], { siempre: false, minutos: 5 });
    db.insert(configuracion).values({ clave: "ia_encendido", valor: { siempre: false, minutos: 5, apagadaAMano: true } }).run();
    const parar = control.vigilar(5);
    await Bun.sleep(30);
    parar();
    expect(pedidos).toEqual(["5m"]);
  });

  test("como respaldo de Claude no hereda el 'siempre encendida' de cuando era la IA principal", async () => {
    const db = abrirBaseDatos(":memory:");
    db.insert(configuracion).values({ clave: "ia_encendido", valor: { siempre: true, minutos: 10, apagadaAMano: false } }).run();
    const { ollama, pedidos } = ollamaFalso([{ name: MODELO, expires_at: SIN_LIMITE }]);
    const control = crearControlIa({ db, modelo: MODELO, ollama, respaldo: true, porOmision: { siempre: false, minutos: 10 }, ahora: () => AHORA });
    expect(control.modo()).toEqual({ siempre: false, minutos: 10, apagadaAMano: false });
    expect(await control.estado()).toMatchObject({ respaldo: true, siempre: false });
    // La que quedó cargada por un año se suelta a los 10 min.
    const parar = control.vigilar(5);
    await Bun.sleep(30);
    parar();
    expect(pedidos).toEqual(["10m"]);
    // Lo que se elija en Ajustes se guarda aparte y sobrevive a un reinicio; lo de antes no se toca.
    await control.cambiar({ minutos: 30 });
    const otra = crearControlIa({ db, modelo: MODELO, ollama, respaldo: true, porOmision: { siempre: false, minutos: 10 } });
    expect(otra.modo()).toEqual({ siempre: false, minutos: 30, apagadaAMano: false });
    const viejo = db.select().from(configuracion).all().find((f) => f.clave === "ia_encendido");
    expect(viejo?.valor).toEqual({ siempre: true, minutos: 10, apagadaAMano: false });
  });

  test("tras usar repite el keep_alive una sola vez aunque el dictado llame varias veces al modelo", async () => {
    const { control, pedidos } = preparar([], { siempre: false, minutos: 10 });
    control.trasUsar();
    control.trasUsar();
    control.trasUsar();
    await Bun.sleep(30);
    expect(pedidos).toEqual(["10m"]);
  });

  test("un valor guardado roto no rompe: se usa lo de por omisión", async () => {
    const { db, control } = preparar();
    db.insert(configuracion).values({ clave: "ia_encendido", valor: { siempre: "sí", minutos: "x" } }).run();
    expect(control.modo()).toEqual({ siempre: true, minutos: 10, apagadaAMano: false });
  });
});

describe("el modelo avisa al interruptor de cada uso", () => {
  test("crearModelo con alUsar avisa al terminar, también si la llamada falla", async () => {
    let usos = 0;
    const ia = {
      url: "http://127.0.0.1:9/v1",
      ollamaUrl: "http://127.0.0.1:9",
      modelo: MODELO,
      apiKey: "x",
      claveNube: undefined,
      modeloDificil: "",
      respaldo: "no",
      mantenerCargado: "5m",
      razonamiento: "none",
      razonamientoDificil: "no",
      paralelo: 1,
      interruptor: true,
    };
    const modelo = crearModelo(ia, MODELO, () => usos++);
    await generateText({ model: modelo, prompt: "hola", maxRetries: 0 }).catch(() => undefined);
    expect(usos).toBe(1);
  });
});

describe("/v1/ia", () => {
  function montar(conControl = true) {
    const db = abrirBaseDatos(":memory:");
    const falso = ollamaFalso();
    const controlIa = conControl
      ? crearControlIa({ db, modelo: MODELO, ollama: falso.ollama, esperaTrasUsoMs: 5, ahora: () => AHORA })
      : undefined;
    let preguntas = 0;
    const app = crearApp({
      db,
      modelo: new MockLanguageModelV4({ doGenerate: async () => texto("Listo") }),
      zonaHoraria: "America/Mexico_City",
      monedaBase: "MXN",
      controlIa,
      estadoIa: async () => {
        preguntas++;
        return { modelo: MODELO, disponible: true, cargada: falso.estado.memoria.length > 0 };
      },
    });
    const pedir = async (ruta: string, opciones: { metodo?: string; cuerpo?: unknown; token?: string } = {}) => {
      const r = await app.request(`https://mac.tu-red.ts.net${ruta}`, {
        method: opciones.metodo ?? (opciones.cuerpo ? "POST" : "GET"),
        headers: { "content-type": "application/json", ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}) },
        body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
      });
      return { estado: r.status, cuerpo: (await r.json().catch(() => null)) as Record<string, any> };
    };
    const entrar = async (nombre: string) => {
      const { codigo } = crearInvitacion(db);
      const r = await pedir("/v1/registro", { cuerpo: { codigo, nombre, dispositivo: "iPhone" } });
      return r.cuerpo.token as string;
    };
    return { pedir, entrar, falso, preguntas: () => preguntas };
  }

  test("sin token no entra; otra cuenta recibe 403 sin datos del modelo", async () => {
    const { pedir, entrar, falso } = montar();
    await entrar("Pedro");
    const amigo = await entrar("Amigo");
    expect((await pedir("/v1/ia")).estado).toBe(401);
    expect((await pedir("/v1/ia/apagar", { metodo: "POST" })).estado).toBe(401);
    for (const [ruta, metodo, cuerpo] of [
      ["/v1/ia", "GET", undefined],
      ["/v1/ia", "PUT", { siempre: false }],
      ["/v1/ia/encender", "POST", undefined],
      ["/v1/ia/apagar", "POST", undefined],
    ] as const) {
      const r = await pedir(ruta, { metodo, cuerpo, token: amigo });
      expect(r.estado).toBe(403);
      expect(JSON.stringify(r.cuerpo)).not.toContain("gemma");
    }
    expect(falso.pedidos).toEqual([]);
  });

  test("la cuenta dueña ve el estado, cambia el modo, enciende y apaga", async () => {
    const { pedir, entrar, falso } = montar();
    const token = await entrar("Pedro");
    const e = await pedir("/v1/ia", { token });
    expect(e.estado).toBe(200);
    expect(e.cuerpo).toMatchObject({ siempre: true, minutos: 10, cargada: false, disponible: true, modelo: MODELO });

    const plazo = await pedir("/v1/ia", { metodo: "PUT", cuerpo: { siempre: false, minutos: 30 }, token });
    expect(plazo.cuerpo).toMatchObject({ siempre: false, minutos: 30 });

    const on = await pedir("/v1/ia/encender", { metodo: "POST", token });
    expect(on.cuerpo).toMatchObject({ cargada: true, hasta: new Date(AHORA + 30 * 60_000).toISOString() });

    const off = await pedir("/v1/ia/apagar", { metodo: "POST", token });
    expect(off.cuerpo).toMatchObject({ cargada: false, apagadaAMano: true });
    expect(falso.pedidos).toEqual(["30m", 0]);
  });

  test("datos inválidos: 400 y nada cambia", async () => {
    const { pedir, entrar } = montar();
    const token = await entrar("Pedro");
    for (const cuerpo of [{}, { minutos: 0 }, { minutos: 2000 }, { minutos: 2.5 }, { siempre: "sí" }, { siempre: true, otro: 1 }, null]) {
      const r = await pedir("/v1/ia", { metodo: "PUT", cuerpo, token });
      expect(r.estado).toBe(400);
    }
    expect((await pedir("/v1/ia", { token })).cuerpo).toMatchObject({ siempre: true, minutos: 10 });
  });

  test("al encender, /v1/estado no espera los 10 s del caché para decir que está lista", async () => {
    const { pedir, entrar, preguntas } = montar();
    const token = await entrar("Pedro");
    expect((await pedir("/v1/estado", { token })).cuerpo.ia.cargada).toBe(false);
    await pedir("/v1/ia/encender", { metodo: "POST", token });
    expect((await pedir("/v1/estado", { token })).cuerpo.ia.cargada).toBe(true);
    expect(preguntas()).toBe(2);
  });

  test("con IA_INTERRUPTOR=0 (sin control) la ruta no existe", async () => {
    const { pedir, entrar } = montar(false);
    const token = await entrar("Pedro");
    expect((await pedir("/v1/ia", { token })).estado).toBe(404);
    expect((await pedir("/v1/ia/encender", { metodo: "POST", token })).estado).toBe(404);
  });
});
