// Cuánta memoria y cuánto tiempo cuesta que la IA atienda a varios usuarios a la vez.
// Levanta un Ollama aparte (otro puerto, mismos modelos) con OLLAMA_NUM_PARALLEL = 1, 2, 3...
// y para cada nivel mide la memoria del modelo cargado y cuánto tardan varios usuarios que dictan juntos.
// No toca el Ollama del servicio, pero compite con él: se niega a correr si el modelo está cargado ahí.
// Uso: bun run eval:paralelo [-- --niveles 1,2,3 --usuarios 3 --contexto 32768 --forzar]
import { parseArgs } from "node:util";
import { hablar } from "../src/ai/asistente";
import { crearModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    modelo: { type: "string", default: config.ia.modelo },
    niveles: { type: "string", default: "1,2,3" },
    usuarios: { type: "string", default: "3" },
    // Sin valor, el contexto por omisión de Ollama (32k en esta Mac), igual que el servicio.
    contexto: { type: "string" },
    puerto: { type: "string", default: "11435" },
    forzar: { type: "boolean", default: false },
  },
});
const nombre = values.modelo!;
const niveles = values.niveles!.split(",").map(Number);
const usuarios = Number(values.usuarios);
const url = `http://127.0.0.1:${values.puerto}`;
const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

const FRASES = [
  "Gasté 85 pesos en un café",
  "Pagué 230 de Uber",
  "Compré despensa por 1250",
  "Fueron 400 de gasolina",
  "Comí tacos por 180",
];

async function cargadoEnServicio(): Promise<boolean> {
  const r = await fetch(`${config.ia.ollamaUrl}/api/ps`).catch(() => undefined);
  if (!r?.ok) return false;
  const { models } = (await r.json()) as { models: unknown[] };
  return models.length > 0;
}

/** Memoria residente de los procesos hijos del Ollama de prueba (el runner con el modelo). */
async function memoriaRunner(pid: number): Promise<number> {
  const hijos = (await Bun.$`pgrep -P ${pid}`.nothrow().text()).split("\n").filter(Boolean);
  let kb = 0;
  for (const hijo of hijos) kb += Number((await Bun.$`ps -o rss= -p ${hijo}`.nothrow().text()).trim() || 0);
  return kb * 1024;
}

async function levantar(paralelo: number) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OLLAMA_HOST: `127.0.0.1:${values.puerto}`,
    OLLAMA_NUM_PARALLEL: String(paralelo),
    OLLAMA_MAX_LOADED_MODELS: "1",
    OLLAMA_KEEP_ALIVE: "2m",
    // Igual que el servicio de Homebrew.
    OLLAMA_FLASH_ATTENTION: process.env.OLLAMA_FLASH_ATTENTION ?? "1",
    OLLAMA_KV_CACHE_TYPE: process.env.OLLAMA_KV_CACHE_TYPE ?? "q8_0",
  };
  if (values.contexto) env.OLLAMA_CONTEXT_LENGTH = values.contexto;
  const proceso = Bun.spawn(["ollama", "serve"], { env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${url}/api/version`).then((r) => r.ok, () => false)) return proceso;
    await Bun.sleep(200);
  }
  proceso.kill();
  throw new Error(`El Ollama de prueba no arrancó en ${url}`);
}

function base(cuantos: number) {
  const db = abrirBaseDatos(":memory:");
  const ids = Array.from({ length: cuantos }, (_, i) => {
    const usuario = crearUsuario(db, `Prueba ${i + 1}`);
    sembrarCategorias(db, usuario.id);
    return usuario.id;
  });
  return { db, ids };
}

/** Cada usuario dicta una frase, todos al mismo tiempo. Devuelve cuánto tardó cada uno. */
async function rafaga(deps: Parameters<typeof hablar>[0], ids: string[], vuelta: number): Promise<number[]> {
  return Promise.all(
    ids.map(async (id, i) => {
      const inicio = performance.now();
      await hablar(deps, id, { texto: FRASES[(i + vuelta) % FRASES.length]!, clientId: crypto.randomUUID() });
      return performance.now() - inicio;
    }),
  );
}

const resumen = (tiempos: number[]) => {
  const orden = [...tiempos].sort((a, b) => a - b);
  return `el primero ${segundos(orden[0]!)}, el último ${segundos(orden.at(-1)!)}`;
};

if (!values.forzar && (await cargadoEnServicio())) {
  console.error("El modelo está cargado en el Ollama del servicio: alguien está usando la IA. Prueba más tarde o usa --forzar.");
  process.exit(1);
}

console.log(`Modelo ${nombre}; contexto ${values.contexto ?? "por omisión"}; ${usuarios} usuarios dictando a la vez`);
for (const paralelo of niveles) {
  const proceso = await levantar(paralelo);
  try {
    const modelo = crearModelo({ ...config.ia, url: `${url}/v1`, ollamaUrl: url }, nombre);
    // Un usuario solo: carga el modelo y deja su prefijo en caché.
    const solo = base(1);
    const depsSolo = { db: solo.db, modelo, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda, paralelo };
    await rafaga(depsSolo, solo.ids, 0);
    const [unoCaliente] = await rafaga(depsSolo, solo.ids, 1);
    const memoria = await memoriaRunner(proceso.pid);

    // Varios usuarios nuevos a la vez (cada uno procesa sus instrucciones) y luego otra vez, ya en caliente.
    const varios = base(usuarios);
    const deps = { db: varios.db, modelo, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda, paralelo };
    const frios = await rafaga(deps, varios.ids, 0);
    const calientes = await rafaga(deps, varios.ids, 1);
    const memoriaDespues = await memoriaRunner(proceso.pid);

    console.log(`\nOLLAMA_NUM_PARALLEL=${paralelo}`);
    console.log(`  Memoria del runner: ${gb(memoria)} con un usuario; ${gb(memoriaDespues)} después de ${usuarios}`);
    console.log(`  Un usuario solo, en caliente: ${segundos(unoCaliente!)}`);
    console.log(`  ${usuarios} a la vez, primera vez de cada uno: ${resumen(frios)}`);
    console.log(`  ${usuarios} a la vez, en caliente: ${resumen(calientes)}`);
  } finally {
    proceso.kill();
    await proceso.exited;
    await Bun.sleep(1000);
  }
}
