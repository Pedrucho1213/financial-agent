import { toast } from "sonner";
import { api, mensajeDeError } from "./api";
import { clienteConsultas } from "./consultas";
import type { MovimientoApp } from "./tipos";

// Funciones sueltas (no hooks): el aviso de "Deshacer" sigue funcionando
// aunque la hoja o la fila que lo lanzó ya no exista.

type Pagina = { total: number; movimientos: MovimientoApp[] };
type Infinito = { pages: Pagina[]; pageParams: number[] };

function refrescar() {
  return Promise.all([
    clienteConsultas.invalidateQueries({ queryKey: ["tablero"] }),
    clienteConsultas.invalidateQueries({ queryKey: ["movimientos"] }),
  ]);
}

// POST /v1/deshacer revierte el ÚLTIMO cambio de la cuenta, no uno en particular (no hay
// forma de restaurar por id). Por eso solo vive un aviso de "Deshacer" a la vez, y se quita
// en cuanto otro cambio (otro borrado, una edición o algo que hizo el chat) pasa a ser el último.
let avisoDeshacer: string | number | undefined;

export function olvidarDeshacer() {
  if (avisoDeshacer === undefined) return;
  toast.dismiss(avisoDeshacer);
  avisoDeshacer = undefined;
}

async function deshacer() {
  avisoDeshacer = undefined;
  try {
    const r = await api<{ deshecho: boolean; mensaje?: string }>("/v1/deshacer", { method: "POST" });
    toast.success(r.mensaje ?? (r.deshecho ? "Listo, lo regresé." : "No había nada que deshacer."));
  } catch (error) {
    toast.error(mensajeDeError(error));
  } finally {
    await refrescar();
  }
}

/** Elimina (desaparece de la lista al instante) y ofrece "Deshacer", que llama a POST /v1/deshacer. */
export async function eliminarConDeshacer(m: MovimientoApp, alTerminar?: () => void) {
  const clave = { queryKey: ["movimientos"] };
  await clienteConsultas.cancelQueries(clave);
  const previos = clienteConsultas.getQueriesData<Infinito>(clave);
  clienteConsultas.setQueriesData<Infinito>(clave, (d) => {
    // Bajo "movimientos" también viven las sumas por día de Inicio, que no son páginas.
    if (!d || !Array.isArray(d.pages)) return d;
    const quitados = d.pages.reduce((n, p) => n + p.movimientos.filter((x) => x.id === m.id).length, 0);
    return { ...d, pages: d.pages.map((p) => ({ total: p.total - quitados, movimientos: p.movimientos.filter((x) => x.id !== m.id) })) };
  });
  try {
    await api<{ ok: true }>(`/v1/movimientos/${encodeURIComponent(m.id)}`, { method: "DELETE" });
    alTerminar?.();
    olvidarDeshacer();
    const id = toast("Eliminado", {
      description: m.comercio ?? m.descripcion ?? m.categoria ?? undefined,
      duration: 6000,
      action: { label: "Deshacer", onClick: () => void deshacer() },
      onDismiss: () => {
        if (avisoDeshacer === id) avisoDeshacer = undefined;
      },
      onAutoClose: () => {
        if (avisoDeshacer === id) avisoDeshacer = undefined;
      },
    });
    avisoDeshacer = id;
  } catch (error) {
    for (const [k, datos] of previos) clienteConsultas.setQueryData(k, datos);
    toast.error(mensajeDeError(error));
  } finally {
    await refrescar();
  }
}
