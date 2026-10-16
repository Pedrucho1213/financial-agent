import { useQueryClient } from "@tanstack/react-query";
import { MessageCircleQuestion } from "lucide-react";
import { haptico } from "../../lib/haptico";
import { useAvisos, useQuitarAviso } from "../../lib/plan";
import { hashDe, navegar } from "../../lib/ruta";
import type { Aviso } from "../../lib/tipos";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

const MAXIMO = 3;

/** Lo que espera algo de ti: un pago que no pude anotar o una pregunta sin contestar. */
export const esPendiente = (a: Aviso) => a.tipo === "pendiente";

/** Los pendientes, de la lista de avisos (el servidor los da primero y aunque ya se hayan visto). */
export function usePendientes() {
  const avisos = useAvisos();
  return (avisos.data ?? []).filter(esPendiente);
}

/**
 * Arriba en Inicio: lo que necesita tu respuesta para quedar anotado. No se quita al verlo, solo al contestarlo en
 * el chat (o al descartarlo).
 */
export function Atencion() {
  const pendientes = usePendientes();
  if (!pendientes.length) return null;
  return (
    <section aria-labelledby="atencion-titulo" data-testid="atencion">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
        <h2 id="atencion-titulo" className="text-[20px] leading-[25px] font-bold tracking-[-0.02em]">
          Requiere tu atención
        </h2>
        {pendientes.length > MAXIMO ? (
          <button type="button" className="text-[15px] whitespace-nowrap text-tint active:opacity-50" onClick={() => navegar(hashDe("avisos"))}>
            Ver los {pendientes.length}
          </button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-[20px] bg-card">
        {pendientes.slice(0, MAXIMO).map((a) => (
          <FilaPendiente key={a.id} a={a} />
        ))}
      </div>
    </section>
  );
}

/** Un pendiente: tocarlo abre el chat en esa conversación para contestar ahí. */
export function FilaPendiente({ a, className }: { a: Aviso; className?: string }) {
  const quitar = useQuitarAviso();
  const qc = useQueryClient();
  const contestar = () => {
    haptico();
    navegar(a.enlace?.startsWith("#") ? a.enlace : hashDe("chat"));
  };
  return (
    <div
      data-pendiente={a.id}
      className={cn(
        "relative flex gap-3 py-3 pr-3.5 pl-4 [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[4.25rem] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-[11px]"
        style={{ backgroundColor: "color-mix(in srgb, var(--orange) 16%, var(--card))", color: "var(--orange)" }}
      >
        <MessageCircleQuestion className="size-5" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" className="block w-full text-left active:opacity-60" onClick={contestar}>
          <span className="block text-[16px] leading-[21px] font-semibold break-words">{a.titulo}</span>
          <span className="mt-0.5 line-clamp-3 block text-[14px] leading-[19px] text-pretty text-muted-foreground">{a.texto}</span>
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Button variant="tinted" size="sm" onClick={contestar}>
            Contestar
          </Button>
          <Button
            variant="plain"
            size="text"
            className="h-auto text-[15px] text-muted-foreground"
            onClick={() => {
              haptico();
              // También lo quita del centro de notificaciones (su lista es otra consulta).
              quitar.mutate({ id: a.id, accion: "descartar" }, { onSettled: () => void qc.invalidateQueries({ queryKey: ["plan", "avisos"] }) });
            }}
          >
            Descartar
          </Button>
        </div>
      </div>
    </div>
  );
}
