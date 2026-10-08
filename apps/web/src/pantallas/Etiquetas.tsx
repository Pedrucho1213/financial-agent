import { List, Mic, Plus, Sparkles, Tag, Trash } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pantalla } from "../components/Pantalla";
import { Spinner } from "../components/Spinner";
import { Button } from "../components/ui/button";
import { CampoFila } from "../components/ui/input";
import { Fila, FilaBoton, Grupo, TituloSeccion } from "../components/ui/lista";
import { Segmented } from "../components/ui/segmented";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { ErrorApi, mensajeDeError } from "../lib/api";
import { useEnLinea } from "../lib/conexion";
import { useYo } from "../lib/consultas";
import { type DatosEtiqueta, useBorrarEtiqueta, useEtiquetas, useGuardarEtiqueta } from "../lib/cuentas";
import { aFecha, diaCorto, dinero, hoyIso } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { hashDe, navegar, volver } from "../lib/ruta";
import { diasEntreFechas } from "../lib/saldos";
import type { Etiqueta } from "../lib/tipos";
import { cn } from "../lib/utils";

type Periodo = "este_mes" | "todo";
const MAX_DIAS = 92;

const sumar = (iso: string, dias: number) => {
  const f = aFecha(iso);
  f.setDate(f.getDate() + dias);
  return hoyIso(f);
};

/** Si se pone sola en los gastos hoy o más adelante. */
const vigente = (e: Etiqueta, hoy: string) => !!e.activaDesde && !!e.activaHasta && e.activaHasta >= hoy;

