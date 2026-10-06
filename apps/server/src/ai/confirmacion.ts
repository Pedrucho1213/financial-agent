import { diaSemana, sumarDias } from "../lib/fechas";
import { montosDelTexto } from "../lib/numeros";
import { esPregunta, normalizar } from "../lib/texto";

/** Lo que la herramienta regresó de un movimiento (ver `describir`). */
type Movimiento = {
  fecha: string;
  tipo: string;
  monto: string;
  categoria?: string;
  comercio?: string;
  descripcion?: string;
  cuenta?: string;
  revisar?: boolean;
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
// Al registrar, además pide corregir o borrar otra cosa ("y registra que el Uber de ayer fue con la Nu").
const OTRA_ACCION =
  /\b(borra|elimina|quita|cambia|corrige|deshaz|registra que|anota que|apunta que|fue con|fue el|fue del|era de|era del|no era)/;

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
  const cuenta = m.cuenta ? ` con ${m.cuenta}` : "";
  return `${concepto} de ${m.monto}${enCategoria}${cuenta}${fechaHablada(m.fecha, hoy)}`;
}

function enumerar(partes: string[]): string {
  return partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

const esError = (resultado: unknown) => !!resultado && typeof resultado === "object" && "error" in resultado;

/**
 * La confirmación hablada de un paso que solo guardó, corrigió o borró, armada con lo que de verdad
 * quedó en la base. Así no hace falta otra vuelta del modelo solo para decir "Listo".
 * Devuelve undefined si el paso no basta para terminar (hubo un error, era una pregunta,
 * o la frase pide algo más) y el modelo debe seguir.
 */
export function confirmacionDirecta(texto: string, hoy: string, ejecutadas: Ejecutada[]): string | undefined {
  if (ejecutadas.length === 0 || ejecutadas.some((e) => esError(e.resultado))) return undefined;
  const plano = normalizar(texto);
  if (esPregunta(texto) || PIDE_MAS.test(plano)) return undefined;

  const nombres = new Set(ejecutadas.map((e) => e.herramienta));
  if (nombres.size !== 1) return undefined;
  const [nombre] = nombres;

  if (nombre === "registrar_movimientos") {
    const registrados = ejecutadas.flatMap((e) => (e.resultado as { registrados: Movimiento[] }).registrados);
    // Si la frase trae más montos que registros, quizá falta alguno: que el modelo lo revise.
    if (registrados.length === 0 || OTRA_ACCION.test(plano) || montosDelTexto(texto).length > registrados.length) return undefined;
    const revisar = registrados.some((m) => m.revisar) ? " No supe bien la categoría; la dejé para que la revises." : "";
    return `Listo, ${enumerar(registrados.map((m) => describirMovimiento(m, hoy)))}.${revisar}`;
  }

  // Corregir, borrar o deshacer de un solo golpe; con "y" puede haber una segunda parte.
  if (ejecutadas.length !== 1 || /\by\b/.test(plano)) return undefined;
  const resultado = ejecutadas[0]!.resultado as Record<string, unknown>;
  if (nombre === "editar_movimiento") return `Listo, quedó ${describirMovimiento(resultado.editado as Movimiento, hoy)}.`;
  if (nombre === "eliminar_movimiento") return `Listo, borré ${describirMovimiento(resultado.eliminado as Movimiento, hoy)}.`;
  if (nombre === "deshacer") return resultado.deshecho ? "Listo, lo deshice." : "No hay nada que deshacer.";
  return undefined;
}
