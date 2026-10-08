import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas } from "./api-falsa-cuentas";

// Cuentas, tarjetas, mover dinero y etiquetas contra la API falsa (contrato del PR #38).
// Hoy es 6 de octubre de 2026. BBVA $18,450, Efectivo $1,200, Revolut sin saldo; Nu debe $4,500 de $30,000
// (paga el 20); Banamex Oro debe $27,600 de $30,000 (paga el 8); Liverpool archivada.

const abrir = async (page: Page, hash: string, api = conCuentas(new ApiFalsa())) => {
  await prepararSesion(page, api);
  await page.goto(`/${hash}`);
  return api;
};
const fila = (page: Page, nombre: string) => page.locator(`[data-cuenta="${nombre}"]`);

test.describe("Inicio con cuentas", () => {
  test("en vez del balance del mes (negativo) muestra lo que tiene, y lleva a sus cuentas", async ({ page }) => {
    await abrir(page, "#inicio");
    await expect(page.getByRole("region", { name: "Balance" })).toHaveCount(0);
    const tienes = page.getByRole("button", { name: /^Tienes −\$12,450\.00/ });
    await expect(tienes).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cuentas y tarjetas −\$12,450\.00 · debes \$32,100\.00/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Etiquetas/ })).toBeVisible();
    await tienes.click();
    await expect(page).toHaveURL(/#cuentas$/);
    await expect(page.getByTestId("neto")).toHaveText("−$12,450.00");
  });

  test("sin saldos dichos queda el balance, con la pregunta de cuánto tiene", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    for (const c of api.cuentas!.cuentas) Object.assign(c, { saldo: null, deuda: null });
    await abrir(page, "#inicio", api);
    await expect(page.getByRole("region", { name: "Balance" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cuentas y tarjetas No sé cuánto tienes todavía/ })).toBeVisible();
    await page.getByRole("button", { name: "¿Cuánto tienes?" }).click();
    await expect(page).toHaveURL(/#cuentas$/);
    await expect(page.getByText("Todavía no sé cuánto tienes")).toBeVisible();
    await expect(page.getByTestId("neto")).toHaveCount(0);
  });

  test("un servidor sin cuentas (404) deja Inicio como estaba y la pantalla lo explica", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#inicio");
    await expect(page.getByRole("region", { name: "Balance" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Análisis Tendencias/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cuentas y tarjetas/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Etiquetas/ })).toHaveCount(0);
    await page.goto("/#cuentas");
    await expect(page.getByText("Aún no está en tu servidor")).toBeVisible();
    await page.goto("/#etiquetas");
    await expect(page.getByText("Aún no está en tu servidor")).toBeVisible();
  });
});

