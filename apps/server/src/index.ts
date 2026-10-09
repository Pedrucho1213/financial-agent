import { precalentar, reanudarPendientes, terminarEnCurso } from "./ai/asistente";
import { crearControlIa, ollamaControl } from "./ai/encendido";
import { crearModelo, esNube, esOllama, estadoModelo, modeloLocal } from "./ai/modelo";
import { crearApp } from "./app";
import { config } from "./config";
import { abrirBaseDatos } from "./db/client";
import { enviarAvisosDelDia } from "./push/avisos-manana";
import { avisoDeDictado } from "./push/dictados";
import { tienePush } from "./push/notificaciones";
import { programarRevisor, revisarPendientes } from "./finanzas/revisor";

const db = abrirBaseDatos(config.baseDatos);
// Interruptor de la IA (desarrollo): solo con Ollama, que es al que se le puede decir cuánto mantenerla. Con Claude,
// controla el modelo de respaldo, que por omisión no ocupa memoria: se carga cuando Claude falla y se suelta
// tras 10 min sin uso.
const local = modeloLocal(config.ia);
const respaldo = esNube(config.ia.modelo);
const controlIa =
  config.ia.interruptor && esOllama(config.ia) && local
    ? crearControlIa({
        db,
        modelo: local,
        ollama: ollamaControl(config.ia.ollamaUrl, local),
        respaldo,
        porOmision: respaldo ? { siempre: false, minutos: 10 } : undefined,
      })
    : undefined;
const deps = {
  db,
  modelo: crearModelo(config.ia, config.ia.modelo, controlIa?.trasUsar),
  zonaHoraria: config.zonaHoraria,
  monedaBase: config.moneda,
  razonamientoDificil: config.ia.razonamientoDificil,
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
  estadoIa: () => estadoModelo(config.ia),
  controlIa,
  version: versionDelCodigo(),
});

// En modo "siempre encendida", revisa cada minuto que siga en memoria (Ollama pudo reiniciarse); con plazo, que no
// se quede cargada de más.
const dejarDeVigilar = controlIa?.vigilar();
if (controlIa) {
  const m = controlIa.modo();
  const quien = respaldo ? `IA de respaldo (${local})` : "IA";
  const cuando = m.siempre ? "siempre encendida" : respaldo ? `se carga si Claude falla y se apaga tras ${m.minutos} min sin uso` : `se apaga tras ${m.minutos} min sin uso`;
  console.log(`${quien}: ${cuando} (se cambia en Ajustes › Sistema).`);
}

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
  dejarDeVigilar?.();
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
