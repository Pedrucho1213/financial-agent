import { Dialog as DialogPrimitive } from "radix-ui";
import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { cn } from "../../lib/utils";

export const Sheet = DialogPrimitive.Root;

const UMBRAL_CIERRE = 120;
const VELOCIDAD_CIERRE = 0.6; // px/ms

/**
 * Hoja de iOS: sube con resorte, tiene agarradera y se cierra arrastrándola hacia abajo.
 * `izquierda`/`derecha` son los botones de la barra (Cancelar / Guardar).
 */
export function SheetContent({
  className,
  children,
  titulo,
  descripcion,
  izquierda,
  derecha,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  titulo: ReactNode;
  descripcion?: ReactNode;
  izquierda?: ReactNode;
  derecha?: ReactNode;
}) {
  const hoja = useRef<HTMLDivElement>(null);
  const cuerpo = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = hoja.current;
    if (!el) return;
    let inicioY = 0;
    let inicioX = 0;
    let ultimoY = 0;
    let ultimoT = 0;
    let velocidad = 0;
    let estado: "nada" | "decidiendo" | "arrastrando" = "nada";

    const mover = (dy: number) => {
      const y = dy < 0 ? dy / 4 : dy; // resistencia hacia arriba
      el.style.transform = `translateY(${y}px)`;
    };

    const empezar = (x: number, y: number, objetivo: EventTarget | null) => {
      const enCuerpo = cuerpo.current?.contains(objetivo as Node);
      // Desde el contenido solo si ya está hasta arriba.
      if (enCuerpo && (cuerpo.current?.scrollTop ?? 0) > 0) return;
      inicioX = x;
      inicioY = y;
      ultimoY = y;
      ultimoT = performance.now();
      velocidad = 0;
      estado = "decidiendo";
    };

    const seguir = (x: number, y: number, e: Event) => {
      if (estado === "nada") return;
      const dy = y - inicioY;
      const dx = x - inicioX;
      if (estado === "decidiendo") {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
          estado = "arrastrando";
          el.style.transition = "none";
          (document.activeElement as HTMLElement | null)?.blur?.();
        } else {
          estado = "nada";
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      const ahora = performance.now();
      velocidad = (y - ultimoY) / Math.max(1, ahora - ultimoT);
      ultimoY = y;
      ultimoT = ahora;
      mover(dy);
    };

    const terminar = (y: number) => {
      if (estado !== "arrastrando") {
        estado = "nada";
        return;
      }
      estado = "nada";
      const dy = y - inicioY;
      if (dy > UMBRAL_CIERRE || velocidad > VELOCIDAD_CIERRE) {
        el.style.setProperty("--arrastre", `${Math.max(0, dy)}px`);
        el.style.transition = "";
        el.style.transform = "";
        cerrar.current?.click();
      } else {
        el.style.transition = "transform 380ms cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "translateY(0)";
      }
    };

    const ts = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && e.touches.length === 1) empezar(t.clientX, t.clientY, e.target);
    };
    const tm = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) seguir(t.clientX, t.clientY, e);
    };
    const te = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      terminar(t ? t.clientY : inicioY);
    };
    // Con mouse solo desde la barra superior.
    const pd = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !(e.target as HTMLElement).closest("[data-agarradera]")) return;
      if ((e.target as HTMLElement).closest("button")) return;
      empezar(e.clientX, e.clientY, e.target);
      const pm = (ev: PointerEvent) => seguir(ev.clientX, ev.clientY, ev);
      const pu = (ev: PointerEvent) => {
        terminar(ev.clientY);
        window.removeEventListener("pointermove", pm);
        window.removeEventListener("pointerup", pu);
      };
      window.addEventListener("pointermove", pm);
      window.addEventListener("pointerup", pu);
    };

    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("touchcancel", te);
    el.addEventListener("pointerdown", pd);
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("touchcancel", te);
      el.removeEventListener("pointerdown", pd);
    };
  }, []);

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/35 data-[state=closed]:animate-desvanecer data-[state=open]:animate-aparecer" />
      <DialogPrimitive.Content
        ref={hoja}
        data-slot="sheet"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] w-full max-w-lg flex-col rounded-t-[14px] bg-background shadow-[0_-8px_40px_rgb(0_0_0/0.18)] outline-none will-change-transform",
          "data-[state=closed]:animate-bajar data-[state=open]:animate-subir",
          className,
        )}
        {...props}
      >
        <div data-agarradera className="shrink-0 touch-none">
          <div aria-hidden className="mx-auto mt-[5px] h-[5px] w-9 rounded-full bg-muted-foreground/40" />
          <header className="grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4">
            <div className="flex min-w-0 justify-start">{izquierda}</div>
            <DialogPrimitive.Title className="max-w-[55vw] truncate text-center text-[17px] font-semibold">
              {titulo}
            </DialogPrimitive.Title>
            <div className="flex min-w-0 justify-end">{derecha}</div>
          </header>
        </div>
        <DialogPrimitive.Description className="sr-only">{descripcion ?? titulo}</DialogPrimitive.Description>
        <DialogPrimitive.Close ref={cerrar} className="sr-only" tabIndex={-1} aria-hidden>
          Cerrar
        </DialogPrimitive.Close>
        <div
          ref={cuerpo}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))]"
        >
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const SheetClose = DialogPrimitive.Close;
