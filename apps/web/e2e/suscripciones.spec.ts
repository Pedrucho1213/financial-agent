import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCuentas } from "./api-falsa-cuentas";
import { conRecurrentes, recurrentesDe } from "./api-falsa-recurrentes";

// #suscripciones contra la API falsa. Hoy es 6 de octubre de 2026. Activas: Netflix ($219, día 8, con Nu),
// Spotify ($129, día 20) y Renta ($9,500, día 1). iCloud pausada, Max cancelada, Gimnasio viejo archivada.

const abrir = async (page: Page, hash: string, api = conRecurrentes(conCuentas(new ApiFalsa()))) => {
  await prepararSesion(page, api);
  await page.goto(`/${hash}`);
  return api;
};
const fila = (page: Page, nombre: string) => page.locator(`[data-recurrente="${nombre}"]`);
const seccion = (page: Page, estado: string) => page.locator(`[data-seccion="${estado}"]`);
const hoja = (page: Page) => page.getByRole("dialog");

test("Inicio lleva a Suscripciones con lo que se va al mes", async ({ page }) => {
  await abrir(page, "#inicio");
  await page.getByRole("navigation", { name: "Accesos" }).getByRole("button", { name: "Suscripciones" }).click();
  await expect(page).toHaveURL(/#suscripciones$/);
  await expect(page.locator("[data-resumen-suscripciones]")).toContainText("$9,848.00");
  await expect(page.locator("[data-resumen-suscripciones]")).toContainText("3 activas · 1 pausada");
  await expect(seccion(page, "activa").locator("[data-recurrente]")).toHaveText([/Netflix/, /Spotify/, /Renta/]);
  await expect(fila(page, "Netflix")).toContainText("Mensual · día 8 · Nu");
  await expect(fila(page, "Netflix")).toContainText("en 2 días");
  await expect(seccion(page, "pausada")).toContainText("iCloud");
  await expect(seccion(page, "cancelada")).toContainText("Max");
  // Las archivadas no estorban: se abren aparte.
  await expect(fila(page, "Gimnasio viejo")).toHaveCount(0);
  await page.getByRole("button", { name: /^Archivadas 1/ }).click();
  await expect(seccion(page, "archivada")).toContainText("Gimnasio viejo");
});

test("pausar quita el cobro del total y se puede deshacer", async ({ page }) => {
  const api = await abrir(page, "#suscripciones");
  await fila(page, "Netflix").click();
  await expect(hoja(page)).toContainText("Netflix");
  await hoja(page).getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByText("Pausé Netflix")).toBeVisible();
  expect(api.de("PATCH", "/v1/recurrentes/rec-netflix").at(-1)?.cuerpo).toEqual({ estado: "pausada" });
  await expect(seccion(page, "pausada")).toContainText("Netflix");
  await expect(page.locator("[data-resumen-suscripciones]")).toContainText("$9,629.00");

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(seccion(page, "activa")).toContainText("Netflix");
  expect(api.de("PATCH", "/v1/recurrentes/rec-netflix").at(-1)?.cuerpo).toEqual({ estado: "activa" });
});

test("cancelar, archivar y volver a activar", async ({ page }) => {
  const api = await abrir(page, "#suscripciones");
  await fila(page, "Spotify").click();
  await hoja(page).getByRole("button", { name: "Cancelar suscripción" }).click();
  await expect(seccion(page, "cancelada")).toContainText("Spotify");

  await fila(page, "Max").click();
  await expect(hoja(page)).toContainText("Cancelada: no se cobra");
  await hoja(page).getByRole("button", { name: "Archivar" }).click();
  await expect(fila(page, "Max")).toHaveCount(0);
  expect(recurrentesDe(api).find((r) => r.id === "rec-max")?.estado).toBe("archivada");

  await page.getByRole("button", { name: /^Archivadas 2/ }).click();
  await fila(page, "Gimnasio viejo").click();
  await hoja(page).getByRole("button", { name: "Volver a activar" }).click();
  await expect(seccion(page, "activa")).toContainText("Gimnasio viejo");
});

test("editar manda solo lo que cambió", async ({ page }) => {
  const api = await abrir(page, "#suscripciones?id=rec-spotify");
  await expect(hoja(page)).toContainText("Spotify");
  await hoja(page).getByLabel("Monto").fill("149");
  await hoja(page).locator("#cuenta-recurrente").selectOption("cta-nu");
  await hoja(page).getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Cambios guardados")).toBeVisible();
  expect(api.de("PATCH", "/v1/recurrentes/rec-spotify").at(-1)?.cuerpo).toEqual({ monto: 149, cuenta_id: "cta-nu" });
  await expect(fila(page, "Spotify")).toContainText("$149.00");
  await expect(fila(page, "Spotify")).toContainText("Nu");
  await expect(page).toHaveURL(/#suscripciones$/);
});

test("agregar una anual", async ({ page }) => {
  const api = await abrir(page, "#suscripciones");
  await page.getByRole("button", { name: "Nueva suscripción" }).click();
  await hoja(page).getByLabel("Monto").fill("1299");
  await hoja(page).getByLabel("Nombre").fill("Amazon Prime");
  await hoja(page).locator("#frecuencia-recurrente").selectOption("anual");
  await hoja(page).locator("#dia-recurrente").selectOption("12");
  await hoja(page).locator("#mes-recurrente").selectOption("3");
  await hoja(page).getByRole("button", { name: "Agregar" }).click();
  await expect(page.getByText("Agregué Amazon Prime")).toBeVisible();
  expect(api.de("POST", "/v1/recurrentes").at(-1)?.cuerpo).toEqual({
    nombre: "Amazon Prime",
    tipo: "suscripcion",
    monto: 1299,
    frecuencia: "anual",
    dia: 12,
    mes: 3,
    cuenta_id: null,
  });
  await expect(fila(page, "Amazon Prime")).toContainText("Anual · 12 de marzo");
});

test("eliminar pide confirmación", async ({ page }) => {
  const api = await abrir(page, "#suscripciones");
  await fila(page, "Max").click();
  page.once("dialog", (d) => void d.accept());
  await hoja(page).getByRole("button", { name: "Eliminar" }).click();
  await expect(fila(page, "Max")).toHaveCount(0);
  expect(api.de("DELETE", "/v1/recurrentes/rec-max")).toHaveLength(1);
});

test("los próximos cobros de Inicio llevan a Suscripciones", async ({ page }) => {
  await abrir(page, "#inicio");
  const proximos = page.getByRole("region", { name: "Próximos cobros" });
  await expect(proximos).toContainText("Netflix");
  await proximos.getByRole("button", { name: "Suscripciones", exact: true }).click();
  await expect(page).toHaveURL(/#suscripciones$/);
});

test("un servidor sin suscripciones (404): Inicio carga igual y la pantalla lo explica", async ({ page }) => {
  await abrir(page, "#inicio", conCuentas(new ApiFalsa()));
  await expect(page.getByRole("region", { name: "Lo que tienes" })).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.goto("/#suscripciones");
  await expect(page.getByText("Aún no está en tu servidor")).toBeVisible();
});
