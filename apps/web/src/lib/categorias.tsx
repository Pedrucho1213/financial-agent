import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  Car,
  Coffee,
  CreditCard,
  Dumbbell,
  Fuel,
  Gift,
  HeartPulse,
  House,
  Landmark,
  type LucideIcon,
  PawPrint,
  Pill,
  Plane,
  Popcorn,
  Receipt,
  Repeat,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Utensils,
  Wallet,
  Wifi,
  Zap,
} from "lucide-react";
import type { Categoria, TipoMovimiento } from "./tipos";

// Icono y color por categoría. Las hijas más comunes tienen el suyo; si no, el de la principal.
const POR_NOMBRE: Record<string, [LucideIcon, string]> = {
  vivienda: [House, "#ff9500"],
  renta: [House, "#ff9500"],
  luz: [Zap, "#ffcc00"],
  "internet y teléfono": [Wifi, "#5ac8fa"],
  comida: [Utensils, "#ff9500"],
  súper: [ShoppingCart, "#34c759"],
  café: [Coffee, "#a2845e"],
  restaurantes: [Utensils, "#ff9500"],
  transporte: [Car, "#007aff"],
  gasolina: [Fuel, "#007aff"],
  salud: [HeartPulse, "#ff2d55"],
  farmacia: [Pill, "#ff2d55"],
  gimnasio: [Dumbbell, "#ff2d55"],
  suscripciones: [Repeat, "#af52de"],
  entretenimiento: [Popcorn, "#ff375f"],
  compras: [ShoppingBag, "#5856d6"],
  "ropa y calzado": [Shirt, "#5856d6"],
  "cuidado personal": [Sparkles, "#ff9f0a"],
  educación: [BookOpen, "#5ac8fa"],
  mascotas: [PawPrint, "#a2845e"],
  regalos: [Gift, "#ff2d55"],
  viajes: [Plane, "#30b0c7"],
  "comisiones e intereses": [Landmark, "#8e8e93"],
  sueldo: [Banknote, "#34c759"],
  freelance: [Wallet, "#34c759"],
};

export function iconoCategoria(nombre: string | null, tipo: TipoMovimiento): [LucideIcon, string] {
  if (tipo === "transferencia") return [ArrowLeftRight, "#8e8e93"];
  if (tipo === "pago_tarjeta") return [CreditCard, "#8e8e93"];
  if (nombre) {
    const partes = nombre.split(">").map((p) => p.trim().toLowerCase());
    for (const p of [...partes].reverse()) {
      const e = POR_NOMBRE[p];
      if (e) return e;
    }
  }
  return tipo === "ingreso" ? [Wallet, "#34c759"] : [Receipt, "#8e8e93"];
}

export function IconoCategoria({ nombre, tipo, className }: { nombre: string | null; tipo: TipoMovimiento; className?: string }) {
  const [Icono, color] = iconoCategoria(nombre, tipo);
  return (
    <span
      aria-hidden
      className={`flex size-9 shrink-0 items-center justify-center rounded-full ${className ?? ""}`}
      style={{ backgroundColor: `${color}26`, color }}
    >
      <Icono className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}

/** Categorías agrupadas por la principal, para <optgroup>. */
export function agruparPorPadre(categorias: Categoria[], tipo?: "gasto" | "ingreso") {
  const lista = tipo ? categorias.filter((c) => c.tipo === tipo) : categorias;
  const padres = lista.filter((c) => !c.padreId);
  return padres
    .map((p) => ({ padre: p, hijas: lista.filter((c) => c.padreId === p.id) }))
    .sort((a, b) => (a.padre.tipo === b.padre.tipo ? 0 : a.padre.tipo === "gasto" ? -1 : 1));
}

export function OpcionesCategorias({
  categorias,
  tipo,
  paraFiltrar = false,
}: {
  categorias: Categoria[];
  tipo?: "gasto" | "ingreso";
  /** En filtros, la principal incluye a sus hijas: "Comida (todo)". */
  paraFiltrar?: boolean;
}) {
  return (
    <>
      {agruparPorPadre(categorias, tipo).map(({ padre, hijas }) =>
        hijas.length ? (
          <optgroup key={padre.id} label={padre.nombre}>
            <option value={padre.id}>{paraFiltrar ? `${padre.nombre} (todo)` : `${padre.nombre} (general)`}</option>
            {hijas.map((h) => (
              <option key={h.id} value={h.id}>
                {h.nombre}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={padre.id} value={padre.id}>
            {padre.nombre}
          </option>
        ),
      )}
    </>
  );
}
