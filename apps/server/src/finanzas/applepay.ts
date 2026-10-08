// Un pago con Apple Pay que manda el Atajo "Finanzas Apple Pay" (automatización "Transacción" de la Cartera)
// se vuelve una frase como las dictadas, para que la IA lo registre igual: comercio, categoría y tarjeta.

export type PagoWallet = {
  /** Como lo da la Cartera: "$85.00", "MX$1,234.50", "US$12.00", "12,50 €" o un número. */
  monto?: string;
  /** Comercio de la transacción ("STARBUCKS COFFEE"). */
  comercio?: string;
  /** Nombre de la transacción; a veces es lo único que trae del comercio. */
  nombre?: string;
  /** Tarjeta o pase con que se pagó ("Nu", "BBVA Azul"). */
  tarjeta?: string;
};

const MONEDAS: [RegExp, string][] = [
  [/US\$|\bUSD\b|\bdólares?\b/i, "USD"],
  [/COP\$|\bCOP\b/i, "COP"],
  [/(?<![A-Z])R\$|\bBRL\b/i, "BRL"],
  [/AU\$|(?<![A-Z])A\$|\bAUD\b/i, "AUD"],
  [/CN¥|RMB|\bCNY\b/i, "CNY"],
  [/€|\bEUR\b|\beuros?\b/i, "EUR"],
  [/MX\$|\bMXN\b|\bpesos?\b/i, "MXN"],
  [/£|\bGBP\b/i, "GBP"],
  [/CA\$|\bCAD\b/i, "CAD"],
  [/¥|\bJPY\b/i, "JPY"],
];

/** El monto de la Cartera como número y moneda; undefined si no trae un monto mayor a cero. */
export function montoDeWallet(texto: string | undefined, monedaBase = "MXN"): { monto: number; moneda: string } | undefined {
  if (!texto || esDevolucion(texto)) return undefined;
  const moneda = MONEDAS.find(([patron]) => patron.test(texto))?.[1] ?? monedaBase;
  const cifra = texto.match(/\d[\d.,\s]*/)?.[0].replace(/\s/g, "").replace(/[.,]$/, "");
  if (!cifra) return undefined;
  // El último separador seguido de uno o dos dígitos es el decimal ("1,234.50" o "1.234,50"); los demás son de miles.
  const decimal = cifra.match(/[.,](\d{1,2})$/);
  const entero = (decimal ? cifra.slice(0, -decimal[0].length) : cifra).replace(/[.,]/g, "");
  const monto = Number(`${entero}${decimal ? `.${decimal[1]}` : ""}`);
  return Number.isFinite(monto) && monto > 0 ? { monto: Math.round(monto * 100) / 100, moneda } : undefined;
}

// Un monto con su moneda dentro de un texto libre ("$41.00", "MX$1,234.50", "12,50 €", "41 MXN"). Sin moneda no
// se toma: el texto puede traer números de tarjeta o de sucursal.
// El signo de un reembolso solo cuenta pegado al monto ("-$85.00", "($85.00)"), como lo muestra la Cartera: en
// "Starbucks - $41.00" el guion separa, no resta.
const MONTO_EN_TEXTO =
  /(?:(?<=^|\s)[-−–(])?(?:[A-Z]{1,3}\$|\$|€|£|¥)\s?\d[\d.,]*|(?:(?<=^|\s)[-−–(])?\d[\d.,]*\s?(?:€|£|\b(?:MXN|USD|EUR|GBP|CAD|pesos?)\b)/i;

/**
 * Cuando el Atajo no pudo leer las propiedades de la transacción (la Cartera cambió un nombre), saca el monto
 * del texto completo de la transacción; el resto del texto queda como nombre para la IA.
 */
export function pagoDeTransaccion(entrada: string | undefined): PagoWallet | undefined {
  const m = entrada?.match(MONTO_EN_TEXTO);
  if (!entrada || !m) return undefined;
  // Sin el monto, quedan los guiones que lo separaban: "OXXO – – Nu" queda "OXXO – Nu".
  const resto = entrada
    .replace(m[0], " ")
    .replace(/(?:\s+[-−–·|]+)+\s+/g, " – ")
    .replace(/^[\s\-−–·|,]+|[\s\-−–·|,]+$/g, "")
    .replace(/\s+/g, " ");
  return { monto: m[0].trim(), ...(resto ? { nombre: resto.slice(0, 200) } : {}) };
}

/** "-$85.00" o "($85.00)": la Cartera muestra así un reembolso; no es un gasto. */
export const esDevolucion = (texto: string) => /^[^\d]*[-−–(]/.test(texto.trim());

// Números de sucursal, de tarjeta o de terminal ("OXXO 1234", "Visa ••1234"): la IA los tomaría por montos.
const sinNumeros = (texto: string | undefined) =>
  texto
    ?.replace(/[•*·#]+\s*\d*/g, " ")
    .replace(/["“”„‟«»″‶〝〞＂]/g, " ")
    .replace(/\d{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || undefined;

const NOMBRES_MONEDA: Record<string, string> = {
  MXN: "pesos",
  USD: "dólares",
  EUR: "euros",
  GBP: "libras",
  CAD: "dólares canadienses",
  AUD: "dólares australianos",
  JPY: "yenes",
  COP: "pesos colombianos",
  BRL: "reales",
  CNY: "yuanes",
};

/**
 * El monto y la moneda de una frase armada por fraseDePago. Con eso el pago se anota con lo que dijo la
 * Cartera aunque el modelo copie mal el monto.
 */
export function pagoDeFrase(texto: string | undefined): { monto: number; moneda: string; comercio?: string } | undefined {
  const nombres = Object.entries(NOMBRES_MONEDA).sort(([, a], [, b]) => b.length - a.length);
  const m = texto?.match(new RegExp(`^Pagué (\\d+(?:\\.\\d+)?) (${nombres.map(([, n]) => n).join("|")}|[A-Z]{3})\\b(?: en "([^"]+)")?`));
  if (!m) return undefined;
  const moneda = nombres.find(([, n]) => n === m[2])?.[0] ?? m[2]!;
  return { monto: Number(m[1]), moneda, ...(m[3] ? { comercio: m[3] } : {}) };
}

/**
 * La frase para la IA: 'Pagué 85.50 pesos en "STARBUCKS COFFEE" con la tarjeta "Nu" (Apple Pay)'. El comercio
 * y la tarjeta van entre comillas: son nombres, no órdenes.
 */
export function fraseDePago(pago: PagoWallet, monedaBase = "MXN"): string | undefined {
  const monto = montoDeWallet(pago.monto, monedaBase);
  if (!monto) return undefined;
  const comercio = sinNumeros(pago.comercio) ?? sinNumeros(pago.nombre);
  const tarjeta = sinNumeros(pago.tarjeta);
  const cifra = Number.isInteger(monto.monto) ? String(monto.monto) : monto.monto.toFixed(2);
  return (
    `Pagué ${cifra} ${NOMBRES_MONEDA[monto.moneda] ?? monto.moneda}` +
    (comercio ? ` en "${comercio}"` : "") +
    (tarjeta ? ` con la tarjeta "${tarjeta}"` : "") +
    " (Apple Pay)"
  );
}
