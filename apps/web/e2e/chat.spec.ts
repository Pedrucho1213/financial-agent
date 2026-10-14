import { expect, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";

// Lo que trae cada respuesta dentro de su burbuja: lo que anotó (con Deshacer) y las fichas para seguir preguntando.
const anotado = (id: string) => ({
  respuesta: "Listo, lo anoté con Nu.",
  conversacion_id: "conv-1",
  acciones: [{ herramienta: "registrar_movimientos", resultado: { registrados: [{ id, tipo: "gasto", monto: "$85.00" }] } }],
});

test("enseña lo que anotó, abre su detalle y Deshacer lo borra", async ({ page }) => {
  const api = new ApiFalsa();
  api.hablar = [200, anotado("mov-001")];
  await prepararSesion(page, api);
  await page.goto("/#chat");

  await page.getByLabel("Mensaje").fill("Gasté 85 en Starbucks con Nu");
  await page.getByLabel("Mensaje").press("Enter");
  await expect(page.getByText("Listo, lo anoté con Nu.")).toBeVisible();
  const lista = page.getByRole("list", { name: "Lo que hizo" });
  await expect(lista.getByText("Registrado")).toBeVisible();
  const fila = page.getByRole("button", { name: /^Ver Starbucks/ });
  await expect(fila).toBeVisible();

  // Tocarlo abre su detalle; Atrás regresa a la conversación.
  await fila.click();
  await expect(page).toHaveURL(/#movimientos\?detalle=mov-001/);
  await page.goBack();
  await expect(page.getByText("Listo, lo anoté con Nu.")).toBeVisible();

  // Deshacer borra ese movimiento (no "lo último"), y el aviso deja regresarlo.
  await lista.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(() => api.de("DELETE", "/v1/movimientos/mov-001").length).toBe(1);
  await expect(page.locator("[data-sonner-toast]").getByText("Eliminado")).toBeVisible();
  await expect(fila).toBeHidden();
  await expect(lista.getByRole("button", { name: "Deshacer" })).toBeHidden();
});

test("las fichas mandan otra pregunta y no repiten lo que ya preguntaste", async ({ page }) => {
  const api = new ApiFalsa();
  api.hablar = [200, { respuesta: "Vas bien.", conversacion_id: "conv-1", acciones: [{ herramienta: "consultar_gastos" }] }];
  await prepararSesion(page, api);
  await page.goto("/#chat");

  await page.getByRole("button", { name: "¿Cómo voy este mes?" }).click();
  await expect(page.getByText("Vas bien.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Lo que hizo" }).getByText("Revisó tus gastos")).toBeVisible();
  const fichas = page.getByRole("group", { name: "Sugerencias" });
  await expect(fichas.getByRole("button")).toHaveText(["¿En qué puedo ahorrar?", "¿Qué pagos fijos tengo?", "¿Cuánto debo en tarjetas?"]);

  await fichas.getByRole("button", { name: "¿Cuánto debo en tarjetas?" }).click();
  await expect.poll(() => api.de("POST", "/v1/hablar").map((p) => (p.cuerpo as { texto: string }).texto)).toEqual([
    "¿Cómo voy este mes?",
    "¿Cuánto debo en tarjetas?",
  ]);
  await expect(fichas.getByRole("button")).toHaveText(["¿En qué puedo ahorrar?", "¿Qué pagos fijos tengo?"]);
});
