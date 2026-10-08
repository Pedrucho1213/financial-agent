import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { CLAVE_PUSH, comoAppDeInicio, conPushFalso, prepararSesion } from "./api-falsa";

test.describe("Tocar una notificación con la app abierta", () => {
  test("el aviso del service worker lleva al editor del pago de Apple Pay", async ({ page }) => {
    const api = await prepararSesion(page);
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    await page.goto("/#ajustes");
    await expect(page.getByRole("switch", { name: "Notificaciones" })).toBeVisible();
    // Lo que manda public/sw-push.js en notificationclick cuando la app ya está abierta.
    await page.evaluate((url) => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { tipo: "fa:abrir", url } }));
    }, `${new URL(page.url()).origin}/#movimientos?detalle=${pemex.id}&editar=1`);
    await expect(page).toHaveURL(new RegExp(`#movimientos\\?detalle=${pemex.id}&editar=1$`));
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Movimiento" })).toBeVisible();
  });
});

test.describe("Notificaciones en Ajustes", () => {
  test("en una pestaña de Safari pide abrir la app desde la pantalla de inicio", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#ajustes");
    const interruptor = page.getByRole("switch", { name: "Notificaciones" });
    await expect(interruptor).toBeDisabled();
    await expect(page.getByText("Abre Finanzas desde tu pantalla de inicio para activarlas.")).toBeVisible();
  });

  test("activar pide permiso, se suscribe con la llave del servidor y deja probar", async ({ page }) => {
    const api = await prepararSesion(page);
    await comoAppDeInicio(page);
    await conPushFalso(page);
    await page.goto("/#ajustes");
    const interruptor = page.getByRole("switch", { name: "Notificaciones" });
    await expect(interruptor).not.toBeChecked();
    await interruptor.click();
    await expect(interruptor).toBeChecked();
    const enviada = api.de("POST", "/v1/push/suscripcion")[0]?.cuerpo as { endpoint: string; keys: unknown; origen: string; en_iphone: boolean };
    expect(enviada).toEqual({
      endpoint: "https://web.push.apple.com/abc",
      keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
      origen: "http://127.0.0.1:4173",
      // Las pruebas corren como iPhone: con esto el Atajo puede contestar corto.
      en_iphone: true,
    });
    const llave = (await page.evaluate(() => (window as unknown as { __suscripciones: number[][] }).__suscripciones))[0]!;
    expect(Buffer.from(llave).toString("base64url")).toBe(CLAVE_PUSH);

    await page.getByRole("button", { name: "Enviar una de prueba" }).click();
    await expect(page.getByText("Te mandé una notificación de prueba")).toBeVisible();
    expect(api.de("POST", "/v1/push/prueba")).toHaveLength(1);

    await interruptor.click();
    await expect(interruptor).not.toBeChecked();
    expect(api.de("DELETE", "/v1/push/suscripcion")).toHaveLength(1);
  });

  test("si niega el permiso, dice dónde activarlas y no se suscribe", async ({ page }) => {
    const api = await prepararSesion(page);
    await comoAppDeInicio(page);
    await conPushFalso(page, "denied");
    await page.goto("/#ajustes");
    await page.getByRole("switch", { name: "Notificaciones" }).click();
    await expect(page.getByText("Bloqueadas: actívalas en Ajustes › Notificaciones › Finanzas.")).toBeVisible();
    expect(api.de("POST", "/v1/push/suscripcion")).toHaveLength(0);
  });

  test("si iOS nunca contesta al suscribir, se rinde a los 15 s y deja reintentar", async ({ page }) => {
    const api = await prepararSesion(page);
    await comoAppDeInicio(page);
    await conPushFalso(page, "granted", true);
    await page.clock.install();
    await page.goto("/#ajustes");
    const interruptor = page.getByRole("switch", { name: "Notificaciones" });
    await interruptor.click();
    // El reloj de 15 s se arma después de pedir /v1/push y el registro; con la máquina cargada eso
    // llega tarde. Se adelanta de nuevo hasta que se rinda, en vez de una sola vez a ciegas.
    const aviso = page.getByText("No se pudieron activar las notificaciones. Inténtalo de nuevo.");
    await expect
      .poll(async () => {
        await page.clock.fastForward(15_000);
        return aviso.isVisible();
      })
      .toBe(true);
    await expect(interruptor).not.toBeChecked();
    await expect(interruptor).toBeEnabled();
    expect(api.de("POST", "/v1/push/suscripcion")).toHaveLength(0);
  });

  test("el Atajo de Apple Pay se pide con su tipo y muestra cómo crear la automatización", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    const descarga = page.waitForEvent("download");
    await page.getByRole("button", { name: /Anotar mis pagos con Apple Pay/ }).click();
    await descarga;
    expect(api.de("POST", "/v1/atajo")[0]?.cuerpo).toEqual({ servidor: "http://127.0.0.1:4173", tipo: "apple_pay" });
    const hoja = page.getByRole("dialog", { name: "Pagos con Apple Pay" });
    await expect(hoja.getByRole("listitem")).toHaveText([/Agregar atajo/, /Permitir siempre/, /Automatización/, /Finanzas Apple Pay/]);
  });
});

