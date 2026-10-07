import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { abrirBaseDatos } from "../src/db/client";

const migraciones = join(import.meta.dir, "../drizzle");
const aplicadas = (ruta: string) => {
  const sqlite = new Database(ruta, { readonly: true });
  const { n } = sqlite.query<{ n: number }, []>("select count(*) as n from __drizzle_migrations").get()!;
  sqlite.close();
  return n;
};

// El actualizador regresa la base a este respaldo si la versión nueva migró y no arranca.
test("respalda la base antes de aplicar migraciones pendientes y guarda los últimos 10", () => {
  const carpeta = mkdtempSync(join(tmpdir(), "fa-migrar-"));
  try {
    // Una base que se quedó dos migraciones atrás.
    const vieja = join(carpeta, "migraciones");
    cpSync(migraciones, vieja, { recursive: true });
    const diario = JSON.parse(readFileSync(join(vieja, "meta/_journal.json"), "utf8"));
    const total = diario.entries.length;
    diario.entries = diario.entries.slice(0, total - 2);
    writeFileSync(join(vieja, "meta/_journal.json"), JSON.stringify(diario));
    const ruta = join(carpeta, "finanzas.db");
    const sqlite = new Database(ruta, { create: true });
    migrate(drizzle(sqlite), { migrationsFolder: vieja });
    sqlite.close();

    const respaldos = join(carpeta, "respaldos");
    mkdirSync(respaldos);
    for (let i = 0; i < 12; i++) writeFileSync(join(respaldos, `antes-migrar-2000-01-${String(i + 10)}.db`), "");

    abrirBaseDatos(ruta).$client.close();
    const archivos = readdirSync(respaldos).filter((f) => f.startsWith("antes-migrar-")).sort();
    expect(archivos).toHaveLength(10);
    const nuevo = join(respaldos, archivos.at(-1)!);
    expect(aplicadas(nuevo)).toBe(total - 2);
    expect(aplicadas(ruta)).toBe(total);

    // Sin nada pendiente no respalda; una base nueva tampoco.
    abrirBaseDatos(ruta).$client.close();
    abrirBaseDatos(join(carpeta, "nueva.db")).$client.close();
    expect(readdirSync(respaldos).filter((f) => f.startsWith("antes-migrar-")).sort()).toEqual(archivos);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
