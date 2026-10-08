import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

/** Monto grande centrado, como el editor de movimientos. */
export function CampoMonto({ id, valor, onCambio, moneda, enfocar }: { id: string; valor: string; onCambio: (v: string) => void; moneda: string; enfocar?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!enfocar) return;
    const t = window.setTimeout(() => ref.current?.focus(), 420);
    return () => window.clearTimeout(t);
  }, [enfocar]);
  return (
    <div className="flex flex-col items-center pt-2 pb-1">
      <label htmlFor={id} className="sr-only">
        Monto
      </label>
      <div className="flex max-w-full items-start justify-center text-[52px] font-bold tracking-[-0.03em] tabular">
        <span className={cn("mt-[0.14em] mr-0.5 text-[0.52em] leading-none", !valor && "text-placeholder")}>$</span>
        <span className="inline-grid">
          <span aria-hidden className="invisible col-start-1 row-start-1 leading-[1.1] whitespace-pre">
            {valor || "0"}
          </span>
          <input
            ref={ref}
            id={id}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="0"
            size={1}
            value={valor}
            onChange={(e) => onCambio(e.target.value.replace(/[^\d.,]/g, "").slice(0, 12))}
            className="col-start-1 row-start-1 w-full min-w-0 bg-transparent p-0 text-center text-[1em] leading-[1.1] font-bold tracking-[inherit] outline-none placeholder:text-placeholder"
          />
        </span>
      </div>
      <span className="text-[13px] font-medium text-muted-foreground">{moneda}</span>
    </div>
  );
}
