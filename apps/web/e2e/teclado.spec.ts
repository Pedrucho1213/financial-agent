import { expect, type Page, test } from "@playwright/test";
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

// En iOS el teclado no encoge 100dvh: solo la vista visible (visualViewport). La hoja tiene que caber ahí,
// encima del teclado, con «Cancelar» y «Guardar» a la vista (antes el teclado la empujaba hacia arriba).
test("con el teclado abierto la hoja cabe encima de él y se ven sus botones", async ({ page }) => {
  await page.addInitScript(() => {
    const falsa = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
    Object.defineProperty(window, "visualViewport", { value: falsa, configurable: true });
    (window as unknown as { tecladoFalso: (alto: number) => void }).tecladoFalso = (alto: number) => {
      falsa.height = 844 - alto;
      falsa.dispatchEvent(new Event("resize"));
    };
  });
  await prepararSesion(page);
  await page.goto("/#movimientos");
  await page.getByRole("button", { name: "Agregar movimiento" }).click();
  const hoja = page.getByRole("dialog");
  await hoja.getByLabel("Comercio").focus();
  await page.evaluate(() => (window as unknown as { tecladoFalso: (alto: number) => void }).tecladoFalso(380));

  await expect.poll(async () => Math.round((await hoja.boundingBox())!.y + (await hoja.boundingBox())!.height)).toBe(464);
  expect((await hoja.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await expect(hoja.getByRole("button", { name: "Cancelar" })).toBeInViewport();
  await expect(hoja.getByLabel("Comercio")).toBeInViewport();

  // Al cerrar el teclado vuelve a su lugar.
  await page.evaluate(() => (window as unknown as { tecladoFalso: (alto: number) => void }).tecladoFalso(0));
  await expect.poll(async () => Math.round((await hoja.boundingBox())!.y + (await hoja.boundingBox())!.height)).toBe(844);
});

test("la hoja se cierra arrastrándola hacia abajo desde arriba", async ({ page }) => {
  await prepararSesion(page);
  await page.goto("/#movimientos");
  await page.getByRole("button", { name: "Agregar movimiento" }).click();
  const hoja = page.getByRole("dialog");
  await expect(hoja).toBeVisible();
  await page.waitForTimeout(500);
  await hoja.locator("[data-agarradera]").evaluate((el) => {
    const toque = (y: number) => [new Touch({ identifier: 1, target: el, clientX: 195, clientY: y })];
    const enviar = (tipo: string, y: number) =>
      el.dispatchEvent(new TouchEvent(tipo, { bubbles: true, cancelable: true, touches: tipo === "touchend" ? [] : toque(y), changedTouches: toque(y) }));
    enviar("touchstart", 60);
    for (let y = 80; y <= 360; y += 40) enviar("touchmove", y);
    enviar("touchend", 360);
  });
  await expect(hoja).toBeHidden();
});

// En la app instalada de iOS, a veces la ventana se queda corta al cerrar el teclado: la barra de abajo flotaba con una
// franja negra debajo (que queda fuera de la ventana, ahí no se puede pintar). Se simula esa ventana corta y se revisa
// que la app le pida a WebKit volver a medirla: esconde la app y la vuelve a mostrar al instante, sin perder el scroll.
async function ventanaCorta(page: Page, instalada: boolean) {
  await page.addInitScript((instalada) => {
    const w = window as unknown as { __recorte: number; __vueltas: number };
    w.__recorte = 0;
    w.__vueltas = 0;
    if (instalada) {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        q.includes("display-mode: standalone") ? ({ ...original(q), matches: true, media: q } as MediaQueryList) : original(q);
    }
    const alto = Object.getOwnPropertyDescriptor(window, "innerHeight") ?? Object.getOwnPropertyDescriptor(Window.prototype, "innerHeight");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      get: () => (alto?.get?.call(window) as number) - w.__recorte,
    });
    // Cuenta las veces que la app se esconde para que WebKit vuelva a medir (y la ventana "se compone").
    new MutationObserver((cambios) => {
      for (const c of cambios) {
        if ((c.target as HTMLElement).id === "root" && c.oldValue?.includes("display: none")) {
          w.__vueltas++;
          w.__recorte = 0;
        }
      }
    }).observe(document, { attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ["style"] });
  }, instalada);
}

test("si iOS deja la ventana corta al cerrar el teclado, la app le pide volver a medirla", async ({ page }) => {
  await ventanaCorta(page, true);
  await prepararSesion(page);
  await page.goto("/#chat");
  const barra = page.getByRole("navigation", { name: "Secciones" });
  const caja = page.getByLabel("Mensaje");
  await expect(barra).toBeInViewport();

  await caja.focus();
  await caja.fill("Hola");
  await page.evaluate(() => {
    (window as unknown as { __recorte: number }).__recorte = 62;
  });
  await caja.blur();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __vueltas: number }).__vueltas)).toBe(1);
  await expect(barra).toBeInViewport();
  await expect(caja).toHaveValue("Hola");

  // Con la ventana completa no hace nada.
  await caja.focus();
  await caja.blur();
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => (window as unknown as { __vueltas: number }).__vueltas)).toBe(1);
});

test("fuera de la app instalada (Safari con sus barras) no se toca la ventana", async ({ page }) => {
  await ventanaCorta(page, false);
  await prepararSesion(page);
  await page.goto("/#chat");
  const caja = page.getByLabel("Mensaje");
  await caja.focus();
  await page.evaluate(() => {
    (window as unknown as { __recorte: number }).__recorte = 62;
  });
  await caja.blur();
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => (window as unknown as { __vueltas: number }).__vueltas)).toBe(0);
});
