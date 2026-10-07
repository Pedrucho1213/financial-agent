import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
    const viejo = new Date(Date.now() - 3600_000);
    for (let i = 0; i < 12; i++) {
      const archivo = join(respaldos, `antes-migrar-2000-01-${String(i + 10)}.db`);
      writeFileSync(archivo, "");
      utimesSync(archivo, viejo, viejo);
    }
    const sinMigrar = join(carpeta, "sin-migrar.db");
    cpSync(ruta, sinMigrar);

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

    // Si la migración falló y launchd reinicia el servidor, no rota los respaldos con copias iguales...
    // (Cada vuelta en otro archivo de la misma carpeta: drizzle deja la conexión anterior abierta.)
    let vuelta = 0;
    const otraVez = () => {
      const reintento = join(carpeta, `reintento-${++vuelta}.db`);
      cpSync(sinMigrar, reintento);
      abrirBaseDatos(reintento).$client.close();
      return readdirSync(respaldos).filter((f) => f.startsWith("antes-migrar-")).sort();
    };
    expect(otraVez()).toEqual(archivos);
    // ...salvo que el último tenga más de 10 minutos.
    utimesSync(nuevo, viejo, viejo);
    const despues = otraVez();
    expect(despues).toHaveLength(10);
    expect(despues.at(-1)).not.toBe(archivos.at(-1));
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
