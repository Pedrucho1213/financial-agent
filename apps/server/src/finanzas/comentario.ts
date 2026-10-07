import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { comercios, configuracion, movimientos } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { normalizar } from "../lib/texto";
import { sumarDias } from "../lib/fechas";
import type { Contexto } from "./contexto";
import { estadoPresupuestos } from "./planes";

/**
 * Comentario al registrar. Al anotar un gasto, la IA decide si vale la pena decir algo más ("Ojo, es mucho
 * más de lo que sueles gastar por compra") y lo manda en `comentario` de registrar_movimientos. Para que no
 * invente, recibe la costumbre del usuario con cifras ya calculadas y el servidor descarta un comentario
 * con cifras que no estén ahí. Se dice a lo más dos veces al día: "de vez en cuando".
 */
export const MAXIMO_AL_DIA = 2;
const MINIMO_GASTOS = 10;
const MINIMO_DIAS = 7;
const LARGO_MAXIMO = 160;

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
 * Lo que la IA necesita para decidir si un registro merece comentario, con las cifras ya hechas. Sin
 * historial suficiente o si ya se comentó lo del día, no hay nada (y no se comenta).
 */
export function costumbreParaLaIA(ctx: Contexto): string | undefined {
  if (!puedeComentar(ctx)) return undefined;
  const previos = gastosEntre(ctx, sumarDias(ctx.hoy, -60), ctx.hoy);
  if (previos.length < MINIMO_GASTOS) return undefined;
  const m = (c: number) => formatearMonto(redondo(c), ctx.monedaBase);
  const lineas = [`- Compra típica: como ${m(mediana(previos.map((g) => g.montoCentavos)))}.`];
  const porDia = new Map<string, number>();
  for (const g of previos.filter((g) => g.fecha >= sumarDias(ctx.hoy, -30))) porDia.set(g.fecha, (porDia.get(g.fecha) ?? 0) + g.montoCentavos);
  const hoy = gastosEntre(ctx, ctx.hoy, sumarDias(ctx.hoy, 1));
  if (porDia.size >= MINIMO_DIAS) {
    lineas.push(`- Un día normal gasta como ${m([...porDia.values()].reduce((s, v) => s + v, 0) / porDia.size)}.`);
    lineas.push(`- Hoy lleva ${formatearMonto(hoy.reduce((s, g) => s + g.montoCentavos, 0), ctx.monedaBase)} antes de esto.`);
  }
  // "Es tu cuarto Starbucks de la semana": cuántas veces fue a cada lugar en los últimos 7 días.
  const semana = [...previos.filter((g) => g.fecha >= sumarDias(ctx.hoy, -6)), ...hoy];
  const veces = new Map<string, number>();
  // El nombre de un comercio de Apple Pay lo escribe un tercero: corto y en una línea.
  const nombre = (c: string) => c.replace(/[\s"“”]+/g, " ").trim().slice(0, 40);
  for (const g of semana) if (g.comercio) veces.set(nombre(g.comercio), (veces.get(nombre(g.comercio)) ?? 0) + 1);
  const frecuentes = [...veces].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (frecuentes.length) lineas.push(`- Esta semana: ${frecuentes.map(([c, n]) => `${c} ${n} veces`).join(", ")}.`);
  const apretados = estadoPresupuestos(ctx).presupuestos.filter((p) => p.porcentaje >= 60);
  if (apretados.length) {
    lineas.push(`- Presupuestos del mes: ${apretados.map((p) => `${p.categoria.split(" > ").at(-1)} va en ${p.porcentaje}%`).join(", ")}.`);
  }
  return `Su costumbre (solo para decidir si comentas algo al registrar un gasto):\n${lineas.join("\n")}`;
}

// Una cifra en palabras ("diez veces", "el triple", "tu quinta vez") no se puede comparar con las fuentes.
const CIFRA_EN_PALABRAS =
  /\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|cien|ciento|cientos|mil|doble|triple|cuadruple|mitad|tercera|cuarta|quinta|sexta|septima|octava|novena|decima|tercer|cuarto|quinto|sexto|septimo|octavo|noveno|decimo)\b/;

const cifras = (texto: string) => (texto.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));

/**
 * El comentario que propuso la IA, si se puede decir: una frase corta, sin preguntas (dejaría el micrófono
 * abierto) y sin cifras que no vengan de su costumbre, del dictado o de lo que se anotó.
 */
export function comentarioValido(ctx: Contexto, propuesto: string | undefined, fuentes: string[]): string | undefined {
  const texto = propuesto?.replace(/\s+/g, " ").trim();
  if (!texto || !puedeComentar(ctx) || texto.includes("?") || texto.length > LARGO_MAXIMO) return undefined;
  if (CIFRA_EN_PALABRAS.test(normalizar(texto))) return undefined;
  const conocidas = new Set(fuentes.flatMap(cifras));
  if (!cifras(texto).every((n) => conocidas.has(n))) return undefined;
  return /[.!]$/.test(texto) ? texto : `${texto}.`;
}
