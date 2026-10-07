import { describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp, RESPUESTA_RAPIDA } from "../src/app";
import { crearDispositivo, revocarDispositivo } from "../src/auth";
import type { Db } from "../src/db/client";
import { avisos, dispositivos, movimientos, suscripcionesPush } from "../src/db/schema";
import { fraseDePago, montoDeWallet } from "../src/finanzas/applepay";
import { enviarAvisosDelDia } from "../src/push/avisos-manana";
import { clavesVapid, type EnviarPush, notificar, suscribir } from "../src/push/notificaciones";
import { cifrar, endpointValido, enviarPush, firmaVapid, generarClavesVapid } from "../src/push/webpush";
import { llamada, preparar, texto } from "./ayuda";

const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMtsHJWSeD1h4ztT4fjpQ";
// Llaves de un navegador de verdad (las del ejemplo del RFC 8291).
const LLAVES = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

async function hasta(condicion: () => boolean, ms = 2000) {
  const fin = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > fin) throw new Error("No pasó a tiempo.");
    await Bun.sleep(5);
  }
}

describe("Web Push", () => {
  test("cifra igual que el ejemplo del RFC 8291", () => {
    const cuerpo = cifrar(LLAVES, new TextEncoder().encode("When I grow up, I want to be a watermelon"), {
      efimera: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
      sal: b64("DGv6ra1nlYgDCS1FRnbzlw"),
    });
    expect(Buffer.from(cuerpo).toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  test("la firma VAPID es un ES256 válido para el servicio de push, con contacto y vencimiento", () => {
    const claves = generarClavesVapid();
    const jwt = firmaVapid(ENDPOINT, claves, "https://finanzas.ejemplo.ts.net", 1_800_000_000_000);
    const [cabecera, datos, firma] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(cabecera, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(Buffer.from(datos, "base64url").toString())).toEqual({
      aud: "https://web.push.apple.com",
      exp: 1_800_003_600,
      sub: "https://finanzas.ejemplo.ts.net",
    });
    const publica = b64(claves.publica);
    const llave = createPublicKey({
      format: "jwk",
      key: { kty: "EC", crv: "P-256", x: Buffer.from(publica.slice(1, 33)).toString("base64url"), y: Buffer.from(publica.slice(33)).toString("base64url") },
    });
    const ok = verify("sha256", Buffer.from(`${cabecera}.${datos}`), { key: llave, dsaEncoding: "ieee-p1363" }, Buffer.from(firma, "base64url"));
    expect(ok).toBe(true);
  });

  test("solo acepta servicios de push conocidos por https", () => {
    expect(endpointValido(ENDPOINT)).toBe(true);
    expect(endpointValido("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(endpointValido("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    for (const malo of ["http://web.push.apple.com/x", "https://localhost:11434/api", "https://apple.com.evil.com/x", "https://web.push.apple.com:8443/x", "nada"]) {
      expect(endpointValido(malo)).toBe(false);
    }
  });

  test("manda el mensaje cifrado con los encabezados que pide Apple", async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const falso = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const r = await enviarPush({ endpoint: ENDPOINT, ...LLAVES }, '{"titulo":"x"}', generarClavesVapid(), "mailto:a@b.mx", {
      fetch: falso,
      urgencia: "high",
      tema: "dictado-1/2",
    });
    expect(r).toEqual({ ok: true, estado: 201, vencida: false, detalle: undefined });
    const h = llamadas[0]!.init.headers as Record<string, string>;
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
    expect(h.Urgency).toBe("high");
    expect(h.Topic).toBe("dictado-12");
    expect(Number(h.TTL)).toBeGreaterThan(0);
  });
});

describe("suscripciones", () => {
  test("410 olvida la suscripción; un dispositivo revocado ya no recibe", async () => {
    const { db, usuario } = preparar();
    const iphone = crearDispositivoConId(db, usuario.id, "iPhone");
    const mac = crearDispositivoConId(db, usuario.id, "Mac");
    suscribir(db, usuario.id, iphone, { endpoint: ENDPOINT, ...LLAVES, contacto: "mailto:a@b.mx" });
    suscribir(db, usuario.id, mac, { endpoint: `${ENDPOINT}2`, ...LLAVES, contacto: "mailto:a@b.mx" });
    const a: string[] = [];
    const enviar: EnviarPush = async (s) => (a.push(s.endpoint), { ok: s.endpoint === ENDPOINT, estado: s.endpoint === ENDPOINT ? 201 : 410, vencida: s.endpoint !== ENDPOINT });
    expect(await notificar(db, usuario.id, { titulo: "t", cuerpo: "c" }, enviar)).toBe(1);
    expect(a.sort()).toEqual([ENDPOINT, `${ENDPOINT}2`]);
    expect(db.select().from(suscripcionesPush).all().map((s) => s.endpoint)).toEqual([ENDPOINT]);
    revocarDispositivo(db, usuario.id, iphone);
    a.length = 0;
    expect(await notificar(db, usuario.id, { titulo: "t", cuerpo: "c" }, enviar)).toBe(0);
    expect(a).toEqual([]);
  });

  test("las llaves VAPID se crean una vez y se conservan", () => {
    const { db } = preparar();
    expect(clavesVapid(db)).toEqual(clavesVapid(db));
  });
});

function crearDispositivoConId(db: ReturnType<typeof preparar>["db"], usuarioId: string, nombre: string) {
  crearDispositivo(db, usuarioId, nombre);
  return db.select().from(dispositivos).all().at(-1)!.id;
}

/** La app con un modelo falso, un dispositivo y las notificaciones que "salen", ya descifradas. */
function montar(doGenerate: NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doGenerate"]) {
  const { db, usuario } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const enviadas: { titulo: string; cuerpo: string; url: string; etiqueta?: string }[] = [];
  const enviarPushFalso: EnviarPush = async (_s, mensaje) => (enviadas.push(JSON.parse(mensaje)), { ok: true, estado: 201, vencida: false });
  const app = crearApp({
    db,
    modelo: new MockLanguageModelV4({ doGenerate }),
    zonaHoraria: "America/Mexico_City",
    monedaBase: "MXN",
    espera: { registroMs: 5000, preguntaMs: 30000 },
    enviarPush: enviarPushFalso,
  });
  const pedir = (ruta: string, metodo = "GET", cuerpo?: unknown) =>
    app.request(ruta, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", host: "finanzas.ejemplo.ts.net" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  const activar = () =>
    pedir("/v1/push/suscripcion", "POST", { endpoint: ENDPOINT, keys: LLAVES, origen: "https://finanzas.ejemplo.ts.net" });
  return { db, usuario, pedir, activar, enviadas };
}

describe("API de notificaciones", () => {
  test("da la llave, suscribe este dispositivo con su dirección como contacto y prueba", async () => {
    const { db, pedir, activar, enviadas } = montar([]);
    const antes = (await (await pedir("/v1/push")).json()) as { clave: string; activo: boolean };
    expect(antes.activo).toBe(false);
    expect(b64(antes.clave)).toHaveLength(65);
    expect((await activar()).status).toBe(201);
    expect(db.select().from(suscripcionesPush).get()!.contacto).toBe("https://finanzas.ejemplo.ts.net");
    expect(((await (await pedir("/v1/push")).json()) as { activo: boolean }).activo).toBe(true);
    expect((await pedir("/v1/push/prueba", "POST")).status).toBe(200);
    expect(enviadas[0]!.cuerpo).toStartWith("Listo, Pedro.");
    expect((await pedir("/v1/push/suscripcion", "DELETE")).status).toBe(200);
    expect(((await (await pedir("/v1/push")).json()) as { activo: boolean }).activo).toBe(false);
    expect((await pedir("/v1/push/prueba", "POST")).status).toBe(502);
  });

  test("rechaza servicios de push que no son de Apple, Google, Mozilla o Microsoft", async () => {
    const { pedir } = montar([]);
    const r = await pedir("/v1/push/suscripcion", "POST", { endpoint: "https://127.0.0.1.nip.io/x", keys: LLAVES });
    expect(r.status).toBe(400);
  });
});

const REGISTRO_CAFE = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, comercio: "Starbucks", categoria: "Café" }] });

describe("Atajo rápido", () => {
  test("con notificaciones, un registro contesta 'Anotado' sin esperar y lo anotado llega por push al detalle", async () => {
    let soltar = () => {};
    const listo = new Promise<void>((r) => (soltar = r));
    const { pedir, activar, enviadas, db } = montar(async () => (await listo, REGISTRO_CAFE));
    await activar();
    const r = await pedir("/v1/hablar", "POST", { texto: "gasté 85 en Starbucks", client_id: "rapido-0001" });
    expect(r.status).toBe(202);
    const cuerpo = (await r.json()) as { respuesta: string; pendiente: boolean; seguir?: boolean };
    expect(cuerpo.respuesta).toBe(RESPUESTA_RAPIDA);
    expect(cuerpo.seguir).toBeUndefined();
    expect(enviadas).toHaveLength(0);
    soltar();
    await hasta(() => enviadas.length > 0);
    const id = db.select().from(movimientos).get()!.id;
    expect(enviadas[0]).toMatchObject({ titulo: "$85 · Starbucks", url: `/#movimientos?detalle=${id}` });
    expect(enviadas[0]!.cuerpo).toContain("85");
  });

  test("si la última notificación no llegó, vuelve a contestar en voz", async () => {
    const { pedir, activar, db } = montar([REGISTRO_CAFE]);
    await activar();
    db.update(suscripcionesPush).set({ ultimoError: "403 BadJwtToken" }).run();
    const r = await pedir("/v1/hablar", "POST", { texto: "gasté 85 en Starbucks", client_id: "push-roto-01" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { respuesta: string }).respuesta).not.toBe(RESPUESTA_RAPIDA);
  });

  test("una pregunta se sigue contestando en voz, sin push", async () => {
    const { pedir, activar, enviadas } = montar([llamada("consultar_gastos", { periodo: "este_mes" }), texto("Llevas $85 este mes.")]);
    await activar();
    const r = await pedir("/v1/hablar", "POST", { texto: "¿cuánto llevo este mes?", client_id: "pregunta-01" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { respuesta: string }).respuesta).toBe("Llevas 85 pesos este mes.");
    await Bun.sleep(20);
    expect(enviadas).toHaveLength(0);
  });

  test("sin notificaciones espera a la IA como siempre", async () => {
    const { pedir } = montar([REGISTRO_CAFE]);
    const r = await pedir("/v1/hablar", "POST", { texto: "gasté 85 en Starbucks", client_id: "sin-push-01" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { respuesta: string }).respuesta).not.toBe(RESPUESTA_RAPIDA);
  });

  test("la app (que manda espera_ms) no usa la respuesta rápida", async () => {
    const { pedir, activar } = montar([REGISTRO_CAFE]);
    await activar();
    const r = await pedir("/v1/hablar", "POST", { texto: "gasté 85 en Starbucks", client_id: "app-000001", espera_ms: 5000 });
    expect(r.status).toBe(200);
  });

  test("si la IA pregunta algo, la push lo dice y el siguiente dictado sigue esa conversación", async () => {
    const respuestas = [texto("¿Fueron 85 en Starbucks o en Oxxo?"), texto("Va.")];
    // Como la IA de verdad: tarda, así que el Atajo ya no la espera.
    const { pedir, activar, enviadas } = montar(async () => (await Bun.sleep(20), respuestas.shift()!));
    await activar();
    const r = (await (await pedir("/v1/hablar", "POST", { texto: "gasté 85 en café", client_id: "pregunta-push-1" })).json()) as {
      conversacion_id: string;
    };
    await hasta(() => enviadas.length > 0);
    expect(enviadas[0]!.titulo).toBe("Tengo una pregunta");
    expect(enviadas[0]!.cuerpo).toContain("Contéstame en el Atajo");
    const r2 = (await (await pedir("/v1/hablar", "POST", { texto: "en Starbucks", client_id: "pregunta-push-2" })).json()) as {
      conversacion_id: string;
    };
    expect(r2.conversacion_id).toBe(r.conversacion_id);
  });
});

describe("aviso del día", () => {
  type Nuevo = Partial<typeof avisos.$inferInsert> & Pick<typeof avisos.$inferInsert, "usuarioId" | "titulo" | "texto">;
  const guardar = (db: Db, a: Nuevo) =>
    db
      .insert(avisos)
      .values({ tipo: "hormiga", clave: a.titulo, fecha: hoyEnMexico(), ...a })
      .run();
  const hoyEnMexico = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  test("el Atajo lo dice una vez, el más importante, al final de la primera respuesta, en pesos", async () => {
    const consulta = llamada("consultar_gastos", { periodo: "este_mes" });
    const { db, usuario, pedir } = montar([consulta, texto("Llevas $85 este mes."), consulta, texto("Llevas $85 este mes.")]);
    guardar(db, { usuarioId: usuario.id, titulo: "Meta", texto: "Vas bien con tu meta.", tipo: "meta", prioridad: 3 });
    guardar(db, { usuarioId: usuario.id, titulo: "Cafés", texto: "Llevas $400 en cafés esta semana.", prioridad: 1 });
    const uno = (await (await pedir("/v1/hablar", "POST", { texto: "¿cuánto llevo?", client_id: "aviso-00001" })).json()) as { respuesta: string };
    expect(uno.respuesta).toBe("Llevas 85 pesos este mes. Por cierto: Llevas 400 pesos en cafés esta semana.");
    const dicho = db.select().from(avisos).all().find((a) => a.titulo === "Cafés")!;
    expect(dicho.dichoEn).not.toBeNull();
    // Uno por respuesta: el siguiente sale en la próxima.
    const dos = (await (await pedir("/v1/hablar", "POST", { texto: "¿cuánto llevo?", client_id: "aviso-00002" })).json()) as { respuesta: string };
    expect(dos.respuesta).toBe("Llevas 85 pesos este mes. Por cierto: Vas bien con tu meta.");
  });

  test("sale por push en la mañana, uno con cuántos más hay, y no de madrugada ni lo que ya se dijo", async () => {
    const { db, usuario } = preparar();
    const dispositivo = crearDispositivoConId(db, usuario.id, "iPhone");
    suscribir(db, usuario.id, dispositivo, { endpoint: ENDPOINT, ...LLAVES, contacto: "mailto:a@b.mx" });
    const enviadas: { titulo: string; cuerpo: string; url: string }[] = [];
    const enviar: EnviarPush = async (_s, m) => (enviadas.push(JSON.parse(m)), { ok: true, estado: 201, vencida: false });
    const creadoEn = "2026-10-07T08:00:00.000Z";
    guardar(db, { usuarioId: usuario.id, fecha: "2026-10-07", titulo: "Meta", texto: "Vas bien.", tipo: "meta", prioridad: 2, creadoEn });
    guardar(db, { usuarioId: usuario.id, fecha: "2026-10-07", titulo: "Cafés", texto: "Llevas $400 en cafés.", prioridad: 1, enlace: "#movimientos?texto=caf%C3%A9", creadoEn });
    guardar(db, { usuarioId: usuario.id, fecha: "2026-10-07", titulo: "Dicho", texto: "Ya lo oyó.", prioridad: 1, creadoEn, dichoEn: creadoEn });
    // 3:00 en Ciudad de México.
    expect(await enviarAvisosDelDia(db, "America/Mexico_City", new Date("2026-10-07T09:00:00Z"), enviar)).toBe(0);
    // 9:30.
    expect(await enviarAvisosDelDia(db, "America/Mexico_City", new Date("2026-10-07T15:30:00Z"), enviar)).toBe(1);
    expect(enviadas).toEqual([
      { titulo: "Cafés", cuerpo: "Llevas $400 en cafés. Y un aviso más en la app.", url: "/#movimientos?texto=caf%C3%A9", etiqueta: "avisos-2026-10-07" } as never,
    ]);
    expect(await enviarAvisosDelDia(db, "America/Mexico_City", new Date("2026-10-07T16:00:00Z"), enviar)).toBe(0);
  });

  test("sin notificaciones activas espera, y le llegan si las activa más tarde", async () => {
    const { db, usuario } = preparar();
    const enviadas: unknown[] = [];
    const enviar: EnviarPush = async (_s, m) => (enviadas.push(JSON.parse(m)), { ok: true, estado: 201, vencida: false });
    guardar(db, { usuarioId: usuario.id, fecha: "2026-10-07", titulo: "Cafés", texto: "x", creadoEn: "2026-10-07T08:00:00.000Z" });
    expect(await enviarAvisosDelDia(db, "America/Mexico_City", new Date("2026-10-07T15:30:00Z"), enviar)).toBe(0);
    suscribir(db, usuario.id, crearDispositivoConId(db, usuario.id, "iPhone"), { endpoint: ENDPOINT, ...LLAVES, contacto: "mailto:a@b.mx" });
    expect(await enviarAvisosDelDia(db, "America/Mexico_City", new Date("2026-10-07T17:00:00Z"), enviar)).toBe(1);
  });
});

describe("Apple Pay", () => {
  test("lee el monto como lo da la Cartera", () => {
    expect(montoDeWallet("$85.00")).toEqual({ monto: 85, moneda: "MXN" });
    expect(montoDeWallet("MX$1,234.50")).toEqual({ monto: 1234.5, moneda: "MXN" });
    expect(montoDeWallet("US$12.00")).toEqual({ monto: 12, moneda: "USD" });
    expect(montoDeWallet("12,50 €")).toEqual({ monto: 12.5, moneda: "EUR" });
    expect(montoDeWallet("1.234,56 €")).toEqual({ monto: 1234.56, moneda: "EUR" });
    expect(montoDeWallet("1,234")).toEqual({ monto: 1234, moneda: "MXN" });
    expect(montoDeWallet("85.5")).toEqual({ monto: 85.5, moneda: "MXN" });
    for (const nada of [undefined, "", "$0.00", "gratis"]) expect(montoDeWallet(nada)).toBeUndefined();
  });

  test("arma una frase sin números de sucursal ni de tarjeta", () => {
    expect(fraseDePago({ monto: "$1,234.50", comercio: "OXXO 1234 POLANCO", tarjeta: "Visa ••1234" })).toBe(
      "Pagué 1234.50 pesos en OXXO POLANCO con la tarjeta Visa (Apple Pay)",
    );
    expect(fraseDePago({ monto: "$85.00", nombre: "Starbucks" })).toBe("Pagué 85 pesos en Starbucks (Apple Pay)");
    expect(fraseDePago({ comercio: "Starbucks" })).toBeUndefined();
  });

  test("registra el pago como apple_pay y avisa para agregar detalles", async () => {
    const { pedir, activar, enviadas, db } = montar([REGISTRO_CAFE]);
    await activar();
    const r = await pedir("/v1/hablar", "POST", {
      origen: "apple_pay",
      client_id: "applepay-20261007-123456",
      monto: "$85.00",
      comercio: "STARBUCKS COFFEE",
      nombre: "",
      tarjeta: "Nu",
    });
    expect([200, 202]).toContain(r.status);
    await hasta(() => enviadas.length > 0);
    const m = db.select().from(movimientos).get()!;
    expect(m.origen).toBe("apple_pay");
    expect(m.textoOriginal).toBe("Pagué 85 pesos en STARBUCKS COFFEE con la tarjeta Nu (Apple Pay)");
    expect(enviadas[0]!.titulo).toBe("Apple Pay · $85 · Starbucks");
    expect(enviadas[0]!.cuerpo).toEndWith("Toca para agregar detalles.");
    expect(enviadas[0]!.url).toBe(`/#movimientos?detalle=${m.id}`);
    // Reenviado desde la cola, no se duplica.
    const otra = await pedir("/v1/hablar", "POST", { origen: "apple_pay", client_id: "applepay-20261007-123456", monto: "$85.00" });
    expect(otra.status).toBe(200);
    expect(db.select().from(movimientos).all()).toHaveLength(1);
  });

  test("corrido a mano (sin pago) es una prueba que avisa por push", async () => {
    const { pedir, activar, enviadas, db } = montar([]);
    await activar();
    const r = (await (await pedir("/v1/hablar", "POST", { origen: "apple_pay", client_id: "applepay-prueba-1", monto: "", comercio: "" })).json()) as {
      prueba: boolean;
      respuesta: string;
    };
    expect(r.prueba).toBe(true);
    expect(r.respuesta).toStartWith("Listo.");
    expect(enviadas[0]!.titulo).toBe("Apple Pay listo");
    expect(db.select().from(movimientos).all()).toHaveLength(0);
  });
});
