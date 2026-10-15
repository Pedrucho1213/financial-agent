import { useSyncExternalStore } from "react";

/**
 * Apariencia de la app: la del teléfono (Automático) o una fija. Se recuerda en este dispositivo y va en
 * <html data-tema="claro|oscuro">; el CSS (index.css, variante `dark`) hace el resto.
 */
export type Tema = "auto" | "claro" | "oscuro";

const CLAVE = "fa_tema";
const EVENTO = "fa:tema";
const consulta = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
// Color de la barra de estado y de Safari: el fondo de la app en cada modo.
const FONDO = { claro: "#f2f2f7", oscuro: "#000000" } as const;

function leerGuardado(): Tema {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === "claro" || v === "oscuro" ? v : "auto";
  } catch {
    return "auto";
  }
}

let actual: Tema = typeof window === "undefined" ? "auto" : leerGuardado();

/** Pone el tema en la página. Se llama antes de pintar la app (main.tsx) y al elegir otro. */
export function aplicarTema(tema: Tema = actual) {
  const raiz = document.documentElement;
  if (tema === "auto") delete raiz.dataset.tema;
  else raiz.dataset.tema = tema;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", tema === "auto" ? "light dark" : tema === "oscuro" ? "dark" : "light");
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const delOscuro = meta.media.includes("dark");
    meta.content = tema === "auto" ? (delOscuro ? FONDO.oscuro : FONDO.claro) : FONDO[tema];
  }
  // Igual que public/tema.js: la barra de estado normal también en oscuro. Con black-translucent iOS 26+ difumina lo
  // que queda bajo la hora (la campana, el mes y el título se veían apagados).
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute("content", "default");
}

export function guardarTema(tema: Tema) {
  actual = tema;
  try {
    if (tema === "auto") localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, tema);
  } catch {
    // Sin almacenamiento solo dura esta visita.
  }
  aplicarTema(tema);
  window.dispatchEvent(new Event(EVENTO));
}

function suscribir(fn: () => void) {
  window.addEventListener(EVENTO, fn);
  consulta?.addEventListener("change", fn);
  return () => {
    window.removeEventListener(EVENTO, fn);
    consulta?.removeEventListener("change", fn);
  };
}

export function useTema(): Tema {
  return useSyncExternalStore(
    suscribir,
    () => actual,
    () => "auto",
  );
}

/** true si la app se ve en oscuro ahora (lo elegido o, en Automático, lo del teléfono). */
export function useModoOscuro() {
  return useSyncExternalStore(
    suscribir,
    () => actual === "oscuro" || (actual === "auto" && !!consulta?.matches),
    () => false,
  );
}

// En Automático, si el teléfono cambia de claro a oscuro con la app abierta, el color de la barra de estado lo sigue.
consulta?.addEventListener("change", () => aplicarTema());
