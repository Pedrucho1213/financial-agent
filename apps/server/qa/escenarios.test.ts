// Escenarios de QA: cada prueba dice lo que DEBERÍA pasar. Si falla, es un hallazgo (ver hallazgos.md).
// Correr desde apps/server: bun test qa/
import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { dispositivos, movimientos } from "../src/db/schema";
import { listarCategorias, sembrarCategorias } from "../src/finanzas/catalogos";
import { crearContexto } from "../src/finanzas/contexto";
import { crearMovimiento, editarMovimiento } from "../src/finanzas/movimientos";
import { crearHerramientas, type Accion } from "../src/ai/herramientas";
import { llamada, preparar, texto } from "../test/ayuda";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Resp = Record<string, any>;

function montar(doGenerate: any, espera?: { registroMs: number; preguntaMs: number }) {
  const { db, usuario } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", reintentosMs: [10], espera });
  const pedir = async (ruta: string, init: RequestInit = {}, tk = token) => {
    const r = await app.request(ruta, { ...init, headers: { authorization: `Bearer ${tk}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    return { status: r.status, cuerpo: (await r.json().catch(() => null)) as Resp };
  };
  const hablar = (cuerpo: Record<string, unknown>, tk = token) => pedir("/v1/hablar", { method: "POST", body: JSON.stringify(cuerpo) }, tk);
  return { db, usuario, token, app, modelo, pedir, hablar };
}

describe("QA: preguntas sin signos", () => {
  // Si el dictado llega sin "¿?" y no empieza con las palabras conocidas, se trata como registro:
  // espera 5 s y contesta "Anotado", y el Atajo nunca escucha la respuesta.
  for (const frase of ["Oye, cuánto llevo gastado este mes", "Quiero saber cuánto gasté en Uber", "y en Uber", "Me puedes decir cuánto gasté", "Voy bien este mes"]) {
    test(`"${frase}" lenta se trata como pregunta (esperar: true)`, async () => {
      const { hablar } = montar(async () => { await dormir(80); return texto("Llevas $1,200."); }, { registroMs: 20, preguntaMs: 1000 });
      const r = await hablar({ texto: frase, client_id: `preg-${frase.length}-0001` });
      expect(r.cuerpo.respuesta).toBe("Llevas $1,200.");
    });
  }
});

describe("QA: ediciones", () => {
  test("cambiar un gasto a ingreso no deja una categoría de gasto", () => {
    const { ctx } = preparar();
    const m = crearMovimiento(ctx, { tipo: "gasto", monto: 500, categoria: "Café" });
    const e = editarMovimiento(ctx, m.id, { tipo: "ingreso" });
    const cats = listarCategorias(ctx.db, ctx.usuarioId);
    const fila = ctx.db.select().from(movimientos).all().find((x) => x.id === m.id)!;
    const cat = cats.find((c) => c.id === fila.categoriaId);
    expect(cat?.tipo ?? "ingreso").toBe("ingreso");
    expect(e.categoria).not.toBe("Comida > Café");
  });
});

describe("QA: comercios con varias categorías", () => {
  test("la primera compra en Oxxo no fija la categoría de todas las demás", () => {
    const { ctx } = preparar();
    crearMovimiento({ ...ctx, textoOriginal: "café en el Oxxo 35" }, { tipo: "gasto", monto: 35, comercio: "Oxxo", categoria: "Café" });
    const recarga = crearMovimiento({ ...ctx, textoOriginal: "recarga de celular en el Oxxo 200" }, { tipo: "gasto", monto: 200, comercio: "Oxxo", categoria: "Internet y teléfono" });
    expect(recarga.categoria).toBe("Vivienda > Internet y teléfono");
  });
  test("Amazon: electrónica y luego ropa", () => {
    const { ctx } = preparar();
    crearMovimiento({ ...ctx, textoOriginal: "audífonos en Amazon 900" }, { tipo: "gasto", monto: 900, comercio: "Amazon", categoria: "Electrónica" });
    const ropa = crearMovimiento({ ...ctx, textoOriginal: "una playera en Amazon 300" }, { tipo: "gasto", monto: 300, comercio: "Amazon", categoria: "Ropa y calzado" });
    expect(ropa.categoria).toBe("Compras > Ropa y calzado");
  });
});

describe("QA: deshacer", () => {
  test("si 'deshaz eso' falla después de deshacer y se reintenta, no deshace dos cosas", async () => {
    let n = 0;
    const { hablar, pedir } = montar(async ({ prompt }: any) => {
      const ultimo = prompt.at(-1);
      const dictado = JSON.stringify(prompt.findLast((m: any) => m.role === "user"));
      if (ultimo.role === "user") {
        if (dictado.includes("deshaz")) return llamada("deshacer", {});
        const monto = Number(dictado.match(/(\d+)/)?.[1]);
        return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto }] });
      }
      if (dictado.includes("deshaz") && n++ === 0) throw new Error("Ollama se cayó");
      return texto("Listo.");
    });
    await hablar({ texto: "gasté 100", client_id: "dsh-00000001" });
    await hablar({ texto: "gasté 200", client_id: "dsh-00000002" });
    expect((await hablar({ texto: "deshaz eso y ya", client_id: "dsh-00000003" })).status).toBe(503);
    // La cola del iPhone lo reenvía.
    expect((await hablar({ texto: "deshaz eso y ya", client_id: "dsh-00000003" })).status).toBe(200);
    const lista = await pedir("/v1/movimientos?periodo=todo");
    expect(lista.cuerpo.movimientos.map((m: Resp) => m.monto)).toEqual(["$100"]);
  });
});

describe("QA: recurrentes", () => {
  test("una suscripción en dólares se guarda en dólares", async () => {
    const { ctx } = preparar();
    const acciones: Accion[] = [];
    const h = crearHerramientas({ ...ctx, textoOriginal: "Spotify me cobra 10 dólares cada mes el día 5" }, acciones);
    const r: any = await h.registrar_recurrente.execute!({ nombre: "Spotify", tipo: "suscripcion", monto: 10, frecuencia: "mensual", dia: 5 }, { toolCallId: "x", messages: [] });
    expect(r.registrado.monto).toBe("10 USD");
  });
  test("se puede cancelar una suscripción por voz (hay herramienta)", () => {
    const { ctx } = preparar();
    const nombres = Object.keys(crearHerramientas(ctx, []));
    expect(nombres.some((n) => /recurrente/.test(n) && /(eliminar|editar|cancelar|desactivar)/.test(n))).toBe(true);
  });
});

describe("QA: API para el Atajo", () => {
  test("un dictado vacío contesta algo que se pueda leer en voz alta", async () => {
    const { hablar } = montar(async () => texto("x"));
    const r = await hablar({ texto: "", client_id: "vacio-000001" });
    // Debe contestar algo legible y sin "error", para que el Atajo borre el archivo.
    expect(typeof r.cuerpo.respuesta).toBe("string");
    expect(r.cuerpo.error).toBeUndefined();
  });
  test("capturado_en con offset sin dos puntos (-0600) se acepta", async () => {
    const { hablar } = montar(async () => llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 5 }] }));
    const r = await hablar({ texto: "gasté 5", client_id: "iso-0000001", capturado_en: "2026-10-06T17:08:45-0600" });
    expect(r.status).not.toBe(400);
  });
  test("client_id con fecha ISO (dos puntos y +) se consulta en /v1/entradas", async () => {
    const { hablar, pedir } = montar(async ({ prompt }: any) => (prompt.at(-1).role === "user" ? llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 5 }] }) : texto("Listo.")));
    const id = "2026-10-06T17:08:45+02:00-123456";
    await hablar({ texto: "gasté 5", client_id: id });
    expect((await pedir(`/v1/entradas/${id}`)).status).toBe(200);
    expect((await pedir(`/v1/entradas/${encodeURIComponent(id)}`)).status).toBe(200);
  });
  test("limite no numérico en /v1/movimientos no devuelve lista vacía", async () => {
    const { pedir, db, usuario } = montar(async () => texto("x"));
    crearMovimiento(crearContexto({ db, usuarioId: usuario.id, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" }), { tipo: "gasto", monto: 5 });
    const r = await pedir("/v1/movimientos?limite=abc");
    expect(r.cuerpo.movimientos.length).toBe(r.cuerpo.encontrados ?? r.cuerpo.total);
  });
  test("token revocado da 401", async () => {
    const { pedir, db } = montar(async () => texto("x"));
    db.update(dispositivos).set({ revocadoEn: new Date().toISOString() }).run();
    expect((await pedir("/v1/movimientos")).status).toBe(401);
  });
  test("otro usuario no ve ni edita mis movimientos aunque tenga el id", async () => {
    const { db, usuario, hablar, pedir } = montar(async ({ prompt }: any) => texto("x"));
    const ctxA = crearContexto({ db, usuarioId: usuario.id, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const m = crearMovimiento(ctxA, { tipo: "gasto", monto: 77 });
    const b = crearUsuario(db, "Amigo");
    sembrarCategorias(db, b.id);
    const ctxB = crearContexto({ db, usuarioId: b.id, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const h = crearHerramientas(ctxB, []);
    const r: any = await h.eliminar_movimiento.execute!({ id: m.id }, { toolCallId: "x", messages: [] });
    expect(r.error).toBeTruthy();
    const tokB = crearDispositivo(db, b.id, "iPhone");
    expect((await pedir("/v1/movimientos?periodo=todo", {}, tokB)).cuerpo.movimientos.length).toBe(0);
  });
  test("dictado a las 23:30 de México queda con la fecha local", async () => {
    const { hablar, pedir } = montar(async ({ prompt }: any) => (prompt.at(-1).role === "user" ? llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 90 }] }) : texto("Listo.")));
    await hablar({ texto: "gasté 90 en tacos", client_id: "noche-000001", capturado_en: "2026-10-06T23:30:00-06:00" });
    const r = await pedir("/v1/movimientos?periodo=todo");
    expect(r.cuerpo.movimientos[0].fecha).toBe("2026-10-06");
  });
  test("dictado que esperó 2 días en la cola: 'ayer' es relativo a cuando se dictó", async () => {
    const { hablar, pedir } = montar(async ({ prompt }: any) => (prompt.at(-1).role === "user" ? llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 90, fecha: "ayer" }] }) : texto("Listo.")));
    const hace2 = new Date(Date.now() - 2 * 86400_000).toISOString();
    await hablar({ texto: "ayer gasté 90 en tacos", client_id: "cola-0000001", capturado_en: hace2 });
    const r = await pedir("/v1/movimientos?periodo=todo");
    const esperado = new Date(Date.now() - 3 * 86400_000).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    expect(r.cuerpo.movimientos[0].fecha).toBe(esperado);
  });
});

describe("QA: montos", () => {
  test("monto de 0.001 no se guarda como $0", () => {
    const { ctx } = preparar();
    expect(() => crearMovimiento(ctx, { tipo: "gasto", monto: 0.001 })).toThrow();
  });
});

describe("QA: la frase pisa al modelo", () => {
  const registrar = async (frase: string, mov: Record<string, unknown>) => {
    const { ctx } = preparar();
    const h = crearHerramientas({ ...ctx, textoOriginal: frase }, []);
    const r: any = await h.registrar_movimientos.execute!({ movimientos: [mov as any] }, { toolCallId: "x", messages: [] });
    return r.registrados[0];
  };
  test("'un millón doscientos mil' se guarda como 1,200,000", async () => {
    const m = await registrar("Vendí mi coche en un millón doscientos mil", { tipo: "ingreso", monto: 1200000, categoria: "Otros ingresos" });
    expect(m.monto).toBe("$1,200,000");
  });
  test("'tacos, súper ricos' no se va a Súper", async () => {
    const m = await registrar("Gasté 200 en tacos, súper ricos", { tipo: "gasto", monto: 200, categoria: "Restaurantes" });
    expect(m.categoria).toBe("Comida > Restaurantes");
  });
  test("'compré un agua' no es el recibo del agua", async () => {
    const m = await registrar("Compré un agua de 20 en el Oxxo", { tipo: "gasto", monto: 20, categoria: "Antojos" });
    expect(m.categoria).toBe("Comida > Antojos");
  });
  test("'2 libras de carne' no es en libras esterlinas", async () => {
    const m = await registrar("Compré 2 libras de carne en 180", { tipo: "gasto", monto: 180, categoria: "Súper" });
    expect(m.monto).toBe("$180");
  });
});

describe("QA: reintentos agotados", () => {
  test("si la IA sigue caída después de los reintentos, el dictado no se pierde en silencio", async () => {
    const { hablar, pedir } = montar(async () => { await dormir(30); throw new Error("Ollama caído"); }, { registroMs: 5, preguntaMs: 5 });
    const r = await hablar({ texto: "gasté 300 en súper", client_id: "caido-000001" });
    expect(r.status).toBe(202); // el Atajo borra su copia
    await dormir(300);
    const e = await pedir("/v1/entradas/caido-000001");
    // Hoy queda en "error" y nadie lo reintenta hasta que la Mac se reinicie.
    expect(e.cuerpo.estado).not.toBe("error");
  });
});
