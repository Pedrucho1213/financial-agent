// PR #43 contra un servidor real (copiar como apps/web/e2e/zz-*.spec.ts; API_REAL, INVITACION de una cuenta nueva, CAPTURAS).
import { expect, test, type Page } from "@playwright/test";
const API = process.env.API_REAL;
const CODIGO = process.env.INVITACION;
const S = process.env.CAPTURAS ?? "/tmp";
test.use({ baseURL: API });

const llamar = (page: Page, metodo: string, ruta: string, cuerpo?: unknown) =>
  page.evaluate(async ([m, r, c]) => {
    const t = localStorage.getItem("fa_token");
    const res = await fetch(r as string, { method: m as string, headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: c ? JSON.stringify(c) : undefined });
    return { estado: res.status, cuerpo: await res.json().catch(() => null) };
  }, [metodo, ruta, cuerpo] as const);

const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);

test("PR #43 contra servidor real: sin ingresos, con ingresos, refresco y 320 px", async ({ page }) => {
  test.skip(!API || !CODIGO);
  test.setTimeout(300_000);
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("response", (r) => { if (r.url().includes("/v1/") && r.status() >= 400) errores.push(`${r.status()} ${r.url()}`); });
  await page.goto(`/?codigo=${CODIGO}`);
  await page.getByRole("button", { name: "Usar en Safari" }).click();
  await page.getByRole("button", { name: "Agregar dispositivo" }).click();
  await expect(page.getByRole("heading", { name: /\d{4}/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fa_token"))).not.toBeNull();
  // 28 días de gastos variables, con centavos, más la renta y Netflix + Disney.
  const hoy = new Date();
  for (let i = 27; i >= 0; i--) {
    const f = new Date(hoy.getTime() - i * 86_400_000);
    await llamar(page, "POST", "/v1/movimientos", { tipo: "gasto", monto: 85.5, comercio: "Starbucks", descripcion: "café", fecha: dia(f) });
    if (i % 2 === 0) await llamar(page, "POST", "/v1/movimientos", { tipo: "gasto", monto: 233.37, comercio: "Uber Eats", descripcion: "comida a domicilio", fecha: dia(f) });
  }
  const r1 = await llamar(page, "GET", "/v1/analisis?enfoque=proyeccion");
  const a1 = await llamar(page, "GET", "/v1/analisis?enfoque=ahorrar");
  console.log("SERVIDOR proyeccion:", JSON.stringify(r1.cuerpo));
  console.log("SERVIDOR ahorrar:", JSON.stringify(a1.cuerpo));
  await page.goto("/#analisis");
  await expect(page.getByRole("region", { name: "Cómo cierras el mes" })).toBeVisible();
  await expect(page.getByTestId("margen")).toHaveCount(0);
  await expect(page.getByTestId("marca-ingresos")).toHaveCount(0);
  console.log("APP sin ingresos:", (await page.getByRole("region", { name: "Cómo cierras el mes" }).innerText()).replace(/\n/g, " | "));
  const ahorrar = page.getByRole("region", { name: "Dónde ahorrar" });
  if (await ahorrar.count()) console.log("APP ahorrar:", (await ahorrar.innerText()).replace(/\n/g, " | "));
  else console.log("APP ahorrar: (no sale)");
  await page.screenshot({ path: `${S}/real43-sin-ingresos.png`, fullPage: true });

  // Con un ingreso con centavos: margen y rayita.
  await llamar(page, "POST", "/v1/movimientos", { tipo: "ingreso", monto: 15234.5, descripcion: "quincena", fecha: dia(new Date(hoy.getFullYear(), hoy.getMonth(), 1, 12)) });
  const r2 = await llamar(page, "GET", "/v1/analisis?enfoque=proyeccion");
  console.log("SERVIDOR con ingreso:", JSON.stringify(r2.cuerpo.respuesta), JSON.stringify(r2.cuerpo.proyeccion));
  await page.reload();
  console.log("APP recién recargada (caché):", await page.getByTestId("margen").count());
  await page.goto("/#inicio");
  await page.waitForTimeout(61_000);
  await page.goto("/#analisis");
  await expect(page.getByTestId("margen")).toBeVisible({ timeout: 15_000 });
  console.log("APP con ingreso:", (await page.getByRole("region", { name: "Cómo cierras el mes" }).innerText()).replace(/\n/g, " | "));
  const cierreAntes = await page.getByTestId("cierre").innerText();

  // Un gasto que no pasa por la app (como uno dictado): al minuto, sin recargar, se actualiza.
  await llamar(page, "POST", "/v1/movimientos", { tipo: "gasto", monto: 3000, comercio: "Liverpool", descripcion: "ropa", fecha: dia(hoy) });
  await page.goto("/#inicio");
  await page.waitForTimeout(61_000);
  await page.goto("/#analisis");
  await expect(page.getByTestId("cierre")).not.toHaveText(cierreAntes, { timeout: 15_000 });
  console.log("APP tras gasto externo:", cierreAntes, "→", await page.getByTestId("cierre").innerText());

  // 320 px sin scroll horizontal.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(page.getByTestId("cierre")).toBeVisible();
  // Tras recargar corre la animación de entrada (translate): se mide cuando termina.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 }).toBeLessThanOrEqual(320);
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  const culpables = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 320.5).map((e) => `${e.tagName}.${(e.className?.toString?.() ?? "").slice(0, 60)} [${e.closest("section")?.getAttribute("aria-label") ?? "-"}] r=${Math.round(e.getBoundingClientRect().right)} «${(e.textContent ?? "").slice(0, 40)}»`).slice(0, 15));
  console.log("ANCHO", ancho, "\n" + culpables.join("\n"));
  await page.screenshot({ path: `${S}/real43-320.png`, fullPage: true });
  expect(ancho).toBeLessThanOrEqual(320);
  await page.screenshot({ path: `${S}/real43-320.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `${S}/real43-320-oscuro.png`, fullPage: true });
  expect(errores).toEqual([]);
});
