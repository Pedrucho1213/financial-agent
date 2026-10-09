import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";

// "Cómo cierras el mes" y "Dónde ahorrar" en Análisis: lo que el asistente calcula (GET /v1/analisis).
// Hoy es 6 de octubre de 2026 y octubre lleva $16,754.70 en gastos.

function conAsistente(api = new ApiFalsa(), proyeccion: Partial<Record<string, number>> = {}) {
  api.asistente = {
    proyeccion: {
      enfoque: "proyeccion",
      periodo: "mes",
      respuesta: "Al ritmo que vas, cerrarías el mes en unos $38,400; con lo que te entra te sobrarían unos $6,600.",
      hallazgos: [{ tipo: "proyeccion", texto: "Al ritmo que vas, cerrarías el mes en unos $38,400." }],
      gastadoCentavos: 16_754_70,
      proyeccion: { cierreCentavos: 38_400_00, ritmoDiarioCentavos: 520_00, porPagarCentavos: 9_500_00, ingresosCentavos: 45_000_00, ...proyeccion },
    },
    ahorrar: {
      enfoque: "ahorrar",
      periodo: "mes",
      respuesta: "",
      gastadoCentavos: 16_754_70,
      hallazgos: [
        { tipo: "comparacion", texto: "Este mes llevas $16,754.70 en gastos." },
        { tipo: "hormiga", texto: "En café se te van unos $1,200 al mes en 24 compras chicas.", ahorroMensualCentavos: 600_00 },
        { tipo: "suscripciones", texto: "Pagas Netflix y Disney+, dos de video: con una te ahorras $159.", ahorroMensualCentavos: 159_00 },
        { tipo: "recortable", texto: "En Restaurantes se te van unos $4,500 al mes; bajarle un tercio te deja $1,500.", ahorroMensualCentavos: 1_500_00 },
      ],
    },
  };
  return api;
}

const abrir = async (page: Page, hash: string, api = conAsistente()) => {
  await prepararSesion(page, api);
  await page.goto(`/${hash}`);
  return api;
};

