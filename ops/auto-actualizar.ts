// launchd corre el actualizador a través de bun: macOS ya le dio a bun permiso de entrar a Documentos
// (donde vive el repositorio), y así no aparece otra pregunta para bash.
import { join } from "node:path";

const proceso = Bun.spawnSync(["bash", join(import.meta.dir, "auto-actualizar.sh"), ...Bun.argv.slice(2)], {
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(proceso.exitCode ?? 1);
