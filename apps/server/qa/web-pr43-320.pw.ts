// PR #43 contra un servidor real (copiar como apps/web/e2e/zz-*.spec.ts; API_REAL, INVITACION de una cuenta nueva, CAPTURAS).
import { expect, test } from "@playwright/test";
const API = process.env.API_REAL; const CODIGO = process.env.INVITACION; const S = process.env.CAPTURAS ?? "/tmp";
test.use({ baseURL: API, viewport: { width: 320, height: 800 } });
test("320 px estable", async ({ page }) => {
  test.skip(!API || !CODIGO);
  await page.goto(`/?codigo=${CODIGO}`);
  await page.getByRole("button", { name: "Usar en Safari" }).click();
  await page.getByRole("button", { name: "Agregar dispositivo" }).click();
  await expect(page.getByRole("heading", { name: /\d{4}/ })).toBeVisible();
  await page.goto("/#analisis");
  await expect(page.getByTestId("cierre")).toBeVisible();
  const medidas: number[] = [];
  for (let i = 0; i < 6; i++) { medidas.push(await page.evaluate(() => document.documentElement.scrollWidth)); await page.waitForTimeout(400); }
  console.log("MEDIDAS", medidas.join(","));
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    await page.screenshot({ path: `${S}/real43-320-${tema}.png`, fullPage: true });
  }
  const sec = page.getByRole("region", { name: "Cómo cierras el mes" });
  await sec.screenshot({ path: `${S}/real43-320-cierre.png` });
  console.log("RECORTE", await sec.evaluate((s) => [...s.querySelectorAll("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible").map((e) => e.textContent).join(" / ")));
  expect(medidas.at(-1)!).toBeLessThanOrEqual(320);
});
