import { encontrarCategoria, listarCategorias } from "../finanzas/catalogos";
import type { Contexto } from "../finanzas/contexto";
import type { resumir } from "../finanzas/movimientos";
import { partes, resolverFecha, sumarDias } from "../lib/fechas";
import { esPregunta, normalizar } from "../lib/texto";

// "¿Cuánto gasté ayer en Uber?": con el total ya calculado, la respuesta se arma aquí y el modelo no
// da una segunda vuelta solo para decir la cifra (ahorra alrededor de un segundo por pregunta).
// Solo en preguntas sencillas; lo demás lo redacta el modelo.

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const NOMBRE_DIA: Record<string, string> = { miercoles: "miércoles", sabado: "sábado" };

// Palabras con que se pregunta un total y cómo se dice el periodo. Si la pregunta trae algo más ("sin
// contar la renta", "con la Nu", "en la mañana", "en qué gasté menos", "¿y cuánto en Uber?"), es un
// filtro que consultar_gastos no expresa o una segunda parte: la redacta el modelo.
const DE_UN_TOTAL = new Set(
  (
    "cuanto cuanta he has ha hemos llevo llevas lleva llevamos voy vas va vamos gaste gastaste gasto gastado gastos gastamos gastando gastar " +
    "se me te nos han ha ido fue fueron es son salido salio total en todo toda de del la el los las lo al a mi mis por " +
    "dinero pesos plata ingreso ingresos entrado entrada entro entraron pagado pagaron depositado depositaron cobrado cobre ganado gane " +
    "hasta ahorita ahora momento dime sabes oye ver bueno porfa favor " +
    "hoy ayer antier anteayer este esta ese esa semana mes quincena ano anio pasado pasada dia dias ultimos ultimas " +
    "lunes martes miercoles jueves viernes sabado domingo enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre"
  ).split(" "),
);
// Al agrupar, "¿en qué categoría gasté más?" también es sencillo; "menos" no.
const DE_UN_GRUPO = new Set("que cual cuales donde mas categoria categorias subcategoria comercio comercios tienda tiendas lugar lugares".split(" "));

/** Si la pregunta solo pide el total con el periodo y el filtro que usó la herramienta. */
function soloPideElTotal(plano: string, agrupa: boolean, filtros: (string | undefined)[]): boolean {
  const delFiltro = new Set(filtros.flatMap((f) => (f ? normalizar(f).split(" ") : [])));
  return plano
    .split(" ")
    .every((p) => !p || DE_UN_TOTAL.has(p) || delFiltro.has(p) || /^\d+$/.test(p) || (agrupa && DE_UN_GRUPO.has(p)));
}

type Etiqueta = { texto: string; enCurso: boolean };

/** Cómo se dice el periodo que usó la herramienta: "Ayer", "Este mes", "En septiembre". */
export function etiquetaDelPeriodo(periodo: string | undefined, hoy: string): Etiqueta | undefined {
  const t = normalizar((periodo ?? "este_mes").replace(/_/g, " ")).replace(/ano/g, "anio");
  const { anio, mes } = partes(hoy);
  const fijas: Record<string, Etiqueta> = {
    hoy: { texto: "Hoy", enCurso: true },
    ayer: { texto: "Ayer", enCurso: false },
    antier: { texto: "Antier", enCurso: false },
    "esta semana": { texto: "Esta semana", enCurso: true },
    "semana pasada": { texto: "La semana pasada", enCurso: false },
    "ultima semana": { texto: "En la última semana", enCurso: true },
    "esta quincena": { texto: "Esta quincena", enCurso: true },
    quincena: { texto: "Esta quincena", enCurso: true },
    "quincena pasada": { texto: "La quincena pasada", enCurso: false },
    "este mes": { texto: "Este mes", enCurso: true },
    "mes pasado": { texto: "El mes pasado", enCurso: false },
    "este anio": { texto: "Este año", enCurso: true },
  };
  if (fijas[t]) return fijas[t];
  const ultimos = t.match(/^ultimos (\d+) dias$/);
  if (ultimos) return { texto: `En los últimos ${ultimos[1]} días`, enCurso: true };
  // Un mes: "septiembre" o "2026-09".
  const iso = (periodo ?? "").trim().match(/^(\d{4})-(\d{2})$/);
  const nombrado = NOMBRES_MES.indexOf(t);
  if (iso || nombrado >= 0) {
    const m = iso ? Number(iso[2]) : nombrado + 1;
    const a = iso ? Number(iso[1]) : m > mes ? anio - 1 : anio;
    if (a === anio && m === mes) return fijas["este mes"];
    return { texto: `En ${NOMBRES_MES[m - 1]}${a !== anio ? ` de ${a}` : ""}`, enCurso: false };
  }
  if (DIAS.includes(t)) return { texto: `El ${NOMBRE_DIA[t] ?? t}`, enCurso: false };
  // Una fecha suelta.
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test((periodo ?? "").trim()) ? resolverFecha(periodo!.trim(), hoy) : null;
  if (fecha) {
    if (fecha === hoy) return fijas.hoy;
    if (fecha === sumarDias(hoy, -1)) return fijas.ayer;
    const p = partes(fecha);
    return { texto: `El ${p.dia} de ${NOMBRES_MES[p.mes - 1]}${p.anio !== anio ? ` de ${p.anio}` : ""}`, enCurso: false };
  }
  return undefined;
}

export type ArgsConsulta = {
  periodo?: string;
  tipo?: "gasto" | "ingreso";
  categoria?: string;
  texto?: string;
  excluir?: string;
  etiqueta?: string;
  cuenta?: string;
  agrupar_por?: "ninguno" | "categoria" | "subcategoria" | "comercio" | "dia" | "etiqueta" | "cuenta";
};

