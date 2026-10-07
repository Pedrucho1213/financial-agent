import { expect, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";

test.describe("Detalle de un registro", () => {
  test("una notificación abre el detalle directo; «Atrás» lleva a Movimientos", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#movimientos?detalle=mov-001");
    await expect(page.getByRole("heading", { name: "Starbucks" })).toBeVisible();
    await expect(page.getByText("−$85.00")).toBeVisible();
    await expect(page.getByText("«gasté 85 en un café en el Starbucks de Reforma»")).toBeVisible();
    await expect(page.getByText("Por voz")).toBeVisible();
    await expect(page.getByText("Pagado con")).toBeVisible();
    // Tiene ubicación: un mapa fijo con el lugar.
    await expect(page.getByRole("img", { name: "Mapa de dónde gastas" })).toBeVisible();
    await expect(page.locator(".fa-lugar")).toHaveCount(1);

    await page.getByRole("button", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/#movimientos$/);
    await expect(page.getByText("16 movimientos")).toBeVisible();
  });

  test("con editar=1 abre el editor (agregar detalles a un pago de Apple Pay)", async ({ page }) => {
    const api = await prepararSesion(page);
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    await page.goto(`/#movimientos?detalle=${pemex.id}&editar=1`);
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByRole("heading", { name: "Movimiento" })).toBeVisible();
    await hoja.getByLabel("Nota").fill("Tanque lleno");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByText("Apple Pay")).toBeVisible();
    await expect(page.getByText("Tanque lleno")).toBeVisible();
    expect(api.de("PATCH", `/v1/movimientos/${pemex.id}`)[0]?.cuerpo).toEqual({ descripcion: "Tanque lleno" });
  });

  test("editar=1 se quita de la dirección, y otra notificación igual con la app abierta lo abre otra vez", async ({ page }) => {
    const api = await prepararSesion(page);
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    await page.goto(`/#movimientos?detalle=${pemex.id}&editar=1`);
    const hoja = page.getByRole("dialog");
    await expect(hoja).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`detalle=${pemex.id}$`));
    await hoja.getByRole("button", { name: "Cancelar" }).click();
    await expect(hoja).toBeHidden();
    // Recargar no lo vuelve a abrir.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Pemex" })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(hoja).toBeHidden();
    // Tocar otra notificación de ese pago con la app abierta: el service worker manda la dirección.
    const avisar = (url: string) =>
      page.evaluate((u) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { tipo: "fa:abrir", url: u } })), url);
    await avisar(`/#movimientos?detalle=${pemex.id}&editar=1`);
    await expect(hoja).toBeVisible();
    await hoja.getByRole("button", { name: "Cancelar" }).click();
    // Y la de otro pago abre el editor de ese otro.
    await avisar("/#movimientos?detalle=mov-001&editar=1");
    await expect(hoja).toBeVisible();
    await expect(hoja.locator("#monto")).toHaveValue("85");
  });

  test("con cambios sin guardar, el aviso de otro pago pregunta antes de descartarlos (QA-074)", async ({ page }) => {
    const api = await prepararSesion(page);
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    await page.goto(`/#movimientos?detalle=${pemex.id}&editar=1`);
    const hoja = page.getByRole("dialog");
    await hoja.getByLabel("Nota").fill("Tanque lleno");
    const avisar = (url: string) =>
      page.evaluate((u) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { tipo: "fa:abrir", url: u } })), url);
    const preguntas: string[] = [];
    // Primero dice que no: sigue lo escrito.
    page.once("dialog", (d) => (preguntas.push(d.message()), d.dismiss()));
    await avisar("/#movimientos?detalle=mov-001&editar=1");
    await expect.poll(() => preguntas.length).toBe(1);
    expect(preguntas[0]).toContain("cambios sin guardar");
    await expect(hoja.getByLabel("Nota")).toHaveValue("Tanque lleno");
    // Otro aviso del mismo pago no pregunta ni borra nada.
    await avisar(`/#movimientos?detalle=${pemex.id}&editar=1`);
    await expect(hoja.getByLabel("Nota")).toHaveValue("Tanque lleno");
    // Luego dice que sí: abre el del otro pago.
    page.once("dialog", (d) => (preguntas.push(d.message()), d.accept()));
    await avisar("/#movimientos?detalle=mov-001&editar=1");
    await expect(hoja.locator("#monto")).toHaveValue("85");
    expect(preguntas).toHaveLength(2);
  });

  test("varios registros con editar=1: tocar uno abre su editor", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#movimientos?detalle=mov-002,mov-003&editar=1");
    await expect(page.getByRole("heading", { name: "2 registros" })).toBeVisible();
    await page.getByRole("button", { name: /^Oxxo/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/detalle=mov-003$/);
  });

  test("un dictado con varios registros muestra la lista y cada uno abre su detalle", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#movimientos?detalle=mov-002,mov-003");
    await expect(page.getByRole("heading", { name: "2 registros" })).toBeVisible();
    await page.getByRole("button", { name: /^Oxxo/ }).click();
    await expect(page).toHaveURL(/detalle=mov-003$/);
    await expect(page.getByText("«52 en el oxxo»")).toBeVisible();
    await page.getByRole("button", { name: "Atrás" }).click();
    await expect(page.getByRole("heading", { name: "2 registros" })).toBeVisible();
  });

  test("si ya no existe lo dice, sin error", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#movimientos?detalle=mov-999");
    await expect(page.getByText("Este movimiento ya no existe")).toBeVisible();
    await page.getByRole("button", { name: "Ver movimientos" }).click();
    await expect(page.getByText("16 movimientos")).toBeVisible();
  });
});

