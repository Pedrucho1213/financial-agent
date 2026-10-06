import { normalizar } from "./texto";

// Las fechas "de calendario" se manejan como texto YYYY-MM-DD en la zona horaria del usuario.
// La aritmética se hace en UTC sobre esa fecha para no depender de la zona del servidor.

export function fechaLocal(instante: Date, zonaHoraria: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

function aUtc(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = aUtc(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** 1 = lunes ... 7 = domingo. */
export function diaSemana(fecha: string): number {
  const d = aUtc(fecha).getUTCDay();
  return d === 0 ? 7 : d;
}

export function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

export function partes(fecha: string): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  return { anio, mes, dia };
}

export function armarFecha(anio: number, mes: number, dia: number): string {
  const diaValido = Math.min(dia, ultimoDiaDelMes(anio, mes));
  return `${anio}-${String(mes).padStart(2, "0")}-${String(diaValido).padStart(2, "0")}`;
}

export function sumarMeses(fecha: string, meses: number, diaPreferido?: number): string {
  const { anio, mes, dia } = partes(fecha);
  const total = anio * 12 + (mes - 1) + meses;
  return armarFecha(Math.floor(total / 12), (total % 12) + 1, diaPreferido ?? dia);
}

/** Convierte una fecha local a mediodía local en UTC, para movimientos de días pasados. */
export function mediodiaUtc(fecha: string, zonaHoraria: string): string {
  const referencia = new Date(`${fecha}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: zonaHoraria,
    timeZoneName: "longOffset",
  })
    .formatToParts(referencia)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT-06:00" o "GMT"
  const coincide = offset?.match(/GMT([+-])(\d{2}):(\d{2})/);
  const minutos = coincide
    ? (coincide[1] === "-" ? -1 : 1) * (Number(coincide[2]) * 60 + Number(coincide[3]))
    : 0;
  return new Date(referencia.getTime() - minutos * 60_000).toISOString();
}

const DIAS: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

/**
 * Entiende "hoy", "ayer", "antier", un día de la semana ("el viernes" = el más reciente,
 * hoy incluido) o una fecha YYYY-MM-DD. Devuelve null si no la entiende.
 */
export function resolverFecha(expresion: string | undefined, hoy: string): string | null {
  if (!expresion) return hoy;
  const limpio = expresion.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return limpio;
  const t = normalizar(limpio).replace(/^(el|este|esta) /, "");
  if (t === "hoy") return hoy;
  if (t === "ayer") return sumarDias(hoy, -1);
  if (t === "antier" || t === "anteayer" || t === "antes de ayer") return sumarDias(hoy, -2);
  const dia = DIAS[t.replace(/ pasado$/, "")];
  if (dia) {
    const atras = (diaSemana(hoy) - dia + 7) % 7;
    return sumarDias(hoy, -(atras === 0 && t.endsWith("pasado") ? 7 : atras));
  }
  return null;
}

export type Periodo = { desde: string; hasta: string };

/**
 * Entiende periodos comunes: "hoy", "ayer", "esta_semana", "semana_pasada", "este_mes",
 * "mes_pasado", "este_anio", "ultimos_7_dias", "ultimos_30_dias", un mes "YYYY-MM",
 * una fecha suelta o un rango "YYYY-MM-DD..YYYY-MM-DD".
 */
export function resolverPeriodo(expresion: string | undefined, hoy: string): Periodo | null {
  const valor = (expresion ?? "este_mes").trim();
  const rango = valor.match(/^(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})$/);
  if (rango) return { desde: rango[1]!, hasta: rango[2]! };
  if (/^\d{4}-\d{2}$/.test(valor)) {
    const [anio, mes] = valor.split("-").map(Number) as [number, number];
    return { desde: armarFecha(anio, mes, 1), hasta: armarFecha(anio, mes, 31) };
  }
  const t = normalizar(valor.replace(/_/g, " ")).replace(/ano/g, "anio");
  const { anio, mes } = partes(hoy);
  const ultimos = t.match(/^ultimos (\d+) dias$/);
  if (ultimos) return { desde: sumarDias(hoy, -(Number(ultimos[1]) - 1)), hasta: hoy };
  switch (t) {
    case "esta semana": {
      const lunes = sumarDias(hoy, -(diaSemana(hoy) - 1));
      return { desde: lunes, hasta: hoy };
    }
    case "semana pasada": {
      const lunes = sumarDias(hoy, -(diaSemana(hoy) - 1) - 7);
      return { desde: lunes, hasta: sumarDias(lunes, 6) };
    }
    case "este mes":
      return { desde: armarFecha(anio, mes, 1), hasta: hoy };
    case "mes pasado": {
      const inicio = sumarMeses(armarFecha(anio, mes, 1), -1, 1);
      const { anio: a, mes: m } = partes(inicio);
      return { desde: inicio, hasta: armarFecha(a, m, 31) };
    }
    case "este anio":
      return { desde: `${anio}-01-01`, hasta: hoy };
    case "todo":
      return { desde: "1970-01-01", hasta: hoy };
  }
  const fecha = resolverFecha(valor, hoy);
  return fecha ? { desde: fecha, hasta: fecha } : null;
}
