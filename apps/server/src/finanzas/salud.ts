import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { comercios, movimientos, recurrentes, usuarios } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { armarFecha, diaSemana, partes, sumarDias, sumarMeses, ultimoDiaDelMes } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import { analizar, RECORTABLES } from "./analisis";
import { type Categoria, listarCategorias } from "./catalogos";
import type { Contexto } from "./contexto";
import { estadosDeCuentas, totalesDeCuentas } from "./cuentas";
import { listarMetas, listarMsi, listarPrestamos, porPagarEsteMes } from "./planes";
import { montoMensual } from "./recurrentes";
import {
  COMER_FUERA_PERSONA_CENTAVOS,
  COMER_FUERA_PROPORCION,
  type ClaveRubro,
  decilDeIngreso,
  FUENTES,
  LINEA_POBREZA_CENTAVOS,
  PROMEDIO_HOGAR_CENTAVOS,
  PROMEDIO_PERCEPTOR_CENTAVOS,
  PUEDE_CUBRIR_UN_MES_PROPORCION,
  RUBROS_ENIGH,
  SALARIO_MINIMO_CENTAVOS,
} from "./referencias-mx";

// Salud financiera: una calificación de 0 a 100, cinco pilares que la explican y cómo se compara con México.
// Todo es SQL y reglas, como el análisis y el revisor: no llama al modelo y SOLO LEE la base (no escribe nada,
// ni siquiera caché), para que no pueda tocar los datos del usuario.
//
// Sin ingresos registrados no se inventan: los pilares que los necesitan quedan sin calificar y se dice qué
// falta. Lo que sí se sabe (tarjetas al tope, colchón, comer fuera) se dice igual.

type Mov = typeof movimientos.$inferSelect;

export type Nivel = "sobregirado" | "en_riesgo" | "vamos_bien" | "excelente" | "optimizando";
export type ClavePilar = "margen" | "colchon" | "deuda" | "gustos" | "compromisos";

export type Pilar = {
  clave: ClavePilar;
  nombre: string;
  /** Cuánto pesa en la calificación (los pesos suman 100). */
  peso: number;
  /** 0 a 100; null si falta un dato para calcularlo. */
  puntos: number | null;
  /** El número que lo resume, corto: "12 %", "1.4 meses". */
  valor: string | null;
  /** Una frase que lo explica. */
  frase: string;
  /** Cómo subirlo (o qué falta para calcularlo). */
  consejo: string;
};

export type Comparacion = {
  clave: "ingreso" | "perceptor" | "pobreza" | "sin_ingreso" | "comer_fuera" | "colchon";
  titulo: string;
  tu: string;
  mexico: string;
  frase: string;
  /** Solo en "ingreso": el decil (1 a 10) para dibujar la barra. */
  decil?: number;
};

export type Rubro = { clave: ClaveRubro; nombre: string; tuProporcion: number; mexicoProporcion: number };
export type Consejo = { texto: string; ahorroMensualCentavos?: number };
/** Un dato curioso: el número grande y la frase que lo cuenta. */
export type Curiosidad = {
  clave: "favorito" | "comer_fuera_dias" | "dia_fuerte" | "salario_minimo" | "mas_grande" | "fijos_al_anio" | "hormiga" | "racha";
  dato: string;
  texto: string;
};

export type SaludFinanciera = {
  nivel: Nivel | null;
  /** El nivel que daría la calificación sola, sin las alertas (para decir "sin eso estarías en Excelente"). */
  nivelSinAlertas: Nivel | null;
  /** 0 a 100; null si faltan datos para calificar (aun con nivel por una regla roja). */
  puntaje: number | null;
  titulo: string;
  resumen: string;
  /** Lo que manda sobre la calificación (una tarjeta al tope): un promedio lo escondería. */
  alertas: string[];
  pilares: Pilar[];
  ingresos: {
    /** Lo cobrado (registrado como ingreso) este mes. */
    esteMesCentavos: number;
    /** El ingreso de un mes con lo que hay registrado; null si no hay ninguno. */
    mensualCentavos: number | null;
    /** Hay ingresos en otra moneda que no se cuentan (la app no convierte). */
    enOtraMoneda: boolean;
  };
  base: {
    desde: string | null;
    hasta: string;
    dias: number;
    gastoMensualCentavos: number | null;
    /** Con menos de 30 días, lo de un mes es una cuenta: se dice. */
    pocosDatos: boolean;
  };
  mexico: Comparacion[];
  rubros: Rubro[];
  consejos: Consejo[];
  /** Datos curiosos de sus registros y México (hasta 6). */
  curiosidades: Curiosidad[];
  faltan: string[];
  fuentes: typeof FUENTES;
};

export const NIVELES: Record<Nivel, { titulo: string; desde: number }> = {
  sobregirado: { titulo: "Sobregirado", desde: 0 },
  en_riesgo: { titulo: "En riesgo", desde: 25 },
  vamos_bien: { titulo: "Vamos bien", desde: 45 },
  excelente: { titulo: "Excelente", desde: 65 },
  optimizando: { titulo: "Optimizando", desde: 85 },
};

