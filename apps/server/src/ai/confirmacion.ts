import { diaSemana, sumarDias } from "../lib/fechas";
import { montosDelTexto } from "../lib/numeros";
import { esPregunta, normalizar, pideInformacionExplicita } from "../lib/texto";
import { ESCRITURAS_PLANES } from "./herramientas-planes";
import { ESCRITURAS_CUENTAS } from "./herramientas-cuentas";

/** Lo que la herramienta regresó de un movimiento (ver `describir`). */
export type Movimiento = {
  fecha: string;
  tipo: string;
  monto: string;
  categoria?: string;
  comercio?: string;
  descripcion?: string;
  cuenta?: string;
  /** Transferencias y pagos de tarjeta: a dónde llegó. */
  cuenta_destino?: string;
  revisar?: boolean;
  /** No dijo el monto y se usó el de siempre. */
  monto_de_siempre?: boolean;
};

/** Una llamada a herramienta ya ejecutada en el último paso del modelo. */
export type Ejecutada = { herramienta: string; resultado: unknown };

const NOMBRES_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const NOMBRES_MES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// La frase pide algo más que lo que hizo la herramienta: algo que se repite o una pregunta
// en cualquier parte ("..., ¿cómo voy?").
const PIDE_MAS = new RegExp(
  "\\b(" +
    [
      "cada", "al mes", "por mes", "a la semana", "por semana", "al ano", "mensual", "semanal", "quincenal", "anual", "diario",
      "meses sin intereses", "msi", "a \\d+ meses",
      "cuanto", "cuanta", "cuantos", "cuantas", "como voy", "como vamos", "como ando", "cual", "cuales", "dime", "muestrame",
      "ensename", "cuentame", "resumen",
      "tambien", "ademas", "luego", "despues", "recuerdame", "avisame",
    ].join("|") +
    ")\\b",
);
// Después de guardar un presupuesto o una meta, la frase pide otra cosa.
const OTRA_PARTE = /\b(tambien|ademas|luego|despues|recuerdame|avisame)\b|\by (registra|anota|apunta|borra|elimina|cambia|gaste|pague|compre|cuanto|como|dime)\b/;
// La frase habla de varios movimientos.
const PLURAL = /\b(los|las|estos|estas|esos|esas|unos|unas|ambos|ambas|todos|todas|dos|tres|cuatro|cinco)\b/;
// Al registrar, además pide corregir o borrar otra cosa ("y registra que el Uber de ayer fue con la Nu").
const OTRA_ACCION =
  /\b(borra|elimina|quita|cambia|corrige|deshaz|registra que|anota que|apunta que|fue con|fue el|fue del|era de|era del|no era)/;

// Se corrige al dictar: "450, no, perdón, fueron 540". El monto que corrige no es otro movimiento.
// Con una "y" entre los dos montos ("200 en tacos, perdón, y 100 en refresco") son dos movimientos.
const SE_CORRIGE = /\d(?:(?!\by\b)\D)*\b(no perdon|perdon|no digo|digo|mejor dicho|me equivoque|no espera)\b(?:(?!\by\b)\D)*\d/g;

/** Cuántos montos dijo, sin contar los que corrigió en la misma frase. */
function montosDichos(texto: string): number {
  return montosDelTexto(texto).length - (normalizar(texto).match(SE_CORRIGE)?.length ?? 0);
}

