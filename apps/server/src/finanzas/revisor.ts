import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { comercios, entradas, movimientos, recurrentes, usuarios } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { diaSemana, fechaLocal, partes, sumarDias, sumarMeses } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import { type AvisoNuevo, guardarAviso } from "./avisos";
import { listarCategorias, nombreCompleto, type Categoria } from "./catalogos";
import { type Contexto, crearContexto } from "./contexto";
import { estadoPresupuestos, limitesDelMes, listarMetas, listarMsi, listarPrestamos, registrarMensualidades } from "./planes";
import { proximoCobro } from "./recurrentes";

// El revisor nocturno busca fugas y cosas por venir y las deja como avisos. Es solo SQL y reglas:
// no usa el modelo de IA, así que no lo carga ni gasta memoria en la Mac.

type Mov = typeof movimientos.$inferSelect;

// Un gasto hormiga es chico y se repite: 6 o más veces en 30 días, de $150 o menos cada uno, y que
// sumen al menos $300.
const HORMIGA_MAXIMO = 15_000;
const HORMIGA_VECES = 6;
const HORMIGA_MINIMO_TOTAL = 30_000;
// Categorías de cobros que se repiten cada mes.
const SUSCRIPCIONES = new Set(["streaming", "musica", "software", "otras suscripciones", "suscripciones", "gimnasio"]);
const NOMBRES_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const $ = (ctx: Contexto, centavos: number) => formatearMonto(centavos, ctx.monedaBase);
const suma = (filas: Mov[]) => filas.reduce((s, m) => s + m.montoCentavos, 0);
const enlaceMovimientos = (texto: string) => `#movimientos?texto=${encodeURIComponent(texto)}`;

function gastos(ctx: Contexto, desde: string, hasta = ctx.hoy): Mov[] {
  return ctx.db
    .select()
    .from(movimientos)
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        isNull(movimientos.eliminadoEn),
        eq(movimientos.tipo, "gasto"),
        eq(movimientos.moneda, ctx.monedaBase),
        gte(movimientos.fecha, desde),
        lte(movimientos.fecha, hasta),
      ),
    )
    .orderBy(desc(movimientos.fecha))
    .all();
}

// El texto se guarda con el día exacto ("El jueves 8"); al leerlo se dice "Hoy" o "Mañana" (avisos.ts).
function cuando(fecha: string) {
  return `El ${NOMBRES_DIA[diaSemana(fecha)]} ${partes(fecha).dia}`;
}

/** Nombre con que se habla de un gasto: el comercio, o la subcategoría. */
function nombrador(ctx: Contexto, cats: Categoria[]) {
  const nombres = new Map(
    ctx.db
      .select({ id: comercios.id, nombre: comercios.nombre })
      .from(comercios)
      .where(eq(comercios.usuarioId, ctx.usuarioId))
      .all()
      .map((c) => [c.id, c.nombre]),
  );
  return (m: Mov) => {
    if (m.comercioId && nombres.has(m.comercioId)) return { clave: `c${m.comercioId}`, nombre: nombres.get(m.comercioId)! };
    const cat = nombreCompleto(cats, m.categoriaId)?.split(" > ").at(-1);
    return cat ? { clave: `k${m.categoriaId}`, nombre: cat } : undefined;
  };
}

// Gastos que se repiten por necesidad, no por antojo: el metro diario no es una fuga ni la gasolina una suscripción.
const NECESIDADES_QUE_SE_REPITEN = new Set(["transporte publico", "gasolina", "casetas", "estacionamiento"]);
const esNecesidad = (cats: Categoria[], m: Mov) => NECESIDADES_QUE_SE_REPITEN.has(normalizar(nombreCompleto(cats, m.categoriaId)?.split(" > ").at(-1) ?? ""));