const PESOS: Record<ClavePilar, number> = { margen: 30, colchon: 20, deuda: 25, gustos: 15, compromisos: 10 };
const VENTANA_DIAS = 90;
const MINIMO_DIAS = 7;
const DIAS_MES = 30.4;
// Una tarjeta a este uso de su límite es una regla roja; para salir se le baja a USO_SANO_TOPE.
const USO_ROJO = 0.9;
const USO_SANO_TOPE = 0.7;
// Comer fuera: restaurantes, café, antojos y delivery.
const COMER_FUERA = new Set(["Restaurantes", "Café", "Antojos", "Delivery"].map(normalizar));
// Categorías principales de la app → rubros de gasto de la ENIGH. Las hojas que cambian de rubro van aparte.
const RUBRO_DE_PRINCIPAL: Record<string, ClaveRubro> = {
  comida: "alimentos",
  transporte: "transporte",
  vivienda: "vivienda",
  salud: "salud",
  suscripciones: "esparcimiento",
  entretenimiento: "esparcimiento",
  educacion: "esparcimiento",
  viajes: "esparcimiento",
  "cuidado personal": "cuidado",
};
const RUBRO_DE_HOJA: Record<string, ClaveRubro> = {
  "internet y telefono": "transporte",
  "ropa y calzado": "ropa",
  hogar: "hogar",
  electronica: "hogar",
};

/**
 * Si el módulo está abierto para este usuario. Abierto para todas las cuentas; SALUD_FINANCIERA=0 lo apaga y
 * SALUD_FINANCIERA=dueno lo deja solo a la cuenta dueña (la que se creó primero), por si hay que volver atrás.
 */
export function saludHabilitada(db: Db, usuarioId: string, entorno: string | undefined = process.env.SALUD_FINANCIERA): boolean {
  const modo = (entorno ?? "").trim().toLowerCase();
  if (modo === "0" || modo === "no" || modo === "apagado") return false;
  if (modo !== "dueno" && modo !== "dueño") return true;
  const dueno = db.select({ id: usuarios.id }).from(usuarios).orderBy(usuarios.creadoEn, sql`rowid`).limit(1).get();
  return dueno?.id === usuarioId;
}

/** Lineal entre puntos [x, y] ordenados por x; fuera de los extremos, el extremo. */
export function interpolar(x: number, puntos: [number, number][]): number {
  if (x <= puntos[0]![0]) return puntos[0]![1];
  for (let i = 1; i < puntos.length; i++) {
    const [x1, y1] = puntos[i]!;
    const [x0, y0] = puntos[i - 1]!;
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return puntos[puntos.length - 1]![1];
}

export function nivelDe(puntaje: number): Nivel {
  const orden: Nivel[] = ["optimizando", "excelente", "vamos_bien", "en_riesgo", "sobregirado"];
  return orden.find((n) => puntaje >= NIVELES[n].desde) ?? "sobregirado";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const unDecimal = (x: number) => (Math.round(x * 10) / 10).toLocaleString("es-MX", { maximumFractionDigits: 1 });
const meses = (x: number) => (x >= 0.95 && x < 1.05 ? "1 mes" : `${unDecimal(x)} meses`);
const veces = (x: number) => (x >= 10 ? Math.round(x).toString() : unDecimal(x));
// Como la voz: montos grandes a cientos, chicos a decenas.
const redondear = (centavos: number) => (Math.abs(centavos) >= 1_000_000 ? Math.round(centavos / 10_000) * 10_000 : Math.round(centavos / 1_000) * 1_000);

function movimientosEntre(ctx: Contexto, desde: string, hasta: string): Mov[] {
  return ctx.db
    .select()
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn), gte(movimientos.fecha, desde), lte(movimientos.fecha, hasta)))
    .orderBy(asc(movimientos.fecha))
    .all();
}

function categoriaYPadre(cats: Categoria[], id: string | null) {
  const c = id ? cats.find((x) => x.id === id) : undefined;
  const padre = c?.padreId ? cats.find((x) => x.id === c.padreId) : undefined;
  return { c, padre, principal: padre ?? c };
}

function rubroDe(cats: Categoria[], m: Mov): ClaveRubro {
  const { c, principal } = categoriaYPadre(cats, m.categoriaId);
  const hoja = c ? RUBRO_DE_HOJA[normalizar(c.nombre)] : undefined;
  if (hoja) return hoja;
  return (principal && RUBRO_DE_PRINCIPAL[normalizar(principal.nombre)]) || "otros";
}

const esComerFuera = (cats: Categoria[], m: Mov) => {
  const { c } = categoriaYPadre(cats, m.categoriaId);
  return !!c && COMER_FUERA.has(normalizar(c.nombre));
};

/** Un gusto: su categoría (o la principal) es "gusto", o es de lo recortable (restaurantes, antojos...). */
const esGusto = (cats: Categoria[], m: Mov) => {
  if (m.recurrenteId || m.msiId) return false;
  const { c, principal } = categoriaYPadre(cats, m.categoriaId);
  return !!c && (RECORTABLES.has(normalizar(c.nombre)) || principal?.naturaleza === "gusto");
};

