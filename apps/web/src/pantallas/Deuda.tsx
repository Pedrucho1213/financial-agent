import { HandCoins, Mic, Pencil, Plus, Trash2 } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Ajustado } from "../components/Ajustado";
import { Anillos } from "../components/Anillos";
import { HojaAbono } from "../components/deudas/HojaAbono";
import { HojaEditarDeuda } from "../components/deudas/HojaEditarDeuda";
import { HojaPrestamo, type ValorHojaPrestamo } from "../components/deudas/HojaPrestamo";
import { colorDeuda, comoSeDice, pagadoDe, SaldoDeuda, sentidoDe } from "../components/deudas/Piezas";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { Confirmar } from "../components/ui/dialog";
import { Fila, FilaBoton, Grupo } from "../components/ui/lista";
import { Skeleton } from "../components/ui/skeleton";
import { ofrecerDeshacer } from "../lib/acciones";
import { mensajeDeError } from "../lib/api";
import { useEnLinea } from "../lib/conexion";
import { useYo } from "../lib/consultas";
import { buscarDeuda, type Direccion, estaSaldada, personasDe, useBorrarDeuda, usePrestamos } from "../lib/deudas";
import { dinero, dineroCorto, pct } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { hashDe, navegar } from "../lib/ruta";
import type { DeudaPersona, MovimientoDeuda } from "../lib/tipos";
import { cn } from "../lib/utils";

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
  const consulta = usePrestamos({ todos: true });
  const enLinea = useEnLinea();
  const [abonar, setAbonar] = useState<DeudaPersona | null>(null);
  const [masPrestamo, setMasPrestamo] = useState<ValorHojaPrestamo | null>(null);
  const [editar, setEditar] = useState<DeudaPersona | null>(null);

  const personas = personasDe(consulta.data);
  const d = buscarDeuda(personas, persona, direccion);
  // Con la edición apagada (o un servidor viejo) solo se ve: abonar, editar y borrar quedan para la voz.
  const edicion = consulta.data?.edicion === true && !!d?.id;
  const meDebe = direccion === "me_deben";

  return (
    <Pantalla
      titulo={d?.persona ?? (persona || "Deuda")}
      encima={d ? sentidoDe(d) : undefined}
      atras={{ etiqueta: "Atrás", alTocar: regresar }}
      derecha={
        d && edicion ? (
          <Button variant="gray" size="icon-sm" aria-label="Editar deuda" disabled={!enLinea} onClick={() => setEditar(d)}>
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

          {edicion ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Accion
                icono={<HandCoins className="size-5" strokeWidth={2.2} />}
                principal
                disabled={!enLinea || estaSaldada(d)}
                onClick={() => setAbonar(d)}
              >
                {meDebe ? "Registrar pago" : "Registrar abono"}
              </Accion>
              <Accion
                icono={<Plus className="size-5" strokeWidth={2.4} />}
                disabled={!enLinea}
                onClick={() => setMasPrestamo({ persona: d.persona, direccion: d.direccion })}
              >
                {meDebe ? "Le presté más" : "Me prestó más"}
              </Accion>
            </div>
          ) : null}

          {d.movimientos.some((m) => m.tipo === "abono") ? (
            <Grupo titulo="Cómo ha bajado">
              <div className="px-4 pt-3 pb-2">
                <SaldoDeuda movimientos={d.movimientos} color={colorDeuda(d)} />
              </div>
            </Grupo>
          ) : null}

          <Grupo titulo="Préstamos y abonos" pie={d.descripcion ? `Nota: ${d.descripcion}` : undefined}>
            {d.movimientos.map((m, i) => (
              <FilaMovimientoDeuda key={`${m.fecha}-${i}`} m={m} meDebe={meDebe} moneda={moneda} />
            ))}
          </Grupo>

          <p className="flex items-start gap-1.5 px-4 text-[13px] leading-snug text-muted-foreground">
            <Mic className="mt-0.5 size-3.5 shrink-0" />
            {meDebe
              ? `También por voz: «${d.persona} me depositó 500». Si te equivocas, di «deshaz eso».`
              : `También por voz: «le transferí 2 mil a ${comoSeDice(d.persona)} desde Revolut». Si te equivocas, di «deshaz eso».`}
          </p>

          {edicion && d.id ? <BorrarDeuda d={d} id={d.id} moneda={moneda} deshabilitado={!enLinea} /> : null}
        </div>
      )}

      <HojaAbono deuda={abonar} moneda={moneda} alCerrar={() => setAbonar(null)} />
      <HojaPrestamo valor={masPrestamo} personas={[]} moneda={moneda} alCerrar={() => setMasPrestamo(null)} />
      <HojaEditarDeuda deuda={editar} moneda={moneda} alCerrar={() => setEditar(null)} />
    </Pantalla>
  );
}

/** Lo que falta en grande, el anillo de lo pagado y desde cuándo. */
function Hero({ d, moneda }: { d: DeudaPersona; moneda: string }) {
  const pagado = pagadoDe(d);
  const meDebe = d.direccion === "me_deben";
  const saldada = estaSaldada(d);
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
              <span className="whitespace-nowrap">{dineroCorto(d.pagadoCentavos, moneda)}</span>
              <span className="font-normal text-muted-foreground">
                {" "}
                de <span className="whitespace-nowrap">{dineroCorto(d.prestadoCentavos, moneda)}</span>
              </span>
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
  onClick,
  disabled,
}: { icono: ReactNode; principal?: boolean; children: ReactNode } & Pick<ComponentProps<"button">, "onClick" | "disabled">) {
  return (
    <button
      type="button"
      className={cn(
        "presionable flex min-h-[72px] min-w-0 flex-col items-start justify-between gap-1.5 rounded-[18px] p-3 text-left text-[15px] leading-5 font-semibold disabled:opacity-50",
        principal ? "bg-tint text-white" : "bg-card text-tint",
      )}
      onClick={(e) => {
        haptico();
        onClick?.(e);
      }}
      disabled={disabled}
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
  const abono = m.tipo === "abono";
  return (
    <Fila sangria="4rem">
      <span
        aria-hidden
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", abono ? "bg-positive/15 text-positive" : "bg-fill text-muted-foreground")}
      >
        {abono ? <HandCoins className="size-[18px]" strokeWidth={2.2} /> : <Plus className="size-[18px]" strokeWidth={2.4} />}
      </span>
      <div className="min-w-0 flex-1 py-2.5">
        <div className="break-words">{abono ? (meDebe ? "Te pagó" : "Abono") : meDebe ? "Le prestaste" : "Te prestó"}</div>
        <div className="text-[15px] leading-snug break-words text-muted-foreground">
          {fecha}
          {m.cuenta ? ` · ${sale ? "desde" : "a"} ${m.cuenta}` : ""}
        </div>
      </div>
      <span className={cn("shrink-0 font-medium tabular", abono ? "text-positive" : "text-foreground")}>
        {abono ? "−" : "+"}
        {dinero(m.montoCentavos, moneda)}
      </span>
    </Fila>
  );
}

function BorrarDeuda({ d, id, moneda, deshabilitado }: { d: DeudaPersona; id: string; moneda: string; deshabilitado: boolean }) {
  const borrar = useBorrarDeuda();
  const [confirmar, setConfirmar] = useState(false);
  const borrarla = async () => {
    try {
      await borrar.mutateAsync(id);
      haptico();
      ofrecerDeshacer(`Borré la deuda con ${d.persona}`);
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