/**
 * La respuesta hablada de consultar_gastos, o undefined si la pregunta no es sencilla y conviene que
 * el modelo la redacte con el resultado.
 */
export function respuestaDeConsulta(ctx: Contexto, args: ArgsConsulta, resumen: ReturnType<typeof resumir>): string | undefined {
  const pregunta = ctx.textoOriginal;
  // "Sin contar la renta", "con la Nu", "del viaje": que el modelo diga qué filtró.
  if (!pregunta || !esPregunta(pregunta) || resumen.otras_monedas || args.excluir || args.etiqueta || args.cuenta) return undefined;
  // "¿Y en Uber?" sigue la conversación: la "y" del principio no es una segunda pregunta.
  const plano = normalizar(pregunta).replace(/^((oye|a ver|bueno|y) )+/, "");
  const agrupa = !!args.agrupar_por && args.agrupar_por !== "ninguno";
  if (args.agrupar_por === "dia" || args.agrupar_por === "etiqueta" || args.agrupar_por === "cuenta") return undefined;
  const etiqueta = etiquetaDelPeriodo(args.periodo, ctx.hoy);
  if (!etiqueta) return undefined;
  const tipo = args.tipo ?? "gasto";

  // En qué: el comercio o la palabra que buscó, o la categoría con su nombre de verdad.
  const categoria = args.categoria
    ? (encontrarCategoria(listarCategorias(ctx.db, ctx.usuarioId), args.categoria, tipo)?.nombre ?? args.categoria.split(">").at(-1)!.trim())
    : undefined;
  const que = args.texto?.trim() || categoria;
  if (!soloPideElTotal(plano, agrupa, [args.texto, args.categoria, categoria])) return undefined;

  if (agrupa) {
    if (tipo !== "gasto" || !resumen.grupos?.length) return undefined;
    const [primero, ...resto] = resumen.grupos;
    // "Gastaste más en Sin comercio" no dice nada.
    if (primero!.nombre.startsWith("Sin ")) return undefined;
    const siguen = resto.slice(0, 2).map((g) => `${g.nombre} con ${g.total}`);
    const cola = siguen.length ? ` Le ${siguen.length === 1 ? "sigue" : "siguen"} ${siguen.join(" y ")}.` : "";
    const enQue = que ? ` de ${que}` : "";
    return `${etiqueta.texto} gastaste más en ${primero!.nombre}: ${primero!.total} de ${resumen.total}${enQue}.${cola}`;
  }

  if (resumen.cantidad === 0) {
    return `${etiqueta.texto} no tienes ${tipo === "ingreso" ? "ingresos" : "gastos"} registrados${que ? ` ${tipo === "ingreso" ? "de" : "en"} ${que}` : ""}.`;
  }
  if (tipo === "ingreso") {
    const verbo = etiqueta.enCurso ? "te han entrado" : "te entraron";
    return `${etiqueta.texto} ${verbo} ${resumen.total}${que ? ` de ${que}` : ""}.`;
  }
  if (etiqueta.enCurso) return `${etiqueta.texto} llevas ${resumen.total} ${que ? `en ${que}` : "en gastos"}.`;
  return `${etiqueta.texto} gastaste ${resumen.total}${que ? ` en ${que}` : ""}.`;
}

type Encontrado = { fecha: string; tipo: string; monto: string; comercio?: string; descripcion?: string; categoria?: string };
type FiltroDelMasGrande = { mas_grandes?: boolean; periodo?: string; limite?: number; texto?: string; categoria?: string; cuenta?: string; etiqueta?: string; monto?: number };

/**
 * "¿Cuál fue mi gasto más grande este mes?": buscar_movimientos con mas_grandes ya trae cuál fue. Solo
 * si pide uno y sin más filtros que el periodo; "¿cuáles fueron los tres más grandes?" lo dice el modelo.
 */
export function respuestaDelMasGrande(ctx: Contexto, filtro: FiltroDelMasGrande, encontrados: Encontrado[]): string | undefined {
  const pregunta = ctx.textoOriginal;
  const primero = encontrados[0];
  if (!filtro.mas_grandes || !primero || !pregunta || !esPregunta(pregunta)) return undefined;
  if ((filtro.limite ?? 1) > 1 || filtro.texto || filtro.categoria || filtro.cuenta || filtro.etiqueta || filtro.monto !== undefined) return undefined;
  if (primero.tipo !== "gasto" && primero.tipo !== "ingreso") return undefined;
  const plano = normalizar(pregunta);
  if (!/\b(mas grande|mas caro|mayor)\b/.test(plano) || /\b(cuales|los|las|tres|dos|cinco|2|3|5)\b/.test(plano)) return undefined;
  const etiqueta = filtro.periodo ? etiquetaDelPeriodo(filtro.periodo, ctx.hoy) : undefined;
  if (filtro.periodo && !etiqueta) return undefined;
  const que = primero.comercio ?? primero.descripcion ?? primero.categoria?.split(" > ").at(-1) ?? (primero.tipo === "ingreso" ? "un ingreso" : "un gasto");
  const p = partes(primero.fecha);
  const cuando = primero.fecha === ctx.hoy ? "hoy" : primero.fecha === sumarDias(ctx.hoy, -1) ? "ayer" : `el ${p.dia} de ${NOMBRES_MES[p.mes - 1]}`;
  const sujeto = `${primero.tipo === "ingreso" ? "ingreso" : "gasto"} más grande`;
  return `${etiqueta ? `${etiqueta.texto}, tu` : "Tu"} ${sujeto} fue ${que}, de ${primero.monto}, ${cuando}.`;
}
