// Etiquetas que se ponen solas, sin que el usuario las pida (Pedro, 14-oct-2026: "que la IA ponga etiquetas a su
// voluntad"). La de viaje sale de la ubicación y no gasta IA; la de innecesario la pone el modelo (ai/instrucciones.ts).
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { bitacora, etiquetas, movimientos, usuarios } from "../db/schema";
import { formatearMonto } from "../lib/dinero";
import { sumarDias } from "../lib/fechas";
import { normalizar } from "../lib/texto";
import type { Contexto } from "./contexto";
import type { AvisoNuevo } from "./avisos";
import { idsDeEtiquetas, listarVigentes } from "./etiquetas";

/** La etiqueta que la IA pone a un antojo o una compra de impulso. */
export const INNECESARIO = "Innecesario";

/**
 * Si las etiquetas automáticas están abiertas para este usuario. Abiertas a todas las cuentas (Pedro, 14-oct-2026);
 * ETIQUETAS_AUTO=dueno las deja solo a la cuenta dueña (la que se creó primero) y ETIQUETAS_AUTO=0 las apaga.
 */
export function etiquetasAutoHabilitadas(db: Db, usuarioId: string, entorno: string | undefined = process.env.ETIQUETAS_AUTO): boolean {
  const modo = (entorno ?? "").trim().toLowerCase();
  if (modo === "0" || modo === "no" || modo === "apagado") return false;
  if (modo !== "dueno" && modo !== "dueño") return true;
  const dueno = db.select({ id: usuarios.id }).from(usuarios).orderBy(usuarios.creadoEn, sql`rowid`).limit(1).get();
  return dueno?.id === usuarioId;
}

// Ciudades y destinos frecuentes, para nombrar el viaje sin pedirle nada a internet ni al Atajo.
const CIUDADES: [string, number, number][] = [
  ["CDMX", 19.4326, -99.1332],
  ["Guadalajara", 20.6597, -103.3496],
  ["Monterrey", 25.6866, -100.3161],
  ["Puebla", 19.0414, -98.2063],
  ["Toluca", 19.2826, -99.6557],
  ["Tijuana", 32.5149, -117.0382],
  ["León", 21.125, -101.686],
  ["Querétaro", 20.5888, -100.3899],
  ["San Luis Potosí", 22.1565, -100.9855],
  ["Mérida", 20.9674, -89.5926],
  ["Aguascalientes", 21.8853, -102.2916],
  ["Cuernavaca", 18.9242, -99.2216],
  ["Chihuahua", 28.632, -106.0691],
  ["Ciudad Juárez", 31.6904, -106.4245],
  ["Hermosillo", 29.0729, -110.9559],
  ["Saltillo", 25.4232, -101.0053],
  ["Morelia", 19.706, -101.195],
  ["Culiacán", 24.8091, -107.394],
  ["Mexicali", 32.6245, -115.4523],
  ["Torreón", 25.5428, -103.4068],
  ["Veracruz", 19.1738, -96.1342],
  ["Xalapa", 19.5438, -96.9102],
  ["Oaxaca", 17.0732, -96.7266],
  ["Acapulco", 16.8531, -99.8237],
  ["Cancún", 21.1619, -86.8515],
  ["Isla Mujeres", 21.232, -86.731],
  ["Cozumel", 20.423, -86.9223],
  ["Holbox", 21.523, -87.379],
  ["Playa del Carmen", 20.6296, -87.0739],
  ["Tulum", 20.2114, -87.4654],
  ["Bacalar", 18.677, -88.395],
  ["Chetumal", 18.5001, -88.2961],
  ["Puerto Vallarta", 20.6534, -105.2253],
  ["Mazatlán", 23.2494, -106.4111],
  ["Los Cabos", 22.8905, -109.9167],
  ["La Paz", 24.1426, -110.3128],
  ["Ensenada", 31.8667, -116.5964],
  ["Tampico", 22.2331, -97.8611],
  ["Villahermosa", 17.9892, -92.9475],
  ["Tuxtla Gutiérrez", 16.7528, -93.1167],
  ["San Cristóbal", 16.737, -92.6376],
  ["Campeche", 19.8301, -90.5349],
  ["Durango", 24.0277, -104.6532],
  ["Zacatecas", 22.7709, -102.5833],
  ["Pachuca", 20.1011, -98.7591],
  ["Tlaxcala", 19.3139, -98.2404],
  ["Colima", 19.2433, -103.725],
  ["Manzanillo", 19.1138, -104.3385],
  ["Tepic", 21.5042, -104.8946],
  ["Guanajuato", 21.019, -101.2574],
  ["San Miguel de Allende", 20.9144, -100.7452],
  ["Irapuato", 20.6767, -101.3563],
  ["Celaya", 20.5235, -100.8157],
  ["Huatulco", 15.7686, -96.135],
  ["Puerto Escondido", 15.872, -97.0767],
  ["Zihuatanejo", 17.6417, -101.5517],
  ["Taxco", 18.556, -99.605],
  ["Valle de Bravo", 19.195, -100.131],
  ["Reynosa", 26.0508, -98.2979],
  ["Matamoros", 25.869, -97.5027],
  ["Nuevo Laredo", 27.4779, -99.5496],
  ["Ciudad Obregón", 27.4828, -109.9304],
  ["Los Mochis", 25.7904, -108.9859],
  ["Coatzacoalcos", 18.1345, -94.459],
  ["Nueva York", 40.7128, -74.006],
  ["Los Ángeles", 34.0522, -118.2437],
  ["San Diego", 32.7157, -117.1611],
  ["Las Vegas", 36.1699, -115.1398],
  ["Miami", 25.7617, -80.1918],
  ["Orlando", 28.5383, -81.3792],
  ["Houston", 29.7604, -95.3698],
  ["Dallas", 32.7767, -96.797],
  ["San Antonio", 29.4241, -98.4936],
  ["Chicago", 41.8781, -87.6298],
  ["San Francisco", 37.7749, -122.4194],
  ["Phoenix", 33.4484, -112.074],
  ["Toronto", 43.6532, -79.3832],
  ["Vancouver", 49.2827, -123.1207],
  ["Madrid", 40.4168, -3.7038],
  ["Barcelona", 41.3874, 2.1686],
  ["París", 48.8566, 2.3522],
  ["Londres", 51.5074, -0.1278],
  ["Roma", 41.9028, 12.4964],
  ["Tokio", 35.6762, 139.6503],
  ["Bogotá", 4.711, -74.0721],
  ["Medellín", 6.2442, -75.5812],
  ["Cartagena", 10.391, -75.4794],
  ["Lima", -12.0464, -77.0428],
  ["Buenos Aires", -34.6037, -58.3816],
  ["Santiago", -33.4489, -70.6693],
  ["La Habana", 23.1136, -82.3666],
  ["San José", 9.9281, -84.0907],
  ["Guatemala", 14.6349, -90.5069],
  ["Punta Cana", 18.5601, -68.3725],
];

