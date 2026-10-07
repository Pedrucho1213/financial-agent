import { ChevronDown, CreditCard, FileDown, Mic, ReceiptText, Smartphone, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { FilaDeslizable } from "../components/FilaDeslizable";
import { Pantalla } from "../components/Pantalla";
import { Spinner } from "../components/Spinner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Buscador } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { SelectNativo } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { eliminarConDeshacer } from "../lib/acciones";
import { mensajeDeError } from "../lib/api";
import { IconoCategoria, OpcionesCategorias } from "../lib/categorias";
import { useEnLinea } from "../lib/conexion";
import { type FiltrosMovimientos, useCategorias, useMovimientos } from "../lib/consultas";
import { abrirEditor } from "../lib/editor";
import { diaCorto, dinero, mesActual, nombreDia, nombreMes, sumarMeses, TIPOS } from "../lib/formato";
import { useMedia } from "../lib/medios";
import { hashDe, navegar } from "../lib/ruta";
import type { MovimientoApp, Origen, TipoMovimiento } from "../lib/tipos";
import { cn } from "../lib/utils";

const TIPOS_VALIDOS: TipoMovimiento[] = ["gasto", "ingreso", "transferencia", "pago_tarjeta"];
const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

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

  const actualizar = (cambios: Record<string, string | undefined>) => {
    const actual: Record<string, string | undefined> = {
      mes: mes === mesActual() ? undefined : mes,
      tipo,
      categoria,
      q: q || undefined,
      revisar: revisar ? "1" : undefined,
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
    () => ({ mes, tipo, categoria, texto: q || undefined, revisar: revisar || undefined }),
    [mes, tipo, categoria, q, revisar],
  );
  const consulta = useMovimientos(filtros);
  const categorias = useCategorias();

  const movimientos = useMemo(() => consulta.data?.pages.flatMap((p) => p.movimientos) ?? [], [consulta.data]);
  const total = consulta.data?.pages.at(-1)?.total ?? 0;
  const conFiltros = !!(tipo || categoria || q || revisar || pedido === "todo");
  const nombreCategoria = categorias.data?.find((c) => c.id === categoria)?.nombre;

  const meses = useMemo(() => Array.from({ length: 24 }, (_, i) => sumarMeses(mesActual(), -i)), []);
  const tipoCategorias = tipo === "gasto" || tipo === "ingreso" ? tipo : undefined;

  return (
    <Pantalla titulo="Movimientos" alRefrescar={() => consulta.refetch()}>
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
        <div data-sin-jalar className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <SelectNativo
            className="shrink-0"
            aria-label="Mes"
            value={mes}
            onChange={(e) => actualizar({ mes: e.target.value === mesActual() ? undefined : e.target.value })}
            opciones={
              <>
                <option value="todo">Todo</option>
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {nombreMes(m)}
                  </option>
                ))}
              </>
            }
          >
            <Chip activo={mes !== mesActual()}>
              {mes === "todo" ? "Todo" : nombreMes(mes)}
              <ChevronDown className="size-4" strokeWidth={2.5} />
            </Chip>
          </SelectNativo>
          <SelectNativo
            className="shrink-0"
            aria-label="Categoría"
            value={categoria ?? ""}
            onChange={(e) => actualizar({ categoria: e.target.value || undefined })}
            opciones={
              <>
                <option value="">Todas las categorías</option>
                <OpcionesCategorias categorias={categorias.data ?? []} tipo={tipoCategorias} paraFiltrar />
              </>
            }
          >
            <Chip activo={!!categoria}>
              {nombreCategoria ?? "Categoría"}
              <ChevronDown className="size-4" strokeWidth={2.5} />
            </Chip>
          </SelectNativo>
          <button type="button" className="shrink-0" aria-pressed={revisar} onClick={() => actualizar({ revisar: revisar ? undefined : "1" })}>
            <Chip activo={revisar}>Por revisar</Chip>
          </button>
          {tipo && tipo !== "gasto" && tipo !== "ingreso" ? (
            <button type="button" className="shrink-0" onClick={() => actualizar({ tipo: undefined })} aria-label={`Quitar filtro ${TIPOS[tipo]}`}>
              <Chip activo>
                {TIPOS[tipo]}
                <X className="size-4" strokeWidth={2.5} />
              </Chip>
            </button>
          ) : null}
        </div>
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
            <ListaPorDia movimientos={movimientos} alEliminar={(m) => void eliminarConDeshacer(m)} deshabilitada={!enLinea} />
          )}
          {consulta.hasNextPage ? (
            <Button
              variant="gray"
              size="lg"
              className="mt-4"
              disabled={consulta.isFetchingNextPage}
              onClick={() => consulta.fetchNextPage()}
            >
              {consulta.isFetchingNextPage ? <Spinner /> : `Cargar más (${total - movimientos.length})`}
            </Button>
          ) : null}
        </>
      )}
    </Pantalla>
  );
}

