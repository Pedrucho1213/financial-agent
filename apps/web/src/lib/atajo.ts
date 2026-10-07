/**
 * Abre el Atajo que preparó la Mac. Es el único lugar que navega al archivo.
 * Safari lo descarga y desde Descargas se abre en Atajos. `shortcuts://import-shortcut`
 * no sirve aquí: iOS responde que la URL del atajo no es válida.
 */
export function abrirAtajo(url: string) {
  window.location.href = new URL(url, window.location.origin).href;
}
