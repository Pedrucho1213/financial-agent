import type { Busqueda } from "../finanzas/movimientos";
import { montosDelTexto } from "../lib/numeros";
import { esPregunta, normalizar } from "../lib/texto";

// "El súper de hoy fue con la tarjeta de crédito Nu", "el Uber de ayer lo pagué con la BBVA".
const PAGO_CON = /^(?:y )?(.+?) (?:fue|era|lo pague|la pague|lo pagamos|se pago) con (.+)$/;
// Lo que va después de "con" tiene que sonar a medio de pago, no a "la cena fue con mis amigos".
const MEDIO_DE_PAGO =
  /\b(tarjeta|efectivo|cash|credito|debito|transferencia|spei|vales|monedero|mercado pago|paypal|bbva|nu|banorte|santander|hsbc|banamex|citibanamex|scotiabank|inbursa|azteca|banregio|amex|american express|liverpool|klar|stori|uala|openbank|bancoppel|coppel|hey banco|rappicard|didi card)\b/;
// "con Nu, no con BBVA", "con la Nu y el Uber con BBVA": dice más de una cosa y eso lo decide el modelo.
const VARIAS_COSAS = /\b(con|no|y|o|ni|pero|sino)\b/;
const DIA = /\b(hoy|ayer|antier|anteayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/;

/**
 * "El súper de hoy fue con la Nu": corrige con qué pagaste un gasto ya registrado, sin decir el monto.
 * El modelo chico a veces la toma por un registro y pregunta "¿de cuánto fue?" (QA-020); con esto
 * se corrige sin él. Devuelve qué buscar y la cuenta tal como la dijiste, o undefined si no es eso.
 * `cuentas`: nombres y alias de las cuentas que ya tiene el usuario.
 */
export function correccionDeCuenta(texto: string, cuentas: string[]): { buscar: Busqueda; cuenta: string } | undefined {
  if (montosDelTexto(texto).length > 0 || esPregunta(texto)) return undefined;
  const partes = normalizar(texto).match(PAGO_CON);
  if (!partes) return undefined;
  const [, sujeto, medio] = partes as unknown as [string, string, string];
  const conocida = cuentas.some((c) => {
    const nombre = normalizar(c);
    return nombre.length > 0 && ` ${medio} `.includes(` ${nombre} `);
  });
  if (!conocida && !MEDIO_DE_PAGO.test(medio)) return undefined;
  if (VARIAS_COSAS.test(medio)) return undefined;
  if (sujeto.split(" ").length > 6) return undefined;
  const dia = sujeto.match(DIA)?.[1];
  const queBuscar = sujeto.replace(DIA, " ").replace(/\s+/g, " ").trim();
  if (!queBuscar) return undefined;
  // La cuenta como la dijiste ("la tarjeta de crédito Nu"); encontrarOCrearCuenta le quita "la tarjeta de".
  const original = texto.trim().replace(/[.!¡,;]+$/, "");
  const cuenta = original.slice(original.toLowerCase().lastIndexOf(" con ") + 5).trim();
  if (/[,;:]/.test(cuenta)) return undefined;
  // Sin día, "el súper" es el más reciente de la última semana.
  const buscar: Busqueda = dia ? { texto: queBuscar, periodo: dia } : { texto: queBuscar, periodo: "ultima_semana", mas_reciente: true };
  return { buscar, cuenta };
}
