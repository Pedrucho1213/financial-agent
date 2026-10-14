import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { cobrosDe, conCobros } from "./api-falsa-cobros";
import { conCuentas } from "./api-falsa-cuentas";
import { conRecurrentes } from "./api-falsa-recurrentes";

// Confirmar cobros de suscripciones y pagos fijos. Hoy es 6 de octubre de 2026. Por confirmar: Disney+ (hoy, $159 con
// Nu, la vez pasada $179, con un "DISNEY PLUS" ya anotado) y Renta (tocaba el 1, $9,500). Agua dijo "todavía no".
// Ya contestados: Spotify (pagado por voz) y Max (no se pagó).

const completa = () => conCobros(conRecurrentes(conCuentas(new ApiFalsa())));
const abrir = async (page: Page, hash: string, api = completa()) => {
  await prepararSesion(page, api);
  await page.goto(`/${hash}`);
  return api;
};
// Los pagos por confirmar viven en la burbuja de la campana de Inicio.
const campana = (page: Page) => page.getByRole("button", { name: /^Notificaciones/ });
const tarjeta = (page: Page) => page.getByRole("dialog", { name: "Notificaciones" });
const abrirCampana = async (page: Page) => {
  await campana(page).click();
  await expect(tarjeta(page)).toBeVisible();
};
const hoja = (page: Page) => page.getByRole("dialog");
const ultimo = (api: ApiFalsa, ruta: string | RegExp) => api.de("POST", ruta).at(-1)?.cuerpo;

test.describe("sin el módulo (otras cuentas o servidor viejo)", () => {
  test("no aparece nada: ni tarjeta, ni campana, ni ajustes, ni «Se paga sola»", async ({ page }) => {
    const api = conRecurrentes(conCuentas(new ApiFalsa()));
    await abrir(page, "#inicio", api);
    // La campana sigue (por revisar y avisos del revisor), sin pagos por confirmar.
    await expect(page.getByRole("region", { name: "Para ti" })).toBeVisible();
    await abrirCampana(page);
    await expect(tarjeta(page).locator("[data-cobro]")).toHaveCount(0);
    await expect(tarjeta(page)).not.toContainText("Por confirmar");
    await page.keyboard.press("Escape");
    // Se preguntó una vez y no se reintenta.
    expect(api.de("GET", "/v1/cobros")).toHaveLength(1);

    await page.goto("/#notificaciones");
    await expect(page.getByRole("switch", { name: "Notificaciones" })).toBeVisible();
    await expect(page.getByText("Qué te aviso")).toHaveCount(0);

    await page.goto("/#suscripciones?id=rec-netflix");
    await expect(hoja(page)).toContainText("Netflix");
    await expect(hoja(page).getByText("Se paga sola")).toHaveCount(0);

    // Un enlace viejo de notificación no rompe nada.
    await page.goto("/#inicio?confirmar=cob-disney");
    await expect(page.getByText("No hay pagos por confirmar")).toBeVisible();
    await expect(hoja(page)).toHaveCount(0);
    await page.goto("/#avisos");
    await expect(page.getByText("Todavía no está abierto para tu cuenta")).toBeVisible();
  });
});

test("Inicio pregunta en su fecha y «Se pagó» es un toque, con Deshacer", async ({ page }) => {
  const api = await abrir(page, "#inicio");
  // 2 por confirmar, los movimientos por revisar y 2 avisos nuevos.
  await expect(campana(page)).toHaveAccessibleName("Notificaciones, 5 pendientes");
  await abrirCampana(page);
  // Agua dijo "todavía no": hoy no estorba.
  await expect(tarjeta(page).locator("[data-cobro]")).toHaveText([/Renta\?\$9,500\.00 · 1 oct/, /Disney\+\?\$159\.00 · hoy · Nu/]);

  await tarjeta(page).getByRole("button", { name: "Disney+ se pagó" }).click();
  await expect(page.getByText("Disney+: pagado $159.00")).toBeVisible();
  expect(ultimo(api, "/v1/cobros/cob-disney/confirmar")).toEqual({});
  await expect(tarjeta(page).locator("[data-cobro]")).toHaveCount(1);
  await expect(campana(page)).toHaveAccessibleName("Notificaciones, 4 pendientes");

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(() => api.de("POST", "/v1/cobros/cob-disney/deshacer").length).toBe(1);
  await expect(tarjeta(page).locator("[data-cobro]")).toHaveCount(2);
});

