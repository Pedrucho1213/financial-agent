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

// Muletillas a media frase que parecen pregunta y no lo son: "no sé cuánto", "en qué se llama".
const RELLENO = /\b(no se cuanto|no se cuantos|en que se llama|que se llama|como se llama)\b/g;
// Sin monto, una frase que pide hacer algo no es pregunta: "y el Uber fue con la BBVA", "borra el último".
const PIDE_ACCION =
  /\b(fue|fueron|era|eran|gaste|pague|compre|cobre|cobro|cobraron|me pagaron|me depositaron|borra|borralo|elimina|quita|quitalo|cambia|cambialo|corrige|deshaz|cancela|cancele|registra|anota|apunta|ponlo|ponle|pasalo|muevelo|recuerda|recuerdame|acuerdate|olvida|olvidalo|olvidate)\b/;

/** Si el dictado pregunta algo de forma explícita: "¿...?", "cuánto me cuesta Netflix", "dime mis gastos". */
export function pideInformacion(texto: string): boolean {
  if (texto.includes("?")) return true;
  const sinMuletillas = normalizar(texto).replace(RELLENO, " ").replace(/\s+/g, " ").trim().replace(MULETILLAS, "");
  return INICIO_PREGUNTA.test(sinMuletillas) || PIDE_INFORMACION.test(sinMuletillas);
}

/**
 * Si además de lo que dice pide saber algo: "¿...?", "cuánto me queda", "cómo voy". A diferencia de
 * `pideInformacion`, "tengo 20 mil en Revolut" no cuenta aunque empiece con "tengo".
 */
export function pideInformacionExplicita(texto: string): boolean {
  if (texto.includes("?") || texto.includes("¿")) return true;
  return PIDE_INFORMACION.test(normalizar(texto).replace(RELLENO, " "));
}

/** Si el dictado es una pregunta (la respuesta importa más que la rapidez). */
export function esPregunta(texto: string): boolean {
  if (texto.includes("?")) return true;
  const plano = normalizar(texto).replace(RELLENO, " ").replace(/\s+/g, " ").trim();
  const sinMuletillas = plano.replace(MULETILLAS, "");
  const conMonto = montosDelTexto(texto).length > 0;
  // "Estoy pagando 200 de gym" y "dame 50 de..." con un monto no preguntan nada.
  if (conMonto && /^(estoy|dame)\b/.test(sinMuletillas)) return PIDE_INFORMACION.test(sinMuletillas);
  if (INICIO_PREGUNTA.test(sinMuletillas) || PIDE_INFORMACION.test(sinMuletillas)) return true;
  // Sin un monto que anotar ni algo que hacer, es una consulta: "y en Uber", "ver mis gastos", "lo de este mes".
  return !conMonto && !PIDE_ACCION.test(plano);
}

// Órdenes sobre algo ya anotado: "borra el café de 85", "cámbialo a la BBVA". Aunque traigan monto, la
// respuesta puede ser una pregunta ("¿cuál de los dos?") o decir qué cambió (QA-029).
const ORDEN_SOBRE_LO_ANOTADO =
  /\b((borra|elimina|quita|cambia|cancela|edita)(r|lo|la|los|las|me|le|les|melo|mela|rlo|rla)?|pasa(r|lo|la|los|las|me|le|les|melo|mela|rlo|rla)|corrige(lo|la|los|las|me)?|corregir(lo|la)?|mueve(lo|la|los|las|me)?|mover(lo|la)?|deshaz|deshacer)\b/;

// Correcciones que no dicen "cambia" ni "borra": "no eran 85, eran 95", "me equivoqué, fueron 120",
// "en realidad fue con la BBVA", "lo anotaste dos veces". Con monto parecen un registro nuevo y, con
// notificaciones, el Atajo diría "Anotado" sin que nadie oyera qué cambió.
const CORRECCION = new RegExp(
  [
    // Sin el infinitivo: "pagué 500 de arreglar el coche" es un gasto.
    /\b(actualiza|modifica|ajusta|arregla|reemplaza|sustituye|tacha)(lo|la|los|las|me|le|les|rlo|rla)?\b/,
    /\b(agregale|anadele|subele|bajale|quitale)\b/,
    /\bme (equivoque|confundi)\b/,
    /^(siempre no|error|perdon|perdona|disculpa|ups|chin|no espera|espera|no no)\b.*\b(eran|fueron|era|fue|es|son) (de |como )?\d/,
    /^no (eran|fueron|era|fue|son|es) \d/,
    /\b(te dije|dije|habia dicho) (que )?(eran |fueron |era |fue )?\d.*\bpero\b/,
    /\ben realidad (fue|fueron|era|eran|es|son) (de |como )?\d|\ben realidad (fue|era) con\b|\ben realidad (pague|gaste)\b/,
    /\bno (eran|fueron|era|fue)\b.*(\b(eran|fueron|era|fue) ((de )?\d|con|en|por|a|al|el|la|los|las|del)\b|\bsino\b)/,
    /\b((eran|fueron|era|fue|son|es) (de )?)?\d[\d ]*( pesos)?( y)? no (de )?\d/,
    /\b(ponle|ponlo|ponla) \d[\d ]* (al|a la|a los|a las|en el|en la)\b|\bponlo en \d|\bmejor (ponlo|ponla|ponle|pon|que sean|son|eran|fueron)\b/,
    /\b(lo|la|los|las|me lo|me la) (anotaste|registraste|apuntaste|pusiste|cobraste) (dos veces|doble|mal)\b/,
    /\b(esta|quedo|salio) (repetido|duplicado|doble)\b/,
    /\bno (lo|la|los|las) (anotes|registres|apuntes|cuentes)\b/,
    /\b(el|lo) (ultimo|anterior) (era|eran|fue|fueron) (de )?\d|\b(el|lo) (ultimo|anterior) no\b/,
    /(?<!se me )\bolvida(lo|la|los|las)?\b/,
  ]
    .map((r) => r.source)
    .join("|"),
);

/** Si el dictado pide borrar, cambiar, corregir o deshacer algo ya registrado. */
export function esOrdenSobreLoAnotado(texto: string): boolean {
  const plano = normalizar(texto);
  return ORDEN_SOBRE_LO_ANOTADO.test(plano) || CORRECCION.test(plano);
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
