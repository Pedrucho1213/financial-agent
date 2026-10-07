import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * La IP de quien hace la petición. Detrás de Tailscale (serve o Funnel) todo llega desde 127.0.0.1 y
 * la IP real viene en X-Forwarded-For; esa cabecera solo se cree si la conexión es local, y se toma
 * el último valor, el que agregó Tailscale (los anteriores los pudo escribir el cliente).
 */
export function ipDelCliente(c: Context): string {
  let directa: string | undefined;
  try {
    directa = getConnInfo(c).remote.address;
  } catch {
    // Sin servidor de Bun (pruebas con app.request) no hay conexión que mirar.
  }
  if (directa && !LOOPBACK.has(directa)) return directa;
  const reenviada = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
  return reenviada || directa || "local";
}

/**
 * Cuenta intentos fallidos en una ventana de tiempo: por IP, para frenar a quien adivina códigos sin
 * bloquear a los demás, y en total, como freno si llegan de muchas IPs.
 */
export class LimiteIntentos {
  private readonly porIp = new Map<string, number[]>();
  private readonly todos: number[] = [];

  constructor(
    private readonly ventanaMs: number,
    private readonly maxPorIp: number,
    private readonly maxTotal: number,
  ) {}

  private limpiar(lista: number[], desde: number) {
    while (lista.length && lista[0]! < desde) lista.shift();
  }

  bloqueado(ip: string): boolean {
    const desde = Date.now() - this.ventanaMs;
    this.limpiar(this.todos, desde);
    for (const [clave, lista] of this.porIp) {
      this.limpiar(lista, desde);
      if (lista.length === 0) this.porIp.delete(clave);
    }
    return this.todos.length >= this.maxTotal || (this.porIp.get(ip)?.length ?? 0) >= this.maxPorIp;
  }

  /** Anota un intento fallido. Devuelve su marca, para retirarlo con `perdonar` si al final salió bien. */
  fallo(ip: string): number {
    const ahora = Date.now();
    this.todos.push(ahora);
    const lista = this.porIp.get(ip) ?? [];
    lista.push(ahora);
    this.porIp.set(ip, lista);
    return ahora;
  }

  /** Retira un intento anotado de antemano que resultó bueno. */
  perdonar(ip: string, marca: number) {
    const quitar = (lista: number[] | undefined) => {
      const i = lista?.lastIndexOf(marca) ?? -1;
      if (i >= 0) lista!.splice(i, 1);
    };
    quitar(this.todos);
    quitar(this.porIp.get(ip));
  }
}

/** El host con el que llegó la petición: X-Forwarded-Host solo si viene de Tailscale (conexión local). */
export function hostsDeLaPeticion(c: Context): string[] {
  let directa: string | undefined;
  try {
    directa = getConnInfo(c).remote.address;
  } catch {
    // Pruebas con app.request.
  }
  const local = !directa || LOOPBACK.has(directa);
  const hosts = [c.req.header("host"), local ? c.req.header("x-forwarded-host") : undefined, new URL(c.req.url).host];
  return hosts.filter((h): h is string => !!h).map((h) => h.split(",")[0]!.trim().toLowerCase());
}
