import { Check, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorApi, mensajeDeError } from "../../lib/api";
import {
  type Cobro,
  cerrarCobros,
  cobrosParaMostrar,
  cuandoFue,
  type DatosConfirmar,
  QUIEN_CONFIRMO,
  useAccionCobro,
  useCobros,
  useHojaCobros,
} from "../../lib/cobros";
import { useEnLinea } from "../../lib/conexion";
import { useCuentas } from "../../lib/cuentas";
import { diaCorto, dinero, hoyIso, leerMonto } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { marcaDe } from "../../lib/marcas";
import { useGuardarRecurrente } from "../../lib/recurrentes";
import { hashDetalle, navegar } from "../../lib/ruta";
import { useUnaVez } from "../../lib/una-vez";
import { cn } from "../../lib/utils";
import { CampoMonto } from "../CampoMonto";
import { LogoMarca, LogoMovimiento, LogoPago } from "../Logo";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { Fila, FilaBoton, Grupo } from "../ui/lista";
import { SelectNativo } from "../ui/select";
import { Sheet, SheetContent } from "../ui/sheet";
import { Switch } from "../ui/switch";

type Vista = { tipo: "cargando" } | { tipo: "lista"; ids: string[] } | { tipo: "uno"; id: string; desdeLista: string[] | null };

/** "1 de 3" y cómo pasar al que sigue sin contestar este. */
type Progreso = { n: number; total: number; alSiguiente: (() => void) | null };

const pendiente = (c: Cobro) => c.estado === "pendiente" || c.estado === "sin_confirmar";

/** El que sigue de `lista` después de `actual` (dando la vuelta) que esté entre los `candidatos`. */
function proximo(lista: string[], actual: string, candidatos: string[]) {
  const i = lista.indexOf(actual);
  for (let k = 1; k <= lista.length; k++) {
    const id = lista[(i + k) % lista.length]!;
    if (id !== actual && candidatos.includes(id)) return id;
  }
  return null;
}

/**
 * Al abrir, el foco va a la hoja y no al primer botón: abierta desde una notificación (sin un toque antes) Safari
 * le pondría el anillo de foco a "Cerrar".
 */
const enfocarHoja = (e: Event) => {
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
};

/**
 * La hoja que pregunta "¿ya se pagó?". Con un cobro, sus opciones; con varios, la lista (cada uno con "Se pagó" y
 * "Todo se pagó"); tocar uno lo abre como "1 de N" y "Siguiente" pasa al que sigue. La abre la notificación, la
 * campana de Inicio o el centro de notificaciones.
 */
