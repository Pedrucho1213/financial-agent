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

// En la app instalada de iOS 26+, a veces la vista no regresa a su alto completo al cerrar el teclado: la barra de
// abajo y la caja de escribir se quedaban flotando con un hueco debajo. Aquí se simula esa vista corta.
test("si iOS deja la vista corta al cerrar el teclado, la barra y la caja bajan a su lugar", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q: string) =>
      q.includes("display-mode: standalone") ? ({ ...original(q), matches: true, media: q } as MediaQueryList) : original(q);
    const w = window as unknown as { __recorte: number };
    w.__recorte = 0;
    const alto = Object.getOwnPropertyDescriptor(VisualViewport.prototype, "height");
    Object.defineProperty(VisualViewport.prototype, "height", {
      get(this: VisualViewport) {
        return (alto?.get?.call(this) as number) - w.__recorte;
      },
    });
  });
  await prepararSesion(page);
  await page.goto("/#chat");
  const barra = page.getByRole("navigation", { name: "Secciones" });
  const caja = page.getByLabel("Mensaje");
  await expect(barra).toBeInViewport();
  const abajo = async (l: typeof barra) => {
    const b = await l.boundingBox();
    return (b?.y ?? 0) + (b?.height ?? 0);
  };
  const barraAntes = await abajo(barra);
  const cajaAntes = await abajo(caja);

  await caja.fill("Hola");
  await caja.blur();
  // iOS deja la vista 62 px más corta, sin avisar con un resize al final.
  await page.evaluate(() => {
    (window as unknown as { __recorte: number }).__recorte = 62;
  });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--hueco"))).toBe("62px");
  await expect.poll(() => abajo(barra)).toBeCloseTo(barraAntes + 62, 0);
  await expect.poll(() => abajo(caja)).toBeCloseTo(cajaAntes + 62, 0);

  // Cuando iOS se compone, todo regresa.
  await page.evaluate(() => {
    (window as unknown as { __recorte: number }).__recorte = 0;
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => abajo(barra)).toBeCloseTo(barraAntes, 0);
});

test("fuera de la app instalada (Safari con sus barras) no se mueve nada", async ({ page }) => {
  await page.addInitScript(() => {
    const alto = Object.getOwnPropertyDescriptor(VisualViewport.prototype, "height");
    Object.defineProperty(VisualViewport.prototype, "height", {
      get(this: VisualViewport) {
        return (alto?.get?.call(this) as number) - ((window as unknown as { __recorte?: number }).__recorte ?? 0);
      },
    });
  });
  await prepararSesion(page);
  await page.goto("/#chat");
  await page.evaluate(() => {
    (window as unknown as { __recorte: number }).__recorte = 62;
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--hueco"))).toBe("0px");
});