test("la notificación abre la hoja de ese cobro y deja la dirección limpia", async ({ page }) => {
  await abrir(page, "#inicio?confirmar=cob-disney");
  await expect(hoja(page)).toContainText("¿Ya se pagó?");
  await expect(hoja(page).getByTestId("cuando")).toHaveText("$159.00 · se cobra hoy");
  await expect(page).toHaveURL(/#inicio$/);
  // Lo que ya está anotado se ofrece primero, para no anotarlo dos veces.
  await expect(hoja(page).locator("[data-sugerencia]")).toHaveText([/DISNEY PLUS5 oct · Nu\$179\.00/]);
  await expect(hoja(page).getByRole("button", { name: "Sí, se pagó $159.00" })).toBeVisible();
  await expect(hoja(page).getByRole("button", { name: "Sí, pero fue otro monto" })).toBeVisible();
  await expect(hoja(page).getByRole("button", { name: /Todavía no/ })).toBeVisible();
  await expect(hoja(page).getByRole("button", { name: /Esta vez no se pagó/ })).toBeVisible();

  // Recargar no la vuelve a abrir.
  await page.reload();
  await expect(campana(page)).toBeVisible();
  await expect(hoja(page)).toHaveCount(0);
});

test("la notificación con la app ya abierta (mensaje del service worker) también la abre", async ({ page }) => {
  await abrir(page, "#movimientos");
  await expect(page.getByRole("heading", { name: "Movimientos" }).first()).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#inicio?confirmar=cob-renta";
  });
  await expect(hoja(page)).toContainText("Renta");
  await expect(hoja(page).getByTestId("cuando")).toHaveText("$9,500.00 · tocaba el 1 de octubre");
});

test("«Es este»: liga el gasto que ya estaba anotado", async ({ page }) => {
  const api = await abrir(page, "#inicio?confirmar=cob-disney");
  await hoja(page).locator('[data-sugerencia="mov-disney"]').click();
  await expect(page.getByText("Disney+: pagado con lo que ya habías anotado")).toBeVisible();
  expect(ultimo(api, "/v1/cobros/cob-disney/confirmar")).toEqual({ movimiento_id: "mov-disney" });
  await expect(hoja(page)).toHaveCount(0);
  // El Deshacer del aviso funciona aunque la hoja ya se cerró.
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(() => api.de("POST", "/v1/cobros/cob-disney/deshacer").length).toBe(1);
  await abrirCampana(page);
  await expect(tarjeta(page).locator("[data-cobro]")).toHaveCount(2);
});

test("«Fue otro monto»: si se repite el de la vez pasada, propone el precio nuevo", async ({ page }) => {
  const api = await abrir(page, "#inicio?confirmar=cob-disney");
  await hoja(page).getByRole("button", { name: "Sí, pero fue otro monto" }).click();
  await expect(hoja(page)).toContainText("Normalmente $159.00");
  await expect(page.getByLabel("Monto")).toBeFocused();
  await expect(hoja(page).getByRole("button", { name: "Escribe cuánto fue" })).toBeDisabled();

  // Otro monto distinto: solo este pago.
  await page.getByLabel("Monto").fill("165");
  const precio = hoja(page).getByRole("switch", { name: "Desde ahora cuesta $165.00" });
  await expect(precio).not.toBeChecked();
  await expect(hoja(page)).toContainText("Solo cambia este pago");

  // El mismo de la vez pasada ($179): ya subió.
  await page.getByLabel("Monto").fill("179");
  await expect(hoja(page).getByRole("switch", { name: "Desde ahora cuesta $179.00" })).toBeChecked();
  await expect(hoja(page)).toContainText("Los próximos cobros serán de $179.00.");
  await hoja(page).getByRole("button", { name: "Se pagó $179.00" }).click();
  await expect(page.getByText("Disney+: pagado $179.00; desde ahora cuesta eso")).toBeVisible();
  expect(ultimo(api, "/v1/cobros/cob-disney/confirmar")).toEqual({ monto: 179, actualizar_precio: true });
});

