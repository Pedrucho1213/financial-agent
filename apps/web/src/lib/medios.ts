import { useSyncExternalStore } from "react";

/** true si la media query se cumple; se actualiza al girar o cambiar el tamaño. */
export function useMedia(consulta: string) {
  return useSyncExternalStore(
    (fn) => {
      const m = window.matchMedia(consulta);
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}
