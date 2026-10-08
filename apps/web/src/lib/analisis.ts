import { dineroCorto, pct } from "./formato";
import {
  type Cubeta,
  cubetas,
  diaSemana,
  diasEntre,
  nombreActual,
  nombreAnterior,
  type Periodo,
  type Rango,
  rangoAnterior,
  rangoDe,
  sumarDias,
} from "./periodos";
import { hashDe } from "./ruta";
import type { Fila } from "./filas";
import type { Categoria } from "./tipos";

export { aFila, type Fila, minutoDelDia } from "./filas";

// Todo lo de Análisis sale de aquí, sin la IA: números del periodo, comparación con el anterior e insights.
// Son funciones puras para probarlas sin navegador (test/analisis.test.ts).

export const MOMENTOS = [
  { id: "madrugada", nombre: "Madrugada", desde: 0, hasta: 6, rango: "12 a 6 am" },
  { id: "manana", nombre: "Mañana", desde: 6, hasta: 12, rango: "6 am a 12 pm" },
  { id: "tarde", nombre: "Tarde", desde: 12, hasta: 19, rango: "12 a 7 pm" },
  { id: "noche", nombre: "Noche", desde: 19, hasta: 24, rango: "7 pm a 12 am" },
] as const;
export type MomentoId = (typeof MOMENTOS)[number]["id"];

export type Grupo = {
  /** id de la categoría principal, el comercio o la cuenta; null = "sin". */
  id: string | null;
  nombre: string;
  centavos: number;
  cantidad: number;
  /** Lo del periodo anterior, al mismo punto si el periodo va en curso. */
  anterior: number;
};

export type CubetaDatos = Cubeta & { gasto: number; ingreso: number; cantidad: number; futuro: boolean };

export type DiaCalor = { fecha: string; centavos: number; cantidad: number; nivel: 0 | 1 | 2 | 3 | 4; futuro: boolean };

export type Analisis = {
  periodo: Periodo;
  rango: Rango;
  anterior: Rango;
  /** Hasta dónde se compara el anterior (el mismo punto, si el actual va en curso). */
  corteAnterior: string;
  enCurso: boolean;
  hoy: string;
  moneda: string;
  /** Días que cuentan para promedios (del primer registro conocido a hoy o al fin del periodo). */
  diasConsiderados: number;
  /**
   * Si ya se usaba la app al empezar el periodo anterior. Si no, compararlo engaña ("1,700% más"):
   * no es que antes se gastara menos, es que no se anotaba.
   */
  comparable: boolean;
  totales: {
    gasto: number;
    ingreso: number;
    neto: number;
    cantidad: number;
    gastoAnterior: number;
    ingresoAnterior: number;
    cantidadAnterior: number;
    /** El anterior completo (para "cerraste en…"). */
    gastoAnteriorCompleto: number;
    porDia: number;
    ticket: number;
    ticketAnterior: number;
  };
  cubetas: CubetaDatos[];
  /** Promedio por cubeta transcurrida (la línea punteada). */
  promedioCubeta: number;
  categorias: Grupo[];
  comercios: Grupo[];
  cuentas: Grupo[];
  dias: DiaCalor[];
  /** Promedio por día de cada día de la semana, 0 = lunes. */
  diaSemana: { centavos: number; dias: number }[];
  momentos: Record<MomentoId, { centavos: number; cantidad: number }>;
  conHora: number;
  naturaleza: { necesidad: number; gusto: number; ahorro: number; sin: number };
  sinGasto: { dias: number; racha: number };
  /** Gastos en otra moneda: no entran en las sumas. */
  otrasMonedas: number;
  /** El gasto más grande del periodo. */
  mayor: Fila | null;
  /** Por mes calendario del periodo. */
  meses: { mes: string; gasto: number; ingreso: number; futuro: boolean }[];
};

type Opciones = {
  periodo: Periodo;
  ref: string;
  hoy: string;
  moneda: string;
  categorias: Categoria[];
  /** Solo los gastos de esta categoría (principal o sub). */
  categoria?: string | null;
  /** Hay registros antes del periodo anterior: ya se usaba la app, aunque esos días no haya nada. */
  historiaAntes?: boolean;
};

/** Categoría principal de una categoría (ella misma si ya lo es). */
export function principalDe(categorias: Map<string, Categoria>, id: string | null) {
  if (!id) return null;
  const c = categorias.get(id);
  return c?.padreId ?? id;
}

