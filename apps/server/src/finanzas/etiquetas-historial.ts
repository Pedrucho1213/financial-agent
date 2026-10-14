// Pone las etiquetas automáticas (viaje e innecesario) a los movimientos que ya estaban anotados. Solo agrega:
// no cambia montos, cuentas, categorías ni fechas, y no pasa por la bitácora, para que un "deshaz eso" por voz
// no lo confunda con lo último que dijo. Lo que agregó queda en `configuracion` y `deshacerEtiquetado` lo quita.
import { and, eq, isNull, like, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { comercios, configuracion, etiquetas, movimientos } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { normalizar } from "../lib/texto";
import { listarCategorias } from "./catalogos";
import type { Contexto } from "./contexto";
import { casa, ciudadCercana, distanciaKm, INNECESARIO, innecesarioRechazado, KM_DE_VIAJE, NOMBRES_MES } from "./etiquetas-auto";

type Mov = typeof movimientos.$inferSelect;
export type Agregado = { movimientoId: string; etiqueta: string; motivo: "viaje" | "innecesario" | "contexto"; quePaso: string };

const DIAS_MISMO_VIAJE = 30;
// Lo que nunca es innecesario: se paga para vivir, moverse o pagar deudas, o ya lo cuida otra parte de la app.
const NUNCA_INNECESARIO = new Set(["vivienda", "salud", "transporte", "educacion", "mascotas", "comisiones e intereses", "suscripciones", "super"]);

function gastos(ctx: Contexto): Mov[] {
  return ctx.db
    .select()
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn), eq(movimientos.tipo, "gasto")))
    .all()
    .sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn));
}

function nombresDeSusEtiquetas(ctx: Contexto): Map<string, string> {
  return new Map(
    ctx.db
      .select()
      .from(etiquetas)
      .where(and(eq(etiquetas.usuarioId, ctx.usuarioId), isNull(etiquetas.eliminadoEn)))
      .all()
      .map((e) => [e.id, e.nombreNormalizado]),
  );
}

/** "Tacos de $120 del 2026-10-03". */
function quePaso(ctx: Contexto, m: Mov, comercios: Map<string, string>): string {
  const que = (m.comercioId && comercios.get(m.comercioId)) || m.descripcion || "gasto";
  return `${que} de ${formatearMonto(m.montoCentavos, m.moneda)} del ${m.fecha}`;
}

function nombresDeComercios(ctx: Contexto): Map<string, string> {
  return new Map(ctx.db.select({ id: comercios.id, nombre: comercios.nombre }).from(comercios).where(eq(comercios.usuarioId, ctx.usuarioId)).all().map((c) => [c.id, c.nombre]));
}

/**
 * Los gastos hechos lejos de donde suele estar, con el nombre de su viaje. Los de la misma ciudad con menos de
 * 30 días entre uno y otro son el mismo viaje; si vuelve meses después, ese viaje lleva el mes.
 */
export function planDeViajes(ctx: Contexto): Agregado[] {
  const todos = gastos(ctx);
  const hogar = casa(ctx.db.select({ lat: movimientos.lat, lon: movimientos.lon }).from(movimientos).where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn))).all());
  if (!hogar) return [];
  const suyas = nombresDeSusEtiquetas(ctx);
  const comercios = nombresDeComercios(ctx);
  const ultimoPorDestino = new Map<string, { fecha: string; nombre: string }>();
  const usados = new Set<string>();
  const plan: Agregado[] = [];
  for (const m of todos) {
    if (m.lat == null || m.lon == null || distanciaKm(hogar, { lat: m.lat, lon: m.lon }) < KM_DE_VIAJE) continue;
    const [anio, mes] = m.fecha.split("-").map(Number) as [number, number];
    const ciudad = ciudadCercana({ lat: m.lat, lon: m.lon });
    const destino = ciudad ?? `${anio}-${mes}`;
    const previo = ultimoPorDestino.get(destino);
    let nombre: string;
    if (previo && Date.parse(m.fecha) - Date.parse(previo.fecha) <= DIAS_MISMO_VIAJE * 86_400_000) nombre = previo.nombre;
    else if (!ciudad) nombre = `Viaje ${NOMBRES_MES[mes]} ${anio}`;
    else nombre = usados.has(`Viaje ${ciudad}`) ? `Viaje ${ciudad} ${NOMBRES_MES[mes]} ${anio}` : `Viaje ${ciudad}`;
    usados.add(nombre);
    ultimoPorDestino.set(destino, { fecha: m.fecha, nombre });
    if (m.etiquetas.some((id) => suyas.get(id) === normalizar(nombre))) continue;
    plan.push({ movimientoId: m.id, etiqueta: nombre, motivo: "viaje", quePaso: quePaso(ctx, m, comercios) });
  }
  return plan;
}

export type LineaParaIa = { movimiento: Mov; linea: string; puedeSerInnecesario: boolean; noSonEtiqueta: string[] };