test.describe("service worker de notificaciones", () => {
  /** Corre public/sw-push.js con un `self` falso y devuelve sus manejadores. */
  function cargar(ventanas: { url: string; postMessage: (m: unknown) => void; focus: () => Promise<void> }[] = []) {
    const manejadores: Record<string, (e: unknown) => void> = {};
    const mostradas: { titulo: string; opciones: Record<string, unknown> }[] = [];
    const abiertas: string[] = [];
    const self = {
      location: { origin: "https://finanzas.ejemplo.ts.net" },
      addEventListener: (tipo: string, fn: (e: unknown) => void) => (manejadores[tipo] = fn),
      registration: { showNotification: async (titulo: string, opciones: Record<string, unknown>) => void mostradas.push({ titulo, opciones }) },
      clients: { matchAll: async () => ventanas, openWindow: async (url: string) => void abiertas.push(url) },
    };
    runInNewContext(readFileSync(new URL("../public/sw-push.js", import.meta.url), "utf8"), { self, URL });
    const esperar: Promise<unknown>[] = [];
    const evento = (extra: object) => ({ ...extra, waitUntil: (p: Promise<unknown>) => esperar.push(p) });
    return { manejadores, mostradas, abiertas, evento, listo: () => Promise.all(esperar) };
  }

  test("muestra el título, el texto y guarda a dónde lleva", async () => {
    const sw = cargar();
    const datos = { titulo: "$85 · Starbucks", cuerpo: "Listo, café de 85 pesos.", url: "/#movimientos?detalle=m1", etiqueta: "dictado-1" };
    sw.manejadores.push!(sw.evento({ data: { json: () => datos } }));
    await sw.listo();
    expect(sw.mostradas[0]).toMatchObject({
      titulo: "$85 · Starbucks",
      opciones: { body: "Listo, café de 85 pesos.", tag: "dictado-1", data: { url: "/#movimientos?detalle=m1" } },
    });
  });

  test("al tocarla abre el detalle; si la app ya está abierta, le dice a dónde ir", async () => {
    const sw = cargar();
    const notificacion = { data: { url: "/#movimientos?detalle=m1" }, close() {} };
    sw.manejadores.notificationclick!(sw.evento({ notification: notificacion }));
    await sw.listo();
    expect(sw.abiertas).toEqual(["https://finanzas.ejemplo.ts.net/#movimientos?detalle=m1"]);

    const mensajes: unknown[] = [];
    const abierta = cargar([{ url: "https://finanzas.ejemplo.ts.net/#inicio", postMessage: (m) => mensajes.push(m), focus: async () => {} }]);
    abierta.manejadores.notificationclick!(abierta.evento({ notification: notificacion }));
    await abierta.listo();
    expect(mensajes).toEqual([{ tipo: "fa:abrir", url: "https://finanzas.ejemplo.ts.net/#movimientos?detalle=m1" }]);
    expect(abierta.abiertas).toEqual([]);
  });

  test("no abre direcciones de otro sitio", async () => {
    const sw = cargar();
    sw.manejadores.notificationclick!(sw.evento({ notification: { data: { url: "https://otro.com/x" }, close() {} } }));
    await sw.listo();
    expect(sw.abiertas).toEqual(["https://finanzas.ejemplo.ts.net/"]);
  });
});
