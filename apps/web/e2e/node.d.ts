// Lo mínimo de Node que usan la configuración y las pruebas (sin instalar @types/node).
declare const process: { env: Record<string, string | undefined> };
declare module "node:fs" {
  export function existsSync(ruta: string): boolean;
  export function readdirSync(ruta: string): string[];
  export function mkdirSync(ruta: string, opciones?: { recursive?: boolean }): void;
}
