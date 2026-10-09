import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Leaf,
  type LucideIcon,
  Minus,
  Receipt,
  Scale,
  Sparkles,
  Star,
  Tag,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AsistenteDelMes } from "../components/analisis/Asistente";
import { BarrasFlujo, BarrasPeriodo } from "../components/analisis/Barras";
import { CalendarioCalor, LeyendaCalor, RejillaCalor } from "../components/analisis/Calor";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { FilaBoton, Grupo, TituloSeccion } from "../components/ui/lista";
import { Segmented } from "../components/ui/segmented";
import { Skeleton } from "../components/ui/skeleton";
import {
  type Analisis as DatosAnalisis,
  analizar,
  cambio,
  construirInsights,
  type Fila,
  type Grupo as GrupoAnalisis,
  type IconoInsight,
  type Insight,
  MOMENTOS,
  mesesConFlujo,
  type Tono,
} from "../lib/analisis";
import { mensajeDeError } from "../lib/api";
import { preguntarAlChat } from "../lib/chat";
import { useEnLinea } from "../lib/conexion";
import { useCategorias, useFilasAnalisis, useYo } from "../lib/consultas";
import { dinero, dineroCorto, hoyIso, mesCorto, nombreDia, pct } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { esPeriodo, moverRef, nombreAnterior, type Periodo, rangoAnterior, rangoDe, tituloRango } from "../lib/periodos";
import { hashDe, hashDetalle, navegar, volver } from "../lib/ruta";
import { cn } from "../lib/utils";

const OPCIONES_PERIODO: { valor: Periodo; etiqueta: string }[] = [
  { valor: "semana", etiqueta: "S" },
  { valor: "mes", etiqueta: "M" },
  { valor: "6m", etiqueta: "6M" },
  { valor: "anio", etiqueta: "A" },
];
const NOMBRE_PERIODO: Record<Periodo, string> = { semana: "Semana", mes: "Mes", "6m": "6 meses", anio: "Año" };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const ICONOS: Record<IconoInsight, LucideIcon> = {
  sube: TrendingUp,
  baja: TrendingDown,
  nuevo: Sparkles,
  calma: Leaf,
  finde: CalendarDays,
  reloj: Clock,
  ticket: Receipt,
  balanza: Scale,
  tarjeta: CreditCard,
  flujo: ArrowLeftRight,
  estrella: Star,
};
const COLOR_TONO: Record<Tono, string> = { atencion: "var(--orange)", bueno: "var(--positive)", info: "var(--tint)" };

const colorSlot = (slot: number | "otros") => (slot === "otros" ? "var(--serie-otros)" : `var(--serie-${slot + 1})`);

/**
 * Análisis: el gasto de una semana, un mes, 6 meses o un año, comparado con el periodo anterior, con
 * insights que salen de los números (sin la IA), calendario de calor, cuándo y dónde gastas y cómo pagas.
 * Todo se filtra por categoría con las cápsulas de arriba. Vive en #analisis?periodo=&ref=&categoria=.
 */
export function Analisis({ params }: { params: URLSearchParams }) {
  const yo = useYo();
  const categorias = useCategorias();
  const hoy = yo.data?.hoy ?? hoyIso();
  const moneda = yo.data?.moneda ?? "MXN";
  const periodo: Periodo = esPeriodo(params.get("periodo")) ? (params.get("periodo") as Periodo) : "mes";
  const pedida = params.get("ref");
  // Nunca un periodo que todavía no empieza.
  const ref = pedida && FECHA.test(pedida) && rangoDe(periodo, pedida).desde <= hoy ? pedida : hoy;
  const categoria = params.get("categoria");
  const rango = rangoDe(periodo, ref);
  const anterior = rangoAnterior(periodo, ref);
  const filas = useFilasAnalisis(anterior.desde, rango.hasta);
  const listas = filas.data && filas.data.desde === anterior.desde && filas.data.hasta === rango.hasta ? filas.data.filas : undefined;

  const ir = (cambios: { periodo?: Periodo; ref?: string | null; categoria?: string | null }) => {
    const p = cambios.periodo ?? periodo;
    const r = cambios.ref === undefined ? ref : cambios.ref;
    const c = cambios.categoria === undefined ? categoria : cambios.categoria;
    navegar(
      hashDe("analisis", {
        periodo: p === "mes" ? undefined : p,
        ref: r && rangoDe(p, r).desde !== rangoDe(p, hoy).desde ? r : undefined,
        categoria: c,
      }),
      { reemplazar: true },
    );
  };

  const siguiente = moverRef(periodo, ref, 1);
  const haySiguiente = rangoDe(periodo, siguiente).desde <= hoy;

  return (
    <Pantalla
      titulo="Análisis"
      atras={{ etiqueta: "Inicio", alTocar: () => volver("inicio") }}
      alRefrescar={() => filas.refetch()}
    >
      <div className="space-y-3 pt-1">
        <Segmented
          etiqueta="Periodo"
          opciones={OPCIONES_PERIODO}
          valor={periodo}
          onChange={(p) => ir({ periodo: p, ref: null })}
        />
        <div className="flex items-center justify-between gap-2">
          <Button variant="gray" size="icon-sm" aria-label={`${NOMBRE_PERIODO[periodo]} anterior`} onClick={() => ir({ ref: moverRef(periodo, ref, -1) })}>
            <ChevronLeft strokeWidth={2.5} />
          </Button>
          <p className="min-w-0 truncate text-center text-[15px] font-semibold" aria-live="polite" data-testid="titulo-periodo">
            {tituloRango(periodo, rango)}
          </p>
          <Button
            variant="gray"
            size="icon-sm"
            aria-label={`${NOMBRE_PERIODO[periodo]} siguiente`}
            disabled={!haySiguiente}
            onClick={() => ir({ ref: siguiente })}
          >
            <ChevronRight strokeWidth={2.5} />
          </Button>
        </div>
      </div>

      {listas && categorias.data ? (
        <Contenido
          key={`${periodo}-${rango.desde}`}
          filas={listas}
          historiaAntes={filas.data?.antes ?? false}
          periodo={periodo}
          refFecha={ref}
          hoy={hoy}
          moneda={moneda}
          categoria={categoria}
          categorias={categorias.data}
          alFiltrar={(c) => ir({ categoria: c })}
        />
      ) : filas.isError || categorias.isError ? (
        <div className="mt-6 rounded-[20px] bg-card px-6 py-10 text-center">
          <p className="text-[17px] font-semibold">No pudimos cargar tu análisis</p>
          <p className="mt-1 text-[15px] text-muted-foreground">{mensajeDeError(filas.error ?? categorias.error)}</p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => void Promise.all([filas.refetch(), categorias.refetch()])}>
            Reintentar
          </Button>
        </div>
      ) : (
        <Esqueleto />
      )}
    </Pantalla>
  );
}