export function analizar(filas: Fila[], o: Opciones): Analisis {
  const rango = rangoDe(o.periodo, o.ref);
  const anterior = rangoAnterior(o.periodo, o.ref);
  const mapa = new Map(o.categorias.map((c) => [c.id, c]));
  const enCurso = o.hoy >= rango.desde && o.hoy <= rango.hasta;
  const ultimoDia = enCurso ? o.hoy : rango.hasta;
  const transcurridos = diasEntre(rango.desde, ultimoDia);
  const corteAnterior = enCurso ? menor(sumarDias(anterior.desde, transcurridos - 1), anterior.hasta) : anterior.hasta;

  const enMoneda = filas.filter((f) => f.m === o.moneda);
  const otrasMonedas = filas.filter((f) => f.m !== o.moneda && f.t === "gasto" && f.f >= rango.desde && f.f <= rango.hasta).length;
  const delFiltro = (f: Fila) => !o.categoria || f.k === o.categoria || principalDe(mapa, f.k) === o.categoria;
  const gastos = enMoneda.filter((f) => f.t === "gasto" && delFiltro(f));
  const ingresos = o.categoria ? [] : enMoneda.filter((f) => f.t === "ingreso");
  const entre = (l: Fila[], desde: string, hasta: string) => l.filter((f) => f.f >= desde && f.f <= hasta);

  const g = entre(gastos, rango.desde, rango.hasta);
  const i = entre(ingresos, rango.desde, rango.hasta);
  const gA = entre(gastos, anterior.desde, corteAnterior);
  const iA = entre(ingresos, anterior.desde, corteAnterior);
  const suma = (l: Fila[]) => l.reduce((s, f) => s + f.c, 0);
  const gasto = suma(g);
  const gastoAnterior = suma(gA);

  // Los días antes del primer registro no son "días sin gastar": la app todavía no se usaba.
  const primero = o.historiaAntes
    ? sumarDias(anterior.desde, -1)
    : enMoneda.reduce<string | null>((p, f) => (!p || f.f < p ? f.f : p), null);
  const inicioEfectivo = primero && primero > rango.desde ? primero : rango.desde;
  const diasConsiderados = inicioEfectivo > ultimoDia ? 0 : diasEntre(inicioEfectivo, ultimoDia);
  // Con un poco de holgura: el primer registro puede caer unos días después del inicio.
  const holgura = Math.max(2, Math.floor(diasEntre(anterior.desde, anterior.hasta) / 10));
  const comparable = !!primero && primero <= sumarDias(anterior.desde, holgura);

  // Cubetas de la gráfica.
  const lista = cubetas(o.periodo, rango).map<CubetaDatos>((c) => {
    const gs = entre(g, c.desde, c.hasta);
    return { ...c, gasto: suma(gs), ingreso: suma(entre(i, c.desde, c.hasta)), cantidad: gs.length, futuro: c.desde > o.hoy };
  });
  const pasadas = lista.filter((c) => !c.futuro && c.hasta >= inicioEfectivo);
  const promedioCubeta = pasadas.length ? Math.round(pasadas.reduce((s, c) => s + c.gasto, 0) / pasadas.length) : 0;

  // Agrupaciones con su comparación.
  const agrupar = (clave: (f: Fila) => string | null, nombre: (id: string | null, f: Fila) => string) => {
    const grupos = new Map<string, Grupo>();
    const llave = (id: string | null) => id ?? "\u0000sin";
    for (const f of g) {
      const id = clave(f);
      const k = llave(id);
      const e = grupos.get(k) ?? { id, nombre: nombre(id, f), centavos: 0, cantidad: 0, anterior: 0 };
      e.centavos += f.c;
      e.cantidad += 1;
      grupos.set(k, e);
    }
    for (const f of gA) {
      const id = clave(f);
      const e = grupos.get(llave(id));
      if (e) e.anterior += f.c;
      else grupos.set(llave(id), { id, nombre: nombre(id, f), centavos: 0, cantidad: 0, anterior: f.c });
    }
    return [...grupos.values()].sort((a, b) => b.centavos - a.centavos || b.anterior - a.anterior);
  };
  // Con una categoría elegida, el desglose es por sus subcategorías.
  const categorias = agrupar(
    (f) => (o.categoria ? f.k : principalDe(mapa, f.k)),
    (id) => (!id ? "Sin categoría" : id === o.categoria ? "Sin subcategoría" : (mapa.get(id)?.nombre ?? "Otra categoría")),
  );
  // Comercios: el mismo con otras mayúsculas o acentos es uno solo.
  const comercios = agrupar(
    (f) => (f.n ? normalizar(f.n) : null),
    (_id, f) => f.n ?? "Sin comercio",
  ).filter((c) => c.id !== null);
  const cuentas = agrupar(
    (f) => (f.a ? normalizar(f.a) : null),
    (id, f) => (id ? (f.a ?? "") : "Sin decir"),
  );

  // Mapa de calor por día.
  const porDia = new Map<string, { centavos: number; cantidad: number }>();
  for (const f of g) {
    const e = porDia.get(f.f) ?? { centavos: 0, cantidad: 0 };
    e.centavos += f.c;
    e.cantidad += 1;
    porDia.set(f.f, e);
  }
  const nivelDe = niveles([...porDia.values()].map((d) => d.centavos));
  const dias: DiaCalor[] = [];
  for (let d = rango.desde; d <= rango.hasta; d = sumarDias(d, 1)) {
    const e = porDia.get(d);
    const c = e?.centavos ?? 0;
    const nivel = nivelDe(c);
    dias.push({ fecha: d, centavos: c, cantidad: e?.cantidad ?? 0, nivel, futuro: d > o.hoy });
  }

  // Días sin gastar y la racha más larga, solo en los días que cuentan.
  let sinDias = 0;
  let racha = 0;
  let actual = 0;
  for (const d of dias) {
    if (d.futuro || d.fecha < inicioEfectivo) continue;
    if (d.centavos === 0) {
      sinDias += 1;
      actual += 1;
      racha = Math.max(racha, actual);
    } else actual = 0;
  }

  // Por día de la semana: promedio por día de ese tipo (no la suma, que premia al que se repite más).
  const semana = Array.from({ length: 7 }, () => ({ centavos: 0, dias: 0 }));
  for (const d of dias) {
    if (d.futuro || d.fecha < inicioEfectivo) continue;
    const s = semana[diaSemana(d.fecha) - 1];
    if (!s) continue;
    s.centavos += d.centavos;
    s.dias += 1;
  }

  const momentos = Object.fromEntries(MOMENTOS.map((m) => [m.id, { centavos: 0, cantidad: 0 }])) as Analisis["momentos"];
  let conHora = 0;
  for (const f of g) {
    if (f.h === null) continue;
    const hora = Math.floor(f.h / 60);
    const m = MOMENTOS.find((x) => hora >= x.desde && hora < x.hasta);
    if (!m) continue;
    momentos[m.id].centavos += f.c;
    momentos[m.id].cantidad += 1;
    conHora += 1;
  }

  const naturaleza = { necesidad: 0, gusto: 0, ahorro: 0, sin: 0 };
  for (const f of g) {
    const c = f.k ? mapa.get(f.k) : undefined;
    const n = c?.naturaleza ?? (c?.padreId ? mapa.get(c.padreId)?.naturaleza : null) ?? null;
    naturaleza[n ?? "sin"] += f.c;
  }

  // Por mes calendario (las semanas de 6 meses cruzan meses: no sirven para esto).
  const meses: Analisis["meses"] = [];
  for (let mes = rango.desde.slice(0, 7); mes <= rango.hasta.slice(0, 7); mes = siguienteMes(mes)) {
    const desde = `${mes}-01`;
    const hasta = `${mes}-31`;
    meses.push({ mes, gasto: suma(entre(g, desde, hasta)), ingreso: suma(entre(i, desde, hasta)), futuro: desde > o.hoy });
  }

  const mayor = g.reduce<Fila | null>((m, f) => (!m || f.c > m.c ? f : m), null);
  const gastoAnteriorCompleto = suma(entre(gastos, anterior.desde, anterior.hasta));

  return {
    periodo: o.periodo,
    rango,
    anterior,
    corteAnterior,
    enCurso,
    hoy: o.hoy,
    moneda: o.moneda,
    diasConsiderados,
    comparable,
    totales: {
      gasto,
      ingreso: suma(i),
      neto: suma(i) - gasto,
      cantidad: g.length,
      gastoAnterior,
      ingresoAnterior: suma(iA),
      cantidadAnterior: gA.length,
      gastoAnteriorCompleto,
      porDia: diasConsiderados ? Math.round(gasto / diasConsiderados) : 0,
      ticket: g.length ? Math.round(gasto / g.length) : 0,
      ticketAnterior: gA.length ? Math.round(gastoAnterior / gA.length) : 0,
    },
    cubetas: lista,
    promedioCubeta,
    categorias,
    comercios,
    cuentas,
    dias,
    diaSemana: semana,
    momentos,
    conHora,
    naturaleza,
    sinGasto: { dias: sinDias, racha },
    otrasMonedas,
    mayor,
    meses,
  };
}

