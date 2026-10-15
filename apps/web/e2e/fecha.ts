import { expect, type Locator } from "@playwright/test";

/** Abre el calendario de un campo de fecha, va al mes y toca el día ("AAAA-MM-DD"). */
export async function elegirFecha(raiz: Locator, id: string, iso: string) {
  const boton = raiz.locator(`#${id}`);
  if ((await boton.getAttribute("aria-expanded")) !== "true") await boton.click();
  const calendario = raiz.locator(`#${id}-calendario [data-mes]`);
  const mes = iso.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const actual = await calendario.getAttribute("data-mes");
    if (actual === mes) break;
    await calendario.getByRole("button", { name: actual! < mes ? "Mes siguiente" : "Mes anterior" }).click();
  }
  await expect(calendario).toHaveAttribute("data-mes", mes);
  await calendario.locator(`[data-dia="${iso}"]`).click();
  await expect(boton).toHaveAttribute("data-valor-fecha", iso);
}
