import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export type Db = ReturnType<typeof abrirBaseDatos>;

const carpetaMigraciones = join(import.meta.dir, "../../drizzle");

/** Abre (o crea) la base y aplica las migraciones pendientes. Usa ":memory:" en pruebas. */
export function abrirBaseDatos(ruta: string) {
  if (ruta !== ":memory:") mkdirSync(dirname(ruta), { recursive: true });
  const sqlite = new Database(ruta, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: carpetaMigraciones });
  return db;
}
