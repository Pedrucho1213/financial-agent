import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { comercios, configuracion, movimientos } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { montosDelTexto } from "../lib/numeros";
import { monedaDelTexto, normalizar } from "../lib/texto";
import { sumarDias } from "../lib/fechas";
import type { Contexto } from "./contexto";
import { hablaDeCuentas } from "./cuentas";

/**
 * Comentario al registrar. Con notificaciones, un registro termina con "Anotado" sin esperar a la IA. De
 * vez en cuando el gasto tiene algo que vale la pena decir ("Ojo, es como 37 veces tu compra típica"): el
 * servidor lo nota antes de llamar a la IA, con cifras exactas, y esa vez el Atajo la espera para decir la
 * confirmación y el comentario. Se dice a lo más dos veces al día.
 *
 * La IA (gemma4 12b) no lo decidía bien: en la Mac, con la costumbre o con la nota ya hecha, comentó 0 de 10,
 * 4 de 10, 0 de 8 y 0 de 12 gastos fuera de lo normal según cómo se le pidiera.
 */
export const MAXIMO_AL_DIA = 2;
const MINIMO_GASTOS = 10;
const MINIMO_DIAS = 7;
const GASTO_ALTO_MINIMO_CENTAVOS = 300_00;
const VECES_DIA_ALTO = 1.5;

// Cuántos comentarios se han dicho hoy, en la base: cada despliegue reinicia el servidor.
const clave = (ctx: Contexto) => `comentarios:${ctx.usuarioId}`;

function dichos(ctx: Contexto) {
  const fila = ctx.db.select().from(configuracion).where(eq(configuracion.clave, clave(ctx))).get();
  const hoy = fila?.valor as { dia?: string; cuantos?: number } | undefined;
  return hoy?.dia === ctx.hoy ? (hoy.cuantos ?? 0) : 0;
}

export function puedeComentar(ctx: Contexto): boolean {
  return ctx.origen !== "apple_pay" && dichos(ctx) < MAXIMO_AL_DIA;
}

export function marcarComentario(ctx: Contexto) {
  const valor = { dia: ctx.hoy, cuantos: dichos(ctx) + 1 };
  ctx.db.insert(configuracion).values({ clave: clave(ctx), valor }).onConflictDoUpdate({ target: configuracion.clave, set: { valor } }).run();
}

function gastosEntre(ctx: Contexto, desde: string, hasta: string) {
  return ctx.db
    .select({ montoCentavos: movimientos.montoCentavos, fecha: movimientos.fecha, comercio: comercios.nombre })
    .from(movimientos)
    .leftJoin(comercios, eq(comercios.id, movimientos.comercioId))
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        isNull(movimientos.eliminadoEn),
        eq(movimientos.tipo, "gasto"),
        eq(movimientos.moneda, ctx.monedaBase),
        gte(movimientos.fecha, desde),
        lt(movimientos.fecha, hasta),
      ),
    )
    .all();
}

function mediana(valores: number[]) {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio]! : (orden[medio - 1]! + orden[medio]!) / 2;
}

// Redondeado a lo que se diría en voz: "como $350", no "$347.25".
const redondo = (centavos: number) => {
  const paso = centavos >= 1000_00 ? 100_00 : centavos >= 100_00 ? 10_00 : 100;
  return Math.round(centavos / paso) * paso;
};

/**
 * Lo que tiene de raro el gasto que se dicta, como frase lista para decirse: un monto mucho más alto que
 * lo normal, el día que se dispara o un lugar al que va más que de costumbre. Sin nada que notar, sin
 * historial suficiente o con el tope del día alcanzado, no hay nada y el Atajo no espera a la IA.
 */
