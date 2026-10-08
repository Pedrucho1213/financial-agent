import type { ApiFalsa } from "./api-falsa";

type Peticion = {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  autorizado: boolean;
  json: (estado: number, datos: unknown) => Promise<void>;
};

/** Lo que responde GET /v1/ia (el interruptor de la IA de desarrollo). */
export type IaFalsa = {
  siempre: boolean;
  minutos: number;
  modelo: string;
  apagadaAMano: boolean;
  disponible: boolean;
  cargada: boolean;
  hasta: string | null;
  memoria: number | null;
};

// Las pruebas fijan la hora en 2026-10-06 18:30 UTC (12:30 en CDMX).
const AHORA = Date.parse("2026-10-06T18:30:00.000Z");

function inicial(): IaFalsa {
  return {
    siempre: true,
    minutos: 10,
    modelo: "qwen3-14b",
    apagadaAMano: false,
    disponible: true,
    cargada: true,
    hasta: null,
    memoria: 8_200_000_000,
  };
}

// El estado de cada ApiFalsa vive aquí para no tocar su clase. null: servidor sin interruptor (404).
const estados = new WeakMap<ApiFalsa, IaFalsa | null>();
/** Respuestas forzadas para la próxima petición: [estado, cuerpo]. */
const fallas = new WeakMap<ApiFalsa, [number, unknown]>();

function estadoDe(api: ApiFalsa) {
  if (!estados.has(api)) estados.set(api, inicial());
  return estados.get(api) ?? null;
}

/** Cambia lo que responde /v1/ia. `null` lo deja en 404, como un servidor con IA_INTERRUPTOR=0. */
export function ponerIa(api: ApiFalsa, cambios: Partial<IaFalsa> | null) {
  if (cambios === null) estados.set(api, null);
  else estados.set(api, { ...(estadoDe(api) ?? inicial()), ...cambios });
}

/** La próxima petición a /v1/ia responde esto (por ejemplo 403 o 503). */
export function fallarIa(api: ApiFalsa, estado: number, cuerpo: unknown) {
  fallas.set(api, [estado, cuerpo]);
}

export function iaDe(api: ApiFalsa) {
  return estadoDe(api);
}

const conPlazo = (e: IaFalsa) => (e.cargada && !e.siempre ? new Date(AHORA + e.minutos * 60_000).toISOString() : null);

export async function atenderIa(api: ApiFalsa, { metodo, ruta, cuerpo, autorizado, json }: Peticion) {
  if (ruta !== "/v1/ia" && ruta !== "/v1/ia/encender" && ruta !== "/v1/ia/apagar") return;
  if (!autorizado) return json(401, { error: "Token inválido." });
  const e = estadoDe(api);
  if (!e) return json(404, { error: "Ruta no encontrada." });
  const falla = fallas.get(api);
  if (falla) {
    fallas.delete(api);
    return json(...falla);
  }
  if (metodo === "GET" && ruta === "/v1/ia") return json(200, e);
  if (metodo === "PUT" && ruta === "/v1/ia") {
    const b = (cuerpo ?? {}) as { siempre?: unknown; minutos?: unknown };
    if (b.siempre !== undefined && typeof b.siempre !== "boolean") return json(400, { error: "Datos inválidos" });
    if (b.minutos !== undefined && (!Number.isInteger(b.minutos) || (b.minutos as number) < 1 || (b.minutos as number) > 1440)) {
      return json(400, { error: "Datos inválidos" });
    }
    if (typeof b.siempre === "boolean") {
      if (b.siempre && !e.siempre) {
        e.apagadaAMano = false;
        e.cargada = e.disponible;
      }
      e.siempre = b.siempre;
    }
    if (typeof b.minutos === "number") e.minutos = b.minutos;
    e.hasta = conPlazo(e);
    return json(200, e);
  }
  if (metodo === "POST" && ruta === "/v1/ia/encender") {
    e.apagadaAMano = false;
    e.cargada = e.disponible;
    e.memoria = e.cargada ? 8_200_000_000 : null;
    e.hasta = conPlazo(e);
    return json(200, e);
  }
  if (metodo === "POST" && ruta === "/v1/ia/apagar") {
    Object.assign(e, { apagadaAMano: true, cargada: false, hasta: null, memoria: null });
    return json(200, e);
  }
  return json(405, { error: `Método no permitido: ${metodo} ${ruta}` });
}
