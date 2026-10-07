import { ATAJO_EXPIRA, type ApiFalsa, TOKEN } from "./api-falsa";

type Peticion = {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  autorizado: boolean;
  json: (estado: number, datos: unknown) => Promise<void>;
};

export type EstadoFalso = {
  servidor: { commit: string | null; commitEn: string | null; arrancadoEn: string };
  ia: { modelo: string; disponible: boolean; cargada: boolean };
  cola: { pendientes: number; conError: number };
};

/** Desplegado 5 días antes y arrancado 3 horas antes de la hora fija de las pruebas (18:30 UTC). */
function estadoInicial(): EstadoFalso {
  return {
    servidor: { commit: "3f9c2ab", commitEn: "2026-10-01T18:00:00.000Z", arrancadoEn: "2026-10-06T15:30:00.000Z" },
    ia: { modelo: "qwen3-14b", disponible: true, cargada: true },
    cola: { pendientes: 0, conError: 0 },
  };
}

// El estado de cada ApiFalsa vive aquí para no tocar su clase. null: servidor viejo (404).
const estados = new WeakMap<ApiFalsa, EstadoFalso | null>();

function estadoDe(api: ApiFalsa) {
  if (!estados.has(api)) estados.set(api, estadoInicial());
  return estados.get(api) ?? null;
}

/**
 * Cambia lo que responde GET /v1/estado. `null` lo deja en 404, como un servidor anterior.
 * Ej.: ponerEstado(api, { ia: { cargada: false } }).
 */
export function ponerEstado(
  api: ApiFalsa,
  cambios: { servidor?: Partial<EstadoFalso["servidor"]>; ia?: Partial<EstadoFalso["ia"]>; cola?: Partial<EstadoFalso["cola"]> } | null,
) {
  if (cambios === null) {
    estados.set(api, null);
    return;
  }
  const e = estadoDe(api) ?? estadoInicial();
  estados.set(api, {
    servidor: { ...e.servidor, ...cambios.servidor },
    ia: { ...e.ia, ...cambios.ia },
    cola: { ...e.cola, ...cambios.cola },
  });
}

let atajos = 0;

