import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// bun run invitar busca la cuenta por usuario o nombre: si el nombre de saludo cambió, no crea otra vacía.
test("invitar encuentra la cuenta aunque el nombre de saludo cambie y no crea otra sin --nueva", () => {
  const carpeta = mkdtempSync(join(tmpdir(), "fa-invitar-"));
  const base = join(carpeta, "f.db");
  const invitar = (...args: string[]) => {
    const r = Bun.spawnSync(["bun", "scripts/invitar.ts", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, BASE_DATOS: base },
    });
    return { salida: r.exitCode, texto: r.stdout.toString() + r.stderr.toString() };
  };
  const cuentas = () => {
    const db = new Database(base, { readonly: true });
    const filas = db.query<{ nombre: string; usuario: string }, []>("select nombre, usuario from usuarios order by creado_en").all();
    db.close();
    return filas;
  };
  try {
    // Sin cuentas, la primera se crea.
    expect(invitar("--nombre", "Pedro").texto).toContain("Creé la cuenta de Pedro");
    const db = new Database(base);
    db.run("update usuarios set nombre = 'Pedrucho'");
    db.close();
    // "Pedro" ya no es el nombre, pero sí el usuario.
    expect(invitar("--nombre", "Pedro").texto).toContain("Agrega un dispositivo a la cuenta de Pedrucho");
    expect(invitar("--usuario", "PEDRO").texto).toContain("Agrega un dispositivo a la cuenta de Pedrucho");
    const sinNueva = invitar("--nombre", "Ana");
    expect(sinNueva.salida).toBe(1);
    expect(sinNueva.texto).toContain("agrega --nueva");
    expect(invitar("--usuario", "nadie").salida).toBe(1);
    expect(cuentas()).toEqual([{ nombre: "Pedrucho", usuario: "pedro" }]);
    expect(invitar("--nombre", "Ana", "--nueva").texto).toContain("Creé la cuenta de Ana");
    expect(cuentas().map((c) => c.usuario)).toEqual(["pedro", "ana"]);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}, 30_000);
