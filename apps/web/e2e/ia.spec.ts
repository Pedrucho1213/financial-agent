import { expect, test } from "@playwright/test";
import { ApiFalsa, prepararSesion, TOKEN } from "./api-falsa";
import { ponerEstado } from "./api-falsa-cuenta";
import { fallarIa, iaDe, ponerIa } from "./api-falsa-ia";

// Ajustes › IA en tu Mac: el interruptor de la IA de desarrollo, solo para la cuenta dueña.

test.describe("IA en tu Mac (Ajustes)", () => {
  test("siempre encendida por omisión: estado, memoria y sin plazo", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    const ia = page.getByRole("region", { name: "IA en tu Mac" });
    await expect(ia.getByText("Encendida", { exact: true })).toBeVisible();
    await expect(ia.getByText("Sin límite · 8.2 GB")).toBeVisible();
    await expect(ia.getByRole("switch", { name: "Siempre encendida" })).toBeChecked();
    await expect(ia.getByRole("radiogroup", { name: "Apagar tras" })).toHaveCount(0);
    await expect(ia.getByRole("button", { name: "Apagar ahora" })).toBeEnabled();
    await expect(ia.getByText(/Herramienta de desarrollo/)).toBeVisible();
    expect(api.de("GET", "/v1/ia")[0]?.autorizacion).toBe(`Bearer ${TOKEN}`);
  });

  test("apagar ahora y volver a encender", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    const ia = page.getByRole("region", { name: "IA en tu Mac" });
    await expect(ia.getByRole("button", { name: "Apagar ahora" })).toBeEnabled();
    const antes = api.de("GET", "/v1/estado").length;
    await ia.getByRole("button", { name: "Apagar ahora" }).click();
    await expect(page.getByText("IA apagada. Se vuelve a encender con tu próximo dictado.")).toBeVisible();
    await expect(ia.getByText("Apagada", { exact: true })).toBeVisible();
    await expect(ia.getByText("Se enciende con tu próximo dictado.")).toBeVisible();
    expect(api.de("POST", "/v1/ia/apagar")).toHaveLength(1);
    // Sistema se entera sin esperar: se vuelve a pedir el estado.
    await expect.poll(() => api.de("GET", "/v1/estado").length).toBeGreaterThan(antes);

    await ia.getByRole("button", { name: "Encender ahora" }).click();
    await expect(page.getByText("IA encendida")).toBeVisible();
    await expect(ia.getByText("Encendida", { exact: true })).toBeVisible();
    expect(api.de("POST", "/v1/ia/encender")).toHaveLength(1);
  });

  test("quitar 'siempre encendida' muestra el plazo y lo cambia", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    const ia = page.getByRole("region", { name: "IA en tu Mac" });
    await ia.getByRole("switch", { name: "Siempre encendida" }).click();
    await expect(ia.getByRole("switch", { name: "Siempre encendida" })).not.toBeChecked();
    expect(api.de("PUT", "/v1/ia")[0]?.cuerpo).toEqual({ siempre: false });
    const plazo = ia.getByRole("radiogroup", { name: "Apagar tras" });
    await expect(plazo.getByRole("radio", { name: "10 min" })).toHaveAttribute("aria-checked", "true");
    await expect(ia.getByText("Apagar tras 10 min sin uso")).toBeVisible();
    // 12:30 en CDMX + 10 min.
    await expect(ia.getByText("Hasta 12:40 p.m. · 8.2 GB")).toBeVisible();

    await plazo.getByRole("radio", { name: "1 h" }).click();
    await expect(plazo.getByRole("radio", { name: "1 h" })).toHaveAttribute("aria-checked", "true");
    await expect(ia.getByText("Apagar tras 1 hora sin uso")).toBeVisible();
    expect(api.de("PUT", "/v1/ia")[1]?.cuerpo).toEqual({ minutos: 60 });
    // Tocar el que ya está elegido no manda nada.
    await plazo.getByRole("radio", { name: "1 h" }).click();
    await page.waitForTimeout(200);
    expect(api.de("PUT", "/v1/ia")).toHaveLength(2);

    await ia.getByRole("switch", { name: "Siempre encendida" }).click();
    await expect(ia.getByRole("radiogroup", { name: "Apagar tras" })).toHaveCount(0);
    expect(api.de("PUT", "/v1/ia")[2]?.cuerpo).toEqual({ siempre: true });
    expect(iaDe(api)).toMatchObject({ siempre: true, minutos: 60 });
  });

  test("si el servidor falla al cambiar, el interruptor regresa y lo dice", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#ajustes");
    const ia = page.getByRole("region", { name: "IA en tu Mac" });
    await expect(ia.getByRole("switch", { name: "Siempre encendida" })).toBeChecked();
    fallarIa(api, 503, { error: "Ollama no contestó." });
    await ia.getByRole("switch", { name: "Siempre encendida" }).click();
    await expect(page.getByText("Ollama no contestó.")).toBeVisible();
    await expect(ia.getByRole("switch", { name: "Siempre encendida" })).toBeChecked();
  });

  test("apagada con plazo: se enciende al dictar; sin Ollama no deja encender", async ({ page }) => {
    const api = new ApiFalsa();
    ponerIa(api, { siempre: false, cargada: false, memoria: null });
    await prepararSesion(page, api);
    await page.goto("/#ajustes");
    const ia = page.getByRole("region", { name: "IA en tu Mac" });
    await expect(ia.getByText("Se enciende al dictar.")).toBeVisible();
    await expect(ia.getByRole("button", { name: "Encender ahora" })).toBeEnabled();

    ponerIa(api, { disponible: false });
    await page.reload();
    await expect(ia.getByText("No disponible", { exact: true })).toBeVisible();
    await expect(ia.getByText("Ollama no responde o no tiene el modelo.")).toBeVisible();
    await expect(ia.getByRole("button", { name: "Encender ahora" })).toBeDisabled();
  });

  test("quien no es la cuenta dueña no ve el interruptor ni lo pide", async ({ page }) => {
    const api = new ApiFalsa();
    ponerEstado(api, { servidor: null });
    await prepararSesion(page, api);
    await page.goto("/#ajustes");
    await expect(page.getByRole("region", { name: "Sistema" }).getByText("Lista")).toBeVisible();
    await expect(page.getByRole("region", { name: "IA en tu Mac" })).toHaveCount(0);
    expect(api.de("GET", "/v1/ia")).toHaveLength(0);
  });

  test("un servidor sin interruptor (404) o que contesta 403 no muestra nada ni avisa error", async ({ page }) => {
    const api = new ApiFalsa();
    ponerIa(api, null);
    await prepararSesion(page, api);
    await page.goto("/#ajustes");
    await expect(page.getByRole("region", { name: "Sistema" }).getByText("Lista")).toBeVisible();
    await expect.poll(() => api.de("GET", "/v1/ia").length).toBeGreaterThan(0);
    await expect(page.getByRole("region", { name: "IA en tu Mac" })).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

    ponerIa(api, {});
    fallarIa(api, 403, { error: "Solo la cuenta dueña de esta instalación puede encender o apagar la IA." });
    await page.reload();
    await expect(page.getByRole("region", { name: "Sistema" }).getByText("Lista")).toBeVisible();
    await expect(page.getByRole("region", { name: "IA en tu Mac" })).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });

  test("a 320 de ancho cabe sin desbordar", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const api = new ApiFalsa();
    ponerIa(api, { siempre: false, hasta: "2026-10-06T19:30:00.000Z" });
    await prepararSesion(page, api);
    await page.goto("/#ajustes");
    const ia = page.getByRole("region", { name: "IA en tu Mac" });
    await ia.scrollIntoViewIfNeeded();
    await expect(ia.getByRole("radiogroup", { name: "Apagar tras" })).toBeVisible();
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(320);
    // Ningún plazo ni el título del interruptor se cortan con «…».
    for (const el of await ia.locator('[role="radio"], [role="radiogroup"] ~ *, .truncate').all()) {
      const cortado = await el.evaluate((n) => n.scrollWidth > n.clientWidth + 1);
      expect(cortado, (await el.textContent()) ?? "").toBe(false);
    }
  });
});
