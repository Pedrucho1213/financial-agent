import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { preguntarAlChat } from "../../lib/chat";
import { haptico } from "../../lib/haptico";
import { useAvisos, useQuitarAviso } from "../../lib/plan";
import { hashDe, navegar } from "../../lib/ruta";
import { cn } from "../../lib/utils";
import { ICONOS } from "../Avisos";
import type { Destacado } from "../Destacados";

type Item = {
  id: string;
  icono: ReactNode;
  color: string;
  titulo: ReactNode;
  texto: ReactNode;
  accion?: { texto: string; alTocar: () => void; usaChat?: boolean };
  /** Los avisos se pueden descartar. */
  alDescartar?: () => void;
};

/**
 * "Para ti": lo que encontró el revisor (te pasaste, gasto hormiga, pagos que vienen) y los consejos que salen de tus
 * números (ritmo del mes, ahorro, tu día caro), uno a la vez. Se pasa con el dedo o con las flechas.
 */
export function ParaTi({ destacados, conAvisos, enLinea }: { destacados: Destacado[]; conAvisos: boolean; enLinea: boolean }) {
  const avisos = useAvisos();
  const quitar = useQuitarAviso();
  const qc = useQueryClient();
  const carril = useRef<HTMLDivElement>(null);
  const [pagina, setPagina] = useState(0);

  const nuevos = conAvisos ? (avisos.data ?? []).filter((a) => !a.leidoEn).sort((a, b) => a.prioridad - b.prioridad) : [];
  const items: Item[] = [
    ...nuevos.map((a): Item => {
      const [Icono, color] = ICONOS[a.tipo] ?? [TriangleAlert, "var(--tint)"];
      return {
        id: `aviso-${a.id}`,
        icono: <Icono className="size-5" strokeWidth={2.2} />,
        color,
        titulo: a.titulo,
        texto: a.texto,
        accion: a.enlace?.startsWith("#")
          ? {
              texto: "Ver",
              alTocar: () => {
                void quitar
                  .mutateAsync({ id: a.id, accion: "leido" })
                  .catch(() => {})
                  .finally(() => void qc.invalidateQueries({ queryKey: ["plan", "avisos"] }));
                navegar(a.enlace!);
              },
            }
          : undefined,
        alDescartar: () => quitar.mutate({ id: a.id, accion: "descartar" }),
      };
    }),
    ...destacados.map(
      (d): Item => ({
        id: d.id,
        icono: <d.Icono className="size-5" strokeWidth={2.2} />,
        color: d.color,
        titulo: d.etiqueta,
        texto: (
          <>
            {d.titulo}
            {d.detalle ? <> {d.detalle}</> : null}
          </>
        ),
        accion: {
          texto: d.accion.texto,
          usaChat: !d.accion.ir,
          alTocar: () => {
            if (d.accion.ir) return navegar(d.accion.ir);
            if (d.accion.pregunta) {
              if (!preguntarAlChat(d.accion.pregunta)) toast("Espera a que termine la respuesta anterior.");
              navegar(hashDe("chat"));
            }
          },
        },
      }),
    ),
  ];

  // Si se descarta el último, la página no se queda fuera.
  useEffect(() => {
    if (pagina > 0 && pagina >= items.length) setPagina(Math.max(0, items.length - 1));
  }, [items.length, pagina]);

  // La caja mide lo de la tarjeta que se ve (sin espacio vacío abajo) y, al deslizar, va pasando de un alto al otro con el
  // dedo: lo de abajo se mueve parejo y nada se queda recortado ni con scroll adentro.
  const ajustarAlto = () => {
    const el = carril.current;
    const hijos = el ? ([...el.children] as HTMLElement[]) : [];
    if (!el || !hijos[0]) return;
    const pos = Math.max(0, Math.min(hijos.length - 1, el.scrollLeft / (hijos[0].offsetWidth + 16)));
    const i = Math.floor(pos);
    const f = pos - i;
    const a = hijos[i]!.offsetHeight;
    const b = hijos[Math.min(hijos.length - 1, i + 1)]!.offsetHeight;
    el.style.height = `${a + (b - a) * f}px`;
  };
  useLayoutEffect(() => {
    const el = carril.current;
    if (!el) return;
    ajustarAlto();
    const ro = new ResizeObserver(ajustarAlto);
    for (const h of el.children) ro.observe(h);
    return () => ro.disconnect();
  }, [items.length]);

  if (!items.length) return null;

  const irA = (i: number) => {
    const n = Math.min(items.length - 1, Math.max(0, i));
    const el = carril.current;
    const primero = el?.children[0] as HTMLElement | undefined;
    if (!el || !primero) return;
    haptico();
    el.scrollTo({ left: n * (primero.offsetWidth + 16), behavior: "smooth" });
  };

  return (
    <section aria-label="Para ti" aria-roledescription="carrusel">
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <h2 className="text-[20px] leading-[25px] font-bold tracking-[-0.02em]">Para ti</h2>
        {items.length > 1 ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground tabular" aria-live="polite">
              {pagina + 1} de {items.length}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Anterior"
                disabled={pagina === 0}
                onClick={() => irA(pagina - 1)}
                className="flex size-[30px] items-center justify-center rounded-full bg-fill text-foreground active:opacity-60 disabled:opacity-35"
              >
                <ChevronLeft className="size-4" strokeWidth={2.6} />
              </button>
              <button
                type="button"
                aria-label="Siguiente"
                disabled={pagina >= items.length - 1}
                onClick={() => irA(pagina + 1)}
                className="flex size-[30px] items-center justify-center rounded-full bg-fill text-foreground active:opacity-60 disabled:opacity-35"
              >
                <ChevronRight className="size-4" strokeWidth={2.6} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div
        ref={carril}
        data-sin-jalar
        // Cada consejo es su propia tarjeta, con aire entre una y otra al deslizar (el mismo que el margen de la pantalla, para
        // que en reposo no asome una orilla de la siguiente).
        className="carrusel -mx-4 scroll-px-4 items-start gap-4 overflow-y-hidden px-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          ajustarAlto();
          const primero = el.children[0] as HTMLElement | undefined;
          if (!primero) return;
          const n = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollLeft / (primero.offsetWidth + 16))));
          if (n !== pagina) setPagina(n);
        }}
      >
        {items.map((it, i) => (
          <article
            key={it.id}
            aria-label={`${i + 1} de ${items.length}`}
            aria-hidden={i !== pagina}
            className="relative flex w-full shrink-0 items-start gap-3 rounded-[20px] bg-card py-3.5 pr-3 pl-4"
          >
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[11px] text-white" style={{ backgroundColor: it.color }}>
              {it.icono}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className={cn("text-[16px] leading-[21px] font-semibold", it.alDescartar && "pr-7")}>{it.titulo}</h3>
              <p className="mt-0.5 text-[14px] leading-[19px] text-pretty text-muted-foreground">{it.texto}</p>
              {it.accion ? (
                <button
                  type="button"
                  tabIndex={i === pagina ? 0 : -1}
                  disabled={it.accion.usaChat && !enLinea}
                  onClick={() => {
                    haptico();
                    it.accion!.alTocar();
                  }}
                  className="-ml-0.5 mt-1 flex h-8 items-center gap-0.5 text-[15px] font-medium text-tint active:opacity-50 disabled:opacity-40"
                >
                  {it.accion.texto}
                  <ChevronRight className="size-4" strokeWidth={2.6} />
                </button>
              ) : null}
            </div>
            {it.alDescartar ? (
              <button
                type="button"
                tabIndex={i === pagina ? 0 : -1}
                aria-label={`Descartar: ${typeof it.titulo === "string" ? it.titulo : "aviso"}`}
                onClick={() => {
                  haptico();
                  it.alDescartar!();
                }}
                className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-muted-foreground active:bg-fill"
              >
                <X className="size-[18px]" />
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
