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

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const POCOS: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };

/**
 * Entiende "hoy", "ayer", "antier", un día de la semana ("el viernes" = el más reciente,
 * hoy incluido), "hace 3 días", "el 1 de este mes", "el 15 de septiembre" o una fecha
 * YYYY-MM-DD. Devuelve null si no la entiende.
 */
export function resolverFecha(expresion: string | undefined, hoy: string): string | null {
  if (!expresion) return hoy;
  const limpio = expresion.trim();
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(limpio)) return limpio.slice(0, 10);
  // 05/10/2026 o 5/10: día, mes y año opcional, como se escribe en México.
  const conDiagonal = limpio.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (conDiagonal) {
    const [, d, m, a] = conDiagonal.map(Number) as [number, number, number, number | undefined];
    const anio = a === undefined || Number.isNaN(a) ? partes(hoy).anio : a < 100 ? 2000 + a : a;
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? armarFecha(anio, m, d) : null;
  }
  const t = normalizar(limpio).replace(/^(el|este|esta) /, "");
  if (t === "hoy") return hoy;
  if (t === "ayer") return sumarDias(hoy, -1);
  if (t === "antier" || t === "anteayer" || t === "antes de ayer") return sumarDias(hoy, -2);
  const hace = t.match(/^hace (\d+|un|una|dos|tres|cuatro|cinco|seis) (dia|dias|semana|semanas)$/);
  if (hace) {
    const n = POCOS[hace[1]!] ?? Number(hace[1]);
    return sumarDias(hoy, -n * (hace[2]!.startsWith("semana") ? 7 : 1));
  }
  // "el 1 de este mes", "el primero", "15 de septiembre" (si aún no llega, es del año pasado).
  const delMes = t.match(/^(primero|\d{1,2})(?: de (este mes|\w+))?$/);
  if (delMes && (delMes[2] === undefined ? delMes[1] === "primero" : true)) {
    const dia = delMes[1] === "primero" ? 1 : Number(delMes[1]);
    const { anio, mes } = partes(hoy);
    const mesDicho = !delMes[2] || delMes[2] === "este mes" ? mes : MESES.indexOf(delMes[2]) + 1;
    if (mesDicho > 0 && dia >= 1 && dia <= 31) {
      const fecha = armarFecha(anio, mesDicho, dia);
      return fecha > hoy && delMes[2] && delMes[2] !== "este mes" ? armarFecha(anio - 1, mesDicho, dia) : fecha;
    }
  }
  // "lunes 5 de octubre", "el lunes pasado (5 de octubre)": si adentro hay una sola fecha, esa.
  if (!t.match(/^(lunes|martes|miercoles|jueves|viernes|sabado|domingo)( pasado)?$/)) {
    const dentro = fechaDelTexto(t, hoy);
    if (dentro) return dentro;
  }
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

const EXPRESION_FECHA = new RegExp(
  "\\b(hoy|ayer|antier|anteayer|antes de ayer|(?:el |este )?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?: pasado)?" +
    "|hace (?:\\d+|un|una|dos|tres|cuatro|cinco|seis) (?:dia|dias|semana|semanas)" +
    `|el primero(?: de (?:este mes|${MESES.join("|")}))?|(?:el )?\\d{1,2} de (?:este mes|${MESES.join("|")}))\\b`,
  "g",
);

// Palabras que indican que la frase habla de una fecha, aunque no se pueda resolver.
const PISTA_FECHA = new RegExp(
  `\\b(hoy|ayer|antier|anteayer|hace|pasad[oa]|lunes|martes|miercoles|jueves|viernes|sabado|domingo|primero|semana|quincena|mes|${MESES.join("|")})\\b`,
);

/** Si la frase menciona algún momento ("ayer", "la semana pasada", "en septiembre"). */
export function mencionaFecha(texto: string | undefined): boolean {
  return !!texto && PISTA_FECHA.test(normalizar(texto));
}

/**
 * La fecha que el usuario dijo en su frase ("ayer", "el viernes"), resuelta con resolverFecha.
 * Solo responde si la frase menciona una sola fecha; con varias o ninguna devuelve null.
 */
export function fechaDelTexto(texto: string | undefined, hoy: string): string | null {
  const fechas = new Set(fechasDelTexto(texto, hoy));
  return fechas.size === 1 ? [...fechas][0]! : null;
}

/** Todas las fechas que dice la frase, en el orden en que las dice ("el lunes ... y el martes ..."). */
export function fechasDelTexto(texto: string | undefined, hoy: string): string[] {
  if (!texto) return [];
  return [...normalizar(texto).matchAll(EXPRESION_FECHA)]
    .map((m) => resolverFecha(m[1], hoy))
    .filter((f): f is string => !!f);
}
