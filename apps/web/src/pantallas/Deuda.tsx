import { HandCoins, Mic, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Anillos } from "../components/Anillos";
import { Ajustado } from "../components/Ajustado";
import { HojaAbono } from "../components/deudas/HojaAbono";
import { HojaPrestamo, type ValorHojaPrestamo } from "../components/deudas/HojaPrestamo";
import { colorDeuda, comoSeDice, Inicial, pagadoDe, SaldoDeuda, sentidoDe } from "../components/deudas/Piezas";
import { FilaDeslizable } from "../components/FilaDeslizable";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { Confirmar } from "../components/ui/dialog";
import { CampoFila } from "../components/ui/input";
import { Fila, FilaBoton, Grupo } from "../components/ui/lista";
import { Segmented } from "../components/ui/segmented";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { mensajeDeError } from "../lib/api";
import { useEnLinea } from "../lib/conexion";
import { useYo } from "../lib/consultas";
import {
  buscarDeuda,
  type Direccion,
  hashDeuda,
  personasDe,
  prestamosDe,
  useBorrarAbono,
  useBorrarPrestamos,
  useRenombrarDeuda,
  useRestaurarPrestamos,
} from "../lib/deudas";
import { dinero, dineroCorto, pct } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { usePrestamos } from "../lib/plan";
import { hashDe, navegar } from "../lib/ruta";
import type { DeudaPersona, MovimientoDeuda } from "../lib/tipos";
import { cn } from "../lib/utils";

// La línea entre filas que se deslizan, debajo del texto como en las demás listas.
const SEPARADOR =
  "relative [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[4rem] [&:not(:first-child)]:before:z-[1] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']";

const fDia = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
const fLargo = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" });

/** Atrás: a donde venía (Cuentas o Plan); si abrió el enlace directo, a Cuentas. */
function regresar() {
  if ((window.history.state as { fa?: boolean } | null)?.fa) window.history.back();
  else navegar(hashDe("cuentas"), { reemplazar: true });
}