/** Gastos chicos que se repiten: "En 30 días gastaste $780 en Starbucks, 12 veces." */
function hormiga(ctx: Contexto, cats: Categoria[]): AvisoNuevo[] {
  const nombre = nombrador(ctx, cats);
  const grupos = new Map<string, { nombre: string; filas: Mov[] }>();
  for (const m of gastos(ctx, sumarDias(ctx.hoy, -29))) {
    if (m.montoCentavos > HORMIGA_MAXIMO || m.recurrenteId || m.msiId || esNecesidad(cats, m)) continue;
    const n = nombre(m);
    if (!n) continue;
    const g = grupos.get(n.clave) ?? { nombre: n.nombre, filas: [] };
    g.filas.push(m);
    grupos.set(n.clave, g);
  }
  return [...grupos.entries()]
    .filter(([, g]) => g.filas.length >= HORMIGA_VECES && suma(g.filas) >= HORMIGA_MINIMO_TOTAL)
    .sort((a, b) => suma(b[1].filas) - suma(a[1].filas))
    .slice(0, 2)
    .map(([clave, g]) => {
      const total = suma(g.filas);
      return {
        tipo: "hormiga" as const,
        // Una vez al mes por cada uno.
        clave: `hormiga:${clave}:${ctx.hoy.slice(0, 7)}`,
        titulo: `Gasto hormiga: ${g.nombre}`,
        texto: `En los últimos 30 días gastaste ${$(ctx, total)} en ${g.nombre}, ${g.filas.length} veces. Al año serían unos ${$(ctx, Math.round((total * 365) / 30 / 10_000) * 10_000)}.`,
        prioridad: 2 as const,
        enlace: enlaceMovimientos(g.nombre),
      };
    });
}

/** Un cobro que se repite y no está dado de alta, para avisar antes del próximo. */
function suscripcionesOlvidadas(ctx: Contexto, cats: Categoria[]): AvisoNuevo[] {
  const fijos = ctx.db
    .select({ nombre: recurrentes.nombre })
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), isNull(recurrentes.eliminadoEn)))
    .all()
    .map((r) => normalizar(r.nombre));
  const conocido = (nombre: string) => {
    const n = normalizar(nombre);
    return fijos.some((f) => f === n || n.includes(f) || f.includes(n));
  };
  const nombre = nombrador(ctx, cats);
  const avisos: AvisoNuevo[] = [];
  const vistos = new Set<string>();

  // 1. El mismo monto en el mismo comercio con 25 a 35 días de diferencia.
  const porComercio = new Map<string, { nombre: string; filas: Mov[] }>();
  for (const m of gastos(ctx, sumarDias(ctx.hoy, -100))) {
    if (!m.comercioId || m.recurrenteId || m.msiId || esNecesidad(cats, m)) continue;
    const n = nombre(m)!;
    const g = porComercio.get(n.clave) ?? { nombre: n.nombre, filas: [] };
    g.filas.push(m);
    porComercio.set(n.clave, g);
  }
  for (const g of porComercio.values()) {
    if (conocido(g.nombre)) continue;
    const [ultimo, ...anteriores] = g.filas;
    const parecido = anteriores.find((m) => {
      const dias = (Date.parse(ultimo!.fecha) - Date.parse(m.fecha)) / 86_400_000;
      return dias >= 25 && dias <= 35 && Math.abs(m.montoCentavos - ultimo!.montoCentavos) <= ultimo!.montoCentavos * 0.05;
    });
    // Que no sea un lugar donde se compra seguido (el súper): pocas veces en 100 días.
    if (!parecido || g.filas.length > 4) continue;
    vistos.add(normalizar(g.nombre));
    avisos.push({
      tipo: "suscripcion_olvidada",
      clave: `olvidada:${normalizar(g.nombre)}`,
      titulo: `¿${g.nombre} es un pago fijo?`,
      texto: `${g.nombre} te cobró ${$(ctx, ultimo!.montoCentavos)} dos meses seguidos y no lo tengo como pago fijo. Si es cada mes, dime "${g.nombre} cada mes" y te aviso antes del cobro.`,
      prioridad: 2,
      enlace: enlaceMovimientos(g.nombre),
    });
  }

  // 2. Un gasto que se anotó como suscripción ("mi suscripción de AppleCare") y no está dado de alta.
  for (const m of gastos(ctx, sumarDias(ctx.hoy, -35))) {
    if (m.recurrenteId || m.msiId) continue;
    const hoja = normalizar(nombreCompleto(cats, m.categoriaId)?.split(" > ").at(-1) ?? "");
    const dicho = normalizar([m.descripcion, m.textoOriginal].filter(Boolean).join(" "));
    if (!SUSCRIPCIONES.has(hoja) && !/\bsuscripci/.test(dicho)) continue;
    const etiqueta =
      nombre(m)?.clave.startsWith("c") ? nombre(m)!.nombre : (m.descripcion?.replace(/^(mi |la |el )?suscripci[oó]n (de |a )?/i, "") ?? nombre(m)?.nombre);
    if (!etiqueta || conocido(etiqueta) || vistos.has(normalizar(etiqueta))) continue;
    vistos.add(normalizar(etiqueta));
    avisos.push({
      tipo: "suscripcion_olvidada",
      clave: `olvidada:${normalizar(etiqueta)}`,
      titulo: `¿${etiqueta} se cobra cada mes?`,
      texto: `Anotaste ${etiqueta} de ${$(ctx, m.montoCentavos)} como suscripción. Si se cobra cada mes, dime "${etiqueta} cada mes" y te aviso antes del próximo cobro.`,
      prioridad: 3,
      enlace: enlaceMovimientos(etiqueta),
    });
  }
  return avisos.slice(0, 2);
}

