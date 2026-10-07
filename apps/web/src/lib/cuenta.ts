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
  /** commit: hash corto de lo desplegado; commitEn: fecha de ese commit; arrancadoEn: cuándo arrancó. */
  servidor: { commit: string | null; commitEn: string | null; arrancadoEn: string };
  ia: { modelo: string; disponible: boolean; cargada: boolean };
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
  if (usuario.length < USUARIO_MIN) return `Mínimo ${USUARIO_MIN} caracteres.`;
  if (usuario.length > USUARIO_MAX) return `Máximo ${USUARIO_MAX} caracteres.`;
  return null;
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

/** PATCH /v1/yo: nombre de saludo o usuario. 409 si el usuario ya es de alguien. */
export function useCambiarCuenta() {
  const actualizar = useActualizarYo();
  return useMutation({
    mutationFn: (cambios: { nombre?: string; usuario?: string }) =>
      api<{ usuario: UsuarioCuenta }>("/v1/yo", { method: "PATCH", body: cambios }),
    onSuccess: (r) => actualizar(r.usuario),
  });
}

/** PUT /v1/yo/codigo: crea o cambia el código. El servidor lo guarda cifrado; nunca se vuelve a leer. */
export function useGuardarCodigo() {
  const actualizar = useActualizarYo();
  return useMutation({
    mutationFn: (codigo: string) => api<{ ok: true }>("/v1/yo/codigo", { method: "PUT", body: { codigo } }),
    onSuccess: () => actualizar({ tieneCodigo: true }),
  });
}

export function useQuitarCodigo() {
  const actualizar = useActualizarYo();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/v1/yo/codigo", { method: "DELETE" }),
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
