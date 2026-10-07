import { precalentar, reanudarPendientes } from "./ai/asistente";
import { crearModelo } from "./ai/modelo";
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
});

Bun.serve({ hostname: config.host, port: config.puerto, fetch: app.fetch, idleTimeout: 120 });
const retomados = reanudarPendientes(deps);
if (retomados) console.log(`Retomando ${retomados} dictado(s) que quedaron a medias.`);
console.log(`Asistente financiero escuchando en http://${config.host}:${config.puerto} con el modelo ${config.ia.modelo}`);

// Una vez al día, desde las 3 de la mañana y con la Mac sin uso, busca fugas y cobros que vienen.
// No usa el modelo de IA: no lo carga ni lo mantiene en memoria.
const revisor = { db, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
revisarPendientes(revisor);
programarRevisor(revisor);
