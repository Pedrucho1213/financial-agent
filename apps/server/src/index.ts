import { precalentar, reanudarPendientes, terminarEnCurso } from "./ai/asistente";
import { crearModelo } from "./ai/modelo";
import { crearApp } from "./app";
import { config } from "./config";
import { abrirBaseDatos } from "./db/client";
import { enviarAvisosDelDia } from "./push/avisos-manana";
import { avisoDeDictado } from "./push/dictados";
import { tienePush } from "./push/notificaciones";
import { programarRevisor, revisarPendientes } from "./finanzas/revisor";

const db = abrirBaseDatos(config.baseDatos);
const deps = {
  db,
  modelo: crearModelo(config.ia),
  zonaHoraria: config.zonaHoraria,
  monedaBase: config.moneda,
  // Lo que se termina sin que nadie lo espere (también lo retomado al arrancar) llega por notificación.
  alTerminarSinEspera: avisoDeDictado(db),
  notificaSinEspera: (usuarioId: string) => tienePush(db, usuarioId),
  paralelo: config.ia.paralelo,
};
const app = crearApp({
  ...deps,
  espera: config.espera,
  despertar: (usuarioId) => precalentar(deps, usuarioId),
  carpetaWeb: config.carpetaWeb,
  contactoPush: config.contactoPush,
});

const servidor = Bun.serve({ hostname: config.host, port: config.puerto, fetch: app.fetch, idleTimeout: 120 });
const retomados = reanudarPendientes(deps);
if (retomados) console.log(`Retomando ${retomados} dictado(s) que quedaron a medias.`);

// Los avisos del revisor nocturno salen como notificación en la mañana (ver HORARIO_AVISOS).
const revisarAvisos = () =>
  enviarAvisosDelDia(db, config.zonaHoraria).catch((error) => console.error("No se pudieron mandar los avisos:", error));
setInterval(revisarAvisos, 5 * 60_000);
void revisarAvisos();
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
