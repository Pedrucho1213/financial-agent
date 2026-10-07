// Lo que ve la app: movimientos con sus montos en centavos y el tablero del mes.
// Todas las cuentas las hace el código; la app solo las muestra.
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { comercios, cuentas, movimientos, recurrentes, TIPOS_MOVIMIENTO } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { armarFecha, diaSemana, partes, resolverPeriodo, sumarDias, ultimoDiaDelMes } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import { idsConHijas, listarCategorias, nombreCompleto, type Categoria } from "./catalogos";
import type { Contexto } from "./contexto";
import { ErrorFinanzas, type Movimiento, type TipoMovimiento } from "./movimientos";
import { proximoCobro } from "./recurrentes";

type Nombres = { comercios: Map<string, string>; cuentas: Map<string, string> };

function nombres(ctx: Contexto, filas: Movimiento[]): Nombres {
  const ids = (campo: "comercioId" | "cuentaId") => [...new Set(filas.map((m) => m[campo]).filter((x): x is string => !!x))];
  const idsComercio = ids("comercioId");
  const idsCuenta = ids("cuentaId");
  return {
    comercios: new Map(
      idsComercio.length
        ? ctx.db.select().from(comercios).where(inArray(comercios.id, idsComercio)).all().map((c) => [c.id, c.nombre])
        : [],
    ),
    cuentas: new Map(
      idsCuenta.length
        ? ctx.db.select().from(cuentas).where(inArray(cuentas.id, idsCuenta)).all().map((c) => [c.id, c.nombre])
        : [],
    ),
  };
}

export function aMovimientoApp(m: Movimiento, cats: Categoria[], n: Nombres) {
  return {
    id: m.id,
    fecha: m.fecha,
    ocurridoEn: m.ocurridoEn,
    tipo: m.tipo,
    montoCentavos: m.montoCentavos,
    monto: formatearMonto(m.montoCentavos, m.moneda),
    moneda: m.moneda,
    categoriaId: m.categoriaId,
    categoria: nombreCompleto(cats, m.categoriaId),
    comercio: (m.comercioId && n.comercios.get(m.comercioId)) || null,
    descripcion: m.descripcion,
    cuenta: (m.cuentaId && n.cuentas.get(m.cuentaId)) || null,
    lugar: m.lugar,
    lat: m.lat,
    lon: m.lon,
    origen: m.origen,
    textoOriginal: m.textoOriginal,
    revisar: m.revisar,
  };
}

export type MovimientoApp = ReturnType<typeof aMovimientoApp>;

/** Un movimiento recién leído de la base, en el formato de la app. */
export function movimientoApp(ctx: Contexto, m: Movimiento): MovimientoApp {
  return aMovimientoApp(m, listarCategorias(ctx.db, ctx.usuarioId), nombres(ctx, [m]));
}

export type FiltroApp = {
  desde?: string;
  hasta?: string;
  periodo?: string;
  tipo?: TipoMovimiento;
  categoriaId?: string;
  texto?: string;
  revisar?: boolean;
  limite?: number;
  offset?: number;
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function filasDelPeriodo(ctx: Contexto, desde: string | undefined, hasta: string | undefined, tipo?: TipoMovimiento) {
  const condiciones = [eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn)];
  if (desde) condiciones.push(gte(movimientos.fecha, desde));
  if (hasta) condiciones.push(lte(movimientos.fecha, hasta));
  if (tipo) condiciones.push(eq(movimientos.tipo, tipo));
  return ctx.db
    .select()
    .from(movimientos)
    .where(and(...condiciones))
    .orderBy(desc(movimientos.fecha), desc(movimientos.ocurridoEn), desc(movimientos.creadoEn))
    .all();
}