/** El cálculo completo. Solo lee. */
export function saludFinanciera(ctx: Contexto): SaludFinanciera {
  const $ = (c: number) => formatearMonto(c, ctx.monedaBase);
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const desdeVentana = sumarDias(ctx.hoy, -(VENTANA_DIAS - 1));
  const todos = movimientosEntre(ctx, desdeVentana, ctx.hoy);
  const enBase = todos.filter((m) => m.moneda === ctx.monedaBase);
  const gastos = enBase.filter((m) => m.tipo === "gasto");
  const ingresos = enBase.filter((m) => m.tipo === "ingreso");
  const enOtraMoneda = todos.some((m) => m.tipo === "ingreso" && m.moneda !== ctx.monedaBase);
  const suma = (xs: Mov[]) => xs.reduce((s, m) => s + m.montoCentavos, 0);

  // Desde el primer registro de la ventana (gasto o ingreso): con una semana de datos no se divide entre 90 días.
  const desde = enBase[0]?.fecha ?? null;
  const dias = desde ? Math.round((Date.parse(ctx.hoy) - Date.parse(desde)) / 86_400_000) + 1 : 0;
  const mesesDeDatos = dias / DIAS_MES;
  const hayRitmo = dias >= MINIMO_DIAS && gastos.length > 0;
  // El gasto es continuo: se lleva a un mes. El ingreso llega una o dos veces al mes: con menos de un mes de
  // datos, lo cobrado se toma como el ingreso del mes (un sueldo en 8 días no son cuatro sueldos al mes).
  const alMes = (centavos: number) => Math.round(centavos / Math.max(mesesDeDatos, MINIMO_DIAS / DIAS_MES));
  const gastoMensual = hayRitmo ? alMes(suma(gastos)) : null;
  const totalIngresos = suma(ingresos);
  const ingresoMensual = totalIngresos > 0 ? (mesesDeDatos < 1 ? totalIngresos : Math.round(totalIngresos / mesesDeDatos)) : null;
  const inicioMes = armarFecha(partes(ctx.hoy).anio, partes(ctx.hoy).mes, 1);
  const esteMes = suma(ingresos.filter((m) => m.fecha >= inicioMes));

  // Cuentas y deudas.
  const estados = estadosDeCuentas(ctx);
  const totales = totalesDeCuentas(estados);
  const tarjetas = estados.filter((e) => e.esCredito && e.limiteCentavos && e.limiteCentavos > 0 && e.deudaCentavos !== null);
  const usoDe = (e: (typeof tarjetas)[number]) => Math.max(0, e.deudaCentavos!) / e.limiteCentavos!;
  const deudaTarjetasConLimite = tarjetas.reduce((s, e) => s + Math.max(0, e.deudaCentavos!), 0);
  const limiteTotal = tarjetas.reduce((s, e) => s + e.limiteCentavos!, 0);
  const usoTotal = limiteTotal > 0 ? deudaTarjetasConLimite / limiteTotal : null;
  const debePersonas = listarPrestamos(ctx).deboCentavos;
  // Las compras a meses ya están en la deuda de la tarjeta (la tarjeta aparta la compra completa): no se suman.
  const deudaTotal = totales.deudaCentavos + debePersonas;
  const dinero = totales.cuentasConSaldo > 0 ? totales.dineroCentavos : null;
  const fijosMensuales =
    ctx.db
      .select()
      .from(recurrentes)
      .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn), eq(recurrentes.moneda, ctx.monedaBase)))
      .all()
      .filter((r) => r.tipo !== "ingreso")
      .reduce((s, r) => s + montoMensual(r), 0) + listarMsi(ctx).mensualCentavos;
  const gustosMensual = hayRitmo ? alMes(suma(gastos.filter((m) => esGusto(cats, m)))) : null;

  const faltan: string[] = [];
  if (ingresoMensual === null) {
    faltan.push(
      enOtraMoneda
        ? 'Tienes ingresos en otra moneda y no los convierto: dímelos en pesos ("me pagaron 56 mil pesos").'
        : 'No tengo ingresos tuyos. Cuando te paguen, dime "me pagaron tantos pesos" y te califico completo.',
    );
  }
  if (!hayRitmo) faltan.push(`Necesito al menos ${MINIMO_DIAS} días de gastos para calcular tu ritmo.`);
  if (dinero === null) faltan.push('No sé cuánto tienes en débito o efectivo. Dime "tengo tanto en mi cuenta".');

  // ---------------------------------------------------------------- Pilares
  const pilares: Pilar[] = [];

  // Margen: lo que sobra de lo que entra.
  if (ingresoMensual !== null && gastoMensual !== null) {
    const tasa = (ingresoMensual - gastoMensual) / ingresoMensual;
    pilares.push({
      clave: "margen",
      nombre: "Margen",
      peso: PESOS.margen,
      puntos: interpolar(tasa, [[-0.05, 0], [0, 25], [0.1, 65], [0.2, 100]]),
      valor: pct(tasa),
      frase: tasa >= 0 ? `Te sobra el ${pct(tasa)} de lo que te entra.` : `Gastas ${pct(-tasa)} más de lo que te entra.`,
      consejo: tasa >= 0.2 ? "Vas muy bien: aparta lo que sobra en cuanto te paguen." : `Para llegar al 20% gasta unos ${$(redondear(gastoMensual - ingresoMensual * 0.8))} menos al mes.`,
    });
  } else {
    pilares.push({ clave: "margen", nombre: "Margen", peso: PESOS.margen, puntos: null, valor: null, frase: "Cuánto te sobra de lo que te entra.", consejo: ingresoMensual === null ? "Me falta tu ingreso." : "Me faltan días de gastos." });
  }

  // Colchón: cuántos meses de gasto aguanta lo que tiene.
  if (dinero !== null && gastoMensual !== null && gastoMensual > 0) {
    const m = Math.max(0, dinero) / gastoMensual;
    pilares.push({
      clave: "colchon",
      nombre: "Colchón",
      peso: PESOS.colchon,
      puntos: interpolar(m, [[0.25, 0], [1, 40], [3, 75], [6, 100]]),
      valor: meses(m),
      frase: `Lo que tienes cubre ${meses(m)} de tus gastos.`,
      consejo: m >= 6 ? "Colchón completo: lo que pase de 6 meses ponlo a trabajar." : `Para 3 meses te faltan unos ${$(redondear(Math.max(0, gastoMensual * 3 - dinero)))}.`,
    });
  } else {
    pilares.push({ clave: "colchon", nombre: "Colchón", peso: PESOS.colchon, puntos: null, valor: null, frase: "Cuántos meses aguantas con lo que tienes.", consejo: dinero === null ? "Me falta el saldo de tu cuenta de débito." : "Me faltan días de gastos." });
  }

  // Deuda: mitad cuánto debe contra lo que gana, mitad cuánto usa de sus tarjetas.
  {
    const partesDeuda: { puntos: number; frase: string }[] = [];
    if (ingresoMensual !== null) {
      const m = deudaTotal / ingresoMensual;
      partesDeuda.push({ puntos: interpolar(m, [[0, 100], [1, 75], [3, 40], [6, 0]]), frase: deudaTotal > 0 ? `Debes ${meses(m)} de ingreso` : "No debes nada" });
    }
    if (usoTotal !== null) {
      partesDeuda.push({ puntos: interpolar(usoTotal, [[0.1, 100], [0.3, 70], [0.5, 40], [0.8, 0]]), frase: `usas el ${pct(usoTotal)} de tus tarjetas` });
    } else if (tarjetas.length === 0 && deudaTotal === 0 && ingresoMensual === null) {
      partesDeuda.push({ puntos: 100, frase: "No debes nada" });
    }
    const puntos = partesDeuda.length ? partesDeuda.reduce((s, p) => s + p.puntos, 0) / partesDeuda.length : null;
    const frase = partesDeuda.length ? `${partesDeuda.map((p) => p.frase).join(" y ")}.`.replace(/^./, (x) => x.toUpperCase()) : "Cuánto debes y cuánto usas de tus tarjetas.";
    const peor = [...tarjetas].sort((a, b) => usoDe(b) - usoDe(a))[0];
    pilares.push({
      clave: "deuda",
      nombre: "Deuda",
      peso: PESOS.deuda,
      puntos,
      valor: usoTotal !== null ? `${pct(usoTotal)} de uso` : deudaTotal > 0 && ingresoMensual ? meses(deudaTotal / ingresoMensual) : deudaTotal === 0 && puntos !== null ? "Sin deuda" : null,
      frase,
      consejo:
        peor && usoDe(peor) >= USO_ROJO
          ? `Baja ${peor.nombre} de ${pct(usoDe(peor))} a menos de 70%: son ${$(redondear(Math.max(0, peor.deudaCentavos! - Math.floor(peor.limiteCentavos! * USO_SANO_TOPE))))}.`
          : peor && usoDe(peor) > 0.3
          ? `Baja ${peor.nombre} de ${pct(usoDe(peor))} a 30%: son ${$(redondear(Math.max(0, peor.deudaCentavos!) - peor.limiteCentavos! * 0.3))}.`
          : debePersonas > 0
            ? `Te quedan ${$(debePersonas)} de deudas con personas.`
            : puntos === null
              ? "Me falta tu ingreso o el límite de tus tarjetas."
              : "Tu deuda está sana.",
    });
  }

  // Gustos (regla 50/30/20): restaurantes, antojos, salidas... contra lo que entra.
  if (ingresoMensual !== null && gustosMensual !== null) {
    const p = gustosMensual / ingresoMensual;
    pilares.push({
      clave: "gustos",
      nombre: "Gustos",
      peso: PESOS.gustos,
      puntos: interpolar(p, [[0.3, 100], [0.45, 50], [0.6, 0]]),
      valor: pct(p),
      frase: `Tus gustos se llevan el ${pct(p)} de lo que te entra (sano: hasta 30%).`,
      consejo: p <= 0.3 ? "Bien: tus gustos caben en el 30%." : `Para quedar en 30% recorta unos ${$(redondear(gustosMensual - ingresoMensual * 0.3))} al mes.`,
    });
  } else {
    const p = gustosMensual !== null && gastoMensual ? gustosMensual / gastoMensual : null;
    pilares.push({
      clave: "gustos",
      nombre: "Gustos",
      peso: PESOS.gustos,
      puntos: null,
      valor: null,
      frase: p !== null ? `Tus gustos son el ${pct(p)} de lo que gastas.` : "Cuánto de lo que te entra se va en gustos.",
      consejo: ingresoMensual === null ? "Para calificarlo me falta tu ingreso." : "Me faltan días de gastos.",
    });
  }

  // Compromisos: lo que ya está comprometido cada mes (pagos fijos, suscripciones y mensualidades).
  if (ingresoMensual !== null) {
    const p = fijosMensuales / ingresoMensual;
    pilares.push({
      clave: "compromisos",
      nombre: "Pagos fijos",
      peso: PESOS.compromisos,
      puntos: interpolar(p, [[0.5, 100], [0.8, 0]]),
      valor: pct(p),
      frase: `Tus pagos fijos son el ${pct(p)} de lo que te entra.`,
      consejo: p <= 0.5 ? "Tus pagos fijos están en orden." : "Revisa qué pagos fijos puedes pausar o cancelar.",
    });
  } else {
    pilares.push({
      clave: "compromisos",
      nombre: "Pagos fijos",
      peso: PESOS.compromisos,
      puntos: null,
      valor: fijosMensuales > 0 ? $(fijosMensuales) : null,
      frase: fijosMensuales > 0 ? `Tienes ${$(fijosMensuales)} al mes de pagos fijos.` : "Qué parte de lo que te entra ya está comprometida.",
      consejo: "Para calificarlo me falta tu ingreso.",
    });
  }

  // ---------------------------------------------------------------- Alertas (reglas rojas)
  const alertas: string[] = [];
  const rojas = tarjetas.filter((e) => usoDe(e) >= USO_ROJO).sort((a, b) => usoDe(b) - usoDe(a));
  for (const e of rojas) alertas.push(`${e.nombre} va al ${pct(usoDe(e))} de su límite.`);
  if (ingresoMensual !== null) {
    // Dos meses completos seguidos gastando más de lo que entró (solo si hay datos de los dos meses enteros).
    const mesPasado = sumarMeses(inicioMes, -1);
    const antepasado = sumarMeses(inicioMes, -2);
    const finDe = (inicio: string) => armarFecha(partes(inicio).anio, partes(inicio).mes, ultimoDiaDelMes(partes(inicio).anio, partes(inicio).mes));
    if (desde && desde <= antepasado) {
      const deMes = (inicio: string, tipo: Mov["tipo"]) => suma(enBase.filter((m) => m.tipo === tipo && m.fecha >= inicio && m.fecha <= finDe(inicio)));
      if ([mesPasado, antepasado].every((i) => deMes(i, "gasto") > deMes(i, "ingreso"))) alertas.push("Llevas dos meses gastando más de lo que te entra.");
    }
  }
  const porPagar = porPagarEsteMes(ctx);
  if (dinero !== null && porPagar > 0 && dinero < porPagar) alertas.push(`Lo que tienes en débito no alcanza para los ${$(porPagar)} de pagos fijos que faltan este mes.`);

  // ---------------------------------------------------------------- Calificación
  const calificados = pilares.filter((p) => p.puntos !== null);
  let puntaje: number | null = null;
  // Sin ingreso no se califica: con solo el colchón y las tarjetas, el número engañaría.
  if (ingresoMensual !== null && calificados.length >= 3) {
    const pesos = calificados.reduce((s, p) => s + p.peso, 0);
    puntaje = Math.round(calificados.reduce((s, p) => s + p.puntos! * p.peso, 0) / pesos);
  }
  for (const p of calificados) p.puntos = Math.round(p.puntos!);
  // "Optimizando" es más que una buena calificación: el dinero ya va a metas.
  const conMetas = listarMetas(ctx).metas.some((m) => m.ahorradoCentavos > 0 && !m.completada);
  const topadoSinMetas = puntaje !== null && puntaje >= NIVELES.optimizando.desde && !conMetas;
  if (topadoSinMetas) puntaje = NIVELES.optimizando.desde - 1;
  const nivelSinAlertas: Nivel | null = puntaje !== null ? nivelDe(puntaje) : null;
  const nivel: Nivel | null = alertas.length ? "sobregirado" : nivelSinAlertas;

  // ---------------------------------------------------------------- Comparación con México
  const mexico: Comparacion[] = [];
  if (ingresoMensual !== null) {
    const { decil, romano } = decilDeIngreso(ingresoMensual);
    mexico.push({
      clave: "ingreso",
      titulo: "Tu lugar por ingreso",
      tu: $(redondear(ingresoMensual)),
      mexico: `Promedio de un hogar: ${$(PROMEDIO_HOGAR_CENTAVOS)}`,
      frase:
        decil === 1
          ? "Estás en el decil I: entre el 10% de los hogares de México con menos ingreso."
          : `Estás en el decil ${romano} de los hogares de México: ganas más que alrededor del ${(decil - 1) * 10}%.`,
      decil,
    });
    mexico.push({
      clave: "perceptor",
      titulo: "Frente a quien trabaja",
      tu: `${veces(ingresoMensual / PROMEDIO_PERCEPTOR_CENTAVOS)} veces`,
      mexico: `Una persona que trabaja gana ${$(PROMEDIO_PERCEPTOR_CENTAVOS)} en promedio`,
      frase: `Ganas ${veces(ingresoMensual / PROMEDIO_PERCEPTOR_CENTAVOS)} veces lo de una persona promedio que trabaja y ${veces(ingresoMensual / SALARIO_MINIMO_CENTAVOS)} salarios mínimos.`,
    });
    mexico.push({
      clave: "pobreza",
      titulo: "Distancia a la pobreza",
      tu: `${veces(ingresoMensual / LINEA_POBREZA_CENTAVOS)} veces`,
      mexico: `Línea de pobreza: ${$(LINEA_POBREZA_CENTAVOS)} por persona`,
      frase: `Si vives solo de tu ingreso, estás ${veces(ingresoMensual / LINEA_POBREZA_CENTAVOS)} veces arriba de la línea de pobreza.`,
    });
  }
  if (dinero !== null && dinero > 0) {
    const basico = dinero / LINEA_POBREZA_CENTAVOS;
    const tuVida = gastoMensual ? dinero / gastoMensual : null;
    mexico.push({
      clave: "sin_ingreso",
      titulo: "Si dejaras de ganar",
      tu: meses(basico),
      mexico: "De lo básico (línea de pobreza)",
      frase: `Con lo que tienes cubrirías lo básico ${meses(basico)}${tuVida !== null ? ` y tu nivel de vida actual ${meses(tuVida)}` : ""}.`,
    });
    if (ingresoMensual !== null) {
      const puede = dinero >= ingresoMensual;
      mexico.push({
        clave: "colchon",
        titulo: "Una urgencia de un mes",
        tu: puede ? "Sí la pagas" : "Todavía no",
        mexico: `Solo ${pct(PUEDE_CUBRIR_UN_MES_PROPORCION)} de los mexicanos podría`,
        frase: puede
          ? `Podrías pagar con tus ahorros una urgencia de un mes de ingreso; solo el ${pct(PUEDE_CUBRIR_UN_MES_PROPORCION)} de los mexicanos podría.`
          : `Una urgencia de un mes de ingreso no la cubrirías con tus ahorros; tampoco el ${pct(1 - PUEDE_CUBRIR_UN_MES_PROPORCION)} de los mexicanos.`,
      });
    }
  }
  const fuera = gastos.filter((m) => esComerFuera(cats, m));
  if (hayRitmo && fuera.length) {
    const mensual = alMes(suma(fuera));
    const parte = gastoMensual ? mensual / gastoMensual : 0;
    const vecesPromedio = mensual / COMER_FUERA_PERSONA_CENTAVOS;
    mexico.push({
      clave: "comer_fuera",
      titulo: "Comer fuera",
      tu: `${$(redondear(mensual))} al mes`,
      mexico: `Una persona gasta ${$(COMER_FUERA_PERSONA_CENTAVOS)} al mes`,
      frase:
        `${dias < 30 ? `A tu ritmo de estos ${dias} días, comer fuera` : "Comer fuera"} te cuesta unos ${$(redondear(mensual))} al mes, ` +
        `${vecesPromedio >= 1.5 ? `${veces(vecesPromedio)} veces lo de una persona promedio` : vecesPromedio <= 0.7 ? "menos que una persona promedio" : "como una persona promedio"}. ` +
        `Es el ${pct(parte)} de tu gasto; en México, el ${pct(COMER_FUERA_PROPORCION)}.`,
    });
  }

  // En qué se va el dinero, contra los hogares de México.
  const totalGasto = suma(gastos);
  const porRubro = new Map<ClaveRubro, number>();
  for (const m of gastos) porRubro.set(rubroDe(cats, m), (porRubro.get(rubroDe(cats, m)) ?? 0) + m.montoCentavos);
  const rubros: Rubro[] =
    totalGasto > 0
      ? RUBROS_ENIGH.map((r) => ({ clave: r.clave, nombre: r.nombre, tuProporcion: (porRubro.get(r.clave) ?? 0) / totalGasto, mexicoProporcion: r.proporcion }))
      : [];

  // ---------------------------------------------------------------- Consejos (sin IA)
  const consejos: Consejo[] = [];
  let dijoComerFuera = false;
  if (rojas.length) {
    const abono = rojas.reduce((s, e) => s + Math.max(0, e.deudaCentavos! - Math.floor(e.limiteCentavos! * USO_SANO_TOPE)), 0);
    const nombres = rojas.map((e) => e.nombre);
    const lista = nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0];
    consejos.push({
      texto: `Abónale unos ${$(redondear(abono))} a ${lista} para bajar${rojas.length > 1 ? "las" : "la"} a menos de 70% y salir de Sobregirado. Mientras, no ${rojas.length > 1 ? "las" : "la"} uses para gastos nuevos.`,
    });
  }
  if (fuera.length >= 3 && hayRitmo) {
    const ticket = suma(fuera) / fuera.length;
    const porSemana = (fuera.length / dias) * 7;
    if (porSemana >= 2) {
      consejos.push({
        texto: `Comes fuera unas ${unDecimal(porSemana)} veces por semana (${$(redondear(ticket))} cada vez). Una vez menos por semana te deja unos ${$(redondear(ticket * 4.3))} al mes.`,
        ahorroMensualCentavos: redondear(ticket * 4.3),
      });
      dijoComerFuera = true;
    }
  }
  // Las ideas del análisis de "¿en qué ahorro?" (gastos hormiga, recortables, suscripciones), sin repetir comer fuera.
  if (hayRitmo) {
    for (const h of analizar(ctx, { enfoque: "ahorrar" }).hallazgos) {
      if (!["hormiga", "suscripciones", "recortable"].includes(h.tipo)) continue;
      if (dijoComerFuera && h.tipo === "recortable" && /\b(Restaurantes|Café|Antojos|Delivery)\b/.test(h.texto)) continue;
      consejos.push({ texto: h.texto, ...(h.ahorroMensualCentavos ? { ahorroMensualCentavos: h.ahorroMensualCentavos } : {}) });
    }
  }
  // El pilar más flojo dice cómo subir de nivel.
  const flojo = calificados.filter((p) => p.puntos! < 70).sort((a, b) => a.puntos! * a.peso - b.puntos! * b.peso)[0];
  if (flojo && !(flojo.clave === "deuda" && rojas.length)) consejos.push({ texto: flojo.consejo });
  if (topadoSinMetas) consejos.unshift({ texto: 'Para llegar a Optimizando, pon lo que te sobra a trabajar en una meta: "quiero juntar 50 mil para un viaje".' });
  if (ingresoMensual === null) consejos.push({ texto: 'Cuando te paguen, dime "me pagaron tantos pesos" y te doy tu calificación completa y tu lugar en México.' });

  // ---------------------------------------------------------------- Título y resumen
  const titulo = nivel ? NIVELES[nivel].titulo : "Aún no sé";
  let resumen: string;
  if (alertas.length) {
    resumen = `Por esto: ${alertas[0]!.replace(/\.$/, "")}${alertas.length > 1 ? ` (y ${alertas.length - 1} más)` : ""}.`;
    if (nivelSinAlertas && nivelSinAlertas !== "sobregirado") resumen += ` Sin eso estarías en ${NIVELES[nivelSinAlertas].titulo}, con ${puntaje} de 100.`;
  }
  else if (puntaje !== null) {
    const margen = pilares.find((p) => p.clave === "margen")!;
    const deuda = pilares.find((p) => p.clave === "deuda")!;
    resumen = [margen.puntos !== null ? margen.frase : null, deuda.puntos !== null ? deuda.frase : null].filter(Boolean).join(" ");
  } else resumen = ingresoMensual === null ? "Me falta saber cuánto te entra para calificarte." : "Me faltan datos para calificarte.";

  return {
    nivel,
    nivelSinAlertas,
    puntaje,
    titulo,
    resumen,
    alertas,
    pilares,
    ingresos: { esteMesCentavos: esteMes, mensualCentavos: ingresoMensual, enOtraMoneda },
    base: { desde, hasta: ctx.hoy, dias, gastoMensualCentavos: gastoMensual, pocosDatos: dias < 30 },
    mexico,
    rubros,
    consejos: consejos.slice(0, 5),
    curiosidades: curiosidadesDe(ctx, { cats, gastos, todos, desde, dias, hayRitmo, gastoMensual, fijosMensuales, alMes }),
    faltan,
    fuentes: FUENTES,
  };
}

