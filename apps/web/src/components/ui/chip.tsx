import type { ComponentProps, ReactNode } from "react";
import { haptico } from "../../lib/haptico";
import { cn } from "../../lib/utils";

const claseChip =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-card px-3 text-[15px] font-medium whitespace-nowrap text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-[background-color,color,scale] duration-200 ease-ios";

/** Cápsula que se elige con un toque (categoría, cuenta, etiqueta). Con `icono`, va pegado a la orilla. */
export function Chip({
  activo,
  icono,
  className,
  children,
  onClick,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { activo?: boolean; icono?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={(e) => {
        haptico();
        onClick?.(e);
      }}
      className={cn(claseChip, "active:scale-95", icono && "pl-[5px]", activo && "bg-tint text-white", className)}
      {...props}
    >
      {icono}
      {children}
    </button>
  );
}

/** Solo el aspecto de un chip, para ponerlo debajo de un <select> nativo (SelectNativo). */
export function ChipVisual({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn(claseChip, className)}>{children}</span>;
}

/** Fila de chips que se desliza de lado, de orilla a orilla de la hoja. */
export function Chips({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)} {...props}>
      {children}
    </div>
  );
}

/** Título chico en mayúsculas sobre un grupo de chips. */
export function TituloChips({ children, className, ...props }: ComponentProps<"h3">) {
  return (
    <h3 className={cn("px-4 pb-1 text-[13px] text-muted-foreground uppercase", className)} {...props}>
      {children}
    </h3>
  );
}