test("«Atrás» desde otro monto no pierde nada y se puede cambiar la cuenta", async ({ page }) => {
  const api = await abrir(page, "#inicio?confirmar=cob-disney");
  await hoja(page).getByRole("button", { name: "Sí, pero fue otro monto" }).click();
  await hoja(page).getByRole("button", { name: "Atrás" }).click();
  await expect(hoja(page)).toContainText("¿Ya se pagó?");
  await hoja(page).getByLabel("Se pagó con").selectOption("cta-bbva");
  await hoja(page).getByRole("button", { name: "Sí, se pagó $159.00" }).click();
  await expect(page.getByText("Disney+: pagado $159.00")).toBeVisible();
  expect(ultimo(api, "/v1/cobros/cob-disney/confirmar")).toEqual({ cuenta_id: "cta-bbva" });
});

test("«Todavía no» lo deja para mañana", async ({ page }) => {
  const api = await abrir(page, "#inicio");
  await abrirCampana(page);
  await tarjeta(page).getByText("¿Ya se pagó Renta?").click();
  await hoja(page).getByRole("button", { name: /Todavía no/ }).click();
  await expect(page.getByText("Te pregunto mañana")).toBeVisible();
  expect(api.de("POST", "/v1/cobros/cob-renta/posponer")).toHaveLength(1);
  await abrirCampana(page);
  await expect(tarjeta(page).locator("[data-cobro]")).toHaveText([/Disney\+/]);
});

test("«Esta vez no se pagó» dos veces seguidas ofrece pausarla", async ({ page }) => {
  const api = await abrir(page, "#inicio?confirmar=cob-renta");
  await hoja(page).getByRole("button", { name: /Esta vez no se pagó/ }).click();
  await expect(page.getByText("Renta: no se pagó esta vez")).toBeVisible();
  await expect(page.getByText("¿Pausar Renta?")).toBeVisible();
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByText("Pausé Renta")).toBeVisible();
  expect(api.de("PATCH", "/v1/recurrentes/rec-renta").at(-1)?.cuerpo).toEqual({ estado: "pausada" });
});

test("varios en la notificación: la lista y «Todo se pagó»", async ({ page }) => {
  const api = await abrir(page, "#inicio?confirmar=cob-renta,cob-disney");
  await expect(hoja(page).locator("[data-cobro]")).toHaveText([/Renta\$9,500\.00 · 1 octSe pagó/, /Disney\+\$159\.00 · hoy · NuSe pagó/]);

  // Tocar uno abre su hoja y "Atrás" regresa a la lista.
  await hoja(page).getByText("Renta", { exact: true }).click();
  await expect(hoja(page)).toContainText("¿Ya se pagó?");
  await hoja(page).getByRole("button", { name: "Atrás" }).click();
  await hoja(page).getByRole("button", { name: "Todo se pagó" }).click();
  await expect(page.getByText("Los dos quedaron pagados")).toBeVisible();
  expect(ultimo(api, "/v1/cobros/confirmar")).toEqual({ ids: ["cob-renta", "cob-disney"] });
  await expect(hoja(page)).toHaveCount(0);
  await abrirCampana(page);
  await expect(tarjeta(page).locator("[data-cobro]")).toHaveCount(0);
});

test("en la lista, contestar uno por uno la cierra al final", async ({ page }) => {
  await abrir(page, "#inicio?confirmar=cob-renta,cob-disney");
  await hoja(page).getByRole("button", { name: "Renta se pagó" }).click();
  await expect(hoja(page).locator("[data-cobro]")).toHaveCount(1);
  await hoja(page).getByRole("button", { name: "Disney+ se pagó" }).click();
  await expect(hoja(page)).toHaveCount(0);
});

