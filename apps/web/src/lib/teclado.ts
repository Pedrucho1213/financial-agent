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
      document.documentElement.style.setProperty("--teclado", `${alto}px`);
      setAbierto(alto > 120 || (conDedo() && abreTeclado(document.activeElement)));
    };
    // Al pasar el foco de un campo a otro, focusout llega antes que focusin: se mide ya que se asentó.
    const alCambiarFoco = () => window.setTimeout(medir, 0);
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
      document.documentElement.style.setProperty("--teclado", "0px");
    };
  }, []);
  return abierto;
}
