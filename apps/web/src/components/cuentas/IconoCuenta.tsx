import { Banknote, CreditCard, Landmark, type LucideIcon, Ticket, Wallet } from "lucide-react";
import { marcaDe } from "../../lib/marcas";
import type { TipoCuenta } from "../../lib/tipos";
import { cn } from "../../lib/utils";
import { LogoMarca } from "../Logo";

const ICONOS: Record<TipoCuenta, [LucideIcon, string]> = {
  efectivo: [Banknote, "#34c759"],
  debito: [Landmark, "#007aff"],
  credito: [CreditCard, "#ff9500"],
  transferencia: [Landmark, "#007aff"],
  vales: [Ticket, "#34c759"],
  monedero: [Wallet, "#af52de"],
  otra: [Wallet, "#8e8e93"],
};

/**
 * El logo del banco si lo reconoce por el nombre (BBVA, Nu, Revolut…); si no, un cuadro teñido: verde efectivo,
 * azul débito, naranja crédito.
 */
export function IconoCuenta({ tipo, nombre, institucion, className }: { tipo: TipoCuenta; nombre?: string; institucion?: string | null; className?: string }) {
  const marca = tipo === "efectivo" ? null : marcaDe(nombre, institucion);
  if (marca) return <LogoMarca clave={marca} className={className} />;
  const [Icono, color] = ICONOS[tipo] ?? ICONOS.otra;
  return (
    <span
      aria-hidden
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-[11px]", className)}
      style={{ backgroundColor: `${color}26`, color }}
    >
      <Icono className="size-5" strokeWidth={2.2} />
    </span>
  );
}
