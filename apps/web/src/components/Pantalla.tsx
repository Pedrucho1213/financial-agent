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
  izquierda,
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
  /** La barra siempre se ve compacta (IA). */
  barraFija?: boolean;
  /** Activa jalar para refrescar. */
  alRefrescar?: () => Promise<unknown>;
  /** Botón "‹ Atrás" a la izquierda de la barra (páginas que se abren encima de una pestaña). */
  atras?: { etiqueta: string; alTocar: () => void };
  /** Algo a la izquierda de la barra superior, en lugar de "‹ Atrás" (el mes en Inicio). */
  izquierda?: ReactNode;
}) {
  const barra = useRef<HTMLDivElement>(null);
  const marca = useRef<HTMLDivElement>(null);
  const cabecera = useRef<HTMLElement>(null);
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

  // El título grande se desvanece al pasar bajo la barra, en vez de verse cortado a la mitad. Cada renglón (la fecha y el
  // título) según lo que le queda a la vista.
  useEffect(() => {
    if (barraFija) return;
    const h = cabecera.current;
    const b = barra.current;
    if (!h || !b) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          const visto = e.boundingClientRect.top < b.offsetHeight + 1 ? e.intersectionRatio : 1;
          (e.target as HTMLElement).style.opacity = String(Math.max(0, Math.min(1, (visto - 0.5) / 0.5)));
        }
      },
      { rootMargin: `-${b.offsetHeight}px 0px 0px 0px`, threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );
    for (const hijo of h.children) io.observe(hijo);
    return () => io.disconnect();
  }, [barraFija]);

  // Como en iOS, el título grande no se queda a medias: al soltar, se abre completo o se va bajo la barra.
  useEffect(() => {
    if (barraFija) return;
    let tocando = false;
    let espera = 0;
    const ajustar = () => {
      const h = cabecera.current;
      const b = barra.current;
      if (tocando || !h || !b) return;
      const alto = h.offsetHeight;
      // En una pantalla que apenas se desplaza, regresar arriba escondería lo último: ahí no se ajusta.
      if (document.documentElement.scrollHeight - window.innerHeight < alto + 1) return;
      const tapado = b.getBoundingClientRect().bottom - h.getBoundingClientRect().top;
      if (alto && tapado > 0.5 && tapado < alto) window.scrollBy({ top: tapado < alto / 2 ? -tapado : alto + 1 - tapado, behavior: "smooth" });
    };
    const programar = () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(ajustar, 140);
    };
    const tocar = () => {
      tocando = true;
      window.clearTimeout(espera);
    };
    const soltar = () => {
      tocando = false;
      programar();
    };
    window.addEventListener("scroll", programar, { passive: true });
    window.addEventListener("touchstart", tocar, { passive: true });
    window.addEventListener("touchend", soltar, { passive: true });
    window.addEventListener("touchcancel", soltar, { passive: true });
    return () => {
      window.clearTimeout(espera);
      window.removeEventListener("scroll", programar);
      window.removeEventListener("touchstart", tocar);
      window.removeEventListener("touchend", soltar);
      window.removeEventListener("touchcancel", soltar);
    };
  }, [barraFija]);

  const cuerpo = (
    <>
      {barraFija ? null : (
        <header ref={cabecera} className="mx-auto max-w-3xl px-safe pb-2">
          {encima ? <div className="text-[15px] font-medium text-muted-foreground transition-opacity duration-100">{encima}</div> : null}
          <div className="flex min-h-[41px] items-end justify-between gap-3 transition-opacity duration-100">
            <h1 className="min-w-0 text-balance break-words text-[34px] leading-[41px] max-[359px]:text-[30px] max-[359px]:leading-9 font-bold tracking-[-0.02em]">{titulo}</h1>
            {junto}
          </div>
        </header>
      )}
      <div ref={marca} aria-hidden className="h-px" />
      <div className="mx-auto max-w-3xl px-safe">{children}</div>
    </>
  );

  return (
    // La app ya deja el alto de la pantalla y el espacio de la barra de abajo: aquí solo lo que queda,
    // para que una pantalla corta no se pueda desplazar de más.
    <div className={cn("min-h-[calc(100dvh-var(--barra-inferior)-28px)]", className)}>
      <div
        ref={barra}
        // Opaca a propósito: desde iOS 26 la app instalada pone su propio difuminado arriba (bajo la hora y un poco
        // más), encima de la campana, «Octubre» y el título. WebKit no lo pone si una barra fija con fondo sólido
        // cubre el borde de arriba; con fondo translúcido sí.
        className={cn("sticky top-0 z-30 pt-safe transition-colors duration-200", compacta ? "bg-bar-solida hairline-b" : "bg-background")}
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
          ) : izquierda ? (
            <div className="absolute left-[max(1rem,env(safe-area-inset-left))] z-10 flex h-11 max-w-[45%] items-center">{izquierda}</div>
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
