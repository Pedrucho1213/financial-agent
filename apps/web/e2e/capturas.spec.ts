import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";

// Capturas para revisar el diseño en claro y oscuro (390×844). No validan nada más.
const DIR = "e2e/capturas";
mkdirSync(DIR, { recursive: true });

async function capturar(page: Page, nombre: string) {
  // Deja terminar animaciones (números, gráficas, hojas).
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/${nombre}.png` });
}

for (const esquema of ["light", "dark"] as const) {
  const sufijo = esquema === "light" ? "claro" : "oscuro";
  test.describe(`capturas ${sufijo}`, () => {
    test.use({ colorScheme: esquema });

    test(`pantallas (${sufijo})`, async ({ page }) => {
      const api = new ApiFalsa();
      api.hablar = [
        200,
        {
          respuesta: "Anoté $85.00 en Café, en Starbucks. ¿Algo más?",
          conversacion_id: "conv-1",
          acciones: [{ herramienta: "registrar_movimientos", argumentos: {}, resultado: { registrados: [{}] } }],
        },
      ];
      await prepararSesion(page, api);

      await page.goto("/#inicio");
      await expect(page.getByRole("heading", { name: /Octubre/ })).toBeVisible();
      await expect(page.locator("[data-grafica] svg").first()).toBeVisible();
      await capturar(page, `inicio-${sufijo}`);
      await page.evaluate(() => window.scrollTo(0, 820));
      await capturar(page, `inicio-graficas-${sufijo}`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await capturar(page, `inicio-listas-${sufijo}`);

      await page.goto("/#movimientos");
      await expect(page.getByText("Starbucks").first()).toBeVisible();
      await capturar(page, `movimientos-${sufijo}`);

      // Fila deslizada a medias (muestra Eliminar).
      const fila = page.getByRole("button", { name: /^Uber/ });
      const caja = await fila.boundingBox();
      if (caja) {
        const cdp = await page.context().newCDPSession(page);
        const y = caja.y + caja.height / 2;
        const tocar = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
          cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
        await tocar("touchStart", caja.x + caja.width - 30);
        for (let i = 1; i <= 8; i++) await tocar("touchMove", caja.x + caja.width - 30 - i * 15);
        await tocar("touchEnd", 0);
        await capturar(page, `deslizar-${sufijo}`);
        await fila.locator("xpath=..").locator("button", { hasText: "Eliminar" }).click();
        await expect(page.locator("[data-sonner-toast]")).toBeVisible();
        await capturar(page, `aviso-${sufijo}`);
      }

      await page.getByText("Starbucks").first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capturar(page, `editar-${sufijo}`);
      await page.getByRole("button", { name: "Cancelar" }).click();

      await page.getByRole("button", { name: "Agregar movimiento" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.locator("#monto").fill("249.90");
      await capturar(page, `nuevo-${sufijo}`);
      await page.getByRole("button", { name: "Cancelar" }).click();

      await page.goto("/#chat");
      await capturar(page, `chat-vacio-${sufijo}`);
      await page.getByLabel("Mensaje").fill("Gasté 85 en café en el Starbucks");
      await page.getByRole("button", { name: "Enviar" }).click();
      await expect(page.getByText("Anoté $85.00")).toBeVisible();
      await capturar(page, `chat-${sufijo}`);
      api.fallasHablar = ["ia"];
      await page.getByLabel("Mensaje").fill("¿Cuánto llevo en súper?");
      await page.getByRole("button", { name: "Enviar" }).click();
      await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
      await capturar(page, `chat-reintentar-${sufijo}`);

      await page.goto("/#ajustes");
      await expect(page.getByText("Pedro Ramírez")).toBeVisible();
      await capturar(page, `ajustes-${sufijo}`);
      await page.getByRole("button", { name: /Agregar otro dispositivo/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capturar(page, `invitacion-${sufijo}`);
    });

    test(`instalar (${sufijo})`, async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
      await new ApiFalsa().instalar(page);
      await page.goto("/instalar?codigo=DEV456");
      await expect(page.getByText("Hola, Pedro.")).toBeVisible();
      await capturar(page, `instalar-${sufijo}`);
      const descarga = page.waitForEvent("download");
      await page.getByRole("button", { name: "Instalar el Atajo" }).click();
      await descarga;
      await expect(page.getByText("Ya casi está")).toBeVisible();
      await capturar(page, `instalar-listo-${sufijo}`);
    });

    test(`atajo en ajustes (${sufijo})`, async ({ page }) => {
      await prepararSesion(page);
      await page.goto("/#ajustes");
      const descarga = page.waitForEvent("download");
      await page.getByRole("button", { name: /Instalar el Atajo/ }).click();
      await descarga;
      await expect(page.getByRole("dialog", { name: "Instalar el Atajo" })).toBeVisible();
      await capturar(page, `atajo-ajustes-${sufijo}`);
    });

    test(`entrar (${sufijo})`, async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
      await new ApiFalsa().instalar(page);
      await page.goto("/?codigo=ABC123");
      await expect(page.getByRole("heading", { name: /Instala Finanzas/ })).toBeVisible();
      await capturar(page, `entrar-instalar-${sufijo}`);
      await page.getByRole("button", { name: "Usar en Safari" }).click();
      await expect(page.getByLabel("Tu nombre")).toBeVisible();
      await page.getByLabel("Tu nombre").fill("Pedro");
      await capturar(page, `entrar-${sufijo}`);
    });
  });
}
