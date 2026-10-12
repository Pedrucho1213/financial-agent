import { expect, type Page, test } from "@playwright/test";
import { ApiFalsa, prepararSesion } from "./api-falsa";

/**
 * Reconocimiento de voz y lectura falsos, controlados desde la prueba con window.__voz:
 * - oir(texto, final): llega un resultado del dictado.
 * - fallar(error) / terminar(): el reconocimiento falla o termina (como cuando dejas de hablar).
 * - leido: lo que se mandó a leer en voz alta; terminarLectura() acaba de leer.
 */
async function vozFalsa(page: Page) {
  await page.addInitScript(() => {
    type Rec = {
      onresult: ((e: unknown) => void) | null;
      onerror: ((e: unknown) => void) | null;
      onend: (() => void) | null;
      lang: string;
      vivo: boolean;
    };
    const voz = {
      recs: [] as Rec[],
      inicios: 0,
      leido: [] as string[],
      leyendo: null as null | { onend: (() => void) | null; onerror: (() => void) | null },
      actual(): Rec | undefined {
        return voz.recs.filter((r) => r.vivo).at(-1);
      },
      oir(texto: string, final = false) {
        voz.actual()?.onresult?.({ results: [{ isFinal: final, 0: { transcript: texto } }] });
      },
      fallar(error: string) {
        const r = voz.actual();
        r?.onerror?.({ error });
        voz.terminar();
      },
      terminar() {
        const r = voz.actual();
        if (!r) return;
        r.vivo = false;
        r.onend?.();
      },
      terminarLectura() {
        const u = voz.leyendo;
        voz.leyendo = null;
        u?.onend?.();
      },
    };
    class Reconocimiento {
      lang = "";
      interimResults = false;
      continuous = false;
      vivo = false;
      onresult = null;
      onerror = null;
      onend: (() => void) | null = null;
      start() {
        this.vivo = true;
        voz.inicios++;
        voz.recs.push(this as unknown as Rec);
      }
      stop() {
        // Como Safari: deja de escuchar y termina enseguida con lo que oyó.
        if (!this.vivo) return;
        this.vivo = false;
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        this.stop();
      }
    }
    class Utterance {
      text: string;
      lang = "";
      rate = 1;
      volume = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(t: string) {
        this.text = t;
      }
    }
    const w = window as unknown as Record<string, unknown>;
    // Chromium ya trae SpeechRecognition sin prefijo: se reemplazan los dos.
    w.SpeechRecognition = Reconocimiento;
    w.webkitSpeechRecognition = Reconocimiento;
    w.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [
          { lang: "en-US", name: "Samantha", localService: true },
          { lang: "es-MX", name: "Eddy (Español (México))", localService: true },
          { lang: "es-MX", name: "Paulina", localService: true },
        ],
        addEventListener: () => {},
        speak(u: Utterance) {
          if (u.volume === 0) return; // el desbloqueo de iOS
          voz.leido.push(u.text);
          voz.leyendo = u;
        },
        cancel() {
          const u = voz.leyendo;
          voz.leyendo = null;
          u?.onerror?.();
        },
      },
    });
    w.__voz = voz;
  });
}

type Voz = { inicios: number; leido: string[] };
const oir = (page: Page, texto: string, final = false) =>
  page.evaluate(([t, f]) => (window as never as { __voz: { oir: (t: string, f: boolean) => void } }).__voz.oir(t, f), [texto, final] as const);
const llamar = (page: Page, metodo: "terminar" | "terminarLectura" | "fallar", arg?: string) =>
  page.evaluate(([m, a]) => (window as never as { __voz: Record<string, (a?: string) => void> }).__voz[m]?.(a), [metodo, arg] as const);
const leido = (page: Page) => page.evaluate(() => (window as never as { __voz: Voz }).__voz.leido);
const inicios = (page: Page) => page.evaluate(() => (window as never as { __voz: Voz }).__voz.inicios);
const textos = (api: ApiFalsa) => api.de("POST", "/v1/hablar").map((p) => (p.cuerpo as { texto: string }).texto);