/** #etiquetas: marcas libres que cruzan categorías y cuentas, con lo que lleva cada una. */
export function Etiquetas({ params }: { params: URLSearchParams }) {
  const yo = useYo();
  const moneda = yo.data?.moneda ?? "MXN";
  const hoy = yo.data?.hoy ?? hoyIso();
  const periodo: Periodo = params.get("periodo") === "todo" ? "todo" : "este_mes";
  const etiquetas = useEtiquetas(periodo);
  const enLinea = useEnLinea();
  const [hoja, setHoja] = useState<Etiqueta | "nueva" | null>(null);

  const lista = etiquetas.data ?? [];
  const conGasto = lista.filter((e) => e.gastadoCentavos > 0).slice(0, 8);
  const tope = Math.max(1, ...conGasto.map((e) => e.gastadoCentavos));
  const activas = lista.filter((e) => vigente(e, hoy));
  const sinServidor = etiquetas.error instanceof ErrorApi && etiquetas.error.estado === 404;

  return (
    <Pantalla
      titulo="Etiquetas"
      atras={{ etiqueta: "Atrás", alTocar: () => volver("inicio") }}
      alRefrescar={() => etiquetas.refetch()}
    >
      {sinServidor ? (
        <Caja titulo="Aún no está en tu servidor" texto="Las etiquetas llegan con la próxima actualización de la Mac." />
      ) : etiquetas.isPending ? (
        <div aria-busy className="space-y-6 pt-2">
          <Skeleton className="h-8 w-full rounded-[9px] bg-card" />
          <Skeleton className="h-[220px] w-full rounded-[20px] bg-card" />
        </div>
      ) : etiquetas.isError && !etiquetas.data ? (
        <Caja titulo="No pudimos cargar tus etiquetas" texto={mensajeDeError(etiquetas.error)}>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => etiquetas.refetch()}>
            Reintentar
          </Button>
        </Caja>
      ) : (
        <div className="space-y-8 pt-2 pb-4">
          <Segmented<Periodo>
            etiqueta="Periodo"
            valor={periodo}
            onChange={(v) => navegar(hashDe("etiquetas", { periodo: v === "todo" ? "todo" : undefined }), { reemplazar: true })}
            opciones={[
              { valor: "este_mes", etiqueta: "Este mes" },
              { valor: "todo", etiqueta: "Siempre" },
            ]}
          />

          {activas.map((e) => (
            <button
              key={e.id}
              type="button"
              data-activa={e.nombre}
              onClick={() => setHoja(e)}
              className="fila-presionable flex w-full items-start gap-3 rounded-[20px] bg-tint/10 p-4 text-left"
            >
              <Sparkles aria-hidden className="mt-0.5 size-[18px] shrink-0 text-tint" />
              <span className="min-w-0 text-[15px] leading-snug">
                <span className="font-semibold">#{e.nombre}</span>{" "}
                {e.activaDesde! > hoy
                  ? `se pondrá sola en tus gastos del ${diaCorto(e.activaDesde!)} al ${diaCorto(e.activaHasta!)}.`
                  : `se pone sola en tus gastos hasta el ${diaCorto(e.activaHasta!)}.`}
              </span>
            </button>
          ))}

          {conGasto.length ? (
            <section aria-label="En qué se fue">
              <TituloSeccion>En qué se fue</TituloSeccion>
              <div className="rounded-[20px] bg-card p-4" data-grafica="etiquetas">
                <ul className="space-y-3">
                  {conGasto.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="fila-presionable block w-full text-left" onClick={() => setHoja(e)} data-barra-etiqueta={e.nombre}>
                        <span className="flex items-baseline justify-between gap-3 text-[15px]">
                          <span className="min-w-0 truncate">#{e.nombre}</span>
                          <span className="shrink-0 font-medium tabular">{dinero(e.gastadoCentavos, moneda)}</span>
                        </span>
                        <span className="mt-1 block h-2 overflow-hidden rounded-full bg-fill">
                          <span
                            className="block h-full origin-left animate-crecer-x rounded-full bg-tint"
                            style={{ width: `${Math.max(2, (e.gastadoCentavos / tope) * 100)}%` }}
                          />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Un gasto con dos etiquetas cuenta en las dos.
                </p>
              </div>
            </section>
          ) : null}

          <section>
            <TituloSeccion>{lista.length ? "Tus etiquetas" : "Sin etiquetas todavía"}</TituloSeccion>
            <Grupo
              pie={
                <span className="flex items-start gap-1.5">
                  <Mic className="mt-0.5 size-3.5 shrink-0" />
                  {lista.length
                    ? "Por voz: «etiqueta como viaje lo del fin de semana» o «activa la etiqueta viaje hasta el domingo»."
                    : "Cruzan categorías y cuentas: «viaje a Oaxaca», «trabajo», «deducible». Dile al Atajo «etiqueta como trabajo el Uber de hoy»."}
                </span>
              }
            >
              {lista.map((e) => (
                <FilaBoton
                  key={e.id}
                  sangria="4rem"
                  data-etiqueta={e.nombre}
                  icono={
                    <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", vigente(e, hoy) ? "bg-tint text-white" : "bg-tint/15 text-tint")}>
                      <Tag className="size-[18px]" strokeWidth={2.2} />
                    </span>
                  }
                  titulo={e.nombre}
                  subtitulo={<span className="block whitespace-normal">{lineaEtiqueta(e, periodo)}</span>}
                  valor={
                    e.gastadoCentavos || e.ingresadoCentavos ? (
                      <span className="block text-right tabular">
                        {e.gastadoCentavos ? <span className="block font-medium text-foreground">{dinero(e.gastadoCentavos, moneda)}</span> : null}
                        {e.ingresadoCentavos ? <span className="block text-[13px] text-positive">+{dinero(e.ingresadoCentavos, moneda)}</span> : null}
                      </span>
                    ) : undefined
                  }
                  chevron
                  onClick={() => setHoja(e)}
                />
              ))}
              <FilaBoton
                sangria="4rem"
                icono={
                  <span className="flex size-9 items-center justify-center">
                    <Plus className="size-5 text-tint" strokeWidth={2.5} />
                  </span>
                }
                titulo={<span className="text-tint">Nueva etiqueta</span>}
                disabled={!enLinea}
                onClick={() => setHoja("nueva")}
              />
            </Grupo>
          </section>
        </div>
      )}
      <HojaEtiqueta valor={hoja} hoy={hoy} alCerrar={() => setHoja(null)} />
    </Pantalla>
  );
}

function lineaEtiqueta(e: Etiqueta, periodo: Periodo) {
  if (!e.cantidad) return periodo === "este_mes" ? "Sin usar este mes" : "Sin usar todavía";
  const cuantos = `${e.cantidad} ${e.cantidad === 1 ? "movimiento" : "movimientos"}`;
  return e.ultimoUso ? `${cuantos} · último ${diaCorto(e.ultimoUso)}` : cuantos;
}

function Caja({ titulo, texto, children }: { titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="mt-6 rounded-[20px] bg-card px-6 py-10 text-center">
      <p className="text-[17px] font-semibold">{titulo}</p>
      <p className="mt-1 text-[15px] text-balance text-muted-foreground">{texto}</p>
      {children}
    </div>
  );
}

