import { mkdirSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas } from "./api-falsa-cuentas";

// #salud y su tarjeta en Inicio contra la API falsa. Las respuestas de salud-falsa.json salen del servidor real
// (finanzas/salud.ts) con los escenarios de su prueba: la base de Pedro sin ingresos, con su sueldo, y unas
// finanzas sanas con meta (Optimizando).

const FIXTURA = JSON.parse(readFileSync(new URL("./salud-falsa.json", import.meta.url), "utf8")) as Record<"sinIngreso" | "conIngreso" | "optimizando", object>;

const abrir = async (page: Page, hash: string, salud: object | null) => {
  const api = conCuentas(new ApiFalsa());
  api.salud = salud;
  await prepararSesion(page, api);
  await page.goto(`/${hash}`);
  return api;
};
const tarjeta = (page: Page) => page.getByRole("button", { name: /^Salud financiera/ });

test("una cuenta sin el módulo no ve nada nuevo en Inicio", async ({ page }) => {
  await abrir(page, "#inicio", null);
  await expect(page.getByRole("button", { name: /^Cuentas y tarjetas/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Análisis/ })).toBeVisible();
  await expect(tarjeta(page)).toHaveCount(0);
});

test("Inicio: la tarjeta dice el nivel y la alerta, y abre la página", async ({ page }) => {
  await abrir(page, "#inicio", FIXTURA.sinIngreso);
  await expect(tarjeta(page)).toContainText("Sobregirado · Revolut crédito al 91%");
  await tarjeta(page).click();
  await expect(page).toHaveURL(/#salud$/);
  await expect(page.getByTestId("titulo-salud")).toHaveText("Sobregirado");
});

test("sin ingresos: Sobregirado por la tarjeta, sin calificación, y dice qué falta", async ({ page }) => {
  await abrir(page, "#salud", FIXTURA.sinIngreso);
  await expect(page.getByTestId("titulo-salud")).toHaveText("Sobregirado");
  await expect(page.getByTestId("resumen-salud")).toHaveText("Por esto: Revolut crédito va al 91% de su límite.");
  await expect(page.getByTestId("aguja")).toHaveCount(0);
  await expect(page.locator("[data-alerta]")).toHaveText(["Revolut crédito va al 91% de su límite."]);
  await expect(page.locator("[data-falta]")).toContainText(["No tengo ingresos tuyos"]);
  await expect(page.locator("[data-pilar]")).toHaveCount(5);
  await expect(page.locator('[data-pilar="margen"]')).toContainText("Sin datos");
  await expect(page.locator('[data-pilar="deuda"]')).toContainText("66% de uso");
  // Al tocar un pilar sale cómo subirlo.
  await page.locator('[data-pilar="deuda"] button').click();
  await expect(page.locator('[data-pilar="deuda"]')).toContainText("Baja Revolut crédito de 91% a menos de 70%: son $7,150.");
  await expect(page.locator("[data-consejo]").first()).toContainText("Abónale unos $7,150 a Revolut crédito");
  await expect(page.locator("[data-consejo]").nth(1)).toContainText("Ahorras unos $1,140 al mes");
  await expect(page.locator("[data-mexico]")).toHaveCount(2);
  await expect(page.locator('[data-mexico="comer_fuera"]')).toContainText("12 veces lo de una persona promedio");
  await expect(page.locator('[data-mexico="ingreso"]')).toHaveCount(0);
  await expect(page.locator('[data-rubro="alimentos"]')).toContainText("Tú 52% · México 38%");
  await expect(page.getByText("Con 8 días de registros: se irá afinando.")).toBeVisible();
  await expect(page.locator("[data-curiosidad]")).toHaveCount(4);
  await expect(page.locator('[data-curiosidad="comer_fuera_dias"]')).toContainText("16 días");
  await expect(page.locator('[data-curiosidad="mas_grande"]')).toContainText("Tu gasto más grande de estos 8 días fue $900 en Gasolina, el 8 de octubre.");
  await expect(page.getByText("no asesoría financiera")).toBeVisible();
});

test("con su sueldo: calificación, aguja y su lugar en México", async ({ page }) => {
  await abrir(page, "#salud", FIXTURA.conIngreso);
  await expect(page.getByTestId("titulo-salud")).toHaveText("Sobregirado");
  await expect(page.getByTestId("resumen-salud")).toContainText("Sin eso estarías en Excelente, con 74 de 100.");
  await expect(page.getByTestId("aguja")).toBeVisible();
  await expect(page.locator('[data-mexico="ingreso"]')).toContainText("decil X");
  await expect(page.locator('[data-mexico="pobreza"]')).toContainText("21 veces");
  await expect(page.locator("[data-falta]")).toHaveCount(0);
  await expect(page.getByRole("meter", { name: "Margen: 100" })).toBeVisible();
});

test("finanzas sanas con meta: Optimizando, sin alertas", async ({ page }) => {
  await abrir(page, "#salud", FIXTURA.optimizando);
  await expect(page.getByTestId("titulo-salud")).toHaveText("Optimizando");
  await expect(page.locator("[data-alerta]")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /^Salud financiera: Optimizando, \d+ de 100$/ })).toBeVisible();
  await expect(page.getByText(/^\d+ de 100$/)).toBeVisible();
});

test("la página no se pasa de ancho en un teléfono de 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await abrir(page, "#salud", FIXTURA.conIngreso);
  await expect(page.getByTestId("titulo-salud")).toBeVisible();
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(ancho).toBeLessThanOrEqual(320);
});

test("un servidor sin datos curiosos no rompe la página", async ({ page }) => {
  const { curiosidades: _, ...viejo } = FIXTURA.sinIngreso as Record<string, unknown>;
  await abrir(page, "#salud", viejo);
  await expect(page.getByTestId("titulo-salud")).toHaveText("Sobregirado");
  await expect(page.locator("[data-curiosidad]")).toHaveCount(0);
});

test("si el servidor ya no la da (404), la página lo dice", async ({ page }) => {
  await abrir(page, "#salud", null);
  await expect(page.getByText("Esta sección todavía no está abierta para tu cuenta.")).toBeVisible();
});

// Capturas en claro y oscuro para revisarlas a ojo (cada una en su propia página: el caché guardado no se cruza).
const DIR = "e2e/capturas/salud";
mkdirSync(DIR, { recursive: true });
for (const esquema of ["light", "dark"] as const) {
  const sufijo = esquema === "light" ? "claro" : "oscuro";
  test.describe(`capturas de salud ${sufijo}`, () => {
    test.use({ colorScheme: esquema });
    test(`inicio (${sufijo})`, async ({ page }) => {
      await abrir(page, "#inicio", FIXTURA.sinIngreso);
      await expect(tarjeta(page)).toBeVisible();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${DIR}/inicio-${sufijo}.png`, fullPage: true });
    });
    for (const [nombre, datos] of Object.entries(FIXTURA)) {
      test(`${nombre} (${sufijo})`, async ({ page }) => {
        await abrir(page, "#salud", datos);
        await expect(page.getByTestId("titulo-salud")).toBeVisible();
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${DIR}/${nombre}-${sufijo}.png`, fullPage: true });
      });
    }
  });
}
