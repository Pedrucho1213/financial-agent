import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas, cuentasComoPedro } from "./api-falsa-cuentas";
import { conDeudas } from "./api-falsa-deudas";

// Capturas de deudas y préstamos en claro, oscuro y a 320 px. No validan nada más.
const DIR = "e2e/capturas/deudas";
mkdirSync(DIR, { recursive: true });

async function capturar(page: Page, nombre: string, completa = false) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/${nombre}.png`, fullPage: completa });
}

const api = () => conDeudas(conCuentas(new ApiFalsa(), cuentasComoPedro()));

for (const [esquema, sufijo] of [
  ["light", "claro"],
  ["dark", "oscuro"],
] as const) {
  test.describe(`capturas de deudas ${sufijo}`, () => {
    test.use({ colorScheme: esquema });

    test(`cuentas y detalle (${sufijo})`, async ({ page }) => {
      await prepararSesion(page, api());
      await page.goto("/#cuentas");
      await expect(page.getByTestId("total-deudas")).toBeVisible();
      await capturar(page, `cuentas-${sufijo}`, true);

      await page.getByRole("button", { name: /^Mamá/ }).click();
      await expect(page.getByTestId("falta")).toBeVisible();
      await capturar(page, `mama-${sufijo}`, true);

      await page.getByRole("button", { name: "Registrar abono" }).click();
      await page.locator("#monto-abono").fill("2000");
      await capturar(page, `abono-${sufijo}`);
      await page.getByRole("button", { name: "Cancelar" }).click();

      await page.getByRole("button", { name: "Editar deuda" }).click();
      await page.waitForTimeout(500);
      await capturar(page, `editar-deuda-${sufijo}`);
      await page.getByRole("button", { name: "Cancelar" }).click();

      await page.getByRole("button", { name: "Borrar deuda" }).click();
      await capturar(page, `borrar-${sufijo}`);
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();

      await page.getByRole("button", { name: "Me prestó más" }).click();
      await page.locator("#monto-prestamo").fill("1500");
      await capturar(page, `mas-${sufijo}`);
    });

    test(`agregar y te deben (${sufijo})`, async ({ page }) => {
      await prepararSesion(page, api());
      await page.goto("/#cuentas");
      await page.getByRole("button", { name: "Agregar deuda o préstamo" }).click();
      await page.locator("#monto-prestamo").fill("5000");
      await capturar(page, `nuevo-${sufijo}`);
      await page.getByRole("button", { name: "Cancelar" }).click();

      await page.goto("/#deuda?persona=Juan&dir=me_deben");
      await expect(page.getByTestId("falta")).toBeVisible();
      await capturar(page, `juan-${sufijo}`, true);

      await page.goto("/#cuentas?archivadas=1");
      await expect(page.getByRole("region", { name: "Deudas saldadas" })).toBeVisible();
      await page.getByRole("region", { name: "Deudas saldadas" }).scrollIntoViewIfNeeded();
      await capturar(page, `saldadas-${sufijo}`);
    });
  });
}

test.describe("capturas de deudas a 320", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("en un iPhone SE", async ({ page }) => {
    await prepararSesion(page, api());
    await page.goto("/#cuentas");
    await expect(page.getByTestId("total-deudas")).toBeVisible();
    await capturar(page, "cuentas-320", true);
    await page.getByRole("button", { name: /^Milton/ }).click();
    await expect(page.getByTestId("falta")).toBeVisible();
    await capturar(page, "milton-320", true);
    await page.goto("/#deuda?persona=Mam%C3%A1&dir=debo");
    await expect(page.getByTestId("falta")).toBeVisible();
    await capturar(page, "mama-320", true);
    await page.getByRole("button", { name: "Registrar abono" }).click();
    await page.locator("#monto-abono").fill("40000");
    await capturar(page, "abono-320");
    await page.getByRole("button", { name: "Cancelar" }).click();
    await page.goto("/#cuentas");
    await page.getByRole("button", { name: "Agregar deuda o préstamo" }).click();
    await capturar(page, "nuevo-320");
  });
});
