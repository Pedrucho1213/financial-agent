import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, HOY, prepararSesion } from "./api-falsa";
import { conHistorial } from "./api-falsa-analisis";

// Análisis (#analisis): periodos, comparación, barras, filtros, insights, calendario, flujo y cómo pagas.
// Los montos salen de la API falsa: octubre suma $16,754.70 en 14 gastos; al 6 de septiembre, $13,980.

const total = (page: Page) => page.getByTestId("total-periodo");
const titulo = (page: Page) => page.getByTestId("titulo-periodo");

test.describe("Análisis", () => {
  test("Inicio lo abre y «Inicio» regresa", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#inicio");
    await page.getByRole("button", { name: /^Análisis Tendencias/ }).click();
    await expect(page).toHaveURL(/#analisis$/);
    await expect(page.getByRole("heading", { name: "Análisis", level: 1 })).toBeVisible();
    await expect(titulo(page)).toHaveText("Octubre 2026");
    await expect(total(page)).toHaveText("$16,754.70");
    await expect(page.getByTestId("comparacion")).toHaveText("20% más que septiembre a estas alturas");
    await page.getByRole("button", { name: "Inicio" }).first().click();
    await expect(page).toHaveURL(/#inicio$/);
  });

  test("«Análisis» en los últimos 6 meses y «Comparar» en categorías llevan a su periodo", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#inicio");
    await page.getByRole("button", { name: "Ver análisis" }).click();
    await expect(page).toHaveURL(/#analisis\?periodo=6m&ref=2026-10-01$/);
    await expect(titulo(page)).toHaveText("may – oct 2026");
    await page.goto("/#inicio?mes=2026-09");
    await page.getByRole("button", { name: "Comparar" }).click();
    await expect(titulo(page)).toHaveText("Septiembre 2026");
    await expect(total(page)).toHaveText("$24,310.50");
  });

  test("semana, flechas y el periodo en la dirección", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    await page.getByRole("radio", { name: "S" }).click();
    await expect(page).toHaveURL(/periodo=semana/);
    await expect(titulo(page)).toHaveText("5–11 oct 2026");
    await expect(total(page)).toHaveText("$1,690.40");
    // No hay semana siguiente: todavía no empieza.
    await expect(page.getByRole("button", { name: "Semana siguiente" })).toBeDisabled();
    await page.getByRole("button", { name: "Semana anterior" }).click();
    await expect(titulo(page)).toHaveText("28 sep – 4 oct 2026");
    await expect(total(page)).toHaveText("$15,704.30");
    await expect(page).toHaveURL(/ref=2026-09-28/);
    await page.getByRole("button", { name: "Semana siguiente" }).click();
    await expect(titulo(page)).toHaveText("5–11 oct 2026");
    // La semana actual no lleva ref en la dirección.
    await expect(page).not.toHaveURL(/ref=/);
    await page.getByRole("radio", { name: "M", exact: true }).click();
    await expect(page).toHaveURL(/#analisis$/);
  });

  test("una dirección rara o del futuro abre el mes actual", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis?periodo=decada&ref=2030-01-01");
    await expect(titulo(page)).toHaveText("Octubre 2026");
    await expect(total(page)).toHaveText("$16,754.70");
    await page.goto("/#analisis?ref=hola");
    await expect(titulo(page)).toHaveText("Octubre 2026");
  });

  test("sin registros del periodo anterior completo, no compara (ni dice «1,000% más»)", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis?ref=2026-09-10");
    await expect(titulo(page)).toHaveText("Septiembre 2026");
    await expect(total(page)).toHaveText("$24,310.50");
    await expect(page.getByTestId("comparacion")).toHaveText("Todavía no hay con qué comparar: empezaste a anotar después");
    await expect(page.locator("[data-insight=sube]")).toHaveCount(0);
  });

  test("tocar una barra muestra ese día; tocarla otra vez regresa al total", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    const barra = page.locator('[data-grafica=barras] rect[data-indice="0"]');
    await expect(barra).toBeVisible();
    await page.waitForTimeout(700);
    const caja = await barra.boundingBox();
    if (!caja) throw new Error("sin barra");
    await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height - 4);
    const region = page.getByRole("region", { name: "Gastado" });
    await expect(region.getByRole("heading")).toHaveText("Jueves 1 oct");
    await expect(total(page)).toHaveText("$12,500.00");
    await expect(region).toContainText("1 gasto · arriba del promedio");
    await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height - 4);
    await expect(region.getByRole("heading")).toHaveText("Gastado");
    await expect(total(page)).toHaveText("$16,754.70");
  });

  test("con el teclado: las flechas recorren los días y Escape suelta", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    const grafica = page.locator("[data-grafica=barras]");
    await grafica.focus();
    await page.keyboard.press("ArrowLeft");
    // El último día con datos es hoy (6 de octubre); los que vienen no se eligen.
    await expect(page.getByRole("region", { name: "Gastado" }).getByRole("heading")).toHaveText("Martes 6 oct");
    await expect(total(page)).toHaveText("$269.50");
    await page.keyboard.press("ArrowRight");
    await expect(total(page)).toHaveText("$269.50");
    await page.keyboard.press("ArrowLeft");
    await expect(total(page)).toHaveText("$1,420.90");
    await page.keyboard.press("Escape");
    await expect(total(page)).toHaveText("$16,754.70");
  });

  test("arrastrar sobre las barras recorre los días", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    const caja = await page.locator("[data-grafica=barras]").boundingBox();
    if (!caja) throw new Error("sin gráfica");
    const util = caja.width - 40;
    const xDia = (d: number) => caja.x + ((d - 0.5) / 31) * util;
    await page.mouse.move(xDia(1), caja.y + 100);
    await page.mouse.down();
    await page.mouse.move(xDia(3), caja.y + 100, { steps: 4 });
    await expect(total(page)).toHaveText("$1,178.00");
    await page.mouse.move(xDia(5), caja.y + 100, { steps: 4 });
    await expect(total(page)).toHaveText("$1,420.90");
    await page.mouse.up();
    // Al soltar, se queda el día elegido.
    await expect(total(page)).toHaveText("$1,420.90");
  });

  test("filtrar por categoría: total, subcategorías y quitar el filtro", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    await page.getByRole("group", { name: "Filtrar por categoría" }).getByRole("button", { name: "Comida" }).click();
    await expect(page).toHaveURL(/categoria=cat-comida/);
    await expect(page.getByRole("region", { name: "Gastado" }).getByRole("heading")).toHaveText("Gastado en Comida");
    await expect(total(page)).toHaveText("$1,952.90");
    const subs = page.getByRole("region", { name: "Por subcategoría" });
    await expect(subs.getByRole("heading")).toHaveText("Comida por subcategoría");
    await expect(subs.locator("[data-categoria]")).toHaveCount(4);
    await expect(subs.locator("[data-categoria]").first()).toContainText("Súper");
    // En el filtro no van "Necesidades y gustos" ni lo que entró.
    await expect(page.getByRole("region", { name: "Necesidades y gustos" })).toHaveCount(0);
    await expect(page.getByText("Entró", { exact: true })).toHaveCount(0);
    // Una subcategoría lleva a sus movimientos.
    await subs.locator("[data-categoria=cat-super]").click();
    await expect(page).toHaveURL(/#movimientos\?mes=2026-10&tipo=gasto&categoria=cat-super$/);
    await page.goBack();
    await page.getByRole("button", { name: "Todo", exact: true }).click();
    await expect(page).not.toHaveURL(/categoria=/);
    await expect(total(page)).toHaveText("$16,754.70");
  });

  test("tocar una categoría de la lista filtra por ella", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    const lista = page.getByRole("region", { name: "Por categoría" });
    await expect(lista.locator("[data-categoria]").first()).toContainText("Vivienda");
    await lista.locator("[data-categoria=cat-transporte]").click();
    await expect(page).toHaveURL(/categoria=cat-transporte/);
    await expect(total(page)).toHaveText("$1,032.50");
  });

  test("lo que noté: avisa que Comida subió y lleva a esos gastos", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    const sube = page.locator("[data-insight=sube]");
    await expect(sube).toContainText("Comida subió 99% a estas alturas.");
    await expect(sube).toContainText("$1,950 contra $980 en septiembre.");
    await sube.getByRole("button", { name: "Ver gastos" }).click();
    await expect(page).toHaveURL(/#movimientos\?mes=2026-10&tipo=gasto&categoria=cat-comida$/);
  });

  test("calendario: tocar un día muestra sus gastos y abre el detalle", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    const cal = page.getByRole("region", { name: "Calendario" });
    // Los días que vienen no se tocan.
    await expect(cal.getByRole("button", { name: /^7 de oct/ })).toBeDisabled();
    await cal.getByRole("button", { name: /^5 de oct/ }).click();
    const dia = page.getByTestId("dia-elegido");
    await expect(dia).toContainText("Ayer");
    await expect(dia).toContainText("$1,420.90");
    await expect(dia.getByRole("button")).toHaveCount(3);
    await expect(dia.getByRole("button").first()).toContainText("Walmart");
    await dia.getByRole("button", { name: /Walmart/ }).click();
    await expect(page).toHaveURL(/#movimientos\?detalle=mov-004$/);
    await expect(page.getByRole("heading", { name: "Walmart" })).toBeVisible();
  });

  test("cómo pagas: por cuenta, y lo que no dijo aparte", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    const pagos = page.getByRole("region", { name: "Cómo pagas" });
    await expect(pagos).toContainText("Nu");
    await expect(pagos).toContainText("$1,245.90");
    await expect(pagos).toContainText("BBVA");
    await expect(pagos).toContainText("$985.00");
    await expect(pagos).toContainText("Sin decir");
  });

  test("dónde gastas más: tocar un lugar busca sus movimientos", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    const lugares = page.getByRole("region", { name: "Dónde gastas más" });
    const primero = lugares.getByRole("button", { name: /Walmart/ });
    await expect(primero).toContainText("1 vez");
    await primero.click();
    await expect(page).toHaveURL(/#movimientos\?mes=2026-10&q=Walmart$/);
  });

  test("6 meses con historia: semanas, lo que quedó cada mes y meses en rojo", async ({ page }) => {
    await prepararSesion(page, conHistorial(new ApiFalsa()));
    await page.goto("/#analisis?periodo=6m");
    await expect(titulo(page)).toHaveText("may – oct 2026");
    await expect(page.locator("[data-grafica=barras] rect[data-indice]")).not.toHaveCount(0);
    await expect(page.locator("[data-insight=rojos]")).toContainText("En 2 de 6 meses gastaste más de lo que te entró.");
    const flujo = page.getByRole("region", { name: "Lo que te quedó" });
    await expect(flujo).toContainText("Octubre");
    await expect(flujo.getByRole("img")).toBeVisible();
    // La rejilla de días en vez del calendario.
    await expect(page.getByRole("region", { name: "Calendario" }).getByRole("img")).toBeVisible();
    await expect(page.locator("[data-fecha]")).toHaveCount(184);
  });

  test("un año: 12 meses y el más tranquilo", async ({ page }) => {
    await prepararSesion(page, conHistorial(new ApiFalsa()));
    await page.goto("/#analisis?periodo=anio");
    await expect(titulo(page)).toHaveText("nov 2025 – oct 2026");
    await expect(page.locator("[data-grafica=barras] text").filter({ hasText: /^[A-Z]$/ })).toHaveCount(12);
    await expect(page.locator("[data-insight=mejor]")).toContainText("fue tu mes más tranquilo");
    // El año anterior casi no tiene registros: no se compara.
    await expect(page.getByTestId("comparacion")).toContainText("Todavía no hay con qué comparar");
  });

  test("pedirle un análisis a la IA abre el chat con la pregunta", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#analisis");
    await page.getByRole("button", { name: /Pedirle un análisis a la IA/ }).click();
    await expect(page).toHaveURL(/#chat$/);
    await expect.poll(() => api.de("POST", "/v1/hablar").length).toBe(1);
    expect((api.de("POST", "/v1/hablar")[0]?.cuerpo as { texto: string }).texto).toBe(
      "Analiza mis gastos de Octubre 2026 contra septiembre: qué cambió, qué fugas ves y qué me recomiendas.",
    );
  });

  test("si no carga, dice por qué y se puede reintentar", async ({ page }) => {
    await prepararSesion(page);
    let fallar = true;
    await page.route(/\/v1\/movimientos\?/, (route) =>
      fallar ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Rango inválido." }) }) : route.fallback(),
    );
    await page.goto("/#analisis");
    await expect(page.getByText("No pudimos cargar tu análisis")).toBeVisible();
    await expect(page.getByText("Rango inválido.")).toBeVisible();
    fallar = false;
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(total(page)).toHaveText("$16,754.70");
  });

  test("sin movimientos, lo dice en vez de gráficas vacías", async ({ page }) => {
    const api = new ApiFalsa();
    api.movimientos = [];
    await prepararSesion(page, api);
    await page.goto("/#analisis");
    await expect(total(page)).toHaveText("$0.00");
    await expect(page.getByText("Sin movimientos en este periodo")).toBeVisible();
    await expect(page.getByRole("region", { name: "Lo que noté" })).toHaveCount(0);
  });

  test("los gastos en otra moneda no suman y se avisa", async ({ page }) => {
    const api = new ApiFalsa();
    const base = api.movimientos[0]!;
    api.movimientos.push({ ...base, id: "mov-usd", moneda: "USD", montoCentavos: 2_000, monto: "20.00", fecha: HOY });
    await prepararSesion(page, api);
    await page.goto("/#analisis");
    await expect(total(page)).toHaveText("$16,754.70");
    await expect(page.getByText("1 gasto en otra moneda no entra en las sumas.")).toBeVisible();
  });

  test("un gasto nuevo se ve al volver a Análisis", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#analisis");
    await expect(total(page)).toHaveText("$16,754.70");
    await page.goto("/#movimientos");
    await page.getByRole("button", { name: "Agregar movimiento" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.locator("#monto").fill("245.30");
    await hoja.getByLabel("Categoría").selectOption({ label: "Restaurantes" });
    await hoja.getByRole("button", { name: "Agregar" }).click();
    await expect(hoja).toBeHidden();
    await page.goto("/#analisis");
    await expect(total(page)).toHaveText("$17,000.00");
  });

  test("a 320 de ancho no hay desplazamiento de lado", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await prepararSesion(page, conHistorial(new ApiFalsa()));
    for (const periodo of ["semana", "mes", "6m", "anio"]) {
      await page.goto(`/#analisis?periodo=${periodo}`);
      await expect(total(page)).toBeVisible();
      await page.waitForTimeout(300);
      const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(ancho, periodo).toBeLessThanOrEqual(320);
      // Ningún monto de la tarjeta se corta con "…".
      const cortados = await page.evaluate(() =>
        [...document.querySelectorAll('[aria-label="Gastado"] .truncate')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent),
      );
      expect(cortados, periodo).toEqual([]);
    }
  });

  test("sin conexión solo se guarda el periodo en pantalla, no cada uno que se recorre", async ({ page }) => {
    await prepararSesion(page, conHistorial(new ApiFalsa()));
    const guardados = () =>
      page.evaluate(() => {
        const cache = JSON.parse(localStorage.getItem("fa_cache") ?? "{}") as { clientState?: { queries?: { queryKey: unknown[] }[] } };
        return (cache.clientState?.queries ?? []).filter((q) => q.queryKey[1] === "analisis").map((q) => q.queryKey.slice(2).join(".."));
      });
    await page.goto("/#analisis?periodo=anio");
    await expect(titulo(page)).toHaveText("nov 2025 – oct 2026");
    await page.getByRole("radio", { name: "6M" }).click();
    await expect(titulo(page)).toHaveText("may – oct 2026");
    await page.getByRole("radio", { name: "S" }).click();
    await expect(total(page)).toHaveText("$1,690.40");
    await expect.poll(guardados, { timeout: 5_000 }).toEqual(["2026-09-28..2026-10-11"]);
  });

  test("con localStorage casi lleno, el caché se sigue guardando (quita lo más viejo)", async ({ page }) => {
    // Llena localStorage hasta dejar ~40 KB libres: el año de Análisis (~100 KB) no cabe junto con lo demás.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("fa_lleno")) return;
      sessionStorage.setItem("fa_lleno", "1");
      const bloque = "x".repeat(256 * 1024);
      let i = 0;
      try {
        for (; i < 400; i++) localStorage.setItem(`relleno-${i}`, bloque);
      } catch {
        // lleno
      }
      for (let tam = 128 * 1024; tam >= 1024; tam = Math.floor(tam / 2)) {
        try {
          for (;;) localStorage.setItem(`relleno-${i++}`, "y".repeat(tam));
        } catch {
          // ya no cabe uno de este tamaño
        }
      }
      // Deja espacio para el token y para el caché chico de siempre.
      localStorage.removeItem(`relleno-${i - 1}`);
      for (let k = 0; k < 400; k++) {
        if (localStorage.getItem(`relleno-${k}`)?.length === 256 * 1024) {
          localStorage.setItem(`relleno-${k}`, "x".repeat(256 * 1024 - 40 * 1024));
          break;
        }
      }
    });
    await prepararSesion(page, conHistorial(new ApiFalsa()));
    await page.goto("/#analisis?periodo=anio");
    await expect(titulo(page)).toHaveText("nov 2025 – oct 2026");
    // El caché sí se escribió (sin reintento, el error de cuota lo dejaba sin guardar nada).
    await expect
      .poll(() => page.evaluate(() => (localStorage.getItem("fa_cache") ?? "").length), { timeout: 5_000 })
      .toBeGreaterThan(0);
    const cache = await page.evaluate(() => localStorage.getItem("fa_cache") ?? "");
    expect(cache.length).toBeLessThan(40 * 1024);
  });
});
