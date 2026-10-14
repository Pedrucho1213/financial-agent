// Qué avisos quiere cada cuenta por notificación y en qué horario (Ajustes › Notificaciones).
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { type PreferenciasAvisos, type TIPOS_AVISO, usuarios } from "../db/schema";

export type GrupoAviso = keyof NonNullable<PreferenciasAvisos["tipos"]>;
export const GRUPOS_AVISO: readonly GrupoAviso[] = ["cobros", "tarjetas", "presupuestos", "fugas", "deudas"];

/** A qué grupo de Ajustes pertenece cada aviso del revisor. */
export const GRUPO_DE_AVISO: Record<(typeof TIPOS_AVISO)[number], GrupoAviso> = {
  cobro_proximo: "cobros",
  msi: "cobros",
  tarjeta_pago: "tarjetas",
  tarjeta_limite: "tarjetas",
  presupuesto: "presupuestos",
  meta: "presupuestos",
  hormiga: "fugas",
  suscripcion_olvidada: "fugas",
  suscripcion_duplicada: "fugas",
  gasto_inusual: "fugas",
  prestamo: "deudas",
};

/** Lo de siempre: todo encendido, de 9 a 21 h. */
export const HORARIO_POR_OMISION = { desde: 9, hasta: 21 };

export type Preferencias = { tipos: Record<GrupoAviso, boolean>; desde: number; hasta: number };

export function preferenciasDe(db: Db, usuarioId: string): Preferencias {
  const guardadas = db.select({ p: usuarios.preferenciasAvisos }).from(usuarios).where(eq(usuarios.id, usuarioId)).get()?.p ?? {};
  const tipos = Object.fromEntries(GRUPOS_AVISO.map((g) => [g, guardadas.tipos?.[g] ?? true])) as Record<GrupoAviso, boolean>;
  const desde = guardadas.desde ?? HORARIO_POR_OMISION.desde;
  const hasta = guardadas.hasta ?? HORARIO_POR_OMISION.hasta;
  return { tipos, desde, hasta: hasta > desde ? hasta : HORARIO_POR_OMISION.hasta };
}

export function guardarPreferencias(db: Db, usuarioId: string, cambios: PreferenciasAvisos): Preferencias {
  const actuales = preferenciasDe(db, usuarioId);
  const desde = cambios.desde ?? actuales.desde;
  const hasta = cambios.hasta ?? actuales.hasta;
  if (!(desde >= 0 && desde <= 23 && hasta >= 1 && hasta <= 24 && hasta > desde)) throw new Error("El horario no es válido.");
  const nuevas: PreferenciasAvisos = { tipos: { ...actuales.tipos, ...cambios.tipos }, desde, hasta };
  db.update(usuarios).set({ preferenciasAvisos: nuevas }).where(eq(usuarios.id, usuarioId)).run();
  return preferenciasDe(db, usuarioId);
}

/** Si a esta hora local se le pueden mandar avisos. */
export function enHorario(p: Pick<Preferencias, "desde" | "hasta">, hora: number) {
  return hora >= p.desde && hora < p.hasta;
}
