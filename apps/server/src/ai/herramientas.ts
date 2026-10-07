import { tool } from "ai";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { FRECUENCIAS, movimientos as tablaMovimientos, TIPOS_RECURRENTE } from "../db/schema";
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
import { pagoDeFrase } from "../finanzas/applepay";
import { listarCategorias } from "../finanzas/catalogos";
import {
  cuentaHabitual,
  cuentaHabitualDeCategoria,
  cuentaRecordada,
  habitoMencionado,
  hablaDeOtroMonto,
  nombreDeCuenta,
} from "../finanzas/habitos";
import { listarMemorias, olvidar, recordar } from "../finanzas/memorias";
import { cancelarRecurrente, crearRecurrente, editarRecurrente, listarRecurrentes } from "../finanzas/recurrentes";
import { fechaDelTexto, fechasDelTexto, mencionaFecha, resolverFecha } from "../lib/fechas";
import { montoConPalabras, montosDelTexto } from "../lib/numeros";
import { apartaParaMeta, herramientasPlanes, mensualidadDe, nombresDePlanes, pagaPrestamo, prestaDinero } from "./herramientas-planes";
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
  monto: z.number().positive().describe("Monto en números, sin signo, nunca 0. 2 mil quinientos = 2500."),
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

// Verbos con que se pide borrar o cambiar algo ya anotado: "borra", "bórrame", "quitar".
const VERBO = String.raw`(borra|elimina|quita|cancela|cambia|corrige|pasa)r?(me)?`;

// La frase señala cuál: "el último", "ese", "bórralo", "el de ahorita"; o dice cuántos: "borra los dos
// cafés" (el modelo los toma uno por uno, del más reciente al más antiguo). Un plural más adelante no
// cuenta: "el café de las tres" es una hora y "lo de los tacos" es uno.
const SENALA_UNO = new RegExp(
  String.raw`\b(ultim[oa]s?|reciente|nuevo|nueva|ahorita|hace rato|ese|esa|eso|este|esta|esto|acabo|${VERBO}(lo|la|melo|mela))\b|\b${VERBO} (los|las) (ultim[oa]s )?(dos|tres|cuatro|cinco|2|3|4|5)\b`,
);

// Pide varios sin decir cuántos: "borra los tacos", "bórralos", "todos", "ambos". Con mas_reciente el
// modelo borraría solo uno; sin él, el error le da el id de cada uno. "Cambia los 300 del súper" son
// pesos, no varios.
const CIFRA = String.raw`(\d|(mil|cien|ciento|\w*cientos|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b)`;
const PIDE_VARIOS = new RegExp(
  String.raw`\b(ambos|ambas|todos|todas|${VERBO}(los|las|melos|melas))\b|\b${VERBO} (los|las) (?!(ultim[oa]s )?(dos|tres|cuatro|cinco)\b|${CIFRA})`,
);

// "A 12 meses sin intereses", "compré unos tenis a 6 meses": no es un gasto de una vez. Pagar una
// mensualidad ("la mensualidad de la pantalla") sí es un gasto.
const ES_MSI = /\b(meses sin intereses|msi)\b|\b(compre|saque|me lleve)\b.*\ba (\d+|tres|seis|nueve|doce|dieciocho|veinticuatro) meses\b(?! con intereses)/;
const PAGA_MENSUALIDAD = /\b(mensualidad|mensualidades|pago de|abono de)\b/;
// "Recuerda que mi último gasto no fue de dólares": corrige un registro, no es un dato para recordar.
const CORRIGE_REGISTRO =
  /\b(no (fue|fueron|era|eran)|ultimo (gasto|registro|movimiento|ingreso)|que (agregamos|anotamos|registramos|apuntamos|anotaste|registraste|apuntaste|agregaste))\b/;

// Algo que se repite: "cada día 15", "cada mes", "mensual", "cada quincena".
const SE_REPITE = /\b(cada|al mes|por mes|a la semana|por semana|al ano|mensual|mensualmente|semanal|quincenal|anual|diario)\b/;

