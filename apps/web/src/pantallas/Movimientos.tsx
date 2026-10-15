import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Map as MapIcon, ReceiptText, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cuentasParaElegir } from "../components/cuentas/ElegirCuenta";
import { FilaDeslizable } from "../components/FilaDeslizable";
import { ContenidoMovimiento, IconoOrigen, Monto, tituloDe } from "../components/FilaMovimiento";
import { Pantalla } from "../components/Pantalla";
import { Spinner } from "../components/Spinner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ChipVisual } from "../components/ui/chip";
import { Buscador } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { SelectNativo } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { eliminarConDeshacer } from "../lib/acciones";
import { api, mensajeDeError } from "../lib/api";
import { OpcionesCategorias } from "../lib/categorias";
import { useEnLinea } from "../lib/conexion";
import { abrirDetalle, claves, type FiltrosMovimientos, useCategorias, useMovimientos } from "../lib/consultas";
import { useCuentas, useEtiquetas } from "../lib/cuentas";
import { abrirEditor } from "../lib/editor";
import { Ajustado } from "../components/Ajustado";
import { diaCorto, dinero, mesActual, nombreDia, nombreMes, sumarMeses, TIPOS } from "../lib/formato";
import { rangoTexto } from "../lib/periodos";
import { useMedia } from "../lib/medios";
import { hashDe, navegar } from "../lib/ruta";
import type { MovimientoApp, Tablero, TipoMovimiento } from "../lib/tipos";
import { cn } from "../lib/utils";

const TIPOS_VALIDOS: TipoMovimiento[] = ["gasto", "ingreso", "transferencia", "pago_tarjeta"];
const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;
const FECHA_VALIDA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** En el teléfono, primero estos días; lo demás del mes, con «Ver N más». */
const DIAS_A_LA_VISTA = 3;

