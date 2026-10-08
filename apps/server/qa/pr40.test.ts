// QA del PR #40: interruptor de la IA (solo la cuenta dueña). Correr desde apps/server: bun test qa/pr40.test.ts
// El servidor es público por Funnel: nadie más que la dueña puede ver ni cambiar el estado del modelo.
import { describe, expect, test } from "bun:test";
import { crearControlIa, type OllamaControl } from "../src/ai/encendido";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario, revocarDispositivo } from "../src/auth";
import { configuracion, dispositivos } from "../src/db/schema";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { preparar, texto } from "../test/ayuda";
import { MockLanguageModelV4 } from "ai/test";

const MODELO = "gemma4:12b-it-qat";

function montar() {
  const { db, usuario } = preparar({ ahora: new Date() });
  const tokenDueno = crearDispositivo(db, usuario.id, "iPhone");
  const ana = crearUsuario(db, "Ana");
  sembrarCategorias(db, ana.id);
  const tokenAna = crearDispositivo(db, ana.id, "iPhone Ana");
  const pedidos: (number | string)[] = [];
  let memoria: { name: string; expires_at?: string; size?: number }[] = [];
  const ollama: OllamaControl = {
    enMemoria: async () => memoria,
    descargados: async () => [MODELO],
    async cargar(k) {
      pedidos.push(k);
      memoria = k === 0 ? [] : [{ name: MODELO, expires_at: "2318-01-01T00:00:00Z", size: 8_200_000_000 }];
      return true;
    },
  };
  const controlIa = crearControlIa({ db, modelo: MODELO, ollama, esperaTrasUsoMs: 5 });
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: async () => texto("x") as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN", controlIa } as never);
  const pedir = async (ruta: string, metodo = "GET", cuerpo?: unknown, token?: string | null, extra: Record<string, string> = {}) => {
    const r = await app.request(ruta, {
      method: metodo,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", host: "finanzas.ejemplo.ts.net", ...extra },
      body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });
    return { status: r.status, cuerpo: (await r.json().catch(() => null)) as Record<string, unknown> | null, texto: "" };
  };
  return { db, usuario, ana, tokenDueno, tokenAna, pedir, pedidos };
}

const RUTAS: [string, string, unknown?][] = [
  ["/v1/ia", "GET"],
  ["/v1/ia", "PUT", { siempre: false, minutos: 5 }],
  ["/v1/ia/encender", "POST"],
  ["/v1/ia/apagar", "POST"],
];

