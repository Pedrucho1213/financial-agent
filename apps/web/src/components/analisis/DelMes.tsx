import { lazy, Suspense, useState } from "react";
import { Ajustado } from "../Ajustado";
import { abrirDetalle, useTablero } from "../../lib/consultas";
import { diaCorto, dinero, nombreMes } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { hashDe, navegar } from "../../lib/ruta";
import type { Tablero } from "../../lib/tipos";
import { LogoMovimiento } from "../Logo";
import { Button } from "../ui/button";
import { FilaBoton, Grupo, TituloSeccion } from "../ui/lista";
import { Skeleton } from "../ui/skeleton";

const BarrasMeses = lazy(() => import("../graficas/Graficas").then((m) => ({ default: m.BarrasMeses })));

/**
 * En Análisis, con el periodo de un mes: los últimos 6 meses, los gastos más grandes y lo que más repites (antes
 * vivían en Inicio). Salen del resumen del mes, el mismo que usa Inicio.
 */
export function DelMes({ mes }: { mes: string }) {
  const tablero = useTablero(mes);
  const t = tablero.data?.mes === mes ? tablero.data : undefined;
  if (!t) return tablero.isPending ? <Skeleton className="h-[300px] rounded-[20px] bg-card" /> : null;
  return (
    <>
      <UltimosMeses key={`m-${t.mes}`} t={t} />
      <Mayores t={t} />
      <Frecuentes t={t} />
    </>
  );
}

function UltimosMeses({ t }: { t: Tablero }) {
  const ultimo = Math.max(0, t.porMes.length - 1);
  const [sel, setSel] = useState(ultimo);
  const elegido = t.porMes[sel] ?? t.porMes[ultimo];
  if (!t.porMes.length) return null;
  return (
    <section aria-label="Últimos 6 meses">
      <TituloSeccion
        accion={
          <Button variant="plain" size="text" className="text-[15px]" onClick={() => navegar(hashDe("analisis", { periodo: "6m", ref: `${t.mes}-01` }), { reemplazar: true })}>
            Ver 6 meses
          </Button>
        }
      >
        Últimos 6 meses
      </TituloSeccion>
      <div className="rounded-[20px] bg-card p-4">
        <div className="grid grid-cols-2 gap-4" aria-live="polite">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--serie-1)]" /> Gastado
            </div>
            <Ajustado como="div" className="truncate text-[20px] leading-7 font-bold tracking-[-0.01em] tabular">{dinero(elegido?.gastadoCentavos ?? 0, t.moneda)}</Ajustado>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--serie-5)]" /> Ingresado
            </div>
            <Ajustado como="div" className="truncate text-[20px] leading-7 font-bold tracking-[-0.01em] tabular">{dinero(elegido?.ingresadoCentavos ?? 0, t.moneda)}</Ajustado>
          </div>
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{elegido ? nombreMes(elegido.mes) : ""}</p>
        <Suspense fallback={<Skeleton className="mt-3 h-[170px] w-full" />}>
          <BarrasMeses
            meses={t.porMes}
            seleccionado={sel}
            alElegir={(i) => {
              const n = Math.min(ultimo, Math.max(0, i));
              if (n !== sel) haptico();
              setSel(n);
            }}
            moneda={t.moneda}
            className="mt-3 h-[170px]"
          />
        </Suspense>
      </div>
    </section>
  );
}

/** De $100,000 para arriba el monto va compacto: completo, a 320 px deja el nombre en una columna de 5 letras. */
const TOPE_COMPACTO = 100_000_00;

function Mayores({ t }: { t: Tablero }) {
  if (!t.mayores.length) return null;
  return (
    <section aria-label="Mayores gastos">
      <TituloSeccion
        accion={
          <Button variant="plain" size="text" className="text-[15px]" onClick={() => navegar(hashDe("movimientos", { mes: t.mes }))}>
            Ver todos
          </Button>
        }
      >
        Mayores gastos
      </TituloSeccion>
      <Grupo>
        {t.mayores.map((m) => (
          <FilaBoton
            key={m.id}
            sangria="4.25rem"
            icono={<LogoMovimiento comercio={m.comercio} descripcion={m.descripcion} categoria={m.categoria} tipo={m.tipo} />}
            titulo={m.comercio ?? m.descripcion ?? m.categoria ?? "Gasto"}
            subtitulo={`${diaCorto(m.fecha)}${m.categoria ? ` · ${m.categoria.split(">").pop()?.trim()}` : ""}`}
            valor={<span className="font-medium text-foreground tabular">{dinero(m.montoCentavos, m.moneda, { compacto: m.montoCentavos >= TOPE_COMPACTO })}</span>}
            onClick={() => abrirDetalle(m)}
          />
        ))}
      </Grupo>
    </section>
  );
}

function Frecuentes({ t }: { t: Tablero }) {
  if (!t.frecuentes.length) return null;
  return (
    <section aria-label="Lo que más repites">
      <TituloSeccion>Lo que más repites</TituloSeccion>
      <Grupo>
        {t.frecuentes.map((f) => (
          <FilaBoton
            key={f.nombre}
            sangria="4.25rem"
            icono={
              <span className="relative shrink-0">
                <LogoMovimiento comercio={f.nombre} categoria={null} tipo="gasto" />
                <span className="absolute -right-1.5 -bottom-1 rounded-full bg-card px-1 text-[11px] leading-4 font-bold shadow-[0_0_0_1px_var(--separator)] tabular">
                  {f.cantidad}×
                </span>
              </span>
            }
            titulo={f.nombre}
            subtitulo={`${f.cantidad} ${f.cantidad === 1 ? "vez" : "veces"} este mes`}
            valor={<span className="font-medium text-foreground tabular">{dinero(f.centavos, t.moneda, { compacto: f.centavos >= TOPE_COMPACTO })}</span>}
            onClick={() => navegar(hashDe("movimientos", { mes: t.mes, q: f.nombre }))}
          />
        ))}
      </Grupo>
    </section>
  );
}
