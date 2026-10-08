import { Banknote, CreditCard, Landmark, type LucideIcon, Wallet } from "lucide-react";
import type { TipoCuenta } from "../../lib/tipos";
import { cn } from "../../lib/utils";

const ICONOS: Record<TipoCuenta, [LucideIcon, string]> = {
  efectivo: [Banknote, "#34c759"],
  debito: [Landmark, "#007aff"],
  credito: [CreditCard, "#ff9500"],
  otra: [Wallet, "#8e8e93"],
};

/** Círculo teñido como el de las categorías: verde efectivo, azul débito, naranja crédito. */
export function IconoCuenta({ tipo, className }: { tipo: TipoCuenta; className?: string }) {
  const [Icono, color] = ICONOS[tipo] ?? ICONOS.otra;
  return (
    <span
      aria-hidden
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", className)}
      style={{ backgroundColor: `${color}26`, color }}
    >
      <Icono className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}
