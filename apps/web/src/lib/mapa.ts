// Si el usuario quiere calles se recuerda en este dispositivo.
const CLAVE_CALLES = "fa_mapa_calles";
export function leerCalles() {
  try {
    return localStorage.getItem(CLAVE_CALLES) === "1";
  } catch {
    return false;
  }
}
export function guardarCalles(v: boolean) {
  try {
    if (v) localStorage.setItem(CLAVE_CALLES, "1");
    else localStorage.removeItem(CLAVE_CALLES);
  } catch {
    // Sin almacenamiento solo dura esta visita.
  }
}