export function Movimientos({ params }: { params: URLSearchParams }) {
  const enLinea = useEnLinea();
  // Lista por día en el teléfono; tabla en pantallas anchas.
  const ancho = useMedia("(min-width: 768px)");
  const pedido = params.get("mes");
  const mes = pedido === "todo" || (pedido && MES_VALIDO.test(pedido)) ? pedido : mesActual();
  const tipoParam = params.get("tipo");
  const tipo = TIPOS_VALIDOS.includes(tipoParam as TipoMovimiento) ? (tipoParam as TipoMovimiento) : undefined;
  const categoria = params.get("categoria") ?? undefined;
  const q = params.get("q") ?? "";
  const revisar = params.get("revisar") === "1";
  // Desde una cuenta o una etiqueta: lo suyo.
  const cuenta = params.get("cuenta") ?? undefined;
  const etiqueta = params.get("etiqueta") ?? undefined;
  // Desde Análisis, una semana o varios meses: esas fechas exactas.
  const desdeP = params.get("desde");
  const hastaP = params.get("hasta");
  const rango = desdeP && hastaP && FECHA_VALIDA.test(desdeP) && FECHA_VALIDA.test(hastaP) && desdeP <= hastaP ? { desde: desdeP, hasta: hastaP } : undefined;

  const actualizar = (cambios: Record<string, string | undefined>) => {
    const actual: Record<string, string | undefined> = {
      mes: mes === mesActual() ? undefined : mes,
      tipo,
      categoria,
      q: q || undefined,
      revisar: revisar ? "1" : undefined,
      cuenta,
      etiqueta,
      desde: rango?.desde,
      hasta: rango?.hasta,
    };
    navegar(hashDe("movimientos", { ...actual, ...cambios }), { reemplazar: true });
  };

  // La búsqueda espera a que dejes de escribir.
  const [texto, setTexto] = useState(q);
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (texto.trim() !== q) actualizar({ q: texto.trim() || undefined });
    }, 350);
    return () => window.clearTimeout(id);
  }, [texto]);

  const filtros: FiltrosMovimientos = useMemo(
    () => ({ mes, rango, tipo, categoria, texto: q || undefined, revisar: revisar || undefined, cuenta, etiqueta }),
    [mes, rango?.desde, rango?.hasta, tipo, categoria, q, revisar, cuenta, etiqueta],
  );
  const consulta = useMovimientos(filtros);
  const categorias = useCategorias();

  const movimientos = useMemo(() => consulta.data?.pages.flatMap((p) => p.movimientos) ?? [], [consulta.data]);
  const total = consulta.data?.pages.at(-1)?.total ?? 0;
  const conFiltros = !!(tipo || categoria || q || revisar || cuenta || etiqueta || rango || pedido === "todo");
  const nombreCategoria = categorias.data?.find((c) => c.id === categoria)?.nombre;
  // Cuentas y etiquetas para sus chips; un servidor sin ellas responde 404 y el chip no sale.
  const cuentas = useCuentas();
  const etiquetas = useEtiquetas("todo");
  const listaCuentas = useMemo(() => cuentasParaElegir(cuentas.data?.cuentas ?? []), [cuentas.data]);
  const listaEtiquetas = etiquetas.data ?? [];
  const nombreCuenta = cuentas.data?.cuentas.find((c) => c.id === cuenta)?.nombre ?? movimientos.find((m) => m.cuentaId === cuenta)?.cuenta;
  const nombreEtiqueta = etiquetas.data?.find((e) => e.id === etiqueta)?.nombre ?? movimientos.flatMap((m) => m.etiquetas ?? []).find((e) => e.id === etiqueta)?.nombre;

  const meses = useMemo(() => Array.from({ length: 24 }, (_, i) => sumarMeses(mesActual(), -i)), []);
  const tipoCategorias = tipo === "gasto" || tipo === "ingreso" ? tipo : undefined;
  // Un mes del calendario (no "todo" ni unas fechas de Análisis): «Ver 8 más de octubre» y «Ver septiembre».
  const mesSolo = !rango && mes !== "todo" ? mes : undefined;
  const anterior = mesSolo ? sumarMeses(mesSolo, -1) : undefined;

  const resumen = useResumen({
    movimientos,
    completos: !consulta.hasNextPage && !consulta.isPending,
    tipo,
    mes: mesSolo,
    soloMes: !(categoria || q || revisar || cuenta || etiqueta),
  });

  // Teléfono: primero tres días; lo demás se abre con «Ver N más». Buscando, todo a la vista.
  const dias = useMemo(() => agruparPorDia(movimientos), [movimientos]);
  const claveFiltros = JSON.stringify(filtros);
  const [abiertoPara, setAbiertoPara] = useState<string | null>(null);
  const plegado = !ancho && !q && abiertoPara !== claveFiltros && dias.length > DIAS_A_LA_VISTA;
  const diasVisibles = plegado ? dias.slice(0, DIAS_A_LA_VISTA) : dias;
  const aLaVista = plegado ? diasVisibles.reduce((n, [, lista]) => n + lista.length, 0) : movimientos.length;
  const faltan = Math.max(total - aLaVista, movimientos.length - aLaVista);
  const deMes = mesSolo ? ` de ${nombreMes(mesSolo, false).toLowerCase()}` : "";
  const nombreAnterior = anterior ? nombreMes(anterior, anterior.slice(0, 4) !== mesActual().slice(0, 4)) : "";

  // Un filtro que llega aplicado (desde una cuenta o una etiqueta) se ve aunque su chip quede a la derecha.
  const filaChips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const activos = filaChips.current?.querySelectorAll<HTMLElement>("[data-filtro-activo]");
    const ultimo = activos?.[activos.length - 1];
    const fila = filaChips.current;
    if (!ultimo || !fila) return;
    const derecha = ultimo.offsetLeft + ultimo.offsetWidth - fila.clientWidth + 16;
    if (derecha > fila.scrollLeft) fila.scrollTo({ left: derecha });
  }, [categoria, cuenta, etiqueta, revisar, tipo, !!nombreCuenta, !!nombreEtiqueta]);

  // Abre lo plegado y, si falta por cargar, trae la siguiente página de una vez.
  const verMas = () => {
    if (plegado) setAbiertoPara(claveFiltros);
    if (consulta.hasNextPage && !consulta.isFetchingNextPage) void consulta.fetchNextPage();
  };

  return (
    <Pantalla
      titulo="Movimientos"
      alRefrescar={() => consulta.refetch()}
      derecha={
        <Button variant="gray" size="icon-sm" aria-label="Dónde gastas" onClick={() => navegar(hashDe("mapa"))}>
          <MapIcon strokeWidth={2.25} />
        </Button>
      }
    >
      <div className="space-y-3 pb-1">
        <Buscador valor={texto} onCambio={setTexto} placeholder="Buscar comercio o nota" aria-label="Buscar" />
        <Segmented<string>
          etiqueta="Tipo"
          valor={tipo === "gasto" || tipo === "ingreso" ? tipo : tipo ? "otro" : "todos"}
          onChange={(v) => actualizar({ tipo: v === "todos" ? undefined : v, categoria: undefined })}
          opciones={[
            { valor: "todos", etiqueta: "Todos" },
            { valor: "gasto", etiqueta: "Gastos" },
            { valor: "ingreso", etiqueta: "Ingresos" },
          ]}
        />
        <div ref={filaChips} data-sin-jalar className="relative -mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ChipSelect
            etiqueta="Mes"
            activo
            value={rango ? "rango" : mes}
            onChange={(v) => actualizar({ mes: v === mesActual() ? undefined : v, desde: undefined, hasta: undefined })}
            opciones={
              <>
                {rango ? (
                  <option value="rango" disabled>
                    {rangoTexto(rango.desde, rango.hasta)}
                  </option>
                ) : null}
                <option value="todo">Todo</option>
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {nombreMes(m)}
                  </option>
                ))}
              </>
            }
          >
            {rango ? rangoTexto(rango.desde, rango.hasta) : mes === "todo" ? "Todo" : nombreMes(mes, mes.slice(0, 4) !== mesActual().slice(0, 4))}
          </ChipSelect>
          <ChipSelect
            etiqueta="Categoría"
            activo={!!categoria}
            value={categoria ?? ""}
            onChange={(v) => actualizar({ categoria: v || undefined })}
            quitar={categoria ? { etiqueta: `Quitar filtro de categoría ${nombreCategoria ?? ""}`.trim(), alTocar: () => actualizar({ categoria: undefined }) } : undefined}
            opciones={
              <>
                <option value="">Todas las categorías</option>
                <OpcionesCategorias categorias={categorias.data ?? []} tipo={tipoCategorias} paraFiltrar />
              </>
            }
          >
            {nombreCategoria ?? "Categoría"}
          </ChipSelect>
          {cuenta || listaCuentas.length ? (
            <ChipSelect
              etiqueta="Cuenta"
              activo={!!cuenta}
              value={cuenta ?? ""}
              onChange={(v) => actualizar({ cuenta: v || undefined })}
              quitar={cuenta ? { etiqueta: `Quitar filtro de cuenta ${nombreCuenta ?? ""}`.trim(), alTocar: () => actualizar({ cuenta: undefined }) } : undefined}
              opciones={
                <>
                  <option value="">Todas las cuentas</option>
                  {cuenta && !listaCuentas.some((c) => c.id === cuenta) ? <option value={cuenta}>{nombreCuenta ?? "Esta cuenta"}</option> : null}
                  {listaCuentas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </>
              }
            >
              {cuenta ? (nombreCuenta ?? "Cuenta") : "Cuenta"}
            </ChipSelect>
          ) : null}
          {etiqueta || listaEtiquetas.length ? (
            <ChipSelect
              etiqueta="Etiqueta"
              activo={!!etiqueta}
              value={etiqueta ?? ""}
              onChange={(v) => actualizar({ etiqueta: v || undefined })}
              quitar={etiqueta ? { etiqueta: `Quitar filtro de etiqueta ${nombreEtiqueta ?? ""}`.trim(), alTocar: () => actualizar({ etiqueta: undefined }) } : undefined}
              opciones={
                <>
                  <option value="">Todas las etiquetas</option>
                  {etiqueta && !listaEtiquetas.some((e) => e.id === etiqueta) ? <option value={etiqueta}>#{nombreEtiqueta ?? "etiqueta"}</option> : null}
                  {listaEtiquetas.map((e) => (
                    <option key={e.id} value={e.id}>
                      #{e.nombre}
                    </option>
                  ))}
                </>
              }
            >
              {etiqueta ? `#${nombreEtiqueta ?? "etiqueta"}` : "Etiqueta"}
            </ChipSelect>
          ) : null}
          <button type="button" className="shrink-0" data-filtro-activo={revisar || undefined} aria-pressed={revisar} onClick={() => actualizar({ revisar: revisar ? undefined : "1" })}>
            <Chip activo={revisar}>Por revisar</Chip>
          </button>
          {tipo && tipo !== "gasto" && tipo !== "ingreso" ? (
            <button type="button" className="shrink-0" data-filtro-activo onClick={() => actualizar({ tipo: undefined })} aria-label={`Quitar filtro ${TIPOS[tipo]}`}>
              <Chip activo>
                {TIPOS[tipo]}
                <X className="size-4" strokeWidth={2.5} />
              </Chip>
            </button>
          ) : null}
        </div>
        {resumen ? <Resumen {...resumen} /> : null}
        <p className="px-1 text-[13px] text-muted-foreground" aria-live="polite">
          {consulta.isPending ? " " : `${total} ${total === 1 ? "movimiento" : "movimientos"}`}
        </p>
      </div>

      {consulta.isPending ? (
        <EsqueletoLista />
      ) : consulta.isError && !movimientos.length ? (
        <Vacio titulo="No pudimos cargar tus movimientos" texto={mensajeDeError(consulta.error)}>
          <Button variant="tinted" size="sm" onClick={() => consulta.refetch()}>
            Reintentar
          </Button>
        </Vacio>
      ) : movimientos.length === 0 ? (
        <Vacio
          titulo={conFiltros ? "Nada con estos filtros" : "Sin movimientos"}
          texto={conFiltros ? "Prueba con otro mes o quita los filtros." : "Dile a Siri «gasté 85 en café» o agrégalo con +."}
        >
          {conFiltros ? (
            <Button variant="tinted" size="sm" onClick={() => navegar(hashDe("movimientos"), { reemplazar: true })}>
              Quitar filtros
            </Button>
          ) : (
            <Button variant="tinted" size="sm" onClick={() => abrirEditor(null)} disabled={!enLinea}>
              Agregar movimiento
            </Button>
          )}
        </Vacio>
      ) : (
        <>
          {ancho ? (
            <Tabla movimientos={movimientos} />
          ) : (
            <ListaPorDia dias={diasVisibles} alEliminar={(m) => void eliminarConDeshacer(m)} deshabilitada={!enLinea} />
          )}
          {plegado || consulta.hasNextPage ? (
            <Button variant="gray" size="lg" className="mt-4 w-full text-foreground" disabled={consulta.isFetchingNextPage} onClick={verMas}>
              {consulta.isFetchingNextPage ? <Spinner /> : `Ver ${faltan} más${deMes}`}
            </Button>
          ) : (
            <>
              {!ancho && !q && dias.length > DIAS_A_LA_VISTA ? (
                <Button variant="gray" size="lg" className="mt-4 w-full text-foreground" onClick={() => setAbiertoPara(null)}>
                  Ver menos
                </Button>
              ) : null}
              {anterior && meses.includes(anterior) ? (
                <button
                  type="button"
                  className="fila-presionable mt-2 flex min-h-[46px] w-full items-center justify-center gap-0.5 rounded-[14px] text-[15px] font-medium text-tint"
                  onClick={() => {
                    actualizar({ mes: anterior, desde: undefined, hasta: undefined });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Ver {nombreAnterior.charAt(0).toLowerCase() + nombreAnterior.slice(1)}
                  <ChevronRight className="size-4" strokeWidth={2.5} />
                </button>
              ) : null}
            </>
          )}
          {!ancho && enLinea ? (
            <p className="mt-3 px-4 text-center text-[13px] leading-snug text-muted-foreground">Desliza uno a la izquierda para editarlo o borrarlo.</p>
          ) : null}
        </>
      )}
    </Pantalla>
  );
}

/** Centavos por moneda; la primera es la que más aparece. */
type Montos = [string, number][];
type DatosResumen = { gastado?: Montos; entro?: Montos };

/**
 * «Gastaste» y «Entró» de lo que se está viendo. Con todo cargado, la suma de la lista (respeta
 * cualquier filtro); si falta por cargar y solo se filtra por mes, los totales del tablero de ese mes.
 * Si no hay cómo saberlo bien, no sale.
 */
function useResumen({
  movimientos,
  completos,
  tipo,
  mes,
  soloMes,
}: {
  movimientos: MovimientoApp[];
  completos: boolean;
  tipo?: TipoMovimiento;
  mes?: string;
  soloMes: boolean;
}): DatosResumen | null {
  const conGasto = !tipo || tipo === "gasto";
  const conIngreso = !tipo || tipo === "ingreso";
  const usarTablero = !completos && soloMes && !!mes && (conGasto || conIngreso);
  // La misma consulta que Inicio (useTablero), pero solo cuando hace falta.
  const tablero = useQuery({
    queryKey: claves.tablero(mes ?? ""),
    queryFn: () => api<Tablero>(`/v1/tablero?mes=${mes}`),
    enabled: usarTablero,
  });
  return useMemo(() => {
    if (!conGasto && !conIngreso) return null;
    if (completos) {
      if (!movimientos.length) return null;
      // Con filtros, una tarjeta en ceros no dice nada: sale solo la que tiene algo.
      const sumar = (t: TipoMovimiento): Montos | undefined => {
        const porMoneda = new Map<string, { n: number; centavos: number }>();
        for (const m of movimientos) {
          if (m.tipo !== t) continue;
          const e = porMoneda.get(m.moneda) ?? { n: 0, centavos: 0 };
          e.n += 1;
          e.centavos += Math.abs(m.montoCentavos);
          porMoneda.set(m.moneda, e);
        }
        const lista = [...porMoneda.entries()].sort((a, b) => b[1].n - a[1].n).map(([mon, e]): [string, number] => [mon, e.centavos]);
        if (lista.length) return lista;
        return soloMes ? [[movimientos[0]?.moneda ?? "MXN", 0]] : undefined;
      };
      const gastado = conGasto ? sumar("gasto") : undefined;
      const entro = conIngreso ? sumar("ingreso") : undefined;
      return gastado || entro ? { gastado, entro } : null;
    }
    if (usarTablero && tablero.data) {
      const t = tablero.data;
      return {
        gastado: conGasto ? [[t.moneda, t.totales.gastadoCentavos]] : undefined,
        entro: conIngreso ? [[t.moneda, t.totales.ingresadoCentavos]] : undefined,
      };
    }
    return null;
  }, [movimientos, completos, conGasto, conIngreso, soloMes, usarTablero, tablero.data]);
}

function Resumen({ gastado, entro }: DatosResumen) {
  return (
    <div className="@container">
      <div data-resumen className={cn("grid gap-2.5", gastado && entro && "grid-cols-2 @max-[260px]:grid-cols-1")}>
        {gastado ? <TarjetaMonto titulo="Gastaste" montos={gastado} /> : null}
        {entro ? <TarjetaMonto titulo="Entró" montos={entro} positivo /> : null}
      </div>
    </div>
  );
}

function TarjetaMonto({ titulo, montos, positivo }: { titulo: string; montos: Montos; positivo?: boolean }) {
  const [[moneda, centavos] = ["MXN", 0], ...otras] = montos;
  return (
    <section aria-label={titulo} className="@container min-w-0 rounded-[18px] bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{titulo}</p>
      {/* En un renglón: si no cabe, la letra se achica en vez de partir el monto. */}
      <Ajustado className={cn("mt-0.5 text-[length:clamp(15px,14cqi,21px)] leading-tight font-semibold tracking-tight tabular", positivo && centavos > 0 && "text-positive")}>
        {dinero(centavos, moneda)}
      </Ajustado>
      {otras.length ? (
        <p className="mt-0.5 text-[13px] text-muted-foreground tabular [overflow-wrap:anywhere]">y {otras.map(([m, c]) => dinero(c, m)).join(" · ")}</p>
      ) : null}
    </section>
  );
}

/** Un filtro de la fila: un chip encima de un <select> nativo; aplicado, se pinta y trae su «×» para quitarlo. */
function ChipSelect({
  etiqueta,
  activo,
  value,
  onChange,
  opciones,
  quitar,
  children,
}: {
  etiqueta: string;
  activo?: boolean;
  value: string;
  onChange: (valor: string) => void;
  opciones: ReactNode;
  quitar?: { etiqueta: string; alTocar: () => void };
  children: ReactNode;
}) {
  const select = (
    <SelectNativo className="shrink-0" aria-label={etiqueta} value={value} onChange={(e) => onChange(e.target.value)} opciones={opciones}>
      <Chip activo={activo} className={quitar ? "pr-1 shadow-none" : undefined}>
        {children}
        <ChevronDown className={cn("size-4", activo ? "text-white/85" : "text-muted-foreground")} strokeWidth={2.5} />
      </Chip>
    </SelectNativo>
  );
  if (!quitar) return select;
  return (
    <div data-filtro-activo className="flex shrink-0 items-center rounded-full bg-tint">
      {select}
      <button type="button" aria-label={quitar.etiqueta} onClick={quitar.alTocar} className="flex h-8 items-center rounded-full pr-3 pl-1 text-white">
        <X className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function Chip({ activo, className, children }: { activo?: boolean; className?: string; children: ReactNode }) {
  return <ChipVisual className={cn("gap-1 px-3.5", activo && "bg-tint text-white", className)}>{children}</ChipVisual>;
}

function agruparPorDia(movimientos: MovimientoApp[]): [string, MovimientoApp[]][] {
  const grupos = new Map<string, MovimientoApp[]>();
  for (const m of movimientos) {
    const lista = grupos.get(m.fecha);
    if (lista) lista.push(m);
    else grupos.set(m.fecha, [m]);
  }
  return [...grupos.entries()];
}

/** "BBVA", o en una transferencia o pago de tarjeta "BBVA → Nu". */
function cuentasDe(m: MovimientoApp) {
  return [m.cuenta, m.cuentaDestino].filter(Boolean).join(" → ");
}

function ListaPorDia({
  dias,
  alEliminar,
  deshabilitada,
}: {
  dias: [string, MovimientoApp[]][];
  alEliminar: (m: MovimientoApp) => void;
  deshabilitada: boolean;
}) {
  return (
    <div className="space-y-6 pt-3">
      {dias.map(([fecha, lista]) => {
        const gastado = lista.filter((m) => m.tipo === "gasto").reduce((s, m) => s + Math.abs(m.montoCentavos), 0);
        return (
          <section key={fecha} aria-label={nombreDia(fecha)}>
            <div className="flex items-baseline justify-between px-1 pb-1.5">
              <h2 className="text-[15px] font-semibold">{nombreDia(fecha)}</h2>
              {gastado ? <span className="text-[13px] text-muted-foreground tabular">{dinero(gastado, lista[0]?.moneda)}</span> : null}
            </div>
            <div className="overflow-hidden rounded-[20px] bg-card">
              {lista.map((m) => (
                <FilaDeslizable
                  key={m.id}
                  etiqueta={`${tituloDe(m)}, ${dinero(Math.abs(m.montoCentavos), m.moneda)}`}
                  alTocar={() => abrirDetalle(m)}
                  alEditar={() => abrirEditor(m)}
                  alEliminar={() => alEliminar(m)}
                  deshabilitada={deshabilitada}
                  className="[&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[68px] [&:not(:first-child)]:before:z-[1] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
                >
                  <ContenidoMovimiento m={m} />
                </FilaDeslizable>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Tabla({ movimientos }: { movimientos: MovimientoApp[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-[20px] bg-card">
      <table className="w-full table-fixed text-left text-[15px]">
        <thead className="text-[13px] text-muted-foreground">
          <tr className="hairline-b">
            <th className="w-24 px-4 py-2.5 font-medium">Fecha</th>
            <th className="px-2 py-2.5 font-medium">Concepto</th>
            <th className="w-44 px-2 py-2.5 font-medium">Categoría</th>
            <th className="w-28 px-2 py-2.5 font-medium">Cuenta</th>
            <th className="w-36 px-4 py-2.5 text-right font-medium">Monto</th>
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => (
            <tr
              key={m.id}
              tabIndex={0}
              onClick={() => abrirDetalle(m)}
              onKeyDown={(e) => e.key === "Enter" && abrirDetalle(m)}
              className="fila-presionable cursor-pointer hairline-b last:shadow-none hover:bg-fill/60"
            >
              <td className="px-4 py-2.5 text-muted-foreground tabular">{diaCorto(m.fecha)}</td>
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate">{tituloDe(m)}</span>
                  <IconoOrigen origen={m.origen} />
                  {m.revisar ? <Badge variant="warning">Revisar</Badge> : null}
                </div>
              </td>
              <td className="truncate px-2 py-2.5 text-muted-foreground">{m.categoria ?? "Sin categoría"}</td>
              <td className="truncate px-2 py-2.5 text-muted-foreground">{cuentasDe(m)}</td>
              <td className="px-4 py-2.5 text-right">
                <Monto m={m} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Vacio({ titulo, texto, children }: { titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="mt-10 flex flex-col items-center px-6 text-center animate-entrar">
      <span aria-hidden className="flex size-16 items-center justify-center rounded-full bg-fill text-muted-foreground">
        <ReceiptText className="size-8" strokeWidth={1.6} />
      </span>
      <p className="mt-4 text-[20px] font-semibold tracking-tight">{titulo}</p>
      <p className="mt-1 max-w-[18rem] text-[15px] leading-snug text-balance text-muted-foreground">{texto}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}

function EsqueletoLista() {
  return (
    <div aria-busy className="space-y-6 pt-3">
      {[3, 2].map((n, i) => (
        <div key={i}>
          <Skeleton className="mb-2 ml-1 h-4 w-24" />
          <div className="overflow-hidden rounded-[20px] bg-card">
            {Array.from({ length: n }, (_, j) => (
              <div key={j} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3.5 w-2/5" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
