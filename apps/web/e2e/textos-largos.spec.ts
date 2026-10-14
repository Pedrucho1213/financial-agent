import { expect, type Locator, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas, cuentasIniciales } from "./api-falsa-cuentas";

// Nombres y montos largos en pantallas de 320 px: el título, el subtítulo y el monto no se enciman.
async function sinEncimar(filas: Locator) {
  for (const fila of await filas.all()) {
    const [titulo, subtitulo, monto] = await fila.locator(".grid > div").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    expect(titulo!.right).toBeLessThanOrEqual(monto!.left);
    expect(subtitulo!.top).toBeGreaterThanOrEqual(Math.max(titulo!.bottom, monto!.bottom) - 1);
  }
}

async function abrir(page: Page) {
  await page.setViewportSize({ width: 320, height: 700 });
  const datos = cuentasIniciales();
  datos.etiquetas[0]!.nombre = "Viaje familiar a Oaxaca y Puerto Escondido";
  const api = conCuentas(new ApiFalsa(), datos);
  for (const m of api.movimientos.filter((x) => x.comercio === "Pemex")) {
    m.comercio = "Gasolinera Servicio Insurgentes Sur Esquina Félix Cuevas";
    m.montoCentavos = 123_456_78;
  }
  await prepararSesion(page, api);
}

test("Dónde gastas a 320 px con un comercio largo y un monto grande", async ({ page }) => {
  await abrir(page);
  await page.goto("/#mapa");
  const filas = page.getByRole("button").filter({ hasText: /veces|vez/ });
  await expect(filas).toHaveCount(5);
  await expect(filas.first()).toContainText("$123,456.78");
  await sinEncimar(filas);
  // La barra de abajo entra con una animación; ya quieta, nada se sale de la pantalla.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("Etiquetas a 320 px con un nombre largo y un monto grande", async ({ page }) => {
  await abrir(page);
  await page.goto("/#etiquetas");
  const filas = page.locator("[data-etiqueta]").filter({ hasText: "$" });
  await expect(filas).toHaveCount(2);
  await sinEncimar(filas);
  // La barra de abajo entra con una animación; ya quieta, nada se sale de la pantalla.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
