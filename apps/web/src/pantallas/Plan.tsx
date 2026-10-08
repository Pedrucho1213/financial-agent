import { Mic, Plus, Target, Trash2, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type Anillo, Anillos } from "../components/Anillos";
import { CampoMonto } from "../components/CampoMonto";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { Fila, FilaBoton, Grupo, TituloSeccion } from "../components/ui/lista";
import { SelectNativo } from "../components/ui/select";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { ErrorApi, mensajeDeError } from "../lib/api";
import { OpcionesCategorias } from "../lib/categorias";
import { useEnLinea } from "../lib/conexion";
import { useCategorias, useYo } from "../lib/consultas";
import { aFecha, diasHasta, dinero, dineroCorto, hoyIso, leerMonto, nombreMes, pct, rangoDelMes } from "../lib/formato";
import { haptico } from "../lib/haptico";
import {
  useAportarMeta,
  useBorrarMeta,
  useBorrarPresupuesto,
  useDisponible,
  useGuardarMeta,
  useGuardarPresupuesto,
  useMetas,
  useMsi,
  usePrestamos,
  usePresupuestos,
} from "../lib/plan";
import { volver } from "../lib/ruta";
import type { ComprasMsi, Disponible, Meta, Prestamos as PrestamosApi, Presupuesto, Presupuestos } from "../lib/tipos";
import { cn } from "../lib/utils";

const fDia = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

const COLOR_ESTADO: Record<Presupuesto["estado"], string> = {
  bien: "var(--positive)",
  cerca: "var(--orange)",
  excedido: "var(--negative)",
};

/** Sin ",00" cuando son pesos cerrados (se lee mejor y cabe), pero sin redondear centavos. */
const pesos = (centavos: number, moneda: string) => dineroCorto(centavos, moneda);

/**
 * "Quedan $1,627.81 de $1,500.51": si no cabe, parte entre palabras en vez de cortar el tope (QA-073). Solo los
 * montos van sin partir, para que ninguno pierda dígitos ni a 320 px (QA-076).
 */
function DeTotal({ antes, parte, total }: { antes?: string; parte: string; total: string }) {
  return (
    <>
      {antes ? `${antes} ` : null}
      <span className="whitespace-nowrap">{parte}</span> de <span className="whitespace-nowrap">{total}</span>
    </>
  );
}

/** El subtítulo de una fila se corta en una línea; estos llevan montos que no deben perderse. */
const enVariasLineas = (contenido: ReactNode) => <span className="block whitespace-normal">{contenido}</span>;

const nombrePresupuesto = (p: Presupuesto) =>
  p.categoriaId === null ? "Todo el mes" : (p.categoria?.replace(/ > /g, " › ") ?? "Categoría");

