import { and, eq, isNull } from "drizzle-orm";
import { FRECUENCIAS, recurrentes, TIPOS_RECURRENTE } from "../db/schema";
import { aCentavos, formatearMonto } from "../lib/dinero";
import { armarFecha, diaSemana, partes, sumarDias, sumarMeses } from "../lib/fechas";
import { encontrarCategoria, encontrarOCrearCuenta, listarCategorias } from "./catalogos";
import type { Contexto } from "./contexto";
import { ErrorFinanzas, registrarEnBitacora } from "./movimientos";

export type Recurrente = typeof recurrentes.$inferSelect;

export type DatosRecurrente = {
  nombre: string;
  tipo: (typeof TIPOS_RECURRENTE)[number];
  monto: number;
  frecuencia: (typeof FRECUENCIAS)[number];
  dia: number;
  mes?: number;
  categoria?: string;
  cuenta?: string;
};

/** Próxima fecha de cobro (o de pago, si es un ingreso) a partir de hoy, hoy incluido. */
export function proximoCobro(r: Pick<Recurrente, "frecuencia" | "dia" | "mes">, hoy: string): string {
  const { anio, mes } = partes(hoy);
  switch (r.frecuencia) {
    case "semanal": {
      const faltan = (r.dia - diaSemana(hoy) + 7) % 7;
      return sumarDias(hoy, faltan);
    }
    case "quincenal": {
      // Dos cobros al mes: el día indicado y quince días después (o fin de mes).
      const candidatos = [0, 1].flatMap((desplazamiento) => {
        const base = sumarMeses(armarFecha(anio, mes, 1), desplazamiento, 1);
        const p = partes(base);
        return [armarFecha(p.anio, p.mes, r.dia), armarFecha(p.anio, p.mes, r.dia + 15)];
      });
      return candidatos.filter((f) => f >= hoy).sort()[0]!;
    }
    case "mensual": {
      const este = armarFecha(anio, mes, r.dia);
      return este >= hoy ? este : sumarMeses(armarFecha(anio, mes, 1), 1, r.dia);
    }
    case "anual": {
      const este = armarFecha(anio, r.mes ?? mes, r.dia);
      return este >= hoy ? este : armarFecha(anio + 1, r.mes ?? mes, r.dia);
    }
  }
}

/** Cuánto pesa al mes, para sumar suscripciones de distinta frecuencia. */
export function montoMensual(r: Pick<Recurrente, "frecuencia" | "montoCentavos">): number {
  switch (r.frecuencia) {
    case "semanal":
      return Math.round((r.montoCentavos * 52) / 12);
    case "quincenal":
      return r.montoCentavos * 2;
    case "mensual":
      return r.montoCentavos;
    case "anual":
      return Math.round(r.montoCentavos / 12);
  }
}

function describir(ctx: Contexto, r: Recurrente) {
  return {
    id: r.id,
    nombre: r.nombre,
    tipo: r.tipo,
    monto: formatearMonto(r.montoCentavos, r.moneda),
    frecuencia: r.frecuencia,
    proximo_cobro: proximoCobro(r, ctx.hoy),
  };
}

export function crearRecurrente(ctx: Contexto, datos: DatosRecurrente) {
  if (!(datos.monto > 0)) throw new ErrorFinanzas("El monto debe ser mayor a cero.");
  const maximo = datos.frecuencia === "semanal" ? 7 : 31;
  if (!Number.isInteger(datos.dia) || datos.dia < 1 || datos.dia > maximo) {
    throw new ErrorFinanzas(`El día debe estar entre 1 y ${maximo}.`);
  }
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const tipoCat = datos.tipo === "ingreso" ? "ingreso" : "gasto";
  const categoria =
    encontrarCategoria(cats, datos.categoria, tipoCat) ??
    encontrarCategoria(cats, datos.nombre, tipoCat) ??
    (datos.tipo === "suscripcion" ? encontrarCategoria(cats, "Suscripciones", "gasto") : undefined) ??
    (datos.tipo === "renta" ? encontrarCategoria(cats, "Renta", "gasto") : undefined);
  const fila = ctx.db
    .insert(recurrentes)
    .values({
      usuarioId: ctx.usuarioId,
      nombre: datos.nombre.trim(),
      tipo: datos.tipo,
      montoCentavos: aCentavos(datos.monto),
      moneda: ctx.monedaBase,
      frecuencia: datos.frecuencia,
      dia: datos.dia,
      mes: datos.mes,
      categoriaId: categoria?.id,
      cuentaId: encontrarOCrearCuenta(ctx.db, ctx.usuarioId, datos.cuenta)?.id,
      entradaId: ctx.entradaId,
    })
    .returning()
    .get();
  registrarEnBitacora(ctx, "recurrentes", fila.id, "crear", undefined, fila);
  return describir(ctx, fila);
}

/** Recurrentes activos ordenados por próximo cobro; con `dias`, solo los que vencen en ese plazo. */
export function listarRecurrentes(ctx: Contexto, opciones: { dias?: number; tipo?: Recurrente["tipo"] } = {}) {
  let filas = ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn)))
    .all();
  if (opciones.tipo) filas = filas.filter((r) => r.tipo === opciones.tipo);
  const gastos = filas.filter((r) => r.tipo !== "ingreso");
  const limite = opciones.dias !== undefined ? sumarDias(ctx.hoy, opciones.dias) : undefined;
  const lista = filas
    .map((r) => describir(ctx, r))
    .filter((r) => !limite || r.proximo_cobro <= limite)
    .sort((a, b) => a.proximo_cobro.localeCompare(b.proximo_cobro));
  return {
    recurrentes: lista,
    total_mensual_gastos: formatearMonto(gastos.reduce((s, r) => s + montoMensual(r), 0), ctx.monedaBase),
  };
}
