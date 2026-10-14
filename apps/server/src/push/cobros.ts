// La pregunta de la tarde: "¿Ya se cobró Netflix?". Una sola notificación por cuenta al día, con todos los cobros que
// esperan respuesta; al tocarla se abre la hoja para confirmarlos.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { cobros, usuarios } from "../db/schema";
import { cobrosApp, cobrosHabilitado, DIAS_PARA_PREGUNTAR, MAX_NOTIFICACIONES_COBRO } from "../finanzas/cobros";
import { crearContexto } from "../finanzas/contexto";
import { formatearMonto } from "../lib/dinero";
import { fechaLocal, sumarDias } from "../lib/fechas";
import { horaLocal } from "./avisos-manana";
import { type EnviarPush, notificar, tieneSuscripciones } from "./notificaciones";
import { preferenciasDe } from "./preferencias";

/** A qué hora se pregunta (o antes, si su horario termina antes): el cargo ya suele verse en el banco. */
export const HORA_PREGUNTA_COBROS = 19;

const MAX_INTENTOS_DIA = 3;
const intentos = new Map<string, number>();

/** "Netflix", "Netflix y Spotify", "Netflix, Spotify y 2 más". */
function nombres(lista: string[]): string {
  if (lista.length === 1) return lista[0]!;
  if (lista.length === 2) return `${lista[0]} y ${lista[1]}`;
  return `${lista[0]}, ${lista[1]} y ${lista.length - 2 === 1 ? "uno más" : `${lista.length - 2} más`}`;
}

export async function enviarPreguntasDeCobros(
  db: Db,
  zonaHoraria: string,
  monedaBase: string,
  ahora = new Date(),
  enviar?: EnviarPush,
): Promise<number> {
  const hora = horaLocal(ahora, zonaHoraria);
  const hoy = fechaLocal(ahora, zonaHoraria);
  for (const clave of intentos.keys()) if (!clave.endsWith(`:${hoy}`)) intentos.delete(clave);
  let enviadas = 0;
  for (const { id: usuarioId } of db.select({ id: usuarios.id }).from(usuarios).all()) {
    if (!cobrosHabilitado(db, usuarioId)) continue;
    const preferencias = preferenciasDe(db, usuarioId);
    if (!preferencias.tipos.cobros) continue;
    // A las 7 de la tarde, o una hora antes de que termine su horario si termina antes.
    const desde = Math.max(preferencias.desde, Math.min(HORA_PREGUNTA_COBROS, preferencias.hasta - 1));
    if (hora < desde || hora >= preferencias.hasta) continue;
    if (!tieneSuscripciones(db, usuarioId)) continue;
    const clave = `${usuarioId}:${hoy}`;
    if ((intentos.get(clave) ?? 0) >= MAX_INTENTOS_DIA) continue;
    const ctx = crearContexto({ db, usuarioId, zonaHoraria, monedaBase, ahora });
    const { porConfirmar, insignia } = cobrosApp(ctx);
    const ids = porConfirmar.filter((c) => !c.pospuesto && c.fecha >= sumarDias(hoy, -DIAS_PARA_PREGUNTAR)).map((c) => c.id);
    const filas = ids.length ? db.select().from(cobros).where(inArray(cobros.id, ids)).all() : [];
    // Hoy no se le ha preguntado por ninguno, y ninguno lleva ya tres notificaciones.
    const porPreguntar = porConfirmar.filter((c) => {
      const f = filas.find((x) => x.id === c.id);
      return f && f.notificaciones < MAX_NOTIFICACIONES_COBRO && (!f.notificadoEn || fechaLocal(new Date(f.notificadoEn), zonaHoraria) !== hoy);
    });
    if (!porPreguntar.length) continue;
    const [primero] = porPreguntar;
    const titulo = porPreguntar.length === 1 ? `¿Ya se cobró ${primero!.nombre}?` : `¿Ya se cobraron ${nombres(porPreguntar.map((c) => c.nombre))}?`;
    const cuerpo =
      porPreguntar.length === 1
        ? `${formatearMonto(primero!.montoCentavos, primero!.moneda)}${primero!.cuenta ? ` en ${primero!.cuenta}` : ""}. Toca para confirmarlo.`
        : "Toca para confirmarlos; si alguno fue de otro monto, ahí lo cambias.";
    const llegaron = await notificar(
      db,
      usuarioId,
      {
        titulo,
        cuerpo,
        url: `/#inicio?confirmar=${porPreguntar.map((c) => c.id).join(",")}`,
        etiqueta: `cobros-${hoy}`,
        ttl: 12 * 3600,
        insignia,
      },
      enviar,
    );
    if (llegaron > 0) {
      for (const c of porPreguntar) {
        const f = filas.find((x) => x.id === c.id)!;
        db.update(cobros)
          .set({ notificaciones: f.notificaciones + 1, notificadoEn: ahora.toISOString() })
          .where(and(eq(cobros.id, c.id), eq(cobros.usuarioId, usuarioId)))
          .run();
      }
      enviadas++;
    } else {
      intentos.set(clave, (intentos.get(clave) ?? 0) + 1);
    }
  }
  return enviadas;
}
