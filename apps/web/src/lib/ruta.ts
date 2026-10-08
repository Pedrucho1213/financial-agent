import { useMemo, useSyncExternalStore } from "react";

// Pestañas por hash (#inicio, #movimientos?mes=2026-10, #chat, #ajustes) sin router.
export const PESTANAS = ["inicio", "movimientos", "chat", "ajustes"] as const;
export type Pestana = (typeof PESTANAS)[number];

// Páginas que se abren encima de una pestaña (como un "push" de iOS), con su pestaña madre.
export const PAGINAS = { plan: "inicio", mapa: "movimientos", analisis: "inicio" } as const satisfies Record<string, Pestana>;
// El detalle de un registro es #movimientos?detalle=<id> (o <id1>,<id2>): así lo abren las notificaciones,
// y una app vieja que no lo conoce simplemente muestra Movimientos.
export type Pagina = keyof typeof PAGINAS | "movimiento";

export type Ruta = { pestana: Pestana; pagina?: Pagina; params: URLSearchParams };

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
  const params = new URLSearchParams(consulta);
  if (Object.hasOwn(PAGINAS, nombre)) {
    const pagina = nombre as keyof typeof PAGINAS;
    return { pestana: PAGINAS[pagina], pagina, params };
  }
  if (nombre === "movimientos" && params.get("detalle")) return { pestana: "movimientos", pagina: "movimiento", params };
  // Enlaces de los avisos del revisor nocturno.
  if (nombre === "presupuestos" || nombre === "metas") {
    if (nombre === "metas") params.set("seccion", "metas");
    return { pestana: "inicio", pagina: "plan", params };
  }
  if (nombre === "movimientos" && params.has("texto") && !params.has("q")) {
    params.set("q", params.get("texto") ?? "");
    params.delete("texto");
  }
  const pestana = (PESTANAS as readonly string[]).includes(nombre) ? (nombre as Pestana) : "inicio";
  return { pestana, params };
}

export function hashDe(pestana: Pestana | keyof typeof PAGINAS, params?: Record<string, string | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) p.set(k, v);
  const consulta = p.toString();
  return `#${pestana}${consulta ? `?${consulta}` : ""}`;
}

/** Cambia de pantalla. Con `reemplazar` no agrega una entrada al historial (filtros). */
export function navegar(hash: string, { reemplazar = false } = {}) {
  if (`#${leerHash()}` === hash) return;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  // La marca dice que hay una pantalla de la app detrás: "Atrás" puede volver con el historial.
  if (reemplazar) window.history.replaceState(window.history.state, "", url);
  else window.history.pushState({ fa: true }, "", url);
  window.dispatchEvent(new Event(EVENTO));
}

/** Atrás de una página: vuelve en el historial si se llegó desde la app; si no (una notificación), a su pestaña. */
export function volver(pestana: Pestana) {
  if ((window.history.state as { fa?: boolean } | null)?.fa) window.history.back();
  else navegar(hashDe(pestana), { reemplazar: true });
}

export function useRuta(): Ruta {
  const hash = useSyncExternalStore(suscribir, leerHash, () => "");
  return useMemo(() => parsearRuta(hash), [hash]);
}

/** Dirección del detalle de uno o varios registros. */
export const hashDetalle = (ids: string | string[], extra?: { editar?: boolean }) =>
  hashDe("movimientos", { detalle: [ids].flat().join(","), editar: extra?.editar ? "1" : undefined });