function Contenido({
  filas,
  periodo,
  refFecha,
  hoy,
  moneda,
  categoria,
  categorias,
  alFiltrar,
  historiaAntes,
}: {
  filas: Fila[];
  historiaAntes: boolean;
  periodo: Periodo;
  refFecha: string;
  hoy: string;
  moneda: string;
  categoria: string | null;
  categorias: Parameters<typeof analizar>[1]["categorias"];
  alFiltrar: (c: string | null) => void;
}) {
  // Sin filtro: para las cápsulas y los colores (que siguen a cada categoría, no a su lugar).
  const todo = useMemo(
    () => analizar(filas, { periodo, ref: refFecha, hoy, moneda, categorias, historiaAntes }),
    [filas, periodo, refFecha, hoy, moneda, categorias, historiaAntes],
  );
  const a = useMemo(
    () => (categoria ? analizar(filas, { periodo, ref: refFecha, hoy, moneda, categorias, categoria, historiaAntes }) : todo),
    [filas, periodo, refFecha, hoy, moneda, categorias, categoria, historiaAntes, todo],
  );
  const insights = useMemo(() => construirInsights(a), [a]);
  const nombreCategoria = categoria ? (categorias.find((c) => c.id === categoria)?.nombre ?? "Categoría") : null;

  const chips = useMemo(() => {
    const lista = todo.categorias.filter((c) => c.id && c.centavos > 0).slice(0, 8);
    if (categoria && !lista.some((c) => c.id === categoria)) {
      lista.unshift({ id: categoria, nombre: nombreCategoria ?? "", centavos: 0, cantidad: 0, anterior: 0 });
    }
    return lista;
  }, [todo, categoria, nombreCategoria]);

  const slots = useMemo(() => slotsDe(a.categorias), [a.categorias]);
  const slotsTodo = useMemo(() => slotsDe(todo.categorias), [todo.categorias]);

  const vacio = a.totales.cantidad === 0 && a.totales.ingreso === 0 && a.totales.gastoAnterior === 0;

  return (
    <div className="space-y-8 pt-3 pb-4">
      <div className="space-y-3">
        {chips.length > 1 || categoria ? (
          <div className="carrusel -mx-4 scroll-px-4 gap-2 px-4" role="group" aria-label="Filtrar por categoría">
            <Capsula activa={!categoria} alTocar={() => alFiltrar(null)}>
              Todo
            </Capsula>
            {chips.map((c) => (
              <Capsula key={c.id} activa={categoria === c.id} color={c.id ? colorSlot(slotsTodo.get(c.id) ?? "otros") : undefined} alTocar={() => alFiltrar(categoria === c.id ? null : c.id)}>
                {c.nombre}
              </Capsula>
            ))}
          </div>
        ) : null}

        <Principal a={a} nombreCategoria={nombreCategoria} />
      </div>

      {vacio ? (
        <div className="rounded-[20px] bg-card px-6 py-8 text-center">
          <p className="text-[17px] font-semibold">{categoria ? `Sin gastos de ${nombreCategoria}` : "Sin movimientos en este periodo"}</p>
          <p className="mt-1 text-[15px] text-muted-foreground">Prueba con un periodo más largo o dile a Siri lo que gastaste.</p>
        </div>
      ) : (
        <>
          <Insights items={insights} />
          {periodo === "mes" && a.enCurso && !categoria ? <AsistenteDelMes mes={a.rango.desde.slice(0, 7)} moneda={moneda} /> : null}
          <Categorias a={a} slots={slots} categoria={categoria} nombreCategoria={nombreCategoria} alFiltrar={alFiltrar} />
          <Calendario a={a} filas={filas} categorias={categorias} categoria={categoria} />
          <Cuando a={a} />
          {categoria ? null : <Naturaleza a={a} />}
          {categoria || (periodo !== "6m" && periodo !== "anio") ? null : <Flujo a={a} />}
          <Lugares a={a} />
          <Pagos a={a} />
          <PorEtiqueta a={a} categoria={categoria} />
          <PreguntarIA a={a} nombreCategoria={nombreCategoria} />
        </>
      )}

      {a.otrasMonedas ? (
        <p className="px-4 text-center text-[13px] text-muted-foreground">
          {a.otrasMonedas} {a.otrasMonedas === 1 ? "gasto" : "gastos"} en otra moneda no {a.otrasMonedas === 1 ? "entra" : "entran"} en las sumas.
        </p>
      ) : null}
    </div>
  );
}

