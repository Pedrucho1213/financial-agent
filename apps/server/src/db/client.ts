import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema";

export type Db = ReturnType<typeof abrirBaseDatos>;

const carpetaMigraciones = join(import.meta.dir, "../../drizzle");
const RESPALDOS_A_GUARDAR = 10;
// Si una migración falla, launchd reinicia el servidor cada 10 s: no hace falta otro respaldo igual.
const RESPALDO_RECIENTE_MS = 10 * 60_000;

/** Abre (o crea) la base y aplica las migraciones pendientes. Usa ":memory:" en pruebas. */
export function abrirBaseDatos(ruta: string) {
  const existia = ruta !== ":memory:" && existsSync(ruta);
  if (ruta !== ":memory:") mkdirSync(dirname(ruta), { recursive: true });
  const sqlite = new Database(ruta, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  if (existia) respaldarAntesDeMigrar(sqlite, ruta);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: carpetaMigraciones });
  return db;
}

/**
 * Si hay migraciones pendientes, copia la base a `respaldos/antes-migrar-<fecha>.db` junto a ella, para
 * que el actualizador pueda regresarla si la versión nueva no arranca. Si no se puede respaldar, no migra.
 * Si ya hay uno de los últimos 10 minutos con las mismas migraciones aplicadas, no hace otro.
 */
function respaldarAntesDeMigrar(sqlite: Database, ruta: string) {
  const { aplicadas, ultima } = migracionesAplicadas(sqlite);
  const pendientes = readMigrationFiles({ migrationsFolder: carpetaMigraciones }).filter((m) => ultima < m.folderMillis);
  if (pendientes.length === 0) return;
  const carpeta = join(dirname(ruta), "respaldos");
  mkdirSync(carpeta, { recursive: true });
  const respaldos = readdirSync(carpeta).filter((f) => f.startsWith("antes-migrar-") && f.endsWith(".db"));
  const igual = respaldos.find((f) => {
    const archivo = join(carpeta, f);
    if (Date.now() - statSync(archivo).mtimeMs > RESPALDO_RECIENTE_MS) return false;
    try {
      const otro = new Database(archivo, { readonly: true });
      const iguales = migracionesAplicadas(otro).aplicadas === aplicadas;
      otro.close();
      return iguales;
    } catch {
      return false;
    }
  });
  if (igual) {
    console.log(`Ya respaldé esta base hace menos de 10 minutos (${join(carpeta, igual)}); no hago otro respaldo.`);
    return;
  }
  const destino = join(carpeta, `antes-migrar-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  sqlite.query("VACUUM INTO ?").run(destino);
  console.log(`Base respaldada en ${destino} antes de ${pendientes.length} migración(es).`);
  [...respaldos, destino.slice(carpeta.length + 1)]
    .sort()
    .slice(0, -RESPALDOS_A_GUARDAR)
    .forEach((f) => rmSync(join(carpeta, f)));
}

function migracionesAplicadas(sqlite: Database) {
  const hayTabla = sqlite.query("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
  if (!hayTabla) return { aplicadas: 0, ultima: 0 };
  const fila = sqlite.query<{ n: number; ultima: number | null }, []>("select count(*) as n, max(created_at) as ultima from __drizzle_migrations").get();
  return { aplicadas: fila?.n ?? 0, ultima: Number(fila?.ultima ?? 0) };
}