/** Presupuestos del mes y metas de ahorro, con anillos como Actividad. */
export function Plan({ params }: { params: URLSearchParams }) {
  const yo = useYo();
  const hoy = yo.data?.hoy ?? hoyIso();
  const mes = hoy.slice(0, 7);
  const presupuestos = usePresupuestos(mes);
  const metas = useMetas();
  const disponible = useDisponible();
  const prestamos = usePrestamos();
  const msi = useMsi();
  const enLinea = useEnLinea();
  const [hojaPresupuesto, setHojaPresupuesto] = useState<Presupuesto | "nuevo" | null>(null);
  const [hojaMeta, setHojaMeta] = useState<Meta | "nueva" | null>(null);

  const moneda = yo.data?.moneda ?? "MXN";
  const lista = presupuestos.data?.presupuestos ?? [];
  const listaMetas = metas.data?.metas ?? [];
  const cargando = presupuestos.isPending || metas.isPending;
  // Un servidor sin presupuestos (404) todavía no se actualizó.
  const sinPlan = presupuestos.error instanceof ErrorApi && presupuestos.error.estado === 404;

  // Un aviso de metas (#metas) baja directo a esa sección.
  const seccionMetas = useRef<HTMLElement>(null);
  const irAMetas = params.get("seccion") === "metas" && !cargando;
  useEffect(() => {
    if (irAMetas) seccionMetas.current?.scrollIntoView({ block: "start" });
  }, [irAMetas]);

  return (
    <Pantalla
      titulo="Presupuestos y metas"
      tituloCompacto="Plan"
      atras={{ etiqueta: "Inicio", alTocar: () => volver("inicio") }}
      alRefrescar={() =>
        Promise.all([presupuestos.refetch(), metas.refetch(), disponible.refetch(), prestamos.refetch(), msi.refetch()])
      }
    >
      {sinPlan ? (
        <div className="mt-6 rounded-[20px] bg-card px-6 py-10 text-center">
          <p className="text-[17px] font-semibold">Aún no está en tu servidor</p>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Los presupuestos y las metas llegan con la próxima actualización de la Mac.
          </p>
        </div>
      ) : (
        <div className="space-y-8 pt-2 pb-4">
          {cargando ? (
            <Skeleton className="h-[200px] w-full rounded-[20px] bg-card" />
          ) : (
            <Resumen hoy={hoy} mes={mes} moneda={moneda} presupuestos={presupuestos.data} metas={listaMetas} />
          )}

          {disponible.data?.base ? <TarjetaDisponible d={disponible.data} moneda={moneda} /> : null}

          <section>
            <TituloSeccion>Presupuestos de {nombreMes(mes, false).toLowerCase()}</TituloSeccion>
            {presupuestos.isError && !presupuestos.data ? (
              <Error texto={mensajeDeError(presupuestos.error)} alReintentar={() => presupuestos.refetch()} />
            ) : (
              <Grupo
                pie={
                  lista.length ? undefined : (
                    <span className="flex items-start gap-1.5">
                      <Mic className="mt-0.5 size-3.5 shrink-0" /> También por voz: «ponme un tope de 3,000 en comida».
                    </span>
                  )
                }
              >
                {cargando ? <Skeleton className="m-4 h-10" /> : null}
                {lista.map((p) => {
                  const color = COLOR_ESTADO[p.estado];
                  const nombre = nombrePresupuesto(p);
                  return (
                    <FilaBoton
                      key={p.id}
                      sangria="4rem"
                      icono={<Anillos tamano={36} grosor={6} anillos={[{ progreso: p.porcentaje / 100, color, etiqueta: nombre }]} />}
                      titulo={nombre}
                      subtitulo={subtituloPresupuesto(p, moneda)}
                      valor={<span className="font-medium tabular" style={{ color }}>{p.porcentaje}%</span>}
                      chevron
                      onClick={() => setHojaPresupuesto(p)}
                    />
                  );
                })}
                <FilaBoton
                  sangria="4rem"
                  icono={
                    <span className="flex size-9 items-center justify-center">
                      <Plus className="size-5 text-tint" strokeWidth={2.5} />
                    </span>
                  }
                  titulo={<span className="text-tint">Agregar presupuesto</span>}
                  disabled={!enLinea}
                  onClick={() => setHojaPresupuesto("nuevo")}
                />
              </Grupo>
            )}
          </section>

          <section ref={seccionMetas} className="scroll-mt-16">
            <TituloSeccion>Metas de ahorro</TituloSeccion>
            {metas.isError && !metas.data ? (
              <Error texto={mensajeDeError(metas.error)} alReintentar={() => metas.refetch()} />
            ) : (
              <Grupo
                pie={
                  listaMetas.length ? undefined : (
                    <span className="flex items-start gap-1.5">
                      <Mic className="mt-0.5 size-3.5 shrink-0" /> O dile al Atajo: «quiero juntar 20 mil para diciembre».
                    </span>
                  )
                }
              >
                {listaMetas.map((m) => (
                  <FilaBoton
                    key={m.id}
                    sangria="4rem"
                    icono={
                      <Anillos
                        tamano={36}
                        grosor={6}
                        anillos={[{ progreso: m.porcentaje / 100, color: "var(--anillo-meta)", etiqueta: m.nombre }]}
                      />
                    }
                    titulo={m.nombre}
                    subtitulo={subtituloMeta(m, hoy, moneda)}
                    valor={<span className="font-medium text-foreground tabular">{Math.min(100, m.porcentaje)}%</span>}
                    chevron
                    onClick={() => setHojaMeta(m)}
                  />
                ))}
                <FilaBoton
                  sangria="4rem"
                  icono={
                    <span className="flex size-9 items-center justify-center">
                      <Plus className="size-5 text-tint" strokeWidth={2.5} />
                    </span>
                  }
                  titulo={<span className="text-tint">Nueva meta</span>}
                  disabled={!enLinea}
                  onClick={() => setHojaMeta("nueva")}
                />
              </Grupo>
            )}
          </section>

          <Prestamos datos={prestamos.data} moneda={moneda} />
          <Msi datos={msi.data} moneda={moneda} />
        </div>
      )}

      <HojaPresupuesto valor={hojaPresupuesto} moneda={moneda} existentes={lista} alCerrar={() => setHojaPresupuesto(null)} />
      <HojaMeta valor={hojaMeta} moneda={moneda} hoy={hoy} alCerrar={() => setHojaMeta(null)} />
    </Pantalla>
  );
}