/**
 * Los gastos para que la IA les ponga etiquetas, con lo que dijo al anotarlos ("comida con los del trabajo"): de
 * ahí sale el contexto. Los que no pueden ser innecesarios se marcan para que el código no la ponga aunque la IA sí.
 */
export function lineasParaIa(ctx: Contexto): LineaParaIa[] {
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const suyas = nombresDeSusEtiquetas(ctx);
  const comercios = nombresDeComercios(ctx);
  const [idInnecesario] = [...suyas.entries()].find(([, n]) => n === normalizar(INNECESARIO)) ?? [];
  return gastos(ctx).map((m) => {
    const c = cats.find((x) => x.id === m.categoriaId);
    const padre = c?.padreId ? cats.find((x) => x.id === c.padreId) : undefined;
    const comercio = m.comercioId ? comercios.get(m.comercioId) : undefined;
    const puedeSerInnecesario =
      !m.recurrenteId &&
      !m.msiId &&
      !(idInnecesario && m.etiquetas.includes(idInnecesario)) &&
      ![c?.nombre, padre?.nombre].some((n) => n && NUNCA_INNECESARIO.has(normalizar(n))) &&
      !(idInnecesario && innecesarioRechazado({ ...ctx, textoOriginal: undefined }, idInnecesario, { comercioId: m.comercioId, categoriaId: m.categoriaId }));
    const ya = m.etiquetas.map((id) => suyas.get(id)).filter(Boolean);
    const partes = [
      formatearMonto(m.montoCentavos, m.moneda),
      c?.nombre,
      comercio,
      m.descripcion,
      m.textoOriginal ? `dijo: "${m.textoOriginal.replace(/\s+/g, " ").slice(0, 160)}"` : undefined,
      ya.length ? `ya tiene: ${ya.join(", ")}` : undefined,
    ];
    return { movimiento: m, linea: partes.filter(Boolean).join(" · "), puedeSerInnecesario, noSonEtiqueta: [c?.nombre, padre?.nombre, comercio].filter((x): x is string => !!x) };
  });
}