function slotsDe(grupos: GrupoAnalisis[]) {
  const m = new Map<string | null, number | "otros">();
  grupos
    .filter((g) => g.centavos > 0)
    .forEach((g, i) => m.set(g.id, i < 7 ? i : "otros"));
  return m;
}

function Capsula({ activa, color, alTocar, children }: { activa: boolean; color?: string; alTocar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={() => {
        haptico();
        alTocar();
      }}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium whitespace-nowrap transition-[background-color,color,scale] duration-200 ease-ios active:scale-95",
        activa ? "bg-tint text-white" : "bg-card text-foreground",
      )}
    >
      {color && !activa ? <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} /> : null}
      {children}
    </button>
  );
}

/** El número grande, la comparación y las barras del periodo. */
function Principal({ a, nombreCategoria }: { a: DatosAnalisis; nombreCategoria: string | null }) {
  const [sel, setSel] = useState<number | null>(null);
  const cubeta = sel !== null ? a.cubetas[sel] : undefined;
  const fmt = (c: number) => dinero(c, a.moneda);
  const pesos = (c: number) => dineroCorto(Math.round(c / 100) * 100, a.moneda);

  const datos = a.cubetas.map((c, i) => ({
    valor: c.gasto,
    futuro: c.futuro,
    larga: c.larga,
    etiqueta: a.periodo === "mes" ? ([0, 7, 14, 21, 28].includes(i) ? c.corta : "") : c.corta,
  }));
  const etiquetaPromedio = { semana: "prom. por día", mes: "prom. por día", "6m": "prom. por semana", anio: "prom. por mes" }[a.periodo];

  return (
    <section aria-label="Gastado" className="rounded-[20px] bg-card p-4 pb-3">
      <h2 className="truncate text-[15px] font-medium text-muted-foreground">
        {cubeta ? cubeta.larga : nombreCategoria ? `Gastado en ${nombreCategoria}` : "Gastado"}
      </h2>
      <p className="mt-0.5 truncate text-[40px] leading-[1.15] font-bold max-[379px]:text-[32px] tracking-[-0.025em] tabular" data-testid="total-periodo">
        {fmt(cubeta ? cubeta.gasto : a.totales.gasto)}
      </p>
      {cubeta ? (
        <p className="mt-1 text-[15px] font-medium text-muted-foreground">
          {cubeta.cantidad} {cubeta.cantidad === 1 ? "gasto" : "gastos"}
          {a.promedioCubeta > 0 ? ` · ${cubeta.gasto >= a.promedioCubeta ? "arriba" : "abajo"} del promedio (${fmt(a.promedioCubeta)})` : ""}
        </p>
      ) : (
        <Comparacion a={a} />
      )}
      <BarrasPeriodo
        className="mt-3"
        datos={datos}
        promedio={a.promedioCubeta}
        etiquetaPromedio={etiquetaPromedio}
        seleccionado={sel}
        alElegir={setSel}
        moneda={a.moneda}
      />
      <div className="mt-3 grid grid-cols-3 gap-3 pt-3 hairline-t">
        {/* Tres columnas: los promedios van en pesos enteros y en un iPhone SE (320) se achican en vez de cortarse. */}
        <Dato etiqueta="Por día" valor={pesos(a.totales.porDia)} className="max-[379px]:text-[15px]" />
        <Dato etiqueta="Gastos" valor={String(a.totales.cantidad)} className="max-[379px]:text-[15px]" />
        <Dato etiqueta="Promedio" valor={pesos(a.totales.ticket)} className="max-[379px]:text-[15px]" />
      </div>
      {a.totales.ingreso > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3 pt-3 hairline-t">
          <Dato etiqueta="Entró" valor={fmt(a.totales.ingreso)} className="max-[379px]:text-[15px]" />
          <Dato
            etiqueta="Te quedó"
            valor={dinero(a.totales.neto, a.moneda, { signo: true })}
            className={cn(
              "max-[379px]:text-[15px]",
              a.totales.neto > 0 ? "text-positive" : a.totales.neto < 0 ? "text-negative" : undefined,
            )}
          />
        </div>
      ) : null}
    </section>
  );
}