export const NOMBRES_MES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** A esta distancia de donde suele estar, un gasto ya es de viaje (Toluca y Cuernavaca desde la CDMX no lo son). */
export const KM_DE_VIAJE = 100;
/** Una ciudad de la lista nombra el lugar si está a menos de esto. */
const KM_DE_CIUDAD = 60;
/** Con menos gastos con ubicación no se sabe dónde vive. */
const MINIMO_PARA_CASA = 5;
const DIAS_PARA_CASA = 90;
/** Un viaje con la etiqueta usada hace menos de esto sigue siendo el mismo viaje. */
const DIAS_MISMO_VIAJE = 30;

export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function ciudadCercana(p: { lat: number; lon: number }): string | undefined {
  let mejor: { nombre: string; km: number } | undefined;
  for (const [nombre, lat, lon] of CIUDADES) {
    const km = distanciaKm(p, { lat, lon });
    if (km <= KM_DE_CIUDAD && (!mejor || km < mejor.km)) mejor = { nombre, km };
  }
  return mejor?.nombre;
}

/** Dónde suele estar: el lugar con más movimientos con ubicación de los últimos 90 días. */
export function casa(filas: { lat: number | null; lon: number | null }[]): { lat: number; lon: number } | undefined {
  const grupos = new Map<string, { lat: number; lon: number }[]>();
  for (const f of filas) {
    if (f.lat == null || f.lon == null) continue;
    const p = { lat: f.lat, lon: f.lon };
    // Sin ciudad conocida, una cuadrícula de medio grado (unos 50 km) junta los del mismo pueblo.
    const clave = ciudadCercana(p) ?? `${Math.round(p.lat * 2)},${Math.round(p.lon * 2)}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
  }
  const total = [...grupos.values()].reduce((s, g) => s + g.length, 0);
  if (total < MINIMO_PARA_CASA) return undefined;
  const mayor = [...grupos.values()].sort((a, b) => b.length - a.length)[0]!;
  return { lat: mayor.reduce((s, p) => s + p.lat, 0) / mayor.length, lon: mayor.reduce((s, p) => s + p.lon, 0) / mayor.length };
}

/**
 * La etiqueta de viaje de un gasto hecho lejos de donde suele estar: "Viaje Cancún". El mismo viaje reutiliza la
 * suya; un viaje a la misma ciudad meses después lleva el mes ("Viaje Cancún octubre 2027"), y uno lejos de
 * las ciudades conocidas, solo el mes ("Viaje octubre 2026"). Si borró hace poco
 * esa etiqueta, no se vuelve a poner. `nueva` es el nombre cuando se acaba de crear, para decírselo una vez.
 */
export function etiquetaDeViaje(ctx: Contexto, fecha: string): { ids: string[]; nueva?: string } {
  const { lat, lon } = ctx.ubicacion ?? {};
  if (lat == null || lon == null) return { ids: [] };
  // La ubicación es de cuando lo dicta: lo de hace días pudo ser en otro lado.
  if (fecha < sumarDias(ctx.hoy, -2) || fecha > ctx.hoy) return { ids: [] };
  if (!etiquetasAutoHabilitadas(ctx.db, ctx.usuarioId)) return { ids: [] };
  const filas = ctx.db
    .select({ lat: movimientos.lat, lon: movimientos.lon, fecha: movimientos.fecha, etiquetas: movimientos.etiquetas })
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn), gte(movimientos.fecha, sumarDias(ctx.hoy, -DIAS_PARA_CASA))))
    .all();
  const hogar = casa(filas);
  if (!hogar || distanciaKm(hogar, { lat, lon }) < KM_DE_VIAJE) return { ids: [] };

  const [anio, mes] = ctx.hoy.split("-").map(Number) as [number, number];
  const ciudad = ciudadCercana({ lat, lon });
  const delMes = `${NOMBRES_MES[mes]} ${anio}`;
  for (const nombre of ciudad ? [`Viaje ${ciudad}`, `Viaje ${ciudad} ${delMes}`] : [`Viaje ${delMes}`]) {
    const clave = normalizar(nombre);
    const e = ctx.db
      .select()
      .from(etiquetas)
      .where(and(eq(etiquetas.usuarioId, ctx.usuarioId), eq(etiquetas.nombreNormalizado, clave)))
      .get();
    if (!e) return { ids: idsDeEtiquetas(ctx, [nombre]), nueva: nombre };
    if (e.eliminadoEn) {
      // La quitó: no se la volvemos a poner en este viaje.
      if (e.eliminadoEn >= sumarDias(ctx.hoy, -DIAS_MISMO_VIAJE)) return { ids: [] };
      return { ids: idsDeEtiquetas(ctx, [nombre]), nueva: nombre };
    }
    const ultimo = filas.filter((m) => m.etiquetas.includes(e.id)).reduce<string | null>((max, m) => (!max || m.fecha > max ? m.fecha : max), null);
    // Sin usar (la creó él) o del mismo viaje: es esa. Si es de un viaje de hace meses, va la del mes.
    const usadaAntes = ctx.db
      .select({ id: movimientos.id })
      .from(movimientos)
      .where(and(eq(movimientos.usuarioId, ctx.usuarioId), sql`instr(${movimientos.etiquetas}, ${e.id}) > 0`))
      .limit(1)
      .get();
    if (!usadaAntes || (ultimo && ultimo >= sumarDias(ctx.hoy, -DIAS_MISMO_VIAJE))) return { ids: [e.id] };
  }
  return { ids: [] };
}

const esDeViaje = (nombre: string) => normalizar(nombre).startsWith("viaje ");

/**
 * Lo que aprende de sus etiquetas: si a la última compra en ese comercio le puso una ("lo de Office Depot es de
 * Trabajo"), la siguiente la lleva sola. Si se la quita, la que sigue ya no. No pasan las de viaje, la de
 * innecesario ni las que se activan por unos días: esas son del momento, no del comercio.
 */
export function heredadasDelComercio(ctx: Contexto, comercioId: string | undefined): string[] {
  if (!comercioId || !etiquetasAutoHabilitadas(ctx.db, ctx.usuarioId)) return [];
  const ultima = ctx.db
    .select({ etiquetas: movimientos.etiquetas })
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), eq(movimientos.comercioId, comercioId), isNull(movimientos.eliminadoEn)))
    .orderBy(desc(movimientos.ocurridoEn))
    .limit(1)
    .get();
  if (!ultima?.etiquetas.length) return [];
  const heredables = new Set(
    listarVigentes(ctx)
      .filter((e) => e.nombre !== INNECESARIO && !esDeViaje(e.nombre) && !e.activaDesde)
      .map((e) => e.id),
  );
  return ultima.etiquetas.filter((id) => heredables.has(id));
}

/**
 * Si ya le quitó "Innecesario" a algo de ese comercio (o de esa categoría, sin comercio), no se vuelve a poner
 * solo ahí. Si él mismo dice que fue innecesario, sí se pone.
 */
export function innecesarioRechazado(ctx: Contexto, idInnecesario: string, de: { comercioId?: string | null; categoriaId?: string | null }): boolean {
  if (/innecesari/i.test(ctx.textoOriginal ?? "")) return false;
  const tenia = (x: Record<string, unknown> | null) => Array.isArray(x?.etiquetas) && (x.etiquetas as string[]).includes(idInnecesario);
  const ediciones = ctx.db
    .select({ antes: bitacora.antes, despues: bitacora.despues })
    .from(bitacora)
    .where(and(eq(bitacora.usuarioId, ctx.usuarioId), eq(bitacora.tabla, "movimientos"), eq(bitacora.accion, "editar"), isNull(bitacora.deshechoEn)))
    .orderBy(desc(bitacora.creadoEn))
    .limit(500)
    .all();
  return ediciones.some(({ antes, despues }) => {
    if (!tenia(antes) || tenia(despues)) return false;
    if (de.comercioId) return antes!.comercioId === de.comercioId;
    return !antes!.comercioId && !!de.categoriaId && antes!.categoriaId === de.categoriaId;
  });
}

const DIAS_SIN_GASTOS_DE_VIAJE = 2;
const MAX_DIAS_PARA_AVISAR = 14;

/**
 * El cierre de un viaje, para el revisor nocturno: dos días sin gastos con su etiqueta, se avisa cuánto costó
 * ("Tu viaje a Cancún: $8,450 en 23 gastos"). Una vez por viaje.
 */
export function viajesTerminados(ctx: Contexto): AvisoNuevo[] {
  if (!etiquetasAutoHabilitadas(ctx.db, ctx.usuarioId)) return [];
  const viajes = listarVigentes(ctx).filter((e) => esDeViaje(e.nombre));
  if (!viajes.length) return [];
  const filas = ctx.db
    .select()
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn), gte(movimientos.fecha, sumarDias(ctx.hoy, -DIAS_PARA_CASA))))
    .all();
  const avisos: AvisoNuevo[] = [];
  for (const e of viajes) {
    const suyos = filas.filter((m) => m.etiquetas.includes(e.id) && m.tipo === "gasto" && m.moneda === ctx.monedaBase);
    if (suyos.length < 2) continue;
    const fechas = suyos.map((m) => m.fecha).sort();
    const [primero, ultimo] = [fechas[0]!, fechas.at(-1)!];
    if (ultimo > sumarDias(ctx.hoy, -DIAS_SIN_GASTOS_DE_VIAJE) || ultimo < sumarDias(ctx.hoy, -MAX_DIAS_PARA_AVISAR)) continue;
    const total = suyos.reduce((s, m) => s + m.montoCentavos, 0);
    const destino = e.nombre.replace(/^viaje\s+/i, "");
    const [, mesA, diaA] = primero.split("-").map(Number) as [number, number, number];
    const [, mesB, diaB] = ultimo.split("-").map(Number) as [number, number, number];
    const cuando = primero === ultimo ? `el ${diaA} de ${NOMBRES_MES[mesA]}` : mesA === mesB ? `del ${diaA} al ${diaB} de ${NOMBRES_MES[mesB]}` : `del ${diaA} de ${NOMBRES_MES[mesA]} al ${diaB} de ${NOMBRES_MES[mesB]}`;
    avisos.push({
      tipo: "viaje",
      clave: `viaje:${e.id}:${ultimo}`,
      titulo: /^\p{Ll}/u.test(destino) ? `Tu viaje de ${destino}` : `Tu viaje a ${destino}`,
      texto: `Gastaste ${formatearMonto(total, ctx.monedaBase)} en ${suyos.length} gastos, ${cuando}.`,
      prioridad: 3,
      vence: sumarDias(ctx.hoy, 7),
      enlace: `#movimientos?etiqueta=${e.id}`,
    });
  }
  return avisos;
}