function sinAcentos(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Como lo compara el servidor: sin espacios de más y sin distinguir mayúsculas. */
function normalizarCodigo(codigo: string) {
  return codigo.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

const coincide = (api: ApiFalsa, codigo: unknown) =>
  api.cuenta.codigo !== null && typeof codigo === "string" && normalizarCodigo(codigo) === normalizarCodigo(api.cuenta.codigo);

/** Código actual "muchos-intentos": 429 (el servidor verifica pocos a la vez). */
export const ACTUAL_CON_429 = "muchos-intentos";

/**
 * Lo que piden cambiar el usuario y cambiar o quitar el código cuando ya hay uno: el código actual.
 * null si se puede seguir.
 */
function revisarActual(api: ApiFalsa, actual: unknown): [number, { error: string }] | null {
  if (!api.cuenta.tieneCodigo) return null;
  if (typeof actual !== "string" || !actual.trim()) return [400, { error: "Escribe tu código actual." }];
  if (actual === ACTUAL_CON_429) return [429, { error: "Hay muchos intentos a la vez. Espera un momento." }];
  if (!coincide(api, actual)) return [403, { error: "Ese no es tu código actual." }];
  return null;
}

/** Las mismas reglas que validarCodigoPersonal en el servidor (versión corta). */
function problemaCodigo(api: ApiFalsa, codigo: string): string | null {
  const limpio = normalizarCodigo(codigo);
  if ([...limpio].length < 8) return "El código necesita al menos 8 caracteres.";
  if ([...limpio].length > 64) return "El código puede tener hasta 64 caracteres.";
  const sinEspacios = limpio.replace(/ /g, "");
  if (/^(.)\1+$/.test(sinEspacios) || "0123456789".includes(sinEspacios) || "9876543210".includes(sinEspacios)) {
    return "Ese código es muy fácil de adivinar. Elige otro.";
  }
  const plano = sinAcentos(sinEspacios);
  const piezas = [api.cuenta.usuario, ...api.cuenta.usuario.split(/[._-]/), ...api.cuenta.nombre.split(/\s+/)].map(sinAcentos);
  if (piezas.some((pieza) => pieza.length >= 3 && plano.includes(pieza))) {
    return "El código no puede llevar tu usuario ni tu nombre. Elige otro.";
  }
  return null;
}

/** Usuario "muchos": 429. El de la cuenta con su código: entra. Lo demás: 401. */
function revisarEntrada(api: ApiFalsa, cuerpo: unknown): [number, { error: string }] | null {
  const b = (cuerpo ?? {}) as { usuario?: string; codigo?: string };
  const usuario = sinAcentos(String(b.usuario ?? ""));
  if (usuario === "muchos") return [429, { error: "Demasiados intentos. Espera unos minutos." }];
  if (!usuario || usuario !== api.cuenta.usuario || !coincide(api, b.codigo)) {
    return [401, { error: "Usuario o código incorrectos." }];
  }
  return null;
}

/**
 * Rutas de la cuenta (usuario, código para entrar, nombre de saludo) y del estado del sistema.
 * Devuelve undefined si la ruta no es de aquí.
 */
export async function atenderCuenta(api: ApiFalsa, p: Peticion): Promise<void | undefined> {
  const { metodo, ruta, cuerpo, json } = p;

  // Públicas
  if (metodo === "POST" && ruta === "/v1/entrar") {
    const falla = revisarEntrada(api, cuerpo);
    if (falla) return json(...falla);
    const b = cuerpo as { dispositivo?: string };
    return json(201, {
      token: TOKEN,
      usuario: { id: "usr-1", nombre: api.cuenta.nombre },
      dispositivo: { id: "dis-9", nombre: b.dispositivo ?? "iPhone" },
    });
  }
  if (metodo === "POST" && ruta === "/v1/atajo/entrar") {
    const b = (cuerpo ?? {}) as { servidor?: string };
    if (!b.servidor) return json(400, { error: "Falta la dirección del servidor." });
    const falla = revisarEntrada(api, cuerpo);
    if (falla) return json(...falla);
    if (api.fallasFirma > 0) {
      api.fallasFirma -= 1;
      return json(501, { error: "Esta computadora no puede firmar Atajos.", detalle: "shortcuts sign terminó con error" });
    }
    atajos += 1;
    return json(201, {
      url: `/atajo/7c1d0e2f-5a3b-4d6e-8f90-${String(atajos).padStart(12, "0")}.shortcut`,
      expiraEn: ATAJO_EXPIRA,
      nombre: api.cuenta.nombre.split(" ")[0],
    });
  }

  const esDeAqui =
    (metodo === "PATCH" && ruta === "/v1/yo") || ruta === "/v1/yo/codigo" || (metodo === "GET" && ruta === "/v1/estado");
  if (!esDeAqui) return undefined;
  if (!p.autorizado) return json(401, { error: "Token inválido." });

  if (metodo === "PATCH" && ruta === "/v1/yo") {
    const b = (cuerpo ?? {}) as { nombre?: string; usuario?: string; actual?: string };
    let nombre: string | undefined;
    if (b.nombre !== undefined) {
      nombre = String(b.nombre).normalize("NFC").trim().replace(/\s+/g, " ");
      if (!nombre) return json(400, { error: "Escribe tu nombre." });
      if ([...nombre].length > 40) return json(400, { error: "El nombre puede tener hasta 40 caracteres." });
      if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(nombre)) {
        return json(400, { error: "El nombre solo puede llevar letras, espacios, punto, apóstrofo o guion." });
      }
    }
    let usuario: string | undefined;
    if (b.usuario !== undefined) {
      usuario = sinAcentos(String(b.usuario));
      if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(usuario)) {
        return json(400, { error: "El usuario debe tener de 3 a 24 letras, números, punto, guion o guion bajo." });
      }
      // Cambiar el usuario de una cuenta con código pide el actual; el nombre se cambia sin él.
      if (usuario !== api.cuenta.usuario) {
        const falla = revisarActual(api, b.actual);
        if (falla) return json(...falla);
      }
      if (usuario === "ocupado") return json(409, { error: "Ese usuario ya lo tiene alguien más." });
    }
    if (nombre !== undefined) api.cuenta.nombre = nombre;
    if (usuario !== undefined) api.cuenta.usuario = usuario;
    const c = api.cuenta;
    return json(200, { usuario: { id: "usr-1", nombre: c.nombre, usuario: c.usuario, tieneCodigo: c.tieneCodigo } });
  }

  if (metodo === "PUT" && ruta === "/v1/yo/codigo") {
    const b = (cuerpo ?? {}) as { codigo?: string; actual?: string; cerrarOtros?: boolean };
    const codigo = String(b.codigo ?? "");
    // Como el servidor: primero el código nuevo, luego el actual.
    const problema = problemaCodigo(api, codigo);
    if (problema) return json(400, { error: problema });
    const falla = revisarActual(api, b.actual);
    if (falla) return json(...falla);
    api.cuenta.codigo = codigo;
    api.cuenta.tieneCodigo = true;
    // cerrarOtros: fuera todos los dispositivos menos este.
    const antes = api.dispositivos.length;
    if (b.cerrarOtros) api.dispositivos = api.dispositivos.filter((d) => d.actual);
    return json(200, { ok: true, cerrados: antes - api.dispositivos.length });
  }
  if (metodo === "DELETE" && ruta === "/v1/yo/codigo") {
    const falla = revisarActual(api, (cuerpo as { actual?: string } | null)?.actual);
    if (falla) return json(...falla);
    api.cuenta.codigo = null;
    api.cuenta.tieneCodigo = false;
    return json(200, { ok: true });
  }

  if (metodo === "GET" && ruta === "/v1/estado") {
    const estado = estadoDe(api);
    if (!estado) return json(404, { error: "Ruta no encontrada." });
    return json(200, estado);
  }
  return json(405, { error: `Método no permitido: ${metodo} ${ruta}` });
}
