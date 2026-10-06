import { toast } from "sonner";
import { mensajeDeError } from "./api";
import { useDeshacer, useEliminarMovimiento } from "./consultas";
import type { MovimientoApp } from "./tipos";

/** Elimina y ofrece "Deshacer" en el aviso, que llama a POST /v1/deshacer. */
export function useEliminarConDeshacer() {
  const eliminar = useEliminarMovimiento();
  const deshacer = useDeshacer();
  return (m: MovimientoApp, alTerminar?: () => void) =>
    eliminar.mutate(m.id, {
      onSuccess: () => {
        alTerminar?.();
        toast("Eliminado", {
          description: m.comercio ?? m.descripcion ?? m.categoria ?? undefined,
          duration: 6000,
          action: {
            label: "Deshacer",
            onClick: () =>
              deshacer.mutate(undefined, {
                onSuccess: (r) => toast.success(r.mensaje ?? (r.deshecho ? "Listo, lo regresé." : "No había nada que deshacer.")),
                onError: (e) => toast.error(mensajeDeError(e)),
              }),
          },
        });
      },
      onError: (e) => toast.error(mensajeDeError(e)),
    });
}
