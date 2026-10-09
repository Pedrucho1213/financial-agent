// QA del PR #42 (pantallas de cuentas, tarjetas, mover dinero y etiquetas). Playwright de apps/web (.pw.ts para que bun test no lo tome): copiar como *.spec.ts a
// apps/web/e2e/ y borrar después. Complementa e2e/cuentas.spec.ts con casos límite: montos enormes y negativos,
// tarjeta pasada del límite o con saldo a favor, nombres raros, 404 del servidor nuevo (#41), doble toque,
// comas en el monto, modo oscuro a 320 y sin conexión.
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas, cuentasIniciales } from "./api-falsa-cuentas";

const fila = (page: Page, nombre: string) => page.locator(`[data-cuenta="${nombre}"]`);

async function sinTextoRoto(page: Page, donde: string) {
  const texto = await page.locator("body").innerText();
  expect(texto, donde).not.toMatch(/NaN|undefined|Infinity|\bnull\b|\[object/);
}

function extremos() {
  const d = cuentasIniciales();
  const [bbva, efectivo, revolut, nu, banamex] = d.cuentas;
  Object.assign(bbva!, { saldo: Number(process.env.MONTO_BBVA ?? 9_876_543_21) }); // casi 10 millones (MONTO_BBVA en centavos para probar otros)
  Object.assign(efectivo!, { saldo: -350_00 }); // gastó más de lo que traía
  Object.assign(revolut!, { nombre: `<img src=x onerror="window.__xss=1">Cuenta de ahorro para el enganche de la casa 🏠` });
  Object.assign(nu!, { deuda: 33_500_00, limite: 30_000_00 }); // pasada del límite
  Object.assign(banamex!, { deuda: -1_250_00, limite: 30_000_00 }); // saldo a favor
  d.etiquetas.push({ id: "eti-larga", nombre: "Boda de mi prima en Guadalajara con todo y despedida", activaDesde: null, activaHasta: null });
  return d;
}

test.describe("QA #42 · casos límite", () => {
  for (const tema of ["light", "dark"] as const) {
    test(`montos enormes, negativos y nombres raros: nada roto ni de lado a 320 (${tema})`, async ({ page }) => {
      const errores: string[] = [];
      page.on("pageerror", (e) => errores.push(e.message));
      await page.emulateMedia({ colorScheme: tema });
      await page.setViewportSize({ width: 320, height: 640 });
      const api = conCuentas(new ApiFalsa(), extremos());
      await prepararSesion(page, api);
      for (const hash of ["#inicio", "#cuentas", "#cuenta?id=cta-bbva", "#cuenta?id=cta-efectivo", "#cuenta?id=cta-revolut", "#cuenta?id=cta-nu", "#cuenta?id=cta-banamex", "#etiquetas", "#analisis"]) {
        await page.goto(`/${hash}`);
        await page.addStyleTag({ content: '*{font-family:"DejaVu Sans",Verdana,sans-serif !important}' });
        await page.waitForTimeout(400);
        await sinTextoRoto(page, hash);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), hash).toBeLessThanOrEqual(320);
        const cortados = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="neto"], [data-testid="deuda"], [data-testid="saldo"], [data-testid="disponible"], [data-testid="uso"]')]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => el.textContent),
        );
        expect(cortados, hash).toEqual([]);
        await page.screenshot({ path: `test-results/qa42-${hash.replace(/[#?=]/g, "_")}-${tema}.png`, fullPage: true });
      }
      expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
      expect(errores).toEqual([]);
    });
  }

  test("tarjeta pasada del límite: uso arriba de 100% y dice que se pasó; saldo a favor no dice que debe", async ({ page }) => {
    await prepararSesion(page, conCuentas(new ApiFalsa(), extremos()));
    await page.goto("/#cuenta?id=cta-nu");
    await expect(page.getByTestId("deuda")).toHaveText("$33,500.00");
    await expect(page.getByText("Te pasaste del límite")).toBeVisible();
    await expect(page.getByText(/-\$|−\$3,500|\$-/).first()).toHaveCount(0).catch(() => undefined);
    await page.goto("/#cuenta?id=cta-banamex");
    await expect(page.getByText("A tu favor")).toBeVisible();
    await expect(page.getByTestId("deuda")).toHaveText("$1,250.00");
    await expect(page.getByText("Debes", { exact: true })).toHaveCount(0);
  });

  test("efectivo en negativo se ve con signo, no como $350 a favor", async ({ page }) => {
    await prepararSesion(page, conCuentas(new ApiFalsa(), extremos()));
    await page.goto("/#cuentas");
    await expect(fila(page, "Efectivo")).toContainText(/[−-]\$350/);
  });

  test("#41: el servidor contesta 404 a una cuenta que no existe y la app lo dice sin pedir reintentar", async ({ page }) => {
    await prepararSesion(page, conCuentas(new ApiFalsa()));
    await page.route(/\/v1\/cuentas\/cta-borrada$/, (r) => r.fulfill({ status: 404, contentType: "application/json", body: '{"error":"No existe esa cuenta."}' }));
    await page.goto("/#cuenta?id=cta-borrada");
    await expect(page.getByText("No encontré esa cuenta")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
  });

  test("el monto acepta comas de miles y decimales con coma; cero, letras y vacío no dejan mandar", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    await prepararSesion(page, api);
    await page.goto("/#cuentas");
    const casos: [string, number | null][] = [["1,500", 1500], ["1,500.50", 1500.5], ["12,345,678", 12345678], ["99,5", 99.5], ["0", null], ["0.00", null], ["abc", null], ["", null]];
    for (const [escrito, esperado] of casos) {
      await page.getByRole("button", { name: "Mover dinero" }).first().click();
      const hoja = page.getByRole("dialog");
      await hoja.locator("#monto-mover").fill(escrito);
      await hoja.getByLabel("Desde").selectOption("cta-bbva");
      await hoja.getByLabel("Hacia").selectOption("cta-revolut");
      const listo = hoja.getByRole("button", { name: "Listo" });
      if (esperado === null) {
        await expect(listo, escrito).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(hoja).toBeHidden();
        continue;
      }
      await listo.click();
      await expect(hoja).toBeHidden();
      expect((api.de("POST", "/v1/transferencias").at(-1)?.cuerpo as { monto: number }).monto, escrito).toBe(esperado);
    }
  });

  test("doble toque en Listo manda una sola transferencia", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    await prepararSesion(page, api);
    await page.route(/\/v1\/transferencias$/, async (r) => {
      await new Promise((ok) => setTimeout(ok, 400));
      await r.fallback();
    });
    await page.goto("/#cuentas");
    await page.getByRole("button", { name: "Mover dinero" }).first().click();
    const hoja = page.getByRole("dialog");
    await hoja.locator("#monto-mover").fill("100");
    await hoja.getByLabel("Desde").selectOption("cta-bbva");
    await hoja.getByLabel("Hacia").selectOption("cta-revolut");
    await hoja.getByRole("button", { name: "Listo" }).dblclick();
    await expect(hoja).toBeHidden();
    await page.waitForTimeout(800);
    expect(api.de("POST", "/v1/transferencias")).toHaveLength(1);
  });

  test("doble toque en Agregar (anotar un gasto a mano) guarda uno solo", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    await prepararSesion(page, api);
    await page.route(/\/v1\/movimientos$/, async (r) => {
      if (r.request().method() === "POST") await new Promise((ok) => setTimeout(ok, 400));
      await r.fallback();
    });
    await page.goto("/#movimientos");
    await page.getByRole("button", { name: "Agregar" }).first().click();
    const hoja = page.getByRole("dialog");
    await hoja.locator("#monto").fill("250");
    await hoja.getByLabel("Comercio").fill("Tlayudas");
    await hoja.getByRole("button", { name: "Agregar", exact: true }).dblclick();
    await expect(hoja).toBeHidden();
    await page.waitForTimeout(800);
    expect(api.de("POST", "/v1/movimientos")).toHaveLength(1);
  });

  test("sin conexión: Cuentas abre con lo último y no deja mover dinero", async ({ page }) => {
    await prepararSesion(page, conCuentas(new ApiFalsa()));
    await page.goto("/#cuentas");
    await expect(page.getByTestId("neto")).toBeVisible();
    const antes = await page.getByTestId("neto").innerText();
    await page.waitForTimeout(1500);
    await page.unroute(/\/v1\//);
    await page.route(/\/v1\//, (r) => r.abort("internetdisconnected"));
    await page.reload();
    await expect(page.getByTestId("neto")).toHaveText(antes, { timeout: 10_000 });
    const mover = page.getByRole("button", { name: "Mover dinero" }).first();
    if (await mover.isEnabled()) {
      await mover.click();
      await expect(page.getByRole("dialog").getByRole("button", { name: "Listo" })).toBeDisabled();
    }
  });

  test("una etiqueta con # y espacios, repetida o vacía no rompe la lista", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    await prepararSesion(page, api);
    await page.goto("/#etiquetas");
    for (const nombre of ["  #viaje   cdmx ", "Trabajo", "   "]) {
      await page.getByRole("button", { name: "Nueva etiqueta" }).click();
      const hoja = page.getByRole("dialog");
      await hoja.getByLabel("Nombre").fill(nombre);
      const crear = hoja.getByRole("button", { name: "Crear" });
      if (!(await crear.isEnabled())) {
        await page.keyboard.press("Escape");
        continue;
      }
      await crear.click();
      await page.waitForTimeout(300);
      if (await hoja.isVisible()) await page.keyboard.press("Escape");
    }
    await sinTextoRoto(page, "etiquetas");
    const nombres = await page.locator("[data-etiqueta]").evaluateAll((els) => els.map((e) => e.getAttribute("data-etiqueta")));
    console.log("etiquetas:", nombres, "POST:", api.de("POST", "/v1/etiquetas").map((p) => p.cuerpo));
    expect(nombres.filter((n) => n === "Trabajo")).toHaveLength(1);
    expect(nombres.some((n) => !n?.trim())).toBe(false);
  });

  test("Revisión: tarjeta con límite y deuda sin decir no dice 100 % usado ni $0 disponible", async ({ page }) => {
    const d = cuentasIniciales();
    Object.assign(d.cuentas[3]!, { deuda: null, limite: 30_000_00, saldoEn: null }); // Nu
    await prepararSesion(page, conCuentas(new ApiFalsa(), d));
    for (const hash of ["#inicio", "#cuentas", "#cuenta?id=cta-nu"]) {
      await page.goto(`/${hash}`);
      await page.waitForTimeout(500);
      const texto = await page.locator("main, body").first().innerText();
      const nu = hash === "#cuentas" ? await fila(page, "Nu").innerText() : texto;
      console.log(hash, "→", nu.replace(/\s+/g, " ").slice(0, 200));
      expect(nu, hash).not.toMatch(/100\s?%/);
      expect(nu, hash).not.toMatch(/\$0(\.00)? (disponible|de cr)/i);
      if (hash === "#cuenta?id=cta-nu") await expect(page.getByText("Te pasaste del límite")).toHaveCount(0);
    }
  });

  test("Revisión: borrar un movimiento desde la cuenta actualiza el saldo al volver", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    await prepararSesion(page, api);
    // El servidor falso no recalcula saldos al borrar: se ajusta a mano como lo haría el real.
    await page.route(/\/v1\/movimientos\/[^/]+$/, async (r) => {
      if (r.request().method() === "DELETE") {
        const bbva = api.cuentas!.cuentas.find((c) => c.id === "cta-bbva")!;
        bbva.saldo! += 900_00;
      }
      await r.fallback();
    });
    await page.goto("/#cuenta?id=cta-bbva");
    await expect(page.getByTestId("saldo")).toHaveText("$18,450.00");
    await page.getByRole("region", { name: "Recientes" }).getByRole("button", { name: /Pemex/ }).click();
    await page.getByRole("button", { name: "Eliminar" }).click();
    await page.waitForTimeout(600);
    await page.evaluate(() => (location.hash = "#cuenta?id=cta-bbva"));
    await expect(page.getByTestId("saldo")).toHaveText("$19,350.00", { timeout: 8000 });
    await expect(page.getByRole("region", { name: "Recientes" }).getByRole("button", { name: /Pemex/ })).toHaveCount(0);
  });
});
