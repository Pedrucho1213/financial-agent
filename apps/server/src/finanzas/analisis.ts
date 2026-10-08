import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { movimientos } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { armarFecha, diaSemana, partes, sumarDias, sumarMeses, ultimoDiaDelMes } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import { type Categoria, listarCategorias } from "./catalogos";
import type { Contexto } from "./contexto";
import { disponible, estadoPresupuestos, porPagarEsteMes } from "./planes";
import { listarRecurrentes } from "./recurrentes";
import { gastosHormiga, suscripcionesDuplicadas, textoHormiga } from "./revisor";

// "¿Cómo voy?", "¿en qué puedo ahorrar?", "¿cuánto voy a gastar este mes?": el análisis lo hace el
// código y la IA solo lo dice. Un modelo chico que compara dos consultas suma y resta mal, y gasta
// dos o tres vueltas en hacerlo. Es solo SQL y reglas, como el revisor nocturno.

type Mov = typeof movimientos.$inferSelect;

export type Enfoque = "como_voy" | "comparar" | "ahorrar" | "proyeccion";
export type PeriodoAnalisis = "mes" | "semana";

export type Hallazgo = {
  tipo: "comparacion" | "sube" | "baja" | "mayor" | "proyeccion" | "presupuesto" | "hormiga" | "suscripciones" | "recortable";
  /** Listo para decirse en voz alta, una frase. */
  texto: string;
  /** Cuánto podría ahorrar al mes si le hace caso (solo en los de ahorro). */
  ahorroMensualCentavos?: number;
};

// Con menos que esto se dice cuánto lleva, pero no se proyecta el cierre del mes.
const MINIMO_GASTOS = 5;
// Para comparar dos periodos, cada uno debe tener al menos esto gastado.
const MINIMO_COMPARABLE = 20_000;
// Una diferencia de categoría que vale la pena decir: $300 y un 30%.
const DIFERENCIA_MINIMA = 30_000;
const PROPORCION_MINIMA = 0.3;
// Un gasto de una vez (la laptop) no marca el ritmo: no se proyecta al resto del mes.
const UNA_VEZ_MINIMO = 200_000;
const UNA_VEZ_VECES = 5;

// Gastos fijos del mes: ya se pagaron o se van a pagar, no son un ritmo diario.
const FIJAS = new Set(
  ["Vivienda", "Renta", "Luz", "Agua", "Gas", "Internet y teléfono", "Mantenimiento", "Seguro", "Educación", "Suscripciones", "Streaming", "Música", "Software", "Otras suscripciones", "Gimnasio"].map(normalizar),
);
// Donde de verdad se puede recortar, aunque la categoría general sea una necesidad (Comida).
const RECORTABLES = new Set(["Restaurantes", "Café", "Antojos", "Delivery", "Taxi y apps"].map(normalizar));

const suma = (filas: Mov[]) => filas.reduce((s, m) => s + m.montoCentavos, 0);
const redondear = (centavos: number, a = 10_000) => Math.round(centavos / a) * a;
const porcentaje = (actual: number, base: number) => Math.round(((actual - base) / base) * 100);

function gastosEntre(ctx: Contexto, desde: string, hasta: string): Mov[] {
  return ctx.db
    .select()
    .from(movimientos)
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        isNull(movimientos.eliminadoEn),
        eq(movimientos.tipo, "gasto"),
        eq(movimientos.moneda, ctx.monedaBase),
        gte(movimientos.fecha, desde),
        lte(movimientos.fecha, hasta),
      ),
    )
    .all();
}

/** El día del primer gasto registrado: antes de eso no hay datos, no "cero gastos". */
function primerGasto(ctx: Contexto): string | undefined {
  return ctx.db
    .select({ fecha: movimientos.fecha })
    .from(movimientos)
    .where(
      and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn), eq(movimientos.tipo, "gasto"), eq(movimientos.moneda, ctx.monedaBase)),
    )
    .orderBy(asc(movimientos.fecha))
    .limit(1)
    .get()?.fecha;
}

/** Un periodo actual y otro igual de largo con qué compararlo, con cómo se dicen. */
type Ventanas = {
  actual: { desde: string; hasta: string; nombre: string };
  base?: { desde: string; hasta: string; nombre: string };
};

/**
 * Mes: del 1 a hoy contra el mismo tramo del mes pasado, si para entonces ya había datos. Si no (lleva
 * poco usándolo), los últimos 7 días contra los 7 anteriores. Semana: de lunes a hoy contra el mismo
 * tramo de la semana pasada.
 */