export function HojaCobros() {
  const { abierta, ids, clave } = useHojaCobros();
  const q = useCobros(abierta);
  const datos = cobrosParaMostrar(q);
  const [vista, setVista] = useState<Vista>({ tipo: "cargando" });
  // Los que ya se contestaron en esta vuelta ("todavía no" incluido: siguen por confirmar, pero ya no se repiten).
  const [contestados, setContestados] = useState<string[]>([]);
  const listo = !!datos;
  const fallo = q.isError && !datos;

  // Al abrir, con los datos ya cargados, se decide qué mostrar (una vez: confirmar uno no cambia de lista a uno).
  useEffect(() => {
    if (!abierta) return;
    setContestados([]);
    if (fallo) {
      cerrarCobros();
      // 404: el módulo no está abierto para esta cuenta (un enlace viejo): como si no hubiera nada.
      if (q.error instanceof ErrorApi && q.error.estado === 404) toast("No hay pagos por confirmar");
      else toast.error(mensajeDeError(q.error));
      return;
    }
    if (!datos) {
      setVista({ tipo: "cargando" });
      return;
    }
    const porConfirmar = datos.porConfirmar.filter((c) => !ids || ids.includes(c.id)).map((c) => c.id);
    if (porConfirmar.length > 1) setVista({ tipo: "lista", ids: porConfirmar });
    else if (porConfirmar.length === 1) setVista({ tipo: "uno", id: porConfirmar[0]!, desdeLista: null });
    else {
      // Ya se contestó (por voz, Apple Pay o en otra pantalla): se muestra cómo quedó, por si hay que corregirlo.
      const resuelto = ids && datos.recientes.find((c) => ids.includes(c.id));
      if (resuelto) setVista({ tipo: "uno", id: resuelto.id, desdeLista: null });
      else {
        cerrarCobros();
        toast("No hay pagos por confirmar", { description: "Ya quedó todo contestado." });
      }
    }
    // Solo al abrir otra vez y al llegar los datos.
  }, [clave, abierta, listo, fallo]);

  const todos = datos ? [...datos.porConfirmar, ...datos.recientes] : [];
  const cobro = vista.tipo === "uno" ? todos.find((c) => c.id === vista.id) : undefined;
  const filas = vista.tipo === "lista" ? (datos?.porConfirmar ?? []).filter((c) => vista.ids.includes(c.id)) : [];

  // La lista se cierra sola cuando ya no queda nada que contestar.
  useEffect(() => {
    if (abierta && vista.tipo === "lista" && datos && !filas.length) cerrarCobros();
  }, [abierta, vista.tipo, filas.length, !!datos]);

  /** Los de la lista que siguen esperando respuesta, sin contar los `hechos`. */
  const quedan = (lista: string[], hechos: string[]) =>
    lista.filter((id) => !hechos.includes(id) && (datos?.porConfirmar.some((c) => c.id === id) ?? false));

  /** Después de contestar uno: el que sigue de la lista; si ya no queda ninguno, se cierra. */
  const siguiente = (resuelto: string) => {
    if (vista.tipo !== "uno") return;
    const lista = vista.desdeLista ?? [];
    const hechos = [...contestados, resuelto];
    setContestados(hechos);
    const otro = proximo(lista, resuelto, quedan(lista, hechos));
    if (otro) setVista({ tipo: "uno", id: otro, desdeLista: lista });
    else cerrarCobros();
  };

  let progreso: Progreso | null = null;
  if (vista.tipo === "uno" && vista.desdeLista && vista.desdeLista.length > 1) {
    const lista = vista.desdeLista;
    const otro = proximo(lista, vista.id, quedan(lista, contestados));
    progreso = {
      n: lista.indexOf(vista.id) + 1,
      total: lista.length,
      alSiguiente: otro ? () => setVista({ tipo: "uno", id: otro, desdeLista: lista }) : null,
    };
  }

  const titulo = cobro?.nombre ?? (vista.tipo === "lista" ? "Por confirmar" : "");
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && cerrarCobros()}>
      {abierta ? (
        vista.tipo === "uno" && cobro ? (
          <UnCobro
            key={cobro.id}
            c={cobro}
            hoy={hoyIso()}
            atras={
              vista.desdeLista && vista.desdeLista.length > 1
                ? () => setVista({ tipo: "lista", ids: quedan(vista.desdeLista!, []) })
                : null
            }
            progreso={progreso}
            alTerminar={() => siguiente(cobro.id)}
          />
        ) : vista.tipo === "lista" ? (
          <Lista filas={filas} alAbrir={(id) => setVista({ tipo: "uno", id, desdeLista: filas.map((c) => c.id) })} />
        ) : (
          <SheetContent titulo={titulo || "Pagos"} descripcion="Cargando los pagos por confirmar">
            <div className="flex justify-center py-16">
              <Spinner className="size-6" etiqueta="Cargando" />
            </div>
          </SheetContent>
        )
      ) : null}
    </Sheet>
  );
}

/** Toast de "pagado" con su Deshacer. */
function avisarPagado(textos: string, ids: string[], deshacer: (id: string) => void) {
  haptico();
  toast.success(textos, {
    action: { label: "Deshacer", onClick: () => ids.forEach(deshacer) },
  });
}

