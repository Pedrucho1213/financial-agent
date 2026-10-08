import { aFecha, dinero, dineroCorto, leerMonto } from "./formato";
import type { CuentaConMes, EstadoCuenta, TipoCuenta } from "./tipos";

// Cálculos de cuentas y tarjetas para las pantallas, sin React (se prueban con bun test).
// null es "no se sabe": aquí nunca se vuelve 0.

export const NOMBRE_TIPO: Record<TipoCuenta, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Cuenta",
  vales: "Vales",
  monedero: "Monedero",
  otra: "Otra",
};

/** Un tipo que el servidor agregue después dice "Cuenta" en lugar de "undefined". */
export const nombreTipo = (tipo: string) => NOMBRE_TIPO[tipo as TipoCuenta] ?? "Cuenta";

/** La próxima fecha con ese día del mes (hoy cuenta). Un 31 en un mes de 30 cae en el último día. */
export function proximaFecha(dia: number, hoy: string): string {
  let [a, m] = hoy.split("-").map(Number) as [number, number];
  for (let i = 0; i < 2; i++) {
    const ultimo = new Date(a, m, 0).getDate();
    const fecha = `${a}-${String(m).padStart(2, "0")}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
    if (fecha >= hoy) return fecha;
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
  return hoy;
}

export function diasEntreFechas(desde: string, hasta: string) {
  return Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86_400_000);
}

/** "hoy", "mañana", "en 9 días". */
export function enCuantosDias(fecha: string, hoy: string) {
  const n = diasEntreFechas(hoy, fecha);
  if (n <= 0) return "hoy";
  if (n === 1) return "mañana";
  return `en ${n} días`;
}

/** Qué parte del límite está usada (0 a 1, o más si se pasó). null si falta la deuda o el límite. */
export function usoCredito(e: Pick<EstadoCuenta, "deudaCentavos" | "limiteCentavos">): number | null {
  if (e.deudaCentavos === null || !e.limiteCentavos) return null;
  return Math.max(0, e.deudaCentavos) / e.limiteCentavos;
}

/**
 * Crédito de todas las tarjetas: solo las que tienen deuda y límite dichos (sumar un límite sin su
 * deuda daría 100% usado). `fuera`: las que tienen deuda pero no límite; las de deuda desconocida
 * ya salen en `sinSaldo`. null si no hay ninguna que sume.
 */
export function creditoTotal(cuentas: EstadoCuenta[]) {
  const tarjetas = cuentas.filter((c) => c.esCredito && !c.archivada);
  const suman = tarjetas.filter((c) => c.deudaCentavos !== null && !!c.limiteCentavos);
  const fuera = tarjetas.filter((c) => c.deudaCentavos !== null && !c.limiteCentavos).map((c) => c.nombre);
  if (!suman.length) return null;
  let limite = 0;
  let usado = 0;
  let disponible = 0;
  for (const c of suman) {
    const deuda = Math.max(0, c.deudaCentavos!);
    limite += c.limiteCentavos!;
    usado += deuda;
    disponible += Math.max(0, c.limiteCentavos! - deuda);
  }
  return { uso: usado / limite, limite, disponible, fuera };
}

/** Color del uso de una tarjeta: como el revisor, que avisa desde el 90%. */
export function colorUso(uso: number) {
  if (uso >= 0.9) return "var(--negative)";
  if (uso >= 0.7) return "var(--orange)";
  return "var(--tint)";
}

/** Cuentas de dinero (efectivo, débito, otra) y tarjetas de crédito, cada grupo con las conocidas primero. */
export function separarCuentas<T extends EstadoCuenta>(lista: T[]) {
  const activas = lista.filter((e) => !e.archivada);
  const dinero = activas
    .filter((e) => !e.esCredito)
    .sort((a, b) => Number(b.saldoCentavos !== null) - Number(a.saldoCentavos !== null) || (b.saldoCentavos ?? 0) - (a.saldoCentavos ?? 0) || a.nombre.localeCompare(b.nombre));
  const tarjetas = activas
    .filter((e) => e.esCredito)
    .sort((a, b) => Number(b.deudaCentavos !== null) - Number(a.deudaCentavos !== null) || (b.deudaCentavos ?? 0) - (a.deudaCentavos ?? 0) || a.nombre.localeCompare(b.nombre));
  return { dinero, tarjetas, archivadas: lista.filter((e) => e.archivada) };
}

export type Porcion = { id: string; nombre: string; centavos: number; parte: number };

/**
 * Dónde está su dinero: lo que hay en cada cuenta (solo saldos conocidos y positivos), de mayor a menor.
 * Más de `maximo` cuentas: las chicas se juntan en "Otras" para no inventar más colores.
 */
export function repartoDinero(lista: EstadoCuenta[], maximo = 5): Porcion[] {
  const con = lista
    .filter((e) => !e.archivada && !e.esCredito && e.saldoCentavos !== null && e.saldoCentavos > 0)
    .sort((a, b) => b.saldoCentavos! - a.saldoCentavos!);
  const total = con.reduce((s, e) => s + e.saldoCentavos!, 0);
  if (!total) return [];
  const visibles = con.length > maximo ? con.slice(0, maximo - 1) : con;
  const resto = con.slice(visibles.length);
  const porciones = visibles.map((e) => ({ id: e.id, nombre: e.nombre, centavos: e.saldoCentavos!, parte: e.saldoCentavos! / total }));
  if (resto.length) {
    const centavos = resto.reduce((s, e) => s + e.saldoCentavos!, 0);
    porciones.push({ id: "otras", nombre: `Otras ${resto.length}`, centavos, parte: centavos / total });
  }
  return porciones;
}

/** Lo que se lee debajo del nombre de una cuenta en la lista. */
export function lineaCuenta(e: CuentaConMes, moneda: string): string {
  if (!e.conocido) return e.esCredito ? "No sé cuánto debes" : "No sé cuánto hay";
  if (e.esCredito) {
    // Corto: el límite y las fechas están en su pantalla.
    if (e.deudaCentavos !== null && e.deudaCentavos < 0) return `${dineroCorto(-e.deudaCentavos, moneda)} a favor`;
    if (e.disponibleCentavos === null) return "Sin límite dicho";
    return e.disponibleCentavos >= 0
      ? `${dineroCorto(e.disponibleCentavos, moneda)} disponible`
      : `Te pasaste ${dineroCorto(-e.disponibleCentavos, moneda)}`;
  }
  const { entradaCentavos: entro, salidaCentavos: salio } = e.mes;
  if (!entro && !salio) return "Sin movimientos este mes";
  const partes = [entro ? `+${dineroCorto(entro, moneda)}` : null, salio ? `−${dineroCorto(salio, moneda)}` : null].filter(Boolean);
  return `Este mes ${partes.join(" ")}`;
}

/** "Nu: debes $2,000 · BBVA: $18,000", para el aviso después de mover dinero. */
export function describirCuentas(estados: EstadoCuenta[], moneda: string): string {
  return estados
    .filter((e) => e.conocido)
    .map((e) => {
      if (!e.esCredito) return `${e.nombre}: ${dinero(e.saldoCentavos ?? 0, moneda)}`;
      if (e.deudaCentavos === null) return `${e.nombre}: ${dinero(e.disponibleCentavos ?? 0, moneda)} disponible`;
      if (e.deudaCentavos <= 0) return `${e.nombre}: no debes nada`;
      return `${e.nombre}: debes ${dinero(e.deudaCentavos, moneda)}`;
    })
    .join(" · ");
}

/** Texto de un campo de pesos a partir de centavos ("1500.5"), o vacío si no se sabe. */
export function aTextoPesos(centavos: number | null): string {
  if (centavos === null) return "";
  return String(centavos / 100);
}

/**
 * Como leerMonto, pero "0" también vale ("no debo nada", "no tengo nada") y respeta el signo:
 * "-200" en "Debes" es saldo a favor, en "Tienes" un sobregiro. Vacío es null.
 */
export function leerCantidad(texto: string): number | null {
  const t = texto.replace(/[^\d.,]/g, "");
  if (!t) return null;
  if (/^[0.,]+$/.test(t)) return 0;
  const n = leerMonto(t);
  return n !== null && esNegativo(texto) ? -n : n;
}

const esNegativo = (texto: string) => /^\s*[-−]/.test(texto);

/** Lo que se teclea en un campo de pesos: dígitos, punto y coma, y un menos solo al inicio. */
export const limpiarPesos = (texto: string) => `${esNegativo(texto) ? "-" : ""}${texto.replace(/[^\d.,]/g, "").slice(0, 12)}`;

/** Las cuentas sin saldo que no entran en "Tienes": "falta Nu", "faltan Nu y Revolut", "faltan 3". */
export function faltan(sinSaldo: string[]): string {
  if (!sinSaldo.length) return "";
  if (sinSaldo.length === 1) return `falta ${sinSaldo[0]}`;
  if (sinSaldo.length === 2) return `faltan ${sinSaldo[0]} y ${sinSaldo[1]}`;
  return `faltan ${sinSaldo.length}`;
}