/** Dos suscripciones de lo mismo: "Netflix y Disney+, los dos en Streaming: $398 al mes." */
function suscripcionesDuplicadas(ctx: Contexto, cats: Categoria[]): AvisoNuevo[] {
  const activos = ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn)))
    .all()
    .filter((r) => r.tipo !== "ingreso" && r.moneda === ctx.monedaBase);
  const porCategoria = new Map<string, typeof activos>();
  for (const r of activos) {
    const hoja = normalizar(cats.find((c) => c.id === r.categoriaId)?.nombre ?? "");
    if (!r.categoriaId || !SUSCRIPCIONES.has(hoja) || hoja === "suscripciones" || hoja === "otras suscripciones") continue;
    porCategoria.set(r.categoriaId, [...(porCategoria.get(r.categoriaId) ?? []), r]);
  }
  return [...porCategoria.entries()]
    .filter(([, lista]) => lista.length >= 2)
    .map(([categoriaId, lista]) => {
      const nombres = lista.map((r) => `${r.nombre} (${$(ctx, r.montoCentavos)})`);
      const texto = nombres.length === 2 ? nombres.join(" y ") : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
      const mensual = lista.reduce((s, r) => s + (r.frecuencia === "anual" ? Math.round(r.montoCentavos / 12) : r.montoCentavos), 0);
      const categoria = cats.find((c) => c.id === categoriaId)!.nombre;
      return {
        tipo: "suscripcion_duplicada" as const,
        clave: `duplicada:${lista.map((r) => r.id).sort().join(",")}`,
        titulo: `Varias suscripciones de ${categoria}`,
        texto: `Pagas ${texto}, todas de ${categoria}: unos ${$(ctx, mensual)} al mes. Si no usas alguna, cancelarla es dinero libre.`,
        prioridad: 2 as const,
        enlace: "#ajustes",
      };
    });
}

/** Cobros fijos y mensualidades de hoy a pasado mañana. */
function cobrosProximos(ctx: Contexto): AvisoNuevo[] {
  const limite = sumarDias(ctx.hoy, 2);
  const fijos: AvisoNuevo[] = ctx.db
    .select()
    .from(recurrentes)
    .where(and(eq(recurrentes.usuarioId, ctx.usuarioId), eq(recurrentes.activo, true), isNull(recurrentes.eliminadoEn)))
    .all()
    .filter((r) => r.tipo !== "ingreso")
    .map((r) => ({ r, fecha: proximoCobro(r, ctx.hoy) }))
    .filter(({ fecha }) => fecha <= limite)
    .map(({ r, fecha }) => ({
      tipo: "cobro_proximo",
      clave: `cobro:${r.id}:${fecha}`,
      titulo: `${cuando(fecha)} se cobra ${r.nombre}`,
      texto: `${cuando(fecha)} se cobra ${r.nombre} de ${formatearMonto(r.montoCentavos, r.moneda)}.`,
      vence: fecha,
      prioridad: 1,
      enlace: "#inicio",
    }));
  const mensualidades: AvisoNuevo[] = listarMsi(ctx)
    .compras.filter((c) => c.proximoCargo && c.proximoCargo <= limite)
    .map((c) => ({
      tipo: "msi",
      clave: `msi:${c.id}:${c.proximoCargo}`,
      titulo: `Mensualidad de ${c.descripcion}`,
      texto: `${cuando(c.proximoCargo!)} llega la mensualidad ${c.pagadas + 1} de ${c.meses} de ${c.descripcion}: ${$(ctx, c.proximoMontoCentavos ?? c.mensualidadCentavos)}.`,
      vence: c.proximoCargo,
      prioridad: 2,
      enlace: "#inicio",
    }));
  return [...fijos, ...mensualidades];
}

