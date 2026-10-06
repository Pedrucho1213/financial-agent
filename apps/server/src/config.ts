// Configuración desde variables de entorno. Bun carga .env automáticamente.
const env = (nombre: string, porDefecto: string) => process.env[nombre]?.trim() || porDefecto;

export const config = {
  host: env("HOST", "127.0.0.1"),
  puerto: Number(env("PUERTO", "8787")),
  baseDatos: env("BASE_DATOS", "./datos/finanzas.db"),
  zonaHoraria: env("ZONA_HORARIA", "America/Mexico_City"),
  moneda: env("MONEDA", "MXN"),
  // Cuánto espera el iPhone a la IA. Si tarda más, la Mac contesta "anotado" y lo termina sola.
  // A una pregunta se le da más tiempo porque la respuesta es lo que importa.
  espera: {
    registroMs: Number(env("ESPERA_REGISTRO_MS", "5000")),
    preguntaMs: Number(env("ESPERA_PREGUNTA_MS", "30000")),
  },
  ia: {
    // Cualquier API compatible con OpenAI: Ollama, LM Studio, Osaurus o un proveedor en la nube.
    url: env("IA_URL", "http://localhost:11434/v1"),
    modelo: env("IA_MODELO", "gpt-oss:20b"),
    apiKey: env("IA_API_KEY", "ollama"),
    // Solo para Ollama: permite despertar el modelo antes de que termines de dictar.
    ollamaUrl: process.env.OLLAMA_URL?.trim() || "http://localhost:11434",
    mantenerCargado: env("IA_MANTENER_CARGADO", "10m"),
    // Cuánto "piensa" el modelo antes de responder (low, medium, high; "no" para no mandarlo).
    // Menos razonamiento es más rápido; para registrar gastos basta low.
    razonamiento: env("IA_RAZONAMIENTO", "low"),
  },
};

export type Config = typeof config;