function HojaEtiqueta({ valor, hoy, alCerrar }: { valor: Etiqueta | "nueva" | null; hoy: string; alCerrar: () => void }) {
  const editando = valor && valor !== "nueva" ? valor : null;
  const guardar = useGuardarEtiqueta();
  const borrar = useBorrarEtiqueta();
  const enLinea = useEnLinea();
  const [nombre, setNombre] = useState("");
  const [activa, setActiva] = useState(false);
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(sumar(hoy, 6));

  const estabaActiva = !!editando && vigente(editando, hoy);
  useEffect(() => {
    if (!valor) return;
    setNombre(editando?.nombre ?? "");
    setActiva(estabaActiva);
    setDesde(estabaActiva ? editando!.activaDesde! : hoy);
    setHasta(estabaActiva ? editando!.activaHasta! : sumar(hoy, 6));
  }, [valor]);

  const dias = diasEntreFechas(desde, hasta);
  const fechasMal = activa && (dias < 0 || dias > MAX_DIAS);
  const listo = nombre.trim().length > 0 && !fechasMal && enLinea && !guardar.isPending;

  const enviar = async () => {
    if (!listo) return;
    const datos: DatosEtiqueta = {};
    if (!editando || nombre.trim() !== editando.nombre) datos.nombre = nombre.trim();
    if (activa && (!estabaActiva || desde !== editando?.activaDesde || hasta !== editando?.activaHasta)) {
      datos.activa_desde = desde;
      datos.activa_hasta = hasta;
    } else if (!activa && estabaActiva) datos.activa_hasta = null;
    if (editando && !Object.keys(datos).length) {
      alCerrar();
      return;
    }
    try {
      const e = await guardar.mutateAsync({ id: editando?.id, datos });
      haptico();
      toast.success(editando ? "Etiqueta actualizada" : `Creé #${e?.nombre ?? nombre.trim()}`);
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  const eliminar = async () => {
    if (!editando) return;
    if (!window.confirm(`¿Eliminar #${editando.nombre}? Se quita de sus movimientos; los movimientos se quedan.`)) return;
    try {
      await borrar.mutateAsync(editando.id);
      haptico();
      toast.success(`Eliminé #${editando.nombre}`);
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  return (
    <Sheet open={!!valor} onOpenChange={(v) => !v && alCerrar()}>
      {valor ? (
        <SheetContent
          titulo={editando ? `#${editando.nombre}` : "Nueva etiqueta"}
          descripcion={editando ? "Edita la etiqueta" : "Crea una etiqueta"}
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {guardar.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : editando ? "Guardar" : "Crear"}
            </Button>
          }
        >
          <form
            className="space-y-6 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <Grupo>
              <Fila>
                <label htmlFor="etiqueta-nombre" className="shrink-0">
                  Nombre
                </label>
                <CampoFila
                  id="etiqueta-nombre"
                  value={nombre}
                  maxLength={40}
                  onChange={(e) => setNombre(e.target.value.replace(/^#+/, ""))}
                  placeholder="viaje, trabajo, deducible…"
                  autoCapitalize="none"
                  autoFocus={!editando}
                />
              </Fila>
            </Grupo>

            <Grupo
              pie={
                fechasMal ? (
                  <span className="text-negative">
                    {dias < 0 ? "La fecha final es antes de la de inicio." : `Se activa por ${MAX_DIAS} días como máximo.`}
                  </span>
                ) : activa ? (
                  "Tus gastos de esos días la llevan solos, también los que ya anotaste."
                ) : (
                  "Útil para un viaje o una temporada: todo lo de esos días queda etiquetado."
                )
              }
            >
              <Fila>
                <label htmlFor="etiqueta-activa" className="min-w-0 flex-1">
                  Ponerla sola en mis gastos
                </label>
                <Switch id="etiqueta-activa" checked={activa} onCheckedChange={setActiva} />
              </Fila>
              {activa ? (
                <>
                  <CampoFecha id="etiqueta-desde" etiqueta="Desde" valor={desde} onCambio={setDesde} />
                  <CampoFecha id="etiqueta-hasta" etiqueta="Hasta" valor={hasta} onCambio={setHasta} />
                </>
              ) : null}
            </Grupo>

            {editando ? (
              <Grupo>
                <FilaBoton
                  icono={<List className="size-[18px] text-tint" />}
                  titulo="Ver sus movimientos"
                  chevron
                  onClick={() => {
                    alCerrar();
                    navegar(hashDe("movimientos", { etiqueta: editando.id, mes: "todo" }));
                  }}
                />
                <FilaBoton className="justify-center text-destructive" disabled={!enLinea || borrar.isPending} onClick={() => void eliminar()}>
                  <Trash className="size-[18px]" />
                  <span>Eliminar etiqueta</span>
                </FilaBoton>
              </Grupo>
            ) : null}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function CampoFecha({ id, etiqueta, valor, onCambio }: { id: string; etiqueta: string; valor: string; onCambio: (v: string) => void }) {
  return (
    <Fila>
      <label htmlFor={id} className="shrink-0">
        {etiqueta}
      </label>
      <div className="relative ml-auto">
        <span className="pointer-events-none flex h-[34px] items-center rounded-lg bg-fill px-3 text-[17px] text-foreground tabular">
          {aFecha(valor).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }).replace(".", "")}
        </span>
        <input
          id={id}
          type="date"
          required
          value={valor}
          max="2099-12-31"
          onChange={(e) => e.target.value && onCambio(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </Fila>
  );
}