function ventanas(ctx: Contexto, periodo: PeriodoAnalisis, primero: string): Ventanas {
  const { anio, mes, dia } = partes(ctx.hoy);
  if (periodo === "semana") {
    const lunes = sumarDias(ctx.hoy, -(diaSemana(ctx.hoy) - 1));
    const lunesPasado = sumarDias(lunes, -7);
    const actual = { desde: lunes, hasta: ctx.hoy, nombre: "esta semana" };
    if (primero > lunesPasado) return { actual };
    return { actual, base: { desde: lunesPasado, hasta: sumarDias(ctx.hoy, -7), nombre: "la semana pasada a estas alturas" } };
  }
  const inicio = armarFecha(anio, mes, 1);
  const actual = { desde: inicio, hasta: ctx.hoy, nombre: "este mes" };
  const inicioPasado = sumarMeses(inicio, -1, 1);
  const p = partes(inicioPasado);
  // Unos días de gracia: quien empezó el 3 del mes pasado sí tiene con qué comparar.
  if (primero <= sumarDias(inicioPasado, 3)) {
    const hasta = armarFecha(p.anio, p.mes, Math.min(dia, ultimoDiaDelMes(p.anio, p.mes)));
    return { actual, base: { desde: inicioPasado, hasta, nombre: "el mes pasado a estas alturas" } };
  }
  if (primero <= sumarDias(ctx.hoy, -13)) {
    return {
      actual: { desde: sumarDias(ctx.hoy, -6), hasta: ctx.hoy, nombre: "en los últimos 7 días" },
      base: { desde: sumarDias(ctx.hoy, -13), hasta: sumarDias(ctx.hoy, -7), nombre: "los 7 días anteriores" },
    };
  }
  return { actual };
}

/** Agrupa por categoría principal ("Comida") o por subcategoría ("Restaurantes"). */
function porCategoria(cats: Categoria[], filas: Mov[], nivel: "principal" | "hoja"): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const m of filas) {
    const c = cats.find((x) => x.id === m.categoriaId);
    const elegida = nivel === "principal" && c?.padreId ? cats.find((x) => x.id === c.padreId) : c;
    const nombre = elegida?.nombre ?? "Sin categoría";
    mapa.set(nombre, (mapa.get(nombre) ?? 0) + m.montoCentavos);
  }
  return mapa;
}

function esFijo(cats: Categoria[], m: Mov): boolean {
  if (m.recurrenteId || m.msiId) return true;
  const c = cats.find((x) => x.id === m.categoriaId);
  const padre = c?.padreId ? cats.find((x) => x.id === c.padreId) : undefined;
  return [c?.nombre, padre?.nombre].some((n) => !!n && FIJAS.has(normalizar(n)));
}

/** Los gastos de una vez: mucho más grandes que lo normal. No marcan el ritmo de cada día. */
function deUnaVez(filas: Mov[]): Set<string> {
  const montos = filas.map((m) => m.montoCentavos).sort((a, b) => a - b);
  const mediana = montos[Math.floor(montos.length / 2)] ?? 0;
  return new Set(filas.filter((m) => m.montoCentavos >= UNA_VEZ_MINIMO && m.montoCentavos >= mediana * UNA_VEZ_VECES).map((m) => m.id));
}

export type Proyeccion = {
  /** Cuánto llevaría gastado al cierre del mes, redondeado a cientos. */
  cierreCentavos: number;
  /** Lo que gasta en un día normal, sin fijos ni gastos de una vez. */
  ritmoDiarioCentavos: number;
  /** Pagos fijos y mensualidades que todavía faltan este mes. */
  porPagarCentavos: number;
  /** Lo que le entra este mes (registrado o esperado), si se sabe. */
  ingresosCentavos: number;
};

/**
 * Cómo cerraría el mes: lo gastado, más su ritmo de gasto variable por los días que faltan, más lo
 * que falta pagar de fijos y mensualidades. El ritmo sale de este mes, o de los últimos 28 días si el
 * mes apenas empieza.
 */
