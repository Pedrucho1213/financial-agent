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

// Lo marca la hoja abierta: si tiene cambios sin guardar, abrir otro movimiento pregunta antes de perderlos.
let cambiosSinGuardar = false;

export function avisarCambiosSinGuardar(hay: boolean) {
  cambiosSinGuardar = hay;
}

export function abrirEditor(movimiento: MovimientoApp | null = null) {
  if (estado.abierto && cambiosSinGuardar) {
    // El mismo movimiento (otro aviso igual): se sigue editando. Otro: se pregunta (QA-074). Es el diálogo
    // del sistema porque la hoja abierta tapa todo lo demás, avisos incluidos.
    if (movimiento?.id === estado.movimiento?.id) return;
    if (!window.confirm("Tienes cambios sin guardar. ¿Descartarlos y abrir el otro movimiento?")) return;
  }
  cambiosSinGuardar = false;
  emitir({ abierto: true, movimiento, clave: estado.clave + 1 });
}

export function cerrarEditor() {
  cambiosSinGuardar = false;
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
