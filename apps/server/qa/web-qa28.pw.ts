import { expect, test } from "@playwright/test";
import { prepararSesion } from "./api-falsa";

const avisar = (page: import("@playwright/test").Page, url: string) =>
  page.evaluate((u) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { tipo: "fa:abrir", url: u } })), url);

test.describe("QA #28 · QA-074 sin preguntas de más", () => {
  test("sin cambios no pregunta; cambiar y regresar al valor original tampoco", async ({ page }) => {
    const api = await prepararSesion(page);
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    const preguntas: string[] = [];
    page.on("dialog", (d) => (preguntas.push(d.message()), d.dismiss()));
    await page.goto(`/#movimientos?detalle=${pemex.id}&editar=1`);
    const hoja = page.getByRole("dialog");
    await expect(hoja.locator("#monto")).toBeVisible();
    await avisar(page, "/#movimientos?detalle=mov-001&editar=1");
    await expect(hoja.locator("#monto")).toHaveValue("85");
    const nota = hoja.getByLabel("Nota");
    const antes = await nota.inputValue();
    await nota.fill("algo");
    await nota.fill(antes);
    await avisar(page, `/#movimientos?detalle=${pemex.id}&editar=1`);
    await expect(hoja.locator("#monto")).not.toHaveValue("85");
    expect(preguntas).toEqual([]);
  });

  test("tras Guardar o Cancelar, el siguiente aviso no pregunta", async ({ page }) => {
    const api = await prepararSesion(page);
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    const preguntas: string[] = [];
    page.on("dialog", (d) => (preguntas.push(d.message()), d.dismiss()));
    await page.goto(`/#movimientos?detalle=${pemex.id}&editar=1`);
    const hoja = page.getByRole("dialog");
    await hoja.getByLabel("Nota").fill("Tanque lleno");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    await avisar(page, "/#movimientos?detalle=mov-001&editar=1");
    await expect(page.getByRole("dialog").locator("#monto")).toHaveValue("85");
    await page.getByRole("dialog").getByLabel("Nota").fill("borrador");
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await avisar(page, `/#movimientos?detalle=${pemex.id}&editar=1`);
    await expect(page.getByRole("dialog").locator("#monto")).toBeVisible();
    expect(preguntas).toEqual([]);
  });

  test("decir que no deja la dirección sin editar=1 (recargar no abre el otro editor)", async ({ page }) => {
    const api = await prepararSesion(page);
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    page.on("dialog", (d) => d.dismiss());
    await page.goto(`/#movimientos?detalle=${pemex.id}&editar=1`);
    const hoja = page.getByRole("dialog");
    await hoja.getByLabel("Nota").fill("Tanque lleno");
    await avisar(page, "/#movimientos?detalle=mov-001&editar=1");
    await page.waitForTimeout(500);
    await expect(hoja.getByLabel("Nota")).toHaveValue("Tanque lleno");
    console.log("URL tras decir que no:", page.url());
    expect(page.url()).not.toContain("editar=1");
  });
});

test.describe("QA #28 · QA-073 en pantallas angostas", () => {
  for (const [ancho, tema] of [[320, "light"], [320, "dark"], [390, "dark"]] as const) {
    test(`nada cortado a ${ancho}px en ${tema}`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 800 });
      await page.emulateMedia({ colorScheme: tema });
      const api = await prepararSesion(page);
      api.plan.presupuestos = [
        { id: "pre-1", categoriaId: null, limiteCentavos: 30_000_51 },
        { id: "pre-2", categoriaId: "cat-comida", limiteCentavos: 3_000_51 },
      ];
      api.plan.metas[0]!.objetivoCentavos = 60_000_51;
      await page.goto("/#plan");
      await expect(page.getByRole("region", { name: "Resumen del plan" })).toContainText("de $30,000.51");
      const cortados = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("dd, .truncate, .whitespace-nowrap")]
          .filter((e) => /\$/.test(e.textContent ?? "") && e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent),
      );
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.screenshot({ path: `/tmp/claude-0/qa28-${ancho}-${tema}.png`, fullPage: true });
      expect(cortados).toEqual([]);
      expect(desborde).toBe(0);
    });
  }
});
