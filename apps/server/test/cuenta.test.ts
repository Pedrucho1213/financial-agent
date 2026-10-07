import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { construirInstrucciones } from "../src/ai/instrucciones";
import { crearApp, type OpcionesApp } from "../src/app";
import { crearInvitacion } from "../src/auth";
import { abrirBaseDatos } from "../src/db/client";
import { usuarios } from "../src/db/schema";
import { crearContexto } from "../src/finanzas/contexto";

type Json = Record<string, any>;

function montar(extra: Partial<OpcionesApp> = {}, db = abrirBaseDatos(":memory:")) {
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: [] as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN", ...extra });
  const pedir = async (ruta: string, opciones: { metodo?: string; cuerpo?: unknown; token?: string; ip?: string } = {}) => {
    const r = await app.request(`https://mac.tu-red.ts.net${ruta}`, {
      method: opciones.metodo ?? (opciones.cuerpo ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": opciones.ip ?? "100.64.0.1",
        ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });
    const tipo = r.headers.get("content-type") ?? "";
    return { estado: r.status, cuerpo: (tipo.includes("json") ? await r.json() : await r.text()) as Json };
  };
  return { db, app, pedir };
}

async function cuenta(pedir: ReturnType<typeof montar>["pedir"], db: ReturnType<typeof montar>["db"], nombre = "Pedro") {
  const { codigo } = crearInvitacion(db);
  const r = await pedir("/v1/registro", { cuerpo: { codigo, nombre, dispositivo: "iPhone" } });
  expect(r.estado).toBe(201);
  return r.cuerpo.token as string;
}

const CODIGO = "Mi gato Tito 2026";

describe("usuario para entrar", () => {
  test("las cuentas nuevas y las de antes reciben uno sacado del nombre, sin repetirse", async () => {
    const db = abrirBaseDatos(":memory:");
    // Cuentas de antes de los códigos personales, sin usuario.
    db.insert(usuarios).values([{ nombre: "Pedro Pérez" }, { nombre: "pedroperez" }, { nombre: "Al" }]).run();
    const { pedir } = montar({}, db);
    expect(db.select().from(usuarios).all().map((u) => u.usuario).sort()).toEqual(["al0", "pedroperez", "pedroperez2"]);
    const token = await cuenta(pedir, db, "Ñoño Ramírez");
    expect((await pedir("/v1/yo", { token })).cuerpo.usuario).toMatchObject({ nombre: "Ñoño Ramírez", usuario: "nonoramirez", tieneCodigo: false });
  });

  test("se cambia el usuario y el nombre de saludo; el usuario no se repite", async () => {
    const { db, pedir } = montar();
    const pedro = await cuenta(pedir, db);
    const amigo = await cuenta(pedir, db, "Amigo");
    const r = await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { nombre: "  Pedrucho  ", usuario: "Pédro.Mx" }, token: pedro });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.usuario).toMatchObject({ nombre: "Pedrucho", usuario: "pedro.mx", tieneCodigo: false });
    expect((await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { usuario: "PEDRO.MX" }, token: amigo })).estado).toBe(409);
    for (const usuario of ["ab", ".pedro", "x".repeat(25)]) {
      expect((await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { usuario }, token: amigo })).estado).toBe(400);
    }
    expect((await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { nombre: " " }, token: amigo })).estado).toBe(400);
    expect((await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { nombre: "n".repeat(41) }, token: amigo })).estado).toBe(400);
    // Sin token no se cambia nada.
    expect((await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { nombre: "X" } })).estado).toBe(401);
  });

  test("la IA conoce el nombre de saludo y toma el nuevo en cuanto cambia", async () => {
    const { db, pedir } = montar();
    const token = await cuenta(pedir, db);
    const usuarioId = (await pedir("/v1/yo", { token })).cuerpo.usuario.id;
    const ctx = () => crearContexto({ db, usuarioId, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    expect(construirInstrucciones(ctx())).toContain("El usuario se llama Pedro");
    await pedir("/v1/yo", { metodo: "PATCH", cuerpo: { nombre: "Pedrucho" }, token });
    expect(construirInstrucciones(ctx())).toContain("El usuario se llama Pedrucho");
  });
});

