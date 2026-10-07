import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Minus,
  Plus,
  Repeat,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { agruparCategorias } from "../components/graficas/colores";
import { Accesos } from "../components/Accesos";
import { Avisos } from "../components/Avisos";
import { construirDestacados, Destacados } from "../components/Destacados";
import { NumeroAnimado } from "../components/NumeroAnimado";
import { Pantalla } from "../components/Pantalla";
import { acumular, Ritmo } from "../components/Ritmo";
import { Button } from "../components/ui/button";
import { Fila, FilaBoton, Grupo, TituloSeccion } from "../components/ui/lista";
import { Skeleton } from "../components/ui/skeleton";
import { mensajeDeError } from "../lib/api";
import { IconoCategoria } from "../lib/categorias";
import { useEnLinea } from "../lib/conexion";
import { abrirDetalle, useGastoPorDia, useTablero, useYo } from "../lib/consultas";
import { abrirEditor } from "../lib/editor";
import {
  aFecha,
  diaCorto,
  diaDeMes,
  diasHasta,
  dinero,
  FRECUENCIAS,
  hoyIso,
  mesActual,
  mesCorto,
  nombreMes,
  pct,
  sumarMeses,
} from "../lib/formato";
import { haptico } from "../lib/haptico";
import { hashDe, navegar } from "../lib/ruta";
import type { Tablero } from "../lib/tipos";
import { cn } from "../lib/utils";

const DonaCategorias = lazy(() => import("../components/graficas/Graficas").then((m) => ({ default: m.DonaCategorias })));
const BarrasMeses = lazy(() => import("../components/graficas/Graficas").then((m) => ({ default: m.BarrasMeses })));

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

export function Inicio({ params }: { params: URLSearchParams }) {
  const pedido = params.get("mes");
  const mesLocal = mesActual();
  const mes = pedido && MES_VALIDO.test(pedido) && pedido <= mesLocal ? pedido : mesLocal;
  const tablero = useTablero(mes);
  const yo = useYo();
  const mesHoy = tablero.data?.hoy.slice(0, 7) ?? mesLocal;
  const t = tablero.data?.mes === mes ? tablero.data : undefined;

  const irAMes = (nuevo: string) => navegar(hashDe("inicio", { mes: nuevo === mesHoy ? undefined : nuevo }), { reemplazar: true });

  const [anio] = mes.split("-");
  const titulo = (
    <>
      {nombreMes(mes, false)} <span className="font-semibold text-muted-foreground">{anio}</span>
    </>
  );

  return (
    <Pantalla
      titulo={titulo}
      tituloCompacto={nombreMes(mes)}
      encima={yo.data ? `Hola, ${yo.data.usuario.nombre.split(" ")[0]}` : " "}
      alRefrescar={() => tablero.refetch()}
      junto={
        <div className="mb-0.5 flex shrink-0 gap-2">
          <Button variant="gray" size="icon-sm" aria-label="Mes anterior" onClick={() => irAMes(sumarMeses(mes, -1))}>
            <ChevronLeft strokeWidth={2.5} />
          </Button>
          <Button
            variant="gray"
            size="icon-sm"
            aria-label="Mes siguiente"
            disabled={mes >= mesHoy}
            onClick={() => irAMes(sumarMeses(mes, 1))}
          >
            <ChevronRight strokeWidth={2.5} />
          </Button>
        </div>
      }
    >
      {t ? (
        <Tablero t={t} esMesActual={mes === mesHoy} />
      ) : tablero.isError ? (
        <div className="mt-6 rounded-[20px] bg-card px-6 py-10 text-center">
          <p className="text-[17px] font-semibold">No pudimos cargar tu resumen</p>
          <p className="mt-1 text-[15px] text-muted-foreground">{mensajeDeError(tablero.error)}</p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => tablero.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <EsqueletoTablero />
      )}
    </Pantalla>
  );
}