test.describe("Cuentas y tarjetas", () => {
  test("resumen: lo que tiene, dónde está, crédito usado y lo que no se sabe", async ({ page }) => {
    await abrir(page, "#cuentas");
    const resumen = page.getByRole("region", { name: "Lo que tienes" });
    await expect(page.getByTestId("neto")).toHaveText("−$12,450.00");
    await expect(resumen).toContainText("$19,650.00 en cuentas menos $32,100.00 que debes");
    // Solo los saldos conocidos y positivos se reparten: BBVA 94%, Efectivo 6%.
    await expect(resumen.getByRole("img", { name: "BBVA: 94%, Efectivo: 6%" })).toBeVisible();
    await expect(page.getByTestId("credito-total")).toContainText("54%");
    await expect(page.getByTestId("credito-total")).toContainText("Te quedan $27,900.00 de $60,000.00");
    await expect(page.getByTestId("sin-saldo")).toHaveText("No sé cuánto hay en Revolut: no entra en la suma.");
    await expect(page.getByTestId("observacion")).toHaveText("Banamex Oro está al 92% de su límite y se paga en 2 días.");
  });

  test("las cuentas con saldo van primero; la que no se sabe dice que no se sabe, nunca $0", async ({ page }) => {
    await abrir(page, "#cuentas");
    const cuentas = page.getByRole("region", { name: "Lo que tienes" }).locator("..").locator("[data-cuenta]");
    await expect(cuentas).toHaveText([/^BBVA/, /^Efectivo/, /^Revolut/, /^Banamex Oro/, /^Nu/]);
    await expect(fila(page, "BBVA")).toContainText("Este mes +$18,750 −$3,400");
    await expect(fila(page, "BBVA")).toContainText("$18,450.00");
    await expect(fila(page, "Revolut")).toContainText("No sé cuánto hay");
    await expect(fila(page, "Revolut")).not.toContainText("$");
    await expect(fila(page, "Banamex Oro")).toContainText("$2,400 disponible");
    await expect(fila(page, "Banamex Oro")).toContainText("$27,600.00debes");
    await expect(fila(page, "Banamex Oro")).toContainText("Pagar en 2 días");
    await expect(fila(page, "Nu")).toContainText("Pagar en 14 días");
    // La archivada no aparece hasta pedirla.
    await expect(fila(page, "Liverpool")).toHaveCount(0);
    await page.getByRole("button", { name: "Ver archivadas" }).click();
    await expect(page).toHaveURL(/#cuentas\?archivadas=1$/);
    await expect(fila(page, "Liverpool")).toBeVisible();
  });

  test("una tarjeta: uso, deuda, disponible y sus fechas", async ({ page }) => {
    await abrir(page, "#cuentas");
    await fila(page, "Banamex Oro").click();
    await expect(page).toHaveURL(/#cuenta\?id=cta-banamex$/);
    await expect(page.getByRole("heading", { name: "Banamex Oro", level: 1 })).toBeVisible();
    await expect(page.getByTestId("uso")).toHaveText("92%");
    await expect(page.getByTestId("deuda")).toHaveText("$27,600.00");
    await expect(page.getByTestId("disponible")).toHaveText("$2,400.00 de $30,000.00");
    const tarjeta = page.getByRole("region", { name: "Tarjeta" });
    await expect(tarjeta).toContainText("Corte18 oct");
    await expect(tarjeta).toContainText("en 12 días");
    await expect(tarjeta).toContainText("Pago8 oct");
    await expect(tarjeta).toContainText("en 2 días");
    await page.getByRole("button", { name: "Cuentas" }).click();
    await expect(page).toHaveURL(/#cuentas$/);
  });

  test("una cuenta: saldo, lo último que se movió (con el signo del lado que le toca) y todos sus movimientos", async ({ page }) => {
    const api = await abrir(page, "#cuenta?id=cta-bbva");
    await expect(page.getByTestId("saldo")).toHaveText("$18,450.00");
    const saldo = page.getByRole("region", { name: "Saldo" });
    await expect(saldo).toContainText("Entró este mes+$18,750.00");
    await expect(saldo).toContainText("Salió este mes−$3,400.00");
    const recientes = page.getByRole("region", { name: "Recientes" });
    // El traspaso de Nu llega a BBVA: suma. Pemex sale de BBVA: resta.
    await expect(recientes.getByRole("button", { name: /Traspaso a ahorro/ })).toContainText("+$2,000.00");
    await expect(recientes.getByRole("button", { name: /Traspaso a ahorro/ })).toContainText("desde Nu");
    await expect(recientes.getByRole("button", { name: /Pemex/ })).toContainText("−$900.00");
    await page.getByRole("button", { name: /^Movimientos/ }).first().click();
    await expect(page).toHaveURL(/#movimientos\?.*cuenta=cta-bbva/);
    await expect(page.getByRole("button", { name: "Quitar filtro de cuenta BBVA" })).toBeVisible();
    // Starbucks y Pemex salieron de BBVA; el traspaso llegó.
    await expect(page.getByText("3 movimientos")).toBeVisible();
    await expect(page.locator("[data-movimiento]").filter({ hasText: "Nu → BBVA" })).toBeVisible();
    expect(api.de("GET", "/v1/movimientos").at(-1)?.consulta.get("cuenta_id")).toBe("cta-bbva");
    await page.getByRole("button", { name: "Quitar filtro de cuenta BBVA" }).click();
    await expect(page).not.toHaveURL(/cuenta=/);
  });

  test("un enlace a una cuenta que no existe lo dice", async ({ page }) => {
    await abrir(page, "#cuenta?id=cta-no-existe");
    await expect(page.getByText("No encontré esa cuenta")).toBeVisible();
    await page.getByRole("button", { name: "Ver mis cuentas" }).click();
    await expect(page).toHaveURL(/#cuentas$/);
  });

  test("si falla la carga, deja reintentar", async ({ page }) => {
    let fallar = true;
    await prepararSesion(page, conCuentas(new ApiFalsa()));
    await page.route(/\/v1\/cuentas$/, (r) => (fallar ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Se cayó la base."}' }) : r.fallback()));
    await page.goto("/#cuentas");
    await expect(page.getByText("No pudimos cargar tus cuentas")).toBeVisible({ timeout: 10_000 });
    fallar = false;
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByTestId("neto")).toHaveText("−$12,450.00");
  });

  test("sin cuentas, explica y deja agregar la primera", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    api.cuentas!.cuentas = [];
    await abrir(page, "#cuentas", api);
    await expect(page.getByText("Todavía no tienes cuentas")).toBeVisible();
    await page.getByRole("button", { name: "Agregar cuenta" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("Decir cuánto hay y agregar cuentas", () => {
  test("decir el saldo de una cuenta que no se sabía manda solo el saldo", async ({ page }) => {
    const api = await abrir(page, "#cuentas");
    await fila(page, "Revolut").click();
    await expect(page.getByText("No sé cuánto hay")).toBeVisible();
    await page.getByRole("button", { name: "Decir cuánto hay" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.getByLabel("Tienes").fill("5,000");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PATCH", "/v1/cuentas/cta-revolut")[0]?.cuerpo).toEqual({ saldo: 5000 });
    await expect(page.getByTestId("saldo")).toHaveText("$5,000.00");
    await page.getByRole("button", { name: "Cuentas" }).click();
    await expect(page.getByTestId("neto")).toHaveText("−$7,450.00");
    await expect(page.getByTestId("sin-saldo")).toHaveCount(0);
  });

  test("agregar una tarjeta de crédito con deuda, límite y fechas", async ({ page }) => {
    const api = await abrir(page, "#cuentas");
    await page.getByRole("button", { name: "Agregar cuenta o tarjeta" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.getByLabel("Nombre").fill("Amex");
    await hoja.getByRole("radio", { name: "Crédito" }).click();
    await hoja.getByLabel("Debes").fill("1000");
    await hoja.getByLabel("Límite", { exact: true }).fill("20000");
    await expect(hoja).toContainText("Te quedan $19,000.00 disponibles.");
    await hoja.getByLabel("Día de corte").selectOption("28");
    await hoja.getByLabel("Día límite de pago").selectOption("15");
    await hoja.getByRole("button", { name: "Agregar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("POST", "/v1/cuentas")[0]?.cuerpo).toEqual({ nombre: "Amex", tipo: "credito", deuda: 1000, limite: 20000, dia_corte: 28, dia_pago: 15 });
    await expect(page.getByText("Agregué Amex")).toBeVisible();
    await expect(fila(page, "Amex")).toContainText("$19,000 disponible");
  });

  test("el límite en cero no se puede guardar; un nombre repetido lo dice el servidor (409)", async ({ page }) => {
    const api = await abrir(page, "#cuentas");
    await page.getByRole("button", { name: "Agregar cuenta o tarjeta" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.getByLabel("Nombre").fill("Otra");
    await hoja.getByRole("radio", { name: "Crédito" }).click();
    await hoja.getByLabel("Límite", { exact: true }).fill("0");
    await expect(hoja).toContainText("El límite tiene que ser mayor que cero.");
    await expect(hoja.getByRole("button", { name: "Agregar" })).toBeDisabled();
    await hoja.getByLabel("Límite", { exact: true }).fill("");
    await hoja.getByLabel("Nombre").fill("bbva");
    await hoja.getByRole("radio", { name: "Débito" }).click();
    await hoja.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByText("Ya tienes una cuenta llamada BBVA.")).toBeVisible();
    await expect(hoja).toBeVisible();
    // Vacío no es cero: sin saldo, no se manda.
    expect(api.de("POST", "/v1/cuentas")[0]?.cuerpo).toEqual({ nombre: "bbva", tipo: "debito" });
  });

  test("editar manda solo lo que cambió; borrar el límite lo quita (null)", async ({ page }) => {
    const api = await abrir(page, "#cuenta?id=cta-nu");
    await page.getByRole("button", { name: "Editar cuenta" }).click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByLabel("Debes")).toHaveValue("4500");
    await expect(hoja.getByLabel("Límite", { exact: true })).toHaveValue("30000");
    await hoja.getByLabel("Debes").fill("3200");
    await hoja.getByLabel("Límite", { exact: true }).fill("");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PATCH", "/v1/cuentas/cta-nu")[0]?.cuerpo).toEqual({ deuda: 3200, limite: null });
    await expect(page.getByTestId("deuda")).toHaveText("$3,200.00");
    await expect(page.getByTestId("uso")).toHaveCount(0);
    // Sin cambios no manda nada.
    await page.getByRole("button", { name: "Editar cuenta" }).click();
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PATCH", "/v1/cuentas/cta-nu")).toHaveLength(1);
  });

  test("archivar con deshacer", async ({ page }) => {
    const api = await abrir(page, "#cuentas");
    await fila(page, "Efectivo").click();
    await page.getByRole("button", { name: "Archivar cuenta" }).click();
    await expect(page).toHaveURL(/#cuentas$/);
    expect(api.de("PATCH", "/v1/cuentas/cta-efectivo")[0]?.cuerpo).toEqual({ archivada: true });
    await expect(fila(page, "Efectivo")).toHaveCount(0);
    await page.getByRole("button", { name: "Deshacer" }).click();
    await expect(fila(page, "Efectivo")).toBeVisible();
    expect(api.de("PATCH", "/v1/cuentas/cta-efectivo")[1]?.cuerpo).toEqual({ archivada: false });
  });
});

test.describe("Mover dinero", () => {
  test("pagar una tarjeta desde su pantalla: ya viene elegida y dice cómo quedaron", async ({ page }) => {
    const api = await abrir(page, "#cuenta?id=cta-nu");
    await page.getByRole("button", { name: "Pagar o abonar" }).click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByRole("radio", { name: "Pagar tarjeta" })).toHaveAttribute("aria-checked", "true");
    await expect(hoja.getByLabel("Tarjeta")).toHaveValue("cta-nu");
    // Solo tarjetas de crédito como destino.
    await expect(hoja.getByLabel("Tarjeta").locator("option")).toHaveText(["Elegir", "Nu (debes $4,500.00)", "Banamex Oro (debes $27,600.00)"]);
    await hoja.locator("#monto-mover").fill("1500");
    await hoja.getByLabel("Desde").selectOption("cta-bbva");
    await hoja.getByRole("button", { name: "Listo" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("POST", "/v1/transferencias")[0]?.cuerpo).toEqual({
      tipo: "pago_tarjeta",
      monto: 1500,
      fecha: "2026-10-06",
      desde_id: "cta-bbva",
      hacia_id: "cta-nu",
    });
    await expect(page.getByText("Pago anotado")).toBeVisible();
    await expect(page.getByText("BBVA: $16,950.00 · Nu: debes $3,000.00")).toBeVisible();
    await expect(page.getByTestId("deuda")).toHaveText("$3,000.00");
  });

  test("transferir pide dos cuentas distintas; retirar no pide destino", async ({ page }) => {
    const api = await abrir(page, "#cuentas");
    await page.getByRole("button", { name: "Mover dinero" }).first().click();
    const hoja = page.getByRole("dialog");
    const listo = hoja.getByRole("button", { name: "Listo" });
    await hoja.locator("#monto-mover").fill("2000");
    await expect(listo).toBeDisabled();
    await hoja.getByLabel("Desde").selectOption("cta-bbva");
    await hoja.getByLabel("Hacia").selectOption("cta-bbva");
    await expect(hoja.getByText("Elige dos cuentas distintas.")).toBeVisible();
    await expect(listo).toBeDisabled();
    await hoja.getByLabel("Hacia").selectOption("cta-revolut");
    await hoja.getByLabel("Nota").fill("Para el viaje");
    await listo.click();
    await expect(hoja).toBeHidden();
    expect(api.de("POST", "/v1/transferencias")[0]?.cuerpo).toEqual({
      tipo: "transferencia",
      monto: 2000,
      fecha: "2026-10-06",
      desde_id: "cta-bbva",
      hacia_id: "cta-revolut",
      descripcion: "Para el viaje",
    });
    await expect(page.getByText("Transferencia anotada")).toBeVisible();

    await page.getByRole("button", { name: "Mover dinero" }).first().click();
    await hoja.getByRole("radio", { name: "Retirar" }).click();
    await expect(hoja.getByLabel("Hacia")).toHaveCount(0);
    // Del efectivo no se retira.
    await expect(hoja.getByLabel("De").locator("option")).not.toContainText(["Efectivo ($1,200.00)"]);
    await hoja.locator("#monto-mover").fill("500");
    await hoja.getByLabel("De").selectOption("cta-bbva");
    await hoja.getByRole("button", { name: "Listo" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("POST", "/v1/transferencias")[1]?.cuerpo).toEqual({ tipo: "retiro", monto: 500, fecha: "2026-10-06", desde_id: "cta-bbva" });
    await expect(page.getByText("Retiro anotado")).toBeVisible();
    await expect(fila(page, "Efectivo")).toContainText("$1,700.00");
  });

  test("un error del servidor se muestra y la hoja sigue abierta", async ({ page }) => {
    await prepararSesion(page, conCuentas(new ApiFalsa()));
    await page.route(/\/v1\/transferencias$/, (r) =>
      r.fulfill({ status: 400, contentType: "application/json", body: '{"error":"El dinero sale y llega a la misma cuenta: pregunta a cuál fue."}' }),
    );
    await page.goto("/#cuenta?id=cta-bbva");
    await page.getByRole("button", { name: "Mover dinero" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.locator("#monto-mover").fill("10");
    await hoja.getByLabel("Hacia").selectOption("cta-efectivo");
    await hoja.getByRole("button", { name: "Listo" }).click();
    await expect(page.getByText("El dinero sale y llega a la misma cuenta: pregunta a cuál fue.")).toBeVisible();
    await expect(hoja).toBeVisible();
  });
});

test.describe("Etiquetas", () => {
  test("lo de este mes: la activa, en qué se fue y la lista; Siempre pide sin periodo", async ({ page }) => {
    const api = await abrir(page, "#etiquetas");
    await expect(page.locator('[data-activa="Viaje oaxaca"]')).toHaveText("#Viaje oaxaca se pone sola en tus gastos hasta el 9 oct.");
    const grafica = page.locator('[data-grafica="etiquetas"]');
    await expect(grafica.locator("[data-barra-etiqueta]")).toHaveText(["#Viaje oaxaca$1,386.00", "#Trabajo$1,032.50"]);
    await expect(page.locator("[data-etiqueta]")).toHaveText([/^Viaje oaxaca2 movimientos · último 4 oct\$1,386\.00/, /^Trabajo2 movimientos/, /^DeducibleSin usar este mes/]);
    expect(api.de("GET", "/v1/etiquetas").at(-1)?.consulta.get("periodo")).toBe("este_mes");
    await page.getByRole("radio", { name: "Siempre" }).click();
    await expect(page).toHaveURL(/#etiquetas\?periodo=todo$/);
    await expect(page.locator('[data-etiqueta="Deducible"]')).toContainText("Sin usar todavía");
    expect(api.de("GET", "/v1/etiquetas").at(-1)?.consulta.has("periodo")).toBe(false);
  });

  test("crear una que se pone sola por unos días", async ({ page }) => {
    const api = await abrir(page, "#etiquetas");
    await page.getByRole("button", { name: "Nueva etiqueta" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.getByLabel("Nombre").fill("#Cumple mamá");
    await hoja.getByLabel("Ponerla sola en mis gastos").click();
    await hoja.locator("#etiqueta-hasta").fill("2026-10-05");
    await expect(hoja.getByText("La fecha final es antes de la de inicio.")).toBeVisible();
    await expect(hoja.getByRole("button", { name: "Crear" })).toBeDisabled();
    await hoja.locator("#etiqueta-hasta").fill("2027-02-01");
    await expect(hoja.getByText("Se activa por 92 días como máximo.")).toBeVisible();
    await hoja.locator("#etiqueta-hasta").fill("2026-10-12");
    await hoja.getByRole("button", { name: "Crear" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("POST", "/v1/etiquetas")[0]?.cuerpo).toEqual({ nombre: "Cumple mamá", activa_desde: "2026-10-06", activa_hasta: "2026-10-12" });
    await expect(page.getByText("Creé #Cumple mamá")).toBeVisible();
    await expect(page.locator('[data-activa="Cumple mamá"]')).toBeVisible();
  });

  test("apagar la activa, renombrar, ver sus movimientos y eliminar", async ({ page }) => {
    const api = await abrir(page, "#etiquetas");
    await page.locator('[data-activa="Viaje oaxaca"]').click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByLabel("Ponerla sola en mis gastos")).toBeChecked();
    await hoja.getByLabel("Ponerla sola en mis gastos").click();
    await hoja.getByLabel("Nombre").fill("Oaxaca");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PATCH", "/v1/etiquetas/eti-viaje")[0]?.cuerpo).toEqual({ nombre: "Oaxaca", activa_hasta: null });
    await expect(page.locator("[data-activa]")).toHaveCount(0);

    await page.locator('[data-etiqueta="Trabajo"]').click();
    await hoja.getByRole("button", { name: "Ver sus movimientos" }).click();
    await expect(page).toHaveURL(/#movimientos\?.*etiqueta=eti-trabajo/);
    await expect(page.getByRole("button", { name: "Quitar filtro de etiqueta Trabajo" })).toBeVisible();
    await expect(page.getByText("2 movimientos")).toBeVisible();
    expect(api.de("GET", "/v1/movimientos").at(-1)?.consulta.get("etiqueta_id")).toBe("eti-trabajo");

    await page.goto("/#etiquetas");
    await page.locator('[data-etiqueta="Deducible"]').click();
    page.once("dialog", (d) => void d.accept());
    await hoja.getByRole("button", { name: "Eliminar etiqueta" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("DELETE", "/v1/etiquetas/eti-deducible")).toHaveLength(1);
    await expect(page.locator('[data-etiqueta="Deducible"]')).toHaveCount(0);
  });

  test("al anotar un gasto se ponen etiquetas, y una nueva se crea ahí mismo", async ({ page }) => {
    const api = await abrir(page, "#movimientos");
    await page.getByRole("button", { name: "Agregar" }).first().click();
    const hoja = page.getByRole("dialog");
    await hoja.locator("#monto").fill("350");
    await hoja.getByRole("button", { name: "#Trabajo" }).click();
    await expect(hoja.getByRole("button", { name: "#Trabajo" })).toHaveAttribute("aria-pressed", "true");
    await hoja.getByLabel("Nueva etiqueta").fill("Cliente acme");
    await hoja.getByLabel("Nueva etiqueta").press("Enter");
    await expect(hoja.getByRole("button", { name: "#Cliente acme" })).toHaveAttribute("aria-pressed", "true");
    await hoja.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("POST", "/v1/etiquetas")[0]?.cuerpo).toEqual({ nombre: "Cliente acme" });
    expect(api.de("POST", "/v1/movimientos")[0]?.cuerpo).toMatchObject({ tipo: "gasto", monto: 350, etiquetas: ["eti-trabajo", "eti-nueva-1"] });
    await expect(page.locator("[data-movimiento]").first()).toContainText("#Trabajo #Cliente acme");
  });

  test("editar: quitar una etiqueta manda la lista completa; un traspaso pide a dónde", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    const pemex = api.movimientos.find((m) => m.comercio === "Pemex")!;
    await abrir(page, `#movimientos?detalle=${pemex.id}`, api);
    await expect(page.getByText("#Viaje oaxaca #Trabajo")).toBeVisible();
    await page.getByRole("button", { name: "Editar" }).click();
    const hoja = page.getByRole("dialog");
    await hoja.getByRole("button", { name: "#Viaje oaxaca" }).click();
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PATCH", `/v1/movimientos/${pemex.id}`)[0]?.cuerpo).toEqual({ etiquetas: ["eti-trabajo"] });

    await page.getByRole("button", { name: "Editar" }).click();
    await hoja.getByRole("radio", { name: "Traspaso" }).click();
    await expect(hoja.getByLabel("Categoría")).toHaveCount(0);
    await expect(hoja.locator("label[for=cuenta]")).toHaveText("Desde");
    await hoja.getByLabel("Hacia").fill("Revolut");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PATCH", `/v1/movimientos/${pemex.id}`)[1]?.cuerpo).toEqual({ tipo: "transferencia", categoria_id: null, cuenta_destino: "Revolut" });
    await expect(page.getByRole("main")).toContainText("HaciaRevolut");
  });

  test("Análisis suma por etiqueta y lleva a sus movimientos", async ({ page }) => {
    await abrir(page, "#analisis");
    const seccion = page.getByRole("region", { name: "Por etiqueta" });
    await expect(seccion.locator("[data-etiqueta]")).toHaveText([/^Viaje oaxaca2 gastos\$1,386\.00/, /^Trabajo2 gastos\$1,032\.50/]);
    await seccion.locator('[data-etiqueta="Trabajo"]').click();
    await expect(page).toHaveURL(/#movimientos\?.*etiqueta=eti-trabajo/);
    await expect(page.getByText("2 movimientos")).toBeVisible();
  });
});

test.describe("Cuentas a 320 de ancho", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("ninguna pantalla se desplaza de lado ni corta montos", async ({ page }) => {
    await prepararSesion(page, conCuentas(new ApiFalsa()));
    for (const hash of ["#cuentas", "#cuenta?id=cta-nu", "#cuenta?id=cta-banamex", "#cuenta?id=cta-bbva", "#etiquetas", "#inicio"]) {
      await page.goto(`/${hash}`);
      // La letra más ancha que puede tocar (la de Linux en CI) para que la prueba no dependa de la máquina.
      await page.addStyleTag({ content: '*{font-family:"DejaVu Sans",Verdana,sans-serif !important}' });
      await page.waitForTimeout(400);
      const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(ancho, hash).toBeLessThanOrEqual(320);
      const cortados = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="neto"], [data-testid="deuda"], [data-testid="saldo"], [data-testid="disponible"]')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent),
      );
      expect(cortados, hash).toEqual([]);
    }
  });
});

test.describe("Lo que encontró la revisión del #42", () => {
  test("crédito usado: una tarjeta con límite pero sin deuda dicha no cuenta como llena", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    const base = api.cuentas!.cuentas.find((c) => c.id === "cta-nu")!;
    api.cuentas!.cuentas.push(
      { ...base, id: "cta-hsbc", nombre: "HSBC", deuda: null, limite: 30_000_00, saldoEn: null },
      { ...base, id: "cta-amex", nombre: "Amex", deuda: 1_000_00, limite: null },
    );
    await abrir(page, "#cuentas", api);
    const credito = page.getByTestId("credito-total");
    // Solo Nu y Banamex (deuda y límite dichos): $32,100 de $60,000.
    await expect(credito).toContainText("54%");
    await expect(credito).toContainText("Te quedan $27,900.00 de $60,000.00 · sin Amex, que no tiene límite dicho");
    await expect(page.getByTestId("sin-saldo")).toContainText("HSBC");
  });

  test("borrar un movimiento desde una cuenta refresca la cuenta, no espera 30 s", async ({ page }) => {
    const api = await abrir(page, "#cuenta?id=cta-bbva");
    const recientes = page.getByRole("region", { name: "Recientes" });
    await expect(recientes.getByRole("button", { name: /Pemex/ })).toBeVisible();
    const antes = api.de("GET", "/v1/cuentas/cta-bbva").length;
    await recientes.getByRole("button", { name: /Pemex/ }).click();
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Eliminar movimiento" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Eliminado" })).toBeVisible();
    // De regreso (sin recargar): la cuenta se vuelve a pedir en vez de mostrar lo de hace un momento.
    await page.getByRole("button", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/#cuenta\?id=cta-bbva$/);
    await expect(recientes.getByRole("button", { name: /Pemex/ })).toHaveCount(0);
    await expect(recientes.getByRole("button", { name: /Starbucks/ })).toBeVisible();
    expect(api.de("GET", "/v1/cuentas/cta-bbva").length).toBeGreaterThan(antes);
  });

  test("pasar a «Retirar» con Efectivo elegido lo vacía y no deja mandar", async ({ page }) => {
    await abrir(page, "#cuenta?id=cta-efectivo");
    await page.getByRole("button", { name: "Mover dinero" }).first().click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByLabel("Desde")).toHaveValue("cta-efectivo");
    await hoja.locator("#monto-mover").fill("300");
    await hoja.getByRole("radio", { name: "Retirar" }).click();
    await expect(hoja.getByLabel("De")).toHaveValue("");
    await expect(hoja.getByRole("button", { name: "Listo" })).toBeDisabled();
  });

  test("un monedero (Mercado Pago) dice su tipo, no «undefined», y se puede editar sin perderlo", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    const base = api.cuentas!.cuentas.find((c) => c.id === "cta-efectivo")!;
    api.cuentas!.cuentas.push({ ...base, id: "cta-mp", nombre: "Mercado Pago", tipo: "monedero", saldo: 500_00 });
    await abrir(page, "#cuenta?id=cta-mp", api);
    await expect(page.getByText("Monedero", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("undefined");
    await page.getByRole("button", { name: "Editar" }).click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByRole("radio", { name: "Monedero" })).toBeChecked();
    await hoja.getByLabel("Tienes").fill("650");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PATCH", "/v1/cuentas/cta-mp")[0]?.cuerpo).toEqual({ saldo: 650 });
  });

  test("saldo a favor en una tarjeta: la vista previa suma, y el signo se conserva", async ({ page }) => {
    const api = conCuentas(new ApiFalsa());
    Object.assign(api.cuentas!.cuentas.find((c) => c.id === "cta-nu")!, { deuda: -200_00 });
    await abrir(page, "#cuenta?id=cta-nu", api);
    await page.getByRole("button", { name: "Editar" }).click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByLabel("Debes")).toHaveValue("-200");
    await expect(hoja.getByText("Te quedan $30,200.00 disponibles.")).toBeVisible();
    await hoja.getByLabel("Debes").fill("-250");
    await expect(hoja.getByText("Te quedan $30,250.00 disponibles.")).toBeVisible();
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toBeHidden();
    expect(api.de("PATCH", "/v1/cuentas/cta-nu")[0]?.cuerpo).toEqual({ deuda: -250 });
  });

  test("«Tienes» dice qué cuentas no entran en la suma", async ({ page }) => {
    await abrir(page, "#inicio");
    await expect(page.getByTestId("faltan")).toHaveText("Falta Revolut");
    await expect(page.getByRole("button", { name: /^Tienes −\$12,450\.00, falta Revolut\. Ver cuentas$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cuentas y tarjetas −\$12,450\.00 · debes \$32,100\.00 · falta Revolut/ })).toBeVisible();
  });

  test("«Por etiqueta» en una semana lleva a los gastos de esa semana con esa etiqueta", async ({ page }) => {
    const api = await abrir(page, "#analisis?periodo=semana");
    const seccion = page.getByRole("region", { name: "Por etiqueta" });
    const filaEtiqueta = seccion.locator("[data-etiqueta]").first();
    const texto = (await filaEtiqueta.innerText()).replace(/\s+/g, " ");
    const cantidad = Number(texto.match(/(\d+) gastos?/)?.[1]);
    await filaEtiqueta.click();
    await expect(page).toHaveURL(/#movimientos\?desde=2026-10-05&hasta=2026-10-11&tipo=gasto&etiqueta=/);
    await expect(page.getByText("5–11 oct", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText(`${cantidad} ${cantidad === 1 ? "movimiento" : "movimientos"}`, { exact: true })).toBeVisible();
    const pedido = api.de("GET", "/v1/movimientos").at(-1)!.consulta;
    expect([pedido.get("desde"), pedido.get("hasta"), pedido.get("tipo")]).toEqual(["2026-10-05", "2026-10-11", "gasto"]);
  });
});
