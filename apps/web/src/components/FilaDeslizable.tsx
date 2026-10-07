import { Trash } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { haptico } from "../lib/haptico";
import { cn } from "../lib/utils";

const ANCHO_BOTON = 84;
const BORRADO_COMPLETO = 0.6; // fracción del ancho de la fila

// Solo una fila abierta a la vez, como en iOS.
let cerrarAbierta: (() => void) | null = null;

/**
 * Fila que se desliza a la izquierda para mostrar "Eliminar".
 * Deslizar hasta el fondo elimina de una vez. Tocarla abre el detalle.
 */
export function FilaDeslizable({
  children,
  alTocar,
  alEliminar,
  deshabilitada,
  className,
  etiqueta,
}: {
  children: ReactNode;
  alTocar: () => void;
  alEliminar: () => void;
  deshabilitada?: boolean;
  className?: string;
  etiqueta: string;
}) {
  const fila = useRef<HTMLDivElement>(null);
  const frente = useRef<HTMLDivElement>(null);
  const fondo = useRef<HTMLButtonElement>(null);
  const acciones = useRef({ alTocar, alEliminar, deshabilitada });
  acciones.current = { alTocar, alEliminar, deshabilitada };
  const arrastro = useRef(false);

  useEffect(() => {
    const el = frente.current;
    const contenedor = fila.current;
    if (!el || !contenedor) return;
    let x0 = 0;
    let y0 = 0;
    let base = 0;
    let actual = 0;
    let estado: "nada" | "decidiendo" | "horizontal" = "nada";
    let pasoUmbral = false;

    const poner = (x: number, animado: boolean) => {
      actual = x;
      el.style.transition = animado ? "transform 320ms cubic-bezier(0.32, 0.72, 0, 1)" : "none";
      el.style.transform = x ? `translateX(${x}px)` : "";
      const b = fondo.current;
      if (b) {
        b.style.transition = el.style.transition.replace("transform", "width");
        b.style.width = `${Math.max(0, -x)}px`;
      }
    };
    const cerrar = () => {
      poner(0, true);
      if (cerrarAbierta === cerrar) cerrarAbierta = null;
    };

    const inicio = (e: TouchEvent) => {
      if (acciones.current.deshabilitada) return;
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      if (cerrarAbierta && cerrarAbierta !== cerrar) cerrarAbierta();
      x0 = t.clientX;
      y0 = t.clientY;
      base = actual;
      pasoUmbral = false;
      estado = "decidiendo";
      arrastro.current = false;
    };
    const mover = (e: TouchEvent) => {
      if (estado === "nada") return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (estado === "decidiendo") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          estado = "horizontal";
          arrastro.current = true;
        } else {
          estado = "nada";
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      let x = base + dx;
      if (x > 0) x = x / 6; // resistencia a la derecha
      poner(x, false);
      // Un "tic" al llegar al punto en que soltar borra de una vez.
      const ahora = -x > contenedor.offsetWidth * BORRADO_COMPLETO;
      if (ahora !== pasoUmbral) {
        pasoUmbral = ahora;
        haptico();
      }
    };
    const fin = () => {
      if (estado !== "horizontal") {
        estado = "nada";
        return;
      }
      estado = "nada";
      const ancho = contenedor.offsetWidth;
      if (-actual > ancho * BORRADO_COMPLETO) {
        poner(-ancho, true);
        window.setTimeout(() => acciones.current.alEliminar(), 180);
        return;
      }
      if (-actual > ANCHO_BOTON / 2) {
        poner(-ANCHO_BOTON, true);
        cerrarAbierta = cerrar;
      } else {
        cerrar();
      }
    };

    el.addEventListener("touchstart", inicio, { passive: true });
    el.addEventListener("touchmove", mover, { passive: false });
    el.addEventListener("touchend", fin);
    el.addEventListener("touchcancel", fin);
    return () => {
      el.removeEventListener("touchstart", inicio);
      el.removeEventListener("touchmove", mover);
      el.removeEventListener("touchend", fin);
      el.removeEventListener("touchcancel", fin);
      if (cerrarAbierta === cerrar) cerrarAbierta = null;
    };
  }, []);

  return (
    <div ref={fila} className={cn("relative overflow-hidden", className)}>
      <button
        ref={fondo}
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => acciones.current.alEliminar()}
        className="absolute inset-y-0 right-0 flex w-0 items-center justify-center overflow-hidden bg-destructive text-[15px] font-medium text-white"
      >
        <span className="flex min-w-[84px] flex-col items-center gap-0.5">
          <Trash className="size-5" />
          Eliminar
        </span>
      </button>
      <div
        ref={frente}
        role="button"
        tabIndex={0}
        aria-label={etiqueta}
        className="fila-presionable relative bg-card [touch-action:pan-y]"
        onClick={() => {
          if (arrastro.current) {
            arrastro.current = false;
            return;
          }
          if (cerrarAbierta) {
            cerrarAbierta();
            return;
          }
          acciones.current.alTocar();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            acciones.current.alTocar();
          }
          if (e.key === "Delete" || e.key === "Backspace") acciones.current.alEliminar();
        }}
      >
        {children}
      </div>
    </div>
  );
}
