import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";
import { conCobros } from "./api-falsa-cobros";
import { conCuentas } from "./api-falsa-cuentas";
import { conRecurrentes, recurrentesDe } from "./api-falsa-recurrentes";

// En un iPhone de 320 px (o con la letra grande) ningún texto se encima con otro ni se corta sin "…",
// también con nombres y montos largos. Recorre las pantallas y las hojas principales.
const SALUD = JSON.parse(readFileSync(new URL("./salud-falsa.json", import.meta.url), "utf8")).conIngreso;

/** Textos que se enciman o se salen de su caja, en lo visible (si hay una hoja abierta, solo en ella). */
async function solapes(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05) return false;
      }
      return true;
    };
    const capa = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const p = getComputedStyle(e).position;
        if (p === "fixed" || p === "sticky") return e;
      }
      return null;
    };
    // Lo que de verdad se ve del rect: recortado por los padres que esconden lo que se sale.
    const recorte = (el: Element, r: DOMRect) => {
      let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") {
          const c = e.getBoundingClientRect();
          l = Math.max(l, c.left); t = Math.max(t, c.top); rr = Math.min(rr, c.right); b = Math.min(b, c.bottom);
        }
      }
      return rr - l > 1 && b - t > 1 ? new DOMRect(l, t, rr - l, b - t) : null;
    };
    const opaco = (e: Element) => {
      const bg = getComputedStyle(e).backgroundColor;
      return bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg);
    };
    const hoja = [...document.querySelectorAll('[role="dialog"]')].at(-1) ?? null;
    const raiz = hoja ?? document.body;
    const leer = () => {
      const textos: { t: string; el: Element; r: DOMRect; capa: Element | null }[] = [];
      const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.textContent?.trim();
        const el = n.parentElement;
        if (!t || !el || !visible(el) || el.closest(".sr-only")) continue;
        const rango = document.createRange();
        rango.selectNodeContents(n);
        for (const r0 of rango.getClientRects()) {
          const r = recorte(el, r0);
          if (!r || r.width < 2 || r.height < 2) continue;
          textos.push({ t: t.slice(0, 40), el, r, capa: capa(el) });
        }
      }
      return textos;
    };
    const textos = leer();
    const malos: string[] = [];
    for (let i = 0; i < textos.length; i++) {
      for (let j = i + 1; j < textos.length; j++) {
        const a = textos[i]!;
        const b = textos[j]!;
        if (a.el === b.el || a.capa !== b.capa) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (!(x > 2 && y > 4)) continue;
        // ¿Uno tapa al otro con un fondo (acciones de deslizar debajo de la fila)? Entonces no se enciman a la vista.
        const cx = Math.max(a.r.left, b.r.left) + x / 2;
        const cy = Math.max(a.r.top, b.r.top) + y / 2;
        if (cy >= 0 && cy <= innerHeight) {
          let arriba = document.elementFromPoint(cx, cy);
          while (arriba && !opaco(arriba)) arriba = arriba.parentElement;
          if (arriba && (!arriba.contains(a.el) || !arriba.contains(b.el))) continue;
        }
        malos.push(`encima: «${a.t}» / «${b.t}» (${Math.round(x)}x${Math.round(y)})`);
      }
    }
    // Cortados sin "…": una caja que esconde lo que se sale.
    for (const el of raiz.querySelectorAll("*")) {
      if (!visible(el) || !el.textContent?.trim() || el.closest(".sr-only, .leaflet-container")) continue;
      const s = getComputedStyle(el);
      if (s.overflowX === "visible" || s.overflowX === "auto" || s.overflowX === "scroll") continue;
      if (s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none") continue;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
        malos.push(`cortado: «${el.textContent.trim().slice(0, 40)}» ${el.scrollWidth}>${el.clientWidth} <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}">`);
    }
    for (const x of textos) if (x.r.right > innerWidth + 1 || x.r.left < -1) malos.push(`fuera: «${x.t}»`);
    return [...new Set(malos)];
  });
}

function api(largos: boolean) {
  const a = conRecurrentes(conCobros(conCuentas(new ApiFalsa())));
  a.salud = SALUD;
  if (largos) {
    const m = a.movimientos[0]!;
    m.comercio = "Restaurante La Casa de las Enchiladas Potosinas";
    m.montoCentavos = 1_234_567_89;
    a.movimientos[1]!.comercio = "Farmacias del Ahorro Sucursal Insurgentes";
    for (const c of a.cuentas!.cuentas) if (c.nombre === "Banamex Oro") c.nombre = "Mercado Pago Crédito Platinum";
    for (const c of a.cuentas!.cuentas) if (c.nombre === "BBVA") c.saldo = 1_234_567_89;
    const p = a.plan.personas?.[0] as { persona: string } | undefined;
    if (p) p.persona = "María Fernanda de la Garza Villarreal";
    const r = recurrentesDe(a);
    if (r?.[0]) {
      r[0].nombre = "Amazon Prime Video con Canales";
      r[0].montoCentavos = 12_345_00;
    }
  }
  return a;
}

const PANTALLAS: [string, string, ((p: Page) => Promise<void>)?][] = [
  ["inicio", "/#inicio"],
  ["campana", "/#inicio", async (p) => p.getByRole("button", { name: /^Notificaciones/ }).first().click()],
  ["avisos", "/#avisos"],
  ["cuentas", "/#cuentas"],
  ["tarjeta", "/#cuenta?id=cta-banamex"],
  ["suscripciones", "/#suscripciones"],
  ["movimientos", "/#movimientos"],
  ["detalle", "/#movimientos?detalle=mov-001"],
  ["plan", "/#plan"],
  ["analisis", "/#analisis"],
  ["salud", "/#salud"],
  ["ajustes", "/#ajustes"],
  ["editor", "/#movimientos", async (p) => p.getByRole("button", { name: "Agregar movimiento" }).click()],
  ["cobros", "/#inicio?confirmar=cob-renta"],
];

for (const largos of [false, true]) {
  test(`a 320 px nada se encima${largos ? " (nombres y montos largos)" : ""}`, async ({ page }) => {
    test.setTimeout(120_000);
    // Alta para que todo quede a la vista y se pueda ver qué tapa a qué.
    await page.setViewportSize({ width: 320, height: 3000 });
    await prepararSesion(page, api(largos));
    const informe: string[] = [];
    for (const [nombre, url, accion] of PANTALLAS) {
      await page.goto("about:blank");
      await page.goto(url);
      await page.waitForTimeout(900);
      if (accion) {
        await accion(page);
        await page.waitForTimeout(700);
      }
      informe.push(...(await solapes(page)).map((m) => `${nombre}: ${m}`));
    }
    expect(informe).toEqual([]);
  });
}