/** Lo que se le pide a la IA: una lista numerada; contesta "número: etiquetas" solo de los que llevan alguna. */
export function preguntaParaIa(lineas: string[], existentes: string[]): string {
  return `Estos son gastos de una persona en México, con lo que dijo al anotarlos. Ponle etiquetas solo a los que les queden:
- "${INNECESARIO}" si es claramente prescindible: un antojo, comida a domicilio, una compra de impulso, apuestas, o dice que no lo necesitaba. Nunca súper, vivienda, servicios, salud, transporte, educación o deudas. Si dudas, no.
- Una etiqueta corta de contexto si lo que dijo deja claro para qué o para quién fue (Trabajo, Boda de Ana, Mudanza, Mamá). Reutiliza estas si ya lo dicen: ${existentes.length ? existentes.join(", ") : "(no tiene)"}.
La categoría, el comercio, la cuenta y la ciudad no son etiquetas. Máximo dos por gasto.
Contesta una línea por gasto etiquetado, así: "3: Innecesario" o "7: Trabajo". Si ninguno lleva, contesta "ninguno".

${lineas.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
}

const MAX_LARGO = 30;

/** "3: Innecesario\n7: Trabajo, Mamá" → lo que se agrega, ya sin lo que no puede ir. */
export function leerRespuesta(texto: string, lineas: LineaParaIa[], quePasoDe: (m: Mov) => string): Agregado[] {
  const plan: Agregado[] = [];
  for (const renglon of texto.split("\n")) {
    const r = renglon.match(/^\s*(\d+)\s*[:.)-]\s*(.+)$/);
    if (!r) continue;
    const l = lineas[Number(r[1]) - 1];
    if (!l) continue;
    const nombres = r[2]!
      // Solo por comas: "Boda de Ana y Luis" es una sola etiqueta.
      .split(",")
      .map((n) => n.replace(/["'#*]/g, "").trim())
      .filter((n) => n && n.length <= MAX_LARGO && !/^ningun/i.test(n))
      .slice(0, 2);
    for (const nombre of nombres) {
      const esInnecesario = normalizar(nombre) === normalizar(INNECESARIO);
      if (esInnecesario && !l.puedeSerInnecesario) continue;
      if (l.noSonEtiqueta.some((x) => normalizar(x) === normalizar(nombre))) continue;
      const bonito = esInnecesario ? INNECESARIO : nombre.charAt(0).toUpperCase() + nombre.slice(1);
      plan.push({ movimientoId: l.movimiento.id, etiqueta: bonito, motivo: esInnecesario ? "innecesario" : "contexto", quePaso: quePasoDe(l.movimiento) });
    }
  }
  return plan;
}

/** Para mostrar el plan: "Tacos de $120 del 2026-10-03". */
export function describirGasto(ctx: Contexto): (m: Mov) => string {
  const comercios = nombresDeComercios(ctx);
  return (m) => quePaso(ctx, m, comercios);
}

/** Las etiquetas vigentes del usuario, por nombre. */
export function susEtiquetas(ctx: Contexto): string[] {
  return ctx.db
    .select({ nombre: etiquetas.nombre })
    .from(etiquetas)
    .where(and(eq(etiquetas.usuarioId, ctx.usuarioId), isNull(etiquetas.eliminadoEn)))
    .all()
    .map((e) => e.nombre);
}

const clave = (marca: string, usuarioId: string) => `etiquetado-historial:${marca}:${usuarioId}`;

/** Agrega las etiquetas del plan. Crea las que falten; nunca revive una que el usuario borró. */
export function aplicarPlan(ctx: Contexto, plan: Agregado[], marca: string) {
  const registro: { movimientos: { id: string; ids: string[] }[]; creadas: string[] } = { movimientos: [], creadas: [] };
  ctx.db.transaction((tx) => {
    const idPorNombre = new Map<string, string | null>();
    const idDe = (nombre: string): string | null => {
      const n = normalizar(nombre);
      if (idPorNombre.has(n)) return idPorNombre.get(n)!;
      const e = tx.select().from(etiquetas).where(and(eq(etiquetas.usuarioId, ctx.usuarioId), eq(etiquetas.nombreNormalizado, n))).get();
      let id: string | null = e ? (e.eliminadoEn ? null : e.id) : null;
      if (!e) {
        id = tx.insert(etiquetas).values({ usuarioId: ctx.usuarioId, nombre, nombreNormalizado: n }).returning().get().id;
        registro.creadas.push(id);
      }
      idPorNombre.set(n, id);
      return id;
    };
    const porMovimiento = new Map<string, string[]>();
    for (const a of plan) {
      const id = idDe(a.etiqueta);
      if (id) porMovimiento.set(a.movimientoId, [...(porMovimiento.get(a.movimientoId) ?? []), id]);
    }
    for (const [movimientoId, ids] of porMovimiento) {
      const m = tx.select({ etiquetas: movimientos.etiquetas }).from(movimientos).where(and(eq(movimientos.id, movimientoId), eq(movimientos.usuarioId, ctx.usuarioId))).get();
      if (!m) continue;
      const nuevos = ids.filter((id) => !m.etiquetas.includes(id));
      if (!nuevos.length) continue;
      tx.update(movimientos).set({ etiquetas: [...m.etiquetas, ...nuevos] }).where(eq(movimientos.id, movimientoId)).run();
      registro.movimientos.push({ id: movimientoId, ids: nuevos });
    }
    // Si una corrida anterior con la misma marca ya pasó por esta cuenta (falló más adelante y se reintenta), se suma
    // a lo que agregó entonces: así --deshacer lo sigue quitando todo.
    const previo = tx.select().from(configuracion).where(eq(configuracion.clave, clave(marca, ctx.usuarioId))).get()?.valor as typeof registro | undefined;
    const valor = previo ? { movimientos: [...previo.movimientos, ...registro.movimientos], creadas: [...previo.creadas, ...registro.creadas] } : registro;
    tx.insert(configuracion)
      .values({ clave: clave(marca, ctx.usuarioId), valor })
      .onConflictDoUpdate({ target: configuracion.clave, set: { valor } })
      .run();
  });
  return { cambiados: registro.movimientos.length, creadas: registro.creadas.length };
}

/**
 * Quita lo que agregó un etiquetado (de todas las cuentas). Solo quita esos ids: si después se editó el
 * movimiento, lo demás se queda. Las etiquetas que creó se borran si ya nadie las usa.
 */
export function deshacerEtiquetado(db: Db, marca: string) {
  let quitados = 0;
  db.transaction((tx) => {
    for (const fila of tx.select().from(configuracion).where(like(configuracion.clave, `etiquetado-historial:${marca}:%`)).all()) {
      const registro = fila.valor as { movimientos: { id: string; ids: string[] }[]; creadas: string[] };
      for (const { id, ids } of registro.movimientos) {
        const m = tx.select({ etiquetas: movimientos.etiquetas }).from(movimientos).where(eq(movimientos.id, id)).get();
        if (!m) continue;
        const quedan = m.etiquetas.filter((e) => !ids.includes(e));
        if (quedan.length === m.etiquetas.length) continue;
        tx.update(movimientos).set({ etiquetas: quedan }).where(eq(movimientos.id, id)).run();
        quitados++;
      }
      for (const id of registro.creadas) {
        const enUso = tx.select({ id: movimientos.id }).from(movimientos).where(sql`instr(${movimientos.etiquetas}, ${id}) > 0`).limit(1).get();
        if (!enUso) tx.delete(etiquetas).where(eq(etiquetas.id, id)).run();
      }
      tx.delete(configuracion).where(eq(configuracion.clave, fila.clave)).run();
    }
  });
  return quitados;
}