test("si ya se contestó por voz, la notificación muestra cómo quedó y se puede corregir", async ({ page }) => {
  const api = await abrir(page, "#inicio?confirmar=cob-spotify");
  await expect(hoja(page)).toContainText("Pagado $129.00");
  await expect(hoja(page)).toContainText("Cobro del 20 de septiembre · lo confirmaste por voz");
  await hoja(page).getByRole("button", { name: /No se pagó, quitar el pago/ }).click();
  await expect(page.getByText("Listo, quité el pago")).toBeVisible();
  expect(api.de("POST", "/v1/cobros/cob-spotify/deshacer")).toHaveLength(1);
  // Vuelve a preguntar, en la misma hoja.
  await expect(hoja(page)).toContainText("¿Ya se pagó?");
  expect(cobrosDe(api).find((c) => c.id === "cob-spotify")?.estado).toBe("pendiente");
});

test("una notificación de algo que ya no existe no abre nada", async ({ page }) => {
  await abrir(page, "#inicio?confirmar=cob-borrado");
  await expect(page.getByText("No hay pagos por confirmar")).toBeVisible();
  await expect(hoja(page)).toHaveCount(0);
});

test("la campana abre el centro de notificaciones", async ({ page }) => {
  const api = await abrir(page, "#inicio");
  await abrirCampana(page);
  await tarjeta(page).getByRole("button", { name: "Ver todas" }).click();
  await expect(page).toHaveURL(/#avisos$/);
  await expect(page.getByRole("heading", { name: "Notificaciones" })).toBeVisible();
  // Agua sale aquí aunque dijo "todavía no".
  await expect(page.locator("section").filter({ hasText: "Por confirmar" }).locator("[data-cobro]")).toHaveText([
    /¿Ya se pagó Renta\?\$9,500\.00 · 1 oct/,
    /¿Ya se pagó Agua\?\$310\.00 · 4 oct · te pregunto mañana/,
    /¿Ya se pagó Disney\+\?\$159\.00 · hoy/,
  ]);
  await expect(page.locator("[data-aviso]")).toHaveCount(2);
  // Lo que falta revisar, con su logo; tocarlo abre el movimiento.
  await expect(page.locator("section").filter({ hasText: "Por revisar" }).locator("[data-revisar]")).toHaveCount(2);
  await expect(page.locator("section").filter({ hasText: "Anteriores" }).locator("[data-cobro]")).toHaveText([
    /Spotify20 sept? · por voz\$129\.00/,
    /Max.*No se pagó · 3 sept?/,
  ]);

  // Un aviso: se marca leído y lleva a donde dice.
  await page.locator('[data-aviso="av-1"]').click();
  await expect(page).toHaveURL(/#movimientos\?texto=Oxxo/);
  expect(api.de("POST", "/v1/avisos/av-1/leido")).toHaveLength(1);
  await page.goBack();
  await expect(page.locator('[data-aviso="av-1"]')).toHaveAttribute("data-leido", "1");

  // "Contestar todos" abre la lista con los tres.
  await page.getByRole("button", { name: "Contestar todos" }).click();
  await expect(hoja(page).locator("[data-cobro]")).toHaveCount(3);
  await hoja(page).getByRole("button", { name: "Listo" }).click();

  await page.getByRole("button", { name: "Qué te aviso y a qué hora" }).click();
  await expect(page).toHaveURL(/#notificaciones$/);
  await expect(page.getByText("Qué te aviso")).toBeVisible();
});

test("Ajustes › Notificaciones › Qué te aviso y el horario", async ({ page }) => {
  const api = await abrir(page, "#notificaciones");
  const fugas = page.getByRole("switch", { name: "Fugas de dinero" });
  await expect(fugas).toBeChecked();
  await fugas.click();
  await expect(fugas).not.toBeChecked();
  await expect.poll(() => api.de("PUT", "/v1/avisos/preferencias").at(-1)?.cuerpo).toEqual({ tipos: { fugas: false } });

  await expect(page.getByLabel("Hasta")).toHaveValue("21");
  await page.getByLabel("Hasta").selectOption("22");
  await expect.poll(() => api.de("PUT", "/v1/avisos/preferencias").at(-1)?.cuerpo).toEqual({ hasta: 22 });
  await expect(page.getByText("Lo de los pagos fijos llega a las 19:00.")).toBeVisible();
  // "Desde" no puede pasar de "Hasta".
  const opciones = await page.getByLabel("Desde").locator("option").allTextContents();
  expect(opciones.at(-1)).toBe("21:00");
});

test("«Se paga sola» en la hoja de la suscripción", async ({ page }) => {
  const api = await abrir(page, "#suscripciones?id=rec-netflix");
  const sola = hoja(page).getByRole("switch", { name: "Se paga sola" });
  await expect(sola).not.toBeChecked();
  await expect(hoja(page)).toContainText("En su fecha te pregunto si ya se pagó.");
  await sola.click();
  await expect(hoja(page)).toContainText("la anoto como pagada sin preguntarte");
  await hoja(page).getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Cambios guardados")).toBeVisible();
  expect(api.de("PATCH", "/v1/recurrentes/rec-netflix").at(-1)?.cuerpo).toEqual({ confirmar_solo: true });
});

test("el número del ícono de la app es lo que espera respuesta", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __insignias: (number | null)[] };
    w.__insignias = [];
    Object.assign(navigator, {
      setAppBadge: async (n: number) => void w.__insignias.push(n),
      clearAppBadge: async () => void w.__insignias.push(null),
    });
  });
  const insignias = () => page.evaluate(() => (window as unknown as { __insignias: (number | null)[] }).__insignias);
  await abrir(page, "#inicio");
  await expect.poll(insignias).toEqual([2]);
  await abrirCampana(page);
  await tarjeta(page).getByRole("button", { name: "Renta se pagó" }).click();
  await tarjeta(page).getByRole("button", { name: "Disney+ se pagó" }).click();
  await expect.poll(async () => (await insignias()).at(-1)).toBe(null);
});

