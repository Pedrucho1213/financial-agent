export function aCentavos(monto: number): number {
  return Math.round(monto * 100);
}

const formatos = new Map<string, Intl.NumberFormat>();

/** 125050 -> "$1,250.50"; 8500 -> "$85". Otras monedas llevan su código: "20 USD". */
export function formatearMonto(centavos: number, moneda = "MXN"): string {
  const pesos = centavos / 100;
  const clave = Number.isInteger(pesos) ? "entero" : "decimal";
  let formato = formatos.get(clave);
  if (!formato) {
    formato = new Intl.NumberFormat("es-MX", {
      minimumFractionDigits: clave === "entero" ? 0 : 2,
      maximumFractionDigits: 2,
    });
    formatos.set(clave, formato);
  }
  const numero = formato.format(pesos);
  return moneda === "MXN" ? `$${numero}` : `${numero} ${moneda}`;
}

// Cómo se dice cada moneda en voz: [singular, plural].
const NOMBRES_MONEDA: Record<string, [string, string]> = {
  MXN: ["peso", "pesos"],
  USD: ["dólar", "dólares"],
  EUR: ["euro", "euros"],
  GBP: ["libra", "libras"],
  JPY: ["yen", "yenes"],
};
// La moneda que el modelo a veces escribe después del monto: "$50 pesos", "$20 USD".
const PALABRA_MONEDA: [RegExp, string][] = [
  [/^(pesos?|mxn)$/i, "MXN"],
  [/^(d[oó]lar(es)?|usd)$/i, "USD"],
  [/^(euros?|eur)$/i, "EUR"],
];
const NUMERO = String.raw`\d[\d,]*(?:\.\d+)?`;

/**
 * Montos escritos para leerse en voz alta. La voz del iPhone lee "$50" como "50 dólares", así que
 * con pesos como moneda base "$1,250" se dice "1,250 pesos"; "20 USD" se dice "20 dólares".
 */
export function montosParaVoz(texto: string, monedaBase = "MXN"): string {
  const decir = (numero: string, codigo: string) => {
    const nombre = NOMBRES_MONEDA[codigo];
    return nombre ? `${numero} ${numero === "1" ? nombre[0] : nombre[1]}` : `${numero} ${codigo}`;
  };
  return texto
    .replace(new RegExp(String.raw`(US)?\$\s?(${NUMERO})(?:\s?(pesos?|mxn|d[oó]lar(?:es)?|usd|euros?|eur)\b)?`, "gi"), (_, us, numero, palabra) => {
      const dicha = palabra ? PALABRA_MONEDA.find(([patron]) => patron.test(palabra))?.[1] : undefined;
      return decir(numero, dicha ?? (us ? "USD" : monedaBase));
    })
    .replace(new RegExp(String.raw`(${NUMERO})\s?(MXN|USD|EUR|GBP|JPY)\b`, "g"), (_, numero, codigo) => decir(numero, codigo));
}
