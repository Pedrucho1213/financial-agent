import { CalendarClock, ChartNoAxesColumn, Coffee, CreditCard, Copy, HandCoins, Repeat, Target, TriangleAlert, X } from "lucide-react";
import { haptico } from "../lib/haptico";
import { useAvisos, useQuitarAviso } from "../lib/plan";
import { navegar } from "../lib/ruta";
import type { Aviso } from "../lib/tipos";

const ICONOS: Record<Aviso["tipo"], [typeof Coffee, string]> = {
  hormiga: [Coffee, "var(--orange)"],
  suscripcion_olvidada: [Repeat, "var(--tint)"],
  suscripcion_duplicada: [Copy, "var(--tint)"],
  cobro_proximo: [CalendarClock, "var(--tint)"],
  presupuesto: [ChartNoAxesColumn, "var(--anillo-gasto)"],
  meta: [Target, "var(--anillo-meta)"],
  msi: [CreditCard, "var(--tint)"],
  prestamo: [HandCoins, "var(--positive)"],
  gasto_inusual: [TriangleAlert, "var(--orange)"],
};

/** Lo que encontró el revisor nocturno: fugas, cobros que vienen, presupuestos en riesgo. */
export function Avisos() {
  const { data } = useAvisos();
  const quitar = useQuitarAviso();
  const avisos = (data ?? []).filter((a) => !a.leidoEn).sort((a, b) => a.prioridad - b.prioridad).slice(0, 3);
  if (!avisos.length) return null;

  return (
    <section aria-label="Avisos" className="overflow-hidden rounded-[20px] bg-card">
      {avisos.map((a) => {
        const [Icono, color] = ICONOS[a.tipo] ?? [TriangleAlert, "var(--tint)"];
        return (
          <div
            key={a.id}
            className="relative flex items-start gap-3 py-3 pr-2 pl-4 animate-entrar [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[3.75rem] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
          >
            <span
              aria-hidden
              className="mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
            >
              <Icono className="size-[17px]" strokeWidth={2.2} />
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 text-left active:opacity-60"
              onClick={() => {
                haptico();
                quitar.mutate({ id: a.id, accion: "leido" });
                if (a.enlace?.startsWith("#")) navegar(a.enlace);
              }}
            >
              <span className="block text-[15px] leading-5 font-semibold">{a.titulo}</span>
              <span className="mt-0.5 line-clamp-2 block text-[15px] leading-5 text-muted-foreground">{a.texto}</span>
            </button>
            <button
              type="button"
              aria-label={`Descartar: ${a.titulo}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-fill"
              onClick={() => quitar.mutate({ id: a.id, accion: "descartar" })}
            >
              <X className="size-[18px]" />
            </button>
          </div>
        );
      })}
    </section>
  );
}