function subtituloPresupuesto(p: Presupuesto, moneda: string): ReactNode {
  if (p.restanteCentavos < 0) return <span className="text-negative">Te pasaste {dinero(-p.restanteCentavos, moneda)}</span>;
  const base = <DeTotal antes="Quedan" parte={pesos(p.restanteCentavos, moneda)} total={pesos(p.limiteCentavos, moneda)} />;
  // Solo se avisa del ritmo cuando de verdad no alcanza.
  if (p.proyeccionCentavos > p.limiteCentavos)
    return enVariasLineas(
      <>
        {base} · <span className="text-orange">al ritmo de hoy, {pesos(p.proyeccionCentavos, moneda)}</span>
      </>,
    );
  return enVariasLineas(base);
}

function subtituloMeta(m: Meta, hoy: string, moneda: string) {
  if (m.completada) return enVariasLineas(`¡Lograda! ${dinero(m.ahorradoCentavos, moneda)}`);
  const base = <DeTotal parte={pesos(m.ahorradoCentavos, moneda)} total={pesos(m.objetivoCentavos, moneda)} />;
  if (!m.fechaLimite) return enVariasLineas(base);
  if (diasHasta(m.fechaLimite, hoy) <= 0) return enVariasLineas(<>{base} · venció</>);
  return enVariasLineas(m.mensualSugeridoCentavos ? <>{base} · {pesos(m.mensualSugeridoCentavos, moneda)}/mes</> : base);
}

const fCorto = (iso: string) => fDia.format(aFecha(iso)).replace(".", "");

/** "¿Cuánto puedo gastar hoy?", lo mismo que contesta la voz. */
function TarjetaDisponible({ d, moneda }: { d: Disponible; moneda: string }) {
  const sobra = d.disponibleHoyCentavos > 0;
  return (
    <section aria-label="Disponible hoy" className="flex items-center gap-3.5 rounded-[20px] bg-card p-4">
      <span
        aria-hidden
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          sobra ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative",
        )}
      >
        <Wallet className="size-[22px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-muted-foreground">Hoy puedes gastar</p>
        <p className={cn("text-[28px] leading-8 font-bold tracking-[-0.02em] tabular", !sobra && "text-negative")}>
          {dinero(Math.max(0, d.disponibleHoyCentavos), moneda)}
        </p>
        <p className="text-[13px] leading-snug text-muted-foreground">
          {sobra
            ? `${dinero(d.porDiaCentavos, moneda)} al día los próximos ${d.diasRestantes} ${d.diasRestantes === 1 ? "día" : "días"}`
            : "Ya usaste lo de este mes"}
          {d.comprometidoCentavos > 0 ? `, sin contar ${dinero(d.comprometidoCentavos, moneda)} de pagos fijos.` : "."}
        </p>
      </div>
    </section>
  );
}

