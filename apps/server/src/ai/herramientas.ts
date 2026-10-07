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
  idDelMovimiento,
  resumir,
} from "../finanzas/movimientos";
import { cancelarRecurrente, crearRecurrente, editarRecurrente, listarRecurrentes } from "../finanzas/recurrentes";
import { fechaDelTexto, fechasDelTexto, mencionaFecha, resolverFecha } from "../lib/fechas";
import { montoConPalabras, montosDelTexto } from "../lib/numeros";
import { monedaDelTexto, normalizar, tipoDelTexto } from "../lib/texto";

/** Lo que hizo una herramienta: con qué la llamó el modelo y qué resultó. */
export type Accion = { herramienta: string; argumentos: unknown; resultado: unknown };

const tipoMovimiento = z
  .enum(["gasto", "ingreso", "transferencia", "pago_tarjeta"])
  .describe("gasto, ingreso, transferencia entre cuentas propias o pago de tarjeta de crédito");
const fecha = z
  .string()
  .describe('"hoy", "ayer", "antier", un día de la semana como "viernes", o YYYY-MM-DD. Omítela si es hoy.');
const periodo = z
  .string()
  .describe(
    'hoy, ayer, esta_semana, semana_pasada, esta_quincena, quincena_pasada, este_mes, mes_pasado, este_anio, ultimos_30_dias, un mes (septiembre o YYYY-MM) o un rango YYYY-MM-DD..YYYY-MM-DD',
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

// Cómo encontrar el movimiento a editar o eliminar sin buscarlo antes.
const busqueda = z
  .object({
    texto: z.string().optional().describe("Comercio o palabra: café, Uber, Liverpool."),
    categoria: z.string().optional(),
    periodo: periodo.optional(),
    monto: z.number().optional().describe("El monto que tiene ahora, no el nuevo."),
    mas_reciente: z.boolean().optional().describe('true si dice "el último" o si basta el más reciente.'),
  })
  .describe("Datos del movimiento tal como está guardado ahora.");

// Acepta "suscripciones" o "rentas" aunque el tipo sea singular.
const tipoRecurrente = z.preprocess((valor) => {
  if (typeof valor !== "string") return valor;
  const t = normalizar(valor).replace(/ /g, "_");
  const tipos: readonly string[] = TIPOS_RECURRENTE;
  return [t, t.replace(/es$/, ""), t.replace(/s$/, "")].find((x) => tipos.includes(x)) ?? t;
}, z.enum(TIPOS_RECURRENTE));

/** Las herramientas que la IA puede usar. Cada una solo toca datos del usuario del contexto. */
export function crearHerramientas(ctx: Contexto, acciones: Accion[]) {
  // Los errores de validación regresan a la IA como texto para que corrija o pregunte.
  const ejecutar =
    <A, R>(nombre: string, fn: (args: A) => R) =>
    async (args: A) => {
      try {
        const resultado = fn(args);
        acciones.push({ herramienta: nombre, argumentos: args, resultado });
        return resultado;
      } catch (error) {
        if (error instanceof ErrorFinanzas) return { error: error.message };
        throw error;
      }
    };

  // "Spotify me cobra 10 dólares": la moneda de la frase manda si el modelo no dijo otra.
  const monedaDicha = (moneda?: string) => {
    const dicha = monedaDelTexto(ctx.textoOriginal);
    return dicha && (!moneda || moneda.toUpperCase() === ctx.monedaBase) ? dicha : moneda;
  };

  return {
    registrar_movimientos: tool({
      description:
        "Registra uno o varios gastos o ingresos. Si el usuario menciona varios, mándalos todos en una sola llamada.",
      inputSchema: z.object({ movimientos: z.array(datosMovimiento).min(1) }),
      execute: ejecutar("registrar_movimientos", ({ movimientos }) => {
        const texto = ctx.textoOriginal;
        // Si la frase dice una sola fecha ("ayer", "el viernes"), esa manda sobre una fecha que el
        // modelo calculó u omitió; los modelos chicos se equivocan al calcularla. Si la frase no
        // habla de ningún momento, una fecha calculada por el modelo es inventada.
        const fechaDicha = fechaDelTexto(texto, ctx.hoy);
        const esIso = (fecha?: string) => !!fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha.trim());
        // "El lunes gasté 80 en café y el martes 120 en el súper": una fecha por movimiento, en orden.
        const fechasDichas = fechasDelTexto(texto, ctx.hoy);
        const enOrden = movimientos.length > 1 && fechasDichas.length === movimientos.length;
        const conFecha = (fecha: string | undefined, i: number) => {
          if (fechaDicha && (!fecha || !resolverFecha(fecha, ctx.hoy) || esIso(fecha))) return fechaDicha;
          if (enOrden && (!fecha || !resolverFecha(fecha, ctx.hoy))) return fechasDichas[i];
          if (texto && esIso(fecha) && !mencionaFecha(texto)) return undefined;
          return fecha;
        };
        // Con un solo movimiento, lo que dice la frase corrige al modelo en lo que suele fallar:
        // "Pagué 20 dólares" (moneda), "mil doscientos cincuenta" (monto) y "cargué 650" (gasto).
        const unico = movimientos.length === 1 && !!texto;
        const monedaDicha = unico ? monedaDelTexto(texto) : undefined;
        const conMoneda = (moneda?: string) =>
          monedaDicha && (!moneda || moneda.toUpperCase() === ctx.monedaBase) ? monedaDicha : moneda;
        const montos = unico && montoConPalabras(texto!) ? montosDelTexto(texto!) : [];
        const montoDicho = montos.length === 1 ? montos[0] : undefined;
        const tipoDicho = unico ? tipoDelTexto(texto) : undefined;
        const conTipo = (tipo: (typeof movimientos)[number]["tipo"]) =>
          tipoDicho && (tipo === "gasto" || tipo === "ingreso") ? tipoDicho : tipo;
        return {
          registrados: movimientos.map((m, i) =>
            crearMovimiento(ctx, {
              ...m,
              tipo: conTipo(m.tipo),
              monto: montoDicho ?? m.monto,
              moneda: conMoneda(m.moneda),
              fecha: conFecha(m.fecha, i),
            }),
          ),
        };
      }),
    }),

    buscar_movimientos: tool({
      description:
        "Busca movimientos registrados, del más reciente al más antiguo. Úsala antes de editar o eliminar para obtener el id.",
      inputSchema: z.object({
        texto: z.string().optional().describe("Comercio o palabra a buscar: café, Uber, Liverpool."),
        categoria: z.string().optional(),
        periodo: periodo.optional(),
        tipo: tipoMovimiento.optional(),
        monto: z.number().optional(),
        limite: z.number().int().optional().describe("Cuántos regresar, 5 por omisión."),
      }),
      execute: ejecutar("buscar_movimientos", (filtro) => buscarMovimientos(ctx, filtro)),
    }),

    editar_movimiento: tool({
      description:
        'Corrige un movimiento ya registrado: "fueron 95, no 85", "lo pagué con la Nu", "fue con la BBVA", "cámbialo a Regalos". Identifícalo con id (si buscar_movimientos ya te lo dio) o con buscar; en cambios manda solo lo nuevo.',
      inputSchema: z.object({
        id: z.string().optional().describe("id, si ya lo tienes"),
        buscar: busqueda.optional(),
        cambios: datosMovimiento.partial().describe("Solo los campos que cambian, con su valor nuevo."),
      }),
      execute: ejecutar("editar_movimiento", ({ id, buscar, cambios }) => ({
        // Un "" del modelo no borra nada: para la IA, vacío es lo mismo que no mandarlo.
        editado: editarMovimiento(
          ctx,
          idDelMovimiento(ctx, id, buscar),
          Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== "")),
        ),
      })),
    }),

    eliminar_movimiento: tool({
      description: "Elimina un movimiento; se puede deshacer. Identifícalo con id o con buscar.",
      inputSchema: z.object({
        id: z.string().optional().describe("id, si ya lo tienes"),
        buscar: busqueda.optional(),
      }),
      execute: ejecutar("eliminar_movimiento", ({ id, buscar }) => ({
        eliminado: eliminarMovimiento(ctx, idDelMovimiento(ctx, id, buscar)),
      })),
    }),

    deshacer: tool({
      description: "Revierte lo último que se hizo (registro, edición o eliminación) cuando el usuario dice deshaz o cancela.",
      inputSchema: z.object({}),
      execute: ejecutar("deshacer", () => deshacer(ctx)),
    }),

    consultar_gastos: tool({
      description:
        "Calcula totales de gastos o ingresos ya registrados en un periodo, con filtros y agrupación. Para suscripciones o pagos fijos usa listar_recurrentes.",
      inputSchema: z.object({
        periodo: periodo.describe("Periodo a consultar; este_mes por omisión."),
        tipo: z.enum(["gasto", "ingreso"]).optional().describe("gasto por omisión"),
        categoria: z.string().optional(),
        texto: z.string().optional().describe("Comercio o palabra: Uber, café."),
        agrupar_por: z.enum(["ninguno", "categoria", "subcategoria", "comercio", "dia"]).optional(),
      }),
      execute: ejecutar("consultar_gastos", ({ agrupar_por, ...filtro }) => {
        const resumen = resumir(ctx, { ...filtro, agruparPor: agrupar_por });
        // Sin gastos registrados, la pregunta suele ser por pagos fijos ("¿cuánto pago de suscripciones?").
        if (resumen.cantidad === 0 && !resumen.otras_monedas && listarRecurrentes(ctx).recurrentes.length > 0) {
          return { ...resumen, nota: "No hay movimientos registrados; si pregunta por pagos fijos o suscripciones, usa listar_recurrentes." };
        }
        return resumen;
      }),
    }),

    registrar_recurrente: tool({
      description:
        "Guarda un cobro o ingreso que se repite (suscripciones, renta, servicios, préstamos, la quincena) para recordatorios. Úsala solo si el usuario dice que se repite (\"cada mes\", \"cada día 15\"); un cobro que ya pasó, como \"Netflix me cobró 219\", se registra con registrar_movimientos.",
      inputSchema: z.object({
        nombre: z.string().describe("Netflix, Renta, Quincena"),
        tipo: tipoRecurrente,
        monto: z.number().positive(),
        moneda: z.string().optional().describe("Solo si no es MXN, por ejemplo USD."),
        frecuencia: z.enum(FRECUENCIAS),
        dia: z.number().int().describe("Día del mes (1-31); en semanal, día de la semana (1 lunes ... 7 domingo)."),
        mes: z.number().int().optional().describe("Solo para anual (1-12)."),
        categoria: z.string().optional(),
        cuenta: z.string().optional(),
      }),
      execute: ejecutar("registrar_recurrente", (datos) => ({
        registrado: crearRecurrente(ctx, { ...datos, moneda: monedaDicha(datos.moneda) }),
      })),
    }),

    editar_recurrente: tool({
      description:
        'Cambia o cancela un cobro o ingreso que se repite: "cancelé Netflix", "Spotify subió a 129", "la renta ahora se paga el día 5".',
      inputSchema: z.object({
        nombre: z.string().describe("Cuál: Netflix, Renta, Quincena"),
        cancelar: z.boolean().optional().describe("true si lo canceló o ya no lo paga"),
        cambios: z
          .object({
            nombre: z.string().optional(),
            monto: z.number().positive().optional(),
            moneda: z.string().optional(),
            frecuencia: z.enum(FRECUENCIAS).optional(),
            dia: z.number().int().optional(),
            mes: z.number().int().optional(),
          })
          .optional()
          .describe("Solo lo que cambia, con su valor nuevo."),
      }),
      execute: ejecutar("editar_recurrente", ({ nombre, cancelar, cambios }) =>
        cancelar
          ? { cancelado: cancelarRecurrente(ctx, nombre) }
          : {
              cambiado: editarRecurrente(ctx, nombre, {
                ...cambios,
                moneda: cambios?.monto !== undefined ? monedaDicha(cambios.moneda) : cambios?.moneda,
              }),
            },
      ),
    }),

    listar_recurrentes: tool({
      description:
        "Lista suscripciones, rentas y otros cobros que se repiten, con su próximo cobro y el total mensual. Úsala para cualquier pregunta sobre suscripciones o pagos fijos.",
      inputSchema: z.object({
        dias: z.number().int().optional().describe("Solo los que se cobran en los próximos N días."),
        tipo: tipoRecurrente.optional(),
      }),
      execute: ejecutar("listar_recurrentes", (opciones) => listarRecurrentes(ctx, opciones)),
    }),
  };
}