export function proyeccionDelMes(ctx: Contexto, cats = listarCategorias(ctx.db, ctx.usuarioId)): Proyeccion | undefined {
  const primero = primerGasto(ctx);
  if (!primero) return undefined;
  const { anio, mes, dia } = partes(ctx.hoy);
  const inicio = armarFecha(anio, mes, 1);
  const diasDelMes = ultimoDiaDelMes(anio, mes);
  const delMes = gastosEntre(ctx, inicio, ctx.hoy);
  const variables = (filas: Mov[]) => {
    const unaVez = deUnaVez(filas);
    return filas.filter((m) => !esFijo(cats, m) && !unaVez.has(m.id));
  };
  // Días con datos en el tramo: si empezó a usarlo a medio mes, los días de antes no cuentan.
  const diasCon = (desde: string) => Math.round((Date.parse(ctx.hoy) - Date.parse(desde < primero ? primero : desde)) / 86_400_000) + 1;
  let ritmo: number;
  const desde28 = sumarDias(ctx.hoy, -27);
  if (diasCon(inicio) >= 7) ritmo = suma(variables(delMes)) / diasCon(inicio);
  else if (diasCon(desde28) >= 7) ritmo = suma(variables(gastosEntre(ctx, desde28, ctx.hoy))) / diasCon(desde28);
  else return undefined;
  // Lo que falta pagar va aparte: disponible() no lo aparta cuando hay presupuestos por categoría.
  const porPagar = porPagarEsteMes(ctx);
  const cierre = suma(delMes) + ritmo * (diasDelMes - dia) + porPagar;
  return {
    cierreCentavos: redondear(cierre),
    ritmoDiarioCentavos: Math.round(ritmo),
    porPagarCentavos: porPagar,
    ingresosCentavos: disponible(ctx).ingresosCentavos,
  };
}

/** Cuánto le queda al mes y cómo se ve, en una frase. */
function fraseProyeccion(ctx: Contexto, p: Proyeccion): string {
  const $ = (c: number) => formatearMonto(c, ctx.monedaBase);
  const cierre = `Al ritmo que vas, cerrarías el mes en unos ${$(p.cierreCentavos)}`;
  if (p.ingresosCentavos <= 0) return `${cierre}.`;
  const margen = redondear(p.ingresosCentavos - p.cierreCentavos);
  if (margen > 0) return `${cierre}; con lo que te entra te sobrarían unos ${$(margen)}.`;
  if (margen === 0) return `${cierre}, justo lo que te entra.`;
  return `${cierre}: te faltarían unos ${$(-margen)} para lo que te entra.`;
}

/** Lo que tiene de cada categoría en los dos tramos, de la que más subió a la que más bajó. */
function cambiosPorCategoria(cats: Categoria[], actual: Mov[], base: Mov[]) {
  // Por subcategoría: "Restaurantes subió" dice qué cambiar; "Comida subió" no.
  const a = porCategoria(cats, actual, "hoja");
  const b = porCategoria(cats, base, "hoja");
  return [...new Set([...a.keys(), ...b.keys()])]
    .map((nombre) => ({ nombre, actual: a.get(nombre) ?? 0, base: b.get(nombre) ?? 0 }))
    .map((x) => ({ ...x, diferencia: x.actual - x.base }))
    .sort((x, y) => y.diferencia - x.diferencia);
}

const notable = (x: { actual: number; base: number; diferencia: number }) =>
  Math.abs(x.diferencia) >= DIFERENCIA_MINIMA && (x.base === 0 || Math.abs(x.diferencia) / x.base >= PROPORCION_MINIMA);

/** Presupuestos pasados o casi: lo único que se dice aunque no lo haya preguntado. */
function alertasDePresupuesto(ctx: Contexto): Hallazgo[] {
  const $ = (c: number) => formatearMonto(c, ctx.monedaBase);
  const nombre = (p: { categoriaId: string | null; categoria: string }) => (p.categoriaId ? `de ${p.categoria.split(" > ").at(-1)}` : "del mes");
  return estadoPresupuestos(ctx)
    .presupuestos.filter((p) => p.porcentaje >= 90)
    .sort((a, b) => b.porcentaje - a.porcentaje)
    .slice(0, 1)
    .map((p) => ({
      tipo: "presupuesto" as const,
      texto:
        p.gastadoCentavos > p.limiteCentavos
          ? `Ojo: ya te pasaste del presupuesto ${nombre(p)} por ${$(p.gastadoCentavos - p.limiteCentavos)}.`
          : `Ojo: ya vas en el ${p.porcentaje}% del presupuesto ${nombre(p)}.`,
    }));
}