describe("código personal", () => {
  test("rechaza los cortos y los obvios, y nunca se guarda en claro", async () => {
    const { db, pedir } = montar();
    const token = await cuenta(pedir, db);
    for (const codigo of ["corto", "12345678", "87654321", "aaaaaaaa", "12121212", "abcabcab", "abcdefgh", "Contraseña1", "x".repeat(65)]) {
      const r = await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo }, token });
      expect([codigo, r.estado]).toEqual([codigo, 400]);
    }
    expect((await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: CODIGO }, token })).cuerpo).toEqual({ ok: true });
    const fila = db.select().from(usuarios).get()!;
    expect(fila.codigoHash).toStartWith("$argon2id$");
    expect(fila.codigoHash).not.toContain("tito");
    const yo = (await pedir("/v1/yo", { token })).cuerpo.usuario;
    expect(yo.tieneCodigo).toBe(true);
    expect(JSON.stringify(yo)).not.toContain("argon2");
  });

  test("entra con usuario y código desde otro dispositivo, sin distinguir mayúsculas ni espacios de más", async () => {
    const { db, pedir } = montar();
    const token = await cuenta(pedir, db);
    await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: CODIGO }, token });
    const r = await pedir("/v1/entrar", { cuerpo: { usuario: " Pedro ", codigo: "  mi gato  tito 2026 ", dispositivo: "iPad" } });
    expect(r.estado).toBe(201);
    expect(r.cuerpo.token).toStartWith("fa_");
    expect(r.cuerpo.usuario.nombre).toBe("Pedro");
    const dispositivos = (await pedir("/v1/yo", { token: r.cuerpo.token })).cuerpo.dispositivos as Json[];
    expect(dispositivos.map((d) => d.nombre).sort()).toEqual(["iPad", "iPhone"]);
    // Equivocado o con un usuario que no existe: la misma respuesta.
    const mal = await pedir("/v1/entrar", { cuerpo: { usuario: "pedro", codigo: "mi gato tito 2025", dispositivo: "iPad" } });
    const nadie = await pedir("/v1/entrar", { cuerpo: { usuario: "nadie", codigo: CODIGO, dispositivo: "iPad" } });
    expect(mal).toEqual({ estado: 401, cuerpo: { error: "Usuario o código incorrectos." } });
    expect(nadie).toEqual(mal);
    expect((await pedir("/v1/entrar", { cuerpo: { usuario: "pedro" } })).estado).toBe(400);
  });

  test("sin código, o después de quitarlo, no se puede entrar así", async () => {
    const { db, pedir } = montar();
    const token = await cuenta(pedir, db);
    const entrar = () => pedir("/v1/entrar", { cuerpo: { usuario: "pedro", codigo: CODIGO, dispositivo: "iPad" } });
    expect((await entrar()).estado).toBe(401);
    await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: CODIGO }, token });
    expect((await entrar()).estado).toBe(201);
    expect((await pedir("/v1/yo/codigo", { metodo: "DELETE", token })).cuerpo).toEqual({ ok: true });
    expect((await entrar()).estado).toBe(401);
    expect((await pedir("/v1/yo", { token })).cuerpo.usuario.tieneCodigo).toBe(false);
  });

  test("10 fallos con un usuario lo frenan aunque vengan de IPs distintas; los demás usuarios siguen", async () => {
    const { db, pedir } = montar();
    const pedro = await cuenta(pedir, db);
    const amigo = await cuenta(pedir, db, "Amigo");
    await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: CODIGO }, token: pedro });
    await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: "otro codigo secreto" }, token: amigo });
    for (let i = 0; i < 10; i++) {
      const r = await pedir("/v1/entrar", { cuerpo: { usuario: "PEDRO", codigo: `intento ${i} malo`, dispositivo: "x" }, ip: `100.64.1.${i}` });
      expect(r.estado).toBe(401);
    }
    // Ni con el código correcto, ni desde otra IP, mientras dure el freno.
    const frenado = await pedir("/v1/entrar", { cuerpo: { usuario: "pedro", codigo: CODIGO, dispositivo: "x" }, ip: "100.64.2.1" });
    expect(frenado.estado).toBe(429);
    const otro = await pedir("/v1/entrar", { cuerpo: { usuario: "amigo", codigo: "otro codigo secreto", dispositivo: "x" }, ip: "100.64.2.1" });
    expect(otro.estado).toBe(201);
  });

  test("el límite por IP también cuenta los códigos personales equivocados", async () => {
    const { pedir } = montar();
    for (let i = 0; i < 20; i++) {
      await pedir("/v1/entrar", { cuerpo: { usuario: `alguien${i}`, codigo: "no es este codigo", dispositivo: "x" }, ip: "100.64.9.9" });
    }
    expect((await pedir("/v1/entrar", { cuerpo: { usuario: "otro", codigo: "no es este codigo", dispositivo: "x" }, ip: "100.64.9.9" })).estado).toBe(429);
  });

  test("cambiarlo muchas veces en una hora tiene tope", async () => {
    const { db, pedir } = montar();
    const token = await cuenta(pedir, db);
    for (let i = 0; i < 10; i++) {
      expect((await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: `codigo numero ${i}` }, token })).estado).toBe(200);
    }
    expect((await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: "codigo numero 11" }, token })).estado).toBe(429);
  });

  test("instala el Atajo con usuario y código; si la Mac no puede firmar, no deja un token suelto", async () => {
    let falla = false;
    const { db, app, pedir } = montar({
      firmarAtajo: async () => {
        if (falla) throw new (await import("../src/atajo/generar")).ErrorFirma("shortcuts no existe");
        return new TextEncoder().encode("firmado");
      },
    });
    const token = await cuenta(pedir, db);
    await pedir("/v1/yo/codigo", { metodo: "PUT", cuerpo: { codigo: CODIGO }, token });
    const servidor = "https://mac.tu-red.ts.net";
    expect((await pedir("/v1/atajo/entrar", { cuerpo: { usuario: "pedro", codigo: "equivocado!!", servidor } })).estado).toBe(401);
    expect((await pedir("/v1/atajo/entrar", { cuerpo: { usuario: "pedro", codigo: CODIGO, servidor: "https://otra.com" } })).estado).toBe(400);
    const r = await pedir("/v1/atajo/entrar", { cuerpo: { usuario: "pedro", codigo: CODIGO, servidor } });
    expect(r.estado).toBe(201);
    expect(r.cuerpo.nombre).toBe("Pedro");
    expect(await (await app.request(r.cuerpo.url)).text()).toBe("firmado");
    falla = true;
    expect((await pedir("/v1/atajo/entrar", { cuerpo: { usuario: "pedro", codigo: CODIGO, servidor } })).estado).toBe(501);
    const nombres = ((await pedir("/v1/yo", { token })).cuerpo.dispositivos as Json[]).map((d) => d.nombre).sort();
    expect(nombres).toEqual(["Atajo Finanzas", "iPhone"]);
  });
});
