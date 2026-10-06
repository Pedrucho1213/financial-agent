import { useSyncExternalStore } from "react";

// El token del dispositivo vive en localStorage. Todo lo demás se deriva de él.
const CLAVE = "fa_token";
const oyentes = new Set<() => void>();

function leer(): string | null {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}

let actual = leer();

function avisar() {
  for (const o of oyentes) o();
}

export function obtenerToken() {
  return actual;
}

export function guardarToken(token: string) {
  actual = token;
  try {
    localStorage.setItem(CLAVE, token);
  } catch {
    // Sin almacenamiento (modo privado): la sesión dura lo que la pestaña.
  }
  avisar();
}

const alCerrar = new Set<() => void>();

/** Se llama al cerrar sesión o al recibir un 401; limpia caché y datos de la sesión. */
export function alCerrarSesion(fn: () => void) {
  alCerrar.add(fn);
  return () => alCerrar.delete(fn);
}

export function cerrarSesion() {
  actual = null;
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // nada
  }
  for (const fn of alCerrar) fn();
  avisar();
}

function suscribir(fn: () => void) {
  oyentes.add(fn);
  const enOtraPestana = (e: StorageEvent) => {
    if (e.key !== CLAVE) return;
    actual = leer();
    fn();
  };
  window.addEventListener("storage", enOtraPestana);
  return () => {
    oyentes.delete(fn);
    window.removeEventListener("storage", enOtraPestana);
  };
}

export function useToken() {
  return useSyncExternalStore(suscribir, obtenerToken, () => null);
}
