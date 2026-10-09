import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ErrorApi, mensajeDeError } from "./api";

/**
 * GET /v1/ia: el interruptor de la IA (herramienta de desarrollo, solo la cuenta dueña).
 * `hasta`: cuándo la suelta Ollama; null si no está cargada o si está sin límite.
 */
export type ControlIa = {
  siempre: boolean;
  minutos: number;
  modelo: string;
  /** Es el respaldo de Claude: solo contesta cuando Claude falla (servidores anteriores no lo mandan). */
  respaldo?: boolean;
  apagadaAMano: boolean;
  disponible: boolean;
  cargada: boolean;
  hasta: string | null;
  memoria: number | null;
};

export const CLAVE_IA = ["ia"] as const;
export const PLAZOS = [5, 10, 30, 60] as const;

/** null: el servidor no tiene el interruptor (404, o IA_INTERRUPTOR=0) o la cuenta no es la dueña (403). */
export function useControlIa(habilitado: boolean) {
  return useQuery({
    queryKey: CLAVE_IA,
    enabled: habilitado,
    staleTime: 5_000,
    // En modo "siempre", el servidor la vuelve a cargar solo: así se ve sin jalar para refrescar.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      try {
        return await api<ControlIa>("/v1/ia", { signal });
      } catch (error) {
        if (error instanceof ErrorApi && (error.estado === 404 || error.estado === 403)) return null;
        throw error;
      }
    },
  });
}

type Accion = { tipo: "modo"; cambio: { siempre?: boolean; minutos?: number } } | { tipo: "encender" } | { tipo: "apagar" };

export function useCambiarIa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Accion) =>
      a.tipo === "modo"
        ? api<ControlIa>("/v1/ia", { method: "PUT", body: a.cambio })
        : api<ControlIa>(`/v1/ia/${a.tipo}`, { method: "POST" }),
    onMutate: async (a) => {
      // El interruptor y el plazo cambian al instante; encender o apagar esperan a Ollama.
      if (a.tipo !== "modo") return;
      await qc.cancelQueries({ queryKey: CLAVE_IA });
      const antes = qc.getQueryData<ControlIa | null>(CLAVE_IA);
      if (antes) qc.setQueryData(CLAVE_IA, { ...antes, ...a.cambio });
      return { antes };
    },
    onSuccess: (r, a) => {
      qc.setQueryData(CLAVE_IA, r);
      void qc.invalidateQueries({ queryKey: ["estado"] });
      if (a.tipo === "encender") toast.success(r.cargada ? "IA encendida" : "Ollama no la pudo cargar");
      if (a.tipo === "apagar") toast.success(r.siempre ? "IA apagada. Se vuelve a encender con tu próximo dictado." : "IA apagada");
    },
    onError: (e, _a, ctx) => {
      if (ctx?.antes) qc.setQueryData(CLAVE_IA, ctx.antes);
      toast.error(mensajeDeError(e));
    },
  });
}