test.describe("Presupuestos y metas", () => {
  test("desde Inicio: anillos, disponible hoy, presupuestos, metas, préstamos y MSI", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Presupuestos y metas/ }).click();
    await expect(page).toHaveURL(/#plan$/);
    await expect(page.getByRole("heading", { name: "Presupuestos y metas" })).toBeVisible();

    const resumen = page.getByRole("region", { name: "Resumen del plan" });
    await expect(resumen.getByRole("img", { name: /Gastado del presupuesto: \d+%, Mes transcurrido: 19%, Metas: 62%/ })).toBeVisible();
    await expect(resumen.getByText("Día 6 de 31")).toBeVisible();
    await expect(page.getByRole("region", { name: "Disponible hoy" })).toContainText("Hoy puedes gastar");

    // El de entretenimiento ya se pasó (cine de 278 contra un tope de 250).
    await expect(page.getByRole("button", { name: /^Entretenimiento.*Te pasaste \$28\.00/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Todo el mes/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Viaje a Japón/ })).toContainText("/mes");
    await expect(page.getByRole("button", { name: /^Fondo de emergencia/ })).toContainText("¡Lograda!");
    await expect(page.getByText("Juan", { exact: true })).toBeVisible();
    await expect(page.getByText("iPhone 17 Pro Max")).toBeVisible();

    await page.getByRole("button", { name: "Inicio" }).first().click();
    await expect(page).toHaveURL(/\/(#inicio)?$/);
  });

  test("los montos con centavos no se cortan a 390 px (QA-073)", async ({ page }) => {
    const api = await prepararSesion(page);
    api.plan.presupuestos = [
      { id: "pre-1", categoriaId: null, limiteCentavos: 30_000_51 },
      { id: "pre-2", categoriaId: "cat-comida", limiteCentavos: 3_000_51 },
    ];
    api.plan.metas[0]!.objetivoCentavos = 60_000_51;
    await page.goto("/#plan");
    await expect(page.getByRole("region", { name: "Resumen del plan" })).toContainText("de $30,000.51");
    await expect(page.getByRole("button", { name: /^Comida/ })).toContainText("de $3,000.51");
    // Ningún "X de $Y" queda cortado con puntos suspensivos.
    const cortados = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("dd, .truncate")]
        .filter((e) => / de \$/.test(e.textContent ?? "") && e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.textContent),
    );
    expect(cortados).toEqual([]);
  });

  test("crear y cambiar un presupuesto manda el tope en pesos", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#plan");
    await page.getByRole("button", { name: "Agregar presupuesto" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.locator("#monto-presupuesto").fill("1500");
    await hoja.getByLabel("Para").selectOption({ label: "Transporte (todo)" });
    await hoja.getByRole("button", { name: "Crear" }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByRole("button", { name: /^Transporte/ })).toBeVisible();
    expect(api.de("PUT", "/v1/presupuestos")[0]?.cuerpo).toEqual({ categoria_id: "cat-transporte", limite: 1500 });

    // Uno que ya existe no se puede repetir.
    await page.getByRole("button", { name: "Agregar presupuesto" }).click();
    await hoja.getByLabel("Para").selectOption({ label: "Comida (todo)" });
    await expect(hoja.getByText("Ya tienes un presupuesto para eso.")).toBeVisible();
    await hoja.getByRole("button", { name: "Cancelar" }).click();

    await page.getByRole("button", { name: /^Comida/ }).click();
    await hoja.locator("#monto-presupuesto").fill("4000");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PUT", "/v1/presupuestos")[1]?.cuerpo).toEqual({ categoria_id: "cat-comida", limite: 4000 });
    await expect(page.getByRole("button", { name: /^Comida.*de \$4,000/ })).toBeVisible();

    await page.getByRole("button", { name: /^Transporte/ }).click();
    await hoja.getByRole("button", { name: "Quitar presupuesto" }).click();
    await expect(page.getByRole("button", { name: /^Transporte/ })).toHaveCount(0);
  });

  test("metas: crear con fecha, apartar y sacar dinero", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#plan");
    await page.getByRole("button", { name: "Nueva meta" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.getByLabel("Nombre").fill("Laptop");
    await hoja.getByLabel("Objetivo").fill("25000");
    await hoja.getByLabel("Para cuándo").fill("2027-03-01");
    await hoja.getByRole("button", { name: "Crear" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("POST", "/v1/metas")[0]?.cuerpo).toEqual({ nombre: "Laptop", objetivo: 25000, fecha_limite: "2027-03-01" });

    await page.getByRole("button", { name: /^Laptop/ }).click();
    await hoja.getByLabel("Monto", { exact: true }).fill("500");
    await hoja.getByRole("button", { name: "Apartar" }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByRole("button", { name: /^Laptop.*\$500 de \$25,000/ })).toBeVisible();

    await page.getByRole("button", { name: /^Laptop/ }).click();
    await hoja.getByLabel("Monto", { exact: true }).fill("200");
    await hoja.getByRole("button", { name: "Sacar" }).click();
    await expect(hoja).toBeHidden();
    const aportes = api.de("POST", /\/v1\/metas\/.+\/aportes/).map((p) => p.cuerpo);
    expect(aportes).toEqual([{ monto: 500 }, { monto: -200 }]);
    await expect(page.getByRole("button", { name: /^Laptop.*\$300 de/ })).toBeVisible();
  });
});

test.describe("Dónde gastas", () => {
  test("el mapa junta los lugares, los ordena y lleva a sus movimientos", async ({ page }) => {
    const api = await prepararSesion(page);
    const mosaicos: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("cartocdn")) mosaicos.push(r.url());
    });
    await page.goto("/#movimientos");
    await page.getByRole("button", { name: "Dónde gastas" }).click();
    await expect(page).toHaveURL(/#mapa$/);
    await expect(page.getByRole("img", { name: "Mapa de dónde gastas" })).toBeVisible();

    const lugares = page.getByRole("button").filter({ hasText: /veces|vez/ });
    await expect(lugares).toHaveCount(5);
    await expect(lugares.first()).toContainText("Walmart");
    // Los dos Oxxo a unos metros son el mismo lugar.
    await expect(page.getByRole("button", { name: /^2 Oxxo|Oxxo.*2 veces/ })).toBeVisible();
    await expect(page.locator(".fa-lugar")).toHaveCount(5);
    // Sin calles no se pide nada a CARTO y cada lugar lleva su nombre.
    await expect(page.locator(".fa-etiqueta").filter({ hasText: "Walmart" })).toBeVisible();
    expect(mosaicos).toHaveLength(0);

    await lugares.first().click();
    await expect(page.locator(".fa-lugar-elegido")).toHaveCount(1);
    await page.getByRole("button", { name: /Walmart.*Ver/ }).click();
    await expect(page).toHaveURL(/#movimientos\?q=Walmart/);

    // Tres meses pide desde agosto.
    await page.goBack();
    await page.getByRole("radio", { name: "3 meses" }).click();
    await expect.poll(() => api.de("GET", "/v1/movimientos").some((p) => p.consulta.get("desde") === "2026-08-01")).toBe(true);
  });

  test("«Mostrar calles» pide el fondo a CARTO y se recuerda", async ({ page }) => {
    await prepararSesion(page);
    const mosaicos: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("cartocdn")) mosaicos.push(r.url());
    });
    await page.goto("/#mapa");
    await expect(page.locator(".fa-lugar")).toHaveCount(5);
    await page.getByRole("switch", { name: "Mostrar calles" }).click();
    await expect.poll(() => mosaicos.length).toBeGreaterThan(0);
    await expect(page.locator(".fa-etiqueta")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("switch", { name: "Mostrar calles" })).toBeChecked();
  });

  test("el nombre de un comercio se muestra como texto, nunca como HTML", async ({ page }) => {
    const api = new ApiFalsa();
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    pemex.comercio = '<img src=x id="inyectado"><a href="https://ejemplo.com">Gana</a>';
    await prepararSesion(page, api);
    await page.goto("/#mapa");
    await expect(page.locator(".fa-etiqueta").filter({ hasText: "<img src=x" })).toBeVisible();
    await expect(page.locator("#inyectado")).toHaveCount(0);
    await expect(page.locator(".fa-mapa a[href='https://ejemplo.com']")).toHaveCount(0);
  });

  test("sin ubicaciones explica de dónde salen", async ({ page }) => {
    const api = new ApiFalsa();
    for (const m of api.movimientos) {
      m.lat = null;
      m.lon = null;
    }
    await prepararSesion(page, api);
    await page.goto("/#mapa");
    await expect(page.getByText("Aún no hay gastos con ubicación")).toBeVisible();
  });
});

