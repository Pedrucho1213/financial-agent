import { ChevronRight, MapPin, Target } from "lucide-react";
import type { ReactNode } from "react";
import { dinero } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { useMetas, usePresupuestos } from "../lib/plan";
import { hashDe, navegar } from "../lib/ruta";
import { Anillos } from "./Anillos";

/** Dos tarjetas en Inicio: presupuestos y metas (con sus anillos) y el mapa de dónde gastas. */
export function Accesos({ mes, moneda }: { mes: string; moneda: string }) {
  const presupuestos = usePresupuestos(mes);
  const metas = useMetas();
  const total = presupuestos.data?.total;
  const listaMetas = metas.data?.metas ?? [];
  const objetivo = listaMetas.reduce((s, m) => s + m.objetivoCentavos, 0);
  const ahorrado = listaMetas.reduce((s, m) => s + Math.min(m.ahorradoCentavos, m.objetivoCentavos), 0);
  const conPlan = !!total?.limiteCentavos || objetivo > 0;

  let detallePlan = "Ponle tope al mes y junta para algo";
  if (total?.limiteCentavos) {
    const queda = total.limiteCentavos - total.gastadoCentavos;
    detallePlan = queda >= 0 ? `Quedan ${dinero(queda, moneda)}` : `Te pasaste ${dinero(-queda, moneda)}`;
  } else if (objetivo > 0) detallePlan = `${dinero(ahorrado, moneda)} ahorrados`;

  return (
    <div className="grid grid-cols-2 gap-3">
      <Tarjeta
        titulo="Presupuestos y metas"
        detalle={detallePlan}
        alTocar={() => navegar(hashDe("plan"))}
        icono={
          conPlan && presupuestos.data ? (
            <Anillos
              tamano={52}
              grosor={6}
              separacion={1.5}
              anillos={[
                {
                  progreso: total?.limiteCentavos ? total.gastadoCentavos / total.limiteCentavos : 0,
                  color: "var(--anillo-gasto)",
                  etiqueta: "Presupuesto",
                },
                {
                  progreso: presupuestos.data.diaDelMes / Math.max(1, presupuestos.data.diasDelMes),
                  color: "var(--anillo-mes)",
                  etiqueta: "Mes",
                },
                { progreso: objetivo ? ahorrado / objetivo : 0, color: "var(--anillo-meta)", etiqueta: "Metas" },
              ]}
            />
          ) : (
            <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-[var(--anillo-gasto)]/15 text-[var(--anillo-gasto)]">
              <Target className="size-[22px]" />
            </span>
          )
        }
      />
      <Tarjeta
        titulo="Dónde gastas"
        detalle="Mira tus lugares"
        alTocar={() => navegar(hashDe("mapa"))}
        icono={
          <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-tint/15 text-tint">
            <MapPin className="size-[22px]" />
          </span>
        }
      />
    </div>
  );
}

function Tarjeta({ titulo, detalle, icono, alTocar }: { titulo: string; detalle: string; icono: ReactNode; alTocar: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptico();
        alTocar();
      }}
      className="fila-presionable relative flex min-w-0 flex-col items-start gap-2.5 rounded-[20px] bg-card p-4 text-left"
    >
      {icono}
      <span className="min-w-0 self-stretch">
        <span className="block text-[15px] leading-5 font-semibold">{titulo}</span>
        <span className="block truncate text-[13px] text-muted-foreground tabular">{detalle}</span>
      </span>
      <ChevronRight aria-hidden className="absolute top-4 right-3 size-5 text-muted-foreground/60" />
    </button>
  );
}
