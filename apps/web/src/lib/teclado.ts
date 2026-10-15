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

// El alto de la ventana sin teclado: el mayor que se ha visto con este ancho (al girar se vuelve a medir).
let altoNormal = 0;
let anchoNormal = 0;

function recordarAlto(conTeclado: boolean) {
  if (window.innerWidth !== anchoNormal) {
    anchoNormal = window.innerWidth;
    altoNormal = 0;
  }
  if (!conTeclado) altoNormal = Math.max(altoNormal, window.innerHeight);
}

/**
 * En la app instalada de iOS, a veces la ventana no recupera su alto al cerrar el teclado: se queda ~60 pt más corta
 * hasta cerrar la app, y lo que está pegado abajo (la barra de pestañas, la caja del chat) flota con una franja negra
 * debajo. No se puede pintar en esa franja (queda fuera de la ventana), así que hay que hacer que WebKit la vuelva a
 * medir: esconder la app y volverla a mostrar en el mismo instante (sin que alcance a pintarse) lo obliga, y si no
 * basta, volver a poner la etiqueta viewport.
 */
function recuperarAlto(intento: number) {
  if (!instalada() || abreTeclado(document.activeElement)) return;
  if (!altoNormal || window.innerHeight >= altoNormal - 4) return;
  const y = window.scrollY;
  if (intento === 0) {
    const raiz = document.getElementById("root");
    if (!raiz) return;
    raiz.style.display = "none";
    void raiz.offsetHeight;
    raiz.style.display = "";
  } else {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const contenido = meta.content;
    meta.content = `${contenido}, height=device-height`;
    requestAnimationFrame(() => {
      meta.content = contenido;
    });
  }
  window.scrollTo(window.scrollX, y);
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
      recordarAlto(abierto);
      setAbierto(abierto);
    };
    // Al pasar el foco de un campo a otro, focusout llega antes que focusin: se mide ya que se asentó. Ya que el
    // teclado terminó de irse, si la ventana se quedó corta se le pide a WebKit que la vuelva a medir.
    const esperas: number[] = [];
    const alCambiarFoco = () => {
      for (const id of esperas.splice(0)) window.clearTimeout(id);
      esperas.push(window.setTimeout(medir, 0));
      esperas.push(window.setTimeout(() => recuperarAlto(0), 400));
      esperas.push(window.setTimeout(() => recuperarAlto(1), 900));
      esperas.push(window.setTimeout(medir, 1000));
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
