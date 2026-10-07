import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// launchd reinicia el servidor con SIGTERM al actualizar: tiene que terminar lo abierto y salir limpio.
test("con SIGTERM deja de aceptar conexiones, termina lo que tiene y sale con 0", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "fa-apagado-"));
  const puerto = String(20000 + Math.floor(Math.random() * 20000));
  const proceso = Bun.spawn(["bun", "src/index.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, HOST: "127.0.0.1", PUERTO: puerto, BASE_DATOS: join(carpeta, "f.db"), IA_URL: "http://127.0.0.1:9/v1", OLLAMA_URL: "http://127.0.0.1:9" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const salida = new Response(proceso.stdout).text();
    let listo = false;
    for (let i = 0; i < 100 && !listo; i++) {
      listo = await fetch(`http://127.0.0.1:${puerto}/salud`).then((r) => r.ok, () => false);
      if (!listo) await Bun.sleep(100);
    }
    expect(listo).toBe(true);
    proceso.kill("SIGTERM");
    expect(await proceso.exited).toBe(0);
    expect(await salida).toContain("SIGTERM: termino lo que está en curso");
    expect(await fetch(`http://127.0.0.1:${puerto}/salud`).then(() => "responde", () => "apagado")).toBe("apagado");
  } finally {
    proceso.kill("SIGKILL");
    rmSync(carpeta, { recursive: true, force: true });
  }
}, 20_000);