/** Las herramientas que la IA puede usar. Cada una solo toca datos del usuario del contexto. */
/** Cuántos movimientos vigentes dejó ya esta entrada. */
function movimientosDeEntrada(ctx: Contexto, entradaId: string): number {
  return ctx.db
    .select({ id: tablaMovimientos.id })
    .from(tablaMovimientos)
    .where(and(eq(tablaMovimientos.entradaId, entradaId), isNull(tablaMovimientos.eliminadoEn)))
    .all().length;
}

export function crearHerramientas(ctx: Contexto, acciones: Accion[]) {
  // Una frase que parece préstamo, meta o compra a meses se desvía a su herramienta una sola vez: si el
  // modelo insiste en que es un gasto, se registra (la regla puede equivocarse con "me prestaron el coche").
  const desviadas = new Set<string>();
  const desviar = (clave: string, mensaje: string) => {
    if (desviadas.has(clave)) return;
    desviadas.add(clave);
    throw new ErrorFinanzas(`${mensaje} Si de verdad es un gasto o ingreso normal, vuelve a llamar registrar_movimientos igual.`);
  };
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

  // "Borra el café" con varios cafés: el modelo a veces manda mas_reciente aunque la frase no diga cuál.
  // Si nombra algo ("el café") sin señalar uno ("el último", "ese", "bórralo") y coinciden varios, que
  // pregunte; si pidió varios ("borra los tacos"), que use el id de cada uno. "Fueron 70" a secas, sin
  // nombrar nada, sí es lo último que anotó.
  const pideVarios = !!ctx.textoOriginal && PIDE_VARIOS.test(normalizar(ctx.textoOriginal));
  // "Mi último gasto" no es un ingreso que llegó después.
  const tipoDicho = normalizar(ctx.textoOriginal ?? "").match(/\bultimo (gasto|ingreso)\b/)?.[1] as "gasto" | "ingreso" | undefined;
  const comoLoDijo = <B extends { texto?: string; categoria?: string; mas_reciente?: boolean }>(buscar?: B): (B & { tipo?: "gasto" | "ingreso" }) | undefined => {
    if (!buscar) return buscar;
    const nombraAlgo = !!(buscar.texto || buscar.categoria);
    const senala =
      !pideVarios && (ctx.confiarEnMasReciente || !ctx.textoOriginal || SENALA_UNO.test(normalizar(ctx.textoOriginal)));
    const conTipo = tipoDicho ? { ...buscar, tipo: tipoDicho } : buscar;
    return buscar.mas_reciente && nombraAlgo && !senala ? { ...conTipo, mas_reciente: false } : conTipo;
  };

  // "Spotify me cobra 10 dólares": la moneda de la frase manda si el modelo no dijo otra.
  const monedaDicha = (moneda?: string) => {
    const dicha = monedaDelTexto(ctx.textoOriginal);
    return dicha && (!moneda || moneda.toUpperCase() === ctx.monedaBase) ? dicha : moneda;
  };

  return {
    registrar_movimientos: tool({
      description:
        "Registra uno o varios gastos o ingresos. Si el usuario menciona varios, mándalos todos en una sola llamada. " +
        "Llámala solo con un monto que el usuario dijo o uno de sus montos de siempre: si no sabes cuánto fue, pregunta sin llamarla.",
      inputSchema: z.object({
        movimientos: z.array(datosMovimiento).min(1),
        comentario: z
          .string()
          .optional()
          .describe('Solo si los datos traen "Para comentar" y le sirve oírlo: una frase corta para el usuario. Si no, vacío.'),
      }),
      execute: ejecutar("registrar_movimientos", ({ movimientos, comentario }) => {
        if (comentario) ctx.comentario = comentario;
        const texto = ctx.textoOriginal;
        // Un pago de Apple Pay es un gasto, uno solo, con el monto y la moneda que dio la Cartera.
        const pago = ctx.origen === "apple_pay" ? pagoDeFrase(texto) : undefined;
        if (pago) {
          // Aunque el modelo llame dos veces, el pago se anota una.
          if (ctx.entradaId && movimientosDeEntrada(ctx, ctx.entradaId) > 0) {
            throw new ErrorFinanzas("Ese pago ya quedó anotado; no lo registres otra vez.");
          }
          movimientos = [{ ...movimientos[0]!, tipo: "gasto", monto: pago.monto, moneda: pago.moneda }];
        }
        // Préstamos, metas y meses sin intereses tienen su herramienta. Con varios montos en la frase
        // ("200 de tacos y le presté 100 a Juan") puede haber gastos de verdad: ahí no se frena.
        // En un pago de Apple Pay la frase la armó el servidor: "MSI STORE" o "TACOS EL LUNES" son el comercio.
        if (texto && !pago && montosDelTexto(texto).length <= 1) {
          const plano = normalizar(texto);
          const planes = nombresDePlanes(ctx);
          const compra = PAGA_MENSUALIDAD.test(plano) ? mensualidadDe(texto, planes.msi) : undefined;
          if (compra) {
            const cuando = compra.proximoCargo ? `; la próxima es el ${compra.proximoCargo}` : "";
            desviar("msi", `Las mensualidades de ${compra.descripcion} ya se anotan solas el día del cargo${cuando}. No la registres: dile que ya queda anotada sola.`);
          } else if (ES_MSI.test(plano) && !PAGA_MENSUALIDAD.test(plano)) {
            desviar("msi", "Parece una compra a meses sin intereses: usa compra_msi.");
          }
          if (prestaDinero(texto) || pagaPrestamo(texto, planes.personas)) {
            desviar("prestamo", "Parece un préstamo entre personas: usa prestamo.");
          }
          if (apartaParaMeta(texto, planes.metas)) {
            desviar("meta", "Parece dinero apartado para una meta de ahorro: usa meta con accion aportar.");
          }
        }
        // Si la frase dice una sola fecha ("ayer", "el viernes"), esa manda sobre una fecha que el
        // modelo calculó u omitió; los modelos chicos se equivocan al calcularla. Si la frase no
        // habla de ningún momento, una fecha calculada por el modelo es inventada.
        const fechaDicha = pago ? undefined : fechaDelTexto(texto, ctx.hoy);
        const esIso = (fecha?: string) => !!fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha.trim());
        // "El lunes gasté 80 en café y el martes 120 en el súper": una fecha por movimiento, en orden.
        const fechasDichas = pago ? [] : fechasDelTexto(texto, ctx.hoy);
        const enOrden = movimientos.length > 1 && fechasDichas.length === movimientos.length;
        const conFecha = (fecha: string | undefined, i: number) => {
          // El pago es de cuando lo capturó el Atajo (capturado_en), no de una fecha que diga el comercio.
          if (pago) return undefined;
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
        // "Ya pagué Netflix" no dice cuánto: si siempre es lo mismo, ese monto manda sobre uno que
        // el modelo inventó o copió mal.
        // En una conversación el monto puede venir de un turno anterior ("¿de cuánto?" "300" "con la Nu").
        const sinMonto = !!texto && !ctx.enConversacion && montosDelTexto(texto).length === 0 && !hablaDeOtroMonto(texto);
        // Salvo que el monto del modelo venga de algo que el usuario pidió recordar ("mi quincena ahora es de 8 mil").
        const recordado = (monto: number) => listarMemorias(ctx).some((mem) => montosDelTexto(mem.texto).includes(monto));
        const deSiempre = (m: (typeof movimientos)[number], tipo: string) => {
          if (!sinMonto || (tipo !== "gasto" && tipo !== "ingreso") || recordado(m.monto)) return undefined;
          const habito = habitoMencionado(ctx, [m.comercio, m.descripcion, unico ? texto : ""].join(" "), tipo);
          // Si el modelo dice otro comercio, no es ese hábito.
          const otroComercio = habito?.comercio && m.comercio && normalizar(m.comercio) !== normalizar(habito.comercio);
          return habito?.seguro && !otroComercio ? habito : undefined;
        };
        return {
          registrados: movimientos.map((m, i) => {
            const tipo = conTipo(m.tipo);
            const habito = deSiempre(m, tipo);
            const comercio = m.comercio || habito?.comercio;
            // Decir con qué pagó es opcional: se pone sola si pidió recordarlo ("el Oxxo lo pago en efectivo")
            // o si en ese comercio, o en esa categoría, siempre paga con lo mismo.
            const recordada = tipo === "gasto" ? cuentaRecordada(ctx, [comercio, m.categoria, m.descripcion]) : undefined;
            const cuenta =
              m.cuenta ||
              nombreDeCuenta(ctx, habito?.cuentaId ?? null) ||
              (recordada && !recordada.paraTodo ? recordada.cuenta : undefined) ||
              cuentaHabitual(ctx, comercio);
            const cuentaSegunCategoria = (categoriaId: string | null) => {
              if (tipo !== "gasto") return undefined;
              const hoja = categoriaId ? listarCategorias(ctx.db, ctx.usuarioId).find((c) => c.id === categoriaId)?.nombre : undefined;
              const deLaCategoria = hoja ? cuentaRecordada(ctx, [hoja]) : undefined;
              if (deLaCategoria && !deLaCategoria.paraTodo) return deLaCategoria.cuenta;
              return cuentaHabitualDeCategoria(ctx, categoriaId) ?? recordada?.cuenta;
            };
            const registrado = crearMovimiento(ctx, {
              ...m,
              tipo,
              monto: habito ? habito.montoCentavos / 100 : (montoDicho ?? m.monto),
              moneda: habito ? habito.moneda : conMoneda(m.moneda),
              comercio,
              descripcion: m.descripcion || habito?.descripcion,
              categoriaId: !m.categoria && habito?.categoriaId ? habito.categoriaId : undefined,
              cuenta,
              cuentaSegunCategoria,
              fecha: conFecha(m.fecha, i),
            });
            return habito ? { ...registrado, monto_de_siempre: true } : registrado;
          }),
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
          idDelMovimiento(ctx, id, comoLoDijo(buscar), pideVarios),
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
        eliminado: eliminarMovimiento(ctx, idDelMovimiento(ctx, id, comoLoDijo(buscar), pideVarios)),
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

    recordar: tool({
      description:
        'Guarda un dato que el usuario te pide recordar ("recuerda que el Oxxo lo pago en efectivo"). Escríbelo corto y en tercera persona: "Paga el Oxxo en efectivo". Un cobro que se repite con monto ("recuerda que cada día 15 me cobran 199 de Spotify") no va aquí: es registrar_recurrente.',
      inputSchema: z.object({ texto: z.string().describe("Lo que hay que recordar, en una frase corta.") }),
      execute: ejecutar("recordar", ({ texto }) => {
        // "Recuerda que cada día 15 me cobran 199 de Spotify" atrae a recordar, pero es un pago fijo con
        // recordatorio: se le regresa al modelo para que use registrar_recurrente.
        if (ctx.textoOriginal && montosDelTexto(ctx.textoOriginal).length > 0 && SE_REPITE.test(normalizar(ctx.textoOriginal))) {
          throw new ErrorFinanzas("Eso es un cobro o ingreso que se repite: guárdalo con registrar_recurrente, no con recordar.");
        }
        if (ctx.textoOriginal && CORRIGE_REGISTRO.test(normalizar(ctx.textoOriginal))) {
          throw new ErrorFinanzas("Eso corrige algo ya registrado: usa editar_movimiento (o eliminar_movimiento), no recordar.");
        }
        return recordar(ctx, texto);
      }),
    }),

    olvidar: tool({
      description: 'Borra algo que recordabas cuando el usuario lo pide ("olvida lo del Oxxo", "ya no pago en efectivo").',
      inputSchema: z.object({
        buscar: z.string().describe("Palabras de lo que hay que olvidar: Oxxo, efectivo."),
        todas: z.boolean().optional().describe("true si pide olvidar todo lo que coincida."),
      }),
      execute: ejecutar("olvidar", ({ buscar, todas }) => olvidar(ctx, buscar, todas)),
    }),

    ...herramientasPlanes(ctx, ejecutar),

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
