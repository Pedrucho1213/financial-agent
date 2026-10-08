import type { MovimientoApp, TipoMovimiento } from "./tipos";

// Lo mínimo de cada movimiento para Análisis. Aparte de analisis.ts para no cargar los cálculos
// en el paquete principal (consultas.ts la usa).

/** Un movimiento reducido a lo que Análisis usa: pesa poco en el caché sin conexión. */
export type Fila = {
  id: string;
  /** Fecha YYYY-MM-DD. */
  f: string;
  /** Minuto del día (0–1439) en que pasó, o null si no se sabe (registros con otra fecha quedan a mediodía). */
  h: number | null;
  t: TipoMovimiento;
  c: number;
  m: string;
  /** Categoría (puede ser una subcategoría). */
  k: string | null;
  /** Comercio. */
  n: string | null;
  /** Cómo se llama en una lista: comercio, descripción o categoría. */
  e: string;
  /** Cuenta o método de pago, como lo dijo. */
  a: string | null;
};

export function aFila(m: MovimientoApp): Fila {
  return {
    id: m.id,
    f: m.fecha,
    h: minutoDelDia(m.ocurridoEn),
    t: m.tipo,
    c: m.montoCentavos,
    m: m.moneda,
    k: m.categoriaId,
    n: m.comercio?.trim() || null,
    e: m.comercio?.trim() || m.descripcion?.trim() || m.categoria?.split(">").pop()?.trim() || "Movimiento",
    a: m.cuenta?.trim() || null,
  };
}

/**
 * El servidor guarda a mediodía exacto (hora local) lo que se anotó con otra fecha: esa hora no es real.
 * Una compra a las 12:00:00.000 en punto casi no pasa, así que se descarta.
 */
export function minutoDelDia(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getHours() === 12 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) return null;
  return d.getHours() * 60 + d.getMinutes();
}
