import { Bell } from "lucide-react";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { abrirCobros, type Cobro, cobrosParaMostrar, cuandoFue, useAccionCobro, useCobros } from "../../lib/cobros";
import { useEnLinea } from "../../lib/conexion";
import { dinero, hoyIso } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { hashDe, navegar } from "../../lib/ruta";
import { useUnaVez } from "../../lib/una-vez";
import { HojaCalendario } from "../HojaCalendario";
import { Button } from "../ui/button";

const MAXIMO = 3;

/**
 * Arriba de Inicio, el día del cobro: "¿Ya se pagó Netflix?" con "Se pagó" a un toque. Tocar la fila abre la hoja
 * (otro monto, otra cuenta, todavía no, no se pagó). Los que dijo "todavía no" esperan a mañana.
 */
export function PorConfirmar() {
  const datos = cobrosParaMostrar(useCobros());
  const accion = useAccionCobro();
  const enLinea = useEnLinea();
  const unaVez = useUnaVez();
  const hoy = hoyIso();
  const filas = (datos?.porConfirmar ?? []).filter((c) => !c.pospuesto);
  if (!filas.length) return null;

  const pagado = (c: Cobro) =>
    unaVez(async () => {
      try {
        await accion.mutateAsync({ tipo: "confirmar", id: c.id });
        haptico();
        toast.success(`${c.nombre}: pagado ${dinero(c.montoCentavos, c.moneda)}`, {
          action: { label: "Deshacer", onClick: () => accion.mutate({ tipo: "deshacer", id: c.id }) },
        });
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  const visibles = filas.slice(0, MAXIMO);
  return (
    <section aria-label="Pagos por confirmar">
      <h2 className="px-4 pb-1.5 text-[13px] text-muted-foreground">{filas.length === 1 ? "¿Ya se pagó?" : "¿Ya se pagaron?"}</h2>
      <div className="overflow-hidden rounded-[20px] bg-card">
        {visibles.map((c) => (
          <div
            key={c.id}
            data-cobro={c.id}
            className="relative flex items-center gap-3 py-0.5 pr-3 pl-4 animate-entrar [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[4rem] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
          >
            <HojaCalendario fecha={c.fecha} />
            <button
              type="button"
              className="min-w-0 flex-1 py-2.5 text-left active:opacity-60"
              onClick={() => {
                haptico();
                abrirCobros([c.id]);
              }}
            >
              <span className="block truncate text-[15px] leading-5 font-semibold">{c.nombre}</span>
              <span className="mt-0.5 block truncate text-[15px] leading-5 text-muted-foreground">
                <span className="tabular">{dinero(c.montoCentavos, c.moneda)}</span> · {cuandoFue(c.fecha, hoy, { corto: true })}
                {c.cuenta ? ` · ${c.cuenta}` : ""}
              </span>
            </button>
            <Button variant="tinted" size="sm" aria-label={`${c.nombre} se pagó`} disabled={!enLinea} onClick={() => void pagado(c)}>
              Se pagó
            </Button>
          </div>
        ))}
        {filas.length > MAXIMO ? (
          <button
            type="button"
            className="relative flex h-11 w-full items-center justify-center text-[15px] font-semibold text-tint before:absolute before:top-0 before:right-0 before:left-4 before:h-[0.5px] before:bg-separator before:content-[''] active:opacity-60"
            onClick={() => abrirCobros(filas.map((c) => c.id))}
          >
            Ver los {filas.length}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** La campana de Inicio: abre el centro de notificaciones, con cuántos pagos esperan respuesta. */
export function Campana() {
  const q = useCobros();
  const datos = cobrosParaMostrar(q);
  if (!datos) return null;
  const n = datos.insignia;
  return (
    <Button
      variant="gray"
      size="icon-sm"
      className="relative"
      aria-label={n ? `Notificaciones, ${n} por confirmar` : "Notificaciones"}
      onClick={() => navegar(hashDe("avisos"))}
    >
      <Bell strokeWidth={2.3} />
      {n ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[11px] leading-none font-bold text-white tabular"
        >
          {n > 9 ? "9+" : n}
        </span>
      ) : null}
    </Button>
  );
}
