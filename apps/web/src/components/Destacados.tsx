import {
  CalendarDays,
  Droplet,
  Gauge,
  type LucideIcon,
  PieChart,
  PiggyBank,
  Repeat,
} from "lucide-react";
import type { ReactNode } from "react";
import { dineroCorto, diasHasta, nombreMes, pct, sumarMeses } from "../lib/formato";
import { hashDe } from "../lib/ruta";
import type { Tablero } from "../lib/tipos";

export type Destacado = {
  id: string;
  Icono: LucideIcon;
  /** Color del tema (variable CSS). */
  color: string;
  etiqueta: string;
  titulo: ReactNode;
  detalle?: ReactNode;
  accion: { texto: string; pregunta?: string; ir?: string };
};

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];

/** Redondea a cientos de pesos: "unos $27,100" se lee mejor que $27,085.40. */
function aproximado(centavos: number, moneda: string) {
  return dineroCorto(Math.round(centavos / 10_000) * 10_000, moneda);
}

/** Para "En los próximos 30 días": cuántas veces se cobra cada pago fijo (los semanales, varias). */
function vecesEn30Dias(frecuencia: string, diasFaltan: number) {
  const cada = frecuencia === "semanal" ? 7 : frecuencia === "quincenal" ? 15 : 0;
  if (!cada) return 1;
  return Math.max(1, Math.floor((30 - Math.max(0, diasFaltan)) / cada) + 1);
}

/**
 * Consejos que salen de los números del mes, sin llamar a la IA: ritmo, gasto hormiga,
 * ahorro, pagos fijos, la categoría que más pesa y el día de la semana que más gastas.
 * Cada uno lleva a Movimientos filtrado o le pregunta al chat.
 */
