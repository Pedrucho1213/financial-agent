import { useEffect, useState } from "react";

const SIN_TECLADO = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** Un campo que, con el foco, saca el teclado en pantalla (no casillas, botones ni listas). */
function abreTeclado(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !SIN_TECLADO.has(el.type) && !el.readOnly && !el.disabled;
  return false;
}

/** En un teléfono (dedo, no mouse): ahí un campo con foco significa teclado en pantalla. */
const conDedo = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

/** Abierta desde el ícono de la pantalla de inicio: ahí no hay barras de Safari que cambien el alto de la vista. */
const instalada = () =>
  (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
  (navigator as { standalone?: boolean }).standalone === true;

// El alto de la vista sin teclado: el mayor que se ha visto con este ancho (al girar o cambiar el tema se vuelve a medir).
let altoNormal = 0;
let anchoNormal = 0;
if (typeof window !== "undefined") {
  const olvidar = () => {
    altoNormal = 0;
  };
  window.addEventListener("fa:tema", olvidar);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", olvidar);
}

/**
 * Cuánto se quedó corta la vista después de cerrar el teclado. En la app instalada de iOS 26+, a veces la vista no
 * regresa a su alto completo: la barra de abajo y la caja de escribir se quedan flotando a media pantalla, con un
 * hueco abajo, hasta reabrir la app. Con este número (variable CSS --hueco) se bajan a su lugar.
 */
function medirHueco(vv: VisualViewport | null, conTeclado: boolean): number {
  if (!vv || !instalada() || Math.abs(vv.scale - 1) > 0.01) return 0;
  if (window.innerWidth !== anchoNormal) {
    anchoNormal = window.innerWidth;
    altoNormal = 0;
  }
  if (conTeclado) return 0;
  altoNormal = Math.max(altoNormal, vv.height);
  const hueco = Math.round(altoNormal - vv.height);
  // Más que eso ya no es el error de iOS (sería un teclado sin foco, por ejemplo): mejor no mover nada.
  return hueco >= 4 && hueco <= 120 ? hueco : 0;
}

/**
 * Si el teclado en pantalla está abierto, para esconder la barra de abajo y pegar la caja de escribir encima de él.
 *
 * Se sabe de dos formas, porque iOS cambió cómo lo hace:
 * - La vista visible se encoge y la página no (Safari): la diferencia es el alto del teclado, y queda en la
 *   variable CSS --teclado para mover la caja de escribir.
 * - Toda la página se encoge (la app instalada en iOS 26+): la diferencia es 0, pero hay un campo con foco.
 */
export function useTeclado() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const medir = () => {
      const alto = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      const abierto = alto > 120 || (conDedo() && abreTeclado(document.activeElement));
      document.documentElement.style.setProperty("--teclado", `${alto}px`);
      document.documentElement.style.setProperty("--hueco", `${medirHueco(vv, abierto)}px`);
      setAbierto(abierto);
    };
    // Al pasar el foco de un campo a otro, focusout llega antes que focusin: se mide ya que se asentó. Y otra vez
    // cuando el teclado ya terminó de irse, porque iOS no siempre avisa con un resize al final.
    const esperas: number[] = [];
    const alCambiarFoco = () => {
      for (const id of esperas.splice(0)) window.clearTimeout(id);
      for (const ms of [0, 350, 900]) esperas.push(window.setTimeout(medir, ms));
    };
    medir();
    vv?.addEventListener("resize", medir);
    vv?.addEventListener("scroll", medir);
    document.addEventListener("focusin", alCambiarFoco);
    document.addEventListener("focusout", alCambiarFoco);
    return () => {
      vv?.removeEventListener("resize", medir);
      vv?.removeEventListener("scroll", medir);
      document.removeEventListener("focusin", alCambiarFoco);
      document.removeEventListener("focusout", alCambiarFoco);
      for (const id of esperas) window.clearTimeout(id);
      document.documentElement.style.setProperty("--teclado", "0px");
    };
  }, []);
  return abierto;
}
