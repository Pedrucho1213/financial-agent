import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { hablar as hablarDirecto, reanudarPendientes, type Respuesta } from "../src/ai/asistente";
import { crearApp, type OpcionesApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { entradas } from "../src/db/schema";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { llamada, preparar, texto } from "./ayuda";

// Pruebas de la cola: dictados repetidos, simultáneos, lentos, fallidos y reinicios de la Mac.

type Mensaje = { role: string; content: string | { type: string; text?: string }[] };
const dormir = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

/** Modelo falso que registra el número dictado como gasto y deja medir orden, simultaneidad y fallos. */
function modeloFalso(
  opciones: { retrasoMs?: (dictado: string) => number; falla?: (dictado: string, intento: number) => boolean } = {},
) {
  const vistos: string[] = [];
  const intentos = new Map<string, number>();
  let activos = 0;
  let maxActivos = 0;
  const modelo = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      activos++;
      maxActivos = Math.max(maxActivos, activos);
      try {
        const mensajes = prompt as Mensaje[];
        const usuario = mensajes.findLast((m) => m.role === "user");
        const contenido = usuario?.content ?? "";
        const dictado = typeof contenido === "string" ? contenido : contenido.map((p) => p.text ?? "").join("");
        const primerPaso = mensajes.at(-1)?.role === "user";
        if (primerPaso) {
          vistos.push(dictado);
          intentos.set(dictado, (intentos.get(dictado) ?? 0) + 1);
        }
        await dormir(opciones.retrasoMs?.(dictado) ?? 0);
        if (opciones.falla?.(dictado, intentos.get(dictado) ?? 0)) throw new Error("Ollama se cayó");
        if (!primerPaso) return texto("Listo.");
        if (dictado.includes("?")) return texto("Llevas $100.");
        const monto = Number(dictado.match(/\d+/)?.[0] ?? 1);
        return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto, descripcion: dictado }] });
      } finally {
        activos--;
      }
    },
  });
  return { modelo, vistos, intentos, maxActivos: () => maxActivos };
}

