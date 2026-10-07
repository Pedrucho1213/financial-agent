import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema";

export type Db = ReturnType<typeof abrirBaseDatos>;

const carpetaMigraciones = join(import.meta.dir, "../../drizzle");
const RESPALDOS_A_GUARDAR = 10;

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
 */
function respaldarAntesDeMigrar(sqlite: Database, ruta: string) {
  const hayTabla = sqlite.query("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
  const ultima = hayTabla
    ? Number(sqlite.query<{ creada: number | null }, []>("select max(created_at) as creada from __drizzle_migrations").get()?.creada ?? 0)
    : 0;
  const pendientes = readMigrationFiles({ migrationsFolder: carpetaMigraciones }).filter((m) => ultima < m.folderMillis);
  if (pendientes.length === 0) return;
  const carpeta = join(dirname(ruta), "respaldos");
  mkdirSync(carpeta, { recursive: true });
  const destino = join(carpeta, `antes-migrar-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  sqlite.query("VACUUM INTO ?").run(destino);
  console.log(`Base respaldada en ${destino} antes de ${pendientes.length} migración(es).`);
  readdirSync(carpeta)
    .filter((f) => f.startsWith("antes-migrar-") && f.endsWith(".db"))
    .sort()
    .slice(0, -RESPALDOS_A_GUARDAR)
    .forEach((f) => rmSync(join(carpeta, f)));
}
