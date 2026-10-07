import { tool } from "ai";
import { z } from "zod";
import type { Contexto } from "../finanzas/contexto";
import {
  abonarPrestamo,
  aportarMeta,
  crearMeta,
  disponible,
  editarMeta,
  eliminarMeta,
  estadoPresupuestos,
  fijarPresupuesto,
  listarMetas,
  listarMsi,
  listarPrestamos,
  quitarPresupuesto,
  registrarMsi,
  registrarPrestamo,
  respuestaDisponible,
} from "../finanzas/planes";
import { formatearMonto } from "../lib/dinero";
import { normalizar } from "../lib/texto";

/** Envuelve una herramienta: guarda la acción y devuelve los errores de validación como texto. */
type Ejecutar = <A, R>(nombre: string, fn: (args: A) => R) => (args: A) => Promise<R | { error: string }>;

// Herramientas que solo leen.
export const CONSULTAS_PLANES = new Set(["consultar_planes"]);
// Herramientas cuyo resultado trae `confirmacion`: lo que se le dice al usuario sin otra vuelta del modelo.
export const ESCRITURAS_PLANES = new Set(["presupuesto", "meta", "prestamo", "compra_msi"]);

const nombreCorto = (categoria: string) => categoria.split(" > ").at(-1)!;

/** Presupuestos, metas, préstamos y meses sin intereses, por voz. */
export function herramientasPlanes(ctx: Contexto, ejecutar: Ejecutar) {
  const $ = (centavos: number) => formatearMonto(centavos, ctx.monedaBase);
  const de = (categoriaId: string | null, categoria: string) => (categoriaId ? `de ${nombreCorto(categoria)}` : "del mes");

  return {
    presupuesto: tool({
      description:
        'Fija, cambia o quita el límite de gasto mensual de una categoría ("mi presupuesto de comida es de 3 mil"). Sin categoría es el general del mes.',
      inputSchema: z.object({
        categoria: z.string().optional(),
        monto: z.number().positive().optional(),
        quitar: z.boolean().optional(),
      }),
      execute: ejecutar("presupuesto", ({ categoria, monto, quitar }) => {
        if (quitar) {
          const quitado = quitarPresupuesto(ctx, { categoria });
          return { quitado, confirmacion: `Listo, quité el presupuesto ${quitado.categoria === "General" ? "del mes" : `de ${nombreCorto(quitado.categoria)}`}.` };
        }
        if (monto === undefined) return { error: "Falta el monto del presupuesto. Pregúntalo." };
        const p = fijarPresupuesto(ctx, { categoria, monto });
        const avance = p.gastadoCentavos > 0 ? ` Este mes llevas ${$(p.gastadoCentavos)}, el ${p.porcentaje}%.` : "";
        return { presupuesto: p, confirmacion: `Listo, tu presupuesto ${de(p.categoriaId, p.categoria)} es de ${$(p.limiteCentavos)} al mes.${avance}` };
      }),
    }),

    meta: tool({
      description:
        'Metas de ahorro: crear ("juntar 20 mil para un viaje en diciembre"), aportar ("aparté 500 para el viaje"), retirar, cambiar o eliminar.',
      inputSchema: z.object({
        accion: z.enum(["crear", "aportar", "retirar", "cambiar", "eliminar"]),
        nombre: z.string().optional().describe("Corto: Viaje, Fondo de emergencia."),
        monto: z.number().positive().optional().describe("Objetivo al crear o cambiar; si no, cuánto aporta o retira."),
        fecha_limite: z.string().optional().describe('"diciembre" o YYYY-MM-DD'),
        nuevo_nombre: z.string().optional(),
      }),
      execute: ejecutar("meta", ({ accion, nombre, monto, fecha_limite, nuevo_nombre }) => {
        if (accion === "crear") {
          if (!nombre) return { error: "Falta el nombre de la meta. Pregunta para qué es." };
          if (monto === undefined) return { error: "Falta cuánto quiere juntar. Pregúntalo." };
          const m = crearMeta(ctx, { nombre, objetivo: monto, fechaLimite: fecha_limite });
          const plazo = m.mensualSugeridoCentavos ? ` Para llegar a tiempo, aparta unos ${$(m.mensualSugeridoCentavos)} al mes.` : "";
          return { meta: m, confirmacion: `Listo, tu meta ${m.nombre} es juntar ${$(m.objetivoCentavos)}.${plazo}` };
        }
        if (accion === "aportar" || accion === "retirar") {
          if (monto === undefined) return { error: "Falta el monto. Pregúntalo." };
          const m = aportarMeta(ctx, { nombre, monto: accion === "retirar" ? -monto : monto });
          const confirmacion = m.recienCompletada
            ? `¡Listo! Con eso completaste tu meta ${m.nombre}: ${$(m.ahorradoCentavos)}.`
            : `Listo, ${accion === "aportar" ? "apartaste" : "sacaste"} ${$(Math.abs(m.aportadoCentavos))}. En ${m.nombre} llevas ${$(m.ahorradoCentavos)} de ${$(m.objetivoCentavos)}, el ${m.porcentaje}%.`;
          return { meta: m, confirmacion };
        }
        if (accion === "eliminar") {
          const e = eliminarMeta(ctx, { nombre });
          return { eliminada: e, confirmacion: `Listo, quité la meta ${e.nombre}.` };
        }
        if (monto === undefined && fecha_limite === undefined && !nuevo_nombre) return { error: "No dijo qué cambiar de la meta." };
        const m = editarMeta(ctx, { nombre, cambios: { objetivo: monto, fechaLimite: fecha_limite, nombre: nuevo_nombre } });
        return { meta: m, confirmacion: `Listo, tu meta ${m.nombre} quedó en ${$(m.objetivoCentavos)}${m.fechaLimite ? ` para el ${m.fechaLimite}` : ""}.` };
      }),
    }),

    prestamo: tool({
      description:
        'Préstamos entre personas: "le presté 500 a Juan" le_preste, "Ana me prestó mil" me_prestaron, "Juan me pagó 200" me_pagaron, "le pagué a Ana" le_pague. Sin monto al pagar, salda todo.',
      inputSchema: z.object({
        accion: z.enum(["le_preste", "me_prestaron", "me_pagaron", "le_pague"]),
        persona: z.string(),
        monto: z.number().positive().optional(),
        descripcion: z.string().optional(),
      }),
      execute: ejecutar("prestamo", ({ accion, persona, monto, descripcion }) => {
        if (accion === "le_preste" || accion === "me_prestaron") {
          if (monto === undefined) return { error: "Falta el monto del préstamo. Pregúntalo." };
          const meDeben = accion === "le_preste";
          const p = registrarPrestamo(ctx, { persona, direccion: meDeben ? "me_deben" : "debo", monto, descripcion });
          const quien = meDeben ? `${p.persona} te debe` : `le debes a ${p.persona}`;
          const total = p.totalPendienteCentavos > p.montoCentavos ? ` En total ${quien} ${$(p.totalPendienteCentavos)}.` : "";
          const que = meDeben ? `le prestaste ${$(p.montoCentavos)} a ${p.persona}` : `${p.persona} te prestó ${$(p.montoCentavos)}`;
          return { prestamo: p, confirmacion: `Listo, anoté que ${que}.${total}` };
        }
        const a = abonarPrestamo(ctx, { persona, monto, direccion: accion === "me_pagaron" ? "me_deben" : "debo" });
        const quien = a.direccion === "me_deben" ? `${a.persona} te debe` : `le debes a ${a.persona}`;
        const confirmacion = a.saldado
          ? `Listo, ${a.direccion === "me_deben" ? `${a.persona} ya no te debe nada` : `ya no le debes nada a ${a.persona}`}.`
          : `Listo, abono de ${$(a.abonadoCentavos)}. Todavía ${quien} ${$(a.pendienteCentavos)}.`;
        return { ...a, confirmacion };
      }),
    }),

    compra_msi: tool({
      description:
        'Compra a meses sin intereses ("pantalla de 12 mil a 12 meses con la BBVA"). Las mensualidades se anotan solas.',
      inputSchema: z.object({
        descripcion: z.string().describe("Qué compró"),
        total: z.number().positive(),
        meses: z.number().int(),
        cuenta: z.string().optional(),
        fecha: z.string().optional().describe("Omítela si fue hoy."),
      }),
      execute: ejecutar("compra_msi", (datos) => {
        const c = registrarMsi(ctx, datos);
        const cuenta = c.cuenta ? ` con ${c.cuenta}` : "";
        return {
          compra: c,
          confirmacion: `Listo, ${c.descripcion} de ${$(c.totalCentavos)} a ${c.meses} meses sin intereses${cuenta}: ${$(c.mensualidadCentavos)} al mes.`,
        };
      }),
    }),

    consultar_planes: tool({
      description:
        '"¿Cuánto puedo gastar hoy?", cómo van sus presupuestos o metas, quién le debe (prestamos) o sus meses sin intereses.',
      inputSchema: z.object({
        que: z.enum(["cuanto_puedo_gastar", "presupuestos", "metas", "prestamos", "msi"]),
        persona: z.string().optional(),
      }),
      execute: ejecutar("consultar_planes", ({ que, persona }) => {
        switch (que) {
          case "cuanto_puedo_gastar": {
            const d = disponible(ctx);
            return {
              respuesta: respuestaDisponible(ctx, d),
              por_dia: $(d.porDiaCentavos),
              te_queda_hoy: $(Math.max(0, d.disponibleHoyCentavos)),
              libre_del_mes: $(d.libreMesCentavos),
              dias_restantes: d.diasRestantes,
            };
          }
          case "presupuestos": {
            const e = estadoPresupuestos(ctx);
            if (!e.presupuestos.length) return { presupuestos: [], nota: "No tiene presupuestos. Puede crearlos diciendo, por ejemplo, \"mi presupuesto de comida es de 3 mil\"." };
            return {
              presupuestos: e.presupuestos.map((p) => ({
                categoria: p.categoriaId ? p.categoria : "General",
                limite: $(p.limiteCentavos),
                gastado: $(p.gastadoCentavos),
                restante: $(p.restanteCentavos),
                porcentaje: p.porcentaje,
                al_cierre_al_ritmo_actual: $(p.proyeccionCentavos),
              })),
              dias_restantes: e.diasDelMes - e.diaDelMes + 1,
            };
          }
          case "metas": {
            const lista = listarMetas(ctx).metas;
            if (!lista.length) return { metas: [], nota: "No tiene metas de ahorro." };
            return {
              metas: lista.map((m) => ({
                nombre: m.nombre,
                objetivo: $(m.objetivoCentavos),
                ahorrado: $(m.ahorradoCentavos),
                porcentaje: m.porcentaje,
                fecha_limite: m.fechaLimite ?? undefined,
                apartar_al_mes: m.mensualSugeridoCentavos ? $(m.mensualSugeridoCentavos) : undefined,
              })),
            };
          }
          case "prestamos": {
            const l = listarPrestamos(ctx, { persona });
            const porPersona = new Map<string, { me_debe: number; le_debe: number }>();
            for (const p of l.prestamos) {
              const x = porPersona.get(p.persona) ?? { me_debe: 0, le_debe: 0 };
              if (p.direccion === "me_deben") x.me_debe += p.pendienteCentavos;
              else x.le_debe += p.pendienteCentavos;
              porPersona.set(p.persona, x);
            }
            return {
              personas: [...porPersona.entries()].map(([nombre, x]) => ({
                persona: nombre,
                le_debe_al_usuario: x.me_debe ? $(x.me_debe) : undefined,
                el_usuario_le_debe: x.le_debe ? $(x.le_debe) : undefined,
              })),
              total_le_deben: $(l.meDebenCentavos),
              total_debe: $(l.deboCentavos),
            };
          }
          case "msi": {
            const l = listarMsi(ctx);
            return {
              compras: l.compras.map((c) => ({
                descripcion: c.descripcion,
                mensualidad: $(c.mensualidadCentavos),
                pagadas: `${c.pagadas} de ${c.meses}`,
                falta_pagar: $(c.restanteCentavos),
                proximo_cargo: c.proximoCargo ?? undefined,
              })),
              total_al_mes: $(l.mensualCentavos),
            };
          }
        }
      }),
    }),
  };
}