test.describe("Modo de voz del chat", () => {
  test.beforeEach(async ({ page }) => {
    await vozFalsa(page);
  });

  test("dicta, va escribiendo y lo manda solo al terminar aunque no llegue como final", async ({ page }) => {
    const api = new ApiFalsa();
    api.hablar = [200, { respuesta: "Anotado: 85 pesos en Café.", conversacion_id: "c1", acciones: [{ herramienta: "registrar_movimientos" }] }];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    await expect(page.getByText("Toca el micrófono para hablar.")).toBeVisible();

    await page.getByRole("button", { name: "Dictar" }).click();
    await expect(page.getByLabel("Mensaje")).toHaveAttribute("placeholder", "Te escucho…");
    await expect(page.getByRole("status", { name: "Escuchando" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar dictado" })).toBeVisible();

    // Lo dictado empieza con mayúscula aunque el reconocimiento lo dé en minúsculas.
    await oir(page, "gasté 85");
    await expect(page.getByLabel("Mensaje")).toHaveValue("Gasté 85");
    await oir(page, "gasté 85 en café");
    await expect(page.getByLabel("Mensaje")).toHaveValue("Gasté 85 en café");
    // Sigue escuchando: la onda se recorre junto a Enviar.
    await expect(page.getByRole("status", { name: "Escuchando" })).toBeVisible();
    expect(textos(api)).toHaveLength(0);

    await llamar(page, "terminar");
    await expect(page.getByText("Anotado: 85 pesos en Café.")).toBeVisible();
    expect(textos(api)).toEqual(["Gasté 85 en café"]);
    await expect(page.getByLabel("Mensaje")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Dictar" })).toBeVisible();
  });

  test("lo dictado se suma a lo que ya estaba escrito", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#chat");
    await page.getByLabel("Mensaje").fill("Uber de");
    await page.getByRole("button", { name: "Dictar" }).click();
    await oir(page, "230 con la Nu", true);
    await expect(page.getByLabel("Mensaje")).toHaveValue("Uber de 230 con la Nu");
    await llamar(page, "terminar");
    await expect.poll(() => textos(api)).toEqual(["Uber de 230 con la Nu"]);
  });

  test("Enviar mientras escucha manda lo dicho una sola vez", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#chat");
    await page.getByRole("button", { name: "Dictar" }).click();
    await oir(page, "¿cuánto llevo en comida?");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Listo.")).toBeVisible();
    await page.waitForTimeout(300);
    expect(textos(api)).toEqual(["¿Cuánto llevo en comida?"]);
  });

  test("Cancelar deja el campo como estaba y no manda nada", async ({ page }) => {
    const api = await prepararSesion(page);
    await page.goto("/#chat");
    await page.getByLabel("Mensaje").fill("Hola");
    await page.getByRole("button", { name: "Dictar" }).click();
    await oir(page, "esto no va");
    await expect(page.getByLabel("Mensaje")).toHaveValue("Hola esto no va");
    await page.getByRole("button", { name: "Cancelar dictado" }).click();
    await expect(page.getByLabel("Mensaje")).toHaveValue("Hola");
    await expect(page.getByRole("button", { name: "Dictar" })).toBeVisible();
    await page.waitForTimeout(300);
    expect(textos(api)).toHaveLength(0);
  });

  test("si no oyó nada o falta el permiso, lo dice", async ({ page }) => {
    await prepararSesion(page);
    await page.goto("/#chat");
    await page.getByRole("button", { name: "Dictar" }).click();
    await llamar(page, "fallar", "no-speech");
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "No te escuché" })).toBeVisible();

    await page.getByRole("button", { name: "Dictar" }).click();
    await llamar(page, "fallar", "not-allowed");
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Permite el micrófono" })).toBeVisible();
  });

  test("lee en voz alta la respuesta a lo dictado, no la de lo escrito", async ({ page }) => {
    const api = new ApiFalsa();
    api.hablar = [200, { respuesta: "Llevas 1,234 pesos en **Comida** este mes.\nVas bien.", conversacion_id: "c1", acciones: [] }];
    await prepararSesion(page, api);
    await page.goto("/#chat");

    await page.getByLabel("Mensaje").fill("¿cómo voy?");
    await page.getByLabel("Mensaje").press("Enter");
    await expect(page.getByText("Vas bien.")).toBeVisible();
    await page.waitForTimeout(200);
    expect(await leido(page)).toEqual([]);

    await page.getByRole("button", { name: "Dictar" }).click();
    await oir(page, "¿y en comida?");
    await llamar(page, "terminar");
    await expect(page.getByText("Vas bien.")).toHaveCount(2);
    await expect.poll(() => leido(page)).toEqual(["Llevas 1,234 pesos en Comida este mes. Vas bien."]);
    // Mientras lee, se puede callar desde la burbuja.
    await page.getByRole("button", { name: "Dejar de leer" }).click();
    await expect(page.getByRole("button", { name: "Dejar de leer" })).toHaveCount(0);

    // Al volver al chat no se repite lo ya leído.
    await page.goto("/#inicio");
    await page.goto("/#chat");
    await page.waitForTimeout(200);
    expect(await leido(page)).toHaveLength(1);
  });

  test("si la IA pregunta algo, al terminar de leer vuelve a escuchar", async ({ page }) => {
    const api = new ApiFalsa();
    api.hablar = [200, { respuesta: "¿Con qué tarjeta lo pagaste?", conversacion_id: "c1", acciones: [], seguir: true }];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    await page.getByRole("button", { name: "Dictar" }).click();
    await oir(page, "gasté 300 en gasolina", true);
    await llamar(page, "terminar");
    await expect.poll(() => leido(page)).toEqual(["¿Con qué tarjeta lo pagaste?"]);
    expect(await inicios(page)).toBe(1);

    await llamar(page, "terminarLectura");
    await expect(page.getByLabel("Mensaje")).toHaveAttribute("placeholder", "Te escucho…");
    expect(await inicios(page)).toBe(2);

    // Contesta y sigue la misma conversación. Un silencio al volver a escuchar no muestra avisos.
    api.hablar = [200, { respuesta: "Listo, con Nu.", conversacion_id: "c1", acciones: [] }];
    await oir(page, "con la Nu", true);
    await llamar(page, "terminar");
    await expect(page.getByText("Listo, con Nu.")).toBeVisible();
    expect((api.de("POST", "/v1/hablar")[1]?.cuerpo as { texto: string; conversacion_id: string })).toMatchObject({
      texto: "Con la Nu",
      conversacion_id: "c1",
    });
  });

  test("el botón de la bocina apaga la lectura y se recuerda", async ({ page }) => {
    const api = new ApiFalsa();
    api.hablar = [200, { respuesta: "¿De cuánto fue?", conversacion_id: "c1", acciones: [] }];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    const bocina = page.getByRole("button", { name: "Leer respuestas en voz alta" });
    await expect(bocina).toHaveAttribute("aria-pressed", "true");
    await bocina.click();
    await expect(bocina).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Ya no leeré" })).toBeVisible();

    await page.getByRole("button", { name: "Dictar" }).click();
    await oir(page, "gasté en el súper", true);
    await llamar(page, "terminar");
    await expect(page.getByText("¿De cuánto fue?")).toBeVisible();
    await page.waitForTimeout(200);
    expect(await leido(page)).toEqual([]);
    // Sin lectura no vuelve a escuchar solo.
    expect(await inicios(page)).toBe(1);

    await page.reload();
    await expect(page.getByRole("button", { name: "Leer respuestas en voz alta" })).toHaveAttribute("aria-pressed", "false");
  });

  test("tocar el micrófono mientras lee la calla y escucha", async ({ page }) => {
    const api = new ApiFalsa();
    api.hablar = [200, { respuesta: "Este mes llevas 4,500 pesos.", conversacion_id: "c1", acciones: [] }];
    await prepararSesion(page, api);
    await page.goto("/#chat");
    await page.getByRole("button", { name: "Dictar" }).click();
    await oir(page, "¿cómo voy?", true);
    await llamar(page, "terminar");
    await expect(page.getByRole("button", { name: "Dejar de leer" })).toBeVisible();
    await page.getByRole("button", { name: "Dictar" }).click();
    await expect(page.getByRole("button", { name: "Dejar de leer" })).toHaveCount(0);
    await expect(page.getByLabel("Mensaje")).toHaveAttribute("placeholder", "Te escucho…");
  });
});

test("sin reconocimiento de voz no hay micrófono ni bocina", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.webkitSpeechRecognition;
    delete w.SpeechRecognition;
  });
  await prepararSesion(page);
  await page.goto("/#chat");
  await expect(page.getByRole("heading", { name: "¿En qué te ayudo?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dictar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leer respuestas en voz alta" })).toHaveCount(0);
  await expect(page.getByText("Toca el micrófono")).toHaveCount(0);
});
