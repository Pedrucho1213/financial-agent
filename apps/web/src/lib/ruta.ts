import { useMemo, useSyncExternalStore } from "react";

// Pestañas por hash (#inicio, #movimientos?mes=2026-10, #chat, #ajustes) sin router.
export const PESTANAS = ["inicio", "movimientos", "chat", "ajustes"] as const;
export type Pestana = (typeof PESTANAS)[number];

export type Ruta = { pestana: Pestana; params: URLSearchParams };

const EVENTO = "fa:ruta";

function leerHash(): string {
  return window.location.hash.replace(/^#/, "");
}

function suscribir(fn: () => void) {
  window.addEventListener("hashchange", fn);
  window.addEventListener("popstate", fn);
  window.addEventListener(EVENTO, fn);
  return () => {
    window.removeEventListener("hashchange", fn);
    window.removeEventListener("popstate", fn);
    window.removeEventListener(EVENTO, fn);
  };
}

export function parsearRuta(hash: string): Ruta {
  const [nombre = "", consulta = ""] = hash.split("?");
  const pestana = (PESTANAS as readonly string[]).includes(nombre) ? (nombre as Pestana) : "inicio";
  return { pestana, params: new URLSearchParams(consulta) };
}

export function hashDe(pestana: Pestana, params?: Record<string, string | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) p.set(k, v);
  const consulta = p.toString();
  return `#${pestana}${consulta ? `?${consulta}` : ""}`;
}

/** Cambia de pantalla. Con `reemplazar` no agrega una entrada al historial (filtros). */
export function navegar(hash: string, { reemplazar = false } = {}) {
  if (`#${leerHash()}` === hash) return;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (reemplazar) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(EVENTO));
}

export function useRuta(): Ruta {
  const hash = useSyncExternalStore(suscribir, leerHash, () => "");
  return useMemo(() => parsearRuta(hash), [hash]);
}
