import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, HOY, mov, prepararSesion } from "./api-falsa";
import { ponerEstado } from "./api-falsa-cuenta";
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
    ponerEstado(api, { uso: { consultas: 8, limite: 40, quedan: 32, maxCaracteres: 1500, caracteresPorConsulta: 500 } });
    await prepararSesion(page, api);

    await page.goto("/#chat");
    await expect(page.getByText("¿En qué te ayudo?")).toBeVisible();
    // A 320 px va la versión corta para que quepa en la barra.
    await expect(page.getByText(ancho === 320 ? "Quedan 32 consultas" : "Te quedan 32 consultas hoy", { exact: true })).toBeVisible();
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

// Bajo «IA», lo que queda: el modo básico (con su explicación) y, para la cuenta dueña, lo gastado del mes.
test("IA: modo básico y gasto del mes bajo el título", async ({ page }) => {
  const api = new ApiFalsa();
  const aviso = "Modo básico hasta mañana: ya usaste tus consultas de hoy y las respuestas son más cortas.";
  ponerEstado(api, { uso: { consultas: 41, limite: 40, quedan: 0, maxCaracteres: 1500, caracteresPorConsulta: 500, aviso, modoBasico: true } });
  await prepararSesion(page, api);
  await page.goto("/#chat");
  await expect(page.getByText("Modo básico hasta mañana", { exact: true })).toBeVisible();
  await capturar(page, "ia-modo-basico-claro");

  ponerEstado(api, {
    uso: { consultas: 12, limite: null, quedan: null, maxCaracteres: 1500, caracteresPorConsulta: 500, mes: { costoUsd: 1.2, presupuestoUsd: 50 } },
  });
  await page.reload();
  await expect(page.getByText("$1.20 de $50.00 USD este mes")).toBeVisible();
  await capturar(page, "ia-dueno-claro");
});

// Textos largos a 320 y 390 px: nada se encima ni se sale de su burbuja.
for (const ancho of [320, 390]) {
  for (const esquema of ["light", "dark"] as const) {
    test(`IA con textos largos (${ancho}, ${esquema === "light" ? "claro" : "oscuro"})`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: ancho === 320 ? 568 : 844 });
      await page.emulateMedia({ colorScheme: esquema });
      await vozFalsa(page);
      const api = new ApiFalsa();
      ponerEstado(api, {
        uso: { consultas: 12, limite: null, quedan: null, maxCaracteres: 1500, caracteresPorConsulta: 500, mes: { costoUsd: 12.34, presupuestoUsd: 50 } },
      });
      const largo = mov(HOY, "gasto", 123456.78, "Restaurantes", "Restaurante La Casa de las Enchiladas Potosinas", { cuenta: "Mercado Pago Credito" });
      largo.id = "mov-largo";
      api.movimientos.unshift(largo);
      api.hablar = [
        200,
        {
          respuesta:
            "Listo, lo anoté con Mercado Pago Credito. Revisa https://finanzas.tail3fcd0c.ts.net/#movimientos?detalle=mov-largo-con-un-identificador-muy-largo por si algo no cuadra.",
          conversacion_id: "c1",
          acciones: [
            { herramienta: "registrar_movimientos", resultado: { registrados: [{ id: "mov-largo" }] } },
            { herramienta: "consultar_gastos" },
            { herramienta: "listar_recurrentes" },
          ],
        },
      ];
      await prepararSesion(page, api);
      await page.goto("/#chat");
      await page.getByLabel("Mensaje").fill("Gasté 123456.78 en el Restaurante La Casa de las Enchiladas Potosinas con Mercado Pago Credito");
      await page.getByLabel("Mensaje").press("Enter");
      await expect(page.getByRole("button", { name: /^Ver Restaurante/ })).toBeVisible();
      await page.getByLabel("Mensaje").fill("x".repeat(620));
      await capturar(page, `ia-largos-${ancho}-${esquema === "light" ? "claro" : "oscuro"}`);
    });
  }
}

// Escribiendo: sin la barra de abajo, la caja de escribir queda donde iría el teclado.
test("IA escribiendo (oscuro)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const api = new ApiFalsa();
  api.hablar = [200, { respuesta: "Tienes 18,791 pesos en tus cuentas y debes 105,098.56 en tarjetas.", conversacion_id: "c1", acciones: [{ herramienta: "consultar_cuentas" }] }];
  await prepararSesion(page, api);
  await page.goto("/#chat");
  await page.getByLabel("Mensaje").fill("¿Cuánto tengo?");
  await page.getByLabel("Mensaje").press("Enter");
  await expect(page.getByText(/Tienes 18,791/)).toBeVisible();
  // Cada herramienta con su nombre en español, no "consultar cuentas".
  await expect(page.getByText("Revisó tus cuentas")).toBeVisible();
  await page.getByLabel("Mensaje").fill("Acabo de transferir 2 mil pesos");
  await expect(page.getByRole("navigation", { name: "Secciones" })).not.toBeInViewport();
  await capturar(page, "ia-escribiendo-oscuro");
});
