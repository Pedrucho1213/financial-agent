import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { configuracion } from "../db/schema";

/**
 * Interruptor de la IA para desarrollo (Ajustes › Sistema, solo la cuenta dueña).
 * Decide cuánto tiempo se queda el modelo en la memoria de Ollama: siempre, o hasta N minutos sin uso.
 *
 * Ollama 0.32.5 ignora keep_alive en /v1 (ahí manda OLLAMA_KEEP_ALIVE), pero lo respeta en /api/generate.
 * Por eso, después de cada uso se le repite el keep_alive elegido con una petición vacía, y en modo
 * "siempre" un vigilante lo vuelve a cargar si Ollama se reinició o lo soltó. Todo desde el servidor:
 * no toca launchctl ni el .env de la Mac.
 *
 * Se quita antes de abrir al público con IA_INTERRUPTOR=0 (o borrando este archivo y sus tres usos).
 */

export type ModoIa = { siempre: boolean; minutos: number };

export type EstadoControlIa = ModoIa & {
  modelo: string;
  /** Apagada desde la app: el vigilante no la vuelve a cargar hasta el próximo dictado o "Encender". */
  apagadaAMano: boolean;
  /** Ollama contesta y tiene el modelo descargado. */
  disponible: boolean;
  /** El modelo está en memoria ahora. */
  cargada: boolean;
  /** Cuándo la suelta Ollama; null si no está cargada o falta más de un mes (siempre encendida). */
  hasta: string | null;
  /** Memoria que ocupa el modelo cargado, en bytes. */
  memoria: number | null;
};

export type ModeloCargado = { name: string; expires_at?: string; size?: number };

/** Lo que el interruptor necesita de Ollama; las pruebas lo reemplazan. */
export type OllamaControl = {
  /** Modelos en memoria (/api/ps); null si Ollama no contesta. */
  enMemoria(): Promise<ModeloCargado[] | null>;
  /** Modelos descargados (/api/tags); null si Ollama no contesta. */
  descargados(): Promise<string[] | null>;
  /** Carga el modelo (o lo suelta con 0) y fija cuánto se queda ("10m", "8760h"). */
  cargar(keepAlive: number | string): Promise<boolean>;
};

export type ControlIa = {
  modo(): ModoIa & { apagadaAMano: boolean };
  /** El keep_alive que corresponde al modo: SIEMPRE o "Nm". */
  keepAlive(): number | string;
  cambiar(cambio: Partial<ModoIa>): Promise<EstadoControlIa>;
  encender(): Promise<EstadoControlIa>;
  apagar(): Promise<EstadoControlIa>;
  /** Después de cada llamada al modelo: le repite a Ollama cuánto mantenerlo. */
  trasUsar(): void;
  /** Revisa cada `cadaMs` que siga cargada en modo "siempre". Devuelve cómo detenerlo. */
  vigilar(cadaMs?: number): () => void;
  estado(): Promise<EstadoControlIa>;
};

const CLAVE = "ia_encendido";
export const MINUTOS_MIN = 1;
export const MINUTOS_MAX = 24 * 60;
// "Siempre" es un año, como texto: medido en la Mac (Ollama 0.32.5), el número -1 no le cambia el plazo
// a un modelo que ya está cargado; un texto sí. Y "-1m" lo toma como los 5 minutos de siempre.
export const SIEMPRE = "8760h";
// Si Ollama la suelta antes de esto, en modo "siempre" se le vuelve a pedir el año.
const MARGEN_SIEMPRE_MS = 24 * 3_600_000;
// Un plazo de más de 30 días se muestra como sin fecha (los plazos de la app son de una hora o menos).
const SIN_FECHA_MS = 30 * 86_400_000;

type Guardado = ModoIa & { apagadaAMano: boolean };

