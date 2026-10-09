import { Coffee, Repeat, Scissors, Sparkles } from "lucide-react";
import { type AnalisisAsistente, type HallazgoAsistente, IDEAS_AHORRO, useAsistente } from "../../lib/asistente";
import { dineroCorto, nombreMes } from "../../lib/formato";
import { cn } from "../../lib/utils";
import { TituloSeccion } from "../ui/lista";

// Lo que el asistente calcula del mes en curso (GET /v1/analisis): cómo cerraría y dónde ahorrar.
// Es lo mismo que dice por voz; aquí se ve con números.

const redondear = (centavos: number, a: number) => Math.round(centavos / a) * a;

const Titulo = ({ children }: { children: string }) => (
  <TituloSeccion>
    <span className="flex items-center gap-1.5">
      {children} <Sparkles aria-hidden className="size-[18px] text-tint" strokeWidth={2.2} />
    </span>
  </TituloSeccion>
);

/**
 * Cómo cerraría el mes: lo que lleva, lo que le falta por gastar a su ritmo (fijos incluidos) y, si se
 * sabe lo que le entra, cuánto le sobraría o le faltaría. Una sola barra: llevas + falta, contra lo que entra.
 */
export function CierreDelMes({ datos, mes, moneda }: { datos: AnalisisAsistente; mes: string; moneda: string }) {
  const p = datos.proyeccion;
  if (!p) return null;
  const $ = (c: number) => dineroCorto(c, moneda);
  const llevas = Math.max(0, Math.min(datos.gastadoCentavos, p.cierreCentavos));
  const falta = Math.max(0, p.cierreCentavos - llevas);
  const tope = Math.max(p.cierreCentavos, p.ingresosCentavos, 1);
  // Redondeado como lo dice la voz: el margen a cientos y el día normal a decenas.
  const margen = p.ingresosCentavos > 0 ? redondear(p.ingresosCentavos - p.cierreCentavos, 10_000) : null;

  return (
    <section aria-label="Cómo cierras el mes">
      <Titulo>Cómo cierras el mes</Titulo>
      <div className="rounded-[20px] bg-card p-4">
        <p className="text-[15px] text-muted-foreground">Si sigues a este ritmo, en {nombreMes(mes, false).toLowerCase()} gastarías unos</p>
        <p data-testid="cierre" className="mt-0.5 text-[34px] leading-[1.15] font-bold tracking-[-0.02em] tabular max-[379px]:text-[28px]">
          {$(p.cierreCentavos)}
        </p>

        <div className="relative mt-3">
          <div
            className="flex h-3 origin-left animate-crecer-x gap-[2px] overflow-hidden rounded-full bg-fill"
            role="img"
            aria-label={`Llevas ${$(llevas)}, te faltarían ${$(falta)}${p.ingresosCentavos > 0 ? `; te entran ${$(p.ingresosCentavos)}` : ""}`}
          >
            <span className="h-full rounded-l-full bg-tint" style={{ width: `${(llevas / tope) * 100}%` }} />
            <span className="h-full bg-tint/35" style={{ width: `${(falta / tope) * 100}%` }} />
          </div>
          {p.ingresosCentavos > 0 ? (
            // Lo que le entra: una rayita sobre la barra, como "la rayita" de categorías.
            <span
              aria-hidden
              data-testid="marca-ingresos"
              className="absolute -top-1 h-5 w-[2px] rounded-full bg-foreground"
              style={{ left: `calc(${Math.min(100, (p.ingresosCentavos / tope) * 100)}% - 1px)` }}
            />
          ) : null}
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-tint" />
            Llevas <span className="tabular text-muted-foreground">{$(llevas)}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-tint/35" />
            Falta <span className="tabular text-muted-foreground">{$(falta)}</span>
          </li>
          {p.ingresosCentavos > 0 ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-[2px] rounded-full bg-foreground" />
              Te entra <span className="tabular text-muted-foreground">{$(p.ingresosCentavos)}</span>
            </li>
          ) : null}
        </ul>

        {margen !== null ? (
          <p data-testid="margen" className={cn("mt-3 text-[17px] font-semibold", margen >= 0 ? "text-positive" : "text-negative")}>
            {margen > 0 ? `Te sobrarían unos ${$(margen)}` : margen === 0 ? "Justo lo que te entra" : `Te faltarían unos ${$(-margen)}`}
          </p>
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-3 pt-3 hairline-t">
          <div className="min-w-0">
            <dt className="text-[13px] text-muted-foreground">Un día normal</dt>
            <dd className="truncate text-[17px] font-semibold tabular">{$(redondear(p.ritmoDiarioCentavos, 1_000))}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[13px] text-muted-foreground">Fijos por pagar</dt>
            <dd className="truncate text-[17px] font-semibold tabular">{$(p.porPagarCentavos)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

const ICONO: Partial<Record<HallazgoAsistente["tipo"], typeof Coffee>> = { hormiga: Coffee, suscripciones: Repeat, recortable: Scissors };

/** Las ideas para ahorrar del asistente (gastos hormiga, suscripciones, lo recortable), con cuánto al mes. */
export function DondeAhorrar({ datos, moneda }: { datos: AnalisisAsistente; moneda: string }) {
  const ideas = datos.hallazgos.filter((h) => IDEAS_AHORRO.includes(h.tipo));
  if (!ideas.length) return null;
  const total = ideas.reduce((s, i) => s + (i.ahorroMensualCentavos ?? 0), 0);
  return (
    <section aria-label="Dónde ahorrar">
      <Titulo>Dónde ahorrar</Titulo>
      <div className="overflow-hidden rounded-[20px] bg-card">
        <ul>
          {ideas.map((i, n) => {
            const Icono = ICONO[i.tipo] ?? Sparkles;
            return (
              <li
                key={n}
                data-idea={i.tipo}
                className="relative flex gap-3 px-4 py-3 [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-14 [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
              >
                <span aria-hidden className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-positive/15 text-positive">
                  <Icono className="size-[17px]" strokeWidth={2.3} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug text-pretty">{i.texto}</p>
                  {i.ahorroMensualCentavos ? (
                    <p className="mt-0.5 text-[13px] font-semibold text-positive tabular">Ahorras unos {dineroCorto(i.ahorroMensualCentavos, moneda)} al mes</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {total > 0 ? (
        <p data-testid="ahorro-total" className="px-4 pt-2 text-[13px] text-muted-foreground">
          Si les haces caso, hasta {dineroCorto(total, moneda)} al mes.
        </p>
      ) : null}
    </section>
  );
}

/** Las dos secciones del mes en curso. Sin datos, con error o con un servidor viejo (404) no sale nada. */
export function AsistenteDelMes({ mes, moneda }: { mes: string; moneda: string }) {
  const cierre = useAsistente("proyeccion", mes);
  const ahorro = useAsistente("ahorrar", mes);
  return (
    <>
      {cierre.data ? <CierreDelMes datos={cierre.data} mes={mes} moneda={moneda} /> : null}
      {ahorro.data ? <DondeAhorrar datos={ahorro.data} moneda={moneda} /> : null}
    </>
  );
}