describe("PR #40: quién puede tocar la IA", () => {
  test("OK: sin token, todas dan 401 y Ollama no recibe nada", async () => {
    const { pedir, pedidos } = montar();
    for (const [ruta, metodo, cuerpo] of RUTAS) expect((await pedir(ruta, metodo, cuerpo, null)).status, `${metodo} ${ruta}`).toBe(401);
    expect(pedidos).toEqual([]);
  });

  test("OK: token inventado o mal formado da 401", async () => {
    const { pedir, pedidos } = montar();
    for (const t of ["fa_inventado_123", "Bearer x", "", "fa_" + "a".repeat(5000)]) {
      for (const [ruta, metodo, cuerpo] of RUTAS) expect((await pedir(ruta, metodo, cuerpo, t || "x")).status, `${t.slice(0, 12)} ${metodo} ${ruta}`).toBe(401);
    }
    expect(pedidos).toEqual([]);
  });

  test("OK: otra cuenta recibe 403 sin datos del modelo y no cambia nada", async () => {
    const { pedir, tokenAna, pedidos, db } = montar();
    for (const [ruta, metodo, cuerpo] of RUTAS) {
      const r = await pedir(ruta, metodo, cuerpo, tokenAna);
      expect(r.status, `${metodo} ${ruta}`).toBe(403);
      expect(JSON.stringify(r.cuerpo)).not.toMatch(/gemma|memoria|cargada|siempre"|minutos/);
    }
    expect(pedidos).toEqual([]);
    expect(db.select().from(configuracion).all().filter((c) => c.clave === "ia_encendido")).toHaveLength(0);
  });

  test("OK: un dispositivo revocado de la dueña ya no entra", async () => {
    const { pedir, tokenDueno, usuario, db } = montar();
    expect((await pedir("/v1/ia", "GET", undefined, tokenDueno)).status).toBe(200);
    const id = db.select().from(dispositivos).all().find((d) => d.usuarioId === usuario.id)!.id;
    revocarDispositivo(db, usuario.id, id);
    expect((await pedir("/v1/ia/apagar", "POST", undefined, tokenDueno)).status).toBe(401);
  });

  test("OK: una cuenta creada después no se vuelve dueña aunque la primera no tenga dispositivos", async () => {
    const { pedir, tokenAna, usuario, db } = montar();
    for (const d of db.select().from(dispositivos).all().filter((x) => x.usuarioId === usuario.id)) revocarDispositivo(db, usuario.id, d.id);
    expect((await pedir("/v1/ia/encender", "POST", undefined, tokenAna)).status).toBe(403);
  });

  test("OK: la dueña enciende, apaga y cambia el modo", async () => {
    const { pedir, tokenDueno, pedidos } = montar();
    expect((await pedir("/v1/ia/encender", "POST", undefined, tokenDueno)).cuerpo).toMatchObject({ cargada: true, siempre: true });
    expect((await pedir("/v1/ia/apagar", "POST", undefined, tokenDueno)).cuerpo).toMatchObject({ cargada: false, apagadaAMano: true });
    expect((await pedir("/v1/ia", "PUT", { siempre: false, minutos: 15 }, tokenDueno)).cuerpo).toMatchObject({ siempre: false, minutos: 15 });
    expect((await pedir("/v1/ia", "PUT", { siempre: true }, tokenDueno)).cuerpo).toMatchObject({ siempre: true, cargada: true, apagadaAMano: false });
    expect(pedidos).toEqual([-1, 0, -1]);
  });
});

describe("PR #40: datos raros de la dueña", () => {
  const malos: unknown[] = [
    {},
    { minutos: 0 },
    { minutos: -5 },
    { minutos: 1441 },
    { minutos: 2.5 },
    { minutos: "10" },
    { siempre: "true" },
    { siempre: null },
    { siempre: true, extra: 1 },
    { keep_alive: -1 },
    [],
    "null",
    "no es json",
  ];
  for (const m of malos) {
    test(`OK: PUT ${JSON.stringify(m)} da 400 y no toca Ollama`, async () => {
      const { pedir, tokenDueno, pedidos } = montar();
      expect((await pedir("/v1/ia", "PUT", m, tokenDueno)).status).toBe(400);
      expect(pedidos).toEqual([]);
    });
  }

  test("OK: 1 y 1440 minutos son válidos", async () => {
    const { pedir, tokenDueno } = montar();
    expect((await pedir("/v1/ia", "PUT", { siempre: false, minutos: 1 }, tokenDueno)).cuerpo).toMatchObject({ minutos: 1 });
    expect((await pedir("/v1/ia", "PUT", { minutos: 1440 }, tokenDueno)).cuerpo).toMatchObject({ minutos: 1440 });
  });

  test("OK: un valor raro guardado en la base no rompe el modo", async () => {
    const { pedir, tokenDueno, db } = montar();
    db.insert(configuracion).values({ clave: "ia_encendido", valor: { siempre: "si", minutos: 1e9, apagadaAMano: "no" } as never }).run();
    expect((await pedir("/v1/ia", "GET", undefined, tokenDueno)).cuerpo).toMatchObject({ siempre: true, minutos: 1440, apagadaAMano: false });
  });

  test("OK: cuerpo enorme da 413 o 400, no 500", async () => {
    const { pedir, tokenDueno } = montar();
    const r = await pedir("/v1/ia", "PUT", JSON.stringify({ siempre: true, relleno: "x".repeat(40_000) }), tokenDueno);
    expect([400, 413]).toContain(r.status);
  });
});
