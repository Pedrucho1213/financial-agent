import { CalendarClock, ChartNoAxesColumn, Coffee, CreditCard, Copy, HandCoins, Plane, Repeat, Target, TriangleAlert } from "lucide-react";
import type { Aviso } from "../lib/tipos";

/** Icono y color de cada tipo de aviso del revisor nocturno (te pasaste, gasto hormiga, pagos que vienen…). */
export const ICONOS: Record<Aviso["tipo"], [typeof Coffee, string]> = {
  hormiga: [Coffee, "var(--orange)"],
  suscripcion_olvidada: [Repeat, "var(--tint)"],
  suscripcion_duplicada: [Copy, "var(--tint)"],
  cobro_proximo: [CalendarClock, "var(--tint)"],
  presupuesto: [ChartNoAxesColumn, "var(--anillo-gasto)"],
  meta: [Target, "var(--anillo-meta)"],
  msi: [CreditCard, "var(--tint)"],
  prestamo: [HandCoins, "var(--positive)"],
  gasto_inusual: [TriangleAlert, "var(--orange)"],
  tarjeta_pago: [CalendarClock, "var(--orange)"],
  tarjeta_limite: [CreditCard, "var(--orange)"],
  viaje: [Plane, "var(--tint)"],
};
