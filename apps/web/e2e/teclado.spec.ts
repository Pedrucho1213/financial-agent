import { expect, test } from "@playwright/test";
import { prepararSesion } from "./api-falsa";

// En la app instalada de iOS 26+ el teclado encoge toda la página, así que no se nota en el alto de la vista:
// lo que dice que está abierto es un campo de texto con el foco. Con él, la barra de abajo se esconde.
test("con un campo de texto con foco la barra de abajo se esconde y vuelve al salir", async ({ page }) => {
  await prepararSesion(page);
  await page.goto("/#chat");
  const barra = page.getByRole("navigation", { name: "Secciones" });
  await expect(barra).toBeInViewport();

  await page.getByLabel("Mensaje").focus();
  await expect(barra).not.toBeInViewport();
  // La caja de escribir baja a donde estaba la barra (encima del teclado).
  const caja = page.getByLabel("Mensaje");
  await expect.poll(async () => 844 - ((await caja.boundingBox())?.y ?? 0) - ((await caja.boundingBox())?.height ?? 0)).toBeLessThan(30);

  await page.getByLabel("Mensaje").blur();
  await expect(barra).toBeInViewport();

  // También en otras pantallas (el buscador de Movimientos).
  await page.goto("/#movimientos");
  await expect(barra).toBeInViewport();
  await page.getByRole("searchbox").first().focus();
  await expect(barra).not.toBeInViewport();
  await page.getByRole("searchbox").first().blur();
  await expect(barra).toBeInViewport();
});
