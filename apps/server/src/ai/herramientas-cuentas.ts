import { tool } from "ai";
import { z } from "zod";
import { TIPOS_CUENTA } from "../db/schema";
import { enLista } from "../finanzas/catalogos";
import type { Contexto } from "../finanzas/contexto";
import {
  confirmarCuentas,
  describirSaldo,
  estadosDeCuentas,
  fijarCuenta,
  moverDinero,
  NOMBRE_TIPO,
  observacionDeCuentas,
  totalesDeCuentas,
} from "../finanzas/cuentas";
import {
  activarEtiqueta,
  desactivarEtiqueta,
  eliminarEtiqueta,
  etiquetar,
  renombrarEtiqueta,
  respuestaEtiqueta,
  resumenEtiquetas,
} from "../finanzas/etiquetas";
import { buscarMovimientos, ErrorFinanzas, idDelMovimiento, idsQueCoinciden } from "../finanzas/movimientos";
import { cuentaMencionada, encontrarOCrearCuenta, inferirTipoCuenta } from "../finanzas/catalogos";
import { montosDelTexto } from "../lib/numeros";
import { formatearMonto } from "../lib/dinero";
import { resolverPeriodo } from "../lib/fechas";
import { monedaDelTexto, normalizar } from "../lib/texto";

type Ejecutar = <A, R>(nombre: string, fn: (args: A) => R) => (args: A) => Promise<R | { error: string }>;

// Herramientas que solo leen.
export const CONSULTAS_CUENTAS = new Set(["consultar_cuentas"]);
// Herramientas cuyo resultado trae `confirmacion`: lo que se dice sin otra vuelta del modelo.
export const ESCRITURAS_CUENTAS = new Set(["cuentas", "mover_dinero", "etiqueta"]);

// Cómo se dice la moneda de un saldo que no está en pesos.
const NOMBRE_MONEDA: Record<string, string> = { USD: "dólares", EUR: "euros", GBP: "libras", JPY: "yenes", MXN: "pesos" };

const monto = (que: string) => z.number().describe(`${que}, en números: 20 mil = 20000.`);

// Palabras que no distinguen unos movimientos de otros al etiquetar: "ponle viaje a los gastos de la semana".
const SIN_FILTRO = new Set("gasto gastos movimiento movimientos compra compras cosas todo todos todas esos esas eso los las del que mis pago pagos".split(" "));
// Más de esto de un jalón se pregunta antes: una frase ambigua no debe etiquetar todo el historial.
const MUCHOS_PARA_ETIQUETAR = 30;

// Sin cifra en la frase vale si pagó todo ("pagué el total de la Nu") o confirma lo que se le preguntó.
const SIN_CIFRA_VALE = /\b(total|completo|completa|todo lo que debo|todo)\b|^(si|correcto|exacto|eso|asi es|andale|va|ok|okay|claro)\b/;

