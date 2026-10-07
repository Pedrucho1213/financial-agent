import { and, eq, isNull } from "drizzle-orm";
import { avisos, FRECUENCIAS, recurrentes, TIPOS_RECURRENTE } from "../db/schema";
import { aCentavos, formatearMonto } from "../lib/dinero";
import { armarFecha, diaSemana, partes, sumarDias, sumarMeses } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import { encontrarCategoria, encontrarOCrearCuenta, listarCategorias } from "./catalogos";
import type { Contexto } from "./contexto";
import { ErrorFinanzas, registrarEnBitacora } from "./movimientos";

export type Recurrente = typeof recurrentes.$inferSelect;

export type DatosRecurrente = {
  nombre: string;
  tipo: (typeof TIPOS_RECURRENTE)[number];
  monto: number;
  moneda?: string;
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

function validar(datos: Pick<DatosRecurrente, "monto" | "frecuencia" | "dia">) {
  if (!(datos.monto > 0)) throw new ErrorFinanzas("El monto debe ser mayor a cero.");
  const maximo = datos.frecuencia === "semanal" ? 7 : 31;
  if (!Number.isInteger(datos.dia) || datos.dia < 1 || datos.dia > maximo) {
    throw new ErrorFinanzas(`El día debe estar entre 1 y ${maximo}.`);
  }
}

export function crearRecurrente(ctx: Contexto, datos: DatosRecurrente) {
  validar(datos);
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
      moneda: datos.moneda?.toUpperCase() || ctx.monedaBase,
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

function activos(ctx: Contexto) {
  return ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn)))
    .all();
}

/** Recurrentes activos ordenados por próximo cobro; con `dias`, solo los que vencen en ese plazo. */
export function listarRecurrentes(ctx: Contexto, opciones: { dias?: number; tipo?: Recurrente["tipo"] } = {}) {
  let filas = activos(ctx);
  if (opciones.tipo) filas = filas.filter((r) => r.tipo === opciones.tipo);
  const gastos = filas.filter((r) => r.tipo !== "ingreso");
  // Los que se cobran en otra moneda no se suman a los pesos: se listan aparte.
  const enBase = gastos.filter((r) => r.moneda === ctx.monedaBase);
  const otras = gastos.filter((r) => r.moneda !== ctx.monedaBase).map((r) => `${r.nombre}: ${formatearMonto(montoMensual(r), r.moneda)}`);
  const limite = opciones.dias !== undefined ? sumarDias(ctx.hoy, opciones.dias) : undefined;
  const lista = filas
    .map((r) => describir(ctx, r))
    .filter((r) => !limite || r.proximo_cobro <= limite)
    .sort((a, b) => a.proximo_cobro.localeCompare(b.proximo_cobro));
  return {
    recurrentes: lista,
    total_mensual_gastos: formatearMonto(enBase.reduce((s, r) => s + montoMensual(r), 0), ctx.monedaBase),
    total_mensual_otras_monedas: otras.length ? otras : undefined,
  };
}

/** El recurrente que el usuario nombra ("Netflix", "la renta"), o un error que dice cuáles hay. */
function encontrarRecurrente(ctx: Contexto, nombre: string): Recurrente {
  const filas = activos(ctx);
  const buscado = normalizar(nombre).replace(/^(el|la|los|las|mi|mis) /, "");
  const exactos = filas.filter((r) => normalizar(r.nombre) === buscado);
  const parecidos = exactos.length ? exactos : filas.filter((r) => normalizar(r.nombre).includes(buscado) || buscado.includes(normalizar(r.nombre)));
  if (parecidos.length === 1) return parecidos[0]!;
  const nombres = filas.map((r) => r.nombre).join(", ") || "ninguno";
  if (parecidos.length === 0) throw new ErrorFinanzas(`No tengo un pago recurrente llamado "${nombre}". Los que hay: ${nombres}.`);
  throw new ErrorFinanzas(`Coinciden ${parecidos.map((r) => r.nombre).join(", ")}. Pregunta cuál.`);
}

export type CambiosRecurrente = Partial<Pick<DatosRecurrente, "nombre" | "monto" | "moneda" | "frecuencia" | "dia" | "mes">>;

function darDeBaja(ctx: Contexto, antes: Recurrente) {
  const despues = ctx.db
    .update(recurrentes)
    .set({ eliminadoEn: new Date().toISOString() })
    .where(eq(recurrentes.id, antes.id))
    .returning()
    .get()!;
  registrarEnBitacora(ctx, "recurrentes", antes.id, "eliminar", antes, despues);
}

/** "Cancelé Netflix": deja de contarse y de recordarse. Se puede deshacer. */
export function cancelarRecurrente(ctx: Contexto, nombre: string) {
  const antes = encontrarRecurrente(ctx, nombre);
  darDeBaja(ctx, antes);
  return { nombre: antes.nombre, monto: formatearMonto(antes.montoCentavos, antes.moneda), frecuencia: antes.frecuencia };
}

