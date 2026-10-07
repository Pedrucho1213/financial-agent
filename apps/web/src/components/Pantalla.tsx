import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { JalarParaRefrescar } from "./JalarParaRefrescar";

/**
 * Pantalla con título grande que, al desplazarse, se vuelve un título compacto
 * en una barra translúcida (como las apps de Apple). Usa IntersectionObserver, no eventos de scroll.
 */
export function Pantalla({
  titulo,
  tituloCompacto,
  encima,
  junto,
  derecha,
  children,
  className,
  barraFija = false,
  alRefrescar,
  atras,
}: {
  titulo: ReactNode;
  /** Texto de la barra compacta; por omisión, el título. */
  tituloCompacto?: ReactNode;
  /** Línea pequeña sobre el título grande. */
  encima?: ReactNode;
  /** Algo al lado del título grande (por ejemplo, flechas de mes). */
  junto?: ReactNode;
  /** Botones a la derecha de la barra superior. */
  derecha?: ReactNode;
  children: ReactNode;
  className?: string;
  /** La barra siempre se ve compacta (Chat). */
  barraFija?: boolean;
  /** Activa jalar para refrescar. */
  alRefrescar?: () => Promise<unknown>;
  /** Botón "‹ Atrás" a la izquierda de la barra (páginas que se abren encima de una pestaña). */
  atras?: { etiqueta: string; alTocar: () => void };
}) {
  const barra = useRef<HTMLDivElement>(null);
  const marca = useRef<HTMLDivElement>(null);
  const [compacta, setCompacta] = useState(barraFija);

  useEffect(() => {
    if (barraFija) return;
    const m = marca.current;
    const b = barra.current;
    if (!m || !b) return;
    const io = new IntersectionObserver(([e]) => setCompacta(!!e && !e.isIntersecting && e.boundingClientRect.top < b.offsetHeight + 1), {
      rootMargin: `-${b.offsetHeight}px 0px 0px 0px`,
      threshold: 0,
    });
    io.observe(m);
    return () => io.disconnect();
  }, [barraFija]);

  const cuerpo = (
    <>
      {barraFija ? null : (
        <header className="mx-auto max-w-3xl px-safe pb-2">
          {encima ? <div className="text-[15px] font-medium text-muted-foreground">{encima}</div> : null}
          <div className="flex min-h-[41px] items-end justify-between gap-3">
            <h1 className="min-w-0 truncate text-[34px] leading-[41px] font-bold tracking-[-0.02em]">{titulo}</h1>
            {junto}
          </div>
        </header>
      )}
      <div ref={marca} aria-hidden className="h-px" />
      <div className="mx-auto max-w-3xl px-safe">{children}</div>
    </>
  );

  return (
    <div className={cn("min-h-dvh", className)}>
      <div
        ref={barra}
        className={cn(
          "sticky top-0 z-30 pt-safe transition-[background-color,box-shadow,backdrop-filter] duration-200",
          compacta ? "material hairline-b" : "bg-background",
        )}
      >
        <div className="relative mx-auto flex h-11 max-w-3xl items-center justify-end px-safe">
          {atras ? (
            <button
              type="button"
              onClick={atras.alTocar}
              className="absolute left-[max(0.5rem,env(safe-area-inset-left))] z-10 flex h-11 max-w-[40%] items-center gap-0.5 pr-2 text-[17px] text-tint active:opacity-50"
            >
              <ChevronLeft className="size-[26px] shrink-0" strokeWidth={2.4} aria-hidden />
              <span className="truncate">{atras.etiqueta}</span>
            </button>
          ) : null}
          <div
            aria-hidden={!compacta}
            className={cn(
              "pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold transition-[opacity,transform] duration-200 ease-ios",
              compacta ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
            )}
          >
            {tituloCompacto ?? titulo}
          </div>
          <div className="relative flex items-center gap-1">{derecha}</div>
        </div>
      </div>
      {alRefrescar ? <JalarParaRefrescar alRefrescar={alRefrescar}>{cuerpo}</JalarParaRefrescar> : cuerpo}
    </div>
  );
}
