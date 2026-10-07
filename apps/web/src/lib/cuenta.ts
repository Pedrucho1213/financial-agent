import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ErrorApi } from "./api";
import { claves } from "./consultas";
import type { AtajoCanjeado, Registro, Yo } from "./tipos";

// Cuenta (nombre de saludo, usuario y código para entrar) y estado del sistema (docs/api.md).

export const NOMBRE_MAX = 40;
export const USUARIO_MIN = 3;
export const USUARIO_MAX = 24;
export const CODIGO_MIN = 8;
export const CODIGO_MAX = 64;

export type UsuarioCuenta = { id: string; nombre: string; usuario: string; tieneCodigo: boolean };

/** GET /v1/estado */
export type EstadoSistema = {
  /**
   * commit: hash corto de lo desplegado; commitEn: fecha de ese commit; arrancadoEn: cuándo arrancó.
   * Solo los ve el dueño de la instalación (la primera cuenta), igual que el modelo: a los demás les llega null.
   */
  servidor: { commit: string | null; commitEn: string | null; arrancadoEn: string } | null;
  ia: { modelo?: string; disponible: boolean; cargada: boolean };
  /** Dictados de esta persona (últimos 7 días) que la Mac sigue procesando o que fallaron. */
  cola: { pendientes: number; conError: number };
};

/** Como lo guarda el servidor: sin acentos, en minúsculas y sin espacios en las orillas. */
export function normalizarUsuario(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Qué le falta al usuario (ya normalizado), o null si sirve. */
export function problemaUsuario(usuario: string): string | null {
  if (/[^a-z0-9._-]/.test(usuario)) return "Solo letras, números, punto, guion o guion bajo.";
  if (/^[._-]/.test(usuario)) return "Empieza con una letra o un número.";
  if (usuario.length < USUARIO_MIN) return `Mínimo ${USUARIO_MIN} caracteres.`;
  if (usuario.length > USUARIO_MAX) return `Máximo ${USUARIO_MAX} caracteres.`;
  return null;
}

/** Qué le falta al nombre de saludo, o null si sirve. Las mismas reglas que el servidor (validarNombre). */
export function problemaNombre(texto: string): string | null {
  const nombre = texto.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!nombre) return "Escribe tu nombre.";
  if ([...nombre].length > NOMBRE_MAX) return `El nombre puede tener hasta ${NOMBRE_MAX} caracteres.`;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(nombre)) return "El nombre solo puede llevar letras, espacios, punto, apóstrofo o guion.";
  return null;
}