function Prestamos({ datos, moneda }: { datos: PrestamosApi | undefined; moneda: string }) {
  const pendientes = datos?.prestamos.filter((p) => !p.saldadoEn) ?? [];
  if (!datos || !pendientes.length) return null;
  const pie = [
    datos.meDebenCentavos > 0 ? `Te deben ${dinero(datos.meDebenCentavos, moneda)}` : null,
    datos.deboCentavos > 0 ? `debes ${dinero(datos.deboCentavos, moneda)}` : null,
  ]
    .filter(Boolean)
    .join(" y ");
  return (
    <section>
      <TituloSeccion>Préstamos</TituloSeccion>
      <Grupo
        pie={
          <span className="flex items-start gap-1.5">
            <Mic className="mt-0.5 size-3.5 shrink-0" /> {pie ? `${pie[0]?.toUpperCase()}${pie.slice(1)}. ` : ""}Para abonar, díselo al Atajo: «Juan me pagó 200».
          </span>
        }
      >
        {pendientes.map((p) => (
          <Fila
            key={p.id}
            titulo={p.persona}
            subtitulo={`${p.direccion === "me_deben" ? "Te debe" : "Le debes"}${p.descripcion ? ` · ${p.descripcion}` : ""}`}
            valor={
              <span className={cn("font-medium tabular", p.direccion === "me_deben" ? "text-positive" : "text-foreground")}>
                {dinero(p.pendienteCentavos, moneda)}
              </span>
            }
          />
        ))}
      </Grupo>
    </section>
  );
}

function Msi({ datos, moneda }: { datos: ComprasMsi | undefined; moneda: string }) {
  const activas = datos?.compras.filter((c) => c.restanteCentavos > 0) ?? [];
  if (!datos || !activas.length) return null;
  return (
    <section>
      <TituloSeccion>Meses sin intereses</TituloSeccion>
      <Grupo pie={`Pagas ${dinero(datos.mensualCentavos, moneda)} al mes en total.`}>
        {activas.map((c) => (
          <Fila
            key={c.id}
            titulo={c.descripcion}
            subtitulo={
              c.proximoCargo
                ? `Pago ${Math.min(c.pagadas + 1, c.meses)} de ${c.meses} el ${fCorto(c.proximoCargo)}`
                : `${c.pagadas} de ${c.meses} pagos`
            }
            valor={
              <span className="text-right">
                <span className="block font-medium text-foreground tabular">{dinero(c.proximoMontoCentavos ?? c.mensualidadCentavos, moneda)}</span>
                <span className="block text-[13px] tabular">faltan {dinero(c.restanteCentavos, moneda)}</span>
              </span>
            }
          />
        ))}
      </Grupo>
    </section>
  );
}