export function notaDelGasto(ctx: Contexto, texto: string): string | undefined {
  if (!puedeComentar(ctx)) return undefined;
  // "Tengo 20 mil en Revolut" no es un gasto alto: es cuánto hay en la cuenta.
  if (hablaDeCuentas(texto)) return undefined;
  const moneda = monedaDelTexto(texto);
  if (moneda && moneda !== ctx.monedaBase) return undefined;
  const montos = montosDelTexto(texto);
  const monto = Math.round(montos.reduce((s, n) => s + n, 0) * 100);
  // "Café 60, gasolina 800 y súper 1,300" son tres compras: solo cuentan juntas para el día.
  const unaCompra = montos.length === 1;
  if (monto <= 0) return undefined;
  const previos = gastosEntre(ctx, sumarDias(ctx.hoy, -60), ctx.hoy);
  if (previos.length < MINIMO_GASTOS) return undefined;
  const hoy = gastosEntre(ctx, ctx.hoy, sumarDias(ctx.hoy, 1));
  const m = (c: number) => formatearMonto(redondo(c), ctx.monedaBase);
  const plano = normalizar(texto);
  // El lugar que menciona, si ya fue antes: "café 85 en Starbucks".
  const enElLugar = (g: { comercio: string | null }) => !!g.comercio && normalizar(g.comercio).length >= 3 && plano.includes(normalizar(g.comercio));
  const delLugar = previos.filter(enElLugar);
  // El nombre de un comercio de Apple Pay lo escribe un tercero: corto y en una línea.
  const lugar = [...delLugar, ...hoy.filter(enElLugar)][0]?.comercio?.replace(/[\s"“”]+/g, " ").trim().slice(0, 40);
  const notas: string[] = [];

  const conocido = delLugar.length >= 3;
  const tipica = mediana((conocido ? delLugar : previos).map((g) => g.montoCentavos));
  const veces = Math.floor(monto / tipica);
  if (unaCompra && monto >= GASTO_ALTO_MINIMO_CENTAVOS && veces >= (conocido ? 2 : 3)) {
    notas.push(
      conocido
        ? `Ojo, es como ${veces} veces lo que sueles gastar en ${lugar}, que es como ${m(tipica)}.`
        : `Ojo, es como ${veces} veces tu compra típica, que es como ${m(tipica)}.`,
    );
  }
  const porDia = new Map<string, number>();
  for (const g of previos.filter((g) => g.fecha >= sumarDias(ctx.hoy, -30))) porDia.set(g.fecha, (porDia.get(g.fecha) ?? 0) + g.montoCentavos);
  // El súper de la semana dispara el día, pero es lo de siempre en ese lugar: eso no se nota. Y si el gasto
  // ya es alto por sí solo, con decir eso basta.
  const deSiempreAhi = unaCompra && conocido && monto <= 1.5 * tipica;
  if (porDia.size >= MINIMO_DIAS && !deSiempreAhi && notas.length === 0) {
    const normal = [...porDia.values()].reduce((s, v) => s + v, 0) / porDia.size;
    const antes = hoy.reduce((s, g) => s + g.montoCentavos, 0);
    if (antes < VECES_DIA_ALTO * normal && antes + monto >= VECES_DIA_ALTO * normal) {
      notas.push(`Con esto llevas ${formatearMonto(antes + monto, ctx.monedaBase)} hoy, y un día normal gastas como ${m(normal)}.`);
    }
  }
  // Ir seguido no tiene nada de raro si siempre va así: se compara con su semana de costumbre ahí.
  const haceUnaSemana = sumarDias(ctx.hoy, -6);
  const enLaSemana = [...delLugar.filter((g) => g.fecha >= haceUnaSemana), ...hoy.filter(enElLugar)].length + 1;
  const antesDeLaSemana = delLugar.filter((g) => g.fecha < haceUnaSemana);
  // Por semana, contando desde su primer registro (no hay 60 días de historial en una cuenta nueva).
  const desde = previos.reduce((min, g) => (g.fecha < min ? g.fecha : min), haceUnaSemana);
  const semanas = Math.max(1, (Date.parse(haceUnaSemana) - Date.parse(desde)) / (7 * 86_400_000));
  const porSemana = antesDeLaSemana.length / semanas;
  if (unaCompra && lugar && enLaSemana >= 4 && enLaSemana >= 1.5 * porSemana) notas.push(`Es tu vez número ${enLaSemana} en ${lugar} esta semana.`);

  return notas[0];
}

// Gastos que se esperan aunque salgan altos: no se comentan.
const ESPERABLES = new Set(["vivienda", "salud", "educacion", "suscripciones", "comisiones e intereses", "super", "gasolina", "casetas", "estacionamiento"]);

/** Si el gasto anotado ("Comida > Súper", "Salud > Médico") es de los que se esperan. */
export function esEsperable(categoria: string | undefined): boolean {
  return !!categoria && categoria.split(">").some((parte) => ESPERABLES.has(normalizar(parte)));
}
