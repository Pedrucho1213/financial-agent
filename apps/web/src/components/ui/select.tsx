import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Un <select> nativo invisible encima de lo que se ve: en iPhone abre la rueda del sistema.
 * El aspecto lo pone `children` (una fila, un chip...); las opciones van en `opciones`.
 */
export function SelectNativo({
  className,
  children,
  opciones,
  ...props
}: Omit<ComponentProps<"select">, "children"> & { children: ReactNode; opciones: ReactNode }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      {children}
      <select
        data-slot="select"
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
        {...props}
      >
        {opciones}
      </select>
    </div>
  );
}