/** Los tres anillos: gasto contra presupuesto, cuánto va del mes y metas. */
function Resumen({
  hoy,
  mes,
  moneda,
  presupuestos,
  metas,
}: {
  hoy: string;
  mes: string;
  moneda: string;
  presupuestos: Presupuestos | undefined;
  metas: Meta[];
}) {
  const limite = presupuestos?.total.limiteCentavos ?? 0;
  const gastado = presupuestos?.total.gastadoCentavos ?? 0;
  const diasMes = presupuestos?.diasDelMes ?? Number(rangoDelMes(mes).hasta.slice(8, 10));
  const dia = presupuestos?.diaDelMes ?? Number(hoy.slice(8, 10));
  const objetivo = metas.reduce((s, m) => s + m.objetivoCentavos, 0);
  const ahorrado = metas.reduce((s, m) => s + Math.min(m.ahorradoCentavos, m.objetivoCentavos), 0);

  const usoGasto = limite > 0 ? gastado / limite : 0;
  const usoMes = dia / diasMes;
  const usoMetas = objetivo > 0 ? ahorrado / objetivo : 0;
  const anillos: Anillo[] = [
    { progreso: usoGasto, color: "var(--anillo-gasto)", etiqueta: "Gastado del presupuesto" },
    { progreso: usoMes, color: "var(--anillo-mes)", etiqueta: "Mes transcurrido" },
    { progreso: usoMetas, color: "var(--anillo-meta)", etiqueta: "Metas" },
  ];

  let consejo: ReactNode;
  if (limite <= 0) consejo = "Ponle un tope al mes y el anillo rojo te dirá si vas más rápido que el calendario.";
  else if (usoGasto > 1) consejo = `Ya pasaste tu presupuesto por ${dinero(gastado - limite, moneda)}.`;
  else if (usoGasto > usoMes + 0.1)
    consejo = `Vas más rápido que el mes: llevas ${pct(usoGasto)} del presupuesto y apenas ${pct(usoMes)} del mes.`;
  else consejo = `Vas a buen ritmo: ${pct(usoGasto)} del presupuesto con ${pct(usoMes)} del mes.`;

  return (
    <section aria-label="Resumen del plan" className="rounded-[20px] bg-card p-4">
      <div className="flex items-center gap-4">
        <Anillos anillos={anillos} tamano={132} grosor={15} separacion={3} />
        <dl className="min-w-0 flex-1 space-y-2.5">
          <Leyenda color="var(--anillo-gasto)" titulo="Gastado">
            {limite > 0 ? <DeTotal parte={pesos(gastado, moneda)} total={pesos(limite, moneda)} /> : "Sin presupuesto"}
          </Leyenda>
          <Leyenda color="var(--anillo-mes)" titulo="Mes">
            Día {dia} de {diasMes}
          </Leyenda>
          <Leyenda color="var(--anillo-meta)" titulo="Metas">
            {objetivo > 0 ? <DeTotal parte={pesos(ahorrado, moneda)} total={pesos(objetivo, moneda)} /> : "Sin metas"}
          </Leyenda>
        </dl>
      </div>
      <p className="mt-3 pt-3 text-[15px] leading-snug text-muted-foreground hairline-t">{consejo}</p>
    </section>
  );
}

function Leyenda({ color, titulo, children }: { color: string; titulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-semibold" style={{ color }}>
        {titulo}
      </dt>
      <dd className="text-[15px] leading-tight font-semibold tabular">{children}</dd>
    </div>
  );
}

function Error({ texto, alReintentar }: { texto: string; alReintentar: () => void }) {
  return (
    <div className="rounded-[20px] bg-card px-6 py-8 text-center">
      <p className="text-[17px] font-semibold">No pudimos cargar esto</p>
      <p className="mt-1 text-[15px] text-muted-foreground">{texto}</p>
      <Button variant="tinted" size="sm" className="mt-4" onClick={alReintentar}>
        Reintentar
      </Button>
    </div>
  );
}

