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

const MONEDAS: [RegExp, string][] = [
  [/\b(peso|pesos|mxn|varos|baros)\b/, "MXN"],
  [/\b(dolar|dolares|usd|dls)\b/, "USD"],
  [/\b(euro|euros|eur)\b/, "EUR"],
  [/\b(libra|libras)\b/, "GBP"],
  [/\b(yen|yenes)\b/, "JPY"],
];

/** La moneda que menciona la frase ("20 dólares"), si menciona una sola. */
export function monedaDelTexto(texto: string | undefined): string | undefined {
  if (!texto) return undefined;
  const plano = normalizar(texto);
  const dichas = MONEDAS.filter(([patron]) => patron.test(plano)).map(([, codigo]) => codigo);
  return dichas.length === 1 ? dichas[0] : undefined;
}
