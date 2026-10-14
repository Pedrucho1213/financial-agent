// Las calles salen por omisión; si el usuario las apaga se recuerda en este dispositivo.
const CLAVE_CALLES = "fa_mapa_calles";
export function leerCalles() {
  try {
    return localStorage.getItem(CLAVE_CALLES) !== "0";
  } catch {
    return true;
  }
}
export function guardarCalles(v: boolean) {
  try {
    localStorage.setItem(CLAVE_CALLES, v ? "1" : "0");
  } catch {
    // Sin almacenamiento solo dura esta visita.
  }
}
