import { precalentar, reanudarPendientes } from "./ai/asistente";
import { crearModelo } from "./ai/modelo";
import { crearApp } from "./app";
import { config } from "./config";
import { abrirBaseDatos } from "./db/client";

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
});

Bun.serve({ hostname: config.host, port: config.puerto, fetch: app.fetch, idleTimeout: 120 });
const retomados = reanudarPendientes(deps);
if (retomados) console.log(`Retomando ${retomados} dictado(s) que quedaron a medias.`);
console.log(`Asistente financiero escuchando en http://${config.host}:${config.puerto} con el modelo ${config.ia.modelo}`);
