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
  [/€|\bEUR\b|\beuros?\b/i, "EUR"],
  [/MX\$|\bMXN\b|\bpesos?\b/i, "MXN"],
  [/£|\bGBP\b/i, "GBP"],
  [/CA\$|\bCAD\b/i, "CAD"],
];

/** El monto de la Cartera como número y moneda; undefined si no trae un monto mayor a cero. */
export function montoDeWallet(texto: string | undefined, monedaBase = "MXN"): { monto: number; moneda: string } | undefined {
  if (!texto) return undefined;
  const moneda = MONEDAS.find(([patron]) => patron.test(texto))?.[1] ?? monedaBase;
  const cifra = texto.match(/\d[\d.,\s]*/)?.[0].replace(/\s/g, "").replace(/[.,]$/, "");
  if (!cifra) return undefined;
  // El último separador seguido de uno o dos dígitos es el decimal ("1,234.50" o "1.234,50"); los demás son de miles.
  const decimal = cifra.match(/[.,](\d{1,2})$/);
  const entero = (decimal ? cifra.slice(0, -decimal[0].length) : cifra).replace(/[.,]/g, "");
  const monto = Number(`${entero}${decimal ? `.${decimal[1]}` : ""}`);
  return Number.isFinite(monto) && monto > 0 ? { monto: Math.round(monto * 100) / 100, moneda } : undefined;
}

// Números de sucursal, de tarjeta o de terminal ("OXXO 1234", "Visa ••1234"): la IA los tomaría por montos.
const sinNumeros = (texto: string | undefined) =>
  texto
    ?.replace(/[•*·#]+\s*\d*/g, " ")
    .replace(/\d{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || undefined;

const NOMBRES_MONEDA: Record<string, string> = { MXN: "pesos", USD: "dólares", EUR: "euros", GBP: "libras", CAD: "dólares canadienses" };

/** La frase para la IA: "Pagué 85.50 pesos en STARBUCKS COFFEE con la tarjeta Nu (Apple Pay)". */
export function fraseDePago(pago: PagoWallet, monedaBase = "MXN"): string | undefined {
  const monto = montoDeWallet(pago.monto, monedaBase);
  if (!monto) return undefined;
  const comercio = sinNumeros(pago.comercio) ?? sinNumeros(pago.nombre);
  const tarjeta = sinNumeros(pago.tarjeta);
  const cifra = Number.isInteger(monto.monto) ? String(monto.monto) : monto.monto.toFixed(2);
  return (
    `Pagué ${cifra} ${NOMBRES_MONEDA[monto.moneda] ?? monto.moneda}` +
    (comercio ? ` en ${comercio}` : "") +
    (tarjeta ? ` con la tarjeta ${tarjeta}` : "") +
    " (Apple Pay)"
  );
}
