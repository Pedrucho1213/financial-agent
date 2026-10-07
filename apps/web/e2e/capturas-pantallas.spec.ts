import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { prepararSesion } from "./api-falsa";

// Capturas de presupuestos y metas, el mapa y el detalle, en claro y oscuro. No validan nada más.
const DIR = "e2e/capturas";
mkdirSync(DIR, { recursive: true });

async function capturar(page: Page, nombre: string) {
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${DIR}/${nombre}.png` });
}

for (const esquema of ["light", "dark"] as const) {
  const sufijo = esquema === "light" ? "claro" : "oscuro";
  test(`plan, mapa y detalle (${sufijo})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: esquema });
    await prepararSesion(page);

    await page.goto("/#inicio");
    await expect(page.getByRole("region", { name: "Avisos" })).toBeVisible();
    await capturar(page, `inicio-avisos-${sufijo}`);
    await page.getByRole("button", { name: /Presupuestos y metas/ }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await capturar(page, `inicio-accesos-${sufijo}`);

    await page.goto("/#plan");
    await expect(page.getByRole("region", { name: "Resumen del plan" })).toBeVisible();
    await capturar(page, `plan-${sufijo}`);
    await page.evaluate(() => window.scrollTo(0, 700));
    await capturar(page, `plan-metas-${sufijo}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await capturar(page, `plan-final-${sufijo}`);
    await page.getByRole("button", { name: /^Viaje a Japón/ }).click();
    await capturar(page, `plan-hoja-meta-${sufijo}`);
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

    await page.goto("/#mapa");
    await expect(page.locator(".fa-lugar")).toHaveCount(5);
    await capturar(page, `mapa-${sufijo}`);
    await page.getByRole("button").filter({ hasText: /veces|vez/ }).first().click();
    await capturar(page, `mapa-elegido-${sufijo}`);
    await page.getByRole("button", { name: "Cerrar" }).click();
    await page.evaluate(() => window.scrollTo(0, 400));
    await capturar(page, `mapa-lista-${sufijo}`);

    await page.goto("/#movimientos?detalle=mov-001");
    await expect(page.getByRole("heading", { name: "Starbucks" })).toBeVisible();
    await capturar(page, `detalle-${sufijo}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await capturar(page, `detalle-final-${sufijo}`);
  });
}