function fechaHablada(fecha: string, hoy: string): string {
  if (fecha === hoy) return "";
  if (fecha === sumarDias(hoy, -1)) return " de ayer";
  if (fecha === sumarDias(hoy, -2)) return " de antier";
  const [, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  return ` del ${NOMBRES_DIA[diaSemana(fecha)]} ${dia} de ${NOMBRES_MES[mes]}`;
}

/** "café de $85 en Café", "Uber de $120 en Taxi y apps de ayer". */
function describirMovimiento(m: Movimiento, hoy: string): string {
  const hoja = m.categoria?.split(" > ").at(-1);
  const concepto =
    m.comercio ??
    (m.descripcion && m.descripcion.split(" ").length <= 4 ? m.descripcion : undefined) ??
    hoja?.toLowerCase() ??
    (m.tipo === "ingreso" ? "ingreso" : m.tipo === "pago_tarjeta" ? "pago de tarjeta" : m.tipo === "transferencia" ? "transferencia" : "gasto");
  const enCategoria = hoja && normalizar(hoja) !== normalizar(concepto) ? ` en ${hoja}` : "";
  const mueve = m.tipo === "transferencia" || m.tipo === "pago_tarjeta";
  const cuenta = m.cuenta ? (mueve ? ` desde ${m.cuenta}` : ` con ${m.cuenta}`) : "";
  const destino = mueve && m.cuenta_destino ? ` a ${m.cuenta_destino}` : "";
  return `${concepto} de ${m.monto}${enCategoria}${destino}${cuenta}${fechaHablada(m.fecha, hoy)}`;
}

function enumerar(partes: string[]): string {
  return partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

// Consultas cuyo resultado trae `respuesta`, lista para decirse.
const YA_REDACTADAS = new Set(["consultar_planes", "analizar", "consultar_gastos", "buscar_movimientos"]);

const esError = (resultado: unknown) => !!resultado && typeof resultado === "object" && "error" in resultado;

/**
 * El mismo registro dictado otra vez a los pocos minutos: "Ya anoté tacos de $120 en Antojos hace un momento.
 * ¿Es otra compra?". Si dice que sí, el modelo lo anota con el historial a la vista.
 */
export function preguntarSiRepite(registrados: Movimiento[], hoy: string): string {
  const otra = registrados.every((m) => m.tipo === "gasto") ? "¿Es otra compra?" : "¿Lo anoto otra vez?";
  return `Ya anoté ${enumerar(registrados.map((m) => describirMovimiento(m, hoy)))} hace un momento. ${otra}`;
}

/** "Listo, café de $85 en Café." Si no dijo el monto y se usó el de siempre, lo dice para que lo corrija. */
export function confirmarRegistro(registrados: Movimiento[], hoy: string): string {
  const revisar = registrados.some((m) => m.revisar) ? " No supe bien la categoría; la dejé para que la revises." : "";
  const deSiempre = registrados.some((m) => m.monto_de_siempre)
    ? registrados.length === 1
      ? ", como siempre"
      : ". Donde no dijiste cuánto, usé el monto de siempre"
    : "";
  return `Listo, ${enumerar(registrados.map((m) => describirMovimiento(m, hoy)))}${deSiempre}.${revisar}`;
}

/**
 * La confirmación hablada de un paso que solo guardó, corrigió o borró, armada con lo que de verdad
 * quedó en la base. Así no hace falta otra vuelta del modelo solo para decir "Listo".
 * Devuelve undefined si el paso no basta para terminar (hubo un error, era una pregunta,
 * o la frase pide algo más) y el modelo debe seguir.
 */
export function confirmacionDirecta(texto: string, hoy: string, ejecutadas: Ejecutada[]): string | undefined {
  if (ejecutadas.length === 0 || ejecutadas.some((e) => esError(e.resultado))) return undefined;
  const plano = normalizar(texto);

  // "¿Cuánto puedo gastar hoy?", "¿cómo voy?" o "¿cuánto gasté ayer en Uber?": la cifra ya viene
  // calculada y redactada. consultar_gastos solo la trae si la pregunta era sencilla (ver consultas.ts).
  if (ejecutadas.length === 1 && YA_REDACTADAS.has(ejecutadas[0]!.herramienta) && !/\by\b/.test(plano.replace(/^y /, ""))) {
    const respuesta = (ejecutadas[0]!.resultado as { respuesta?: string }).respuesta;
    if (respuesta) return respuesta;
  }
  // Saldos de cuentas o lo que lleva una etiqueta: la respuesta ya viene calculada y redactada.
  const consulta = ejecutadas.length === 1 ? (ejecutadas[0]!.resultado as { respuesta?: string }).respuesta : undefined;
  if (consulta && ["consultar_cuentas", "etiqueta"].includes(ejecutadas[0]!.herramienta) && !/\by\b/.test(plano)) return consulta;
  // Cuentas, dinero que se mueve entre ellas y etiquetas traen su confirmación con cómo quedaron. "Tengo 20 mil
  // en Revolut" empieza como pregunta, pero no lo es: solo cuenta una pregunta explícita o un "también".
  if (ejecutadas.every((e) => ESCRITURAS_CUENTAS.has(e.herramienta))) {
    if (pideInformacionExplicita(texto) || OTRA_PARTE.test(plano)) return undefined;
    const usados = ejecutadas.reduce((s, e) => s + ((e.resultado as { montos?: number }).montos ?? 1), 0);
    if (montosDichos(texto) > usados) return undefined;
    const confirmaciones = ejecutadas.map((e) => (e.resultado as { confirmacion?: string }).confirmacion);
    return confirmaciones.every(Boolean) ? confirmaciones.join(" ") : undefined;
  }
  // Presupuestos, metas, préstamos y MSI traen su confirmación. "Al mes" o "a 12 meses" son parte de lo
  // que guardaron, no algo más que pedir; una pregunta o un "también" sí lo son.
  if (ejecutadas.every((e) => ESCRITURAS_PLANES.has(e.herramienta))) {
    if (esPregunta(texto) || OTRA_PARTE.test(plano) || montosDelTexto(texto).length > ejecutadas.length) return undefined;
    const confirmaciones = ejecutadas.map((e) => (e.resultado as { confirmacion?: string }).confirmacion);
    return confirmaciones.every(Boolean) ? confirmaciones.join(" ") : undefined;
  }

  if (esPregunta(texto) || PIDE_MAS.test(plano)) return undefined;

  const nombres = new Set(ejecutadas.map((e) => e.herramienta));
  if (nombres.size !== 1) return undefined;
  const [nombre] = nombres;

  if (nombre === "registrar_movimientos") {
    const registrados = ejecutadas.flatMap((e) => (e.resultado as { registrados: Movimiento[] }).registrados);
    // Si la frase trae más montos que registros, quizá falta alguno: que el modelo lo revise.
    if (registrados.length === 0 || OTRA_ACCION.test(plano) || montosDichos(texto) > registrados.length) return undefined;
    return confirmarRegistro(registrados, hoy);
  }
  if (ejecutadas.length === 1 && nombre === "recordar") return "Listo, lo voy a recordar.";
  if (ejecutadas.length === 1 && nombre === "olvidar") return "Listo, ya lo olvidé.";

  // Corregir, borrar o deshacer de un solo golpe. Con "y" puede haber una segunda parte, y en plural
  // ("borra los dos cafés de ayer") puede faltar otro movimiento.
  if (ejecutadas.length !== 1 || /\by\b/.test(plano) || PLURAL.test(plano)) return undefined;
  const resultado = ejecutadas[0]!.resultado as Record<string, unknown>;
  if (nombre === "editar_movimiento") return `Listo, quedó ${describirMovimiento(resultado.editado as Movimiento, hoy)}.`;
  if (nombre === "eliminar_movimiento") return `Listo, borré ${describirMovimiento(resultado.eliminado as Movimiento, hoy)}.`;
  if (nombre === "deshacer") return resultado.deshecho ? "Listo, lo deshice." : "No hay nada que deshacer.";
  return undefined;
}
