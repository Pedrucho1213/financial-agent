// QA del PR #37 (página Análisis). Playwright de apps/web (.pw.ts para que bun test no lo tome): copiar como *.spec.ts a apps/web/e2e/ y borrar después.
// Complementa e2e/analisis.spec.ts con lo que la tanda de cuentas va a meter (transferencias, pagos de
// tarjeta), montos extremos, texto roto (NaN, undefined) y la comparación de la semana.
// QA-083 y QA-084 cerrados en 37c5cf7 y 00781ab.
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, HOY, mov, prepararSesion } from "./api-falsa";
import { conHistorial } from "./api-falsa-analisis";

const total = (page: Page) => page.getByTestId("total-periodo");
const PERIODOS = ["semana", "mes", "6m", "anio"] as const;

async function sinTextoRoto(page: Page, donde: string) {
  const texto = await page.locator("main, body").first().innerText();
  expect(texto, donde).not.toMatch(/NaN|undefined|Infinity|null|\[object/);
}

test.describe("QA #37 · Análisis", () => {
  test("transferencias y pagos de tarjeta no cuentan como gasto ni como ingreso", async ({ page }) => {
    const api = new ApiFalsa();
    api.movimientos.push(
      mov(HOY, "transferencia" as never, 50_000, null, null, { cuenta: "Bancomer", descripcion: "A Revolut" }),
      mov(HOY, "pago_tarjeta" as never, 12_000, null, null, { cuenta: "Nu", descripcion: "Pago Nu" }),
    );
    await prepararSesion(page, api);
    await page.goto("/#analisis");
    await expect(total(page)).toHaveText("$16,754.70");
    await expect(page.getByText(/\$50,000|\$12,000|50 mil|12 mil/)).toHaveCount(0);
    await sinTextoRoto(page, "con transferencia");
  });

  for (const tema of ["light", "dark"] as const) {
    test(`ningún periodo muestra NaN/undefined ni se sale de lado a 320 (${tema})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: tema });
      await page.setViewportSize({ width: 320, height: 640 });
      await prepararSesion(page, conHistorial(new ApiFalsa()));
      for (const periodo of PERIODOS) {
        await page.goto(`/#analisis?periodo=${periodo}`);
        await expect(total(page)).toBeVisible();
        await page.waitForTimeout(300);
        await sinTextoRoto(page, periodo);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), periodo).toBeLessThanOrEqual(320);
        await page.screenshot({ path: `test-results/qa37-${periodo}-${tema}.png`, fullPage: true });
      }
    });
  }

  test("FIX QA-084: un gasto de 150 mil no corta «Por día» ni «Promedio» a 320", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const api = new ApiFalsa();
    api.movimientos.push(mov(HOY, "gasto", Number(process.env.MONTO ?? 150_000), "Eventos", "Concesionaria", { cuenta: "BBVA" }));
    await prepararSesion(page, api);
    await page.goto("/#analisis");
    await expect(total(page)).toHaveText("$166,754.70");
    await sinTextoRoto(page, "enorme");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const cortados = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="Gastado"] .truncate')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
    );
    expect(cortados).toEqual([]);
  });

  test("solo ingresos en el periodo: no divide entre cero ni dice gasto negativo", async ({ page }) => {
    const api = new ApiFalsa();
    api.movimientos = [mov(HOY, "ingreso", 18_750, "Sueldo", null, { descripcion: "Quincena" })];
    await prepararSesion(page, api);
    for (const periodo of PERIODOS) {
      await page.goto(`/#analisis?periodo=${periodo}`);
      await expect(total(page)).toHaveText("$0.00");
      await sinTextoRoto(page, periodo);
      await expect(page.getByText(/-\$|−\$/)).toHaveCount(0);
    }
  });

  test("FIX QA-083: semana con meses de historia y sin gastos del 28 al 30 sep no dice «empezaste a anotar después»", async ({ page }) => {
    // Semana actual 5–11 oct; la anterior 28 sep – 4 oct. Se quitan los registros del 28 al 30 de septiembre.
    const api = conHistorial(new ApiFalsa());
    api.movimientos = api.movimientos.filter((m) => !(m.fecha >= "2026-09-28" && m.fecha <= "2026-09-30"));
    await prepararSesion(page, api);
    await page.goto("/#analisis?periodo=semana");
    await expect(total(page)).toBeVisible();
    await page.waitForTimeout(300);
    const comparacion = page.getByTestId("comparacion");
    console.log("comparación de la semana:", (await comparacion.count()) ? await comparacion.innerText() : "(no hay)");
    await expect(comparacion).toHaveCount(1);
    await expect(comparacion).not.toHaveText(/no hay|sin datos|todavía/i);
  });

  test("sin conexión, Análisis abre con el caché y no muestra error en la comparación", async ({ page }) => {
    await prepararSesion(page, conHistorial(new ApiFalsa()));
    await page.goto("/#analisis?periodo=semana");
    await expect(page.getByTestId("comparacion")).toBeVisible();
    const antes = await page.getByTestId("comparacion").innerText();
    await page.waitForTimeout(1500);
    await page.unroute(/\/v1\//);
    await page.route(/\/v1\//, (r) => r.abort("internetdisconnected"));
    await page.reload();
    await expect(page.getByTestId("total-periodo")).toBeVisible();
    const despues = await page.getByTestId("comparacion").innerText().catch(() => "(sin comparación)");
    console.log({ antes, despues });
    await expect(page.getByText(/no carg|error|reintentar/i)).toHaveCount(0);
  });
});