function Chip({ activo, children }: { activo?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex h-[34px] shrink-0 items-center gap-1 rounded-full px-3.5 text-[15px] font-medium whitespace-nowrap transition-colors",
        activo ? "bg-primary/15 text-tint" : "bg-card text-foreground",
      )}
    >
      {children}
    </span>
  );
}

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

function tituloDe(m: MovimientoApp) {
  return m.comercio ?? m.descripcion ?? m.categoria?.split(">").pop()?.trim() ?? TIPOS[m.tipo] ?? "Movimiento";
}

function subtituloDe(m: MovimientoApp) {
  const categoria = m.categoria?.split(">").pop()?.trim() ?? (m.tipo === "gasto" ? "Sin categoría" : TIPOS[m.tipo]);
  return m.cuenta ? `${categoria} · ${m.cuenta}` : categoria;
}

function ListaPorDia({
  movimientos,
  alEliminar,
  deshabilitada,
}: {
  movimientos: MovimientoApp[];
  alEliminar: (m: MovimientoApp) => void;
  deshabilitada: boolean;
}) {
  const dias = useMemo(() => {
    const grupos = new Map<string, MovimientoApp[]>();
    for (const m of movimientos) {
      const lista = grupos.get(m.fecha);
      if (lista) lista.push(m);
      else grupos.set(m.fecha, [m]);
    }
    return [...grupos.entries()];
  }, [movimientos]);

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
            <div className="overflow-hidden rounded-xl bg-card">
              {lista.map((m) => (
                <FilaDeslizable
                  key={m.id}
                  etiqueta={`${tituloDe(m)}, ${dinero(Math.abs(m.montoCentavos), m.moneda)}`}
                  alTocar={() => abrirEditor(m)}
                  alEliminar={() => alEliminar(m)}
                  deshabilitada={deshabilitada}
                  className="[&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-16 [&:not(:first-child)]:before:z-[1] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
                >
                  <div className="flex min-h-[62px] items-center gap-3 px-4 py-2" data-movimiento={m.id}>
                    <IconoCategoria nombre={m.categoria} tipo={m.tipo} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[17px]">{tituloDe(m)}</span>
                        <IconoOrigen origen={m.origen} />
                      </div>
                      <div className="truncate text-[15px] text-muted-foreground">{subtituloDe(m)}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Monto m={m} className="text-[17px]" />
                      {m.revisar ? <Badge variant="warning">Revisar</Badge> : null}
                    </div>
                  </div>
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
    <div className="mt-3 overflow-hidden rounded-xl bg-card">
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
              onClick={() => abrirEditor(m)}
              onKeyDown={(e) => e.key === "Enter" && abrirEditor(m)}
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
              <td className="truncate px-2 py-2.5 text-muted-foreground">{m.cuenta ?? ""}</td>
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
          <div className="overflow-hidden rounded-xl bg-card">
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
