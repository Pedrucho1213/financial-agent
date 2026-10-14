import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { vozFalsa } from "./voz-falsa";

// Capturas de la pestaña IA (vacía, conversación y dictando), en claro, oscuro y a 320 px. No validan nada más.
const DIR = "e2e/capturas";
mkdirSync(DIR, { recursive: true });

async function capturar(page: Page, nombre: string) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/${nombre}.png` });
}

const casos = [
  { esquema: "light", ancho: 390, sufijo: "claro" },
  { esquema: "dark", ancho: 390, sufijo: "oscuro" },
  { esquema: "light", ancho: 320, sufijo: "320" },
] as const;

for (const { esquema, ancho, sufijo } of casos) {
  test(`IA (${sufijo})`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: ancho === 320 ? 568 : 844 });
    await page.emulateMedia({ colorScheme: esquema });
    await vozFalsa(page);
    const api = new ApiFalsa();
    await prepararSesion(page, api);

    await page.goto("/#chat");
    await expect(page.getByText("¿En qué te ayudo?")).toBeVisible();
    await page.getByRole("button", { name: "Dictar" }).click();
    await expect(page.getByRole("status", { name: "Escuchando" })).toBeVisible();
    await capturar(page, `ia-vacia-dictando-${sufijo}`);
    await page.getByRole("button", { name: "Cancelar dictado" }).click();

    api.hablar = [200, { respuesta: "Llevas $16,754.70, 20% más que al 6 de septiembre. Casi todo es la renta.", conversacion_id: "c1", acciones: [{ herramienta: "consultar_gastos" }] }];
    await page.getByLabel("Mensaje").fill("¿Cómo voy este mes?");
    await page.getByLabel("Mensaje").press("Enter");
    await expect(page.getByText(/Llevas/)).toBeVisible();
    api.hablar = [
      200,
      {
        respuesta: "Listo, lo anoté con Nu.",
        conversacion_id: "c1",
        acciones: [{ herramienta: "registrar_movimientos", resultado: { registrados: [{ id: "mov-001" }] } }],
      },
    ];
    await page.getByLabel("Mensaje").fill("gasté 85 en starbucks con no");
    await page.getByLabel("Mensaje").press("Enter");
    await expect(page.getByRole("button", { name: /^Ver Starbucks/ })).toBeVisible();
    await capturar(page, `ia-conversacion-${sufijo}`);
  });
}
