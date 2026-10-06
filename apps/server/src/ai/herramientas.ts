import { tool } from "ai";
import { z } from "zod";
import { FRECUENCIAS, TIPOS_RECURRENTE } from "../db/schema";
import type { Contexto } from "../finanzas/contexto";
import {
  buscarMovimientos,
  crearMovimiento,
  deshacer,
  editarMovimiento,
  eliminarMovimiento,
  ErrorFinanzas,
  resumir,
} from "../finanzas/movimientos";
import { crearRecurrente, listarRecurrentes } from "../finanzas/recurrentes";

export type Accion = { herramienta: string; resultado: unknown };

const tipoMovimiento = z
  .enum(["gasto", "ingreso", "transferencia", "pago_tarjeta"])
  .describe("gasto, ingreso, transferencia entre cuentas propias o pago de tarjeta de crédito");
const fecha = z
  .string()
  .describe('"hoy", "ayer", "antier", un día de la semana como "viernes", o YYYY-MM-DD. Omítela si es hoy.');
const periodo = z
  .string()
  .describe(
    'hoy, ayer, esta_semana, semana_pasada, este_mes, mes_pasado, este_anio, ultimos_30_dias, un mes YYYY-MM o un rango YYYY-MM-DD..YYYY-MM-DD',
  );

const datosMovimiento = z.object({
  tipo: tipoMovimiento,
  monto: z.number().positive().describe("Monto en números, sin signo. 2 mil quinientos = 2500."),
  moneda: z.string().optional().describe("Solo si no es MXN, por ejemplo USD."),
  categoria: z.string().optional().describe("Nombre de una categoría existente, de preferencia la más específica."),
  comercio: z.string().optional().describe("Tienda, app o persona: Oxxo, Uber, Liverpool."),
  descripcion: z.string().optional().describe("Qué fue, en pocas palabras."),
  cuenta: z.string().optional().describe("Solo si el usuario dijo con qué pagó: BBVA, Nu, efectivo."),
  fecha: fecha.optional(),
});

/** Las herramientas que la IA puede usar. Cada una solo toca datos del usuario del contexto. */
export function crearHerramientas(ctx: Contexto, acciones: Accion[]) {
  // Los errores de validación regresan a la IA como texto para que corrija o pregunte.
  const ejecutar =
    <A, R>(nombre: string, fn: (args: A) => R) =>
    async (args: A) => {
      try {
        const resultado = fn(args);
        acciones.push({ herramienta: nombre, resultado });
        return resultado;
      } catch (error) {
        if (error instanceof ErrorFinanzas) return { error: error.message };
        throw error;
      }
    };

  return {
    registrar_movimientos: tool({
      description:
        "Registra uno o varios gastos o ingresos. Si el usuario menciona varios, mándalos todos en una sola llamada.",
      inputSchema: z.object({ movimientos: z.array(datosMovimiento).min(1) }),
      execute: ejecutar("registrar_movimientos", ({ movimientos }) => ({
        registrados: movimientos.map((m) => crearMovimiento(ctx, m)),
      })),
    }),

    buscar_movimientos: tool({
      description:
        "Busca movimientos registrados, del más reciente al más antiguo. Úsala antes de editar o eliminar para obtener el id.",
      inputSchema: z.object({
        texto: z.string().optional().describe("Comercio o palabra a buscar: café, Uber, Liverpool."),
        categoria: z.string().optional(),
        periodo: periodo.optional(),
        tipo: tipoMovimiento.optional(),
        limite: z.number().int().optional().describe("Cuántos regresar, 5 por omisión."),
      }),
      execute: ejecutar("buscar_movimientos", (filtro) => buscarMovimientos(ctx, filtro)),
    }),

    editar_movimiento: tool({
      description: "Cambia datos de un movimiento existente. Manda solo los campos que cambian.",
      inputSchema: datosMovimiento.partial().extend({ id: z.string().describe("id de buscar_movimientos") }),
      execute: ejecutar("editar_movimiento", ({ id, ...cambios }) => ({
        editado: editarMovimiento(ctx, id, cambios),
      })),
    }),

    eliminar_movimiento: tool({
      description: "Elimina un movimiento. Se puede deshacer.",
      inputSchema: z.object({ id: z.string().describe("id de buscar_movimientos") }),
      execute: ejecutar("eliminar_movimiento", ({ id }) => ({ eliminado: eliminarMovimiento(ctx, id) })),
    }),

    deshacer: tool({
      description: "Revierte lo último que se hizo (registro, edición o eliminación) cuando el usuario dice deshaz o cancela.",
      inputSchema: z.object({}),
      execute: ejecutar("deshacer", () => deshacer(ctx)),
    }),

    consultar_gastos: tool({
      description:
        "Calcula totales de gastos o ingresos en un periodo, con filtros y agrupación. Úsala para cualquier pregunta de cuánto; nunca sumes tú.",
      inputSchema: z.object({
        periodo: periodo.describe("Periodo a consultar; este_mes por omisión."),
        tipo: z.enum(["gasto", "ingreso"]).optional().describe("gasto por omisión"),
        categoria: z.string().optional(),
        texto: z.string().optional().describe("Comercio o palabra: Uber, café."),
        agrupar_por: z.enum(["ninguno", "categoria", "subcategoria", "comercio", "dia"]).optional(),
      }),
      execute: ejecutar("consultar_gastos", ({ agrupar_por, ...filtro }) =>
        resumir(ctx, { ...filtro, agruparPor: agrupar_por }),
      ),
    }),

    registrar_recurrente: tool({
      description:
        "Guarda un cobro o ingreso que se repite: suscripciones, renta, servicios, préstamos o la quincena. Sirve para recordatorios.",
      inputSchema: z.object({
        nombre: z.string().describe("Netflix, Renta, Quincena"),
        tipo: z.enum(TIPOS_RECURRENTE),
        monto: z.number().positive(),
        frecuencia: z.enum(FRECUENCIAS),
        dia: z.number().int().describe("Día del mes (1-31); en semanal, día de la semana (1 lunes ... 7 domingo)."),
        mes: z.number().int().optional().describe("Solo para anual (1-12)."),
        categoria: z.string().optional(),
        cuenta: z.string().optional(),
      }),
      execute: ejecutar("registrar_recurrente", (datos) => ({ registrado: crearRecurrente(ctx, datos) })),
    }),

    listar_recurrentes: tool({
      description:
        "Lista suscripciones, rentas y otros cobros que se repiten, con su próximo cobro y el total mensual.",
      inputSchema: z.object({
        dias: z.number().int().optional().describe("Solo los que se cobran en los próximos N días."),
        tipo: z.enum(TIPOS_RECURRENTE).optional(),
      }),
      execute: ejecutar("listar_recurrentes", (opciones) => listarRecurrentes(ctx, opciones)),
    }),
  };
}