/** Dónde puede ahorrar, del que más deja al mes al que menos. */
function ideasDeAhorro(ctx: Contexto, cats: Categoria[]): Hallazgo[] {
  const $ = (c: number) => formatearMonto(c, ctx.monedaBase);
  const ideas: Hallazgo[] = [];
  const ultimos30 = gastosEntre(ctx, sumarDias(ctx.hoy, -29), ctx.hoy);
  const primero = primerGasto(ctx) ?? ctx.hoy;
  // Con menos de 30 días de datos, lo de 30 días se lleva a un mes completo.
  const dias = Math.min(30, Math.round((Date.parse(ctx.hoy) - Date.parse(primero)) / 86_400_000) + 1);
  const alMes = (centavos: number) => Math.round((centavos * 30) / Math.max(dias, 7));

  // Gastos hormiga: los mismos del revisor nocturno. Dejar la mitad es realista.
  const hormigas = gastosHormiga(ctx, cats).slice(0, 2);
  for (const g of hormigas) {
    ideas.push({ tipo: "hormiga", texto: textoHormiga(ctx, g), ahorroMensualCentavos: redondear(alMes(g.totalCentavos) / 2) });
  }

  // Suscripciones repetidas (dos de streaming): cancelar la más barata.
  for (const a of suscripcionesDuplicadas(ctx, cats)) ideas.push({ tipo: "suscripciones", texto: a.texto, ahorroMensualCentavos: a.menorMensualCentavos });

  // Lo recortable que más pesa (restaurantes, delivery, salidas...): bajarle un tercio.
  // Lo que ya salió como hormiga (por comercio o por categoría) no se cuenta otra vez.
  const yaEnHormiga = (m: Mov) => hormigas.some((g) => g.clave === `c${m.comercioId}` || g.clave === `k${m.categoriaId}`);
  const recortable = ultimos30.filter((m) => {
    if (m.recurrenteId || m.msiId || yaEnHormiga(m)) return false;
    const c = cats.find((x) => x.id === m.categoriaId);
    const padre = c?.padreId ? cats.find((x) => x.id === c.padreId) : undefined;
    return !!c && (RECORTABLES.has(normalizar(c.nombre)) || (padre ?? c).naturaleza === "gusto") && !FIJAS.has(normalizar(c.nombre)) && !FIJAS.has(normalizar(padre?.nombre ?? ""));
  });
  const hojas = [...porCategoria(cats, recortable, "hoja").entries()].sort((a, b) => b[1] - a[1]);
  for (const [nombre, centavos] of hojas.slice(0, 2)) {
    const mensual = alMes(centavos);
    const ahorro = redondear(mensual / 3);
    if (ahorro < 20_000) continue;
    ideas.push({
      tipo: "recortable",
      texto: `En ${nombre} se te van unos ${$(redondear(mensual))} al mes; bajarle un tercio te deja ${$(ahorro)}.`,
      ahorroMensualCentavos: ahorro,
    });
  }

  // Todas las suscripciones juntas, si son varias.
  const subs = listarRecurrentes(ctx, { tipo: "suscripcion" });
  if (subs.recurrentes.length >= 3 && !ideas.some((i) => i.tipo === "suscripciones")) {
    ideas.push({
      tipo: "suscripciones",
      texto: `Pagas ${subs.recurrentes.length} suscripciones, unos ${subs.total_mensual_gastos} al mes: revisa si usas todas.`,
      ahorroMensualCentavos: 0,
    });
  }
  return ideas.sort((a, b) => (b.ahorroMensualCentavos ?? 0) - (a.ahorroMensualCentavos ?? 0));
}

export type Analisis = {
  enfoque: Enfoque;
  periodo: PeriodoAnalisis;
  /** Lo que se dice en voz alta: dos o tres frases cortas. */
  respuesta: string;
  hallazgos: Hallazgo[];
  gastadoCentavos: number;
  /** Con qué se comparó, si había con qué. */
  comparadoCon?: string;
  baseCentavos?: number;
  proyeccion?: Proyeccion;
};

const SIN_DATOS =
  "Todavía no tengo gastos tuyos para analizar. Sigue dictándome lo que gastas y en unos días te digo cómo vas.";

