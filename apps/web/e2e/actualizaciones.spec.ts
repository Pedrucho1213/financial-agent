import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { prepararSesion } from "./api-falsa";

// Ajustes › «Buscar actualizaciones»: compara la versión de la app con /version.json del servidor.

type Version = { numero: string; commit: string; fecha: string };

const instalada = (): Version => JSON.parse(readFileSync(`${test.info().config.rootDir}/../dist/version.json`, "utf8"));

async function servidorCon(page: Page, version: Version | null) {
  const pedidas: string[] = [];
  await page.route(/\/version\.json/, (ruta) => {
    pedidas.push(ruta.request().url());
    return version ? ruta.fulfill({ json: version }) : ruta.fulfill({ status: 503, body: "" });
  });
  return pedidas;
}

test.describe("Buscar actualizaciones", () => {
  test("la versión instalada sale en Ajustes y, si es la del servidor, dice que está al día", async ({ page }) => {
    const v = instalada();
    expect(v.numero).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{4}$/);
    await prepararSesion(page);
    const pedidas = await servidorCon(page, v);
    await page.goto("/#ajustes");
    await expect(page.getByText(`Versión ${v.numero} · ${v.commit}`)).toBeVisible();

    await page.getByRole("button", { name: "Buscar actualizaciones" }).click();
    await expect(page.getByText("Ya tienes la versión más reciente.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buscar actualizaciones" })).toBeEnabled();
    expect(pedidas).toHaveLength(1);
  });

  test("si el servidor tiene otra versión, recarga la app", async ({ page }) => {
    await prepararSesion(page);
    await servidorCon(page, { ...instalada(), commit: "abc1234" });
    await page.goto("/#ajustes");
    await page.evaluate(() => ((window as unknown as { sinRecargar: boolean }).sinRecargar = true));

    const recarga = page.waitForEvent("load");
    await page.getByRole("button", { name: "Buscar actualizaciones" }).click();
    await recarga;
    expect(await page.evaluate(() => (window as unknown as { sinRecargar?: boolean }).sinRecargar)).toBeUndefined();
    await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
  });

  test("sin conexión o sin respuesta del servidor, lo dice y no recarga", async ({ page, context }) => {
    await prepararSesion(page);
    await servidorCon(page, null);
    await page.goto("/#ajustes");
    await page.evaluate(() => ((window as unknown as { sinRecargar: boolean }).sinRecargar = true));
    const boton = page.getByRole("button", { name: "Buscar actualizaciones" });

    await boton.click();
    await expect(page.getByText("No pude comprobarlo. Inténtalo en un momento.")).toBeVisible();

    await context.setOffline(true);
    await boton.click();
    await expect(page.getByText("Sin conexión. Inténtalo cuando tengas internet.")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { sinRecargar?: boolean }).sinRecargar)).toBe(true);
  });

  test("a 320 px la fila y la versión caben sin salirse", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await prepararSesion(page);
    await servidorCon(page, instalada());
    await page.goto("/#ajustes");
    const boton = page.getByRole("button", { name: "Buscar actualizaciones" });
    await boton.scrollIntoViewIfNeeded();
    const caja = await boton.boundingBox();
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(320);
    // El título completo, sin puntos suspensivos.
    const titulo = boton.getByText("Buscar actualizaciones");
    expect(await titulo.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

// El service worker nuevo toma la página (controllerchange): la primera vez solo es la instalación.
const tomarControl = (page: Page) =>
  page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  });

test.describe("Versión nueva descargada sola", () => {
  test("recién abierta la app y sin nada a medias, recarga sola", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#inicio");
    await expect(page.getByText("Hola, Pedro")).toBeVisible();
    await page.evaluate(() => ((window as unknown as { sinRecargar: boolean }).sinRecargar = true));
    const recarga = page.waitForEvent("load");
    await tomarControl(page);
    await recarga;
    expect(await page.evaluate(() => (window as unknown as { sinRecargar?: boolean }).sinRecargar)).toBeUndefined();
  });

  test("con el editor abierto no recarga: avisa y Ajustes ofrece «Actualizar ahora»", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#inicio");
    await page.evaluate(() => ((window as unknown as { sinRecargar: boolean }).sinRecargar = true));
    await page.getByRole("button", { name: "Agregar movimiento" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await tomarControl(page);
    await expect(page.getByText("Hay una versión nueva de la app")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: "Ajustes" }).or(page.getByRole("button", { name: "Ajustes" })).first().click();
    await expect(page.getByRole("button", { name: /Actualizar ahora/ })).toContainText("Ya se descargó una versión nueva");
    expect(await page.evaluate(() => (window as unknown as { sinRecargar?: boolean }).sinRecargar)).toBe(true);

    const recarga = page.waitForEvent("load");
    await page.getByRole("button", { name: /Actualizar ahora/ }).click();
    await recarga;
  });
});

test.describe("Buscar actualizaciones con el service worker activo", () => {
  test.use({ serviceWorkers: "allow" });
  test("si el service worker no trae nada nuevo, borra su copia y recarga desde la red sin quitarlo", async ({ page }) => {
    await prepararSesion(page);
    await servidorCon(page, { ...instalada(), commit: "abc1234" });
    await page.goto("/#ajustes");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    expect(await page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);

    const recarga = page.waitForEvent("load");
    await page.getByRole("button", { name: "Buscar actualizaciones" }).click();
    await recarga;
    await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
    // Sigue el mismo service worker (con él, la suscripción a notificaciones); su copia guardada ya no.
    const despues = await page.evaluate(async () => ({ registrado: Boolean(await navigator.serviceWorker.getRegistration()), copias: (await caches.keys()).length }));
    expect(despues).toEqual({ registrado: true, copias: 0 });
  });
});
