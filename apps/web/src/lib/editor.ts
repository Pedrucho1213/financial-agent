import { useSyncExternalStore } from "react";
import type { MovimientoApp } from "./tipos";

// Una sola hoja de edición para toda la app: se abre desde Inicio, Movimientos o el botón +.
type Estado = { abierto: boolean; movimiento: MovimientoApp | null; clave: number };

let estado: Estado = { abierto: false, movimiento: null, clave: 0 };
const oyentes = new Set<() => void>();

function emitir(nuevo: Estado) {
  estado = nuevo;
  for (const o of oyentes) o();
}

export function abrirEditor(movimiento: MovimientoApp | null = null) {
  emitir({ abierto: true, movimiento, clave: estado.clave + 1 });
}

export function cerrarEditor() {
  emitir({ ...estado, abierto: false });
}

export function useEditor() {
  return useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    () => estado,
  );
}