/** El análisis que pidió, con la respuesta ya redactada para decirse. */
export function analizar(ctx: Contexto, opciones: { enfoque: Enfoque; periodo?: PeriodoAnalisis }): Analisis {
  const $ = (c: number) => formatearMonto(c, ctx.monedaBase);
  const { enfoque } = opciones;
  const periodo = enfoque === "proyeccion" ? "mes" : (opciones.periodo ?? "mes");
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const primero = primerGasto(ctx);
  const recientes = gastosEntre(ctx, sumarDias(ctx.hoy, -59), ctx.hoy);
  if (!primero || recientes.length === 0) {
    return { enfoque, periodo, respuesta: SIN_DATOS, hallazgos: [], gastadoCentavos: 0 };
  }
  // Pocos gastos (la renta y dos más) sí dicen cuánto lleva y en qué, pero no dan un ritmo.
  const pocos = recientes.length < MINIMO_GASTOS;

  const v = ventanas(ctx, periodo, primero);
  const actual = gastosEntre(ctx, v.actual.desde, v.actual.hasta);
  const base = v.base ? gastosEntre(ctx, v.base.desde, v.base.hasta) : [];
  const gastado = suma(actual);
  const comparable = !!v.base && gastado >= MINIMO_COMPARABLE && suma(base) >= MINIMO_COMPARABLE;
  const hallazgos: Hallazgo[] = [];

  // "Este mes llevas $8,400, un 12% más que el mes pasado a estas alturas."
  const llevas = `${v.actual.nombre[0]!.toUpperCase()}${v.actual.nombre.slice(1)} llevas ${$(gastado)} en gastos`;
  if (comparable) {
    const p = porcentaje(gastado, suma(base));
    const texto =
      Math.abs(p) < 10
        ? `${llevas}, parecido a ${v.base!.nombre} (${$(suma(base))}).`
        : `${llevas}, un ${Math.abs(p)}% ${p > 0 ? "más" : "menos"} que ${v.base!.nombre} (${$(suma(base))}).`;
    hallazgos.push({ tipo: "comparacion", texto });
    const cambios = cambiosPorCategoria(cats, actual, base).filter(notable);
    const sube = cambios.find((x) => x.diferencia > 0);
    const baja = cambios.findLast((x) => x.diferencia < 0);
    if (sube) hallazgos.push({ tipo: "sube", texto: `Lo que más subió es ${sube.nombre}: ${$(sube.actual)} contra ${$(sube.base)}.` });
    if (baja) hallazgos.push({ tipo: "baja", texto: `Bajaste en ${baja.nombre}: ${$(baja.actual)} contra ${$(baja.base)}.` });
  } else {
    hallazgos.push({ tipo: "comparacion", texto: `${llevas}.` });
  }
  // Lo que más se lleva: "Lo que más pesa es Comida, con $3,200, el 38%."
  const mayor = [...porCategoria(cats, actual, "principal").entries()].sort((a, b) => b[1] - a[1])[0];
  if (mayor && gastado > 0) {
    hallazgos.push({ tipo: "mayor", texto: `Lo que más pesa es ${mayor[0]}, con ${$(mayor[1])}, el ${Math.round((mayor[1] / gastado) * 100)}%.` });
  }
  const proyeccion = periodo === "mes" && !pocos ? proyeccionDelMes(ctx, cats) : undefined;
  if (proyeccion) hallazgos.push({ tipo: "proyeccion", texto: fraseProyeccion(ctx, proyeccion) });
  hallazgos.push(...alertasDePresupuesto(ctx));

  const de = (tipo: Hallazgo["tipo"]) => hallazgos.find((h) => h.tipo === tipo)?.texto;
  let frases: (string | undefined)[];
  switch (enfoque) {
    case "como_voy":
      // Cómo va, lo que más cambió (o lo que más pesa) y cómo cerraría; un presupuesto pasado manda.
      frases = [de("comparacion"), de("presupuesto") ?? de("sube") ?? de("mayor"), de("presupuesto") ? undefined : de("proyeccion")];
      break;
    case "comparar":
      frases = comparable
        ? [de("comparacion"), de("sube"), de("baja")]
        : [`${de("comparacion")} Todavía no tengo con qué compararlo: llevas poco tiempo registrando.`, de("mayor")];
      break;
    case "proyeccion":
      frases = proyeccion
        ? [de("proyeccion"), `Gastas unos ${$(redondear(proyeccion.ritmoDiarioCentavos, 1_000))} en un día normal${proyeccion.porPagarCentavos > 0 ? ` y te faltan ${$(proyeccion.porPagarCentavos)} de pagos fijos` : ""}.`]
        : [de("comparacion"), "Todavía no tengo suficientes gastos tuyos para calcular cómo cerrarías el mes."];
      break;
    case "ahorrar": {
      const ideas = ideasDeAhorro(ctx, cats);
      hallazgos.push(...ideas);
      frases = ideas.length
        ? ideas.slice(0, 2).map((i) => i.texto)
        : [`No veo fugas claras: no hay gastos hormiga ni recortables grandes. ${de("mayor") ?? ""}`.trim()];
      break;
    }
  }
  const respuesta = frases.filter(Boolean).join(" ");
  return {
    enfoque,
    periodo,
    respuesta,
    hallazgos,
    gastadoCentavos: gastado,
    ...(comparable ? { comparadoCon: v.base!.nombre, baseCentavos: suma(base) } : {}),
    ...(proyeccion ? { proyeccion } : {}),
  };
}

