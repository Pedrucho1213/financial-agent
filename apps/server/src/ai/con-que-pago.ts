// Pedro eligió el 14-oct que, si no dice con qué pagó, se le pregunte: el 10-oct el gasto de AutoZone quedó sin
// cuenta y lo tuvo que corregir con otro dictado. El gasto se anota igual, para que no se pierda si no contesta, y la
// respuesta termina preguntando. Con una cuenta o ninguna no se pregunta: no hay de dónde elegir.
import { and, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { cuentas, entradas, movimientos } from "../db/schema";
import { cuentaMencionada, encontrarOCrearCuenta, type Cuenta } from "../finanzas/catalogos";
import type { Contexto } from "../finanzas/contexto";
import { montosDelTexto } from "../lib/numeros";
import { normalizar } from "../lib/texto";
import { MEDIO_DE_PAGO } from "./respaldo";

/** La pregunta que cierra la respuesta; también sirve para reconocer, en el turno siguiente, que se le hizo. */
export const PREGUNTO_CON_QUE_PAGO = /¿Con qué (lo|los) pagaste\?$/;

function cuentasActivas(ctx: Contexto) {
  return ctx.db
    .select({ nombre: cuentas.nombre, alias: cuentas.alias })
    .from(cuentas)
    .where(and(eq(cuentas.usuarioId, ctx.usuarioId), eq(cuentas.archivada, false)))
    .all();
}

/** "Con la Nu", "en efectivo", "con mi tarjeta": la frase dice con qué pagó, o nombra una de sus cuentas. */
function diceConQuePago(texto: string, activas: { nombre: string; alias: string[] }[]): boolean {
  return MEDIO_DE_PAGO.test(normalizar(texto)) || activas.some((c) => [c.nombre, ...c.alias].some((n) => cuentaMencionada(texto, n)));
}

/**
 * Si un gasto dictado así terminaría preguntando con qué pagó. Entonces el Atajo espera la respuesta en vez de
 * decir "Anotado" al momento: la pregunta se oye ahí mismo y no llega después por notificación.
 */
export function preguntariaConQuePago(ctx: Contexto, texto: string): boolean {
  const activas = cuentasActivas(ctx);
  return activas.length >= 2 && !diceConQuePago(texto, activas);
}

/** "¿Con qué lo pagaste?" si este dictado anotó gastos sin cuenta y tiene de dónde elegir. */
export function preguntaConQuePago(ctx: Contexto, entradaId: string): string | undefined {
  const sinCuenta = ctx.db
    .select({ id: movimientos.id })
    .from(movimientos)
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        eq(movimientos.entradaId, entradaId),
        eq(movimientos.tipo, "gasto"),
        isNull(movimientos.cuentaId),
        isNull(movimientos.eliminadoEn),
      ),
    )
    .all().length;
  if (!sinCuenta || cuentasActivas(ctx).length < 2) return undefined;
  return sinCuenta > 1 ? "¿Con qué los pagaste?" : "¿Con qué lo pagaste?";
}

// Lo que se dice antes del nombre de la cuenta: "pues con la", "fue en", "usé mi".
const ANTES_DE_LA_CUENTA = /^(y|pues|fue|fueron|pagu[eé]|lo|los|la|las|us[eé]|con|en|de|mi|el|este|ah|eh|ok|s[ií])[\s,]+/i;
const NO_SABE = /\b(no se|no lo se|ninguna|ninguno|no me acuerdo|no recuerdo|no importa|da igual)\b/;

/**
 * La respuesta a "¿Con qué lo pagaste?": la cuenta, si es una de las suyas y se sabe cuál. Si no ("no sé",
 * "con la de mi hermano", dos cuentas que se llaman igual), decide el modelo.
 */
export function cuentaContestada(ctx: Contexto, texto: string): Cuenta | undefined {
  const plano = normalizar(texto);
  // esPregunta no sirve: sin monto, "con la Nu" también le parece una consulta.
  if (montosDelTexto(texto).length || texto.includes("?") || NO_SABE.test(plano) || plano.split(" ").length > 10) return undefined;
  const activas = cuentasActivas(ctx);
  if (!diceConQuePago(texto, activas)) return undefined;
  let dicho = texto.trim().replace(/[.!¡,;]+$/, "");
  const con = dicho.toLowerCase().lastIndexOf(" con ");
  if (con >= 0) dicho = dicho.slice(con + 5);
  while (ANTES_DE_LA_CUENTA.test(dicho)) dicho = dicho.replace(ANTES_DE_LA_CUENTA, "");
  try {
    return encontrarOCrearCuenta(ctx.db, ctx.usuarioId, dicho, { soloExistente: true, soloLeer: true, siAmbigua: "error" });
  } catch {
    return undefined;
  }
}

/** Los gastos sin cuenta que dejó el dictado anterior de esta conversación: a esos se refiere la respuesta. */
export function gastosSinCuentaDeAntes(ctx: Contexto, entrada: { id: string; conversacionId: string; creadoEn: string }): string[] {
  const previa = ctx.db
    .select({ id: entradas.id })
    .from(entradas)
    .where(
      and(
        eq(entradas.usuarioId, ctx.usuarioId),
        eq(entradas.conversacionId, entrada.conversacionId),
        ne(entradas.id, entrada.id),
        lt(entradas.creadoEn, entrada.creadoEn),
      ),
    )
    .orderBy(desc(entradas.creadoEn), desc(sql`rowid`))
    .limit(1)
    .get();
  if (!previa) return [];
  return ctx.db
    .select({ id: movimientos.id })
    .from(movimientos)
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        eq(movimientos.entradaId, previa.id),
        eq(movimientos.tipo, "gasto"),
        isNull(movimientos.cuentaId),
        isNull(movimientos.eliminadoEn),
      ),
    )
    .all()
    .map((m) => m.id);
}
