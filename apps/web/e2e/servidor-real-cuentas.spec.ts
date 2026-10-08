// Cuentas, tarjetas, mover dinero y etiquetas contra un servidor de verdad, para cuidar el contrato.
// Uso: API_REAL=http://127.0.0.1:8790 INVITACION=ABC123 bun run --cwd apps/web e2e servidor-real-cuentas
// La invitación debe ser de un usuario que ya existe y sin cuentas (bun run invitar -- --nombre Pedro --nueva).
import { expect, test } from "@playwright/test";

const API = process.env.API_REAL;
const CODIGO = process.env.INVITACION;

test.use({ baseURL: API });

test("cuentas, tarjeta, pago, etiqueta y un gasto que mueve el saldo", async ({ page }) => {
  test.skip(!API || !CODIGO, "Solo con API_REAL e INVITACION");
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes("/v1/") && r.status() >= 500) errores.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(`/?codigo=${CODIGO}`);
  await page.getByRole("button", { name: "Usar en Safari" }).click();
  await page.getByRole("button", { name: "Agregar dispositivo" }).click();
  await expect(page.getByRole("heading", { name: /\d{4}/ })).toBeVisible();

  await page.goto("/#cuentas");
  await expect(page.getByText("Todavía no tienes cuentas")).toBeVisible();
  await page.getByRole("button", { name: "Agregar cuenta" }).click();
  const hoja = page.getByRole("dialog");
  await hoja.getByLabel("Nombre").fill("BBVA");
  await hoja.getByLabel("Tienes").fill("20000");
  await hoja.getByRole("button", { name: "Agregar" }).click();
  await expect(hoja).toBeHidden();
  await expect(page.getByTestId("neto")).toHaveText("$20,000.00");

  await page.getByRole("button", { name: "Agregar cuenta o tarjeta" }).click();
  await hoja.getByLabel("Nombre").fill("Nu");
  await hoja.getByRole("radio", { name: "Crédito" }).click();
  await hoja.getByLabel("Debes").fill("3000");
  await hoja.getByLabel("Límite", { exact: true }).fill("30000");
  await hoja.getByLabel("Día límite de pago").selectOption("15");
  await hoja.getByRole("button", { name: "Agregar" }).click();
  await expect(hoja).toBeHidden();
  await expect(page.getByTestId("neto")).toHaveText("$17,000.00");
  await expect(page.locator('[data-cuenta="Nu"]')).toContainText("$27,000 disponible");

  // Pagar la tarjeta desde su pantalla.
  await page.locator('[data-cuenta="Nu"]').click();
  await expect(page.getByTestId("uso")).toHaveText("10%");
  await page.getByRole("button", { name: "Pagar o abonar" }).click();
  await hoja.locator("#monto-mover").fill("1000");
  await hoja.getByLabel("Desde").selectOption({ label: "BBVA ($20,000.00)" });
  await hoja.getByRole("button", { name: "Listo" }).click();
  await expect(hoja).toBeHidden();
  await expect(page.getByText("Pago anotado")).toBeVisible();
  await expect(page.getByTestId("deuda")).toHaveText("$2,000.00");
  await expect(page.getByRole("region", { name: "Recientes" })).toContainText("desde BBVA");

  // Una etiqueta y un gasto con ella, pagado con BBVA.
  await page.goto("/#etiquetas");
  await page.getByRole("button", { name: "Nueva etiqueta" }).click();
  await hoja.getByLabel("Nombre").fill("viaje");
  await hoja.getByRole("button", { name: "Crear" }).click();
  await expect(hoja).toBeHidden();
  await expect(page.locator('[data-etiqueta="Viaje"]')).toBeVisible();

  await page.goto("/#movimientos");
  await page.getByRole("button", { name: "Agregar" }).first().click();
  await hoja.locator("#monto").fill("250");
  await hoja.getByLabel("Comercio").fill("Tlayudas");
  await hoja.getByLabel("Cuenta").fill("BBVA");
  await hoja.getByRole("button", { name: "#Viaje" }).click();
  await hoja.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(hoja).toBeHidden();
  await expect(page.locator("[data-movimiento]").filter({ hasText: "Tlayudas" })).toContainText("#Viaje");

  await page.goto("/#cuentas");
  await expect(page.locator('[data-cuenta="BBVA"]')).toContainText("$18,750.00");
  await expect(page.getByTestId("neto")).toHaveText("$16,750.00");

  await page.goto("/#etiquetas");
  await expect(page.locator('[data-etiqueta="Viaje"]')).toContainText("$250.00");
  await page.goto("/#analisis");
  await expect(page.getByRole("region", { name: "Por etiqueta" })).toContainText("$250.00");

  // Los movimientos de BBVA: el gasto y el pago.
  await page.goto("/#cuentas");
  await page.locator('[data-cuenta="BBVA"]').click();
  await page.getByRole("button", { name: /^Movimientos/ }).first().click();
  await expect(page.getByText("2 movimientos")).toBeVisible();

  expect(errores).toEqual([]);
});