// ---------------------------------------------------------------- Datos curiosos

const NOMBRES_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];
const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const HORMIGA_CENTAVOS = 100_00;
const fechaCorta = (fecha: string) => `${partes(fecha).dia} de ${NOMBRES_MES[partes(fecha).mes - 1]}`;

/**
 * Datos curiosos con sus registros y las cifras de México: su lugar favorito, el día que más gasta, su compra
 * más grande, cuánto es eso en salarios mínimos... Solo lo que sus datos alcanzan a decir, hasta 6.
 */
function curiosidadesDe(
  ctx: Contexto,
  d: { cats: Categoria[]; gastos: Mov[]; todos: Mov[]; desde: string | null; dias: number; hayRitmo: boolean; gastoMensual: number | null; fijosMensuales: number; alMes: (c: number) => number },
): Curiosidad[] {
  const $ = (c: number) => formatearMonto(c, ctx.monedaBase);
  const variables = d.gastos.filter((m) => !m.recurrenteId && !m.msiId);
  const suma = (xs: Mov[]) => xs.reduce((s, m) => s + m.montoCentavos, 0);
  const diaMinimo = SALARIO_MINIMO_CENTAVOS / DIAS_MES;
  const enDias = d.dias === 1 ? "hoy" : `en ${d.dias} días`;
  const nombres = new Map(
    ctx.db
      .select({ id: comercios.id, nombre: comercios.nombre })
      .from(comercios)
      .where(eq(comercios.usuarioId, ctx.usuarioId))
      .all()
      .map((c) => [c.id, c.nombre]),
  );
  const out: Curiosidad[] = [];

  // Su lugar favorito: el comercio al que más va.
  const visitas = new Map<string, Mov[]>();
  for (const m of variables) if (m.comercioId && nombres.has(m.comercioId)) visitas.set(m.comercioId, [...(visitas.get(m.comercioId) ?? []), m]);
  const [favorito, susVisitas] = [...visitas].sort((a, b) => b[1].length - a[1].length || suma(b[1]) - suma(a[1]))[0] ?? [];
  if (favorito && susVisitas!.length >= 3) {
    out.push({
      clave: "favorito",
      dato: `${susVisitas!.length} visitas`,
      texto: `Tu lugar favorito es ${nombres.get(favorito)}: fuiste ${susVisitas!.length} veces ${enDias} y dejaste ${$(redondear(suma(susVisitas!)))}.`,
    });
  }

  // Comer fuera, en días de trabajo con salario mínimo.
  const fuera = variables.filter((m) => esComerFuera(d.cats, m));
  if (d.hayRitmo && fuera.length) {
    const diasDeTrabajo = d.alMes(suma(fuera)) / diaMinimo;
    if (diasDeTrabajo >= 1) {
      out.push({
        clave: "comer_fuera_dias",
        dato: `${Math.round(diasDeTrabajo)} días`,
        texto: `Lo que comes fuera en un mes es lo que gana en ${Math.round(diasDeTrabajo)} días alguien con salario mínimo.`,
      });
    }
  }

  // El día de la semana que más gasta, contra un día normal (con dos semanas, para que cada día se repita).
  if (d.desde && d.dias >= 14 && variables.length) {
    const veces = new Array(8).fill(0);
    for (let f = d.desde; f <= ctx.hoy; f = sumarDias(f, 1)) veces[diaSemana(f)]++;
    const porDia = new Array(8).fill(0);
    for (const m of variables) porDia[diaSemana(m.fecha)] += m.montoCentavos;
    const promedioDia = suma(variables) / d.dias;
    const fuerte = [1, 2, 3, 4, 5, 6, 7].sort((a, b) => porDia[b] / veces[b] - porDia[a] / veces[a])[0]!;
    const razon = porDia[fuerte] / veces[fuerte] / promedioDia;
    if (razon >= 1.4) {
      out.push({
        clave: "dia_fuerte",
        dato: NOMBRES_DIA[fuerte]!.replace(/^./, (x) => x.toUpperCase()),
        texto: `Los ${NOMBRES_DIA[fuerte]} gastas ${unDecimal(razon)} veces lo de un día normal.`,
      });
    }
  }

  // Su mes de gastos, en salarios mínimos.
  if (d.gastoMensual && d.gastoMensual > 0) {
    const x = d.gastoMensual / SALARIO_MINIMO_CENTAVOS;
    out.push({
      clave: "salario_minimo",
      dato: `${unDecimal(x)} ${x >= 0.95 && x < 1.05 ? "salario mínimo" : "salarios mínimos"}`,
      texto: `Lo que gastas en un mes (${$(redondear(d.gastoMensual))}) es lo que gana en ${meses(x)} alguien con salario mínimo.`,
    });
  }

  // Su compra más grande.
  const grande = [...variables].sort((a, b) => b.montoCentavos - a.montoCentavos)[0];
  if (grande && variables.length >= 3) {
    const donde = (grande.comercioId && nombres.get(grande.comercioId)) || categoriaYPadre(d.cats, grande.categoriaId).c?.nombre;
    out.push({
      clave: "mas_grande",
      dato: $(grande.montoCentavos),
      texto: `Tu gasto más grande ${enDias === "hoy" ? "de hoy" : `de estos ${d.dias} días`} fue ${$(grande.montoCentavos)}${donde ? ` en ${donde}` : ""}, el ${fechaCorta(grande.fecha)}.`,
    });
  }

  // Sus pagos fijos en un año, contra lo básico de una persona en México.
  if (d.fijosMensuales > 0) {
    const anual = d.fijosMensuales * 12;
    out.push({
      clave: "fijos_al_anio",
      dato: `${$(redondear(anual))} al año`,
      texto: `Tus pagos fijos suman ${$(redondear(anual))} al año: lo básico de una persona en México por ${meses(anual / LINEA_POBREZA_CENTAVOS)}.`,
    });
  }

  // Gastos hormiga: las compras chiquitas.
  const hormiga = variables.filter((m) => m.montoCentavos < HORMIGA_CENTAVOS);
  if (hormiga.length >= 5) {
    out.push({
      clave: "hormiga",
      dato: `${hormiga.length} compras`,
      texto: `Hiciste ${hormiga.length} compras de menos de ${$(HORMIGA_CENTAVOS)} ${enDias}; juntas suman ${$(redondear(suma(hormiga)))}.`,
    });
  }

  // Racha: días seguidos con algo registrado, hasta hoy o ayer.
  const conRegistro = new Set(d.todos.map((m) => m.fecha));
  let dia = conRegistro.has(ctx.hoy) ? ctx.hoy : sumarDias(ctx.hoy, -1);
  let racha = 0;
  while (conRegistro.has(dia)) {
    racha++;
    dia = sumarDias(dia, -1);
  }
  if (racha >= 3) out.push({ clave: "racha", dato: `${racha} días`, texto: `Llevas ${racha} días seguidos registrando tus gastos.` });

  return out.slice(0, 6);
}

