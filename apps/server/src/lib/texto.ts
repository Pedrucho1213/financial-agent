/** Minúsculas, sin acentos ni espacios repetidos: "Café " -> "cafe". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cómo empieza una pregunta dictada: "¿cuánto llevo...?", "dime mis suscripciones".
const INICIO_PREGUNTA =
  /^(y )?(cuanto|cuantos|cuantas|cual|cuales|que|como|cuando|donde|en que|por que|dime|muestrame|ensename|dame|lista|resumen|hay|tengo|me alcanza|estoy)\b/;

/** Si el dictado es una pregunta (la respuesta importa más que la rapidez). */
export function esPregunta(texto: string): boolean {
  return texto.includes("?") || INICIO_PREGUNTA.test(normalizar(texto));
}
