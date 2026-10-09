import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas, cuentasComoPedro } from "./api-falsa-cuentas";

// Capturas de cuentas, tarjetas y etiquetas en claro y oscuro. No validan nada más.
const DIR = "e2e/capturas/cuentas";
mkdirSync(DIR, { recursive: true });

async function capturar(page: Page, nombre: string, completa = false) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/${nombre}.png`, fullPage: completa });
}

for (const esquema of ["light", "dark"] as const) {
  const sufijo = esquema === "light" ? "claro" : "oscuro";
  test.describe(`capturas de cuentas ${sufijo}`, () => {
    test.use({ colorScheme: esquema });

    test(`tarjeta sin límite (${sufijo})`, async ({ page }) => {
      // Nu solo con lo disponible, como la de Pedro.
      await prepararSesion(page, conCuentas(new ApiFalsa(), cuentasComoPedro()));
      await page.goto("/#cuentas");
      await expect(page.getByTestId("credito-disponible")).toBeVisible();
      await capturar(page, `sin-limite-${sufijo}`, true);
    });

    test(`cuentas (${sufijo})`, async ({ page }) => {
      await prepararSesion(page, conCuentas(new ApiFalsa()));
      await page.goto("/#inicio");
      await expect(page.getByRole("button", { name: /^Cuentas y tarjetas/ })).toBeVisible();
      await capturar(page, `inicio-${sufijo}`, true);

      await page.goto("/#cuentas");
      await expect(page.getByTestId("neto")).toBeVisible();
      await capturar(page, `cuentas-${sufijo}`, true);

      await page.goto("/#cuenta?id=cta-banamex");
      await expect(page.getByTestId("deuda")).toBeVisible();
      await capturar(page, `tarjeta-${sufijo}`, true);

      await page.goto("/#cuenta?id=cta-bbva");
      await expect(page.getByTestId("saldo")).toBeVisible();
      await capturar(page, `debito-${sufijo}`, true);

      await page.goto("/#cuentas");
      await page.getByRole("button", { name: "Mover dinero" }).first().click();
      await capturar(page, `mover-${sufijo}`);
      await page.getByRole("button", { name: "Cancelar" }).click();

      await page.goto("/#etiquetas");
      await expect(page.getByRole("heading", { name: "Tus etiquetas" })).toBeVisible();
      await capturar(page, `etiquetas-${sufijo}`, true);

      await page.goto("/#analisis");
      await expect(page.getByRole("region", { name: "Por etiqueta" })).toBeVisible();
      await page.getByRole("region", { name: "Por etiqueta" }).scrollIntoViewIfNeeded();
      await capturar(page, `analisis-etiquetas-${sufijo}`);
    });
  });
}

test.describe("capturas de cuentas a 320", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("cuentas en un iPhone SE", async ({ page }) => {
    await prepararSesion(page, conCuentas(new ApiFalsa()));
    await page.goto("/#cuentas");
    await expect(page.getByTestId("neto")).toBeVisible();
    await capturar(page, "cuentas-320", true);
    await page.goto("/#cuenta?id=cta-nu");
    await expect(page.getByTestId("deuda")).toBeVisible();
    await capturar(page, "tarjeta-320", true);
  });
});
