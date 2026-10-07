import { precalentar, reanudarPendientes } from "./ai/asistente";
import { crearModelo } from "./ai/modelo";
import { crearApp } from "./app";
import { config } from "./config";
import { abrirBaseDatos } from "./db/client";
import { enviarAvisosDelDia } from "./push/avisos-manana";
import { avisoDeDictado } from "./push/dictados";
import { tienePush } from "./push/notificaciones";

const db = abrirBaseDatos(config.baseDatos);
const deps = {
  db,
  modelo: crearModelo(config.ia),
  zonaHoraria: config.zonaHoraria,
  monedaBase: config.moneda,
  // Lo que se termina sin que nadie lo espere (también lo retomado al arrancar) llega por notificación.
  alTerminarSinEspera: avisoDeDictado(db),
  notificaSinEspera: (usuarioId: string) => tienePush(db, usuarioId),
};
const app = crearApp({
  ...deps,
  espera: config.espera,
  despertar: (usuarioId) => precalentar(deps, usuarioId),
  carpetaWeb: config.carpetaWeb,
  contactoPush: config.contactoPush,
});

Bun.serve({ hostname: config.host, port: config.puerto, fetch: app.fetch, idleTimeout: 120 });
const retomados = reanudarPendientes(deps);
if (retomados) console.log(`Retomando ${retomados} dictado(s) que quedaron a medias.`);

// Los avisos del revisor nocturno salen como notificación en la mañana (ver HORARIO_AVISOS).
const revisarAvisos = () =>
  enviarAvisosDelDia(db, config.zonaHoraria).catch((error) => console.error("No se pudieron mandar los avisos:", error));
setInterval(revisarAvisos, 5 * 60_000);
void revisarAvisos();
console.log(`Asistente financiero escuchando en http://${config.host}:${config.puerto} con el modelo ${config.ia.modelo}`);