function Comparacion({ a }: { a: DatosAnalisis }) {
  const r = cambio(a.totales.gasto, a.totales.gastoAnterior);
  const antes = nombreAnterior(a.periodo, a.rango.desde);
  if (!a.comparable) {
    return (
      <p className="mt-1.5 text-[15px] text-muted-foreground" data-testid="comparacion">
        Todavía no hay con qué comparar: empezaste a anotar después
      </p>
    );
  }
  if (r === null)
    return (
      <p className="mt-1.5 text-[15px] text-muted-foreground" data-testid="comparacion">
        Sin gastos en {antes} para comparar
      </p>
    );
  const igual = Math.abs(r) < 0.005;
  const Icono = igual ? Minus : r > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      data-testid="comparacion"
      className={cn(
        "mt-1.5 flex items-center gap-1 text-[15px] font-medium",
        igual ? "text-muted-foreground" : r > 0 ? "text-negative" : "text-positive",
      )}
    >
      <Icono className="size-[18px] shrink-0" strokeWidth={2.5} aria-hidden />
      <span className="min-w-0">
        {igual ? `Igual que ${antes}` : `${pct(Math.abs(r))} ${r > 0 ? "más" : "menos"} que ${antes}`}
        {a.enCurso ? " a estas alturas" : ""}
      </span>
    </p>
  );
}

function Dato({ etiqueta, valor, className }: { etiqueta: string; valor: string; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted-foreground">{etiqueta}</div>
      <div className={cn("truncate text-[17px] font-semibold tabular", className)}>{valor}</div>
    </div>
  );
}

