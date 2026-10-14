import { ChartColumnBig, MapPin, Repeat, Target } from "lucide-react";
import { haptico } from "../lib/haptico";
import { hashDe, navegar } from "../lib/ruta";

const ACCESOS = [
  { id: "analisis", titulo: "Análisis", Icono: ChartColumnBig, color: "var(--serie-6)" },
  { id: "plan", titulo: "Presupuesto", Icono: Target, color: "var(--anillo-gasto)" },
  { id: "suscripciones", titulo: "Suscripciones", Icono: Repeat, color: "var(--serie-4)" },
  { id: "mapa", titulo: "Mapa", Icono: MapPin, color: "var(--tint)" },
] as const;

/**
 * Los cuatro accesos de Inicio, en una fila como los de Wallet. En pantallas angostas (iPhone 13 mini o con texto
 * grande) pasan a 2×2 con el icono a un lado, para que los nombres no se corten.
 */
export function Accesos() {
  return (
    <nav aria-label="Accesos" className="@container">
      <div className="grid grid-cols-4 gap-2 @max-[340px]:grid-cols-2">
        {ACCESOS.map(({ id, titulo, Icono, color }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              haptico();
              navegar(hashDe(id));
            }}
            className="presionable flex min-w-0 flex-col items-center gap-1.5 py-0.5 @max-[340px]:flex-row @max-[340px]:gap-2 @max-[340px]:rounded-2xl @max-[340px]:bg-card @max-[340px]:px-2.5 @max-[340px]:py-2.5"
          >
            <span
              aria-hidden
              className="flex size-14 items-center justify-center rounded-[18px] bg-card shadow-[0_1px_3px_rgb(0_0_0/0.06),0_4px_14px_rgb(0_0_0/0.05)] @max-[340px]:size-7 @max-[340px]:rounded-[9px] @max-[340px]:bg-fill @max-[340px]:shadow-none"
              style={{ color }}
            >
              <Icono className="size-[26px] @max-[340px]:size-[17px]" strokeWidth={2} />
            </span>
            <span className="max-w-full truncate text-[12px] font-medium @max-[380px]:text-[11px] @max-[380px]:tracking-[-0.01em] @max-[340px]:text-[13px] @max-[340px]:tracking-[-0.02em]">
              {titulo}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
