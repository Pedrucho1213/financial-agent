// Cifras oficiales de México con las que se compara la salud financiera. Son fijas: se actualizan a mano
// cuando sale una nueva (las líneas de pobreza cada pocos meses; la ENIGH cada dos años, la 2026 sale a
// mediados de 2027). Todo en centavos de peso y por mes. De dónde sale cada una: `FUENTES`.

/**
 * Ingreso corriente promedio mensual por hogar de cada decil (I a X), ENIGH 2024, llevado a 2026 con ~7 % de
 * inflación (INPC ago-2024 a jul-2026). INEGI lo publica trimestral; aquí va entre 3.
 */
export const DECILES_HOGAR_CENTAVOS = [
  5_990_00, 10_093_00, 13_141_00, 16_137_00, 19_370_00, 23_041_00, 27_624_00, 33_987_00, 44_124_00, 84_207_00,
] as const;

/** Ingreso corriente promedio mensual por hogar (ENIGH 2024, estimado a 2026). */
export const PROMEDIO_HOGAR_CENTAVOS = 27_771_00;

/** Ingreso monetario promedio de una persona que recibe ingresos (ENIGH 2024, estimado a 2026). */
export const PROMEDIO_PERCEPTOR_CENTAVOS = 10_757_00;

/** Salario mínimo general 2026 (CONASAMI): $315.04 diarios. */
export const SALARIO_MINIMO_CENTAVOS = 9_582_00;

/** Línea de pobreza por ingresos urbana, por persona (INEGI, julio 2026). */
export const LINEA_POBREZA_CENTAVOS = 4_884_00;

/** Línea de pobreza extrema por ingresos urbana (canasta alimentaria), por persona (INEGI, julio 2026). */
export const LINEA_POBREZA_EXTREMA_CENTAVOS = 2_546_00;

/** Lo que una persona gasta al mes en comida fuera de casa: $1,299 por hogar de 3.35 personas (ENIGH 2024, a 2026). */
export const COMER_FUERA_PERSONA_CENTAVOS = 415_00;

/** Comida fuera de casa como parte del gasto corriente monetario de los hogares (ENIGH 2024). */
export const COMER_FUERA_PROPORCION = 0.082;

/** Población en pobreza y en pobreza extrema (medición multidimensional 2024, INEGI). */
export const POBREZA_PROPORCION = 0.296;
export const POBREZA_EXTREMA_PROPORCION = 0.053;

/** ENSAFI 2023: podría pagar con sus ahorros una urgencia del tamaño de un mes de ingreso. */
export const PUEDE_CUBRIR_UN_MES_PROPORCION = 0.359;

/** ENSAFI 2023: casi nunca o nunca le sobra dinero al final del mes. */
export const NO_LE_SOBRA_PROPORCION = 0.459;

/** Gasto corriente monetario de los hogares por rubro (ENIGH 2024): en qué se va el dinero en México. */
export const RUBROS_ENIGH = [
  { clave: "alimentos", nombre: "Comida", proporcion: 0.377 },
  { clave: "transporte", nombre: "Transporte y teléfono", proporcion: 0.195 },
  { clave: "esparcimiento", nombre: "Educación y diversión", proporcion: 0.096 },
  { clave: "vivienda", nombre: "Vivienda y servicios", proporcion: 0.091 },
  { clave: "cuidado", nombre: "Cuidado personal", proporcion: 0.078 },
  { clave: "hogar", nombre: "Cosas para la casa", proporcion: 0.063 },
  { clave: "ropa", nombre: "Ropa y calzado", proporcion: 0.038 },
  { clave: "salud", nombre: "Salud", proporcion: 0.034 },
  { clave: "otros", nombre: "Otros", proporcion: 0.027 },
] as const;

export type ClaveRubro = (typeof RUBROS_ENIGH)[number]["clave"];

export const FUENTES = [
  { nombre: "INEGI, ENIGH 2024", fecha: "2025-07", url: "https://www.inegi.org.mx/programas/enigh/nc/2024/" },
  { nombre: "INEGI, líneas de pobreza por ingresos", fecha: "2026-07", url: "https://www.inegi.org.mx/temas/lineaspobreza/" },
  { nombre: "INEGI, medición de pobreza 2024", fecha: "2025-08", url: "https://www.inegi.org.mx/temas/pobreza/" },
  { nombre: "INEGI, ENSAFI 2023", fecha: "2024-06", url: "https://www.inegi.org.mx/programas/ensafi/2023/" },
  { nombre: "CONASAMI, salario mínimo 2026", fecha: "2025-12", url: "https://www.gob.mx/conasami" },
] as const;

const ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

/**
 * El decil (1 a 10) de un ingreso mensual de hogar. Solo se conocen los promedios de cada decil, así que el
 * corte entre dos deciles se toma a la mitad de sus promedios.
 */
export function decilDeIngreso(centavos: number): { decil: number; romano: string } {
  let decil = 1;
  for (let i = 1; i < DECILES_HOGAR_CENTAVOS.length; i++) {
    const corte = (DECILES_HOGAR_CENTAVOS[i - 1]! + DECILES_HOGAR_CENTAVOS[i]!) / 2;
    if (centavos >= corte) decil = i + 1;
  }
  return { decil, romano: ROMANOS[decil - 1]! };
}
