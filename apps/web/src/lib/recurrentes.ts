import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useRefrescarDatos } from "./consultas";
import type { DatosRecurrente, Recurrente, Recurrentes } from "./tipos";

// Suscripciones y pagos fijos (#suscripciones). Cambian los próximos cobros del tablero: se refresca todo.

export function useRecurrentes(activo = true) {
  return useQuery({
    queryKey: ["recurrentes"] as const,
    enabled: activo,
    queryFn: ({ signal }) => api<Recurrentes>("/v1/recurrentes?todos=1", { signal }),
  });
}

export function useGuardarRecurrente() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: DatosRecurrente }) =>
      id
        ? api<Recurrente>(`/v1/recurrentes/${encodeURIComponent(id)}`, { method: "PATCH", body: datos })
        : api<Recurrente>("/v1/recurrentes", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export function useBorrarRecurrente() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/v1/recurrentes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => refrescar(),
  });
}
