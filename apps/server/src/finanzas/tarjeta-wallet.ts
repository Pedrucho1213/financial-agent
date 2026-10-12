// La tarjeta con que se pagó con Apple Pay, como la nombra la Cartera ("Revolut", "Nu", "Mercado Pago"), se
// empata con las cuentas del usuario. Si no queda claro cuál es (Revolut de débito y Revolut crédito con el
// mismo nombre en la Cartera), el pago se anota sin cuenta y se le pregunta (2026-10-12).
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { cuentas } from "../db/schema";
import { normalizar } from "../lib/texto";
import type { Cuenta } from "./catalogos";

// Lo que da Atajos cuando no puede leer la tarjeta: el nombre de la propiedad, no el de la tarjeta.
const ETIQUETA_GENERICA = /^(forma de pago|tarjeta o pase|card or pass|payment method|apple pay|tarjeta|pase|pass|card)$/;

/** El texto de la Cartera no dice qué tarjeta fue ("Forma de pago"). */
export const tarjetaSinNombre = (tarjeta: string | undefined) => !tarjeta || ETIQUETA_GENERICA.test(normalizar(tarjeta));

// Palabras que no distinguen una tarjeta de otra: "Tarjeta de crédito Nu Visa" es "nu".
const RELLENO =
  /\b(tarjeta|tarjetas|card|cuenta|de|del|la|el|mi|credito|credit|debito|debit|visa|mastercard|master|amex|american|express|oro|gold|platino|platinum|clasica|classic|black|signature|world|elite)\b/g;
const base = (texto: string) => normalizar(texto).replace(RELLENO, " ").replace(/\s+/g, " ").trim();
const palabras = (texto: string) => base(texto).split(" ").filter((p) => p.length >= 2);

function tipoDicho(texto: string): "credito" | "debito" | undefined {
  const n = normalizar(texto);
  if (/\b(credito|credit)\b/.test(n)) return "credito";
  if (/\b(debito|debit)\b/.test(n)) return "debito";
  return undefined;
}

// Las cuentas con que se paga con Apple Pay: no el efectivo.
const TIPOS_CON_TARJETA = new Set(["credito", "debito", "otra", "monedero", "vales"]);
const MAX_OPCIONES = 6;

/**
 * La cuenta de la tarjeta de la Cartera, o las que podrían ser si no queda claro. Un alias igual al nombre de la
 * Cartera decide (el usuario lo puso a propósito); un nombre igual no basta si otra cuenta se llama parecido
 * ("Revolut" y "Revolut crédito").
 */
export function cuentaDeTarjeta(db: Db, usuarioId: string, tarjeta: string | undefined): { cuenta?: Cuenta; opciones: Cuenta[] } {
  if (tarjetaSinNombre(tarjeta)) return { opciones: [] };
  const dicha = normalizar(tarjeta!);
  const activas = db
    .select()
    .from(cuentas)
    .where(and(eq(cuentas.usuarioId, usuarioId), eq(cuentas.archivada, false)))
    .all()
    .filter((c) => TIPOS_CON_TARJETA.has(c.tipo));
  const porAlias = activas.filter((c) => c.alias.some((a) => normalizar(a) === dicha));
  if (porAlias.length === 1) return { cuenta: porAlias[0], opciones: [] };
  const buscadas = palabras(tarjeta!);
  let candidatas = activas.filter((c) => [c.nombre, ...c.alias].some((n) => palabras(n).some((p) => buscadas.includes(p))));
  const tipo = tipoDicho(tarjeta!);
  if (candidatas.length > 1 && tipo) {
    const delTipo = candidatas.filter((c) => c.tipo === tipo);
    if (delTipo.length) candidatas = delTipo;
  }
  if (candidatas.length === 1) return { cuenta: candidatas[0], opciones: [] };
  // Varias con ese nombre, o ninguna: se pregunta entre las que podrían ser (o entre todas sus tarjetas).
  return { opciones: (candidatas.length ? candidatas : activas).slice(0, MAX_OPCIONES) };
}

/** El inicio de la pregunta: la notificación de un pago que la trae abre el chat para contestarla. */
export const PREGUNTA_TARJETA = "¿Con cuál tarjeta pagaste";

/** "¿Con cuál tarjeta pagaste: Revolut o Revolut crédito?" */
export function preguntaDeTarjeta(opciones: string[]): string {
  if (!opciones.length) return `${PREGUNTA_TARJETA}?`;
  const lista = opciones.length === 1 ? opciones[0] : `${opciones.slice(0, -1).join(", ")} o ${opciones.at(-1)}`;
  return `${PREGUNTA_TARJETA}: ${lista}?`;
}
