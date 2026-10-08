import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useRefrescarDatos } from "./consultas";
import type { Cuentas, DatosCuenta, DatosMover, DetalleCuenta, Etiqueta, EstadoCuenta, MovimientoApp } from "./tipos";

// Cuentas, tarjetas y etiquetas. Un gasto cambia saldos: se refrescan con cualquier movimiento (consultas.ts).

export function useCuentas({ archivadas = false, activo = true }: { archivadas?: boolean; activo?: boolean } = {}) {
  return useQuery({
    queryKey: ["cuentas", "lista", archivadas] as const,
    enabled: activo,
    queryFn: ({ signal }) => api<Cuentas>(`/v1/cuentas${archivadas ? "?archivadas=1" : ""}`, { signal }),
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
  });
}

export function useGuardarCuenta() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: DatosCuenta }) =>
      id
        ? api<EstadoCuenta>(`/v1/cuentas/${encodeURIComponent(id)}`, { method: "PATCH", body: datos })
        : api<EstadoCuenta>("/v1/cuentas", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export function useMoverDinero() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (datos: DatosMover) =>
      api<{ movimiento: MovimientoApp; cuentas: EstadoCuenta[] }>("/v1/transferencias", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export type DatosEtiqueta = { nombre?: string; activa_desde?: string | null; activa_hasta?: string | null };

export function useGuardarEtiqueta() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: DatosEtiqueta }) =>
      id
        ? api<Etiqueta>(`/v1/etiquetas/${encodeURIComponent(id)}`, { method: "PATCH", body: datos })
        : api<Etiqueta>("/v1/etiquetas", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export function useBorrarEtiqueta() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/v1/etiquetas/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => refrescar(),
  });
}