export function crearControlIa(opciones: {
  db: Db;
  modelo: string;
  ollama: OllamaControl;
  /** Sin nada guardado: siempre encendida (lo que pidió el dueño para desarrollo). */
  porOmision?: Partial<ModoIa>;
  /** Cuánto esperar sin más usos antes de repetir el keep_alive. */
  esperaTrasUsoMs?: number;
  ahora?: () => number;
}): ControlIa {
  const { db, modelo, ollama } = opciones;
  const ahora = opciones.ahora ?? Date.now;
  const base: Guardado = { siempre: true, minutos: 10, ...opciones.porOmision, apagadaAMano: false };

  const leer = (): Guardado => {
    const fila = db.select().from(configuracion).where(eq(configuracion.clave, CLAVE)).get();
    const v = (fila?.valor ?? {}) as Partial<Guardado>;
    return {
      siempre: typeof v.siempre === "boolean" ? v.siempre : base.siempre,
      minutos: typeof v.minutos === "number" ? limitar(v.minutos) : base.minutos,
      apagadaAMano: v.apagadaAMano === true,
    };
  };
  const guardar = (valor: Guardado) =>
    db.insert(configuracion).values({ clave: CLAVE, valor }).onConflictDoUpdate({ target: configuracion.clave, set: { valor } }).run();

  const keepAlive = (m: ModoIa = leer()) => (m.siempre ? SIEMPRE : `${m.minutos}m`);

  const estado = async (): Promise<EstadoControlIa> => {
    const m = leer();
    const [ps, tags] = await Promise.all([ollama.enMemoria(), ollama.descargados()]);
    const cargado = ps?.find((x) => x.name === modelo);
    const vence = cargado?.expires_at ? Date.parse(cargado.expires_at) : Number.NaN;
    return {
      siempre: m.siempre,
      minutos: m.minutos,
      apagadaAMano: m.apagadaAMano,
      modelo,
      disponible: !!tags?.includes(modelo),
      cargada: !!cargado,
      hasta: cargado && Number.isFinite(vence) && vence - ahora() < SIN_FECHA_MS ? new Date(vence).toISOString() : null,
      memoria: cargado?.size ?? null,
    };
  };

  // Una carga a la vez: encender, apagar y el vigilante no se pisan.
  let enCurso: Promise<unknown> = Promise.resolve();
  const enFila = <T>(trabajo: () => Promise<T>): Promise<T> => {
    const siguiente = enCurso.then(trabajo, trabajo);
    enCurso = siguiente.catch(() => undefined);
    return siguiente;
  };

  let pendiente: ReturnType<typeof setTimeout> | null = null;
  const trasUsar = () => {
    if (pendiente) clearTimeout(pendiente);
    // Varias llamadas seguidas (un dictado con herramientas) cuentan como un solo uso.
    pendiente = setTimeout(() => {
      pendiente = null;
      void enFila(async () => {
        const m = leer();
        // Un dictado la volvió a cargar: ya no está "apagada a mano".
        if (m.apagadaAMano) guardar({ ...m, apagadaAMano: false });
        await ollama.cargar(keepAlive(m));
      });
    }, opciones.esperaTrasUsoMs ?? 1_000);
  };

  const revisar = () =>
    enFila(async () => {
      const m = leer();
      if (!m.siempre || m.apagadaAMano) return;
      const ps = await ollama.enMemoria();
      if (ps === null) return; // Ollama no contesta: ya lo intentará la próxima vuelta.
      const cargado = ps.find((x) => x.name === modelo);
      const vence = cargado?.expires_at ? Date.parse(cargado.expires_at) : Number.NaN;
      if (cargado && Number.isFinite(vence) && vence - ahora() > MARGEN_SIEMPRE_MS) return;
      await ollama.cargar(SIEMPRE);
    });

  return {
    modo: leer,
    keepAlive: () => keepAlive(),
    async cambiar(cambio) {
      const antes = leer();
      const despues: Guardado = {
        siempre: cambio.siempre ?? antes.siempre,
        minutos: cambio.minutos !== undefined ? limitar(cambio.minutos) : antes.minutos,
        apagadaAMano: antes.apagadaAMano,
      };
      // Pedir "siempre encendida" es pedir que se encienda ya.
      if (despues.siempre && !antes.siempre) despues.apagadaAMano = false;
      guardar(despues);
      await enFila(async () => {
        if (despues.siempre && !despues.apagadaAMano) return ollama.cargar(SIEMPRE);
        // Si ya está cargada, el nuevo plazo cuenta desde ahora; si no, se aplica al próximo uso.
        const ps = await ollama.enMemoria();
        if (ps?.some((x) => x.name === modelo)) return ollama.cargar(keepAlive(despues));
      });
      return estado();
    },
    async encender() {
      const m = leer();
      guardar({ ...m, apagadaAMano: false });
      await enFila(() => ollama.cargar(keepAlive(m)));
      return estado();
    },
    async apagar() {
      guardar({ ...leer(), apagadaAMano: true });
      if (pendiente) {
        clearTimeout(pendiente);
        pendiente = null;
      }
      await enFila(() => ollama.cargar(0));
      return estado();
    },
    trasUsar,
    vigilar(cadaMs = 60_000) {
      void revisar();
      const id = setInterval(() => void revisar(), cadaMs);
      return () => clearInterval(id);
    },
    estado,
  };
}

function limitar(minutos: number) {
  return Math.min(MINUTOS_MAX, Math.max(MINUTOS_MIN, Math.round(minutos) || MINUTOS_MIN));
}

/** El interruptor contra el Ollama real (OLLAMA_URL). */
export function ollamaControl(ollamaUrl: string, modelo: string): OllamaControl {
  const pedir = (ruta: string) =>
    fetch(`${ollamaUrl}${ruta}`, { signal: AbortSignal.timeout(2_000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ models?: ModeloCargado[] }>) : null))
      .catch(() => null);
  return {
    enMemoria: async () => (await pedir("/api/ps"))?.models ?? null,
    descargados: async () => (await pedir("/api/tags"))?.models?.map((m) => m.name) ?? null,
    async cargar(keepAlive) {
      try {
        // Sin prompt, /api/generate solo carga (o suelta, con 0) y fija el keep_alive.
        const r = await fetch(`${ollamaUrl}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: modelo, keep_alive: keepAlive }),
          signal: AbortSignal.timeout(60_000),
        });
        return r.ok;
      } catch {
        return false;
      }
    },
  };
}
