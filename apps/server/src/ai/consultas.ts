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

// La pregunta pide algo que no es un total: un promedio, cuántas veces, comparar, cuál fue el mayor,
// o trae una segunda parte ("¿y cuánto en Uber?"). Eso lo contesta el modelo.
const PIDE_OTRA_COSA =
  /\b(y|promedio|por dia|al dia|diario|cada dia|porcentaje|por ciento|cuantos|cuantas|veces|mas que|menos que|compar\w*|contra|diferencia|vs|ultim[oa]s?|mayor|menor|mas grande|mas caro|mas barato|primer[oa]?|presupuesto|meta|suscrip\w*|quedan?|queda|puedo|alcanza|falta|sobra)\b/;
const PIDE_CUAL = /\b(cual|cuales)\b/;

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
  agrupar_por?: "ninguno" | "categoria" | "subcategoria" | "comercio" | "dia";
};

/**
 * La respuesta hablada de consultar_gastos, o undefined si la pregunta no es sencilla y conviene que
 * el modelo la redacte con el resultado.
 */
export function respuestaDeConsulta(ctx: Contexto, args: ArgsConsulta, resumen: ReturnType<typeof resumir>): string | undefined {
  const pregunta = ctx.textoOriginal;
  if (!pregunta || !esPregunta(pregunta) || resumen.otras_monedas) return undefined;
  // "¿Y en Uber?" sigue la conversación: la "y" del principio no es una segunda pregunta.
  const plano = normalizar(pregunta).replace(/^((oye|a ver|bueno|y) )+/, "");
  const agrupa = !!args.agrupar_por && args.agrupar_por !== "ninguno";
  if (PIDE_OTRA_COSA.test(plano) || (PIDE_CUAL.test(plano) && !agrupa) || args.agrupar_por === "dia") return undefined;
  const etiqueta = etiquetaDelPeriodo(args.periodo, ctx.hoy);
  if (!etiqueta) return undefined;
  const tipo = args.tipo ?? "gasto";

  // En qué: el comercio o la palabra que buscó, o la categoría con su nombre de verdad.
  const categoria = args.categoria
    ? (encontrarCategoria(listarCategorias(ctx.db, ctx.usuarioId), args.categoria, tipo)?.nombre ?? args.categoria.split(">").at(-1)!.trim())
    : undefined;
  const que = args.texto?.trim() || categoria;

  if (agrupa) {
    if (tipo !== "gasto" || !resumen.grupos?.length) return undefined;
    const [primero, ...resto] = resumen.grupos;
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