/** Presupuestos que al ritmo actual se van a pasar, o que ya se pasaron. */
function presupuestosEnRiesgo(ctx: Contexto): AvisoNuevo[] {
  const estado = estadoPresupuestos(ctx);
  const mes = estado.mes;
  return estado.presupuestos.flatMap((p): AvisoNuevo[] => {
    const nombre = p.categoriaId ? `tu presupuesto de ${p.categoria.split(" > ").at(-1)}` : "tu presupuesto del mes";
    if (p.estado === "excedido") {
      return [
        {
          tipo: "presupuesto",
          clave: `presupuesto:${p.id}:${mes}:excedido`,
          titulo: "Presupuesto rebasado",
          texto: `Ya te pasaste de ${nombre} por ${$(ctx, -p.restanteCentavos)} (llevas ${$(ctx, p.gastadoCentavos)} de ${$(ctx, p.limiteCentavos)}).`,
          prioridad: 1,
          enlace: "#presupuestos",
        },
      ];
    }
    // Las primeras semanas el ritmo todavía no dice mucho.
    if (estado.diaDelMes < 8 || p.proyeccionCentavos <= p.limiteCentavos * 1.05) return [];
    return [
      {
        tipo: "presupuesto",
        clave: `presupuesto:${p.id}:${mes}:ritmo`,
        titulo: "Presupuesto en riesgo",
        texto: `Al ritmo que vas, cerrarías el mes en ${$(ctx, p.proyeccionCentavos)} y ${nombre} es de ${$(ctx, p.limiteCentavos)}. Te quedan ${$(ctx, p.restanteCentavos)} para ${estado.diasDelMes - estado.diaDelMes + 1} días.`,
        prioridad: 2,
        enlace: "#presupuestos",
      },
    ];
  });
}

/** Una categoría que este mes va muy por encima de su promedio de los tres meses anteriores. */
function gastoInusual(ctx: Contexto, cats: Categoria[]): AvisoNuevo[] {
  const { desde } = limitesDelMes(ctx);
  const dia = partes(ctx.hoy).dia;
  if (dia < 10) return [];
  const principal = (m: Mov) => {
    const c = cats.find((x) => x.id === m.categoriaId);
    return c?.padreId ?? c?.id;
  };
  const porCategoria = (filas: Mov[]) => {
    const mapa = new Map<string, number>();
    for (const m of filas) {
      const id = principal(m);
      if (id && !m.msiId) mapa.set(id, (mapa.get(id) ?? 0) + m.montoCentavos);
    }
    return mapa;
  };
  const actual = porCategoria(gastos(ctx, desde));
  const meses = [1, 2, 3].map((n) => {
    const inicio = sumarMeses(desde, -n, 1);
    return porCategoria(gastos(ctx, inicio, sumarDias(sumarMeses(inicio, 1, 1), -1)));
  });
  // Sin tres meses de historia no hay con qué comparar.
  if (meses.some((m) => m.size === 0)) return [];
  return [...actual.entries()]
    .map(([id, centavos]) => ({ id, centavos, promedio: Math.round(meses.reduce((s, m) => s + (m.get(id) ?? 0), 0) / 3) }))
    .filter((x) => x.promedio > 0 && x.centavos > x.promedio * 1.5 && x.centavos - x.promedio >= 50_000)
    .sort((a, b) => b.centavos - b.promedio - (a.centavos - a.promedio))
    .slice(0, 1)
    .map((x) => {
      const nombre = cats.find((c) => c.id === x.id)!.nombre;
      return {
        tipo: "gasto_inusual" as const,
        clave: `inusual:${x.id}:${ctx.hoy.slice(0, 7)}`,
        titulo: `Más gasto en ${nombre}`,
        texto: `Este mes llevas ${$(ctx, x.centavos)} en ${nombre} y tu promedio es de ${$(ctx, x.promedio)} al mes.`,
        prioridad: 2 as const,
        enlace: enlaceMovimientos(nombre),
      };
    });
}

/** Metas que vencen en menos de un mes y préstamos que llevan más de un mes sin pagarse. */
function metasYPrestamos(ctx: Contexto): AvisoNuevo[] {
  const metas: AvisoNuevo[] = listarMetas(ctx)
    .metas.filter((m) => !m.completada && m.fechaLimite && m.fechaLimite >= ctx.hoy && m.fechaLimite <= sumarDias(ctx.hoy, 30))
    .map((m) => ({
      tipo: "meta",
      clave: `meta:${m.id}:${m.fechaLimite}`,
      titulo: `Meta ${m.nombre}`,
      texto: `Tu meta ${m.nombre} vence el ${partes(m.fechaLimite!).dia} y te faltan ${$(ctx, m.objetivoCentavos - m.ahorradoCentavos)}.`,
      vence: m.fechaLimite,
      prioridad: 2,
      enlace: "#metas",
    }));
  const haceUnMes = new Date(Date.parse(`${ctx.hoy}T12:00:00Z`) - 30 * 86_400_000).toISOString();
  const porPersona = new Map<string, { centavos: number; desde: string }>();
  for (const p of listarPrestamos(ctx).prestamos) {
    if (p.direccion !== "me_deben" || p.creadoEn > haceUnMes) continue;
    const previo = porPersona.get(p.persona);
    porPersona.set(p.persona, { centavos: (previo?.centavos ?? 0) + p.pendienteCentavos, desde: previo && previo.desde < p.creadoEn ? previo.desde : p.creadoEn });
  }
  const prestamos: AvisoNuevo[] = [...porPersona.entries()].map(([persona, p]) => ({
    tipo: "prestamo",
    clave: `prestamo:${normalizar(persona)}:${ctx.hoy.slice(0, 7)}`,
    titulo: `${persona} te debe`,
    texto: `${persona} te debe ${$(ctx, p.centavos)} desde hace ${Math.round((Date.parse(ctx.ahoraIso) - Date.parse(p.desde)) / (7 * 86_400_000))} semanas.`,
    prioridad: 3,
    enlace: "#metas",
  }));
  return [...metas, ...prestamos];
}