/** Botón de la barra de la hoja: "Cerrar", "Listo", "Atrás", "Siguiente"… */
function BotonBarra({ alTocar, texto, fuerte = false, disabled }: { alTocar: () => void; texto: string; fuerte?: boolean; disabled?: boolean }) {
  return (
    <Button variant="plain" size="text" className={cn(fuerte && "font-semibold")} disabled={disabled} onClick={alTocar}>
      {texto}
    </Button>
  );
}

function Lista({ filas, alAbrir }: { filas: Cobro[]; alAbrir: (id: string) => void }) {
  const accion = useAccionCobro();
  const enLinea = useEnLinea();
  const unaVez = useUnaVez();
  const hoy = hoyIso();
  const deshacer = (id: string) => accion.mutate({ tipo: "deshacer", id });

  const pagado = (c: Cobro) =>
    unaVez(async () => {
      try {
        await accion.mutateAsync({ tipo: "confirmar", id: c.id });
        avisarPagado(`${c.nombre}: pagado ${dinero(c.montoCentavos, c.moneda)}`, [c.id], deshacer);
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  const todo = () =>
    unaVez(async () => {
      const ids = filas.map((c) => c.id);
      try {
        await accion.mutateAsync({ tipo: "varios", ids });
        avisarPagado(ids.length === 2 ? "Los dos quedaron pagados" : `Los ${ids.length} quedaron pagados`, ids, deshacer);
        cerrarCobros();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  return (
    <SheetContent
      onOpenAutoFocus={enfocarHoja}
      titulo="Por confirmar"
      descripcion="Pagos fijos y suscripciones que ya tocaban"
      derecha={<BotonBarra texto="Listo" fuerte alTocar={cerrarCobros} />}
    >
      <div className="space-y-5 pb-2">
        <p className="px-4 pt-1 text-center text-[15px] leading-snug text-balance text-muted-foreground">
          ¿Ya se pagaron? Toca uno para cambiar el monto o la cuenta.
        </p>
        <Grupo>
          {filas.map((c) => (
            <div
              key={c.id}
              data-cobro={c.id}
              className="relative flex min-h-11 items-center gap-3 py-2.5 pr-3 pl-4 max-[360px]:gap-2.5 [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[4.25rem] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
            >
              <LogoPago nombre={c.nombre} tipo={c.tipo} />
              {/* Toda la fila abre el cobro (menos "Se pagó", que va encima). */}
              <button
                type="button"
                className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-[''] active:opacity-60"
                onClick={() => alAbrir(c.id)}
              >
                <span className="block truncate text-[17px] leading-[22px]">{c.nombre}</span>
                <span className="line-clamp-2 text-[15px] leading-5 text-muted-foreground max-[360px]:text-[14px]">
                  <span className="tabular">{dinero(c.montoCentavos, c.moneda)}</span> · {cuandoFue(c.fecha, hoy, { corto: true })}
                  {c.cuenta ? ` · ${c.cuenta}` : ""}
                </span>
              </button>
              <Button
                variant="tinted"
                size="sm"
                className="relative z-[1] max-[360px]:h-[30px] max-[360px]:px-3 max-[360px]:text-[14px]"
                aria-label={`${c.nombre} se pagó`}
                disabled={!enLinea}
                onClick={() => void pagado(c)}
              >
                Se pagó
              </Button>
            </div>
          ))}
        </Grupo>
        <Button size="lg" disabled={!enLinea || accion.isPending} onClick={() => void todo()}>
          {accion.isPending ? <Spinner className="size-5" /> : <Check strokeWidth={2.6} />}
          Todo se pagó
        </Button>
      </div>
    </SheetContent>
  );
}

function UnCobro({
  c,
  hoy,
  atras,
  progreso,
  alTerminar,
}: {
  c: Cobro;
  hoy: string;
  atras: (() => void) | null;
  progreso: Progreso | null;
  alTerminar: () => void;
}) {
  const [otroMonto, setOtroMonto] = useState(false);
  if (!pendiente(c)) return <Resuelto c={c} hoy={hoy} atras={atras} />;
  if (otroMonto) return <OtroMonto c={c} alVolver={() => setOtroMonto(false)} alTerminar={alTerminar} />;
  return <Preguntar c={c} hoy={hoy} atras={atras} progreso={progreso} alOtroMonto={() => setOtroMonto(true)} alTerminar={alTerminar} />;
}

/** El logo del pago en grande, arriba de la hoja; con su palomita o su tache si ya se contestó. */
function LogoGrande({ c, estado }: { c: Cobro; estado?: "pagado" | "saltado" }) {
  return (
    <span className="relative inline-flex">
      <LogoPago nombre={c.nombre} tipo={c.tipo} tamano={64} />
      {estado ? (
        <span
          aria-hidden
          className={cn(
            "absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full text-white shadow-[0_0_0_2.5px_var(--background)]",
            estado === "pagado" ? "bg-[var(--positive)]" : "bg-[var(--gray-icon)]",
          )}
        >
          {estado === "pagado" ? <Check className="size-3.5" strokeWidth={3.2} /> : <X className="size-3.5" strokeWidth={3.2} />}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "¿Ya se pagó?": sí (un toque), fue otro monto, con qué cuenta, todavía no, o no se pagó; y si ya estaba anotado,
 * cuál de los gastos es.
 */
function Preguntar({
  c,
  hoy,
  atras,
  progreso,
  alOtroMonto,
  alTerminar,
}: {
  c: Cobro;
  hoy: string;
  atras: (() => void) | null;
  progreso: Progreso | null;
  alOtroMonto: () => void;
  alTerminar: () => void;
}) {
  const accion = useAccionCobro();
  const pausar = useGuardarRecurrente();
  const enLinea = useEnLinea();
  const unaVez = useUnaVez();
  const [cuentaId, setCuentaId] = useState(c.cuentaId ?? "");
  const deshacer = (id: string) => accion.mutate({ tipo: "deshacer", id });
  const ocupado = !enLinea || accion.isPending;
  const sinConfirmar = c.estado === "sin_confirmar";
  const monto = dinero(c.montoCentavos, c.moneda);

  const confirmar = (datos: DatosConfirmar, texto: string) =>
    unaVez(async () => {
      try {
        await accion.mutateAsync({ tipo: "confirmar", id: c.id, datos: { ...datos, ...((cuentaId || null) !== c.cuentaId ? { cuenta_id: cuentaId || null } : {}) } });
        avisarPagado(texto, [c.id], deshacer);
        alTerminar();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  const posponer = () =>
    unaVez(async () => {
      try {
        await accion.mutateAsync({ tipo: "posponer", id: c.id });
        toast("Te pregunto mañana");
        alTerminar();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  const saltar = () =>
    unaVez(async () => {
      try {
        const r = await accion.mutateAsync({ tipo: "saltar", id: c.id });
        haptico();
        toast(`${c.nombre}: no se pagó esta vez`, { action: { label: "Deshacer", onClick: () => deshacer(c.id) } });
        if (r.sugerirPausa)
          toast(`¿Pausar ${c.nombre}?`, {
            description: "Tampoco se pagó la vez anterior. Pausada, no te pregunto ni cuenta en lo que falta pagar.",
            duration: 10_000,
            action: {
              label: "Pausar",
              // La promesa, no callbacks de mutate: para entonces la hoja ya se cerró.
              onClick: () =>
                void pausar
                  .mutateAsync({ id: c.recurrenteId, datos: { estado: "pausada" } })
                  .then(() => toast.success(`Pausé ${c.nombre}`))
                  .catch((e: unknown) => toast.error(mensajeDeError(e))),
            },
          });
        alTerminar();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  return (
    <SheetContent
      onOpenAutoFocus={enfocarHoja}
      // Con varios, la barra dice en cuál vas; con uno, el nombre ya lo dice la pregunta grande.
      titulo={progreso ? <span className="tabular">{`${progreso.n} de ${progreso.total}`}</span> : <span className="sr-only">{c.nombre}</span>}
      descripcion={`¿Ya se pagó ${c.nombre}?`}
      izquierda={atras ? <BotonBarra texto="Atrás" alTocar={atras} /> : undefined}
      derecha={
        progreso?.alSiguiente ? (
          <BotonBarra texto="Siguiente" fuerte disabled={accion.isPending} alTocar={progreso.alSiguiente} />
        ) : (
          <BotonBarra texto="Cerrar" fuerte alTocar={cerrarCobros} />
        )
      }
    >
      <div className="pb-2">
        <div className="flex flex-col items-center px-2 pt-1 pb-4 text-center">
          <LogoGrande c={c} />
          <h3 className="mt-3 text-[22px] leading-7 font-bold text-balance [overflow-wrap:anywhere]">¿Ya se pagó {c.nombre}?</h3>
          <p className="mt-1 text-[15px] leading-snug text-balance text-muted-foreground" data-testid="cuando">
            {monto} · {c.fecha >= hoy ? "se cobra" : "tocaba"} {cuandoFue(c.fecha, hoy)}
            {c.pospuesto ? " · me dijiste «todavía no»" : ""}
          </p>
        </div>

        <Button size="lg" disabled={ocupado} onClick={() => void confirmar({}, `${c.nombre}: pagado ${monto}`)}>
          {accion.isPending && accion.variables?.tipo === "confirmar" ? <Spinner className="size-5" /> : <Check strokeWidth={2.6} />}
          Se pagó
        </Button>

        <Grupo className="mt-3.5" pie="Si no se pagó dos veces seguidas, te ofrezco pausarlo.">
          <FilaBoton titulo="Fue otro monto" chevron disabled={ocupado} onClick={alOtroMonto} />
          <FilaCuenta id={`cuenta-cobro-${c.id}`} valor={cuentaId} alCambiar={setCuentaId} nombreActual={c.cuenta} />
          {!sinConfirmar ? (
            <FilaBoton
              titulo={c.pospuesto ? "Te vuelvo a preguntar mañana" : "Te pregunto mañana"}
              disabled={ocupado}
              onClick={() => void posponer()}
            />
          ) : null}
          <FilaBoton titulo={<span className="text-destructive">No anoto nada esta vez</span>} disabled={ocupado} onClick={() => void saltar()} />
        </Grupo>

        {c.sugerencias.length ? (
          <Grupo className="mt-[22px]" titulo="¿Ya lo anotaste? Puede ser este" pie="Tócalo y queda como el pago, sin anotarlo dos veces.">
            {c.sugerencias.map((s) => (
              <FilaBoton
                key={s.movimientoId}
                sangria="4.25rem"
                data-sugerencia={s.movimientoId}
                icono={<LogoMovimiento comercio={s.titulo} categoria={null} tipo="gasto" />}
                titulo={s.titulo}
                subtitulo={
                  // En pantallas angostas baja a otro renglón en lugar de cortarse.
                  <span className="block whitespace-normal">
                    <span className="tabular">{dinero(s.montoCentavos, s.moneda)}</span> · {diaCorto(s.fecha).replace(/\s/g, " ")}
                    {s.cuenta ? ` · ${s.cuenta}` : ""}
                  </span>
                }
                valor={
                  <span className="inline-flex h-8 items-center rounded-full bg-fill px-3.5 text-[15px] font-semibold text-foreground">Es este</span>
                }
                disabled={ocupado}
                onClick={() => void confirmar({ movimiento_id: s.movimientoId }, `${c.nombre}: pagado con lo que ya habías anotado`)}
              />
            ))}
          </Grupo>
        ) : null}
      </div>
    </SheetContent>
  );
}

/** "Fue otro monto": el monto, con qué se pagó y si desde ahora cuesta eso. */
function OtroMonto({ c, alVolver, alTerminar }: { c: Cobro; alVolver: () => void; alTerminar: () => void }) {
  const accion = useAccionCobro();
  const enLinea = useEnLinea();
  const unaVez = useUnaVez();
  const [texto, setTexto] = useState("");
  const [cuentaId, setCuentaId] = useState(c.cuentaId ?? "");
  const n = leerMonto(texto);
  const centavos = n === null ? null : Math.round(n * 100);
  const distinto = centavos !== null && centavos !== c.montoCentavos;
  // Si ya la vez pasada se pagó esto mismo, lo más seguro es que subió: el interruptor sale prendido.
  const [nuevoPrecio, setNuevoPrecio] = useState<boolean | null>(null);
  const actualizar = nuevoPrecio ?? (centavos !== null && centavos === c.anteriorDistintoCentavos);
  const listo = n !== null && enLinea && !accion.isPending;

  const guardar = () =>
    unaVez(async () => {
      if (!listo || n === null) return;
      try {
        await accion.mutateAsync({
          tipo: "confirmar",
          id: c.id,
          datos: {
            monto: n,
            ...(distinto && actualizar ? { actualizar_precio: true } : {}),
            ...((cuentaId || null) !== c.cuentaId ? { cuenta_id: cuentaId || null } : {}),
          },
        });
        avisarPagado(
          `${c.nombre}: pagado ${dinero(centavos!, c.moneda)}${distinto && actualizar ? "; desde ahora cuesta eso" : ""}`,
          [c.id],
          (id) => accion.mutate({ tipo: "deshacer", id }),
        );
        alTerminar();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  return (
    <SheetContent
      titulo={c.nombre}
      descripcion={`¿Cuánto se pagó de ${c.nombre}?`}
      izquierda={<BotonBarra texto="Atrás" alTocar={alVolver} />}
      derecha={
        <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={() => void guardar()}>
          {accion.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : "Guardar"}
        </Button>
      }
    >
      <form
        className="space-y-6 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void guardar();
        }}
      >
        <div>
          <CampoMonto id={`monto-cobro-${c.id}`} valor={texto} onCambio={setTexto} moneda={c.moneda} enfocar />
          <p className="mt-1 text-center text-[15px] text-muted-foreground">Normalmente {dinero(c.montoCentavos, c.moneda)}</p>
        </div>
        <Grupo
          pie={
            distinto
              ? actualizar
                ? `Los próximos cobros serán de ${dinero(centavos!, c.moneda)}.`
                : "Solo cambia este pago; los próximos siguen igual."
              : undefined
          }
        >
          <FilaCuenta id={`cuenta-otro-${c.id}`} valor={cuentaId} alCambiar={setCuentaId} nombreActual={c.cuenta} />
          {distinto ? (
            <Fila>
              <label htmlFor={`precio-${c.id}`} className="min-w-0 flex-1 py-2.5">
                Desde ahora cuesta {dinero(centavos!, c.moneda)}
              </label>
              <Switch id={`precio-${c.id}`} checked={actualizar} onCheckedChange={setNuevoPrecio} />
            </Fila>
          ) : null}
        </Grupo>
        <Button size="lg" type="submit" disabled={!listo}>
          {n === null ? "Escribe cuánto fue" : `Se pagó ${dinero(centavos!, c.moneda)}`}
        </Button>
      </form>
    </SheetContent>
  );
}

/** Un cobro ya contestado: cómo quedó y cómo corregirlo. */
function Resuelto({ c, hoy, atras }: { c: Cobro; hoy: string; atras: (() => void) | null }) {
  const accion = useAccionCobro();
  const enLinea = useEnLinea();
  const unaVez = useUnaVez();
  const pagado = c.estado === "pagado";
  const quien = c.confirmadoPor ? QUIEN_CONFIRMO[c.confirmadoPor] : null;

  const deshacer = () =>
    unaVez(async () => {
      try {
        await accion.mutateAsync({ tipo: "deshacer", id: c.id });
        haptico();
        toast(pagado ? "Listo, quité el pago" : "Listo, vuelve a estar por confirmar");
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  return (
    <SheetContent
      onOpenAutoFocus={enfocarHoja}
      titulo={c.nombre}
      descripcion={`Cómo quedó el cobro de ${c.nombre}`}
      izquierda={atras ? <BotonBarra texto="Atrás" alTocar={atras} /> : undefined}
      derecha={<BotonBarra texto="Listo" fuerte alTocar={cerrarCobros} />}
    >
      <div className="space-y-5 pb-2">
        <div className="flex flex-col items-center px-2 pt-1 text-center" data-estado={c.estado}>
          <LogoGrande c={c} estado={pagado ? "pagado" : "saltado"} />
          <h3 className="mt-3 text-[22px] leading-7 font-bold text-balance [overflow-wrap:anywhere]">
            {pagado ? `Pagado ${dinero(c.montoRealCentavos ?? c.montoCentavos, c.moneda)}` : "No se pagó"}
          </h3>
          <p className="mt-1 text-[15px] leading-snug text-balance text-muted-foreground">
            Cobro {cuandoFue(c.fecha, hoy).replace(/^el /, "del ").replace(/^(hoy|ayer)$/, "de $1")}
            {/* El "·" se queda al final del renglón, no al principio del que sigue. */}
            {quien ? ` · lo confirmaste ${quien}` : ""}
            {pagado && c.montoRealCentavos !== null && c.montoRealCentavos !== c.montoCentavos
              ? ` · normalmente ${dinero(c.montoCentavos, c.moneda)}`
              : ""}
          </p>
        </div>
        <Grupo>
          {pagado && c.movimientoId ? (
            <FilaBoton
              titulo="Ver el gasto"
              chevron
              onClick={() => {
                cerrarCobros();
                navegar(hashDetalle(c.movimientoId!));
              }}
            />
          ) : null}
          <FilaBoton
            titulo={<span className={pagado ? "text-destructive" : "text-tint"}>{pagado ? "No se pagó, quitar el pago" : "Sí se pagó, corregir"}</span>}
            subtitulo={pagado ? "Quito el gasto y te vuelvo a preguntar" : "Te vuelvo a preguntar si ya se pagó"}
            disabled={!enLinea || accion.isPending}
            onClick={() => void deshacer()}
          />
        </Grupo>
      </div>
    </SheetContent>
  );
}

/** "Se pagó con": la cuenta del pago fijo, o la que se elija (la rueda del iPhone), con el logo de su banco. */
function FilaCuenta({
  id,
  valor,
  alCambiar,
  nombreActual,
}: {
  id: string;
  valor: string;
  alCambiar: (v: string) => void;
  nombreActual: string | null;
}) {
  const cuentas = useCuentas();
  const lista = (cuentas.data?.cuentas ?? []).filter((c) => !c.archivada || c.id === valor);
  if (!lista.length && !nombreActual) return null;
  const elegida = valor ? lista.find((c) => c.id === valor) : undefined;
  const texto = (valor && (elegida?.nombre ?? nombreActual)) || "Sin indicar";
  const marca = valor && elegida?.tipo !== "efectivo" ? marcaDe(texto, elegida?.institucion) : null;
  return (
    <Fila>
      <SelectNativo
        id={id}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        className="flex-1 self-stretch"
        opciones={
          <>
            <option value="">Sin indicar</option>
            {lista.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </>
        }
      >
        <div className="flex h-full min-h-11 items-center gap-3">
          <label htmlFor={id} className="shrink-0">
            Se pagó con
          </label>
          <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground">
            {marca ? <LogoMarca clave={marca} tamano={22} /> : null}
            <span className="truncate">{texto}</span>
          </span>
          <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted-foreground/60" />
        </div>
      </SelectNativo>
    </Fila>
  );
}