/** Nombres de las metas y de las personas con préstamos pendientes, para las instrucciones. */
export function nombresDePlanes(ctx: Contexto) {
  const metas = listarMetas(ctx).metas.filter((m) => !m.completada).map((m) => m.nombre);
  const personas = [...new Set(listarPrestamos(ctx).prestamos.map((p) => p.persona))];
  const msi = listarMsi(ctx).compras.map((c) => ({ descripcion: c.descripcion, proximoCargo: c.proximoCargo }));
  return { metas, personas, msi };
}

const escapar = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** La primera palabra de cada nombre ("Juan" de "Juan Pérez"), ya normalizada y escapada. */
const primeras = (nombres: string[]) =>
  nombres.map((n) => normalizar(n).split(" ")[0] ?? "").filter((p) => p.length > 2).map(escapar);

// Un monto dicho: "500", "2 mil", "mil", "quinientos".
const MONTO = "(\\d|un |una |dos |tres |cuatro |cinco |seis |siete |ocho |nueve |diez |veinte |cien|mil\\b|doscientos|trescientos|quinientos)";
// Para qué fue el dinero ("del corte", "por la comida"): un pago así es un gasto, no un abono. "De los 500" sí habla del préstamo.
const PARA_QUE = /\b(por|del|de la|de los|de las|de un|de una) (?!\d|lo que|la deuda|el prestamo|lo que)\S/;

