import { AlertDialog as AlertPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Alerta de iOS: centrada, compacta, con botones separados por líneas finas. */
export function Confirmar({
  abierto,
  onAbiertoChange,
  titulo,
  descripcion,
  confirmar,
  onConfirmar,
  peligro = true,
}: {
  abierto: boolean;
  onAbiertoChange: (v: boolean) => void;
  titulo: ReactNode;
  descripcion: ReactNode;
  confirmar: string;
  onConfirmar: () => void;
  peligro?: boolean;
}) {
  return (
    <AlertPrimitive.Root open={abierto} onOpenChange={onAbiertoChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 data-[state=closed]:animate-desvanecer data-[state=open]:animate-aparecer" />
        <AlertPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[270px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[22px] text-center vidrio outline-none data-[state=closed]:animate-desvanecer data-[state=open]:animate-escalar">
          <div className="px-4 pt-5 pb-4">
            <AlertPrimitive.Title className="text-[17px] leading-snug font-semibold">{titulo}</AlertPrimitive.Title>
            <AlertPrimitive.Description className="mt-1 text-[13px] leading-snug text-foreground/80">
              {descripcion}
            </AlertPrimitive.Description>
          </div>
          <div className="grid grid-cols-2 hairline-t">
            <AlertPrimitive.Cancel className="h-11 text-[17px] text-tint active:bg-fill">Cancelar</AlertPrimitive.Cancel>
            <AlertPrimitive.Action
              className={cn(
                "h-11 text-[17px] font-semibold active:bg-fill",
                "shadow-[inset_0.5px_0_0_var(--separator)]",
                peligro ? "text-destructive" : "text-tint",
              )}
              onClick={onConfirmar}
            >
              {confirmar}
            </AlertPrimitive.Action>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}
