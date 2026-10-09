// PR #45 contra un servidor real (copiar como apps/web/e2e/zz-*.spec.ts; API_REAL, INVITACION de una cuenta nueva, CAPTURAS).
// El caso de Pedro: Revolut 19,291; Invex límite 57,400 debe 19,818.88; Nu solo con 33,600 disponibles; Efectivo sin saldo.
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

test("Nu sin límite: aviso, botón para decir el límite y deuda calculada al guardarlo", async ({ page }) => {
  test.skip(!API || !CODIGO);
  test.setTimeout(120_000);
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("response", (r) => { if (r.url().includes("/v1/") && r.status() >= 500) errores.push(`${r.status()} ${r.url()}`); });
  await page.goto(`/?codigo=${CODIGO}`);
  await page.getByRole("button", { name: "Usar en Safari" }).click();
  await page.getByRole("button", { name: "Agregar dispositivo" }).click();
  await expect(page.getByRole("heading", { name: /\d{4}/ })).toBeVisible();
  for (const c of [
    { nombre: "Revolut", tipo: "debito", saldo: 19291 },
    { nombre: "Invex", tipo: "credito", limite: 57400, deuda: 19818.88 },
    { nombre: "Nu", tipo: "credito", disponible: 33600 },
    { nombre: "Efectivo", tipo: "efectivo" },
  ]) expect((await llamar(page, "POST", "/v1/cuentas", c)).estado).toBe(201);
  const api = await llamar(page, "GET", "/v1/cuentas");
  console.log("SERVIDOR totales:", JSON.stringify(api.cuerpo.totales));
  console.log("SERVIDOR Nu:", JSON.stringify(api.cuerpo.cuentas.find((c: { nombre: string }) => c.nombre === "Nu")));

  // Lo creado fuera de la app (como por voz) se ve al minuto; aquí se limpia la caché para no esperar.
  await page.evaluate(() => localStorage.removeItem("fa_cache"));
  await page.goto("/#cuentas");
  await page.reload();
  const nota = page.getByTestId("sin-saldo");
  await expect(nota).toBeVisible();
  console.log("APP nota:", await nota.innerText());
  await expect(nota).toContainText("cuánto debes en Nu");
  await expect(nota).toContainText("Efectivo");
  await expect(page.getByTestId("credito-disponible")).toBeVisible();
  console.log("APP crédito:", await page.getByTestId("credito-disponible").innerText());
  // 57,400 − 19,818.88 = 37,581.12 de Invex + 33,600 de Nu = 71,181.12.
  await expect(page.getByTestId("credito-disponible")).toContainText("71,181.12");
  console.log("APP lista:", (await page.locator("main").innerText()).split("\n").filter((l) => /Nu|Invex|Revolut|Efectivo|falta|disponible/.test(l)).join(" | "));
  await page.screenshot({ path: `${S}/real45-sin-limite.png`, fullPage: true });

  await page.goto("/#inicio");
  const tienes = page.getByRole("button", { name: /Ver cuentas/ });
  console.log("APP inicio:", await tienes.getAttribute("aria-label"));
  await expect(tienes).toHaveAttribute("aria-label", /Efectivo y Nu/);

  // Decir el límite desde el aviso.
  await page.goto("/#cuentas");
  await page.getByRole("button", { name: "Decir el límite de Nu" }).click();
  const hoja = page.getByRole("dialog");
  await expect(hoja).toBeVisible();
  console.log("APP hoja:", (await hoja.innerText()).replace(/\n/g, " | "));
  await page.screenshot({ path: `${S}/real45-hoja.png` });
  const campoLimite = hoja.getByLabel(/límite/i).first();
  await campoLimite.fill("40000");
  await hoja.getByRole("button", { name: /Guardar|Listo/ }).click();
  await expect(hoja).toBeHidden();
  const despues = await llamar(page, "GET", "/v1/cuentas");
  const nu = despues.cuerpo.cuentas.find((c: { nombre: string }) => c.nombre === "Nu");
  console.log("SERVIDOR Nu tras límite:", JSON.stringify({ l: nu.limiteCentavos, d: nu.disponibleCentavos, u: nu.deudaCentavos }));
  expect([nu.limiteCentavos, nu.disponibleCentavos, nu.deudaCentavos]).toEqual([4_000_000, 3_360_000, 640_000]);
  await expect(page.getByTestId("sin-saldo")).not.toContainText("Nu");
  await expect(page.getByRole("button", { name: "Decir el límite de Nu" })).toHaveCount(0);
  console.log("APP nota tras límite:", await page.getByTestId("sin-saldo").innerText());
  await page.goto("/#inicio");
  await expect(page.getByRole("button", { name: /Ver cuentas/ })).not.toHaveAttribute("aria-label", /Nu/);
  console.log("APP inicio tras límite:", await page.getByRole("button", { name: /Ver cuentas/ }).getAttribute("aria-label"));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/#cuentas");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 }).toBeLessThanOrEqual(320);
  expect(errores).toEqual([]);
});
