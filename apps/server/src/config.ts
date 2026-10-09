// Configuración desde variables de entorno. Bun carga .env automáticamente.
import { join } from "node:path";

const env = (nombre: string, porDefecto: string) => process.env[nombre]?.trim() || porDefecto;

/**
 * Qué IA contesta. Con ANTHROPIC_API_KEY en el .env (e IA_NUBE distinto de 0), Claude: IA_MODELO_NUBE para todo e
 * IA_MODELO_DIFICIL para saldos, tarjetas y correcciones; el modelo de Ollama de IA_MODELO queda de respaldo por si la
 * nube falla. Sin la clave, todo sigue con IA_MODELO como antes.
 */
export function modelosIa(e: Record<string, string | undefined>) {
  const valor = (nombre: string, porDefecto: string) => e[nombre]?.trim() || porDefecto;
  const claveNube = e.ANTHROPIC_API_KEY?.trim() || undefined;
  const elegido = valor("IA_MODELO", "gemma4:12b-it-qat");
  const conNube = !elegido.startsWith("claude-") && claveNube !== undefined && valor("IA_NUBE", "1") !== "0";
  return {
    modelo: conNube ? valor("IA_MODELO_NUBE", "claude-haiku-5-5") : elegido,
    claveNube,
    modeloDificil: valor("IA_MODELO_DIFICIL", "claude-sonnet-5-5"),
    // "no" para que nadie conteste si Claude falla.
    respaldo: valor("IA_RESPALDO", elegido.startsWith("claude-") ? "gemma4:12b-it-qat" : elegido),
  };
}

export const config = {
  host: env("HOST", "127.0.0.1"),
  puerto: Number(env("PUERTO", "8787")),
  baseDatos: env("BASE_DATOS", "./datos/finanzas.db"),
  zonaHoraria: env("ZONA_HORARIA", "America/Mexico_City"),
  moneda: env("MONEDA", "MXN"),
  // La PWA compilada (bun run web:build), servida en la misma dirección que la API.
  carpetaWeb: env("CARPETA_WEB", join(import.meta.dir, "../../web/dist")),
  // Contacto (mailto: o https:) que se le da a Apple al mandar notificaciones. Sin valor, la dirección
  // pública con la que se abrió la app.
  contactoPush: process.env.PUSH_CONTACTO?.trim() || undefined,
  // Cuánto espera el iPhone a la IA. Si tarda más, la Mac contesta "anotado" y lo termina sola.
  // A una pregunta se le da más tiempo porque la respuesta es lo que importa.
  espera: {
    registroMs: Number(env("ESPERA_REGISTRO_MS", "5000")),
    preguntaMs: Number(env("ESPERA_PREGUNTA_MS", "30000")),
  },
  ia: {
    // Cualquier API compatible con OpenAI: Ollama, LM Studio, Osaurus o un proveedor en la nube.
    url: env("IA_URL", "http://localhost:11434/v1"),
    apiKey: env("IA_API_KEY", "ollama"),
    // modelo, claveNube, modeloDificil y respaldo (ver modelosIa).
    ...modelosIa(process.env),
    // Solo para Ollama: permite despertar el modelo antes de que termines de dictar.
    ollamaUrl: process.env.OLLAMA_URL?.trim() || "http://localhost:11434",
    // Ollama 0.32.5 todavía ignora este valor en su API compatible con OpenAI y usa OLLAMA_KEEP_ALIVE
    // (5 minutos por omisión); se manda igual para cuando lo lea. Abrir el Atajo vuelve a cargarlo.
    mantenerCargado: env("IA_MANTENER_CARGADO", "5m"),
    // Cuánto "piensa" el modelo antes de responder (none, low, medium, high; "no" para no mandarlo).
    // gemma4 acierta igual sin razonar y así contesta en segundos; gpt-oss necesita al menos low.
    razonamiento: env("IA_RAZONAMIENTO", "none"),
    // Saldos, tarjetas y correcciones sí se razonan: ahí una cifra mal entendida deja mal sus cuentas (2026-10-09).
    // "no" para no razonar nunca.
    razonamientoDificil: env("IA_RAZONAMIENTO_DIFICIL", "low"),
    // Cuántos usuarios atiende la IA a la vez. Tiene que coincidir con OLLAMA_NUM_PARALLEL del servicio
    // de Ollama; los dictados de un mismo usuario siempre van de uno en uno.
    paralelo: Math.max(1, Math.floor(Number(env("IA_PARALELO", "1"))) || 1),
    // Desarrollo: Ajustes › Sistema deja a la cuenta dueña encender, apagar o dejar siempre encendida la IA
    // (ai/encendido.ts). Mientras está activo, lo que elija en la app manda sobre IA_MANTENER_CARGADO.
    // Antes de abrir al público: IA_INTERRUPTOR=0 o quitarlo.
    interruptor: env("IA_INTERRUPTOR", "1") !== "0",
  },
};

export type Config = typeof config;
