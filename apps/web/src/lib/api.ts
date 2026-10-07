import { cerrarSesion, obtenerToken } from "./sesion";

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly cuerpo?: unknown,
  ) {
    super(mensaje);
  }
}

const MENSAJES: Record<number, string> = {
  400: "Revisa los datos e inténtalo de nuevo.",
  401: "Tu sesión terminó. Vuelve a entrar.",
  404: "No se encontró.",
  410: "Ya no está disponible.",
  429: "Demasiados intentos. Espera unos minutos.",
  501: "Tu Mac no puede hacer eso todavía.",
  503: "El servidor no respondió. Inténtalo en un momento.",
};

type Opciones = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Rutas públicas: no manda el token ni cierra sesión con 401. */
  publica?: boolean;
};

export async function api<T>(ruta: string, { method = "GET", body, signal, publica }: Opciones = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  const token = publica ? null : obtenerToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(ruta, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ErrorApi(0, "No hay conexión con tu Mac. Revisa tu internet o Tailscale.");
  }

  const datos: unknown = await res.json().catch(() => null);
  if (res.status === 401 && !publica) {
    cerrarSesion();
  }
  if (!res.ok && res.status !== 202) {
    const mensaje =
      datos && typeof datos === "object" && "error" in datos && typeof datos.error === "string"
        ? datos.error
        : (MENSAJES[res.status] ?? `Algo salió mal (${res.status}).`);
    throw new ErrorApi(res.status, mensaje, datos);
  }
  return datos as T;
}

/** Mensaje en español para mostrar a la persona. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Algo salió mal. Inténtalo de nuevo.";
}
