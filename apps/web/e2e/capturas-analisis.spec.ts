import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conHistorial } from "./api-falsa-analisis";

// Capturas de Análisis en claro y oscuro (390×844, y 320 de ancho). No validan nada más.
const DIR = "e2e/capturas/analisis";
mkdirSync(DIR, { recursive: true });

async function capturar(page: Page, nombre: string, completa = false) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/${nombre}.png`, fullPage: completa });
}

for (const esquema of ["light", "dark"] as const) {
  const sufijo = esquema === "light" ? "claro" : "oscuro";
  test.describe(`capturas de análisis ${sufijo}`, () => {
    test.use({ colorScheme: esquema });

    test(`análisis (${sufijo})`, async ({ page }) => {
      await prepararSesion(page, conHistorial(new ApiFalsa()));
      await page.goto("/#inicio");
      await expect(page.getByRole("button", { name: /^Análisis Tendencias/ })).toBeVisible();
      await capturar(page, `inicio-acceso-${sufijo}`);

      await page.goto("/#analisis");
      await expect(page.getByTestId("total-periodo")).toBeVisible();
      await capturar(page, `mes-${sufijo}`);
      await capturar(page, `mes-completa-${sufijo}`, true);

      await page.getByRole("radio", { name: "6M" }).click();
      await expect(page.getByTestId("titulo-periodo")).toHaveText("may – oct 2026");
      await capturar(page, `6m-${sufijo}`);
      await capturar(page, `6m-completa-${sufijo}`, true);

      await page.getByRole("radio", { name: "A" }).click();
      await expect(page.getByTestId("titulo-periodo")).toHaveText("nov 2025 – oct 2026");
      await capturar(page, `anio-completa-${sufijo}`, true);

      await page.getByRole("radio", { name: "S" }).click();
      await capturar(page, `semana-completa-${sufijo}`, true);

      await page.goto("/#analisis?categoria=cat-comida");
      await expect(page.getByTestId("total-periodo")).toBeVisible();
      await capturar(page, `filtro-comida-${sufijo}`, true);
    });
  });
}

test.describe("capturas de análisis a 320", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("análisis en un iPhone SE", async ({ page }) => {
    await prepararSesion(page, conHistorial(new ApiFalsa()));
    await page.goto("/#analisis?periodo=6m");
    await expect(page.getByTestId("total-periodo")).toBeVisible();
    await capturar(page, "6m-320", true);
  });
});