/** #deuda?persona=&dir=: cuánto falta con esa persona, cómo ha bajado, sus préstamos y abonos, y qué hacer. */
export function Deuda({ params }: { params: URLSearchParams }) {
  const persona = params.get("persona") ?? "";
  const direccion: Direccion = params.get("dir") === "me_deben" ? "me_deben" : "debo";
  const yo = useYo();
  const moneda = yo.data?.moneda ?? "MXN";
  const consulta = usePrestamos();
  const enLinea = useEnLinea();
  const borrarAbono = useBorrarAbono();
  const borrarPrestamos = useBorrarPrestamos();
  const restaurar = useRestaurarPrestamos();
  const [abonar, setAbonar] = useState<DeudaPersona | null>(null);
  const [hojaPrestamo, setHojaPrestamo] = useState<ValorHojaPrestamo | null>(null);
  const [editarPersona, setEditarPersona] = useState(false);
  const [abonoABorrar, setAbonoABorrar] = useState<MovimientoDeuda | null>(null);

  const personas = personasDe(consulta.data);
  const d = buscarDeuda(personas, persona, direccion);
  const prestamos = prestamosDe(consulta.data, { persona, direccion });
  const meDebe = direccion === "me_deben";

  const editarPrestamo = (m: MovimientoDeuda) => {
    const p = prestamos.find((x) => x.id === m.id);
    if (!p) return;
    setHojaPrestamo({
      prestamo: { id: p.id, persona: p.persona, direccion: p.direccion, montoCentavos: p.montoCentavos, fecha: m.fecha, descripcion: p.descripcion },
    });
  };

  const quitarPrestamo = async (m: MovimientoDeuda) => {
    if (!m.id) return;
    const id = m.id;
    try {
      await borrarPrestamos.mutateAsync([id]);
      haptico();
      toast(`Borré el préstamo de ${dinero(m.montoCentavos, moneda)}`, { action: { label: "Deshacer", onClick: () => restaurar.mutate([id]) } });
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  const quitarAbono = async (m: MovimientoDeuda) => {
    if (!m.id) return;
    try {
      await borrarAbono.mutateAsync(m.id);
      haptico();
      toast(`Borré el abono de ${dinero(m.montoCentavos, moneda)}`);
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  return (
    <Pantalla
      titulo={d?.persona ?? (persona || "Deuda")}
      encima={d ? sentidoDe(d) : undefined}
      atras={{ etiqueta: "Atrás", alTocar: regresar }}
      derecha={
        d ? (
          <Button variant="gray" size="icon-sm" aria-label="Editar deuda" disabled={!enLinea} onClick={() => setEditarPersona(true)}>
            <Pencil strokeWidth={2.25} />
          </Button>
        ) : null
      }
      alRefrescar={() => consulta.refetch()}
    >
      {consulta.isPending ? (
        <div aria-busy className="space-y-8 pt-2">
          <Skeleton className="h-[200px] w-full rounded-[20px] bg-card" />
          <Skeleton className="h-[140px] w-full rounded-[20px] bg-card" />
        </div>
      ) : !d ? (
        <div className="mt-6 rounded-[20px] bg-card px-6 py-10 text-center">
          <p className="text-[17px] font-semibold">{consulta.isError ? "No pudimos cargar la deuda" : "Ya no está esta deuda"}</p>
          <p className="mt-1 text-[15px] text-balance text-muted-foreground">
            {consulta.isError ? mensajeDeError(consulta.error) : "Pudo haberse borrado o cambiado de nombre."}
          </p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => navegar(hashDe("cuentas"), { reemplazar: true })}>
            Ver cuentas y deudas
          </Button>
        </div>
      ) : (
        <div className="space-y-8 pt-2 pb-4">
          <Hero d={d} moneda={moneda} />

          <div className="grid grid-cols-2 gap-2.5">
            <Accion
              icono={<HandCoins className="size-5" strokeWidth={2.2} />}
              principal
              disabled={!enLinea || d.pendienteCentavos <= 0}
              onClick={() => setAbonar(d)}
            >
              {meDebe ? "Registrar pago" : "Registrar abono"}
            </Accion>
            <Accion
              icono={<Plus className="size-5" strokeWidth={2.4} />}
              disabled={!enLinea}
              onClick={() => setHojaPrestamo({ nuevo: true, persona: d.persona, direccion: d.direccion })}
            >
              {meDebe ? "Le presté más" : "Me prestó más"}
            </Accion>
          </div>

          {d.movimientos.some((m) => m.tipo === "abono") ? (
            <Grupo titulo="Cómo ha bajado">
              <div className="px-4 pt-3 pb-2">
                <SaldoDeuda movimientos={d.movimientos} color={colorDeuda(d)} />
              </div>
            </Grupo>
          ) : null}

          <Grupo
            titulo="Préstamos y abonos"
            pie={d.movimientos.some((m) => m.id) ? "Toca un préstamo para cambiarlo. Desliza a la izquierda para borrar." : undefined}
          >
            {d.movimientos.map((m, i) => {
              const fila = <FilaMovimientoDeuda m={m} meDebe={meDebe} moneda={moneda} />;
              if (!m.id) return <div key={`${m.fecha}-${i}`} className={SEPARADOR}>{fila}</div>;
              return (
                <FilaDeslizable
                  key={m.id}
                  etiqueta={`${m.tipo === "abono" ? "Abono" : "Préstamo"} de ${dinero(m.montoCentavos, moneda)}`}
                  deshabilitada={!enLinea}
                  className={SEPARADOR}
                  alTocar={() => (m.tipo === "prestamo" ? editarPrestamo(m) : setAbonoABorrar(m))}
                  alEditar={m.tipo === "prestamo" ? () => editarPrestamo(m) : undefined}
                  alEliminar={() => (m.tipo === "prestamo" ? void quitarPrestamo(m) : setAbonoABorrar(m))}
                >
                  {fila}
                </FilaDeslizable>
              );
            })}
          </Grupo>

          <p className="flex items-start gap-1.5 px-4 text-[13px] leading-snug text-muted-foreground">
            <Mic className="mt-0.5 size-3.5 shrink-0" />
            {meDebe
              ? `También por voz: «${d.persona} me depositó 500». Si te equivocas, di «deshaz eso».`
              : `También por voz: «le transferí 2 mil a ${comoSeDice(d.persona)} desde Revolut». Si te equivocas, di «deshaz eso».`}
          </p>

          <BorrarDeuda d={d} ids={prestamos.map((p) => p.id)} moneda={moneda} deshabilitado={!enLinea} />
        </div>
      )}

      <HojaAbono deuda={abonar} moneda={moneda} alCerrar={() => setAbonar(null)} />
      <HojaPrestamo valor={hojaPrestamo} personas={personas.map((p) => p.persona)} moneda={moneda} alCerrar={() => setHojaPrestamo(null)} />
      <HojaPersona abierta={editarPersona && !!d} d={d} ids={prestamos.map((p) => p.id)} alCerrar={() => setEditarPersona(false)} />
      <Confirmar
        abierto={!!abonoABorrar}
        onAbiertoChange={(v) => !v && setAbonoABorrar(null)}
        titulo="¿Borrar este abono?"
        descripcion={
          abonoABorrar
            ? `${dinero(abonoABorrar.montoCentavos, moneda)} del ${fDia.format(new Date(abonoABorrar.fecha)).replace(".", "")}. La deuda vuelve a subir y, si salió de una cuenta, el dinero regresa.`
            : ""
        }
        confirmar="Borrar"
        onConfirmar={() => abonoABorrar && void quitarAbono(abonoABorrar)}
      />
    </Pantalla>
  );
}

/** Lo que falta en grande, el anillo de lo pagado y desde cuándo. */
function Hero({ d, moneda }: { d: DeudaPersona; moneda: string }) {
  const pagado = pagadoDe(d);
  const meDebe = d.direccion === "me_deben";
  const saldada = d.pendienteCentavos <= 0;
  return (
    <section aria-label="Lo que falta" className="rounded-[20px] bg-card p-4">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <Anillos
            tamano={104}
            grosor={12}
            className="max-[379px]:size-[84px]"
            anillos={[{ progreso: pagado, color: colorDeuda(d), etiqueta: meDebe ? "Te ha pagado" : "Abonado" }]}
          />
          <span className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
            <span className="text-[20px] font-bold tabular max-[379px]:text-[17px]" data-testid="pagado">
              {pct(pagado)}
            </span>
            <span className="text-[11px] text-muted-foreground">pagado</span>
          </span>
        </div>
        <dl className="min-w-0 flex-1 space-y-2">
          <div>
            <dt className="text-[13px] font-medium text-muted-foreground">{saldada ? "Saldada" : meDebe ? "Te falta cobrar" : "Te falta pagar"}</dt>
            <Ajustado
              como="dd"
              data-testid="falta"
              className={cn(
                "truncate text-[28px] leading-8 font-bold tracking-[-0.02em] tabular max-[379px]:text-[22px] max-[379px]:leading-7",
                meDebe && !saldada && "text-positive",
              )}
            >
              {dinero(d.pendienteCentavos, moneda)}
            </Ajustado>
          </div>
          <div>
            <dt className="text-[13px] font-medium text-muted-foreground">{meDebe ? "Te ha pagado" : "Abonaste"}</dt>
            <dd className="text-[17px] font-semibold tabular">
              {dineroCorto(d.pagadoCentavos, moneda)}
              <span className="font-normal text-muted-foreground"> de {dineroCorto(d.prestadoCentavos, moneda)}</span>
            </dd>
          </div>
        </dl>
      </div>
      <p className="mt-3 pt-3 text-[13px] text-muted-foreground hairline-t">
        {meDebe ? "Le prestaste" : "Te prestó"} desde el {fLargo.format(new Date(d.desde))}
      </p>
    </section>
  );
}

function Accion({
  icono,
  principal,
  children,
  ...props
}: { icono: ReactNode; principal?: boolean; children: ReactNode } & Omit<React.ComponentProps<"button">, "children">) {
  return (
    <button
      type="button"
      className={cn(
        "presionable flex min-h-[72px] min-w-0 flex-col items-start justify-between gap-1.5 rounded-[18px] p-3 text-left text-[15px] leading-5 font-semibold disabled:opacity-50",
        principal ? "bg-tint text-white" : "bg-card text-tint",
      )}
      onClick={(e) => {
        haptico();
        props.onClick?.(e);
      }}
      disabled={props.disabled}
    >
      {icono}
      <span className="break-words">{children}</span>
    </button>
  );
}

function FilaMovimientoDeuda({ m, meDebe, moneda }: { m: MovimientoDeuda; meDebe: boolean; moneda: string }) {
  const fecha = fDia.format(new Date(m.fecha)).replace(".", "");
  // El dinero de un abono sale de la cuenta (o llega, si te pagan); el de un préstamo, al revés.
  const sale = (m.tipo === "abono") !== meDebe;
  const cuenta = m.cuenta ? ` · ${sale ? "desde" : "a"} ${m.cuenta}` : "";
  const abono = m.tipo === "abono";
  return (
    <div className="flex min-h-11 w-full min-w-0 items-center gap-3 px-4 text-left text-[17px]">
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          abono ? "bg-positive/15 text-positive" : "bg-fill text-muted-foreground",
        )}
      >
        {abono ? <HandCoins className="size-[18px]" strokeWidth={2.2} /> : <Plus className="size-[18px]" strokeWidth={2.4} />}
      </span>
      <div className="min-w-0 flex-1 py-2.5">
        <div className="break-words">{abono ? (meDebe ? "Te pagó" : "Abono") : meDebe ? "Le prestaste" : "Te prestó"}</div>
        <div className="text-[15px] leading-snug break-words text-muted-foreground">
          {fecha}
          {cuenta}
          {m.nota ? ` · ${m.nota}` : ""}
        </div>
      </div>
      <span className={cn("shrink-0 font-medium tabular", abono ? "text-positive" : "text-foreground")}>
        {abono ? "−" : "+"}
        {dinero(m.montoCentavos, moneda)}
      </span>
    </div>
  );
}

function BorrarDeuda({ d, ids, moneda, deshabilitado }: { d: DeudaPersona; ids: string[]; moneda: string; deshabilitado: boolean }) {
  const borrar = useBorrarPrestamos();
  const restaurar = useRestaurarPrestamos();
  const [confirmar, setConfirmar] = useState(false);
  if (!ids.length) return null;
  const borrarla = async () => {
    try {
      await borrar.mutateAsync(ids);
      haptico();
      toast(`Borré la deuda con ${d.persona}`, {
        action: { label: "Deshacer", onClick: () => restaurar.mutate(ids, { onSuccess: () => navegar(hashDeuda(d)) }) },
      });
      regresar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };
  return (
    <>
      <Grupo pie="Se borran sus préstamos y abonos. Lo que se movió en tus cuentas se queda.">
        <FilaBoton
          icono={<Trash2 aria-hidden className="size-5 text-destructive" />}
          sangria="3.4rem"
          titulo={<span className="text-destructive">Borrar deuda</span>}
          disabled={deshabilitado || borrar.isPending}
          onClick={() => setConfirmar(true)}
        />
      </Grupo>
      <Confirmar
        abierto={confirmar}
        onAbiertoChange={setConfirmar}
        titulo={`¿Borrar la deuda con ${d.persona}?`}
        descripcion={`${sentidoDe(d)} ${dinero(d.pendienteCentavos, moneda)}. Puedes deshacerlo justo después.`}
        confirmar="Borrar"
        onConfirmar={() => void borrarla()}
      />
    </>
  );
}

const SENTIDOS: { valor: Direccion; etiqueta: string }[] = [
  { valor: "debo", etiqueta: "Yo le debo" },
  { valor: "me_deben", etiqueta: "Me debe" },
];

/** Cambiar el nombre o el sentido de toda la deuda con una persona. */
function HojaPersona({ abierta, d, ids, alCerrar }: { abierta: boolean; d: DeudaPersona | null; ids: string[]; alCerrar: () => void }) {
  const renombrar = useRenombrarDeuda();
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState<Direccion>("debo");
  useEffect(() => {
    if (!abierta || !d) return;
    setNombre(d.persona);
    setDireccion(d.direccion);
  }, [abierta, d]);
  if (!d) return null;
  const listo = !!nombre.trim() && (nombre.trim() !== d.persona || direccion !== d.direccion) && !renombrar.isPending;
  const enviar = async () => {
    if (!listo) return;
    try {
      await renombrar.mutateAsync({ ids, datos: { persona: nombre.trim(), direccion } });
      haptico();
      toast.success("Deuda actualizada");
      alCerrar();
      navegar(hashDeuda({ persona: nombre.trim(), direccion }), { reemplazar: true });
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && alCerrar()}>
      {abierta ? (
        <SheetContent
          titulo="Editar deuda"
          descripcion={d.persona}
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={() => void enviar()}>
              Guardar
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
            <div className="flex justify-center pt-2">
              <Inicial nombre={nombre || d.persona} tamano={72} />
            </div>
            <Grupo>
              <Fila>
                <label htmlFor="nombre-persona" className="shrink-0">
                  Nombre
                </label>
                <CampoFila id="nombre-persona" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} autoCapitalize="words" enterKeyHint="done" />
              </Fila>
            </Grupo>
            <Segmented<Direccion> etiqueta="Quién debe" valor={direccion} onChange={setDireccion} opciones={SENTIDOS} />
            <p className="px-4 text-[13px] leading-snug text-pretty text-muted-foreground">
              Para cambiar un monto, toca ese préstamo en la lista. Para bajar la deuda, registra un abono.
            </p>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
