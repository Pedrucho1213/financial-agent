import { Search, X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Campo dentro de una fila de lista agrupada: sin borde, alineado a la derecha. */
export function CampoFila({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-11 w-full min-w-0 bg-transparent text-right text-[17px] text-foreground outline-none placeholder:text-placeholder disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Campo de búsqueda al estilo iOS. */
export function Buscador({
  valor,
  onCambio,
  className,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange"> & { valor: string; onCambio: (v: string) => void }) {
  return (
    <div className={cn("relative flex h-9 items-center rounded-[10px] bg-fill", className)}>
      <Search aria-hidden className="pointer-events-none absolute left-2 size-[18px] text-muted-foreground" />
      <input
        type="search"
        enterKeyHint="search"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="h-full w-full min-w-0 bg-transparent pr-8 pl-8 text-[17px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {valor ? (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          onClick={() => onCambio("")}
          className="absolute right-0 flex size-9 items-center justify-center"
        >
          <span className="flex size-[17px] items-center justify-center rounded-full bg-muted-foreground/60 text-card">
            <X className="size-3" strokeWidth={3} />
          </span>
        </button>
      ) : null}
    </div>
  );
}