/** Cuentas y tarjetas con su saldo, dinero que se mueve entre ellas y etiquetas, por voz. */
export function herramientasCuentas(ctx: Contexto, ejecutar: Ejecutar) {
  const $ = (centavos: number) => formatearMonto(centavos, ctx.monedaBase);

  return {
    cuentas: tool({
      description:
        'Guarda lo que dice de sus cuentas y tarjetas: cuánto tiene ("tengo 20 mil en Revolut y 10 mil en Bancomer"), el disponible, el límite o lo que debe de una tarjeta de crédito, su día de corte o de pago, o crea una cuenta. Una entrada por cuenta, todas en una llamada. No es un gasto ni un ingreso.',
      inputSchema: z.object({
        cuentas: z
          .array(
            z.object({
              cuenta: z.string().describe("Cómo la nombró: Revolut, Bancomer, la Nu, mi tarjeta de crédito, efectivo."),
              tipo: z.enum(TIPOS_CUENTA).optional().describe("Solo si lo dijo: debito, credito, efectivo..."),
              saldo: monto("Dinero que tiene en esa cuenta (débito, ahorro, efectivo)").optional(),
              disponible: monto("Tarjeta de crédito: lo que todavía puede gastar").optional(),
              deuda: monto('Tarjeta de crédito: lo que debe o tiene "ocupado"').optional(),
              limite: monto("Tarjeta de crédito: su límite de crédito").optional(),
              dia_corte: z.number().int().optional().describe("Tarjeta de crédito: día del mes en que corta."),
              dia_pago: z.number().int().optional().describe("Tarjeta de crédito: día límite de pago."),
              nuevo_nombre: z.string().optional().describe("Solo si pide renombrarla."),
            }),
          )
          .min(1),
      }),
      execute: ejecutar("cuentas", ({ cuentas: dichas }) => {
        let cuentas = dichas;
        // "Tengo 5 mil": si dijo la cifra pero no la cuenta, el modelo no la elige por él.
        const texto = ctx.textoOriginal;
        if (texto && montosDelTexto(texto).length) {
          // "Mi tarjeta de crédito" con una sola tarjeta: el modelo puede llamarla por su nombre.
          const unicaDelTipo = (nombre: string) => {
            const tipo = inferirTipoCuenta(texto);
            const cuenta = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, nombre, { soloExistente: true, siAmbigua: "ninguna", soloLeer: true });
            return tipo !== "otra" && cuenta?.tipo === tipo && estadosDeCuentas(ctx).filter((e) => e.tipo === tipo).length === 1;
          };
          const nombradas = cuentas.filter((c) => cuentaMencionada(texto, c.cuenta) || unicaDelTipo(c.cuenta));
          // "Ahora tengo 18 mil en Revolut": el modelo a veces repite las otras que ya conoce (QA-086); esas se
          // quedan como estaban. Sin ninguna nombrada, solo vale si contesta una pregunta ("¿en cuál?" → "son 5 mil").
          if (nombradas.length) cuentas = nombradas;
          else if (!ctx.enConversacion) throw new ErrorFinanzas(`No dijo en qué cuenta o tarjeta: pregúntale dónde (no la elijas tú, no era "${cuentas[0]!.cuenta}").`);
        }
        // "Tengo 300 dólares en Wise": los saldos se llevan en pesos; no se guardan 300 pesos (QA-087). Con pesos
        // en la misma frase ("y 10 mil en Bancomer"), esos sí se guardan: en otra moneda va solo la cifra dicha junto
        // a ella.
        const cifras = (c: (typeof cuentas)[number]) => [c.saldo, c.disponible, c.deuda, c.limite].filter((x) => x !== undefined);
        const moneda = monedaDelTexto(texto);
        let enOtra: typeof cuentas = [];
        let cifraEnOtra: number | undefined;
        if (texto && moneda && moneda !== ctx.monedaBase) {
          const dichas = normalizar(texto)
            .split(/,|;|\by\b/)
            .filter((parte) => monedaDelTexto(parte) === moneda)
            .flatMap((parte) => montosDelTexto(parte));
          enOtra = cuentas.filter((c) => cifras(c).some((x) => dichas.includes(x)));
          // "300 en Wise, en dólares": la cifra no va junto a la moneda; todas las que traen cifra.
          if (!enOtra.length) enOtra = cuentas.filter((c) => cifras(c).length);
          cifraEnOtra = dichas[0] ?? cifras(enOtra[0] ?? cuentas[0]!)[0];
        }
        const sinMoneda = enOtra.map((c) => fijarCuenta(ctx, { cuenta: c.cuenta, tipo: c.tipo }));
        const resultados = cuentas
          .filter((c) => !enOtra.includes(c))
          .map((c) =>
            fijarCuenta(ctx, {
              cuenta: c.cuenta,
              tipo: c.tipo,
              saldo: c.saldo,
              disponible: c.disponible,
              deuda: c.deuda,
              limite: c.limite,
              diaCorte: c.dia_corte,
              diaPago: c.dia_pago,
              nuevoNombre: c.nuevo_nombre,
            }),
          );
        // Cuántas cifras usó: si la frase trae más, quizá falta algo y el modelo debe seguir.
        const montos = cuentas.reduce(
          (n, c) => n + [c.saldo, c.disponible, c.deuda, c.limite, c.dia_corte, c.dia_pago].filter((x) => x !== undefined).length,
          0,
        );
        const pregunta = sinMoneda.length
          ? `Llevo tus cuentas en pesos y no sé a cuánto cambiarlos. ¿Cuántos pesos son tus ${new Intl.NumberFormat("es-MX").format(cifraEnOtra!)} ${NOMBRE_MONEDA[moneda!] ?? moneda} en ${enLista(sinMoneda.map((r) => r.estado.nombre))}?`
          : "";
        return {
          cuentas: [...resultados, ...sinMoneda].map((r) => ({ nombre: r.estado.nombre, tipo: r.estado.tipo, nueva: r.nueva || undefined })),
          montos,
          confirmacion: [resultados.length ? confirmarCuentas(ctx, resultados) : "", pregunta].filter(Boolean).join(" "),
        };
      }),
    }),

    mover_dinero: tool({
      description:
        'Dinero que cambia de lugar entre sus propias cuentas, sin ser gasto ni ingreso: transferencias ("pasé 2 mil de BBVA a Revolut"), pagos o abonos a una tarjeta de crédito ("le pagué 5 mil a la Nu", "abono a la tarjeta"), retiros de cajero ("saqué mil del cajero") y disposiciones de efectivo de una tarjeta. Si el dinero fue a otra persona no es esto: es un gasto o un préstamo.',
      inputSchema: z.object({
        tipo: z.enum(["transferencia", "pago_tarjeta", "retiro"]).describe("pago_tarjeta para pagar o abonar a una tarjeta de crédito; retiro para sacar efectivo."),
        monto: z.number().positive(),
        desde: z.string().optional().describe("De qué cuenta salió el dinero, si lo dijo."),
        hacia: z.string().optional().describe("A qué cuenta o tarjeta llegó: la tarjeta que pagó, la cuenta a la que transfirió."),
        fecha: z.string().optional().describe("Omítela si fue hoy."),
        descripcion: z.string().optional(),
      }),
      execute: ejecutar("mover_dinero", (datos) => {
        // "Pagué la tarjeta" sin cifra: se pregunta, no se toma lo que debe ni otra cifra.
        const texto = ctx.textoOriginal;
        if (texto && !montosDelTexto(texto).length && !SIN_CIFRA_VALE.test(normalizar(texto))) {
          throw new ErrorFinanzas("No dijo cuánto: pregúntale de cuánto fue (no uses lo que debe ni otra cifra).");
        }
        const r = moverDinero(ctx, datos);
        return { movimiento: r.movimiento, confirmacion: r.confirmacion };
      }),
    }),

    consultar_cuentas: tool({
      description:
        '"¿Cuánto tengo en Revolut?", "¿cuánto dinero tengo?", "¿cuánto debo de tarjetas?", "¿cuánto me queda disponible en la Nu?". Saldos de hoy de sus cuentas y tarjetas. Solo para cuánto tiene, debe o le queda disponible: "¿cómo voy?" o cuánto ha gastado no es esto.',
      inputSchema: z.object({ cuenta: z.string().optional().describe("Una cuenta o tarjeta; sin ella, todas.") }),
      execute: ejecutar("consultar_cuentas", ({ cuenta }) => {
        const todas = estadosDeCuentas(ctx);
        if (cuenta) {
          const encontrada = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, cuenta, { siAmbigua: "error", soloExistente: true, soloLeer: true });
          const e = encontrada && todas.find((x) => x.id === encontrada.id);
          if (!e) {
            return {
              respuesta: `No tengo registrada ${cuenta}. Si quieres, dime cuánto tienes ahí: "tengo tanto en ${cuenta}".`,
              cuentas: todas.map((x) => x.nombre),
            };
          }
          const texto = describirSaldo(ctx, e);
          const nota = observacionDeCuentas(ctx, [e]);
          return {
            respuesta: e.conocido
              ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}.${nota ? ` ${nota}` : ""}`
              : `No sé cuánto tienes en ${e.nombre}. Dime "tengo tanto en ${e.nombre}" y desde ahí le sigo la cuenta.`,
          };
        }
        if (!todas.length) {
          return { respuesta: 'Todavía no me has dicho tus cuentas. Dime, por ejemplo, "tengo 20 mil en Revolut y 10 mil en Bancomer".' };
        }
        const t = totalesDeCuentas(todas);
        const partes: string[] = [];
        if (t.cuentasConSaldo) partes.push(`tienes ${$(t.dineroCentavos)} en tus cuentas`);
        if (t.tarjetasConDeuda) partes.push(t.deudaCentavos > 0 ? `debes ${$(t.deudaCentavos)} en tarjetas` : "no debes nada en tarjetas");
        const credito = todas.filter((e) => e.esCredito && e.disponibleCentavos !== null);
        if (credito.length) partes.push(`te quedan ${$(t.disponibleCreditoCentavos)} de crédito disponible`);
        const sinSaldo = t.sinSaldo.length ? ` De ${enLista(t.sinSaldo)} no sé cuánto tienes.` : "";
        const detalle = todas.filter((e) => e.conocido).map((e) => describirSaldo(ctx, e));
        const nota = observacionDeCuentas(ctx, todas);
        const respuesta = partes.length
          ? `${enLista(partes).replace(/^./, (x) => x.toUpperCase())}.${detalle.length > 1 && detalle.length <= 3 ? ` ${enLista(detalle).replace(/^./, (x) => x.toUpperCase())}.` : ""}${nota ? ` ${nota}` : ""}${sinSaldo}`
          : `No sé cuánto tienes en ${enLista(t.sinSaldo)}. Dime "tengo tanto en ${t.sinSaldo[0]}" y desde ahí le sigo la cuenta.`;
        return {
          respuesta,
          cuentas: todas.map((e) => ({
            nombre: e.nombre,
            tipo: NOMBRE_TIPO[e.tipo],
            saldo: e.esCredito || e.saldoCentavos === null ? undefined : $(e.saldoCentavos),
            debe: e.deudaCentavos === null ? undefined : $(e.deudaCentavos),
            disponible: e.esCredito && e.disponibleCentavos !== null ? $(e.disponibleCentavos) : undefined,
            limite: e.limiteCentavos === null ? undefined : $(e.limiteCentavos),
            saldo_desconocido: !e.conocido || undefined,
          })),
        };
      }),
    }),

    etiqueta: tool({
      description:
        'Etiquetas que agrupan movimientos de cualquier categoría ("viaje a Oaxaca", "trabajo", "boda de Ana"). poner o quitar una etiqueta en lo ya anotado ("etiqueta como viaje lo de este fin de semana"); activar para que los gastos de unos días la lleven solos ("estoy de viaje en Oaxaca hasta el domingo"); desactivar ("ya regresé del viaje"); consultar cuánto lleva; renombrar o eliminar.',
      inputSchema: z.object({
        accion: z.enum(["poner", "quitar", "activar", "desactivar", "consultar", "renombrar", "eliminar"]),
        etiqueta: z.string().describe("Corta: Viaje Oaxaca, Trabajo."),
        periodo: z.string().optional().describe("poner/quitar: de qué días (hoy, ayer, esta_semana, este_mes, YYYY-MM-DD..YYYY-MM-DD)."),
        texto: z.string().optional().describe("poner/quitar: solo los de este comercio o palabra (Uber, hotel)."),
        mas_reciente: z.boolean().optional().describe('poner/quitar: true si habla de "el último" o "eso".'),
        cantidad: z.number().int().positive().optional().describe('poner/quitar: "los últimos 3 gastos" → 3.'),
        confirmado: z.boolean().optional().describe("Solo cuando ya le preguntaste si de verdad son todos esos movimientos y dijo que sí."),
        hasta: z.string().optional().describe('activar: hasta qué día ("domingo", YYYY-MM-DD).'),
        desde: z.string().optional().describe("activar: desde qué día, si no es hoy."),
        nuevo_nombre: z.string().optional(),
      }),
      execute: ejecutar("etiqueta", ({ accion, etiqueta, periodo, texto: dicho, mas_reciente, cantidad, confirmado, hasta, desde, nuevo_nombre }) => {
        // "Gastos", "lo de la": sin una palabra que distinga, no es un filtro (si no, etiqueta todo el historial).
        const texto = dicho && normalizar(dicho).split(/\s+/).some((p) => p.length >= 3 && !SIN_FILTRO.has(p)) ? dicho : undefined;
        switch (accion) {
          case "activar": {
            const r = activarEtiqueta(ctx, { nombre: etiqueta, desde, hasta });
            const ya = r.yaAnotados ? ` También se la puse a ${r.yaAnotados === 1 ? "un gasto" : `${r.yaAnotados} gastos`} de esos días.` : "";
            return { ...r, confirmacion: `Listo, hasta el ${r.hasta} todo lo que gastes lleva la etiqueta ${r.etiqueta}.${ya}` };
          }
          case "desactivar": {
            const r = desactivarEtiqueta(ctx, etiqueta);
            return { ...r, confirmacion: `Listo, ya no pongo sola la etiqueta ${r.etiqueta}.` };
          }
          case "renombrar": {
            if (!nuevo_nombre) return { error: "Falta el nombre nuevo. Pregúntalo." };
            const r = renombrarEtiqueta(ctx, etiqueta, nuevo_nombre);
            return { etiqueta: r.nombre, confirmacion: `Listo, la etiqueta ahora se llama ${r.nombre}.` };
          }
          case "eliminar": {
            const r = eliminarEtiqueta(ctx, { nombre: etiqueta });
            return { ...r, confirmacion: `Listo, borré la etiqueta ${r.etiqueta}.` };
          }
          case "consultar": {
            const p = periodo ? resolverPeriodo(periodo, ctx.hoy) : null;
            if (periodo && !p) return { error: `No entendí el periodo "${periodo}".` };
            const lista = resumenEtiquetas(ctx, p ?? {});
            const clave = normalizar(etiqueta);
            const r =
              lista.find((e) => normalizar(e.nombre) === clave) ??
              lista.find((e) => normalizar(e.nombre).includes(clave) || clave.includes(normalizar(e.nombre)));
            if (!r) {
              return {
                respuesta: lista.length ? `No tienes la etiqueta ${etiqueta}. Tienes ${enLista(lista.map((e) => e.nombre))}.` : "Todavía no tienes etiquetas.",
              };
            }
            return { respuesta: respuestaEtiqueta(ctx, r), gastado: $(r.gastadoCentavos), cantidad: r.cantidad };
          }
          default: {
            const quitar = accion === "quitar";
            // "Eso" o "el último": uno. Si no, todos los del periodo o con esa palabra.
            // Poner una etiqueta es para gastos, salvo que hable de un ingreso en particular ("el último", "eso").
            const tipo = quitar ? undefined : "gasto";
            const ids = cantidad
              ? buscarMovimientos(ctx, { texto, periodo: periodo ?? "todo", tipo, limite: cantidad }).movimientos.map((m) => m.id)
              : mas_reciente || (!periodo && !texto)
                ? [idDelMovimiento(ctx, undefined, { texto, periodo: periodo ?? "ultimos_30_dias", mas_reciente: true, tipo: mas_reciente ? undefined : tipo })]
                : idsQueCoinciden(ctx, { texto, periodo, tipo });
            if (ids.length > MUCHOS_PARA_ETIQUETAR && !confirmado) {
              return { error: `Son ${ids.length} movimientos. Pregúntale si de verdad son todos (y si dice que sí, vuelve a llamar con confirmado: true) o de qué periodo.` };
            }
            const r = etiquetar(ctx, { nombre: etiqueta, ids, quitar });
            if (!r.cambiados) {
              throw new ErrorFinanzas(quitar ? `Ninguno de esos tenía la etiqueta ${r.etiqueta}.` : `No encontré movimientos para etiquetar como ${r.etiqueta}, o ya la tenían.`);
            }
            const cuantos = r.cambiados === 1 ? "un movimiento" : `${r.cambiados} movimientos`;
            return {
              ...r,
              confirmacion: quitar ? `Listo, le quité la etiqueta ${r.etiqueta} a ${cuantos}.` : `Listo, etiqueté ${cuantos} como ${r.etiqueta}${r.cambiados > 1 && r.centavos ? `, ${$(r.centavos)} en total` : ""}.`,
            };
          }
        }
      }),
    }),
  };
}
