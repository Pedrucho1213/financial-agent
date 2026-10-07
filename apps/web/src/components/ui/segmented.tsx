import { useLayoutEffect, useRef, useState } from "react";
import { haptico } from "../../lib/haptico";
import { cn } from "../../lib/utils";

type Opcion<T extends string> = { valor: T; etiqueta: string };

/** Control segmentado de iOS con la pastilla que se desliza al elegir. */
export function Segmented<T extends string>({
  opciones,
  valor,
  onChange,
  etiqueta,
  className,
}: {
  opciones: Opcion<T>[];
  valor: T;
  onChange: (v: T) => void;
  etiqueta: string;
  className?: string;
}) {
  const indice = Math.max(
    0,
    opciones.findIndex((o) => o.valor === valor),
  );
  const activo = opciones.some((o) => o.valor === valor);
  const ref = useRef<HTMLDivElement>(null);
  const [listo, setListo] = useState(false);
  useLayoutEffect(() => {
    // Sin animación en el primer render, solo al cambiar.
    const id = requestAnimationFrame(() => setListo(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={etiqueta}
      className={cn("relative grid h-8 rounded-[9px] bg-fill p-0.5", className)}
      style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}
    >
      {activo ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 bottom-0.5 left-0.5 rounded-[7px] bg-card shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] dark:bg-[#636366]",
            listo && "transition-transform duration-300 ease-ios",
          )}
          style={{
            width: `calc((100% - 4px) / ${opciones.length})`,
            transform: `translateX(${indice * 100}%)`,
          }}
        />
      ) : null}
      {opciones.map((o) => {
        const sel = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => {
              if (!sel) haptico();
              onChange(o.valor);
            }}
            className={cn(
              "relative z-[1] min-w-0 truncate px-1.5 text-[13px] transition-[font-weight,color] duration-200",
              sel ? "font-semibold text-foreground" : "font-medium text-foreground/80",
            )}
          >
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
