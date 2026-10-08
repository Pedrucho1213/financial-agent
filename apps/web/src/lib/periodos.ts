import { aFecha, hoyIso, mesCorto, nombreMes, rangoDelMes, sumarMeses } from "./formato";

// Periodos de Análisis (como Salud: S, M, 6M, A) y sus cubetas para las gráficas.

export const PERIODOS = ["semana", "mes", "6m", "anio"] as const;
export type Periodo = (typeof PERIODOS)[number];

export type Rango = { desde: string; hasta: string };

export type Cubeta = {
  desde: string;
  hasta: string;
  /** Lo que dice el eje: "5", "L", "may". */
  corta: string;
  /** Lo que dice el número grande al elegirla: "Lunes 5 oct", "5–11 oct", "Octubre 2026". */
  larga: string;
};

const DIAS_LETRA = ["L", "M", "M", "J", "V", "S", "D"];
const fDiaSemanaCorto = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short" });

export function esPeriodo(v: string | null): v is Periodo {
  return !!v && (PERIODOS as readonly string[]).includes(v);
}

export function sumarDias(iso: string, n: number) {
  const f = aFecha(iso);
  f.setDate(f.getDate() + n);
  return hoyIso(f);
}

/** Días de `desde` a `hasta`, contando los dos. */
export function diasEntre(desde: string, hasta: string) {
  return Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86_400_000) + 1;
}

/** 1 = lunes … 7 = domingo. */
export function diaSemana(iso: string) {
  const d = aFecha(iso).getDay();
  return d === 0 ? 7 : d;
}

export function lunesDe(iso: string) {
  return sumarDias(iso, 1 - diaSemana(iso));
}

const finDeMes = (mes: string) => rangoDelMes(mes).hasta;

export function rangoDe(periodo: Periodo, ref: string): Rango {
  const mes = ref.slice(0, 7);
  switch (periodo) {
    case "semana": {
      const desde = lunesDe(ref);
      return { desde, hasta: sumarDias(desde, 6) };
    }
    case "mes":
      return rangoDelMes(mes);
    case "6m":
      return { desde: `${sumarMeses(mes, -5)}-01`, hasta: finDeMes(mes) };
    case "anio":
      return { desde: `${sumarMeses(mes, -11)}-01`, hasta: finDeMes(mes) };
  }
}

/** El periodo igual de largo justo antes. */
export function rangoAnterior(periodo: Periodo, ref: string): Rango {
  return rangoDe(periodo, moverRef(periodo, ref, -1));
}

/** La fecha de referencia `n` periodos antes o después. */
export function moverRef(periodo: Periodo, ref: string, n: number) {
  const mes = ref.slice(0, 7);
  switch (periodo) {
    case "semana":
      return sumarDias(lunesDe(ref), 7 * n);
    case "mes":
      return `${sumarMeses(mes, n)}-01`;
    case "6m":
      return `${sumarMeses(mes, 6 * n)}-01`;
    case "anio":
      return `${sumarMeses(mes, 12 * n)}-01`;
  }
}

export function cubetas(periodo: Periodo, r: Rango): Cubeta[] {
  const lista: Cubeta[] = [];
  if (periodo === "semana" || periodo === "mes") {
    for (let d = r.desde; d <= r.hasta; d = sumarDias(d, 1)) {
      lista.push({
        desde: d,
        hasta: d,
        corta: periodo === "semana" ? (DIAS_LETRA[diaSemana(d) - 1] ?? "") : String(Number(d.slice(8, 10))),
        larga: capital(fDiaSemanaCorto.format(aFecha(d)).replace(",", "").replace(" de ", " ").replace(".", "")),
      });
    }
    return lista;
  }
  if (periodo === "6m") {
    // Semanas de lunes a domingo; la primera y la última se cortan en las orillas del periodo.
    for (let d = r.desde; d <= r.hasta; ) {
      const fin = minimo(sumarDias(lunesDe(d), 6), r.hasta);
      // El eje nombra el mes en la semana donde empieza.
      const empieza = d.endsWith("-01") ? d : fin.slice(0, 7) !== d.slice(0, 7) ? fin : null;
      lista.push({ desde: d, hasta: fin, corta: empieza ? mesCorto(empieza.slice(0, 7)) : "", larga: rangoCorto(d, fin) });
      d = sumarDias(fin, 1);
    }
    return lista;
  }
  for (let mes = r.desde.slice(0, 7); mes <= r.hasta.slice(0, 7); mes = sumarMeses(mes, 1)) {
    lista.push({ ...rangoDelMes(mes), corta: mesCorto(mes).charAt(0).toUpperCase(), larga: nombreMes(mes) });
  }
  return lista;
}

/** Título del periodo: "5 – 11 oct 2026", "Octubre 2026", "may – oct 2026". */
export function tituloRango(periodo: Periodo, r: Rango) {
  if (periodo === "mes") return nombreMes(r.desde.slice(0, 7));
  if (periodo === "semana") return `${rangoCorto(r.desde, r.hasta)} ${r.hasta.slice(0, 4)}`;
  const a = r.desde.slice(0, 4);
  const b = r.hasta.slice(0, 4);
  const inicio = mesCorto(r.desde.slice(0, 7));
  const fin = mesCorto(r.hasta.slice(0, 7));
  return a === b ? `${inicio} – ${fin} ${b}` : `${inicio} ${a} – ${fin} ${b}`;
}

/** Cómo se nombra el periodo anterior en una frase: "la semana pasada", "septiembre", "los 6 meses anteriores". */
export function nombreAnterior(periodo: Periodo, ref: string) {
  if (periodo === "semana") return "la semana anterior";
  if (periodo === "mes") return nombreMes(sumarMeses(ref.slice(0, 7), -1), false).toLowerCase();
  if (periodo === "6m") return "los 6 meses anteriores";
  return "los 12 meses anteriores";
}

/** "este mes", "esta semana", "en estos 6 meses". */
export function nombreActual(periodo: Periodo) {
  return { semana: "esta semana", mes: "este mes", "6m": "en estos 6 meses", anio: "en este año" }[periodo];
}

function rangoCorto(desde: string, hasta: string) {
  const d1 = Number(desde.slice(8, 10));
  const d2 = Number(hasta.slice(8, 10));
  const m1 = mesCorto(desde.slice(0, 7));
  const m2 = mesCorto(hasta.slice(0, 7));
  if (desde === hasta) return `${d1} ${m1}`;
  return m1 === m2 ? `${d1}–${d2} ${m2}` : `${d1} ${m1} – ${d2} ${m2}`;
}

function capital(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const minimo = (a: string, b: string) => (a < b ? a : b);
