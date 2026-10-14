import { Check, CircleCheck, CircleSlash, Clock, Receipt, Undo2 } from "lucide-react";
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
import { useGuardarRecurrente } from "../../lib/recurrentes";
import { hashDetalle, navegar } from "../../lib/ruta";
import { useUnaVez } from "../../lib/una-vez";
import { CampoMonto } from "../CampoMonto";
import { HojaCalendario } from "../HojaCalendario";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { Fila, FilaBoton, Grupo } from "../ui/lista";
import { SelectNativo } from "../ui/select";
import { Sheet, SheetContent } from "../ui/sheet";
import { Switch } from "../ui/switch";

type Vista = { tipo: "cargando" } | { tipo: "lista"; ids: string[] } | { tipo: "uno"; id: string; desdeLista: string[] | null };

const pendiente = (c: Cobro) => c.estado === "pendiente" || c.estado === "sin_confirmar";

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
 * "Todo se pagó"). La abre la notificación, la tarjeta de Inicio o el centro de notificaciones.
 */
export function HojaCobros() {
  const { abierta, ids, clave } = useHojaCobros();
  const q = useCobros(abierta);
  const datos = cobrosParaMostrar(q);
  const [vista, setVista] = useState<Vista>({ tipo: "cargando" });
  const listo = !!datos;
  const fallo = q.isError && !datos;

  // Al abrir, con los datos ya cargados, se decide qué mostrar (una vez: confirmar uno no cambia de lista a uno).
  useEffect(() => {
    if (!abierta) return;
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

  /** Después de contestar uno: de vuelta a la lista si quedan; si no, se cierra. */
  const siguiente = (resuelto: string) => {
    if (vista.tipo !== "uno") return;
    const quedan = (vista.desdeLista ?? []).filter((id) => id !== resuelto && datos?.porConfirmar.some((c) => c.id === id));
    if (quedan.length) setVista({ tipo: "lista", ids: quedan });
    else cerrarCobros();
  };

  const titulo = cobro?.nombre ?? (vista.tipo === "lista" ? "Por confirmar" : "");
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && cerrarCobros()}>
      {abierta ? (
        vista.tipo === "uno" && cobro ? (
          <UnCobro
            key={cobro.id}
            c={cobro}
            hoy={hoyIso()}
            atras={vista.desdeLista && vista.desdeLista.length > 1 ? () => setVista({ tipo: "lista", ids: vista.desdeLista! }) : null}
            alTerminar={() => siguiente(cobro.id)}
          />
        ) : vista.tipo === "lista" ? (
          <Lista filas={filas} alAbrir={(id) => setVista({ tipo: "uno", id, desdeLista: vista.ids })} />
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
      derecha={
        <Button variant="plain" size="text" className="font-semibold" onClick={cerrarCobros}>
          Listo
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        <p className="px-4 pt-1 text-center text-[15px] leading-snug text-balance text-muted-foreground">
          ¿Ya se pagaron? Toca uno para cambiar el monto o la cuenta.
        </p>
        <Grupo>
          {filas.map((c) => (
            <div key={c.id} data-cobro={c.id} className="relative flex items-center gap-3 pr-3 pl-4 [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[4rem] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']">
              <HojaCalendario fecha={c.fecha} />
              <button type="button" className="min-w-0 flex-1 py-2.5 text-left active:opacity-60" onClick={() => alAbrir(c.id)}>
                <span className="block truncate text-[17px]">{c.nombre}</span>
                <span className="block truncate text-[15px] text-muted-foreground">
                  <span className="tabular">{dinero(c.montoCentavos, c.moneda)}</span> · {cuandoFue(c.fecha, hoy, { corto: true })}
                  {c.cuenta ? ` · ${c.cuenta}` : ""}
                </span>
              </button>
              <Button variant="tinted" size="sm" aria-label={`${c.nombre} se pagó`} disabled={!enLinea} onClick={() => void pagado(c)}>
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

function UnCobro({ c, hoy, atras, alTerminar }: { c: Cobro; hoy: string; atras: (() => void) | null; alTerminar: () => void }) {
  const [otroMonto, setOtroMonto] = useState(false);
  if (!pendiente(c)) return <Resuelto c={c} hoy={hoy} atras={atras} />;
  if (otroMonto) return <OtroMonto c={c} alVolver={() => setOtroMonto(false)} alTerminar={alTerminar} />;
  return <Preguntar c={c} hoy={hoy} atras={atras} alOtroMonto={() => setOtroMonto(true)} alTerminar={alTerminar} />;
}

function BotonAtras({ alTocar, texto = "Atrás" }: { alTocar: () => void; texto?: string }) {
  return (
    <Button variant="plain" size="text" onClick={alTocar}>
      {texto}
    </Button>
  );
}

/** "¿Ya se pagó?": sí (un toque), fue otro monto, ya lo había anotado, todavía no, o no se pagó. */
function Preguntar({ c, hoy, atras, alOtroMonto, alTerminar }: { c: Cobro; hoy: string; atras: (() => void) | null; alOtroMonto: () => void; alTerminar: () => void }) {
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
      titulo={c.nombre}
      descripcion={`¿Ya se pagó ${c.nombre}?`}
      izquierda={atras ? <BotonAtras alTocar={atras} /> : undefined}
      derecha={
        <Button variant="plain" size="text" className="font-semibold" onClick={cerrarCobros}>
          Cerrar
        </Button>
      }
    >
      <div className="space-y-6 pb-2">
        <div className="flex flex-col items-center pt-2 text-center">
          <HojaCalendario fecha={c.fecha} />
          <p className="mt-3 text-[22px] leading-7 font-bold">¿Ya se pagó?</p>
          <p className="mt-1 text-[15px] leading-snug text-muted-foreground" data-testid="cuando">
            {monto} · {c.fecha >= hoy ? "se cobra" : "tocaba"} {cuandoFue(c.fecha, hoy)}
            {c.pospuesto ? " · me dijiste «todavía no»" : ""}
          </p>
        </div>

        {c.sugerencias.length ? (
          <Grupo titulo="¿Ya lo anotaste? Puede ser este" pie="Tócalo y queda como el pago, sin anotarlo dos veces.">
            {c.sugerencias.map((s) => (
              <FilaBoton
                key={s.movimientoId}
                sangria="3.75rem"
                data-sugerencia={s.movimientoId}
                icono={
                  <span aria-hidden className="flex size-[30px] items-center justify-center rounded-full bg-fill text-tint">
                    <Receipt className="size-[17px]" />
                  </span>
                }
                titulo={s.titulo}
                subtitulo={`${diaCorto(s.fecha)}${s.cuenta ? ` · ${s.cuenta}` : ""}`}
                valor={<span className="font-medium text-foreground tabular">{dinero(s.montoCentavos, s.moneda)}</span>}
                disabled={ocupado}
                onClick={() => void confirmar({ movimiento_id: s.movimientoId }, `${c.nombre}: pagado con lo que ya habías anotado`)}
              />
            ))}
          </Grupo>
        ) : null}

        <FilaCuenta id={`cuenta-cobro-${c.id}`} valor={cuentaId} alCambiar={setCuentaId} nombreActual={c.cuenta} />

        <div className="space-y-3">
          <Button size="lg" disabled={ocupado} onClick={() => void confirmar({}, `${c.nombre}: pagado ${monto}`)}>
            {accion.isPending && accion.variables?.tipo === "confirmar" ? <Spinner className="size-5" /> : <Check strokeWidth={2.6} />}
            Sí, se pagó {monto}
          </Button>
          <Button size="lg" variant="gray" disabled={ocupado} onClick={alOtroMonto}>
            Sí, pero fue otro monto
          </Button>
        </div>

        <Grupo>
          {!sinConfirmar ? (
            <FilaBoton
              sangria="3.25rem"
              icono={<Clock className="size-[20px] text-tint" />}
              titulo={<span className="text-tint">Todavía no</span>}
              subtitulo={c.pospuesto ? "Te vuelvo a preguntar mañana" : "Te pregunto mañana"}
              disabled={ocupado}
              onClick={() => void posponer()}
            />
          ) : null}
          <FilaBoton
            sangria="3.25rem"
            icono={<CircleSlash className="size-[20px] text-tint" />}
            titulo={<span className="text-tint">Esta vez no se pagó</span>}
            subtitulo="No anoto nada esta vez"
            disabled={ocupado}
            onClick={() => void saltar()}
          />
        </Grupo>
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
      izquierda={<BotonAtras alTocar={alVolver} />}
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
          <FilaCuenta id={`cuenta-otro-${c.id}`} valor={cuentaId} alCambiar={setCuentaId} nombreActual={c.cuenta} suelta />
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
      izquierda={atras ? <BotonAtras alTocar={atras} /> : undefined}
      derecha={
        <Button variant="plain" size="text" className="font-semibold" onClick={cerrarCobros}>
          Listo
        </Button>
      }
    >
      <div className="space-y-6 pb-2">
        <div className="flex flex-col items-center pt-2 text-center" data-estado={c.estado}>
          <span
            aria-hidden
            className="flex size-14 items-center justify-center rounded-full"
            style={{
              backgroundColor: `color-mix(in srgb, ${pagado ? "var(--positive)" : "var(--gray-icon)"} 16%, transparent)`,
              color: pagado ? "var(--positive)" : "var(--gray-icon)",
            }}
          >
            {pagado ? <CircleCheck className="size-8" /> : <CircleSlash className="size-8" />}
          </span>
          <p className="mt-3 text-[22px] leading-7 font-bold">
            {pagado ? `Pagado ${dinero(c.montoRealCentavos ?? c.montoCentavos, c.moneda)}` : "No se pagó"}
          </p>
          <p className="mt-1 text-[15px] leading-snug text-balance text-muted-foreground">
            Cobro {cuandoFue(c.fecha, hoy).replace(/^el /, "del ").replace(/^(hoy|ayer)$/, "de $1")}
            {quien ? ` · lo confirmaste ${quien}` : ""}
            {pagado && c.montoRealCentavos !== null && c.montoRealCentavos !== c.montoCentavos
              ? ` · normalmente ${dinero(c.montoCentavos, c.moneda)}`
              : ""}
          </p>
        </div>
        <Grupo>
          {pagado && c.movimientoId ? (
            <FilaBoton
              sangria="3.25rem"
              icono={<Receipt className="size-[20px] text-tint" />}
              titulo="Ver el gasto"
              chevron
              onClick={() => {
                cerrarCobros();
                navegar(hashDetalle(c.movimientoId!));
              }}
            />
          ) : null}
          <FilaBoton
            sangria="3.25rem"
            icono={<Undo2 className="size-[20px] text-tint" />}
            titulo={<span className="text-tint">{pagado ? "No se pagó, quitar el pago" : "Sí se pagó, corregir"}</span>}
            subtitulo={pagado ? "Quito el gasto y te vuelvo a preguntar" : "Te vuelvo a preguntar si ya se pagó"}
            disabled={!enLinea || accion.isPending}
            onClick={() => void deshacer()}
          />
        </Grupo>
      </div>
    </SheetContent>
  );
}

/** "Se pagó con": la cuenta del pago fijo, o la que se elija. */
function FilaCuenta({
  id,
  valor,
  alCambiar,
  nombreActual,
  suelta = false,
}: {
  id: string;
  valor: string;
  alCambiar: (v: string) => void;
  nombreActual: string | null;
  /** Dentro de un Grupo que ya existe. */
  suelta?: boolean;
}) {
  const cuentas = useCuentas();
  const lista = (cuentas.data?.cuentas ?? []).filter((c) => !c.archivada || c.id === valor);
  if (!lista.length && !nombreActual) return null;
  const texto = (valor && (lista.find((c) => c.id === valor)?.nombre ?? nombreActual)) || "Sin indicar";
  const fila = (
    <Fila>
      <label htmlFor={id} className="shrink-0">
        Se pagó con
      </label>
      <SelectNativo
        id={id}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        className="min-w-0 flex-1"
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
        <span className="block truncate py-2.5 text-right text-[17px] text-muted-foreground">{texto}</span>
      </SelectNativo>
    </Fila>
  );
  return suelta ? fila : <Grupo>{fila}</Grupo>;
}