export function construirDestacados(
  t: Tablero,
  { esMesActual, acumuladoAnterior }: { esMesActual: boolean; acumuladoAnterior?: number[] },
): Destacado[] {
  const lista: Destacado[] = [];
  const { totales, moneda } = t;
  const fmt = (n: number) => dineroCorto(n, moneda);
  const mesNombre = nombreMes(t.mes, false).toLowerCase();
  const anteriorNombre = nombreMes(sumarMeses(t.mes, -1), false).toLowerCase();
  const [a, m] = t.mes.split("-").map(Number);
  const diasMes = new Date(a ?? 1970, m ?? 1, 0).getDate();
  const diaHoy = esMesActual ? Number(t.hoy.slice(8, 10)) : diasMes;

  // Ritmo: lo que va del mes + lo que se gastó el mes anterior en los días que faltan.
  const totalAnterior = acumuladoAnterior?.at(-1) ?? 0;
  if (esMesActual && acumuladoAnterior && totalAnterior > 0 && diaHoy < diasMes && totales.gastadoCentavos > 0) {
    const hastaHoyAnterior = acumuladoAnterior[Math.min(diaHoy, acumuladoAnterior.length) - 1] ?? 0;
    const proyeccion = totales.gastadoCentavos + Math.max(0, totalAnterior - hastaHoyAnterior);
    const diferencia = proyeccion - totalAnterior;
    lista.push({
      id: "ritmo",
      Icono: Gauge,
      color: "var(--tint)",
      etiqueta: "Ritmo del mes",
      titulo: `Si sigues como en ${anteriorNombre}, cerrarás ${mesNombre} en unos ${aproximado(proyeccion, moneda)}.`,
      detalle:
        Math.abs(diferencia) < totalAnterior * 0.03
          ? `Casi igual que ${anteriorNombre} (${fmt(totalAnterior)}).`
          : `${aproximado(Math.abs(diferencia), moneda)} ${diferencia > 0 ? "más" : "menos"} que ${anteriorNombre}.`,
      accion: {
        texto: "Cómo gastar menos",
        pregunta: `¿Cómo voy este mes comparado con ${anteriorNombre} y en qué puedo recortar?`,
      },
    });
  }

  // Gasto hormiga: compras chicas que se repiten. Se proyecta al año con el ritmo de días que van.
  const hormiga = t.frecuentes
    .filter((f) => f.cantidad >= 3 && f.centavos / f.cantidad <= 30_000)
    .sort((x, y) => y.centavos - x.centavos)[0];
  if (hormiga) {
    const alAnio = (hormiga.centavos / Math.max(1, diaHoy)) * 365;
    lista.push({
      id: "hormiga",
      Icono: Droplet,
      color: "var(--orange)",
      etiqueta: "Gasto hormiga",
      titulo: `${hormiga.cantidad} compras en ${hormiga.nombre} ${esMesActual ? "este mes" : `en ${mesNombre}`}: ${fmt(hormiga.centavos)}.`,
      detalle: `A ese paso son unos ${aproximado(alAnio, moneda)} al año.`,
      accion: { texto: "Ver compras", ir: hashDe("movimientos", { mes: t.mes, q: hormiga.nombre }) },
    });
  }

  // Ahorro: cuánto de lo que entró sigue ahí.
  if (totales.ingresadoCentavos > 0) {
    const tasa = totales.balanceCentavos / totales.ingresadoCentavos;
    const negativo = tasa < 0;
    lista.push({
      id: "ahorro",
      Icono: PiggyBank,
      color: negativo ? "var(--negative)" : "var(--positive)",
      etiqueta: "Ahorro",
      titulo: negativo
        ? `Llevas ${fmt(-totales.balanceCentavos)} más gastado de lo que te entró.`
        : `Te queda el ${pct(tasa)} de lo que te entró en ${mesNombre}.`,
      detalle: negativo
        ? "Revisa qué puedes posponer hasta la siguiente quincena."
        : tasa >= 0.2
          ? "Vas arriba del 20% que se recomienda guardar."
          : "Lo recomendable es guardar al menos el 20%.",
      accion: {
        texto: "Pedir un plan",
        pregunta: "Dame un plan sencillo para ahorrar lo que queda del mes con lo que llevo gastado.",
      },
    });
  }

  // Pagos fijos de los próximos 30 días.
  const fijos = t.recurrentesProximos.filter((r) => r.moneda === moneda && r.tipo !== "ingreso");
  if (fijos.length) {
    const total = fijos.reduce((s, r) => s + r.montoCentavos * vecesEn30Dias(r.frecuencia, diasHasta(r.proximoCobro, t.hoy)), 0);
    const mayor = [...fijos].sort((x, y) => y.montoCentavos - x.montoCentavos)[0];
    lista.push({
      id: "fijos",
      Icono: Repeat,
      color: "var(--serie-4)",
      etiqueta: "Pagos fijos",
      titulo: `${fmt(total)} en pagos fijos los próximos 30 días.`,
      detalle:
        fijos.length === 1
          ? "Un solo cargo."
          : `${fijos.length} cargos; el mayor es ${mayor?.nombre ?? ""} (${fmt(mayor?.montoCentavos ?? 0)}).`,
      accion: { texto: "Qué puedo recortar", pregunta: "¿Qué suscripciones y pagos fijos tengo, y cuáles podría recortar?" },
    });
  }

  // La categoría que más pesa, si se lleva buena parte.
  const totalCat = t.porCategoria.reduce((s, c) => s + c.centavos, 0);
  const top = [...t.porCategoria].sort((x, y) => y.centavos - x.centavos)[0];
  if (top?.categoriaId && totalCat > 0 && top.centavos / totalCat >= 0.35) {
    lista.push({
      id: "categoria",
      Icono: PieChart,
      color: "var(--serie-6)",
      etiqueta: "Dónde se va",
      titulo: `${top.nombre} se lleva el ${pct(top.centavos / totalCat)} de tus gastos.`,
      detalle: `${fmt(top.centavos)} de ${fmt(totalCat)} en ${mesNombre}.`,
      accion: { texto: "Ver movimientos", ir: hashDe("movimientos", { mes: t.mes, tipo: "gasto", categoria: top.categoriaId }) },
    });
  }

  // Día de la semana con más gasto.
  const conGasto = t.porDiaSemana.filter((d) => d.centavos > 0);
  const pico = [...conGasto].sort((x, y) => y.centavos - x.centavos)[0];
  if (pico && conGasto.length >= 3) {
    const dia = DIAS[pico.dia - 1] ?? "";
    lista.push({
      id: "dia",
      Icono: CalendarDays,
      color: "var(--serie-3)",
      etiqueta: "Tu día caro",
      titulo: `Los ${dia} es cuando más gastas.`,
      detalle: `${fmt(pico.centavos)} en ${dia} ${esMesActual ? "este mes" : `de ${mesNombre}`}.`,
      accion: { texto: "Preguntar por qué", pregunta: `¿En qué gasto más los ${dia}?` },
    });
  }

  return lista;
}