function Insights({ items }: { items: Insight[] }) {
  const enLinea = useEnLinea();
  if (!items.length) return null;
  const actuar = (i: Insight) => {
    haptico();
    if (i.accion?.ir) return navegar(i.accion.ir);
    if (i.accion?.pregunta) {
      if (!preguntarAlChat(i.accion.pregunta)) toast("Espera a que termine la respuesta anterior.");
      navegar(hashDe("chat"));
    }
  };
  return (
    <section aria-label="Lo que noté">
      <TituloSeccion>
        <span className="flex items-center gap-1.5">
          Lo que noté <Sparkles aria-hidden className="size-[18px] text-tint" strokeWidth={2.2} />
        </span>
      </TituloSeccion>
      <ul className="space-y-2.5">
        {items.map((i, n) => {
          const color = COLOR_TONO[i.tono];
          const Icono = ICONOS[i.icono];
          return (
            <li
              key={i.id}
              data-insight={i.id}
              className="flex animate-entrar gap-3 rounded-[20px] p-4"
              style={{
                backgroundColor: `color-mix(in srgb, ${color} 10%, var(--card))`,
                boxShadow: `inset 0 0 0 0.5px color-mix(in srgb, ${color} 22%, transparent)`,
                animationDelay: `${n * 50}ms`,
              }}
            >
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-white" style={{ backgroundColor: color }}>
                <Icono className="size-[18px]" strokeWidth={2.4} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[17px] leading-snug font-semibold text-pretty">{i.titulo}</p>
                {i.detalle ? <p className="mt-0.5 text-[15px] leading-snug text-muted-foreground">{i.detalle}</p> : null}
                {i.accion ? (
                  <button
                    type="button"
                    disabled={!i.accion.ir && !enLinea}
                    onClick={() => actuar(i)}
                    className="-mx-1 mt-1 flex h-8 items-center gap-0.5 rounded-full px-1 text-[15px] font-semibold transition-opacity active:opacity-50 disabled:opacity-40"
                    style={{ color: `color-mix(in srgb, ${color} 85%, var(--foreground))` }}
                  >
                    {i.accion.texto}
                    <ChevronRight className="size-4" strokeWidth={2.6} />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Cambio contra el anterior en una cápsula chica: ↑ 12% (más gasto en rojo, menos en verde). */
function Delta({ actual, anterior }: { actual: number; anterior: number }) {
  const r = cambio(actual, anterior);
  if (r === null) return actual > 0 ? <span className="text-[13px] font-semibold text-muted-foreground">nuevo</span> : null;
  if (Math.abs(r) < 0.01) return <span className="text-[13px] font-semibold text-muted-foreground">=</span>;
  const sube = r > 0;
  return (
    <span className={cn("flex items-center text-[13px] font-semibold tabular", sube ? "text-negative" : "text-positive")}>
      {sube ? <ArrowUpRight className="size-3.5" strokeWidth={2.8} aria-hidden /> : <ArrowDownRight className="size-3.5" strokeWidth={2.8} aria-hidden />}
      <span className="sr-only">{sube ? "subió" : "bajó"} </span>
      {pct(Math.min(9.99, Math.abs(r)))}
      {Math.abs(r) > 9.99 ? "+" : ""}
    </span>
  );
}

function Categorias({
  a,
  slots,
  categoria,
  nombreCategoria,
  alFiltrar,
}: {
  a: DatosAnalisis;
  slots: Map<string | null, number | "otros">;
  categoria: string | null;
  nombreCategoria: string | null;
  alFiltrar: (c: string | null) => void;
}) {
  const lista = a.categorias.filter((c) => c.centavos > 0);
  const total = Math.max(1, a.totales.gasto);
  const maximo = Math.max(1, ...lista.map((c) => Math.max(c.centavos, a.comparable ? c.anterior : 0)));
  const antes = nombreAnterior(a.periodo, a.rango.desde);
  if (!lista.length) return null;
  return (
    <section aria-label={categoria ? "Por subcategoría" : "Por categoría"}>
      <TituloSeccion>{categoria ? `${nombreCategoria} por subcategoría` : "Por categoría"}</TituloSeccion>
      <Grupo pie={a.comparable ? `La rayita marca lo que llevabas en ${antes}${a.enCurso ? " a estas alturas" : ""}.` : undefined}>
        {lista.map((c, i) => {
          const color = colorSlot(slots.get(c.id) ?? "otros");
          const alTocar = () => {
            haptico();
            if (!categoria && c.id) {
              alFiltrar(c.id);
              window.scrollTo({ top: 0, behavior: "smooth" });
            } else if (c.id) {
              navegar(hashDe("movimientos", { ...delPeriodo(a), tipo: "gasto", categoria: c.id }));
            }
          };
          return (
            <button
              key={c.id ?? "sin"}
              type="button"
              disabled={!c.id}
              onClick={alTocar}
              data-categoria={c.id ?? "sin"}
              className="fila-presionable relative block w-full px-4 py-3 text-left disabled:active:bg-transparent [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-4 [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
            >
              <div className="flex items-baseline gap-2">
                <span aria-hidden className="size-2.5 shrink-0 translate-y-[-1px] rounded-full" style={{ backgroundColor: color }} />
                <span className="min-w-0 flex-1 truncate text-[17px]">{c.nombre}</span>
                {a.comparable ? <Delta actual={c.centavos} anterior={c.anterior} /> : null}
                <span className="shrink-0 text-[17px] tabular">{dinero(c.centavos, a.moneda)}</span>
              </div>
              <div className="relative mt-2 ml-[18px] h-[6px] rounded-full bg-fill">
                <span
                  className="absolute inset-y-0 left-0 origin-left animate-crecer-x rounded-full"
                  style={{ width: `${(c.centavos / maximo) * 100}%`, backgroundColor: color, animationDelay: `${i * 40}ms` }}
                />
                {a.comparable && c.anterior > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -top-[3px] h-3 w-[2px] rounded-full bg-foreground/55"
                    style={{ left: `calc(${(c.anterior / maximo) * 100}% - 1px)` }}
                  />
                ) : null}
              </div>
              <div className="mt-1 ml-[18px] text-[13px] text-muted-foreground tabular">
                {pct(c.centavos / total)} · {c.cantidad} {c.cantidad === 1 ? "gasto" : "gastos"}
                {a.comparable && c.anterior > 0 ? ` · antes ${dinero(c.anterior, a.moneda)}` : ""}
              </div>
            </button>
          );
        })}
      </Grupo>
    </section>
  );
}

function Calendario({
  a,
  filas,
  categorias,
  categoria,
}: {
  a: DatosAnalisis;
  filas: Fila[];
  categorias: Parameters<typeof analizar>[1]["categorias"];
  categoria: string | null;
}) {
  const [dia, setDia] = useState<string | null>(null);
  const elegido = dia ? a.dias.find((d) => d.fecha === dia) : undefined;
  const corto = a.periodo === "semana" || a.periodo === "mes";
  const delDia = useMemo(() => {
    if (!dia) return [];
    const padres = new Map(categorias.map((c) => [c.id, c.padreId ?? c.id]));
    return filas
      .filter((f) => f.f === dia && f.t === "gasto" && f.m === a.moneda && (!categoria || f.k === categoria || (f.k && padres.get(f.k) === categoria)))
      .sort((x, y) => y.c - x.c);
  }, [dia, filas, a.moneda, categoria, categorias]);

  return (
    <section aria-label="Calendario">
      <TituloSeccion accion={<LeyendaCalor />}>Calendario</TituloSeccion>
      <div className="rounded-[20px] bg-card p-4">
        {corto ? (
          <CalendarioCalor dias={a.dias} hoy={a.hoy} seleccionado={dia} alElegir={setDia} moneda={a.moneda} />
        ) : (
          <RejillaCalor dias={a.dias} seleccionado={dia} alElegir={setDia} moneda={a.moneda} />
        )}
        <p className="mt-3 text-[13px] text-muted-foreground">
          {a.sinGasto.dias
            ? `${a.sinGasto.dias} ${a.sinGasto.dias === 1 ? "día" : "días"} sin gastar${a.sinGasto.racha > 1 ? ` · mejor racha: ${a.sinGasto.racha} días` : ""}.`
            : "Gastaste todos los días."}{" "}
          {elegido ? null : "Toca un día para ver qué pasó."}
        </p>
        {elegido ? (
          <div className="mt-3 animate-aparecer pt-3 hairline-t" aria-live="polite" data-testid="dia-elegido">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-semibold">{nombreDia(elegido.fecha, a.hoy)}</p>
              <p className="text-[15px] font-semibold tabular">{dinero(elegido.centavos, a.moneda)}</p>
            </div>
            {delDia.length ? (
              <ul className="mt-1">
                {delDia.slice(0, 6).map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => navegar(hashDetalle(f.id))}
                      className="flex h-9 w-full items-center justify-between gap-3 text-left text-[15px] active:opacity-50"
                    >
                      <span className="min-w-0 truncate">{f.e}</span>
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground tabular">
                        {dinero(f.c, a.moneda)}
                        <ChevronRight className="size-4 opacity-60" aria-hidden />
                      </span>
                    </button>
                  </li>
                ))}
                {delDia.length > 6 ? <li className="text-[13px] text-muted-foreground">y {delDia.length - 6} más</li> : null}
              </ul>
            ) : (
              <p className="mt-1 text-[15px] text-muted-foreground">Un día sin gastos.</p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

const DIAS_LARGO = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DIAS_LETRA = ["L", "M", "M", "J", "V", "S", "D"];

function Cuando({ a }: { a: DatosAnalisis }) {
  const [sel, setSel] = useState<number | null>(null);
  const promedios = a.diaSemana.map((d) => (d.dias ? d.centavos / d.dias : 0));
  const maximo = Math.max(1, ...promedios);
  const pico = promedios.indexOf(Math.max(...promedios));
  const conGasto = promedios.filter((p) => p > 0).length;
  const momentos = MOMENTOS.map((m) => ({ ...m, ...a.momentos[m.id] }));
  if (conGasto < 2 && a.conHora < 3) return null;
  const elegido = sel ?? pico;

  return (
    <section aria-label="Cuándo gastas">
      <TituloSeccion>Cuándo gastas</TituloSeccion>
      <div className="space-y-5 rounded-[20px] bg-card p-4">
        {conGasto >= 2 ? (
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">Promedio por día de la semana</p>
            <p className="text-[20px] leading-7 font-bold tabular" aria-live="polite">
              {DIAS_LARGO[elegido]}: {dinero(Math.round(promedios[elegido] ?? 0), a.moneda)}
            </p>
            <div className="mt-3 grid h-[96px] grid-cols-7 items-end gap-2" role="group" aria-label="Días de la semana">
              {promedios.map((p, i) => (
                <button
                  key={DIAS_LARGO[i]}
                  type="button"
                  aria-pressed={sel === i}
                  aria-label={`${DIAS_LARGO[i]}: ${dinero(Math.round(p), a.moneda)} en promedio`}
                  onClick={() => {
                    haptico();
                    setSel(sel === i ? null : i);
                  }}
                  className="flex h-full flex-col items-center justify-end gap-1.5"
                >
                  <span
                    className="block w-full max-w-7 origin-bottom animate-crecer rounded-t-[4px] rounded-b-[2px] transition-opacity duration-200"
                    style={{
                      height: `${Math.max(p > 0 ? 4 : 2, (p / maximo) * 72)}px`,
                      backgroundColor: p > 0 ? "var(--tint)" : "var(--fill)",
                      opacity: i === elegido ? 1 : 0.35,
                      animationDelay: `${i * 40}ms`,
                    }}
                  />
                  <span className={cn("text-[11px] font-semibold", i === elegido ? "text-foreground" : "text-muted-foreground")}>{DIAS_LETRA[i]}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {a.conHora >= 3 ? (
          <div className={cn(conGasto >= 2 && "pt-4 hairline-t")}>
            <p className="text-[13px] font-medium text-muted-foreground">Momento del día (por número de compras)</p>
            <div className="mt-2 flex h-3 gap-[2px] overflow-hidden rounded-full" aria-hidden>
              {momentos.map((m, i) =>
                m.cantidad ? (
                  <span key={m.id} className="h-full" style={{ flexGrow: m.cantidad, backgroundColor: `var(--serie-${i + 1})` }} />
                ) : null,
              )}
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {momentos.map((m, i) => (
                <li key={m.id} className="flex items-center gap-2 text-[15px]">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--serie-${i + 1})` }} />
                  <span className="min-w-0 flex-1 truncate">{m.nombre}</span>
                  <span className="text-muted-foreground tabular">{pct(m.cantidad / Math.max(1, a.conHora))}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-muted-foreground">
              De {a.conHora} {a.conHora === 1 ? "gasto" : "gastos"} con hora (los que dictas en el momento).
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Naturaleza({ a }: { a: DatosAnalisis }) {
  const { necesidad, gusto, sin } = a.naturaleza;
  const ingreso = a.totales.ingreso;
  const ahorro = Math.max(0, a.totales.neto);
  const base = ingreso > 0 ? Math.max(ingreso, a.totales.gasto) : a.totales.gasto;
  if (base <= 0 || a.totales.gasto <= 0) return null;
  const partes = [
    { id: "necesidad", nombre: "Necesidades", valor: necesidad, color: "var(--serie-1)", meta: 0.5 },
    { id: "gusto", nombre: "Gustos", valor: gusto, color: "var(--serie-2)", meta: 0.3 },
    ...(ingreso > 0 ? [{ id: "ahorro", nombre: "Te quedó", valor: ahorro, color: "var(--serie-5)", meta: 0.2 }] : []),
    ...(sin > 0 ? [{ id: "sin", nombre: "Sin clasificar", valor: sin, color: "var(--serie-otros)", meta: null }] : []),
  ].filter((p) => p.valor > 0 || p.meta !== null);

  return (
    <section aria-label="Necesidades y gustos">
      <TituloSeccion>Necesidades y gustos</TituloSeccion>
      <div className="rounded-[20px] bg-card p-4">
        <p className="text-[13px] font-medium text-muted-foreground">
          {ingreso > 0 ? "De lo que te entró, contra la regla 50/30/20" : "De lo que gastaste"}
        </p>
        <div className="mt-2 flex h-4 gap-[2px] overflow-hidden rounded-full bg-fill" aria-hidden>
          {partes.map((p) =>
            p.valor > 0 ? (
              <span
                key={p.id}
                className="h-full origin-left animate-crecer-x"
                style={{ width: `${(p.valor / base) * 100}%`, backgroundColor: p.color }}
              />
            ) : null,
          )}
        </div>
        <ul className="mt-3 space-y-1.5">
          {partes.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-[15px]">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
              <span className="font-semibold tabular">{pct(p.valor / base)}</span>
              {ingreso > 0 && p.meta !== null ? <span className="w-[64px] text-right text-[13px] text-muted-foreground tabular">meta {pct(p.meta)}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Flujo({ a }: { a: DatosAnalisis }) {
  const meses = mesesConFlujo(a);
  const [sel, setSel] = useState<number | null>(null);
  if (meses.length < 2 || !meses.some((m) => m.ingreso > 0)) return null;
  const elegido = meses[sel ?? meses.length - 1];
  return (
    <section aria-label="Lo que te quedó">
      <TituloSeccion>Lo que te quedó</TituloSeccion>
      <div className="rounded-[20px] bg-card p-4">
        {elegido ? (
          <div aria-live="polite">
            <p className="text-[13px] font-medium text-muted-foreground">{elegido.nombre}</p>
            <p className={cn("text-[22px] leading-7 font-bold tabular", elegido.neto >= 0 ? "text-positive" : "text-negative")}>
              {dinero(elegido.neto, a.moneda, { signo: true })}
            </p>
            <p className="text-[13px] text-muted-foreground tabular">
              Entró {dinero(elegido.ingreso, a.moneda)} · salió {dinero(elegido.gasto, a.moneda)}
            </p>
          </div>
        ) : null}
        <BarrasFlujo
          className="mt-3"
          datos={meses.map((m) => ({ neto: m.neto, etiqueta: a.periodo === "anio" ? mesCorto(m.mes).charAt(0).toUpperCase() : mesCorto(m.mes), larga: m.nombre }))}
          seleccionado={sel}
          alElegir={setSel}
          moneda={a.moneda}
        />
      </div>
    </section>
  );
}

function Lugares({ a }: { a: DatosAnalisis }) {
  const [todos, setTodos] = useState(false);
  const lista = a.comercios.filter((c) => c.centavos > 0);
  if (!lista.length) return null;
  const visibles = todos ? lista.slice(0, 20) : lista.slice(0, 5);
  return (
    <section aria-label="Dónde gastas más">
      <TituloSeccion
        accion={
          lista.length > 5 ? (
            <Button variant="plain" size="text" className="text-[15px]" onClick={() => setTodos(!todos)}>
              {todos ? "Ver menos" : "Ver más"}
            </Button>
          ) : undefined
        }
      >
        Dónde gastas más
      </TituloSeccion>
      <Grupo>
        {visibles.map((c, i) => (
          <FilaBoton
            key={c.id}
            sangria="4rem"
            icono={
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-[15px] font-semibold tabular">
                {i + 1}
              </span>
            }
            titulo={c.nombre}
            subtitulo={`${c.cantidad} ${c.cantidad === 1 ? "vez" : "veces"} · ${dinero(Math.round(c.centavos / Math.max(1, c.cantidad)), a.moneda)} c/u`}
            valor={
              <span className="flex flex-col items-end">
                <span className="text-foreground tabular">{dinero(c.centavos, a.moneda)}</span>
                {a.comparable ? <Delta actual={c.centavos} anterior={c.anterior} /> : null}
              </span>
            }
            onClick={() => navegar(hashDe("movimientos", { ...delPeriodo(a), q: c.nombre }))}
          />
        ))}
      </Grupo>
    </section>
  );
}

/** Los movimientos del periodo que se ve: el mes, o las fechas exactas de una semana o de varios meses. */
function delPeriodo(a: DatosAnalisis): Record<string, string> {
  return a.periodo === "mes" ? { mes: a.rango.desde.slice(0, 7) } : { desde: a.rango.desde, hasta: a.rango.hasta };
}

/** Lo que llevan las etiquetas en el periodo: cruzan categorías ("viaje", "trabajo"). */
function PorEtiqueta({ a, categoria }: { a: DatosAnalisis; categoria: string | null }) {
  const lista = a.etiquetas.filter((e) => e.centavos > 0).slice(0, 8);
  if (!lista.length) return null;
  const tope = Math.max(1, ...lista.map((e) => e.centavos));
  return (
    <section aria-label="Por etiqueta">
      <TituloSeccion
        accion={
          <Button variant="plain" size="text" className="text-[15px]" onClick={() => navegar(hashDe("etiquetas"))}>
            Ver todas
          </Button>
        }
      >
        Por etiqueta
      </TituloSeccion>
      <Grupo pie="Un gasto con dos etiquetas cuenta en las dos.">
        {lista.map((e) => (
          <button
            key={e.id}
            type="button"
            data-etiqueta={e.nombre}
            onClick={() => navegar(hashDe("movimientos", { ...delPeriodo(a), tipo: "gasto", categoria: categoria ?? undefined, etiqueta: e.id ?? undefined }))}
            className="fila-presionable relative block w-full px-4 py-3 text-left [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-4 [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
          >
            <div className="flex items-baseline gap-2">
              <Tag aria-hidden className="size-4 shrink-0 translate-y-[2px] text-tint" />
              <span className="min-w-0 flex-1 truncate text-[17px]">{e.nombre}</span>
              <span className="text-[13px] text-muted-foreground tabular">
                {e.cantidad} {e.cantidad === 1 ? "gasto" : "gastos"}
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="text-[17px] tabular">{dinero(e.centavos, a.moneda)}</span>
                {a.comparable ? <Delta actual={e.centavos} anterior={e.anterior} /> : null}
              </span>
            </div>
            <div className="mt-2 ml-6 h-[6px] rounded-full bg-fill">
              <span className="block h-full origin-left animate-crecer-x rounded-full bg-tint" style={{ width: `${(e.centavos / tope) * 100}%` }} />
            </div>
          </button>
        ))}
      </Grupo>
    </section>
  );
}

function Pagos({ a }: { a: DatosAnalisis }) {
  const lista = a.cuentas.filter((c) => c.centavos > 0);
  const conCuenta = lista.filter((c) => c.id !== null);
  if (!lista.length) return null;
  const total = Math.max(1, lista.reduce((s, c) => s + c.centavos, 0));
  return (
    <section aria-label="Cómo pagas">
      <TituloSeccion>Cómo pagas</TituloSeccion>
      <Grupo pie={conCuenta.length ? undefined : "Di con qué pagaste («gasté 85 en café con BBVA») y aquí verás cuánto va por cada tarjeta o cuenta."}>
        {lista.map((c) => (
          <div
            key={c.id ?? "sin"}
            className="relative px-4 py-3 [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-4 [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
          >
            <div className="flex items-baseline gap-2">
              <CreditCard aria-hidden className={cn("size-4 shrink-0 translate-y-[2px]", c.id ? "text-tint" : "text-muted-foreground")} />
              <span className={cn("min-w-0 flex-1 truncate text-[17px]", !c.id && "text-muted-foreground")}>{c.nombre}</span>
              <span className="text-[13px] text-muted-foreground tabular">{pct(c.centavos / total)}</span>
              <span className="shrink-0 text-[17px] tabular">{dinero(c.centavos, a.moneda)}</span>
            </div>
            <div className="mt-2 ml-6 h-[6px] rounded-full bg-fill">
              <span
                className="block h-full origin-left animate-crecer-x rounded-full"
                style={{ width: `${(c.centavos / total) * 100}%`, backgroundColor: c.id ? "var(--tint)" : "var(--serie-otros)" }}
              />
            </div>
          </div>
        ))}
      </Grupo>
    </section>
  );
}

function PreguntarIA({ a, nombreCategoria }: { a: DatosAnalisis; nombreCategoria: string | null }) {
  const enLinea = useEnLinea();
  const periodo = tituloRango(a.periodo, a.rango);
  const pregunta = `Analiza mis gastos${nombreCategoria ? ` de ${nombreCategoria}` : ""} de ${periodo} contra ${nombreAnterior(a.periodo, a.rango.desde)}: qué cambió, qué fugas ves y qué me recomiendas.`;
  return (
    <button
      type="button"
      disabled={!enLinea}
      onClick={() => {
        haptico();
        if (!preguntarAlChat(pregunta)) toast("Espera a que termine la respuesta anterior.");
        navegar(hashDe("chat"));
      }}
      className="presionable flex w-full items-center gap-3 rounded-[20px] bg-card p-4 text-left disabled:opacity-50"
    >
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tint/15 text-tint">
        <Sparkles className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold">Pedirle un análisis a la IA</span>
        <span className="block text-[15px] text-muted-foreground">Te dice qué cambió y qué puedes recortar.</span>
      </span>
      <ChevronRight aria-hidden className="size-5 text-muted-foreground/60" />
    </button>
  );
}

function Esqueleto() {
  // Si la carga tarda, que no parezca colgada: el esqueleto respira.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 120);
    return () => window.clearTimeout(id);
  }, []);
  if (!visible) return null;
  return (
    <div aria-busy className="space-y-3 pt-3">
      <div className="rounded-[20px] bg-card p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-10 w-48" />
        <Skeleton className="mt-3 h-4 w-56" />
        <Skeleton className="mt-4 h-[150px] w-full" />
      </div>
      <Skeleton className="h-[88px] rounded-[20px] bg-card" />
      <Skeleton className="h-[88px] rounded-[20px] bg-card" />
    </div>
  );
}
