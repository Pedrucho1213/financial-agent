import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas, cuentasComoPedro } from "./api-falsa-cuentas";
import { conDeudas } from "./api-falsa-deudas";

// Deudas y préstamos dentro de Cuentas: la sección, el alta a mano, el detalle, abonar, corregir y borrar.

const api = () => conDeudas(conCuentas(new ApiFalsa(), cuentasComoPedro()));
const tarjeta = (page: Page, persona: string) => page.getByRole("region", { name: "Deudas y préstamos" }).locator(`[data-deuda="${persona}"]`);

test("Cuentas muestra lo que debes, como una tarjeta más, y lo resta de lo que tienes", async ({ page }) => {
  await prepararSesion(page, api());
  await page.goto("/#cuentas");
  // Revolut 19,291 − Invex 19,818.88 − personas 52,733. Lo que le debe Juan no suma: aún no lo tiene.
  await expect(page.getByTestId("neto")).toHaveText("−$53,260.88");
  // Sin renglones de más: el subtítulo de siempre ya lo incluye y el detalle vive en su sección.
  await expect(page.getByTestId("con-personas")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Lo que tienes" })).toContainText("$19,291.00 en cuentas menos $72,551.88 que debes");
  await expect(page.getByTestId("total-deudas")).toContainText("Debes $52,733.00 en total.");
  await expect(tarjeta(page, "Mamá")).toContainText("$32,733.00");
  await expect(tarjeta(page, "Juan")).toHaveCount(0);
  // La saldada no está a la vista; vive en archivadas.
  await expect(tarjeta(page, "Caro")).toHaveCount(0);
  await page.getByRole("button", { name: "Ver archivadas" }).click();
  await expect(page.getByRole("region", { name: "Deudas saldadas" }).locator('[data-deuda="Caro"]')).toBeVisible();
});

test("agregar una deuda a mano con la cuenta a la que llegó", async ({ page }) => {
  const a = api();
  await prepararSesion(page, a);
  await page.goto("/#cuentas");
  await page.getByRole("button", { name: "Agregar deuda o préstamo" }).click();
  await page.locator("#monto-prestamo").fill("5000");
  // Desde Cuentas es lo que debes: no pregunta el sentido.
  await expect(page.getByRole("radiogroup", { name: "Quién debe" })).toHaveCount(0);
  await page.locator("#persona-prestamo").fill("Hugo");
  await page.getByRole("button", { name: "Revolut", exact: true }).click();
  await page.getByRole("button", { name: "Anotar" }).click();
  await expect(page.getByText("Anoté que le debes $5,000.00 a Hugo")).toBeVisible();
  await expect(tarjeta(page, "Hugo")).toContainText("$5,000.00");
  const nuevo = a.deudas!.prestamos.find((p) => p.persona === "Hugo");
  expect(nuevo).toMatchObject({ direccion: "debo", montoCentavos: 5_000_00, cuenta: "Revolut" });
});

test("el detalle deja abonar, corregir y borrar con deshacer", async ({ page }) => {
  await prepararSesion(page, api());
  await page.goto("/#cuentas");
  await tarjeta(page, "Mamá").click();
  await expect(page).toHaveURL(/#deuda\?persona=Mam%C3%A1&dir=debo/);
  await expect(page.getByTestId("falta")).toHaveText("$32,733.00");
  await expect(page.getByTestId("pagado")).toHaveText("15%");

  // Abono: dice en cuánto queda y no deja pasarse.
  await page.getByRole("button", { name: "Registrar abono" }).click();
  await page.locator("#monto-abono").fill("40000");
  await expect(page.getByTestId("queda")).toContainText("Es más de lo que falta");
  await expect(page.getByRole("button", { name: "Anotar" })).toBeDisabled();
  await page.locator("#monto-abono").fill("2733");
  await expect(page.getByTestId("queda")).toHaveText("Quedará en $30,000.00");
  await page.getByRole("button", { name: "Anotar" }).click();
  await expect(page.getByTestId("falta")).toHaveText("$30,000.00");

  // Corregir lo que falta ajusta el total, sin abonar.
  await page.getByRole("button", { name: "Editar deuda" }).click();
  await page.locator("#falta-deuda").fill("25000");
  await expect(page.locator("#total-deuda")).toHaveValue("33733");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("falta")).toHaveText("$25,000.00");

  // Cambiar el nombre lleva a su nueva dirección.
  await page.getByRole("button", { name: "Editar deuda" }).click();
  await page.locator("#nombre-deuda").fill("Mamá Lupe");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page).toHaveURL(/persona=Mam%C3%A1\+Lupe/);
  await expect(page.getByRole("heading", { name: "Mamá Lupe" })).toBeVisible();

  // Borrar pregunta, regresa y ofrece deshacer.
  await page.getByRole("button", { name: "Borrar deuda" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page).toHaveURL(/#cuentas/);
  await expect(tarjeta(page, "Mamá Lupe")).toHaveCount(0);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(tarjeta(page, "Mamá Lupe")).toBeVisible();
});

test("lo que te deben sigue en Plan y se cobra con «Registrar pago»", async ({ page }) => {
  await prepararSesion(page, api());
  await page.goto("/#plan");
  await page.getByRole("button", { name: /^Juan/ }).click();
  await expect(page).toHaveURL(/#deuda\?persona=Juan&dir=me_deben/);
  await expect(page.getByText("Te debe", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Registrar pago" }).click();
  await page.getByRole("button", { name: /^Todo/ }).click();
  await expect(page.getByTestId("queda")).toHaveText("Con esto queda saldada");
  await page.getByRole("button", { name: "Anotar" }).click();
  await expect(page.getByTestId("falta")).toHaveText("$0.00");
  await expect(page.getByRole("button", { name: "Registrar pago" })).toBeDisabled();
});

test("Plan lleva al mismo detalle", async ({ page }) => {
  await prepararSesion(page, api());
  await page.goto("/#plan");
  await page.getByRole("button", { name: /^Milton Ventura/ }).click();
  await expect(page).toHaveURL(/#deuda\?persona=Milton\+Ventura&dir=debo/);
  await expect(page.getByTestId("falta")).toHaveText("$20,000.00");
});

test("con la edición apagada solo se ven, sin agregar ni abonar", async ({ page }) => {
  const a = api();
  a.deudas!.edicion = false;
  await prepararSesion(page, a);
  await page.goto("/#cuentas");
  await expect(tarjeta(page, "Mamá")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar deuda o préstamo" })).toHaveCount(0);
  // Sin `totales.personas`, lo que tienes queda como antes: cuentas menos tarjetas.
  await expect(page.getByTestId("neto")).toHaveText("−$527.88");
  await tarjeta(page, "Mamá").click();
  await expect(page.getByTestId("falta")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar abono" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar deuda" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Borrar deuda" })).toHaveCount(0);
});