export function listarMovimientosApp(ctx: Contexto, filtro: FiltroApp) {
  let { desde, hasta } = filtro;
  if (filtro.periodo && !desde && !hasta) {
    const periodo = resolverPeriodo(filtro.periodo, ctx.hoy);
    if (!periodo) throw new ErrorFinanzas(`No entendí el periodo "${filtro.periodo}".`);
    ({ desde, hasta } = periodo);
  }
  for (const f of [desde, hasta]) if (f && !FECHA.test(f)) throw new ErrorFinanzas(`Fecha inválida: ${f}.`);
  if (filtro.tipo && !TIPOS_MOVIMIENTO.includes(filtro.tipo)) throw new ErrorFinanzas(`Tipo inválido: ${filtro.tipo}.`);

  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  let filas = filasDelPeriodo(ctx, desde, hasta, filtro.tipo);
  if (filtro.categoriaId) {
    const ids = new Set(idsConHijas(cats, filtro.categoriaId));
    filas = filas.filter((m) => m.categoriaId && ids.has(m.categoriaId));
  }
  if (filtro.revisar) filas = filas.filter((m) => m.revisar);
  const palabras = normalizar(filtro.texto ?? "").split(" ").filter(Boolean);
  if (palabras.length) {
    const n = nombres(ctx, filas);
    filas = filas.filter((m) => {
      const plano = normalizar(
        [
          m.comercioId && n.comercios.get(m.comercioId),
          m.cuentaId && n.cuentas.get(m.cuentaId),
          m.descripcion,
          m.textoOriginal,
          m.lugar,
          nombreCompleto(cats, m.categoriaId),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return palabras.every((p) => plano.includes(p));
    });
  }
  // "?limite=abc" llega como NaN: se usa el valor por omisión en vez de devolver una página vacía.
  const numero = (n: number | undefined, porOmision: number) => (n !== undefined && Number.isFinite(n) ? Math.trunc(n) : porOmision);
  const limite = Math.min(Math.max(numero(filtro.limite, 100), 1), 500);
  const offset = Math.max(numero(filtro.offset, 0), 0);
  const pagina = filas.slice(offset, offset + limite);
  const n = nombres(ctx, pagina);
  return { total: filas.length, movimientos: pagina.map((m) => aMovimientoApp(m, cats, n)) };
}

/** "2026-10" desplazado `meses` hacia atrás o adelante. */
function moverMes(mes: string, meses: number): string {
  const [anio, m] = mes.split("-").map(Number) as [number, number];
  const total = anio * 12 + (m - 1) + meses;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function limitesDelMes(mes: string) {
  const [anio, m] = mes.split("-").map(Number) as [number, number];
  return { desde: armarFecha(anio, m, 1), hasta: armarFecha(anio, m, ultimoDiaDelMes(anio, m)) };
}

const suma = (filas: Movimiento[]) => filas.reduce((s, m) => s + m.montoCentavos, 0);

/** Todo lo que muestra la pantalla de inicio para un mes ("2026-10"). */
export function tablero(ctx: Contexto, mesPedido?: string) {
  const mesActual = ctx.hoy.slice(0, 7);
  const mes = mesPedido ?? mesActual;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErrorFinanzas(`Mes inválido: ${mes}. Usa AAAA-MM.`);
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const enBase = (filas: Movimiento[]) => filas.filter((m) => m.moneda === ctx.monedaBase);

  const { desde, hasta } = limitesDelMes(mes);
  const delMes = enBase(filasDelPeriodo(ctx, desde, hasta));
  const gastos = delMes.filter((m) => m.tipo === "gasto");
  const ingresos = delMes.filter((m) => m.tipo === "ingreso");

  // Comparación justa: del 1 al mismo día del mes anterior (o el mes completo si ya pasó).
  const anterior = limitesDelMes(moverMes(mes, -1));
  const gastosAnterior = enBase(filasDelPeriodo(ctx, anterior.desde, anterior.hasta, "gasto"));
  const diaCorte = mes === mesActual ? partes(ctx.hoy).dia : 31;
  const mismaFecha = gastosAnterior.filter((m) => partes(m.fecha).dia <= diaCorte);

  const porCategoria = new Map<string | null, { centavos: number; cantidad: number }>();
  for (const m of gastos) {
    const c = cats.find((x) => x.id === m.categoriaId);
    const principal = c?.padreId ?? c?.id ?? null;
    const g = porCategoria.get(principal) ?? { centavos: 0, cantidad: 0 };
    g.centavos += m.montoCentavos;
    g.cantidad += 1;
    porCategoria.set(principal, g);
  }

  const porMes = Array.from({ length: 6 }, (_, i) => moverMes(mes, i - 5)).map((m) => {
    const l = limitesDelMes(m);
    const filas = enBase(filasDelPeriodo(ctx, l.desde, l.hasta));
    return {
      mes: m,
      gastadoCentavos: suma(filas.filter((x) => x.tipo === "gasto")),
      ingresadoCentavos: suma(filas.filter((x) => x.tipo === "ingreso")),
    };
  });

  const porDia = new Map<number, number>();
  for (const m of gastos) porDia.set(diaSemana(m.fecha), (porDia.get(diaSemana(m.fecha)) ?? 0) + m.montoCentavos);

  const nombresMes = nombres(ctx, gastos);
  const frecuentes = new Map<string, { cantidad: number; centavos: number }>();
  for (const m of gastos) {
    const nombre = m.comercioId ? nombresMes.comercios.get(m.comercioId) : undefined;
    if (!nombre) continue;
    const f = frecuentes.get(nombre) ?? { cantidad: 0, centavos: 0 };
    f.cantidad += 1;
    f.centavos += m.montoCentavos;
    frecuentes.set(nombre, f);
  }

  const mayores = [...gastos].sort((a, b) => b.montoCentavos - a.montoCentavos).slice(0, 5);
  const en30Dias = sumarDias(ctx.hoy, 30);
  const proximos = ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn)))
    .all()
    .map((r) => ({ ...r, proximo: proximoCobro(r, ctx.hoy) }))
    .filter((r) => r.proximo <= en30Dias)
    .sort((a, b) => a.proximo.localeCompare(b.proximo));

  return {
    mes,
    hoy: ctx.hoy,
    moneda: ctx.monedaBase,
    totales: {
      gastadoCentavos: suma(gastos),
      ingresadoCentavos: suma(ingresos),
      balanceCentavos: suma(ingresos) - suma(gastos),
      gastadoHoyCentavos: suma(gastos.filter((m) => m.fecha === ctx.hoy)),
      cantidadGastos: gastos.length,
      gastadoMesAnteriorCentavos: suma(gastosAnterior),
      gastadoMesAnteriorMismaFechaCentavos: suma(mismaFecha),
    },
    porCategoria: [...porCategoria.entries()]
      .map(([categoriaId, g]) => ({
        categoriaId,
        nombre: (categoriaId && cats.find((c) => c.id === categoriaId)?.nombre) || "Sin categoría",
        ...g,
      }))
      .sort((a, b) => b.centavos - a.centavos),
    porMes,
    porDiaSemana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, centavos: porDia.get(dia) ?? 0 })),
    mayores: mayores.map((m) => aMovimientoApp(m, cats, nombres(ctx, mayores))),
    frecuentes: [...frecuentes.entries()]
      .map(([nombre, f]) => ({ nombre, ...f }))
      .filter((f) => f.cantidad > 1)
      .sort((a, b) => b.cantidad - a.cantidad || b.centavos - a.centavos)
      .slice(0, 5),
    recurrentesProximos: proximos.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      tipo: r.tipo,
      montoCentavos: r.montoCentavos,
      moneda: r.moneda,
      proximoCobro: r.proximo,
      frecuencia: r.frecuencia,
    })),
    porRevisar: filasDelPeriodo(ctx, undefined, undefined).filter((m) => m.revisar).length,
  };
}