/** Revisa las finanzas de un usuario y guarda los avisos nuevos. Devuelve cuántos guardó. */
export function revisar(ctx: Contexto) {
  // Las mensualidades que ya llegaron quedan como gasto antes de revisar.
  const mensualidades = registrarMensualidades(ctx, { sinBitacora: true });
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const hallazgos = [
    ...cobrosProximos(ctx),
    ...presupuestosEnRiesgo(ctx),
    ...hormiga(ctx, cats),
    ...suscripcionesOlvidadas(ctx, cats),
    ...suscripcionesDuplicadas(ctx, cats),
    ...gastoInusual(ctx, cats),
    ...metasYPrestamos(ctx),
  ];
  const nuevos = hallazgos.filter((a) => guardarAviso(ctx, a));
  ctx.db.update(usuarios).set({ revisadoPara: ctx.hoy }).where(eq(usuarios.id, ctx.usuarioId)).run();
  return { nuevos: nuevos.length, mensualidades };
}

export type OpcionesRevisor = {
  db: Db;
  zonaHoraria: string;
  monedaBase: string;
  /** Desde qué hora local se revisa (3 de la mañana por omisión). */
  hora?: number;
  /** Minutos sin dictados antes de revisar, para no competir con alguien que está usando el Atajo. */
  minutosSinUso?: number;
  /** Cada cuánto se fija si toca revisar. */
  cadaMs?: number;
  /** Se llama con cada usuario revisado (para el push, por ejemplo). */
  alRevisar?: (usuarioId: string, resultado: ReturnType<typeof revisar>) => void;
};

/**
 * Revisa a quien todavía no se revisó hoy, si ya es la hora y nadie ha dictado en los últimos minutos.
 * Si la Mac estaba dormida a las 3, lo hace en cuanto despierta y queda libre. Devuelve a quiénes revisó.
 */
export function revisarPendientes(opciones: OpcionesRevisor, ahora = new Date()): string[] {
  // Corre solo, cada 10 minutos: un error nunca debe tumbar el servidor.
  try {
    return revisarPendientesSinCuidar(opciones, ahora);
  } catch (error) {
    console.error("El revisor falló:", error);
    return [];
  }
}

function revisarPendientesSinCuidar(opciones: OpcionesRevisor, ahora: Date): string[] {
  const { db, zonaHoraria, monedaBase } = opciones;
  const hoy = fechaLocal(ahora, zonaHoraria);
  const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: zonaHoraria, hour: "numeric", hourCycle: "h23" }).format(ahora));
  if (hora < (opciones.hora ?? 3)) return [];
  const desde = new Date(ahora.getTime() - (opciones.minutosSinUso ?? 10) * 60_000).toISOString();
  if (db.select({ id: entradas.id }).from(entradas).where(gte(entradas.creadoEn, desde)).limit(1).get()) return [];
  const revisados: string[] = [];
  for (const u of db.select({ id: usuarios.id, revisadoPara: usuarios.revisadoPara }).from(usuarios).all()) {
    if (u.revisadoPara === hoy) continue;
    try {
      const ctx = crearContexto({ db, usuarioId: u.id, zonaHoraria, monedaBase, ahora });
      const resultado = revisar(ctx);
      revisados.push(u.id);
      opciones.alRevisar?.(u.id, resultado);
    } catch (error) {
      console.error(`El revisor falló con el usuario ${u.id}:`, error);
    }
  }
  return revisados;
}

/** Arranca el revisor en segundo plano. Devuelve una función para detenerlo. */
export function programarRevisor(opciones: OpcionesRevisor): () => void {
  const intervalo = setInterval(() => revisarPendientes(opciones), opciones.cadaMs ?? 10 * 60_000);
  intervalo.unref?.();
  return () => clearInterval(intervalo);
}
