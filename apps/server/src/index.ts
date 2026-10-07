import { precalentar, reanudarPendientes, terminarEnCurso } from "./ai/asistente";
import { crearModelo, estadoModelo } from "./ai/modelo";
import { crearApp } from "./app";
import { config } from "./config";
import { abrirBaseDatos } from "./db/client";
import { programarRevisor, revisarPendientes } from "./finanzas/revisor";

const db = abrirBaseDatos(config.baseDatos);
const deps = {
  db,
  modelo: crearModelo(config.ia),
  zonaHoraria: config.zonaHoraria,
  monedaBase: config.moneda,
  paralelo: config.ia.paralelo,
};
const app = crearApp({
  ...deps,
  espera: config.espera,
  despertar: (usuarioId) => precalentar(deps, usuarioId),
  carpetaWeb: config.carpetaWeb,
  estadoIa: () => estadoModelo(config.ia),
  version: versionDelCodigo(),
});

const servidor = Bun.serve({ hostname: config.host, port: config.puerto, fetch: app.fetch, idleTimeout: 120 });
const retomados = reanudarPendientes(deps);
if (retomados) console.log(`Retomando ${retomados} dictado(s) que quedaron a medias.`);
console.log(`Asistente financiero escuchando en http://${config.host}:${config.puerto} con el modelo ${config.ia.modelo}`);

// Una vez al día, desde las 3 de la mañana y con la Mac sin uso, busca fugas y cobros que vienen.
// No usa el modelo de IA: no lo carga ni lo mantiene en memoria.
const revisor = { db, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
revisarPendientes(revisor);
programarRevisor(revisor);

// Una actualización reinicia el servidor (launchd manda SIGTERM): deja de aceptar conexiones, termina
// las peticiones abiertas y los dictados en curso, y se apaga. Lo que no alcance se retoma al arrancar.
let apagando = false;
async function apagar(senal: string) {
  // Una segunda señal (otro Ctrl-C) apaga sin esperar.
  if (apagando) process.exit(1);
  apagando = true;
  console.log(`${senal}: termino lo que está en curso y me apago.`);
  await Promise.race([servidor.stop(), Bun.sleep(30_000)]);
  const quedan = await terminarEnCurso(10_000);
  if (quedan) console.log(`Quedan ${quedan} dictado(s) a medias; se retoman al arrancar.`);
  process.exit(0);
}
process.on("SIGTERM", () => void apagar("SIGTERM"));
process.on("SIGINT", () => void apagar("SIGINT"));

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