test.describe("capturas", () => {
  const DIR = "e2e/capturas/cobros";
  mkdirSync(DIR, { recursive: true });
  const capturar = async (page: Page, nombre: string) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${DIR}/${nombre}.png` });
  };

  for (const esquema of ["light", "dark"] as const) {
    const sufijo = esquema === "light" ? "claro" : "oscuro";
    test(`cobros (${sufijo})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: esquema });
      await abrir(page, "#inicio");
      await abrirCampana(page);
      await capturar(page, `inicio-${sufijo}`);

      await page.goto("/#inicio?confirmar=cob-disney");
      await expect(hoja(page)).toContainText("¿Ya se pagó?");
      await capturar(page, `hoja-${sufijo}`);
      await hoja(page).getByRole("button", { name: "Sí, pero fue otro monto" }).click();
      await page.getByLabel("Monto").fill("179");
      await capturar(page, `otro-monto-${sufijo}`);
      await hoja(page).getByRole("button", { name: "Atrás" }).click();
      await hoja(page).getByRole("button", { name: "Cerrar" }).click();

      await page.goto("/#inicio?confirmar=cob-renta,cob-disney");
      await expect(hoja(page).locator("[data-cobro]")).toHaveCount(2);
      await capturar(page, `lista-${sufijo}`);
      await hoja(page).getByRole("button", { name: "Listo" }).click();

      await page.goto("/#inicio?confirmar=cob-spotify");
      await expect(hoja(page)).toContainText("Pagado $129.00");
      await capturar(page, `resuelto-${sufijo}`);
      await hoja(page).getByRole("button", { name: "Listo" }).click();

      await page.goto("/#avisos");
      await expect(page.locator("[data-aviso]")).toHaveCount(2);
      await capturar(page, `centro-${sufijo}`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await capturar(page, `centro-final-${sufijo}`);

      await page.goto("/#notificaciones");
      await page.getByText("Qué te aviso").scrollIntoViewIfNeeded();
      await capturar(page, `ajustes-${sufijo}`);
    });
  }

  test("cobros en 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await abrir(page, "#inicio");
    await abrirCampana(page);
    await capturar(page, "inicio-320");
    // Nada se sale de la pantalla.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.goto("/#inicio?confirmar=cob-disney");
    await expect(hoja(page)).toContainText("¿Ya se pagó?");
    await capturar(page, "hoja-320");
    await page.goto("/#inicio?confirmar=cob-renta,cob-disney");
    await expect(hoja(page).locator("[data-cobro]")).toHaveCount(2);
    await capturar(page, "lista-320");
    await hoja(page).getByRole("button", { name: "Listo" }).click();
    await page.goto("/#avisos");
    await capturar(page, "centro-320");
  });
});
