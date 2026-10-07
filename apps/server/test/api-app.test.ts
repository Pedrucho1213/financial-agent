import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp, type OpcionesApp } from "../src/app";
import { crearDispositivo, crearInvitacion } from "../src/auth";
import { abrirBaseDatos } from "../src/db/client";
import { recurrentes } from "../src/db/schema";

type Json = Record<string, any>;

function montar(extra: Partial<OpcionesApp> = {}) {
  const db = abrirBaseDatos(":memory:");
  const modelo = new MockLanguageModelV4({ doGenerate: [] as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", ...extra });
  const pedir = async (ruta: string, opciones: { metodo?: string; cuerpo?: unknown; token?: string } = {}) => {
    const r = await app.request(ruta, {
      method: opciones.metodo ?? (opciones.cuerpo ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });
    const tipo = r.headers.get("content-type") ?? "";
    return { estado: r.status, cuerpo: (tipo.includes("json") ? await r.json() : await r.text()) as Json, r };
  };
  return { db, app, pedir };
}

/** Crea la cuenta de Pedro con un código, como lo haría la app. */
async function entrar(pedir: ReturnType<typeof montar>["pedir"], db: ReturnType<typeof montar>["db"]) {
  const { codigo } = crearInvitacion(db);
  const r = await pedir("/v1/registro", { cuerpo: { codigo, nombre: "Pedro", dispositivo: "iPhone" } });
  expect(r.estado).toBe(201);
  return r.cuerpo as { token: string; usuario: { id: string } };
}

describe("registro con código de invitación", () => {
  test("un código nuevo crea la cuenta con sus categorías y sirve una sola vez", async () => {
    const { db, pedir } = montar();
    const { codigo } = crearInvitacion(db);
    expect(codigo).toMatch(/^[A-Z2-9]{6}$/);
    expect((await pedir(`/v1/invitaciones/${codigo.toLowerCase()}`)).cuerpo).toEqual({ para: "usuario" });

    const sinNombre = await pedir("/v1/registro", { cuerpo: { codigo, dispositivo: "iPhone" } });
    expect(sinNombre.estado).toBe(400);

    const r = await pedir("/v1/registro", { cuerpo: { codigo, nombre: "Pedro", dispositivo: "iPhone" } });
    expect(r.estado).toBe(201);
    expect(r.cuerpo.token).toStartWith("fa_");
    const cats = await pedir("/v1/categorias", { token: r.cuerpo.token });
    expect(cats.cuerpo.categorias.length).toBeGreaterThan(20);

    const otraVez = await pedir("/v1/registro", { cuerpo: { codigo, nombre: "Otro", dispositivo: "iPhone" } });
    expect(otraVez.estado).toBe(410);
    expect((await pedir(`/v1/invitaciones/${codigo}`)).estado).toBe(410);
  });

  test("un código para otro dispositivo entra a la misma cuenta", async () => {
    const { db, pedir } = montar();
    const { token } = await entrar(pedir, db);
    const inv = await pedir("/v1/invitaciones", { cuerpo: { para: "dispositivo" }, token });
    expect(inv.estado).toBe(201);
    expect((await pedir(`/v1/invitaciones/${inv.cuerpo.codigo}`)).cuerpo).toEqual({ para: "dispositivo", nombre: "Pedro" });
    const mac = await pedir("/v1/registro", { cuerpo: { codigo: inv.cuerpo.codigo, dispositivo: "Mac" } });
    expect(mac.estado).toBe(201);
    const yo = await pedir("/v1/yo", { token: mac.cuerpo.token });
    expect(yo.cuerpo.usuario.nombre).toBe("Pedro");
    expect(yo.cuerpo.dispositivos.map((d: Json) => d.nombre).sort()).toEqual(["Mac", "iPhone"]);
    expect(yo.cuerpo.dispositivos.find((d: Json) => d.actual).nombre).toBe("Mac");
  });

  test("un código vencido o inventado no entra, y adivinar muchas veces se frena", async () => {
    const { db, pedir } = montar();
    const vencido = crearInvitacion(db, { horas: -1 });
    expect((await pedir("/v1/registro", { cuerpo: { codigo: vencido.codigo, nombre: "X", dispositivo: "iPhone" } })).estado).toBe(410);
    for (let i = 0; i < 25; i++) await pedir("/v1/invitaciones/ZZZZZZ");
    const valido = crearInvitacion(db);
    expect((await pedir(`/v1/invitaciones/${valido.codigo}`)).estado).toBe(429);
  });

  test("revocar un dispositivo apaga su token", async () => {
    const { db, pedir } = montar();
    const { token, usuario } = await entrar(pedir, db);
    const otro = crearDispositivo(db, usuario.id, "Atajo");
    const yo = await pedir("/v1/yo", { token });
    const id = yo.cuerpo.dispositivos.find((d: Json) => d.nombre === "Atajo").id;
    expect((await pedir(`/v1/dispositivos/${id}`, { metodo: "DELETE", token })).estado).toBe(200);
    expect((await pedir("/v1/yo", { token: otro })).estado).toBe(401);
    expect((await pedir(`/v1/dispositivos/${id}`, { metodo: "DELETE", token })).estado).toBe(404);
  });

  test("las cuentas no se ven entre sí", async () => {
    const { db, pedir } = montar();
    const pedro = await entrar(pedir, db);
    const { codigo } = crearInvitacion(db);
    const ana = (await pedir("/v1/registro", { cuerpo: { codigo, nombre: "Ana", dispositivo: "iPhone" } })).cuerpo;
    const creado = await pedir("/v1/movimientos", { cuerpo: { tipo: "gasto", monto: 50 }, token: pedro.token });
    expect((await pedir("/v1/movimientos", { token: ana.token })).cuerpo.total).toBe(0);
    const ajeno = await pedir(`/v1/movimientos/${creado.cuerpo.id}`, { metodo: "DELETE", token: ana.token });
    expect(ajeno.estado).toBe(400);
    // Tampoco puede usar las categorías de otro.
    const catsPedro = (await pedir("/v1/categorias", { token: pedro.token })).cuerpo.categorias;
    const r = await pedir("/v1/movimientos", { cuerpo: { tipo: "gasto", monto: 5, categoria_id: catsPedro[0].id }, token: ana.token });
    expect(r.estado).toBe(400);
  });
});

describe("movimientos desde la app", () => {
  test("crear, editar, borrar y deshacer", async () => {
    const { db, pedir } = montar();
    const { token } = await entrar(pedir, db);
    const cats = (await pedir("/v1/categorias", { token })).cuerpo.categorias as Json[];
    const cafe = cats.find((c) => c.nombre === "Café")!;
    expect(cafe.nombreCompleto).toBe("Comida > Café");

    const creado = await pedir("/v1/movimientos", {
      cuerpo: { tipo: "gasto", monto: 85.5, categoria_id: cafe.id, comercio: "Starbucks", fecha: "2026-10-01" },
      token,
    });
    expect(creado.estado).toBe(201);
    expect(creado.cuerpo).toMatchObject({
      montoCentavos: 8550,
      monto: "$85.50",
      categoria: "Comida > Café",
      comercio: "Starbucks",
      fecha: "2026-10-01",
      origen: "app",
      revisar: false,
    });

    // Una categoría de ingreso en un gasto no se acepta.
    const sueldo = cats.find((c) => c.tipo === "ingreso")!;
    expect((await pedir(`/v1/movimientos/${creado.cuerpo.id}`, { metodo: "PATCH", cuerpo: { categoria_id: sueldo.id }, token })).estado).toBe(400);

    const editado = await pedir(`/v1/movimientos/${creado.cuerpo.id}`, {
      metodo: "PATCH",
      cuerpo: { monto: 95, comercio: "", descripcion: "latte" },
      token,
    });
    expect(editado.estado).toBe(200);
    expect(editado.cuerpo).toMatchObject({ montoCentavos: 9500, comercio: null, descripcion: "latte" });

    // La app borra con null: comercio, nota, cuenta y categoría.
    await pedir(`/v1/movimientos/${creado.cuerpo.id}`, { metodo: "PATCH", cuerpo: { comercio: "Oxxo", cuenta: "BBVA" }, token });
    const borrado = await pedir(`/v1/movimientos/${creado.cuerpo.id}`, {
      metodo: "PATCH",
      cuerpo: { comercio: null, descripcion: null, cuenta: null, categoria_id: null },
      token,
    });
    expect(borrado.estado).toBe(200);
    expect(borrado.cuerpo).toMatchObject({ comercio: null, descripcion: null, cuenta: null, categoriaId: null, montoCentavos: 9500 });

    expect((await pedir(`/v1/movimientos/${creado.cuerpo.id}`, { metodo: "DELETE", token })).estado).toBe(200);
    expect((await pedir("/v1/movimientos", { token })).cuerpo.total).toBe(0);
    expect((await pedir("/v1/deshacer", { cuerpo: {}, token })).cuerpo.deshecho).toBe(true);
    const lista = (await pedir("/v1/movimientos", { token })).cuerpo;
    expect(lista.total).toBe(1);
    expect(lista.movimientos[0].montoCentavos).toBe(9500);
  });

  test("datos inválidos responden 400 con el motivo", async () => {
    const { db, pedir } = montar();
    const { token } = await entrar(pedir, db);
    expect((await pedir("/v1/movimientos", { cuerpo: { tipo: "gasto", monto: -5 }, token })).estado).toBe(400);
    expect((await pedir("/v1/movimientos", { cuerpo: { tipo: "gasto", monto: 5, fecha: "ayer" }, token })).estado).toBe(400);
    expect((await pedir("/v1/movimientos?desde=10-01-2026", { token })).estado).toBe(400);
    expect((await pedir("/v1/movimientos/no-existe", { metodo: "PATCH", cuerpo: { monto: 5 }, token })).estado).toBe(400);
  });

  test("filtros: fechas, tipo, categoría con sus hijas, texto, por revisar y páginas", async () => {
    const { db, pedir } = montar();
    const { token } = await entrar(pedir, db);
    const cats = (await pedir("/v1/categorias", { token })).cuerpo.categorias as Json[];
    const id = (nombre: string) => cats.find((c) => c.nombre === nombre)!.id;
    const crear = (cuerpo: Json) => pedir("/v1/movimientos", { cuerpo, token });
    await crear({ tipo: "gasto", monto: 60, categoria_id: id("Café"), comercio: "Starbucks", fecha: "2026-09-30" });
    await crear({ tipo: "gasto", monto: 900, categoria_id: id("Súper"), comercio: "Walmart", fecha: "2026-10-02" });
    await crear({ tipo: "gasto", monto: 120, categoria_id: id("Taxi y apps"), comercio: "Uber", fecha: "2026-10-03" });
    await crear({ tipo: "ingreso", monto: 12000, categoria_id: id("Sueldo"), fecha: "2026-10-01" });

    const octubre = (await pedir("/v1/movimientos?desde=2026-10-01&hasta=2026-10-31", { token })).cuerpo;
    expect(octubre.total).toBe(3);
    expect(octubre.movimientos.map((m: Json) => m.fecha)).toEqual(["2026-10-03", "2026-10-02", "2026-10-01"]);
    expect((await pedir("/v1/movimientos?tipo=ingreso", { token })).cuerpo.total).toBe(1);
    expect((await pedir(`/v1/movimientos?categoria_id=${id("Comida")}`, { token })).cuerpo.total).toBe(2);
    expect((await pedir("/v1/movimientos?texto=uber", { token })).cuerpo.movimientos[0].comercio).toBe("Uber");
    const pagina = (await pedir("/v1/movimientos?limite=2&offset=2", { token })).cuerpo;
    expect(pagina.total).toBe(4);
    expect(pagina.movimientos).toHaveLength(2);
    expect((await pedir("/v1/movimientos?revisar=1", { token })).cuerpo.total).toBe(0);
  });
});

describe("tablero", () => {
  test("suma el mes, compara con el anterior y agrupa por categoría principal", async () => {
    const { db, pedir } = montar();
    const { token, usuario } = await entrar(pedir, db);
    const cats = (await pedir("/v1/categorias", { token })).cuerpo.categorias as Json[];
    const id = (nombre: string) => cats.find((c) => c.nombre === nombre)!.id;
    const crear = (cuerpo: Json) => pedir("/v1/movimientos", { cuerpo, token });
    await crear({ tipo: "gasto", monto: 60, categoria_id: id("Café"), comercio: "Starbucks", fecha: "2026-05-02" });
    await crear({ tipo: "gasto", monto: 50, categoria_id: id("Café"), comercio: "Starbucks", fecha: "2026-05-03" });
    await crear({ tipo: "gasto", monto: 900, categoria_id: id("Súper"), comercio: "Walmart", fecha: "2026-05-04" });
    await crear({ tipo: "gasto", monto: 20, moneda: "USD", fecha: "2026-05-04" });
    await crear({ tipo: "ingreso", monto: 12000, categoria_id: id("Sueldo"), fecha: "2026-05-15" });
    await crear({ tipo: "gasto", monto: 300, categoria_id: id("Gasolina"), fecha: "2026-04-03" });
    await crear({ tipo: "gasto", monto: 700, categoria_id: id("Gasolina"), fecha: "2026-04-20" });
    db.insert(recurrentes)
      .values({ usuarioId: usuario.id, nombre: "Netflix", tipo: "suscripcion", montoCentavos: 19900, frecuencia: "mensual", dia: 15 })
      .run();

    const t = (await pedir("/v1/tablero?mes=2026-05", { token })).cuerpo;
    expect(t.totales).toMatchObject({
      gastadoCentavos: 101000, // los 20 USD no se suman a los pesos
      ingresadoCentavos: 1200000,
      balanceCentavos: 1099000,
      cantidadGastos: 3,
      gastadoMesAnteriorCentavos: 100000,
      // Mayo no es el mes actual: se compara contra abril completo.
      gastadoMesAnteriorMismaFechaCentavos: 100000,
    });
    expect(t.porCategoria.map((c: Json) => [c.nombre, c.centavos, c.cantidad])).toEqual([["Comida", 101000, 3]]);
    expect(t.porMes).toHaveLength(6);
    expect(t.porMes.at(-1)).toEqual({ mes: "2026-05", gastadoCentavos: 101000, ingresadoCentavos: 1200000 });
    expect(t.porMes.at(-2).gastadoCentavos).toBe(100000);
    expect(t.porMes[0].mes).toBe("2025-12");
    expect(t.mayores[0].comercio).toBe("Walmart");
    expect(t.frecuentes).toEqual([{ nombre: "Starbucks", cantidad: 2, centavos: 11000 }]);
    expect(t.porDiaSemana).toHaveLength(7);
    expect(t.recurrentesProximos[0]).toMatchObject({ nombre: "Netflix", montoCentavos: 19900 });
    expect((await pedir("/v1/tablero?mes=2026-13", { token })).estado).toBe(400);
  });
});

describe("el Atajo", () => {
  test("se prepara con un token propio y se descarga firmado unos minutos", async () => {
    let xmlRecibido = "";
    const { db, pedir, app } = montar({
      firmarAtajo: async (xml) => {
        xmlRecibido = xml;
        return new TextEncoder().encode("firmado");
      },
    });
    const { token } = await entrar(pedir, db);
    expect((await pedir("/v1/atajo", { cuerpo: { servidor: "ftp://x" }, token })).estado).toBe(400);
    const r = await pedir("/v1/atajo", { cuerpo: { servidor: "https://mac.tu-red.ts.net/" }, token });
    expect(r.estado).toBe(201);
    expect(r.cuerpo.url).toMatch(/^\/atajo\/[0-9a-f-]+\.shortcut$/);
    expect(xmlRecibido).toContain("https://mac.tu-red.ts.net");
    expect(xmlRecibido).not.toContain("ts.net/</string>");
    // El token del Atajo es nuevo y funciona por su cuenta.
    const tokenAtajo = xmlRecibido.match(/fa_[A-Za-z0-9_-]+/)![0];
    expect(tokenAtajo).not.toBe(token);
    expect((await pedir("/v1/yo", { token: tokenAtajo })).estado).toBe(200);

    const descarga = await app.request(r.cuerpo.url);
    expect(descarga.status).toBe(200);
    expect(descarga.headers.get("content-disposition")).toContain("Finanzas.shortcut");
    expect(await descarga.text()).toBe("firmado");
    expect((await app.request("/atajo/no-existe.shortcut")).status).toBe(410);

    // Pedirlo otra vez reemplaza al anterior que nunca se usó; el que ya se usó se queda.
    await pedir("/v1/atajo", { cuerpo: { servidor: "https://mac.tu-red.ts.net" }, token });
    await pedir("/v1/atajo", { cuerpo: { servidor: "https://mac.tu-red.ts.net" }, token });
    const nombres = ((await pedir("/v1/yo", { token })).cuerpo.dispositivos as Json[]).map((d) => d.nombre).sort();
    expect(nombres).toEqual(["Atajo Finanzas", "Atajo Finanzas", "iPhone"]);
    expect((await pedir("/v1/yo", { token: tokenAtajo })).estado).toBe(200);
  });

  test("si la Mac no puede firmar, avisa y no deja un token suelto", async () => {
    const { ErrorFirma } = await import("../src/atajo/generar");
    const { db, pedir } = montar({
      firmarAtajo: async () => {
        throw new ErrorFirma("shortcuts no existe");
      },
    });
    const { token } = await entrar(pedir, db);
    const r = await pedir("/v1/atajo", { cuerpo: { servidor: "https://mac.tu-red.ts.net" }, token });
    expect(r.estado).toBe(501);
    const yo = await pedir("/v1/yo", { token });
    expect(yo.cuerpo.dispositivos).toHaveLength(1);
  });
});

describe("el enlace para instalar el Atajo", () => {
  test("un código de dispositivo se vuelve el Atajo de esa cuenta, una sola vez", async () => {
    let xmlRecibido = "";
    const { db, pedir, app } = montar({
      firmarAtajo: async (xml) => {
        xmlRecibido = xml;
        return new TextEncoder().encode("firmado");
      },
    });
    const { token, usuario } = await entrar(pedir, db);
    const { codigo } = crearInvitacion(db, { usuarioId: usuario.id });
    const servidor = "https://mac.tu-red.ts.net";

    const r = await pedir("/v1/atajo/canjear", { cuerpo: { codigo: codigo.toLowerCase(), servidor } });
    expect(r.estado).toBe(201);
    expect(r.cuerpo.nombre).toBe("Pedro");
    expect(r.cuerpo.url).toMatch(/^\/atajo\/[0-9a-f-]+\.shortcut$/);
    expect(xmlRecibido).toContain("¡Hola, Pedro!");
    expect((await app.request(r.cuerpo.url)).status).toBe(200);
    const dispositivos = (await pedir("/v1/yo", { token })).cuerpo.dispositivos as Json[];
    expect(dispositivos.map((d) => d.nombre).sort()).toEqual(["Atajo Finanzas", "iPhone"]);

    expect((await pedir("/v1/atajo/canjear", { cuerpo: { codigo, servidor } })).estado).toBe(410);
    expect((await pedir("/v1/atajo/canjear", { cuerpo: { codigo: "ZZZZZZ", servidor } })).estado).toBe(404);
    expect((await pedir("/v1/atajo/canjear", { cuerpo: { codigo } })).estado).toBe(400);
  });

  test("un código de cuenta nueva no instala el Atajo ni se gasta", async () => {
    const { db, pedir } = montar({ firmarAtajo: async () => new TextEncoder().encode("firmado") });
    const { codigo } = crearInvitacion(db);
    const r = await pedir("/v1/atajo/canjear", { cuerpo: { codigo, servidor: "https://mac.tu-red.ts.net" } });
    expect(r.estado).toBe(400);
    expect(r.cuerpo.error).toContain("crear una cuenta");
    expect((await pedir(`/v1/invitaciones/${codigo}`)).cuerpo).toEqual({ para: "usuario" });
  });

  test("si la Mac no puede firmar, el código sigue sirviendo y no queda un token suelto", async () => {
    const { ErrorFirma } = await import("../src/atajo/generar");
    let falla = true;
    const { db, pedir } = montar({
      firmarAtajo: async () => {
        if (falla) throw new ErrorFirma("shortcuts no existe");
        return new TextEncoder().encode("firmado");
      },
    });
    const { token, usuario } = await entrar(pedir, db);
    const { codigo } = crearInvitacion(db, { usuarioId: usuario.id });
    const servidor = "https://mac.tu-red.ts.net";
    expect((await pedir("/v1/atajo/canjear", { cuerpo: { codigo, servidor } })).estado).toBe(501);
    expect((await pedir("/v1/yo", { token })).cuerpo.dispositivos).toHaveLength(1);
    falla = false;
    expect((await pedir("/v1/atajo/canjear", { cuerpo: { codigo, servidor } })).estado).toBe(201);
    expect((await pedir("/v1/yo", { token })).cuerpo.dispositivos).toHaveLength(2);
  });
});

describe("la app web", () => {
  test("sirve los archivos, cae en index.html para las rutas de la app y no sale de su carpeta", async () => {
    const carpeta = mkdtempSync(join(tmpdir(), "web-"));
    mkdirSync(join(carpeta, "assets"));
    writeFileSync(join(carpeta, "index.html"), "<!doctype html><title>Finanzas</title>");
    writeFileSync(join(carpeta, "assets", "app-123.js"), "console.log(1)");
    writeFileSync(join(carpeta, "..", "secreto.txt"), "no");
    const { app } = montar({ carpetaWeb: carpeta });

    const inicio = await app.request("/");
    expect(await inicio.text()).toContain("<title>Finanzas</title>");
    expect(inicio.headers.get("cache-control")).toBe("no-cache");
    const js = await app.request("/assets/app-123.js");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await (await app.request("/movimientos?x=1")).text()).toContain("Finanzas");
    expect((await app.request("/../secreto.txt")).status).toBe(404);
    expect((await app.request("/%2e%2e/secreto.txt")).status).toBe(404);
    expect((await app.request("/no-existe.png")).status).toBe(404);
    expect((await app.request("/%E0")).status).toBe(400);
    expect((await app.request("/v1/no-existe")).status).toBe(401);
    expect((await app.request("/salud")).status).toBe(200);
  });

  test("sin compilar, avisa cómo compilarla", async () => {
    const { app } = montar({ carpetaWeb: join(tmpdir(), "no-existe-web") });
    const r = await app.request("/");
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("web:build");
  });
});
