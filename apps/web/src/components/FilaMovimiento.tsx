import { CreditCard, FileDown, Mic, Smartphone } from "lucide-react";
import { dinero, TIPOS } from "../lib/formato";
import { minutoDelDia } from "../lib/filas";
import type { MovimientoApp, Origen } from "../lib/tipos";
import { cn } from "../lib/utils";
import { LogoMovimiento } from "./Logo";
import { Badge } from "./ui/badge";

const ICONO_ORIGEN: Record<Origen, [typeof Mic, string]> = {
  voz: [Mic, "Dictado por voz"],
  app: [Smartphone, "Desde la app"],
  apple_pay: [CreditCard, "Apple Pay"],
  importacion: [FileDown, "Importado"],
};

export function IconoOrigen({ origen, className }: { origen: Origen; className?: string }) {
  const [Icono, etiqueta] = ICONO_ORIGEN[origen] ?? ICONO_ORIGEN.app;
  return <Icono role="img" aria-label={etiqueta} className={cn("size-[13px] shrink-0 text-muted-foreground", className)} strokeWidth={2.2} />;
}

export function Monto({ m, className }: { m: MovimientoApp; className?: string }) {
  const texto = dinero(Math.abs(m.montoCentavos), m.moneda);
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        m.tipo === "ingreso" && "text-positive",
        (m.tipo === "transferencia" || m.tipo === "pago_tarjeta") && "text-muted-foreground",
        className,
      )}
    >
      {m.tipo === "gasto" ? `−${texto}` : m.tipo === "ingreso" ? `+${texto}` : texto}
    </span>
  );
}

export function tituloDe(m: MovimientoApp) {
  return m.comercio ?? m.descripcion ?? m.categoria?.split(">").pop()?.trim() ?? TIPOS[m.tipo] ?? "Movimiento";
}

export function subtituloDe(m: MovimientoApp) {
  const categoria = m.categoria?.split(">").pop()?.trim() ?? (m.tipo === "gasto" ? "Sin categoría" : TIPOS[m.tipo]);
  // Transferencias y pagos: de dónde a dónde.
  if (m.cuentaDestino) return `${categoria} · ${m.cuenta ?? "?"} → ${m.cuentaDestino}`;
  const etiquetas = m.etiquetas?.length ? ` · ${m.etiquetas.map((e) => `#${e.nombre}`).join(" ")}` : "";
  return `${m.cuenta ? `${categoria} · ${m.cuenta}` : categoria}${etiquetas}`;
}

/** "8:12": la hora en que pasó, si se sabe. */
export function horaDe(m: MovimientoApp): string | null {
  const minuto = minutoDelDia(m.ocurridoEn);
  if (minuto === null) return null;
  return `${Math.floor(minuto / 60)}:${String(minuto % 60).padStart(2, "0")}`;
}

/** El contenido de la fila de un movimiento: su logo, qué fue, categoría y cuenta, y el monto. */
export function ContenidoMovimiento({ m, conHora = false }: { m: MovimientoApp; conHora?: boolean }) {
  const hora = conHora ? horaDe(m) : null;
  return (
    <div className="flex min-h-[62px] items-center gap-3 px-4 py-2" data-movimiento={m.id}>
      <LogoMovimiento comercio={m.comercio} descripcion={m.descripcion} categoria={m.categoria} tipo={m.tipo} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[17px]">{tituloDe(m)}</span>
          <IconoOrigen origen={m.origen} />
        </div>
        <div className="line-clamp-2 text-[15px] leading-5 text-muted-foreground">
          {hora ? `${hora} · ` : ""}
          {subtituloDe(m)}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Monto m={m} className="text-[17px]" />
        {m.revisar ? <Badge variant="warning">Revisar</Badge> : null}
      </div>
    </div>
  );
}
