// Recorre la app contra un servidor de verdad (no la API falsa) para cuidar el contrato.
// Uso: API_REAL=http://127.0.0.1:8790 INVITACION=ABC123 bun run --cwd apps/web e2e servidor-real
// La invitación debe ser de un usuario que ya existe (bun run invitar -- --nombre Pedro).
import { expect, test } from "@playwright/test";

const API = process.env.API_REAL;
const CODIGO = process.env.INVITACION;

test.use({ baseURL: API });

test("entrar, registrar, editar, buscar y ajustes", async ({ page }) => {
  test.skip(!API || !CODIGO, "Solo con API_REAL e INVITACION");
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes("/v1/") && r.status() >= 500 && !r.url().includes("/v1/atajo")) errores.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(`/?codigo=${CODIGO}`);
  await expect(page.getByText("Agregar este dispositivo a la cuenta de")).toContainText("Pedro");
  await page.getByRole("button", { name: "Agregar dispositivo" }).click();
  await expect(page.getByRole("heading", { name: /\d{4}/ })).toBeVisible();

  // Alta desde el botón +.
  await page.getByRole("button", { name: "Agregar movimiento" }).click();
  const hoja = page.getByRole("dialog");
  await expect(hoja).toBeVisible();
  await hoja.locator("#monto").fill("123.45");
  await hoja.getByLabel("Comercio").fill("Tacos Prueba");
  await hoja.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(hoja).toBeHidden();

  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Movimientos" }).click();
  await expect(page.getByText("Tacos Prueba").first()).toBeVisible();
  await expect(page.getByText(/123\.45/).first()).toBeVisible();

  // Editar el monto.
  await page.getByText("Tacos Prueba").first().click();
  await expect(hoja).toBeVisible();
  await hoja.locator("#monto").fill("150");
  await hoja.getByRole("button", { name: "Guardar" }).click();
  await expect(hoja).toBeHidden();
  await expect(page.getByText(/150\.00/).first()).toBeVisible();

  // Buscar.
  await page.getByPlaceholder(/Buscar/).fill("tacos");
  await expect(page.getByText("Tacos Prueba").first()).toBeVisible();
  await page.getByPlaceholder(/Buscar/).fill("nada que coincida");
  await expect(page.getByText("Tacos Prueba")).toHaveCount(0);
  await page.getByPlaceholder(/Buscar/).fill("");

  // Inicio refleja el gasto.
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Inicio" }).click();
  await expect(page.getByText(/\$150\.00/).first()).toBeVisible();

  // Ajustes: la cuenta y el dispositivo.
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Ajustes" }).click();
  await expect(page.getByText("Pedro").first()).toBeVisible();
  await expect(page.getByText("Este dispositivo").first()).toBeVisible();

  expect(errores).toEqual([]);
});