function montar(modelo: MockLanguageModelV4, espera?: OpcionesApp["espera"], reintentosMs = [20, 20]) {
  const { db, usuario } = preparar();
  const deps = { db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN", reintentosMs };
  const app = crearApp({ ...deps, espera });
  const cliente = (token: string) => {
    const get = async <T = Record<string, unknown>>(ruta: string) => {
      const r = await app.request(ruta, { headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, cuerpo: (await r.json()) as T };
    };
    return {
      hablar: async (cuerpo: Record<string, unknown>) => {
        const r = await app.request("/v1/hablar", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(cuerpo),
        });
        return { status: r.status, cuerpo: (await r.json()) as Respuesta };
      },
      get,
      montos: async () =>
        // "$5,000" -> 5000
        (await get<{ movimientos: { monto: string }[] }>("/v1/movimientos?periodo=todo")).cuerpo.movimientos.map(
          (m) => Number(m.monto.replace(/[^\d.]/g, "")),
        ),
      /** Consulta el dictado hasta que deje de estar "procesando" (o se acabe el tiempo). */
      esperarFin: async (clientId: string, ms = 2000) => {
        const limite = Date.now() + ms;
        for (;;) {
          const { cuerpo } = await get<{ estado: string; respuesta?: string }>(`/v1/entradas/${clientId}`);
          if (cuerpo.estado !== "procesando" || Date.now() > limite) return cuerpo;
          await dormir(10);
        }
      },
    };
  };
  const otroUsuario = () => {
    const otro = crearUsuario(db, "Amigo");
    sembrarCategorias(db, otro.id);
    return cliente(crearDispositivo(db, otro.id, "iPhone"));
  };
  return { db, usuario, deps, ...cliente(crearDispositivo(db, usuario.id, "iPhone")), otroUsuario };
}

describe("cola de dictados", () => {
  test("el mismo dictado enviado tres veces a la vez se procesa una sola vez", async () => {
    const { modelo, intentos } = modeloFalso({ retrasoMs: () => 30 });
    const { hablar, montos } = montar(modelo);
    const cuerpo = { texto: "café 60", client_id: "dictado-1001" };
    const respuestas = await Promise.all([hablar(cuerpo), hablar(cuerpo), hablar(cuerpo)]);
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(respuestas.map((r) => r.cuerpo.respuesta))).toEqual(new Set(["Listo, café 60 de 60 pesos en Café."]));
    expect(intentos.get("café 60")).toBe(1);
    expect(await montos()).toEqual([60]);
  });

  test("los dictados se procesan de uno en uno y en orden de llegada", async () => {
    const { modelo, vistos, maxActivos } = modeloFalso({ retrasoMs: (d) => (d.startsWith("primero") ? 60 : 5) });
    const { deps, usuario, montos } = montar(modelo);
    const textos = ["primero 10", "segundo 20", "tercero 30", "cuarto 40"];
    // Sin await entre ellos: llegan "al mismo tiempo", como cuando la cola del iPhone se vacía.
    await Promise.all(textos.map((t, i) => hablarDirecto(deps, usuario.id, { texto: t, clientId: `dictado-20${i}0` })));
    expect(vistos).toEqual(textos);
    expect(maxActivos()).toBe(1);
    expect((await montos()).sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
  });

  test("si tarda más de lo que espera el iPhone responde 202 y la Mac lo termina sola", async () => {
    const { modelo, intentos } = modeloFalso({ retrasoMs: () => 60 });
    const { hablar, get, montos, esperarFin } = montar(modelo, { registroMs: 10, preguntaMs: 1000 });
    const cuerpo = { texto: "gasolina 800", client_id: "dictado-3001" };
    const primera = await hablar(cuerpo);
    expect(primera.status).toBe(202);
    expect(primera.cuerpo).toMatchObject({ pendiente: true, acciones: [] });
    expect(primera.cuerpo.esperar).toBeUndefined();
    expect((await get("/v1/entradas/dictado-3001")).cuerpo.estado).toBe("procesando");
    // El Atajo lo reenvía mientras sigue en proceso: otra vez 202, sin procesarlo de nuevo.
    expect((await hablar(cuerpo)).status).toBe(202);
    const final = await get(`/v1/entradas/dictado-3001?esperar_ms=2000`);
    expect(final.cuerpo).toMatchObject({ estado: "listo", respuesta: "Listo, gasolina 800 de 800 pesos en Gasolina." });
    expect(intentos.get("gasolina 800")).toBe(1);
    expect(await montos()).toEqual([800]);
    expect((await hablar(cuerpo)).cuerpo.duplicado).toBe(true);
    expect(await esperarFin("dictado-3001")).toMatchObject({ estado: "listo" });
  });

  test("a una pregunta le da más tiempo que a un registro", async () => {
    const { modelo } = modeloFalso({ retrasoMs: () => 40 });
    const { hablar } = montar(modelo, { registroMs: 5, preguntaMs: 2000 });
    const pregunta = await hablar({ texto: "¿cuánto llevo en café?", client_id: "dictado-4001" });
    expect(pregunta.status).toBe(200);
    expect(pregunta.cuerpo.respuesta).toBe("Llevas 100 pesos.");
    expect((await hablar({ texto: "café 60", client_id: "dictado-4002" })).status).toBe(202);
    // Quien prefiera esperar todo (la prueba de modelos) manda espera_ms.
    const completo = await hablar({ texto: "pan 30", client_id: "dictado-4003", espera_ms: 5000 });
    expect(completo.status).toBe(200);
  });

  test("sin monto espera como a una pregunta, para que se oiga lo que pregunte", async () => {
    const modelo = new MockLanguageModelV4({ doGenerate: async () => (await dormir(40), texto("¿Cuál de los dos cafés?")) });
    const { hablar } = montar(modelo, { registroMs: 5, preguntaMs: 2000 });
    const r = await hablar({ texto: "borra el café", client_id: "dictado-4101" });
    expect(r.status).toBe(200);
    expect(r.cuerpo).toMatchObject({ respuesta: "¿Cuál de los dos cafés?", seguir: true });
    // Con monto sigue siendo rápido: contesta "Anotado" y la Mac lo termina sola.
    expect((await hablar({ texto: "gasté en el súper 850", client_id: "dictado-4102" })).status).toBe(202);
  });

  test("borrar o cambiar algo con monto también espera como a una pregunta (QA-029)", async () => {
    const modelo = new MockLanguageModelV4({ doGenerate: async () => (await dormir(40), texto("Hay dos cafés de $85, ¿cuál borro?")) });
    const { hablar } = montar(modelo, { registroMs: 5, preguntaMs: 2000 });
    const r = await hablar({ texto: "Borra el café de 85", client_id: "dictado-4103" });
    expect(r.status).toBe(200);
    expect(r.cuerpo).toMatchObject({ seguir: true });
    expect((await hablar({ texto: "el súper de 850 cámbialo a la BBVA", client_id: "dictado-4104" })).status).toBe(200);
  });

  test("si una pregunta tarda demasiado, pide esperar la respuesta", async () => {
    const { modelo } = modeloFalso({ retrasoMs: () => 50 });
    const { hablar, get } = montar(modelo, { registroMs: 5, preguntaMs: 5 });
    const r = await hablar({ texto: "¿cuánto llevo este mes?", client_id: "dictado-5001" });
    expect(r.status).toBe(202);
    expect(r.cuerpo).toMatchObject({ pendiente: true, esperar: true });
    const final = await get("/v1/entradas/dictado-5001?esperar_ms=2000");
    expect(final.cuerpo).toMatchObject({ estado: "listo", respuesta: "Llevas 100 pesos." });
  });

  test("si la IA falla en segundo plano, la Mac reintenta sola sin duplicar", async () => {
    const { modelo, intentos } = modeloFalso({ retrasoMs: () => 20, falla: (_d, intento) => intento === 1 });
    const { hablar, montos, esperarFin } = montar(modelo, { registroMs: 5, preguntaMs: 5 });
    expect((await hablar({ texto: "luz 450", client_id: "dictado-6001" })).status).toBe(202);
    const final = await esperarFin("dictado-6001");
    // Entre el fallo y el reintento la entrada queda en "error" un momento.
    const definitivo = final.estado === "error" ? await (async () => (await dormir(40), esperarFin("dictado-6001")))() : final;
    expect(definitivo).toMatchObject({ estado: "listo", respuesta: "Listo, luz 450 de 450 pesos en Luz." });
    expect(intentos.get("luz 450")).toBe(2);
    expect(await montos()).toEqual([450]);
  });

  test("si la IA sigue caída no lo da por perdido: lo termina cuando vuelve", async () => {
    let caido = true;
    const { modelo, intentos } = modeloFalso({ falla: () => caido });
    const { hablar, get, montos } = montar(modelo, { registroMs: 0, preguntaMs: 0 });
    expect((await hablar({ texto: "agua 200", client_id: "dictado-7001" })).status).toBe(202);
    await dormir(150); // varios intentos con pausas de 20 ms
    expect(intentos.get("agua 200")).toBeGreaterThanOrEqual(3);
    expect((await get("/v1/entradas/dictado-7001")).cuerpo.estado).toBe("procesando");
    caido = false;
    await dormir(100);
    expect((await get("/v1/entradas/dictado-7001")).cuerpo.estado).toBe("listo");
    expect(await montos()).toEqual([200]);
  });

  test("un reenvío del iPhone mientras espera su reintento lo adelanta", async () => {
    let caido = true;
    const { modelo } = modeloFalso({ falla: () => caido });
    const { hablar, montos } = montar(modelo, { registroMs: 0, preguntaMs: 0 }, [60_000]);
    expect((await hablar({ texto: "agua 200", client_id: "dictado-7002" })).status).toBe(202);
    await dormir(30);
    caido = false;
    const reenvio = await hablar({ texto: "agua 200", client_id: "dictado-7002", espera_ms: 2000 });
    expect(reenvio.status).toBe(200);
    expect(await montos()).toEqual([200]);
  });

  test("un dictado que falla mientras los demás salen bien no frena la cola cada vez", async () => {
    const { modelo, intentos } = modeloFalso({ falla: (dictado) => dictado.includes("roto") });
    const { hablar, get } = montar(modelo, { registroMs: 0, preguntaMs: 0 }, [60_000]);
    expect((await hablar({ texto: "roto 100", client_id: "dictado-7101" })).status).toBe(202);
    await dormir(30);
    for (let i = 0; i < 4; i++) await hablar({ texto: `café ${i + 1}`, client_id: `dictado-72${i}0`, espera_ms: 2000 });
    // Se adelanta una vez al volver la IA; si vuelve a fallar con la IA funcionando, se deja en error.
    expect(intentos.get("roto 100")).toBe(2);
    expect((await get("/v1/entradas/dictado-7101")).cuerpo.estado).toBe("error");
  });

  test("un 'deshaz eso' que se reintenta tarde no deshace el dictado que llegó después (QA-021)", async () => {
    let fallas = 0;
    const modelo = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        const mensajes = prompt as Mensaje[];
        if (mensajes.at(-1)?.role !== "user") return texto("Listo.");
        const contenido = mensajes.at(-1)!.content;
        const dictado = typeof contenido === "string" ? contenido : contenido.map((p) => p.text ?? "").join("");
        if (dictado.includes("deshaz")) {
          if (fallas++ === 0) {
            await dormir(40);
            throw new Error("Ollama se cayó");
          }
          return llamada("deshacer", {});
        }
        const monto = Number(dictado.match(/\d+/)?.[0]);
        return llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto, descripcion: dictado }] });
      },
    });
    const { hablar, montos, esperarFin } = montar(modelo, { registroMs: 2000, preguntaMs: 2000 }, [60_000]);
    await hablar({ texto: "gasté 100", client_id: "dictado-7301" });
    await hablar({ texto: "gasté 200", client_id: "dictado-7302" });
    expect((await hablar({ texto: "deshaz eso y ya", client_id: "dictado-7303", espera_ms: 10 })).status).toBe(202);
    await dormir(60); // falla en segundo plano y queda esperando su reintento
    // Sale bien y adelanta el reintento del "deshaz eso".
    await hablar({ texto: "gasté 300", client_id: "dictado-7304" });
    expect((await esperarFin("dictado-7303")).estado).toBe("listo");
    expect((await montos()).sort((a, b) => a - b)).toEqual([100, 300]);
  });

  test("al arrancar retoma lo que quedó a medias en las últimas 24 horas", async () => {
    const { modelo, intentos } = modeloFalso({ retrasoMs: () => 10 });
    const { db, usuario, deps, hablar, montos, esperarFin } = montar(modelo);
    const base = { usuarioId: usuario.id, conversacionId: "c", capturadoEn: new Date().toISOString() };
    db.insert(entradas)
      .values([
        { ...base, clientId: "dictado-8001", texto: "renta 5000", estado: "procesando" },
        { ...base, clientId: "dictado-8002", texto: "cine 150", estado: "error" },
        { ...base, clientId: "dictado-8003", texto: "taxi 90", estado: "error", creadoEn: "2026-01-01T00:00:00.000Z" },
      ])
      .run();
    expect(reanudarPendientes(deps)).toBe(2);
    // Si el iPhone lo reenvía mientras la Mac lo retoma, se une al mismo trabajo.
    const reenvio = await hablar({ texto: "renta 5000", client_id: "dictado-8001" });
    expect(reenvio.status).toBe(200);
    expect(await esperarFin("dictado-8002")).toMatchObject({ estado: "listo" });
    expect(intentos.get("renta 5000")).toBe(1);
    expect((await montos()).sort((a, b) => a - b)).toEqual([150, 5000]);
    expect(intentos.has("taxi 90")).toBe(false);
  });

  test("cada usuario ve solo sus dictados aunque repitan el client_id", async () => {
    const { modelo, maxActivos } = modeloFalso({ retrasoMs: () => 15 });
    const pedro = montar(modelo);
    const amigo = pedro.otroUsuario();
    const [a, b] = await Promise.all([
      pedro.hablar({ texto: "súper 900", client_id: "dictado-9001" }),
      amigo.hablar({ texto: "súper 300", client_id: "dictado-9001" }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.cuerpo.duplicado).toBeUndefined();
    expect(maxActivos()).toBe(1);
    expect(await pedro.montos()).toEqual([900]);
    expect(await amigo.montos()).toEqual([300]);
    expect((await amigo.get("/v1/entradas/dictado-9001")).cuerpo).toMatchObject({ estado: "listo" });
    expect((await amigo.get("/v1/entradas/dictado-9999")).status).toBe(404);
  });
});
