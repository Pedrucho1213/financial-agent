import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { editorAbierto } from "./editor";

// Mantiene la app instalada al día. En el iPhone la app casi nunca se vuelve a abrir desde cero: se queda
// en segundo plano y al volver sigue con la versión vieja aunque el servidor ya tenga otra. Por eso aquí:
// - al volver a la app (y cada 30 minutos con la app a la vista) se le pide al navegador que revise;
// - cuando la versión nueva ya está descargada, se recarga si el usuario acaba de abrir o volver a la app
//   y no está escribiendo nada; si no, al volver la próxima vez o con «Actualizar» en Ajustes;
// - «Buscar actualizaciones» compara con /version.json y, si el service worker no cambia solo, borra su
//   copia guardada y recarga desde la red, que siempre trae lo último.

export const VERSION_APP = __VERSION_APP__;

const CADA = 30 * 60_000;
// Tras abrir la app, o volver tras un rato fuera, hay unos segundos en los que recargar no interrumpe nada.
// Una salida corta (copiar un código, ver un mensaje) no cuenta: al volver se espera ver lo mismo.
const RECIEN_VUELTO = 15_000;
const RATO_FUERA = 30_000;
// Lo que puede tardar el service worker nuevo en bajar y tomar el control.
const ESPERA_SW = 12_000;

let registro: ServiceWorkerRegistration | undefined;
let lista = false;
// Mientras «Buscar actualizaciones» espera la versión nueva: ella recarga, sin avisos de por medio.
let manual = false;
let visibleDesde = Date.now();
let ocultaDesde = 0;
// Cuánto estuvo fuera antes de volver; al abrir la app desde cero, como si fuera mucho.
let ultimaSalida = Number.POSITIVE_INFINITY;
let ultimaRevision = Date.now();
const oyentes = new Set<() => void>();

function emitir() {
  for (const o of oyentes) o();
}

/** true cuando ya se descargó una versión nueva y falta recargar para verla. */
export function useVersionLista() {
  return useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    () => lista,
  );
}

export function recargar() {
  window.location.reload();
}

/** Recargar ahora no tira nada a medias: ni el editor abierto ni un campo con el cursor. */
function sinNadaAMedias() {
  const activo = document.activeElement;
  const escribiendo = activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement || (activo as HTMLElement | null)?.isContentEditable;
  return !editorAbierto() && !escribiendo;
}

/** Acaba de abrir la app o de volver tras un rato fuera, y no hay nada a medias. */
function momentoSeguro() {
  return ultimaSalida >= RATO_FUERA && Date.now() - visibleDesde < RECIEN_VUELTO && sinNadaAMedias();
}

function alTenerVersionNueva() {
  const yaAvisada = lista;
  lista = true;
  emitir();
  if (manual) return;
  if (document.visibilityState === "visible" && momentoSeguro()) {
    recargar();
    return;
  }
  if (!yaAvisada) toast("Hay una versión nueva de la app", { action: { label: "Actualizar", onClick: recargar } });
}

function revisar() {
  ultimaRevision = Date.now();
  if (!navigator.onLine) return;
  registro?.update().catch(() => undefined);
}

/** Registra el service worker y empieza a buscar versiones nuevas. Una vez, al arrancar la app. */
export function iniciarActualizaciones() {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  // El service worker nuevo se activa solo (skipWaiting) y toma esta página: la página sigue con el
  // código viejo hasta recargar. La primera instalación no cambia de controlador (no hay clientsClaim).
  let teniaControlador = Boolean(sw.controller);
  sw.addEventListener("controllerchange", () => {
    if (!teniaControlador) {
      teniaControlador = true;
      return;
    }
    alTenerVersionNueva();
  });
  const registrar = () => {
    if (typeof sw.register !== "function") return;
    sw.register("/sw.js", { scope: "/" }).then(
      (r) => {
        registro = r;
      },
      () => undefined,
    );
  };
  if (document.readyState === "complete") registrar();
  else window.addEventListener("load", registrar, { once: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      ocultaDesde = Date.now();
      return;
    }
    visibleDesde = Date.now();
    ultimaSalida = ocultaDesde ? visibleDesde - ocultaDesde : Number.POSITIVE_INFINITY;
    if (lista && momentoSeguro()) {
      recargar();
      return;
    }
    revisar();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible" && Date.now() - ultimaRevision >= CADA) revisar();
  }, 60_000);
}

export type ResultadoBusqueda = "al-dia" | "actualizando" | "sin-conexion" | "sin-respuesta";

async function versionDelServidor(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const v = (await r.json()) as Partial<typeof VERSION_APP>;
    return typeof v.commit === "string" ? v.commit : null;
  } catch {
    return null;
  }
}

/** Espera a que el service worker nuevo tome el control (o se rinde). */
function esperarVersionLista(ms: number) {
  return new Promise<boolean>((resolver) => {
    if (lista) return resolver(true);
    const listo = () => {
      if (!lista) return;
      clearTimeout(t);
      oyentes.delete(listo);
      resolver(true);
    };
    const t = setTimeout(() => {
      oyentes.delete(listo);
      resolver(false);
    }, ms);
    oyentes.add(listo);
  });
}

/**
 * Borra lo que guardó el service worker y recarga: sin copia guardada, todo sale de la red con la versión
 * del servidor. El service worker no se quita: con él se irían las notificaciones de este dispositivo.
 */
async function recargarDesdeLaRed() {
  try {
    const nombres = await caches.keys();
    await Promise.all(nombres.map((n) => caches.delete(n)));
  } catch {
    // sin permiso para borrar: la recarga lo intenta igual
  }
  recargar();
}

/**
 * «Buscar actualizaciones»: si el servidor tiene otra versión, la baja y recarga. Devuelve "actualizando"
 * justo antes de recargar, para que la fila lo diga mientras tanto.
 */
export async function buscarActualizacion(alActualizar: () => void): Promise<ResultadoBusqueda> {
  if (lista) {
    alActualizar();
    recargar();
    return "actualizando";
  }
  if (!navigator.onLine) return "sin-conexion";
  const delServidor = await versionDelServidor();
  if (delServidor === null) return "sin-respuesta";
  if (delServidor === VERSION_APP.commit) {
    revisar();
    return "al-dia";
  }
  alActualizar();
  const r = registro;
  if (!r) {
    recargar();
    return "actualizando";
  }
  manual = true;
  ultimaRevision = Date.now();
  // Si el navegador no encuentra un service worker distinto, esperar no sirve: directo a la red.
  const actualizado = await r.update().then(
    () => (r.installing || r.waiting || lista ? esperarVersionLista(ESPERA_SW) : false),
    () => false,
  );
  if (actualizado) recargar();
  else await recargarDesdeLaRed();
  return "actualizando";
}
