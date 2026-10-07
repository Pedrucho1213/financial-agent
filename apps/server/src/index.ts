import { precalentar, reanudarPendientes } from "./ai/asistente";
import { crearModelo, estadoModelo } from "./ai/modelo";
import { crearApp } from "./app";
import { config } from "./config";
import { abrirBaseDatos } from "./db/client";

const db = abrirBaseDatos(config.baseDatos);
const deps = { db, modelo: crearModelo(config.ia), zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
const app = crearApp({
  ...deps,
  espera: config.espera,
  despertar: (usuarioId) => precalentar(deps, usuarioId),
  carpetaWeb: config.carpetaWeb,
  estadoIa: () => estadoModelo(config.ia),
  version: versionDelCodigo(),
});

Bun.serve({ hostname: config.host, port: config.puerto, fetch: app.fetch, idleTimeout: 120 });
const retomados = reanudarPendientes(deps);
if (retomados) console.log(`Retomando ${retomados} dictado(s) que quedaron a medias.`);
console.log(`Asistente financiero escuchando en http://${config.host}:${config.puerto} con el modelo ${config.ia.modelo}`);

/** Commit que corre y su fecha (lo que se desplegó), leídos una vez al arrancar. */
function versionDelCodigo() {
  const git = (...args: string[]) => {
    try {
      const r = Bun.spawnSync(["git", ...args], { cwd: import.meta.dir, stderr: "ignore" });
      return r.success ? r.stdout.toString().trim() || null : null;
    } catch {
      return null;
    }
  };
  const [commit, commitEn] = (git("log", "-1", "--format=%h %cI") ?? "").split(" ");
  return { commit: commit || null, commitEn: commitEn || null };
}