test.describe("Análisis con lo que dice el asistente", () => {
  test("el mes en curso dice cómo cerraría, cuánto le sobra y dónde ahorrar", async ({ page }) => {
    const api = await abrir(page, "#analisis");
    const cierre = page.getByRole("region", { name: "Cómo cierras el mes" });
    await expect(cierre).toContainText("Si sigues a este ritmo, en octubre gastarías unos");
    await expect(page.getByTestId("cierre")).toHaveText("$38,400");
    await expect(cierre.getByRole("img")).toHaveAttribute("aria-label", "Llevas $16,754.70, te faltarían $21,645.30; te entran $45,000");
    await expect(page.getByTestId("margen")).toHaveText("Te sobrarían unos $6,600");
    await expect(cierre).toContainText("Un día normal$520");
    await expect(cierre).toContainText("Fijos por pagar$9,500");

    const ahorro = page.getByRole("region", { name: "Dónde ahorrar" });
    // Solo las ideas de ahorro: la comparación no se repite aquí.
    await expect(ahorro.locator("[data-idea]")).toHaveCount(3);
    await expect(ahorro.locator('[data-idea="hormiga"]')).toContainText("Ahorras unos $600 al mes");
    await expect(page.getByTestId("ahorro-total")).toHaveText("Si les haces caso, hasta $2,259 al mes.");
    expect(api.de("GET", "/v1/analisis").map((p) => p.consulta.get("enfoque")).sort()).toEqual(["ahorrar", "proyeccion"]);
  });

  test("lo que lleva es el total del mes de Análisis, aunque el asistente compare solo los últimos 7 días", async ({ page }) => {
    const api = conAsistente();
    (api.asistente!.proyeccion as { gastadoCentavos: number }).gastadoCentavos = 4_531_98;
    await abrir(page, "#analisis", api);
    await expect(page.getByTestId("total-periodo")).toHaveText("$16,754.70");
    const cierre = page.getByRole("region", { name: "Cómo cierras el mes" });
    await expect(cierre.getByRole("img")).toHaveAttribute("aria-label", "Llevas $16,754.70, te faltarían $21,645.30; te entran $45,000");
    await expect(cierre).toContainText("Llevas $16,754.70");
    await expect(cierre).not.toContainText("$4,531.98");
  });

  test("si no le alcanza, lo dice en rojo", async ({ page }) => {
    await abrir(page, "#analisis", conAsistente(new ApiFalsa(), { ingresosCentavos: 30_000_00 }));
    await expect(page.getByTestId("margen")).toHaveText("Te faltarían unos $8,400");
    await expect(page.getByTestId("margen")).toHaveClass(/text-negative/);
  });

  test("con centavos redondea como la voz: el margen a cientos y el día normal a decenas", async ({ page }) => {
    await abrir(page, "#analisis", conAsistente(new ApiFalsa(), { ingresosCentavos: 45_123_45, ritmoDiarioCentavos: 520_37 }));
    await expect(page.getByTestId("margen")).toHaveText("Te sobrarían unos $6,700");
    await expect(page.getByRole("region", { name: "Cómo cierras el mes" })).toContainText("Un día normal$520");
    await expect(page.getByRole("region", { name: "Cómo cierras el mes" })).not.toContainText("$520.37");
  });

  test("si lo que sobra o falta es menos de $50, dice que es justo lo que le entra", async ({ page }) => {
    await abrir(page, "#analisis", conAsistente(new ApiFalsa(), { ingresosCentavos: 38_430_00 }));
    await expect(page.getByTestId("margen")).toHaveText("Justo lo que te entra");
    await expect(page.getByTestId("margen")).toHaveClass(/text-positive/);
  });

  test("sin ingresos conocidos no adivina el margen", async ({ page }) => {
    await abrir(page, "#analisis", conAsistente(new ApiFalsa(), { ingresosCentavos: 0 }));
    await expect(page.getByTestId("cierre")).toHaveText("$38,400");
    await expect(page.getByTestId("margen")).toHaveCount(0);
    await expect(page.getByTestId("marca-ingresos")).toHaveCount(0);
  });

  test("solo en el mes en curso y sin filtro: otra semana, otro mes o una categoría no lo muestran", async ({ page }) => {
    await abrir(page, "#analisis?periodo=semana");
    await expect(page.getByTestId("total-periodo")).toBeVisible();
    await expect(page.getByRole("region", { name: "Cómo cierras el mes" })).toHaveCount(0);
    await page.goto("/#analisis?ref=2026-09-10");
    await expect(page.getByTestId("titulo-periodo")).toHaveText("Septiembre 2026");
    await expect(page.getByRole("region", { name: "Dónde ahorrar" })).toHaveCount(0);
    await page.goto("/#analisis?categoria=cat-comida");
    await expect(page.getByTestId("total-periodo")).toBeVisible();
    await expect(page.getByRole("region", { name: "Cómo cierras el mes" })).toHaveCount(0);
  });

  test("un servidor sin /v1/analisis (404), sin proyección o sin ideas: esas secciones no salen y nada se rompe", async ({ page }) => {
    const errores: string[] = [];
    page.on("pageerror", (e) => errores.push(e.message));
    const api = await abrir(page, "#analisis", new ApiFalsa());
    await expect(page.getByRole("region", { name: "Lo que noté" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cómo cierras el mes" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Dónde ahorrar" })).toHaveCount(0);
    // Un 404 no se reintenta.
    await page.waitForTimeout(500);
    expect(api.de("GET", "/v1/analisis")).toHaveLength(2);

    const pocos = conAsistente();
    pocos.asistente = { ahorrar: { enfoque: "ahorrar", periodo: "mes", respuesta: "No veo fugas claras.", hallazgos: [], gastadoCentavos: 0 } };
    await abrir(page, "#analisis", pocos);
    await expect(page.getByRole("region", { name: "Lo que noté" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cómo cierras el mes" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Dónde ahorrar" })).toHaveCount(0);
    expect(errores).toEqual([]);
  });

  test("un gasto nuevo lo vuelve a pedir (la proyección cambia)", async ({ page }) => {
    const api = await abrir(page, "#analisis");
    await expect(page.getByTestId("cierre")).toHaveText("$38,400");
    const antes = api.de("GET", "/v1/analisis").length;
    (api.asistente!.proyeccion as { proyeccion: { cierreCentavos: number } }).proyeccion.cierreCentavos = 39_000_00;
    await page.goto("/#movimientos");
    await page.getByRole("button", { name: "Agregar" }).first().click();
    const hoja = page.getByRole("dialog");
    await hoja.locator("#monto").fill("600");
    await hoja.getByLabel("Comercio").fill("Liverpool");
    await hoja.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(hoja).toBeHidden();
    await page.goto("/#analisis");
    await expect(page.getByTestId("cierre")).toHaveText("$39,000");
    expect(api.de("GET", "/v1/analisis").length).toBeGreaterThan(antes);
  });
});

test.describe("Asistente en Análisis a 320 de ancho", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("nada se sale de lado ni se corta", async ({ page }) => {
    await abrir(page, "#analisis", conAsistente(new ApiFalsa(), { cierreCentavos: 98_765_400_00, ingresosCentavos: 99_000_000_00, porPagarCentavos: 12_345_600_00 }));
    await page.addStyleTag({ content: '*{font-family:"DejaVu Sans",Verdana,sans-serif !important}' });
    await page.getByRole("region", { name: "Cómo cierras el mes" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const cortados = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="Cómo cierras el mes"] p, [aria-label="Cómo cierras el mes"] dd')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent),
    );
    expect(cortados).toEqual([]);
  });
});

test.describe("capturas del asistente en Análisis", () => {
  const DIR = "e2e/capturas/asistente";
  mkdirSync(DIR, { recursive: true });
  for (const esquema of ["light", "dark"] as const) {
    test(`claro y oscuro (${esquema})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: esquema });
      await abrir(page, "#analisis");
      const cierre = page.getByRole("region", { name: "Cómo cierras el mes" });
      await cierre.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${DIR}/asistente-${esquema === "light" ? "claro" : "oscuro"}.png` });
    });
  }
});
