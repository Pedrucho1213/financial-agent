import { type ReactNode, useEffect, useRef, useState } from "react";
import { haptico } from "../lib/haptico";
import { Spinner } from "./Spinner";

const UMBRAL = 72;
const MAXIMO = 120;

/**
 * Jalar hacia abajo desde arriba para volver a pedir los datos, como en iOS.
 * Mueve el contenido con transform (sin re-render por cuadro).
 */
export function JalarParaRefrescar({ alRefrescar, children }: { alRefrescar: () => Promise<unknown>; children: ReactNode }) {
  const contenido = useRef<HTMLDivElement>(null);
  const indicador = useRef<HTMLDivElement>(null);
  const [refrescando, setRefrescando] = useState(false);
  const refrescar = useRef(alRefrescar);
  refrescar.current = alRefrescar;
  const ocupado = useRef(false);

  useEffect(() => {
    let inicioY = 0;
    let inicioX = 0;
    let activo = false;
    let decidido = false;
    let distancia = 0;

    const pintar = (d: number, animado: boolean) => {
      const c = contenido.current;
      const i = indicador.current;
      if (!c || !i) return;
      const t = animado ? "transform 380ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms" : "none";
      c.style.transition = t;
      i.style.transition = t;
      c.style.transform = d ? `translateY(${d}px)` : "";
      i.style.opacity = String(Math.min(1, d / UMBRAL));
      i.style.transform = `translateY(${d / 2 - 14}px) rotate(${(d / UMBRAL) * 270}deg)`;
    };

    const inicio = (e: TouchEvent) => {
      if (ocupado.current || window.scrollY > 0 || e.touches.length !== 1) return;
      if ((e.target as HTMLElement).closest("[role=dialog],[data-sin-jalar]")) return;
      const t = e.touches[0];
      if (!t) return;
      inicioY = t.clientY;
      inicioX = t.clientX;
      activo = true;
      decidido = false;
      distancia = 0;
    };
    const mover = (e: TouchEvent) => {
      if (!activo) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - inicioY;
      const dx = t.clientX - inicioX;
      if (!decidido) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        decidido = true;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
          activo = false;
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      // Resistencia creciente, como el rebote de iOS.
      const antes = distancia;
      distancia = Math.min(MAXIMO, dy * 0.5);
      if (antes < UMBRAL * 0.75 && distancia >= UMBRAL * 0.75) haptico();
      pintar(distancia, false);
    };
    const fin = () => {
      if (!activo) return;
      activo = false;
      if (distancia >= UMBRAL * 0.75) {
        ocupado.current = true;
        setRefrescando(true);
        pintar(52, true);
        Promise.resolve(refrescar.current())
          .catch(() => undefined)
          .finally(() => {
            ocupado.current = false;
            setRefrescando(false);
            pintar(0, true);
          });
      } else {
        pintar(0, true);
      }
    };

    window.addEventListener("touchstart", inicio, { passive: true });
    window.addEventListener("touchmove", mover, { passive: false });
    window.addEventListener("touchend", fin);
    window.addEventListener("touchcancel", fin);
    return () => {
      window.removeEventListener("touchstart", inicio);
      window.removeEventListener("touchmove", mover);
      window.removeEventListener("touchend", fin);
      window.removeEventListener("touchcancel", fin);
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={indicador}
        aria-hidden={!refrescando}
        className="pointer-events-none absolute top-0 left-1/2 -ml-3 flex size-6 items-center justify-center text-muted-foreground opacity-0"
      >
        <Spinner className="size-6" etiqueta="Actualizando" />
      </div>
      <div ref={contenido}>{children}</div>
    </div>
  );
}
