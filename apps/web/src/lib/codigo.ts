import { ErrorApi } from "./api";

/** Los códigos de invitación son de 6 letras o números. */
export const LARGO_CODIGO = 6;

export function limpiarCodigo(texto: string) {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, LARGO_CODIGO);
}

export function codigoDeLaDireccion() {
  return limpiarCodigo(new URLSearchParams(window.location.search).get("codigo") ?? "");
}

/** Saca el código de lo que se copió: el código solo, el enlace con ?codigo= o el texto de una invitación. */
export function codigoDeTexto(texto: string) {
  const enEnlace = texto.match(/[?&]codigo=([a-z0-9]{6})\b/i)?.[1];
  if (enEnlace) return enEnlace.toUpperCase();
  const limpio = limpiarCodigo(texto.replace(/\s+/g, ""));
  if (limpio.length === LARGO_CODIGO && texto.replace(/[\s-]/g, "").length === LARGO_CODIGO) return limpio;
  const fichas = texto.toUpperCase().match(/(?<![A-Z0-9])[A-Z0-9]{6}(?![A-Z0-9])/g);
  return fichas?.at(-1) ?? null;
}

export function mensajeInvitacion(error: unknown) {
  if (error instanceof ErrorApi) {
    if (error.estado === 404) return "Ese código no existe. Revísalo o pide uno nuevo.";
    if (error.estado === 410) return "Ese código ya se usó o venció. Pide uno nuevo.";
    if (error.estado === 429) return "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
    return error.message;
  }
  return "No pudimos revisar el código. Inténtalo de nuevo.";
}
