import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas } from "./api-falsa-cuentas";

// Los montos grandes (Ajustado) achican su letra solo si no caben, y una vez: Pedro vio (15-oct) «Gastaste»,
// «Lo que tienes», el saldo de una cuenta y el monto del detalle encogerse cada vez más hasta desaparecer.

const PANTALLAS = ["#inicio", "#movimientos", "#cuentas", "#cuenta?id=cta-bbva", "#cuenta?id=cta-nu", "#movimientos?detalle=mov-001", "#analisis"];

/** Tamaño de letra de cada monto ajustable a la vista, si su texto cabe y si quedó en dos renglones. */
async function montos(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-ajustado]")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const rango = document.createRange();
        rango.selectNodeContents(el);
        const estilo = getComputedStyle(el);
        const relleno = Number.parseFloat(estilo.paddingLeft) + Number.parseFloat(estilo.paddingRight);
        return {
          texto: el.textContent ?? "",
          tam: Number.parseFloat(estilo.fontSize),
          cabe: rango.getBoundingClientRect().width <= el.getBoundingClientRect().width - relleno + 1,
        };
      }),
  );
}

/** Lo que dispara una nueva medida: cambios de ancho de ida y vuelta y que el texto se vuelva a escribir. */
async function sacudir(page: Page, ancho: number) {
  for (let i = 0; i < 6; i++) {
    await page.setViewportSize({ width: ancho - 40, height: 844 });
    await page.waitForTimeout(60);
    await page.setViewportSize({ width: ancho, height: 844 });
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-ajustado]")) {
      const t = el.firstChild;
      if (t?.nodeType === Node.TEXT_NODE) t.textContent = `${t.textContent}`;
    }
  });
  await page.waitForTimeout(300);
}

for (const ancho of [390, 320]) {
  test(`a ${ancho} px los montos no se encogen al volver a medirlos`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: ancho, height: 844 });
    await prepararSesion(page, conCuentas(new ApiFalsa()));
    for (const hash of PANTALLAS) {
      await page.goto("about:blank");
      await page.goto(`/${hash}`);
      await expect(page.locator("[data-ajustado]").first()).toBeVisible();
      await page.waitForTimeout(900);
      const antes = await montos(page);
      await sacudir(page, ancho);
      const despues = await montos(page);
      expect(despues.map((m) => m.tam), hash).toEqual(antes.map((m) => m.tam));
      for (const m of despues) {
        expect(m.tam, `${hash} ${m.texto}`).toBeGreaterThanOrEqual(13);
        expect(m.cabe, `${hash} ${m.texto}`).toBe(true);
      }
    }
  });
}

test("a 390 px un monto que cabe queda a su tamaño normal", async ({ page }) => {
  await prepararSesion(page, conCuentas(new ApiFalsa()));
  await page.goto("/#movimientos?detalle=mov-001");
  await expect(page.locator("header [data-ajustado]")).toHaveCSS("font-size", "44px");
  await page.goto("about:blank");
  await page.goto("/#cuenta?id=cta-bbva");
  await expect(page.getByTestId("saldo")).toHaveCSS("font-size", "40px");
  await page.goto("about:blank");
  await page.goto("/#movimientos");
  for (const nombre of ["Gastaste", "Entró"]) {
    const monto = page.getByRole("region", { name: nombre }).locator("[data-ajustado]");
    await expect(monto).toBeVisible();
    expect(await monto.evaluate((el) => el.style.fontSize), nombre).toBe("");
  }
});

test("a 320 px un monto de millones se achica sin bajar del mínimo ni cortarse", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const api = conCuentas(new ApiFalsa());
  for (const c of api.cuentas!.cuentas) if (c.nombre === "BBVA") Object.assign(c, { saldo: 98_765_432_10, dicho: 98_765_432_10 });
  api.movimientos[0]!.montoCentavos = 12_345_678_90;
  await prepararSesion(page, api);
  for (const hash of ["#cuentas", "#cuenta?id=cta-bbva", `#movimientos?detalle=${api.movimientos[0]!.id}`, "#movimientos"]) {
    await page.goto("about:blank");
    await page.goto(`/${hash}`);
    await expect(page.locator("[data-ajustado]").first()).toBeVisible();
    await page.waitForTimeout(800);
    for (const m of await montos(page)) {
      expect(m.tam, `${hash} ${m.texto}`).toBeGreaterThanOrEqual(13);
      expect(m.cabe, `${hash} ${m.texto}`).toBe(true);
    }
  }
});