test.describe("Avisos del revisor", () => {
  test("en Inicio: el más importante primero, tocar lleva a su pantalla y la X lo descarta", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/");
    const avisos = page.getByRole("region", { name: "Avisos" });
    await expect(avisos.getByRole("button").first()).toContainText("Te pasaste en Entretenimiento");

    await avisos.getByRole("button", { name: "Descartar: Gastos hormiga en Oxxo" }).click();
    await expect(avisos.getByText("Gastos hormiga en Oxxo")).toHaveCount(0);
    await expect.poll(() => api.de("POST", "/v1/avisos/av-1/descartar").length).toBe(1);

    await avisos.getByRole("button", { name: /^Te pasaste en Entretenimiento/ }).click();
    await expect(page).toHaveURL(/#presupuestos$/);
    await expect(page.getByRole("heading", { name: "Presupuestos y metas" })).toBeVisible();
    expect(api.de("POST", "/v1/avisos/av-2/leido")).toHaveLength(1);
    await page.getByRole("button", { name: "Inicio" }).first().click();
    await expect(page.getByRole("region", { name: "Avisos" })).toHaveCount(0);
  });

  test("un enlace con texto busca en Movimientos; #metas baja a las metas", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#movimientos?texto=Oxxo");
    await expect(page.getByLabel("Buscar")).toHaveValue("Oxxo");
    await expect(page.getByText("3 movimientos")).toBeVisible();
    await page.goto("/#metas");
    await expect(page.getByRole("heading", { name: "Metas de ahorro" })).toBeInViewport();
  });
});

test.describe("Servidor sin presupuestos todavía (404)", () => {
  test("Inicio deja solo el mapa, sin avisos, y Presupuestos lo explica sin errores", async ({ page }) => {
    const api = new ApiFalsa();
    api.sinPlan = true;
    await prepararSesion(page, api);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Dónde gastas/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Presupuestos y metas/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Avisos" })).toHaveCount(0);
    await page.goto("/#plan");
    await expect(page.getByText("Aún no está en tu servidor")).toBeVisible();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });
});