/**
 * "Spotify subió a 129": se cancela el anterior y se crea uno con los cambios, así deshacer
 * (que restaura o cancela recurrentes completos) también regresa al monto de antes.
 */
export function editarRecurrente(ctx: Contexto, nombre: string, cambios: CambiosRecurrente) {
  const antes = encontrarRecurrente(ctx, nombre);
  const datos = {
    nombre: cambios.nombre?.trim() || antes.nombre,
    monto: cambios.monto ?? antes.montoCentavos / 100,
    moneda: cambios.moneda?.toUpperCase() || antes.moneda,
    frecuencia: cambios.frecuencia ?? antes.frecuencia,
    dia: cambios.dia ?? antes.dia,
    mes: cambios.mes ?? antes.mes,
  };
  validar(datos);
  if (
    datos.nombre === antes.nombre &&
    aCentavos(datos.monto) === antes.montoCentavos &&
    datos.moneda === antes.moneda &&
    datos.frecuencia === antes.frecuencia &&
    datos.dia === antes.dia &&
    datos.mes === antes.mes
  ) {
    throw new ErrorFinanzas("No indicaste qué cambiar.");
  }
  darDeBaja(ctx, antes);
  const { id: _, creadoEn: __, eliminadoEn: ___, ...resto } = antes;
  const fila = ctx.db
    .insert(recurrentes)
    .values({
      ...resto,
      nombre: datos.nombre,
      montoCentavos: aCentavos(datos.monto),
      moneda: datos.moneda,
      frecuencia: datos.frecuencia,
      dia: datos.dia,
      mes: datos.mes,
      entradaId: ctx.entradaId,
    })
    .returning()
    .get();
  registrarEnBitacora(ctx, "recurrentes", fila.id, "crear", undefined, fila);
  return describir(ctx, fila);
}

const NOMBRES_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/**
 * Cobros que vienen (hoy, mañana, o dentro de los días de aviso de cada uno) de los que todavía no
 * se avisó: "Ojo: mañana se cobra Netflix de $219." `marcar` los da por avisados para no repetirlo.
 * `pagados`: lo que se acaba de registrar ("Netflix", "Renta"); de eso no se avisa y queda como avisado.
 */
export function cobrosPorAvisar(ctx: Contexto, pagados: string[] = []): { aviso?: string; marcar: () => void } | undefined {
  const yaPagado = new Set(pagados.map(normalizar));
  const pendientes = activos(ctx)
    .filter((r) => r.tipo !== "ingreso")
    .map((r) => ({ r, fecha: proximoCobro(r, ctx.hoy) }))
    .filter(({ r, fecha }) => fecha <= sumarDias(ctx.hoy, r.avisarDiasAntes) && r.avisadoPara !== fecha);
  if (pendientes.length === 0) return undefined;
  const recienPagados = pendientes.filter(({ r }) => yaPagado.has(normalizar(r.nombre)));
  const proximos = pendientes
    .filter(({ r }) => !yaPagado.has(normalizar(r.nombre)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 2);
  // Solo lo que se pagó o se dijo: un tercer cobro queda para el siguiente dictado.
  const marcar = () => {
    for (const { r, fecha } of [...recienPagados, ...proximos]) {
      ctx.db.update(recurrentes).set({ avisadoPara: fecha }).where(eq(recurrentes.id, r.id)).run();
      // El aviso del revisor sobre ese mismo cobro ya no hace falta mandarlo por push.
      ctx.db
        .update(avisos)
        .set({ dichoEn: new Date().toISOString() })
        .where(and(eq(avisos.usuarioId, ctx.usuarioId), eq(avisos.clave, `cobro:${r.id}:${fecha}`), isNull(avisos.dichoEn)))
        .run();
    }
  };
  if (proximos.length === 0) return { marcar };
  const cuando = (fecha: string) =>
    fecha === ctx.hoy ? "hoy" : fecha === sumarDias(ctx.hoy, 1) ? "mañana" : `el ${NOMBRES_DIA[diaSemana(fecha)]}`;
  const cobro = ({ r }: (typeof proximos)[number]) => `${r.nombre} de ${formatearMonto(r.montoCentavos, r.moneda)}`;
  const [a, b] = proximos as [(typeof proximos)[number], (typeof proximos)[number] | undefined];
  const aviso = !b
    ? `Ojo: ${cuando(a.fecha)} se cobra ${cobro(a)}.`
    : a.fecha === b.fecha
      ? `Ojo: ${cuando(a.fecha)} se cobran ${cobro(a)} y ${cobro(b)}.`
      : `Ojo: ${cuando(a.fecha)} se cobra ${cobro(a)} y ${cuando(b.fecha)}, ${cobro(b)}.`;
  return { aviso, marcar };
}
