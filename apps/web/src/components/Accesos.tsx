import { ChartColumnBig, ChevronRight, MapPin, Tag, Target, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorApi } from "../lib/api";
import { useCuentas } from "../lib/cuentas";
import { dinero } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { useMetas, usePresupuestos } from "../lib/plan";
import { hashDe, navegar } from "../lib/ruta";
import { cn } from "../lib/utils";
import { Anillos } from "./Anillos";

/**
 * Tarjetas en Inicio: cuentas a lo ancho (lo que tiene menos lo que debe); luego análisis, etiquetas, presupuestos y
 * metas (con sus anillos) y el mapa. Con un servidor sin cuentas: análisis a lo ancho, plan y mapa.
 */
export function Accesos({ mes, moneda }: { mes: string; moneda: string }) {
  const presupuestos = usePresupuestos(mes);
  const metas = useMetas();
  const total = presupuestos.data?.total;
  const listaMetas = metas.data?.metas ?? [];
  const objetivo = listaMetas.reduce((s, m) => s + m.objetivoCentavos, 0);
  const ahorrado = listaMetas.reduce((s, m) => s + Math.min(m.ahorradoCentavos, m.objetivoCentavos), 0);
  const conPlan = !!total?.limiteCentavos || objetivo > 0;
  // Un servidor sin presupuestos (404) todavía no se actualizó: solo queda el mapa.
  const sinPlan = presupuestos.error instanceof ErrorApi && presupuestos.error.estado === 404;

  let detallePlan = "Ponle tope al mes y junta para algo";
  if (total?.limiteCentavos) {
    const queda = total.limiteCentavos - total.gastadoCentavos;
    detallePlan = queda >= 0 ? `Quedan ${dinero(queda, moneda)}` : `Te pasaste ${dinero(-queda, moneda)}`;
  } else if (objetivo > 0) detallePlan = `${dinero(ahorrado, moneda)} ahorrados`;

  // Cuentas y etiquetas llegan con un servidor nuevo; uno viejo (404) deja Inicio como estaba.
  const cuentas = useCuentas();
  const conCuentas = !!cuentas.data;
  const t = cuentas.data?.totales;
  let detalleCuentas = "Dime cuánto tienes y en dónde";
  if (t && (t.cuentasConSaldo || t.tarjetasConDeuda)) {
    detalleCuentas = t.deudaCentavos > 0 ? `${dinero(t.netoCentavos, moneda)} · debes ${dinero(t.deudaCentavos, moneda)}` : `Tienes ${dinero(t.netoCentavos, moneda)}`;
  } else if (cuentas.data?.cuentas.length) detalleCuentas = "No sé cuánto tienes todavía";

  const analisis = (ancha: boolean) => (
    <Tarjeta
      key="analisis"
      ancha={ancha}
      titulo="Análisis"
      detalle="Tendencias, calendario y lo que noté"
      alTocar={() => navegar(hashDe("analisis"))}
      icono={
        <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-[var(--serie-6)]/15 text-[var(--serie-6)]">
          <ChartColumnBig className="size-[22px]" />
        </span>
      }
    />
  );
  const plan = sinPlan ? null : (
    <Tarjeta
      key="plan"
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
  );
  const mapa = (
    <Tarjeta
      key="mapa"
      titulo="Dónde gastas"
      detalle="Mira tus lugares"
      alTocar={() => navegar(hashDe("mapa"))}
      icono={
        <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-tint/15 text-tint">
          <MapPin className="size-[22px]" />
        </span>
      }
    />
  );

  if (!conCuentas) {
    return (
      <div className={cn("grid gap-3", sinPlan ? "grid-cols-1" : "grid-cols-2")}>
        {analisis(!sinPlan)}
        {plan}
        {mapa}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tarjeta
        ancha
        titulo="Cuentas y tarjetas"
        detalle={detalleCuentas}
        alTocar={() => navegar(hashDe("cuentas"))}
        icono={
          <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-[var(--serie-5)]/15 text-[var(--serie-5)]">
            <Wallet className="size-[22px]" />
          </span>
        }
      />
      {analisis(false)}
      <Tarjeta
        titulo="Etiquetas"
        detalle="Viajes, trabajo y más"
        alTocar={() => navegar(hashDe("etiquetas"))}
        icono={
          <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-[var(--serie-2)]/15 text-[var(--serie-2)]">
            <Tag className="size-[22px]" />
          </span>
        }
      />
      {plan}
      {sinPlan ? <div className="col-span-2 grid">{mapa}</div> : mapa}
    </div>
  );
}

function Tarjeta({
  titulo,
  detalle,
  icono,
  alTocar,
  ancha,
}: {
  titulo: string;
  detalle: string;
  icono: ReactNode;
  alTocar: () => void;
  /** A lo ancho de las dos columnas, con el icono a un lado. */
  ancha?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptico();
        alTocar();
      }}
      className={cn(
        "fila-presionable relative flex min-w-0 items-start gap-2.5 rounded-[20px] bg-card p-4 text-left",
        ancha ? "col-span-2 flex-row items-center gap-3.5 pr-10" : "flex-col",
      )}
    >
      {icono}
      <span className="min-w-0 self-stretch">
        <span className="block text-[15px] leading-5 font-semibold">{titulo}</span>
        <span className="block truncate text-[13px] text-muted-foreground tabular">{detalle}</span>
      </span>
      <ChevronRight aria-hidden className={cn("absolute right-3 size-5 text-muted-foreground/60", ancha ? "top-1/2 -translate-y-1/2" : "top-4")} />
    </button>
  );
}
