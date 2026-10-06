import { montosDelTexto } from "./numeros";

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

// Muletillas con las que empieza un dictado: "oye, cuánto...", "a ver, y en Uber".
const MULETILLAS = /^((oye|oiga|hey|a ver|bueno|mira|este|ok|okey|pues|entonces|que onda|y) )+/;
// Cómo empieza una pregunta dictada: "¿cuánto llevo...?", "dime mis suscripciones".
// "Tengo que pagar..." y "hay que pagar..." no preguntan nada.
const INICIO_PREGUNTA =
  /^(cuanto|cuantos|cuantas|cual|cuales|que|como|cuando|donde|en que|por que|dime|muestrame|ensename|dame|lista|resumen|hay(?! que)|tengo(?! que)|me alcanza|estoy)\b/;
// Frases que piden información aunque no empiecen así: "quiero saber cuánto gasté", "cuéntame cómo voy".
const PIDE_INFORMACION =
  /\b(cuanto|cuanta|cuantos|cuantas|cuales|en que|quiero saber|necesito saber|me puedes decir|puedes decirme|me dices|cuentame|dime|muestrame|ensename|como voy|como vamos|como ando|que tal voy|voy bien|vamos bien|me alcanza|puedo gastar)\b/;

/** Si el dictado es una pregunta (la respuesta importa más que la rapidez). */
export function esPregunta(texto: string): boolean {
  if (texto.includes("?")) return true;
  const plano = normalizar(texto);
  const sinMuletillas = plano.replace(MULETILLAS, "");
  if (INICIO_PREGUNTA.test(sinMuletillas) || PIDE_INFORMACION.test(sinMuletillas)) return true;
  // "Y en Uber", "y el mes pasado": sigue la pregunta anterior si no trae un monto que anotar.
  return /^y /.test(plano) && montosDelTexto(texto).length === 0;
}

const MONEDAS: [RegExp, string][] = [
  [/\b(peso|pesos|mxn|varos|baros)\b/, "MXN"],
  [/\b(dolar|dolares|usd|dls)\b/, "USD"],
  [/\b(euro|euros|eur)\b/, "EUR"],
  // "2 libras de carne" es peso, no dinero.
  [/\b(gbp|libras? esterlinas?)\b|\blibras?\b(?! de\b)/, "GBP"],
  [/\b(yen|yenes)\b/, "JPY"],
];

/** La moneda que menciona la frase ("20 dólares"), si menciona una sola. */
export function monedaDelTexto(texto: string | undefined): string | undefined {
  if (!texto) return undefined;
  const plano = normalizar(texto);
  const dichas = MONEDAS.filter(([patron]) => patron.test(plano)).map(([, codigo]) => codigo);
  return dichas.length === 1 ? dichas[0] : undefined;
}

// Verbos que dicen si el dinero salió o entró: "pagué", "cargué" contra "me pagaron", "cobré".
const SALIDA = /\b(gaste|pague|compre|cargue|me cobraron|me cobro|me eche|se me fueron|pedi|invite)\b/;
const ENTRADA = /\b(me pagaron|me pago|me depositaron|me deposito|cobre|me devolvieron|me regresaron|me transfirieron|me dieron|gane|recibi|me cayo|me cayeron|vendi)\b/;

/** "gasto" o "ingreso" si los verbos de la frase solo apuntan a uno de los dos. */
export function tipoDelTexto(texto: string | undefined): "gasto" | "ingreso" | undefined {
  if (!texto) return undefined;
  const plano = normalizar(texto);
  const sale = SALIDA.test(plano);
  const entra = ENTRADA.test(plano);
  return sale === entra ? undefined : sale ? "gasto" : "ingreso";
}