function Tablero({ t, esMesActual }: { t: Tablero; esMesActual: boolean }) {
  const { totales, moneda } = t;
  const fmt = (n: number) => dinero(n, moneda);
  const ritmo = useRitmo(t, esMesActual);
  const enLinea = useEnLinea();
  const destacados = useMemo(
    () => construirDestacados(t, { esMesActual, acumuladoAnterior: ritmo?.anterior }),
    [t, esMesActual, ritmo?.anterior],
  );

  return (
    <div className="space-y-8 pt-2 pb-4">
      <div className="space-y-3">
        {t.porRevisar > 0 ? (
          <Grupo>
            <FilaBoton
              sangria="3.75rem"
              icono={
                <span aria-hidden className="flex size-[30px] items-center justify-center rounded-[7px] bg-orange text-white">
                  <CircleAlert className="size-[18px]" />
                </span>
              }
              titulo={`${t.porRevisar} ${t.porRevisar === 1 ? "movimiento" : "movimientos"} por revisar`}
              chevron
              onClick={() => navegar(hashDe("movimientos", { revisar: "1", mes: "todo" }))}
            />
          </Grupo>
        ) : null}

        {esMesActual ? <Avisos /> : null}

        <Gastado t={t} esMesActual={esMesActual} ritmo={ritmo} />

        <div className="grid grid-cols-2 gap-3">
          <section aria-label="Ingresado" className="min-w-0 rounded-[20px] bg-card p-4">
            <h2 className="text-[15px] font-medium text-muted-foreground">Ingresado</h2>
            <NumeroAnimado
              valor={totales.ingresadoCentavos}
              formato={fmt}
              className="mt-1 block truncate text-[22px] leading-7 font-bold tracking-[-0.01em] tabular"
            />
          </section>
          <section aria-label="Balance" className="min-w-0 rounded-[20px] bg-card p-4">
            <h2 className="text-[15px] font-medium text-muted-foreground">Balance</h2>
            <NumeroAnimado
              valor={totales.balanceCentavos}
              formato={(n) => dinero(n, moneda, { signo: true })}
              className={cn(
                "mt-1 block truncate text-[22px] leading-7 font-bold tracking-[-0.01em] tabular",
                totales.balanceCentavos > 0 && "text-positive",
                totales.balanceCentavos < 0 && "text-negative",
              )}
            />
          </section>
        </div>
      </div>

      {esMesActual ? <Accesos mes={t.mes} moneda={moneda} /> : null}

      <Destacados key={`d-${t.mes}`} items={destacados} enLinea={enLinea} />

      <PorCategoria key={`c-${t.mes}`} t={t} />

      <UltimosMeses key={`m-${t.mes}`} t={t} />

      {t.mayores.length ? (
        <section>
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
                sangria="4rem"
                icono={<IconoCategoria nombre={m.categoria} tipo={m.tipo} />}
                titulo={m.comercio ?? m.descripcion ?? m.categoria ?? "Gasto"}
                subtitulo={`${diaCorto(m.fecha)}${m.categoria ? ` · ${m.categoria.split(">").pop()?.trim()}` : ""}`}
                valor={<span className="font-medium text-foreground tabular">{dinero(m.montoCentavos, m.moneda)}</span>}
                onClick={() => abrirDetalle(m)}
              />
            ))}
          </Grupo>
        </section>
      ) : null}

      {t.frecuentes.length ? (
        <section>
          <TituloSeccion>Lo que más repites</TituloSeccion>
          <Grupo>
            {t.frecuentes.map((f) => (
              <FilaBoton
                key={f.nombre}
                sangria="4rem"
                icono={
                  <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-fill text-[15px] font-semibold tabular">
                    {f.cantidad}×
                  </span>
                }
                titulo={f.nombre}
                subtitulo={`${f.cantidad} ${f.cantidad === 1 ? "vez" : "veces"} este mes`}
                valor={<span className="font-medium text-foreground tabular">{dinero(f.centavos, moneda)}</span>}
                onClick={() => navegar(hashDe("movimientos", { mes: t.mes, q: f.nombre }))}
              />
            ))}
          </Grupo>
        </section>
      ) : null}

      <section>
        <TituloSeccion>Próximos cobros</TituloSeccion>
        {t.recurrentesProximos.length ? (
          <Grupo>
            {t.recurrentesProximos.map((r) => {
              const dias = diasHasta(r.proximoCobro, t.hoy);
              return (
                <Fila
                  key={r.id}
                  sangria="4rem"
                  icono={<HojaCalendario fecha={r.proximoCobro} />}
                  titulo={r.nombre}
                  subtitulo={`${FRECUENCIAS[r.frecuencia] ?? r.frecuencia} · ${dias <= 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`}`}
                  valor={<span className="font-medium text-foreground tabular">{dinero(r.montoCentavos, r.moneda)}</span>}
                />
              );
            })}
          </Grupo>
        ) : (
          <div className="flex items-center gap-3 rounded-[20px] bg-card p-4">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-muted-foreground">
              <Repeat className="size-[18px]" />
            </span>
            <p className="text-[15px] leading-snug text-muted-foreground">
              Nada en los próximos 30 días. Dile al chat «Netflix 299 cada mes» y te aviso aquí.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

type DatosRitmo = { actual: number[]; anterior: number[]; diasMes: number; hasta: number };

/** Acumulado por día del mes y del anterior, en la moneda base. `undefined` mientras carga; `null` si no se pudo. */
function useRitmo(t: Tablero, esMesActual: boolean): DatosRitmo | null | undefined {
  const anteriorMes = sumarMeses(t.mes, -1);
  const actual = useGastoPorDia(t.mes);
  const anterior = useGastoPorDia(anteriorMes);
  const fallo = (actual.isError && !actual.data) || (anterior.isError && !anterior.data);
  return useMemo(() => {
    if (fallo) return null;
    if (!actual.data || !anterior.data || actual.data.mes !== t.mes) return undefined;
    const diasMes = actual.data.dias;
    const cero = (n: number) => Array.from({ length: n }, () => 0);
    return {
      actual: acumular(actual.data.porMoneda[t.moneda] ?? cero(diasMes)),
      anterior: acumular(anterior.data.porMoneda[t.moneda] ?? cero(anterior.data.dias)),
      diasMes,
      hasta: esMesActual ? Math.min(diasMes, Number(t.hoy.slice(8, 10))) : diasMes,
    };
  }, [fallo, actual.data, anterior.data, t.mes, t.moneda, t.hoy, esMesActual]);
}

/** Tarjeta principal: lo gastado, la comparación y la gráfica de ritmo. Al pasar el dedo, cambia el número. */
function Gastado({ t, esMesActual, ritmo }: { t: Tablero; esMesActual: boolean; ritmo: DatosRitmo | null | undefined }) {
  const { totales, moneda } = t;
  const fmt = (n: number) => dinero(n, moneda);
  const nombre = nombreMes(t.mes, false).toLowerCase();
  const anteriorNombre = nombreMes(sumarMeses(t.mes, -1), false).toLowerCase();
  const [dia, setDia] = useState<number | null>(null);
  const valorDia = dia !== null && ritmo ? (ritmo.actual[dia - 1] ?? 0) : null;
  const anteriorDia = dia !== null && ritmo ? ritmo.anterior[Math.min(dia, ritmo.anterior.length) - 1] : undefined;

  return (
    <section aria-label="Gastado" className="rounded-[20px] bg-card p-4 pb-3">
      <h2 className="text-[15px] font-medium text-muted-foreground">
        {dia !== null ? `Gastado al ${dia} de ${nombre}` : `Gastado en ${nombre}`}
      </h2>
      <NumeroAnimado
        valor={valorDia ?? totales.gastadoCentavos}
        formato={fmt}
        duracion={dia !== null ? 0 : 700}
        className="mt-0.5 block truncate text-[44px] leading-[1.15] font-bold tracking-[-0.025em] tabular"
      />
      {dia !== null ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[15px] font-medium text-muted-foreground tabular">
          <span aria-hidden className="w-3.5 border-t-[2px] border-dashed border-[var(--chart-muted)]" />
          {anteriorDia !== undefined ? `${fmt(anteriorDia)} al ${dia} de ${anteriorNombre}` : `Sin datos de ${anteriorNombre}`}
        </p>
      ) : (
        <Comparacion t={t} esMesActual={esMesActual} />
      )}

      {/* Si no se pudo pedir el gasto por día, la tarjeta queda solo con los números. */}
      {ritmo === null ? null : (
        <div className="mt-3">
          {ritmo ? (
            <Ritmo
              actual={ritmo.actual}
              anterior={ritmo.anterior}
              diasMes={ritmo.diasMes}
              hasta={ritmo.hasta}
              seleccionado={dia}
              alElegir={setDia}
            />
          ) : (
            <Skeleton className="h-[92px] w-full rounded-lg" />
        )}
        <div className="mt-1.5 flex justify-between text-[11px] font-medium text-muted-foreground tabular">
          <span>1 {mesCorto(t.mes)}</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-[3px] w-3 rounded-full bg-tint" /> {nombre}
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="w-3 border-t-[2px] border-dashed border-[var(--chart-muted)]" /> {anteriorNombre}
            </span>
          </span>
          <span>
            {ritmo?.diasMes ?? diasDelMes(t.mes)} {mesCorto(t.mes)}
          </span>
        </div>
      </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-4 pt-3 hairline-t">
        {esMesActual ? (
          <Dato etiqueta="Hoy" valor={fmt(totales.gastadoHoyCentavos)} />
        ) : (
          <Dato etiqueta="Promedio por día" valor={fmt(Math.round(totales.gastadoCentavos / diasDelMes(t.mes)))} />
        )}
        <Dato etiqueta="Gastos" valor={String(totales.cantidadGastos)} />
      </div>
    </section>
  );
}

function UltimosMeses({ t }: { t: Tablero }) {
  const ultimo = Math.max(0, t.porMes.length - 1);
  const [sel, setSel] = useState(ultimo);
  const elegido = t.porMes[sel] ?? t.porMes[ultimo];
  return (
    <section>
      <TituloSeccion>Últimos 6 meses</TituloSeccion>
      <div className="rounded-[20px] bg-card p-4">
        <div className="grid grid-cols-2 gap-4" aria-live="polite">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--serie-1)]" /> Gastado
            </div>
            <div className="truncate text-[20px] leading-7 font-bold tracking-[-0.01em] tabular">
              {dinero(elegido?.gastadoCentavos ?? 0, t.moneda)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--serie-5)]" /> Ingresado
            </div>
            <div className="truncate text-[20px] leading-7 font-bold tracking-[-0.01em] tabular">
              {dinero(elegido?.ingresadoCentavos ?? 0, t.moneda)}
            </div>
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

function diasDelMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(a ?? 1970, m ?? 1, 0).getDate();
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted-foreground">{etiqueta}</div>
      <div className="truncate text-[17px] font-semibold tabular">{valor}</div>
    </div>
  );
}

function Comparacion({ t, esMesActual }: { t: Tablero; esMesActual: boolean }) {
  const actual = t.totales.gastadoCentavos;
  const base = esMesActual ? t.totales.gastadoMesAnteriorMismaFechaCentavos : t.totales.gastadoMesAnteriorCentavos;
  const anterior = sumarMeses(t.mes, -1);
  const referencia = esMesActual ? `al ${diaMismoMesAnterior(t.hoy)}` : `en ${nombreMes(anterior, false).toLowerCase()}`;

  if (base <= 0) {
    return <p className="mt-1.5 text-[15px] text-muted-foreground">Sin gastos {referencia} para comparar</p>;
  }
  const cambio = (actual - base) / base;
  const igual = Math.abs(cambio) < 0.005;
  const mas = cambio > 0;
  const Icono = igual ? Minus : mas ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      className={cn(
        "mt-1.5 flex items-center gap-1 text-[15px] font-medium",
        igual ? "text-muted-foreground" : mas ? "text-negative" : "text-positive",
      )}
    >
      <Icono className="size-[18px] shrink-0" strokeWidth={2.5} aria-hidden />
      <span className="min-w-0">
        {igual ? `Igual que ${referencia}` : `${pct(Math.abs(cambio))} ${mas ? "más" : "menos"} que ${referencia}`}
      </span>
    </p>
  );
}

/** "6 de septiembre" a partir de hoy = 2026-10-06 (o el último día si el mes anterior es más corto). */
function diaMismoMesAnterior(hoy: string) {
  const f = aFecha(hoy);
  const dia = f.getDate();
  const previo = new Date(f.getFullYear(), f.getMonth() - 1, 1, 12);
  const ultimo = new Date(previo.getFullYear(), previo.getMonth() + 1, 0).getDate();
  previo.setDate(Math.min(dia, ultimo));
  return diaDeMes(hoyIso(previo));
}

function PorCategoria({ t }: { t: Tablero }) {
  const items = useMemo(() => agruparCategorias(t.porCategoria), [t.porCategoria]);
  const total = items.reduce((s, i) => s + i.centavos, 0);
  const [sel, setSel] = useState<number | null>(null);
  const elegido = sel !== null ? items[sel] : undefined;

  // "Sin categoría" y "Otras" no tienen categoría que filtrar: sin id, no llevan a ningún lado.
  const verCategoria = (i: number) => {
    const id = items[i]?.categoriaId;
    if (id) navegar(hashDe("movimientos", { mes: t.mes, tipo: "gasto", categoria: id }));
  };

  return (
    <section>
      <TituloSeccion>Por categoría</TituloSeccion>
      {items.length === 0 ? (
        <div className="rounded-[20px] bg-card px-6 py-8 text-center">
          <p className="text-[17px] font-semibold">Aún no hay gastos este mes</p>
          <p className="mt-1 text-[15px] text-muted-foreground">Dile a Siri «gasté 85 en café» o agrégalo aquí.</p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => abrirEditor(null)}>
            <Plus /> Agregar gasto
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] bg-card">
          <div className="relative mx-auto size-[220px] py-2">
            <Suspense fallback={<Skeleton className="size-full rounded-full" />}>
              <DonaCategorias
                items={items}
                moneda={t.moneda}
                seleccionado={sel}
                alElegir={(i) => {
                  haptico();
                  setSel((s) => (s === i ? null : i));
                }}
                className="size-full"
              />
            </Suspense>
            <div
              key={sel ?? "total"}
              className="pointer-events-none absolute inset-0 flex animate-aparecer flex-col items-center justify-center px-12 text-center"
            >
              <span className="max-w-full truncate text-[13px] font-medium text-muted-foreground">
                {elegido ? elegido.nombre : "Total"}
              </span>
              <span className="text-[20px] leading-tight font-bold tracking-[-0.01em] tabular">
                {dinero(elegido ? elegido.centavos : total, t.moneda)}
              </span>
              {elegido?.categoriaId ? (
                <button
                  type="button"
                  className="pointer-events-auto mt-0.5 flex h-7 items-center text-[13px] font-semibold text-tint active:opacity-50"
                  onClick={() => sel !== null && verCategoria(sel)}
                >
                  {pct(elegido.centavos / Math.max(1, total))} · Ver
                  <ChevronRight className="size-3.5" strokeWidth={3} />
                </button>
              ) : (
                <span className="text-[13px] text-muted-foreground">
                  {elegido ? pct(elegido.centavos / Math.max(1, total)) : mesCorto(t.mes)}
                </span>
              )}
            </div>
          </div>
          <ul className="pb-1">
            {items.map((it, i) => {
              const fila = {
                sangria: "2.6rem",
                className: cn(sel !== null && sel !== i && "opacity-55", "transition-opacity duration-200"),
                icono: (
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: it.slot === "otros" ? "var(--serie-otros)" : `var(--serie-${it.slot + 1})` }}
                  />
                ),
                titulo: (
                  <span className="flex items-baseline gap-2">
                    <span className="truncate">{it.nombre}</span>
                    <span className="shrink-0 text-[15px] text-muted-foreground tabular">{pct(it.centavos / Math.max(1, total))}</span>
                  </span>
                ),
                valor: <span className="text-foreground tabular">{dinero(it.centavos, t.moneda)}</span>,
              };
              return (
                <li key={`${it.nombre}-${i}`}>
                  {it.categoriaId ? <FilaBoton {...fila} chevron onClick={() => verCategoria(i)} /> : <Fila {...fila} className={cn(fila.className, "pr-11")} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function HojaCalendario({ fecha }: { fecha: string }) {
  const f = aFecha(fecha);
  return (
    <span aria-hidden className="flex size-9 shrink-0 flex-col overflow-hidden rounded-[8px] bg-elevated text-center ring-[0.5px] ring-separator">
      <span className="bg-[#ff3b30] text-[8px] leading-[11px] font-bold text-white uppercase">{mesCorto(fecha.slice(0, 7))}</span>
      <span className="flex-1 text-[16px] leading-[24px] font-semibold tabular">{f.getDate()}</span>
    </span>
  );
}

function EsqueletoTablero() {
  return (
    <div aria-busy className="space-y-3 pt-2">
      <div className="rounded-[20px] bg-card p-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-3 h-11 w-52" />
        <Skeleton className="mt-3 h-4 w-60" />
        <div className="mt-5 grid grid-cols-2 gap-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[88px] rounded-[20px] bg-card" />
        <Skeleton className="h-[88px] rounded-[20px] bg-card" />
      </div>
      <Skeleton className="mt-8 h-6 w-40" />
      <div className="rounded-[20px] bg-card p-4">
        <Skeleton className="mx-auto size-[200px] rounded-full" />
      </div>
    </div>
  );
}
