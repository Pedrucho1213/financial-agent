import { useQuery } from "@tanstack/react-query";
import { api, ErrorApi } from "./api";

// GET /v1/salud-financiera: la calificación, sus pilares, la comparación con México y datos curiosos. La calcula
// el servidor sin modelo y solo leyendo. Si el servidor la apaga (o es uno viejo sin ella) contesta 404 y la app
// no la muestra (ni la tarjeta de Inicio ni la página).

export type NivelSalud = "sobregirado" | "en_riesgo" | "vamos_bien" | "excelente" | "optimizando";

export type PilarSalud = {
  clave: "margen" | "colchon" | "deuda" | "gustos" | "compromisos";
  nombre: string;
  peso: number;
  puntos: number | null;
  valor: string | null;
  frase: string;
  consejo: string;
};

export type ComparacionSalud = {
  clave: "ingreso" | "perceptor" | "pobreza" | "sin_ingreso" | "comer_fuera" | "colchon";
  titulo: string;
  tu: string;
  mexico: string;
  frase: string;
  decil?: number;
};

export type CuriosidadSalud = {
  clave: "favorito" | "comer_fuera_dias" | "dia_fuerte" | "salario_minimo" | "mas_grande" | "fijos_al_anio" | "hormiga" | "racha";
  dato: string;
  texto: string;
};

export type SaludFinanciera = {
  nivel: NivelSalud | null;
  nivelSinAlertas: NivelSalud | null;
  puntaje: number | null;
  titulo: string;
  resumen: string;
  alertas: string[];
  pilares: PilarSalud[];
  ingresos: { esteMesCentavos: number; mensualCentavos: number | null; enOtraMoneda: boolean };
  base: { desde: string | null; hasta: string; dias: number; gastoMensualCentavos: number | null; pocosDatos: boolean };
  mexico: ComparacionSalud[];
  rubros: { clave: string; nombre: string; tuProporcion: number; mexicoProporcion: number }[];
  consejos: { texto: string; ahorroMensualCentavos?: number }[];
  /** Puede faltar si el servidor es anterior a los datos curiosos. */
  curiosidades?: CuriosidadSalud[];
  faltan: string[];
  fuentes: readonly { nombre: string; fecha: string; url: string }[];
};

/** Los cinco niveles en orden, con dónde empieza cada uno (de 0 a 100) y su color. */
export const NIVELES: { clave: NivelSalud; titulo: string; desde: number; hasta: number; color: string }[] = [
  { clave: "sobregirado", titulo: "Sobregirado", desde: 0, hasta: 25, color: "var(--salud-1)" },
  { clave: "en_riesgo", titulo: "En riesgo", desde: 25, hasta: 45, color: "var(--salud-2)" },
  { clave: "vamos_bien", titulo: "Vamos bien", desde: 45, hasta: 65, color: "var(--salud-3)" },
  { clave: "excelente", titulo: "Excelente", desde: 65, hasta: 85, color: "var(--salud-4)" },
  { clave: "optimizando", titulo: "Optimizando", desde: 85, hasta: 100, color: "var(--salud-5)" },
];

export const colorDeNivel = (nivel: NivelSalud | null) => NIVELES.find((n) => n.clave === nivel)?.color ?? "var(--gray-icon)";

/** El nivel al que corresponden unos puntos (para colorear la barra de cada pilar). */
export function nivelDePuntos(puntos: number): NivelSalud {
  return [...NIVELES].reverse().find((n) => puntos >= n.desde)!.clave;
}

/** Punto sobre el semicírculo del medidor para un valor de 0 a 100 (0 a la izquierda, 100 a la derecha). */
export function puntoDelArco(valor: number, cx: number, cy: number, r: number) {
  const angulo = Math.PI * (1 - Math.min(100, Math.max(0, valor)) / 100);
  return { x: cx + r * Math.cos(angulo), y: cy - r * Math.sin(angulo) };
}

/** El trazo SVG de un tramo del semicírculo entre dos valores. */
export function tramoDelArco(desde: number, hasta: number, cx: number, cy: number, r: number) {
  const a = puntoDelArco(desde, cx, cy, r);
  const b = puntoDelArco(hasta, cx, cy, r);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** La línea de Inicio: el nivel y lo más importante (la alerta, o qué falta). */
export function detalleCorto(s: SaludFinanciera): string {
  if (s.alertas.length) return `${s.titulo} · ${s.alertas[0]!.replace(/\.$/, "").replace(" va al ", " al ").replace(/ de su límite$/, "")}`;
  if (s.puntaje !== null) return `${s.titulo} · ${s.puntaje} de 100`;
  return s.ingresos.mensualCentavos === null ? "Dime tu ingreso para calificarte" : "Me faltan datos para calificarte";
}

/**
 * La clave empieza con "movimientos": un gasto nuevo, borrado o corregido la refresca (refrescarDatos). Un minuto
 * fresca, como Análisis. Un 404 (módulo apagado o servidor viejo) no se reintenta: simplemente no sale.
 */
export function useSalud(activo = true) {
  return useQuery({
    queryKey: ["movimientos", "salud"] as const,
    enabled: activo,
    staleTime: 60_000,
    queryFn: ({ signal }) => api<SaludFinanciera>("/v1/salud-financiera", { signal }),
  });
}

/**
 * Los datos para mostrar, o undefined si el servidor ya dijo que no (404): así, si el módulo se apaga o se
 * revierte, la tarjeta y la página desaparecen aunque haya una copia guardada para usar sin conexión.
 */
export function saludParaMostrar(q: { data?: SaludFinanciera; error: unknown }): SaludFinanciera | undefined {
  if (q.error instanceof ErrorApi && q.error.estado === 404) return undefined;
  return q.data;
}