/**
 * Nivel (1 a 4) de cada día con gasto según su lugar entre los demás, no según el monto: así la renta no deja
 * a todos los otros días en el nivel más claro. Días iguales, mismo nivel.
 */
function niveles(valores: number[]) {
  const v = valores.filter((x) => x > 0).sort((a, b) => a - b);
  return (c: number): DiaCalor["nivel"] => {
    if (c <= 0 || !v.length) return 0;
    const i = v.indexOf(c);
    const lugar = i < 0 ? v.filter((x) => x < c).length : i;
    return (Math.min(3, Math.floor((lugar * 4) / v.length)) + 1) as DiaCalor["nivel"];
  };
}

export function normalizar(t: string) {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const menor = (a: string, b: string) => (a < b ? a : b);

function siguienteMes(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  const n = (y ?? 1970) * 12 + (m ?? 1);
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}

/** Cambio relativo; null si no hay base. */
export function cambio(actual: number, base: number) {
  return base > 0 ? (actual - base) / base : null;
}

// ---------- Insights ----------

export type Tono = "atencion" | "bueno" | "info";
export type IconoInsight = "sube" | "baja" | "nuevo" | "calma" | "finde" | "reloj" | "ticket" | "balanza" | "tarjeta" | "flujo" | "estrella";

export type Insight = {
  id: string;
  tono: Tono;
  icono: IconoInsight;
  titulo: string;
  detalle?: string;
  accion?: { texto: string; ir?: string; pregunta?: string };
};

const PRIORIDAD: Record<Tono, number> = { atencion: 0, bueno: 1, info: 2 };

/** Lo que vale la pena decir del periodo, del más importante al menos. Solo lo que pasa un umbral: sin ruido. */
export function construirInsights(a: Analisis, { maximo = 6 } = {}): Insight[] {
  const lista: Insight[] = [];
  const fmt = (c: number) => dineroCorto(redondear(c), a.moneda);
  const antes = nombreAnterior(a.periodo, a.rango.desde);
  const ahora = nombreActual(a.periodo);
  const alPunto = a.enCurso ? " a estas alturas" : "";
  // Movimientos filtra por mes: un periodo más largo (o una semana que cruza meses) abre todo.
  const mesDe = a.periodo === "mes" ? a.rango.desde.slice(0, 7) : "todo";
  const filtroMovs = (extra: Record<string, string | undefined>) =>
    hashDe("movimientos", { mes: mesDe, ...extra });
  const hayAnterior = a.comparable && a.totales.cantidadAnterior >= 3;

  // La categoría que más subió y la que más bajó contra el periodo anterior.
  if (hayAnterior) {
    const conDiferencia = a.categorias
      .filter((c) => c.id)
      .map((c) => ({ ...c, dif: c.centavos - c.anterior, rel: cambio(c.centavos, c.anterior) }));
    const sube = conDiferencia
      .filter((c) => c.dif >= 20_000 && (c.rel === null ? c.centavos >= 50_000 : c.rel >= 0.25))
      .sort((x, y) => y.dif - x.dif)[0];
    if (sube) {
      lista.push({
        id: "sube",
        tono: "atencion",
        icono: "sube",
        titulo:
          sube.rel === null
            ? `${sube.nombre}: ${fmt(sube.centavos)} ${ahora}, y nada en ${antes}.`
            : `${sube.nombre} subió ${pct(sube.rel)}${alPunto}.`,
        detalle: sube.rel === null ? undefined : `${fmt(sube.centavos)} contra ${fmt(sube.anterior)} en ${antes}.`,
        accion: { texto: "Ver gastos", ir: filtroMovs({ tipo: "gasto", categoria: sube.id ?? undefined }) },
      });
    }
    const baja = conDiferencia
      .filter((c) => -c.dif >= 20_000 && c.rel !== null && c.rel <= -0.2)
      .sort((x, y) => x.dif - y.dif)[0];
    if (baja && baja.rel !== null) {
      lista.push({
        id: "baja",
        tono: "bueno",
        icono: "baja",
        titulo: `Gastaste ${pct(-baja.rel)} menos en ${baja.nombre}${alPunto}.`,
        detalle: `${fmt(baja.centavos)} contra ${fmt(baja.anterior)} en ${antes}: ${fmt(-baja.dif)} menos.`,
      });
    }
  }

  // Lo que entró contra lo que salió, por necesidad y gusto (la regla 50/30/20).
  const { necesidad, gusto } = a.naturaleza;
  if (a.totales.ingreso > 0 && a.totales.gasto > 0 && !a.enCurso) {
    const g = gusto / a.totales.ingreso;
    const ahorro = a.totales.neto / a.totales.ingreso;
    if (g > 0.3) {
      lista.push({
        id: "gustos",
        tono: "atencion",
        icono: "balanza",
        titulo: `Los gustos se llevaron el ${pct(g)} de lo que te entró.`,
        detalle: `La regla 50/30/20 sugiere 30% o menos. Necesidades: ${pct(necesidad / a.totales.ingreso)}; ahorro: ${pct(Math.max(0, ahorro))}.`,
        accion: { texto: "Pedir ideas", pregunta: "¿En qué gustos gasto más y cuáles podría recortar sin sufrir?" },
      });
    } else if (ahorro >= 0.2) {
      lista.push({
        id: "ahorro",
        tono: "bueno",
        icono: "estrella",
        titulo: `Guardaste el ${pct(ahorro)} de lo que te entró.`,
        detalle: "Arriba del 20% que se recomienda. Así se ve un buen periodo.",
      });
    }
  }

  // Meses en rojo (6 meses o un año).
  if (a.periodo === "6m" || a.periodo === "anio") {
    const meses = mesesConFlujo(a);
    const rojos = meses.filter((m) => m.ingreso > 0 && m.neto < 0);
    if (rojos.length && meses.length >= 3) {
      lista.push({
        id: "rojos",
        tono: "atencion",
        icono: "flujo",
        titulo: `En ${rojos.length} de ${meses.length} meses gastaste más de lo que te entró.`,
        detalle: `El más apretado: ${rojos.sort((x, y) => x.neto - y.neto)[0]?.nombre.toLowerCase()}.`,
      });
    }
    // El mes en curso no cuenta: a medias siempre parece el más tranquilo.
    const conGasto = meses.filter((m) => m.gasto > 0 && m.mes !== a.hoy.slice(0, 7));
    if (conGasto.length >= 3) {
      const mejor = [...conGasto].sort((x, y) => x.gasto - y.gasto)[0];
      if (mejor) {
        lista.push({
          id: "mejor",
          tono: "bueno",
          icono: "estrella",
          titulo: `${mejor.nombre} fue tu mes más tranquilo: ${fmt(mejor.gasto)}.`,
          detalle: `El promedio fue ${fmt(conGasto.reduce((s, m) => s + m.gasto, 0) / conGasto.length)} al mes.`,
        });
      }
    }
  }

  // Días sin gastar.
  if (a.diasConsiderados >= 5 && a.sinGasto.dias >= 2 && a.periodo !== "anio") {
    lista.push({
      id: "sin_gasto",
      tono: "bueno",
      icono: "calma",
      titulo: `${a.sinGasto.dias} días sin gastar ${ahora}.`,
      detalle: a.sinGasto.racha >= 2 ? `Tu mejor racha: ${a.sinGasto.racha} días seguidos.` : undefined,
    });
  }

  // Fin de semana contra entre semana (por día, para que sea justo).
  const entre = a.diaSemana.slice(0, 5);
  const finde = a.diaSemana.slice(5);
  const prom = (l: { centavos: number; dias: number }[]) => {
    const dias = l.reduce((s, d) => s + d.dias, 0);
    return dias ? l.reduce((s, d) => s + d.centavos, 0) / dias : 0;
  };
  const diasFinde = finde.reduce((s, d) => s + d.dias, 0);
  const pEntre = prom(entre);
  const pFinde = prom(finde);
  if (diasFinde >= 2 && pEntre > 0 && pFinde >= pEntre * 1.5 && pFinde - pEntre >= 10_000) {
    lista.push({
      id: "finde",
      tono: "info",
      icono: "finde",
      titulo: `En fin de semana gastas ${veces(pFinde / pEntre)} más por día.`,
      detalle: `${fmt(pFinde)} por día el sábado y domingo; ${fmt(pEntre)} entre semana.`,
      accion: { texto: "Preguntar por qué", pregunta: "¿En qué gasto más los fines de semana?" },
    });
  }

  // A qué hora se va el dinero (solo con horas reales).
  if (a.conHora >= 6) {
    const top = MOMENTOS.map((m) => ({ ...m, ...a.momentos[m.id] })).sort((x, y) => y.cantidad - x.cantidad)[0];
    if (top && top.cantidad / a.conHora >= 0.5) {
      lista.push({
        id: "momento",
        tono: "info",
        icono: "reloj",
        titulo: `${pct(top.cantidad / a.conHora)} de tus compras son en la ${top.nombre.toLowerCase()}.`,
        detalle: `De ${top.rango}: ${fmt(top.centavos)} ${ahora}.`,
      });
    }
  }

  // Compra promedio.
  if (a.comparable && a.totales.cantidad >= 5 && a.totales.cantidadAnterior >= 5) {
    const r = cambio(a.totales.ticket, a.totales.ticketAnterior);
    if (r !== null && Math.abs(r) >= 0.2 && Math.abs(a.totales.ticket - a.totales.ticketAnterior) >= 5_000) {
      lista.push({
        id: "ticket",
        tono: r > 0 ? "info" : "bueno",
        icono: "ticket",
        titulo: `Tu compra promedio ${r > 0 ? "subió" : "bajó"} a ${fmt(a.totales.ticket)}.`,
        detalle: `Antes era de ${fmt(a.totales.ticketAnterior)}, con ${a.totales.cantidad} compras ${ahora}.`,
      });
    }
  }

  // Comercios nuevos.
  if (hayAnterior) {
    const nuevos = a.comercios.filter((c) => c.cantidad > 0 && c.anterior === 0).slice(0, 3);
    const total = a.comercios.filter((c) => c.cantidad > 0 && c.anterior === 0);
    if (total.length >= 2 && a.periodo !== "anio") {
      const suma = total.reduce((s, c) => s + c.centavos, 0);
      lista.push({
        id: "nuevos",
        tono: "info",
        icono: "nuevo",
        titulo: `${total.length} lugares nuevos ${ahora}.`,
        detalle: `${enumerar(nuevos.map((c) => c.nombre))}${total.length > nuevos.length ? " y más" : ""}: ${fmt(suma)}.`,
      });
    }
  }

  // Un método de pago que concentra casi todo.
  const conCuenta = a.cuentas.filter((c) => c.id !== null && c.cantidad > 0);
  const contadas = conCuenta.reduce((s, c) => s + c.cantidad, 0);
  const principal = conCuenta[0];
  if (principal && contadas >= 5) {
    const parte = principal.centavos / Math.max(1, conCuenta.reduce((s, c) => s + c.centavos, 0));
    if (parte >= 0.6) {
      lista.push({
        id: "cuenta",
        tono: "info",
        icono: "tarjeta",
        titulo: `El ${pct(parte)} de lo que pagaste ${ahora} fue con ${principal.nombre}.`,
        detalle: `De los gastos en que dijiste con qué pagaste (${contadas}).`,
      });
    }
  }

  return lista.sort((x, y) => PRIORIDAD[x.tono] - PRIORIDAD[y.tono]).slice(0, maximo);
}

/** Por mes, lo que entró y lo que salió (para la gráfica de flujo de 6 meses y un año). */
export function mesesConFlujo(a: Analisis) {
  const f = new Intl.DateTimeFormat("es-MX", { month: "long" });
  return a.meses
    .filter((m) => !m.futuro)
    .map((m) => {
      const [y, mm] = m.mes.split("-").map(Number);
      const n = f.format(new Date(y ?? 1970, (mm ?? 1) - 1, 1, 12));
      return { ...m, neto: m.ingreso - m.gasto, nombre: n.charAt(0).toUpperCase() + n.slice(1) };
    });
}

/** En una frase se lee mejor "$1,240" que "$1,237.40": decenas arriba de $1,000 y pesos arriba de $100. */
function redondear(c: number) {
  const pesos = Math.abs(c) / 100;
  const paso = pesos >= 1000 ? 10 : pesos >= 100 ? 1 : 0.01;
  return Math.sign(c) * Math.round(Math.round(pesos / paso) * paso * 100);
}

function veces(x: number) {
  const r = Math.round(x * 10) / 10;
  return r >= 1.95 && r < 2.05 ? "el doble" : `${r.toLocaleString("es-MX")} veces`;
}

export function enumerar(l: string[]) {
  if (l.length <= 1) return l.join("");
  return `${l.slice(0, -1).join(", ")} y ${l.at(-1)}`;
}
