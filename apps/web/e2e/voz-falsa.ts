import type { Page } from "@playwright/test";

/**
 * Reconocimiento de voz y lectura falsos, controlados desde la prueba con window.__voz:
 * - oir(texto, final): llega un resultado del dictado.
 * - fallar(error) / terminar(): el reconocimiento falla o termina (como cuando dejas de hablar).
 * - leido: lo que se mandó a leer en voz alta; terminarLectura() acaba de leer.
 */
export async function vozFalsa(page: Page) {
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
