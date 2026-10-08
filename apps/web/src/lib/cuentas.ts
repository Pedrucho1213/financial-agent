import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Cuentas, DatosCuenta, DatosMover, DetalleCuenta, Etiqueta, EstadoCuenta, MovimientoApp } from "./tipos";

// Cuentas, tarjetas y etiquetas. Un gasto cambia saldos: se refrescan con cualquier movimiento (consultas.ts).

export function useCuentas({ archivadas = false, activo = true }: { archivadas?: boolean; activo?: boolean } = {}) {
  return useQuery({
    queryKey: ["cuentas", "lista", archivadas] as const,
    enabled: activo,
    queryFn: ({ signal }) => api<Cuentas>(`/v1/cuentas${archivadas ? "?archivadas=1" : ""}`, { signal }),
    placeholderData: (previo) => previo,
  });
}

export function useCuenta(id: string | null) {
  return useQuery({
    queryKey: ["cuentas", "una", id] as const,
    enabled: !!id,
    queryFn: ({ signal }) => api<DetalleCuenta>(`/v1/cuentas/${encodeURIComponent(id ?? "")}`, { signal }),
  });
}

/** periodo: "este_mes" o "todo" (sin límite). */
export function useEtiquetas(periodo: "este_mes" | "todo" = "todo", activo = true) {
  return useQuery({
    queryKey: ["etiquetas", periodo] as const,
    enabled: activo,
    queryFn: ({ signal }) =>
      api<{ etiquetas: Etiqueta[] }>(`/v1/etiquetas${periodo === "todo" ? "" : `?periodo=${periodo}`}`, { signal }).then((r) => r.etiquetas),
    placeholderData: (previo) => previo,
  });
}

/** Mover dinero o cambiar un saldo toca cuentas, movimientos, el tablero y lo disponible. */
function useRefrescarTodo() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["cuentas", "etiquetas", "movimientos", "tablero", "plan"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
}

export function useGuardarCuenta() {
  const refrescar = useRefrescarTodo();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: DatosCuenta }) =>
      id
        ? api<EstadoCuenta>(`/v1/cuentas/${encodeURIComponent(id)}`, { method: "PATCH", body: datos })
        : api<EstadoCuenta>("/v1/cuentas", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export function useMoverDinero() {
  const refrescar = useRefrescarTodo();
  return useMutation({
    mutationFn: (datos: DatosMover) =>
      api<{ movimiento: MovimientoApp; cuentas: EstadoCuenta[] }>("/v1/transferencias", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export type DatosEtiqueta = { nombre?: string; activa_desde?: string | null; activa_hasta?: string | null };

export function useGuardarEtiqueta() {
  const refrescar = useRefrescarTodo();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: DatosEtiqueta }) =>
      id
        ? api<Etiqueta>(`/v1/etiquetas/${encodeURIComponent(id)}`, { method: "PATCH", body: datos })
        : api<Etiqueta>("/v1/etiquetas", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export function useBorrarEtiqueta() {
  const refrescar = useRefrescarTodo();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/v1/etiquetas/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => refrescar(),
  });
}
