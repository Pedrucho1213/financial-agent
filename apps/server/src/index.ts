import { precalentar, reanudarPendientes, terminarEnCurso } from "./ai/asistente";
import { crearModelo } from "./ai/modelo";
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
});

const servidor = Bun.serve({ hostname: config.host, port: config.puerto, fetch: app.fetch, idleTimeout: 120 });
const retomados = reanudarPendientes(deps);
if (retomados) console.log(`Retomando ${retomados} dictado(s) que quedaron a medias.`);
console.log(`Asistente financiero escuchando en http://${config.host}:${config.puerto} con el modelo ${config.ia.modelo}`);

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
