// Configuración desde variables de entorno. Bun carga .env automáticamente.
import { join } from "node:path";

const env = (nombre: string, porDefecto: string) => process.env[nombre]?.trim() || porDefecto;

export const config = {
  host: env("HOST", "127.0.0.1"),
  puerto: Number(env("PUERTO", "8787")),
  baseDatos: env("BASE_DATOS", "./datos/finanzas.db"),
  zonaHoraria: env("ZONA_HORARIA", "America/Mexico_City"),
  moneda: env("MONEDA", "MXN"),
  // La PWA compilada (bun run web:build), servida en la misma dirección que la API.
  carpetaWeb: env("CARPETA_WEB", join(import.meta.dir, "../../web/dist")),
  // Cuánto espera el iPhone a la IA. Si tarda más, la Mac contesta "anotado" y lo termina sola.
  // A una pregunta se le da más tiempo porque la respuesta es lo que importa.
  espera: {
    registroMs: Number(env("ESPERA_REGISTRO_MS", "5000")),
    preguntaMs: Number(env("ESPERA_PREGUNTA_MS", "30000")),
  },
  ia: {
    // Cualquier API compatible con OpenAI: Ollama, LM Studio, Osaurus o un proveedor en la nube.
    url: env("IA_URL", "http://localhost:11434/v1"),
    modelo: env("IA_MODELO", "gemma4:12b-it-qat"),
    apiKey: env("IA_API_KEY", "ollama"),
    // Solo para Ollama: permite despertar el modelo antes de que termines de dictar.
    ollamaUrl: process.env.OLLAMA_URL?.trim() || "http://localhost:11434",
    // Ollama 0.32.5 todavía ignora este valor en su API compatible con OpenAI y usa OLLAMA_KEEP_ALIVE
    // (5 minutos por omisión); se manda igual para cuando lo lea. Abrir el Atajo vuelve a cargarlo.
    mantenerCargado: env("IA_MANTENER_CARGADO", "5m"),
    // Cuánto "piensa" el modelo antes de responder (none, low, medium, high; "no" para no mandarlo).
    // gemma4 acierta igual sin razonar y así contesta en segundos; gpt-oss necesita al menos low.
    razonamiento: env("IA_RAZONAMIENTO", "none"),
    // Cuántos usuarios atiende la IA a la vez. Tiene que coincidir con OLLAMA_NUM_PARALLEL del servicio
    // de Ollama; los dictados de un mismo usuario siempre van de uno en uno.
    paralelo: Math.max(1, Math.floor(Number(env("IA_PARALELO", "1"))) || 1),
  },
};

export type Config = typeof config;