// ---------------------------------------------------------------- Por voz, sin modelo

const SALUD = /^(?:(?:oye|a ver|bueno|y|dime) )*(?:como (?:esta|anda|va|ando|estoy|voy) (?:mi |de |con mi )?salud financiera|(?:cual es )?mi salud financiera|que tal (?:esta )?mi salud financiera)$/;
const MEXICO =
  /^(?:(?:oye|a ver|bueno|y|dime) )*(?:como estoy|como voy|donde estoy|en que lugar estoy|que tan bien estoy) (?:comparado|en comparacion|frente a|contra|respecto a?)(?: con)? (?:los |el resto de los |la gente en |el resto de )?(?:mexicanos|mexico|la poblacion mexicana|la gente)$/;

/** "¿Cómo está mi salud financiera?" o "¿cómo estoy comparado con los mexicanos?": la respuesta sin modelo. */
export function saludSinModelo(ctx: Contexto, texto: string): { enfoque: "salud" | "mexico"; respuesta: string } | undefined {
  const plano = normalizar(texto).replace(/[¿?¡!.,]/g, "").replace(/\s+/g, " ").trim();
  const enfoque = SALUD.test(plano) ? "salud" : MEXICO.test(plano) ? "mexico" : undefined;
  if (!enfoque || !saludHabilitada(ctx.db, ctx.usuarioId)) return undefined;
  const s = saludFinanciera(ctx);
  if (enfoque === "salud") {
    const cabeza = s.nivel ? `${s.titulo}${s.puntaje !== null && !s.alertas.length ? `, ${s.puntaje} de 100` : ""}.` : "Todavía no te puedo calificar.";
    const consejo = s.consejos[0]?.texto;
    return { enfoque, respuesta: [cabeza, s.resumen, consejo].filter(Boolean).join(" ") };
  }
  const de = (clave: Comparacion["clave"]) => s.mexico.find((c) => c.clave === clave)?.frase;
  const frases = s.ingresos.mensualCentavos !== null ? [de("ingreso"), de("pobreza"), de("comer_fuera")] : ["Para compararte con México necesito tus ingresos: cuando te paguen, dime cuántos pesos te llegaron.", de("comer_fuera"), de("sin_ingreso")];
  return { enfoque, respuesta: frases.filter(Boolean).join(" ") };
}
