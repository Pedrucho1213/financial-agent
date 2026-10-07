import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Aviso, ComprasMsi, Disponible, Meta, Metas, Prestamos, Presupuesto, Presupuestos } from "./tipos";

// Presupuestos y metas. Los cambios por voz también los mueven: se refrescan con el tablero.

export function usePresupuestos(mes: string) {
  return useQuery({
    queryKey: ["plan", "presupuestos", mes] as const,
    queryFn: ({ signal }) => api<Presupuestos>(`/v1/presupuestos?mes=${mes}`, { signal }),
    placeholderData: (previo) => previo,
  });
}

export function useMetas() {
  return useQuery({
    queryKey: ["plan", "metas"] as const,
    queryFn: ({ signal }) => api<Metas>("/v1/metas", { signal }),
  });
}

export function useDisponible() {
  return useQuery({
    queryKey: ["plan", "disponible"] as const,
    queryFn: ({ signal }) => api<Disponible>("/v1/disponible", { signal }),
  });
}

export function usePrestamos() {
  return useQuery({
    queryKey: ["plan", "prestamos"] as const,
    queryFn: ({ signal }) => api<Prestamos>("/v1/prestamos", { signal }),
  });
}

export function useMsi() {
  return useQuery({
    queryKey: ["plan", "msi"] as const,
    queryFn: ({ signal }) => api<ComprasMsi>("/v1/msi", { signal }),
  });
}

function useRefrescarPlan() {
  const qc = useQueryClient();
  return () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["plan"] }), qc.invalidateQueries({ queryKey: ["tablero"] })]);
}

export function useGuardarPresupuesto() {
  const refrescar = useRefrescarPlan();
  return useMutation({
    // Uno por categoría: PUT crea o cambia el de esa categoría.
    mutationFn: ({ categoriaId, limite }: { categoriaId: string | null; limite: number }) =>
      api<Presupuesto>("/v1/presupuestos", { method: "PUT", body: { categoria_id: categoriaId, limite } }),
    onSuccess: () => refrescar(),
  });
}

export function useBorrarPresupuesto() {
  const refrescar = useRefrescarPlan();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/v1/presupuestos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => refrescar(),
  });
}

export function useGuardarMeta() {
  const refrescar = useRefrescarPlan();
  return useMutation({
    mutationFn: ({ id, nombre, objetivo, fechaLimite }: { id?: string; nombre: string; objetivo: number; fechaLimite: string | null }) =>
      id
        ? api<Meta>(`/v1/metas/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: { nombre, objetivo, fecha_limite: fechaLimite },
          })
        : api<Meta>("/v1/metas", { method: "POST", body: { nombre, objetivo, fecha_limite: fechaLimite ?? undefined } }),
    onSuccess: () => refrescar(),
  });
}

export function useAportarMeta() {
  const refrescar = useRefrescarPlan();
  return useMutation({
    mutationFn: ({ id, monto }: { id: string; monto: number }) =>
      api<Meta>(`/v1/metas/${encodeURIComponent(id)}/aportes`, { method: "POST", body: { monto } }),
    onSuccess: () => refrescar(),
  });
}

export function useBorrarMeta() {
  const refrescar = useRefrescarPlan();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/v1/metas/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => refrescar(),
  });
}

export function useAvisos() {
  return useQuery({
    queryKey: ["plan", "avisos"] as const,
    queryFn: ({ signal }) => api<{ avisos: Aviso[] }>("/v1/avisos", { signal }).then((r) => r.avisos),
    // Un servidor sin el revisor (404) simplemente no tiene avisos.
    retry: false,
  });
}

/** Leer o descartar un aviso lo quita de la lista de inmediato; si falla, vuelve. */
export function useQuitarAviso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accion }: { id: string; accion: "leido" | "descartar" }) =>
      api(`/v1/avisos/${encodeURIComponent(id)}/${accion}`, { method: "POST" }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["plan", "avisos"] });
      const antes = qc.getQueryData<Aviso[]>(["plan", "avisos"]);
      qc.setQueryData<Aviso[]>(["plan", "avisos"], (l) => l?.filter((a) => a.id !== id));
      return { antes };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(["plan", "avisos"], ctx?.antes),
  });
}
