// Lectura del estado para la batería (qa/bateria.ts). Lo que depende de la tanda nueva (saldos, límites,
// tags) se lee aquí; cuando un PR cambie el modelo de datos, solo se ajusta este archivo.
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../src/db/client";
import { cuentas, movimientos } from "../src/db/schema";
import { normalizar } from "../src/lib/texto";

export type Mov = typeof movimientos.$inferSelect;
export type Cuenta = typeof cuentas.$inferSelect & Record<string, unknown>;

export type Foto = {
  movs: Mov[];
  cuentas: Cuenta[];
  /** Saldos y crédito por cuenta, en pesos; undefined si el servidor todavía no los sabe calcular. */
  credito: Map<string, { saldo?: number; limite?: number; usado?: number; disponible?: number }> | undefined;
  /** Etiquetas por id de movimiento; undefined si no hay tags todavía. */
  tags: Map<string, string[]> | undefined;
};

const pesos = (centavos: unknown) => (typeof centavos === "number" ? centavos / 100 : undefined);

/**
 * Saldos, límites, usado y disponible. Se prueban, en orden, las funciones que la tanda nueva pueda
 * exportar; si no hay ninguna, se usan columnas de la tabla `cuentas` con esos nombres.
 */
type Base = { zonaHoraria: string; monedaBase: string };

async function leerCredito(db: Db, usuarioId: string, filas: Cuenta[], base?: Base): Promise<Foto["credito"]> {
  // PR #38: estadosDeCuentas(ctx). saldo de crédito = -deuda; usado = deuda; null = no se sabe.
  if (base) {
    try {
      const m = (await import("../src/finanzas/cuentas")) as Record<string, unknown>;
      const { crearContexto } = await import("../src/finanzas/contexto");
      if (typeof m.estadosDeCuentas === "function") {
        const ctx = crearContexto({ db, usuarioId, ...base } as never);
        const estados = (m.estadosDeCuentas as (c: unknown) => Record<string, unknown>[])(ctx);
        const mapa = new Map<string, { saldo?: number; limite?: number; usado?: number; disponible?: number }>();
        for (const e of estados)
          mapa.set(String(e.id), {
            saldo: pesos(e.saldoCentavos),
            limite: pesos(e.limiteCentavos),
            usado: pesos(e.deudaCentavos),
            disponible: pesos(e.disponibleCentavos),
          });
        return mapa;
      }
    } catch {
      // Sin la tanda de cuentas todavía.
    }
  }
  for (const ruta of ["../src/finanzas/cuentas", "../src/finanzas/saldos"]) {
    try {
      const m = (await import(ruta)) as Record<string, unknown>;
      const f = (m.estadoDeCuentas ?? m.listarCuentas ?? m.saldos ?? m.resumenCuentas) as
        | ((db: Db, usuarioId: string) => unknown)
        | undefined;
      if (typeof f !== "function") continue;
      const r = (await f(db, usuarioId)) as unknown;
      const lista = (Array.isArray(r) ? r : ((r as { cuentas?: unknown[] })?.cuentas ?? [])) as Record<string, unknown>[];
      const mapa = new Map<string, { saldo?: number; limite?: number; usado?: number; disponible?: number }>();
      for (const c of lista) {
        const num = (k: string) => pesos(c[`${k}Centavos`]) ?? (typeof c[k] === "number" ? (c[k] as number) : undefined);
        mapa.set(String(c.id ?? c.nombre), { saldo: num("saldo"), limite: num("limite"), usado: num("usado"), disponible: num("disponible") });
      }
      return mapa;
    } catch {
      // Ese módulo no existe todavía.
    }
  }
  const columnas = filas[0] ? Object.keys(filas[0]) : [];
  if (!columnas.some((k) => /saldo|limite|usado|disponible/i.test(k))) return undefined;
  const mapa = new Map<string, { saldo?: number; limite?: number; usado?: number; disponible?: number }>();
  for (const c of filas) {
    const num = (k: string) => pesos(c[`${k}Centavos`]);
    mapa.set(c.id, { saldo: num("saldo"), limite: num("limite"), usado: num("usado"), disponible: num("disponible") });
  }
  return mapa;
}

async function leerTags(db: Db, movs: Mov[]): Promise<Foto["tags"]> {
  // PR #38: movimientos.etiquetas es un arreglo JSON de ids; la tabla etiquetas da el nombre.
  const schema = (await import("../src/db/schema")) as Record<string, unknown>;
  if (schema.etiquetas && movs.length && "etiquetas" in (movs[0] as object)) {
    const filas = (db as unknown as { select: () => { from: (t: never) => { all: () => Record<string, unknown>[] } } })
      .select()
      .from(schema.etiquetas as never)
      .all();
    const nombres = new Map(filas.map((e) => [String(e.id), normalizar(String(e.nombre)).replace(/^#/, "")]));
    const mapa = new Map<string, string[]>();
    for (const m of movs) {
      const ids = ((m as unknown as { etiquetas?: string[] }).etiquetas ?? []) as string[];
      mapa.set(m.id, ids.map((id) => nombres.get(id) ?? "").filter(Boolean));
    }
    return mapa;
  }
  try {
    const schema = (await import("../src/db/schema")) as Record<string, unknown>;
    const tabla = (schema.movimientosEtiquetas ?? schema.etiquetasMovimientos ?? schema.movimientoTags) as never;
    const etiquetas = (schema.etiquetas ?? schema.tags) as never;
    if (!tabla || !etiquetas) return undefined;
    const filas = (db as unknown as { select: () => { from: (t: never) => { all: () => Record<string, unknown>[] } } }).select().from(tabla).all();
    const nombres = new Map(
      (db as unknown as { select: () => { from: (t: never) => { all: () => Record<string, unknown>[] } } })
        .select()
        .from(etiquetas)
        .all()
        .map((e) => [String(e.id), String(e.nombre)]),
    );
    const mapa = new Map<string, string[]>();
    for (const f of filas) {
      const mov = String(f.movimientoId);
      const nombre = nombres.get(String(f.etiquetaId ?? f.tagId)) ?? "";
      mapa.set(mov, [...(mapa.get(mov) ?? []), normalizar(nombre).replace(/^#/, "")]);
    }
    return mapa;
  } catch {
    return undefined;
  }
}

export async function fotografiar(db: Db, usuarioId: string, base?: Base): Promise<Foto> {
  const movs = db.select().from(movimientos).where(and(eq(movimientos.usuarioId, usuarioId), isNull(movimientos.eliminadoEn))).all();
  const filas = db.select().from(cuentas).where(eq(cuentas.usuarioId, usuarioId)).all() as Cuenta[];
  return { movs, cuentas: filas, credito: await leerCredito(db, usuarioId, filas, base), tags: await leerTags(db, movs) };
}

/** La cuenta cuyo nombre o alias contiene `nombre` (sin acentos ni mayúsculas). */
export function cuentaPorNombre(f: Foto, nombre: string): Cuenta | undefined {
  const buscado = normalizar(nombre);
  return f.cuentas.find((c) => [c.nombre, ...(c.alias ?? [])].some((n) => normalizar(String(n)).includes(buscado)));
}