function HojaPresupuesto({
  valor,
  moneda,
  existentes,
  alCerrar,
}: {
  valor: Presupuesto | "nuevo" | null;
  moneda: string;
  existentes: Presupuesto[];
  alCerrar: () => void;
}) {
  const editando = valor && valor !== "nuevo" ? valor : null;
  const categorias = useCategorias();
  const guardar = useGuardarPresupuesto();
  const borrar = useBorrarPresupuesto();
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState("");

  useEffect(() => {
    if (!valor) return;
    setMonto(editando ? String(editando.limiteCentavos / 100) : "");
    setCategoria(editando?.categoriaId ?? "");
  }, [valor, editando]);

  const n = leerMonto(monto);
  const repetido = !editando && existentes.some((p) => (p.categoriaId ?? "") === categoria);
  const listo = n !== null && !repetido && !guardar.isPending;

  const enviar = async () => {
    if (!listo || n === null) return;
    try {
      await guardar.mutateAsync({ categoriaId: editando ? editando.categoriaId : categoria || null, limite: n });
      haptico();
      toast.success(editando ? "Presupuesto actualizado" : "Presupuesto creado");
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  return (
    <Sheet open={!!valor} onOpenChange={(v) => !v && alCerrar()}>
      {valor ? (
        <SheetContent
          titulo={editando ? nombrePresupuesto(editando) : "Nuevo presupuesto"}
          descripcion="Tope de gasto para el mes"
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {editando ? "Guardar" : "Crear"}
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
            <CampoMonto id="monto-presupuesto" valor={monto} onCambio={setMonto} moneda={moneda} enfocar={!editando} />
            {editando ? null : (
              <Grupo pie={repetido ? <span className="text-negative">Ya tienes un presupuesto para eso.</span> : "Sin categoría es el tope de todo el mes."}>
                <Fila>
                  <label htmlFor="categoria-presupuesto" className="shrink-0">
                    Para
                  </label>
                  <SelectNativo
                    id="categoria-presupuesto"
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    className="min-w-0 flex-1"
                    opciones={
                      <>
                        <option value="">Todo el mes</option>
                        <OpcionesCategorias categorias={categorias.data ?? []} tipo="gasto" paraFiltrar />
                      </>
                    }
                  >
                    <span className="block truncate text-right text-[17px] text-muted-foreground">
                      {categoria ? (categorias.data?.find((c) => c.id === categoria)?.nombre ?? "Categoría") : "Todo el mes"}
                    </span>
                  </SelectNativo>
                </Fila>
              </Grupo>
            )}
            {editando ? (
              <Grupo>
                <FilaBoton
                  icono={<Trash2 aria-hidden className="size-5 text-destructive" />}
                  sangria="3.4rem"
                  titulo={<span className="text-destructive">Quitar presupuesto</span>}
                  disabled={borrar.isPending}
                  onClick={async () => {
                    try {
                      await borrar.mutateAsync(editando.id);
                      toast("Presupuesto quitado");
                      alCerrar();
                    } catch (error) {
                      toast.error(mensajeDeError(error));
                    }
                  }}
                />
              </Grupo>
            ) : null}
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function HojaMeta({ valor, moneda, hoy, alCerrar }: { valor: Meta | "nueva" | null; moneda: string; hoy: string; alCerrar: () => void }) {
  const meta = valor && valor !== "nueva" ? valor : null;
  const guardar = useGuardarMeta();
  const aportar = useAportarMeta();
  const borrar = useBorrarMeta();
  const [nombre, setNombre] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [fecha, setFecha] = useState("");
  const [aporte, setAporte] = useState("");

  useEffect(() => {
    if (!valor) return;
    setNombre(meta?.nombre ?? "");
    setObjetivo(meta ? String(meta.objetivoCentavos / 100) : "");
    setFecha(meta?.fechaLimite ?? "");
    setAporte("");
  }, [valor, meta]);

  const nObjetivo = leerMonto(objetivo);
  const cambioDatos =
    !meta || nombre.trim() !== meta.nombre || nObjetivo !== meta.objetivoCentavos / 100 || (fecha || null) !== meta.fechaLimite;
  const listo = !!nombre.trim() && nObjetivo !== null && cambioDatos && !guardar.isPending;

  const enviar = async () => {
    if (!listo || nObjetivo === null) return;
    try {
      await guardar.mutateAsync({ id: meta?.id, nombre: nombre.trim(), objetivo: nObjetivo, fechaLimite: fecha || null });
      haptico();
      toast.success(meta ? "Meta actualizada" : "Meta creada");
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  const mover = async (signo: 1 | -1) => {
    const n = leerMonto(aporte);
    if (!meta || n === null) return;
    try {
      await aportar.mutateAsync({ id: meta.id, monto: n * signo });
      haptico();
      toast.success(signo > 0 ? `Apartaste ${dinero(n * 100, moneda)} para ${meta.nombre}` : `Sacaste ${dinero(n * 100, moneda)}`);
      setAporte("");
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  return (
    <Sheet open={!!valor} onOpenChange={(v) => !v && alCerrar()}>
      {valor ? (
        <SheetContent
          titulo={meta ? meta.nombre : "Nueva meta"}
          descripcion="Meta de ahorro"
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {meta ? "Guardar" : "Crear"}
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
            {meta ? (
              <div className="flex flex-col items-center pt-2">
                <Anillos
                  tamano={120}
                  grosor={16}
                  anillos={[{ progreso: meta.porcentaje / 100, color: "var(--anillo-meta)", etiqueta: meta.nombre }]}
                />
                <p className="mt-3 text-[22px] font-bold tabular">
                  {dinero(meta.ahorradoCentavos, moneda)}{" "}
                  <span className="text-[15px] font-medium text-muted-foreground">de {dinero(meta.objetivoCentavos, moneda)}</span>
                </p>
                {meta.fechaLimite ? (
                  <p className="text-[13px] text-muted-foreground">Para el {fDia.format(aFecha(meta.fechaLimite)).replace(".", "")}</p>
                ) : null}
              </div>
            ) : null}

            {meta ? (
              <Grupo titulo="Apartar o sacar dinero">
                <Fila>
                  <label htmlFor="monto-aporte" className="shrink-0">
                    Monto
                  </label>
                  <input
                    id="monto-aporte"
                    inputMode="decimal"
                    placeholder="$0"
                    value={aporte}
                    onChange={(e) => setAporte(e.target.value.replace(/[^\d.,]/g, "").slice(0, 12))}
                    className="h-11 w-full min-w-0 bg-transparent text-right text-[17px] outline-none placeholder:text-placeholder"
                  />
                </Fila>
                <div className="grid grid-cols-2 gap-2 p-3 pt-1">
                  <Button variant="tinted" size="sm" disabled={leerMonto(aporte) === null || aportar.isPending} onClick={() => mover(1)}>
                    <Wallet /> Apartar
                  </Button>
                  <Button variant="gray" size="sm" disabled={leerMonto(aporte) === null || aportar.isPending} onClick={() => mover(-1)}>
                    Sacar
                  </Button>
                </div>
              </Grupo>
            ) : null}

            <Grupo titulo={meta ? "Datos de la meta" : undefined}>
              <Fila>
                  <label htmlFor="nombre-meta" className="shrink-0">
                    Nombre
                  </label>
                <input
                  id="nombre-meta"
                  placeholder="Viaje, fondo de emergencia…"
                  value={nombre}
                  maxLength={60}
                  onChange={(e) => setNombre(e.target.value)}
                  className="h-11 w-full min-w-0 bg-transparent text-right text-[17px] outline-none placeholder:text-placeholder"
                />
              </Fila>
              <Fila>
                  <label htmlFor="objetivo-meta" className="shrink-0">
                    Objetivo
                  </label>
                <input
                  id="objetivo-meta"
                  inputMode="decimal"
                  placeholder="$0"
                  value={objetivo}
                  onChange={(e) => setObjetivo(e.target.value.replace(/[^\d.,]/g, "").slice(0, 12))}
                  className="h-11 w-full min-w-0 bg-transparent text-right text-[17px] outline-none placeholder:text-placeholder"
                />
              </Fila>
              <Fila>
                  <label htmlFor="fecha-meta" className="shrink-0">
                    Para cuándo
                  </label>
                <input
                  type="date"
                  id="fecha-meta"
                  min={hoy}
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="h-11 w-full min-w-0 bg-transparent text-right text-[17px] text-muted-foreground outline-none"
                />
              </Fila>
            </Grupo>

            {meta ? (
              <Grupo>
                <FilaBoton
                  icono={<Trash2 aria-hidden className="size-5 text-destructive" />}
                  sangria="3.4rem"
                  titulo={<span className="text-destructive">Borrar meta</span>}
                  disabled={borrar.isPending}
                  onClick={async () => {
                    try {
                      await borrar.mutateAsync(meta.id);
                      toast("Meta borrada");
                      alCerrar();
                    } catch (error) {
                      toast.error(mensajeDeError(error));
                    }
                  }}
                />
              </Grupo>
            ) : (
              <p className="flex items-start gap-1.5 px-4 text-[13px] leading-snug text-muted-foreground">
                <Target className="mt-0.5 size-3.5 shrink-0" /> Con fecha, te digo cuánto apartar cada mes.
              </p>
            )}
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