/**
 * Prestar o pedir prestado dinero, con el monto junto al verbo: "le presté 500 a Juan", "me prestaron
 * 2 mil". "Me prestaron el coche y le eché 500 de gasolina" es un gasto.
 */
export function prestaDinero(texto: string) {
  const plano = normalizar(texto);
  return new RegExp(`\\b((le |les |te )?preste|(me|nos) prest(o|aron|aste))( \\S+){0,3} ${MONTO}|${MONTO}\\S*( \\S+){0,3} (que )?(le |les |te |me |nos )?prest(e|o|aron|aste)\\b`).test(plano);
}

/**
 * Paga o cobra un préstamo que ya existe, con la persona junto al verbo: "Juan me pagó 200",
 * "me devolvió Juan", "le pagué a Ana". "Le pagué la luz" no es Luz, ni "le pagué a Juan 300 del corte".
 */
export function pagaPrestamo(texto: string, personas: string[]) {
  const nombres = primeras(personas);
  if (!nombres.length) return false;
  const plano = normalizar(texto);
  if (PARA_QUE.test(plano)) return false;
  const p = `(${nombres.join("|")})`;
  const verbo = "(pago|pagaron|devolvio|regreso|abono)";
  return new RegExp(`\\b(${p} (ya )?(me|nos) ${verbo}|(me|nos) ${verbo} ${p}|le (pague|abone) a ${p}|le (devolvi|regrese)( \\S+){0,2} a ${p})\\b`).test(plano);
}

/**
 * "Aparté 500 para el viaje", "ahorré mil para la meta": apartar dinero, no gastarlo. "Guardé 200 en
 * el coche" no es la meta Coche.
 */
export function apartaParaMeta(texto: string, metas: string[]) {
  const plano = normalizar(texto);
  if (!/\b(aparte|ahorre|guarde)\b/.test(plano)) return false;
  const nombres = primeras(metas);
  const destino = nombres.length ? `|${nombres.join("|")}` : "";
  return new RegExp(`\\b((para|pa|pal|al|a) (el |la |mi |mis )?(meta${destino})|en (la |mi |mis )?metas?)\\b`).test(plano);
}

/** "Pagué la mensualidad de la pantalla": la compra a meses de la que habla, si es una de las que tiene. */
export function mensualidadDe(texto: string, compras: { descripcion: string; proximoCargo: string | null }[]) {
  const plano = normalizar(texto);
  if (!/\b(mensualidad|mensualidades|meses sin intereses|msi)\b/.test(plano)) return undefined;
  return compras.find((c) =>
    normalizar(c.descripcion)
      .split(" ")
      .filter((w) => w.length > 3)
      .some((w) => new RegExp(`\\b${escapar(w)}\\b`).test(plano)),
  );
}