/** El código como lo compara el servidor: sin espacios de más y sin distinguir mayúsculas. */
function normalizarCodigo(codigo: string) {
  return codigo.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Lo que se puede revisar del código nuevo antes de mandarlo: el largo y que no lleve el usuario
 * ni el nombre (como llevaSuNombre en el servidor). Lo "muy fácil de adivinar" lo dice el servidor.
 */
export function problemaCodigo(codigo: string, cuenta: { usuario?: string; nombre?: string }): string | null {
  const limpio = normalizarCodigo(codigo);
  if (!limpio) return null;
  if ([...limpio].length < CODIGO_MIN) return `Mínimo ${CODIGO_MIN} caracteres.`;
  if ([...limpio].length > CODIGO_MAX) return `Máximo ${CODIGO_MAX} caracteres.`;
  const plano = normalizarUsuario(limpio).replace(/ /g, "");
  const usuario = cuenta.usuario ?? "";
  const piezas = [usuario, ...usuario.split(/[._-]/), ...(cuenta.nombre ?? "").split(/\s+/)].map(normalizarUsuario);
  if (piezas.some((pieza) => pieza.length >= 3 && plano.includes(pieza))) {
    return "El código no puede llevar tu usuario ni tu nombre. Elige otro.";
  }
  return null;
}

/** El error es del campo "Código actual": falta (400 con ese texto) o no coincide (403, que no cierra la sesión). */
export function esDelCodigoActual(error: unknown) {
  return error instanceof ErrorApi && (error.estado === 403 || (error.estado === 400 && /código actual/i.test(error.message)));
}

/** Mensaje del servidor para 401 y 429 al entrar; lo demás, el de siempre. */
export function mensajeEntrar(error: unknown) {
  if (error instanceof ErrorApi) {
    if (error.estado === 404) return "Tu servidor todavía no permite entrar con usuario y código. Usa un código de invitación.";
    if (error.estado === 401 && !(error.cuerpo && typeof error.cuerpo === "object" && "error" in error.cuerpo)) {
      return "Usuario o código incorrectos.";
    }
    return error.message;
  }
  return "No pudimos entrar. Inténtalo de nuevo.";
}

/** POST /v1/entrar: como /v1/registro, pero con usuario y código en vez de invitación. */
export function useEntrarConUsuario() {
  return useMutation({
    mutationFn: (datos: { usuario: string; codigo: string; dispositivo: string }) =>
      api<Registro>("/v1/entrar", { method: "POST", publica: true, body: { ...datos, usuario: normalizarUsuario(datos.usuario) } }),
  });
}

/** POST /v1/atajo/entrar: como /v1/atajo/canjear, con usuario y código. */
export function useAtajoConUsuario() {
  return useMutation({
    mutationFn: (datos: { usuario: string; codigo: string }) =>
      api<AtajoCanjeado>("/v1/atajo/entrar", {
        method: "POST",
        publica: true,
        body: { usuario: normalizarUsuario(datos.usuario), codigo: datos.codigo, servidor: window.location.origin },
      }),
  });
}

function useActualizarYo() {
  const qc = useQueryClient();
  return (cambios: Partial<Yo["usuario"]>) => {
    qc.setQueryData<Yo>(claves.yo, (yo) => (yo ? { ...yo, usuario: { ...yo.usuario, ...cambios } } : yo));
    void qc.invalidateQueries({ queryKey: claves.yo });
  };
}

/**
 * PATCH /v1/yo: nombre de saludo o usuario. Cambiar el usuario de una cuenta con código pide `actual`
 * (400 si falta, 403 si no es). 409 si el usuario ya es de alguien.
 */
export function useCambiarCuenta() {
  const actualizar = useActualizarYo();
  return useMutation({
    mutationFn: (cambios: { nombre?: string; usuario?: string; actual?: string }) =>
      api<{ usuario: UsuarioCuenta }>("/v1/yo", { method: "PATCH", body: cambios }),
    onSuccess: (r) => actualizar(r.usuario),
  });
}

/**
 * PUT /v1/yo/codigo: crea o cambia el código. El servidor lo guarda cifrado; nunca se vuelve a leer.
 * Para cambiarlo hace falta `actual`; `cerrarOtros` revoca los demás dispositivos (`cerrados` dice cuántos).
 * Al terminar se vuelve a pedir /v1/yo, así la lista de dispositivos ya no los muestra.
 */
export function useGuardarCodigo() {
  const actualizar = useActualizarYo();
  return useMutation({
    mutationFn: (datos: { codigo: string; actual?: string; cerrarOtros?: boolean }) =>
      api<{ ok: true; cerrados?: number }>("/v1/yo/codigo", { method: "PUT", body: datos }),
    onSuccess: () => actualizar({ tieneCodigo: true }),
  });
}

/** DELETE /v1/yo/codigo con el código actual. */
export function useQuitarCodigo() {
  const actualizar = useActualizarYo();
  return useMutation({
    mutationFn: (actual: string) => api<{ ok: true }>("/v1/yo/codigo", { method: "DELETE", body: { actual } }),
    onSuccess: () => actualizar({ tieneCodigo: false }),
  });
}

/** Estado de la Mac. null: el servidor es anterior a /v1/estado (404). */
export function useEstadoSistema() {
  return useQuery({
    queryKey: ["estado"] as const,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      try {
        return await api<EstadoSistema>("/v1/estado", { signal });
      } catch (error) {
        if (error instanceof ErrorApi && error.estado === 404) return null;
        throw error;
      }
    },
  });
}
