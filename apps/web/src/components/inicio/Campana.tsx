import { useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { abrirCobros, type Cobro, cobrosParaMostrar, cuandoFue, useAccionCobro, useCobros } from "../../lib/cobros";
import { useEnLinea } from "../../lib/conexion";
import { dinero, hoyIso } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { useAvisos, useQuitarAviso } from "../../lib/plan";
import { hashDe, navegar } from "../../lib/ruta";
import type { Aviso } from "../../lib/tipos";
import { useUnaVez } from "../../lib/una-vez";
import { cn } from "../../lib/utils";
import { ICONOS } from "../Avisos";
import { LogoPago } from "../Logo";
import { Button } from "../ui/button";

const MAXIMO = 3;

/**
 * La campana de Inicio. Su número suma lo que espera algo de ti: lo pendiente de contestar, pagos por confirmar,
 * movimientos por revisar y avisos nuevos. Al tocarla abre una burbuja con lo más reciente ("Se pagó" a un toque) y "Ver todas" lleva al centro de
 * notificaciones.
 */
export function Campana({ porRevisar }: { porRevisar: number }) {
  const [abierta, setAbierta] = useState(false);
  const datos = cobrosParaMostrar(useCobros());
  const avisos = useAvisos();
  const porConfirmar = (datos?.porConfirmar ?? []).filter((c) => !c.pospuesto);
  // Lo pendiente cuenta (y va primero) hasta que lo contestes, aunque ya lo hayas visto.
  const nuevos = (avisos.data ?? [])
    .filter((a) => a.tipo === "pendiente" || !a.leidoEn)
    .sort((a, b) => Number(b.tipo === "pendiente") - Number(a.tipo === "pendiente") || a.prioridad - b.prioridad);
  const n = porConfirmar.length + (porRevisar > 0 ? 1 : 0) + nuevos.length;

  // Al cambiar de pantalla (atrás del sistema, una notificación) se cierra.
  useEffect(() => {
    if (!abierta) return;
    const cerrar = () => setAbierta(false);
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    window.addEventListener("hashchange", cerrar);
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("hashchange", cerrar);
      window.removeEventListener("keydown", tecla);
    };
  }, [abierta]);

  return (
    <>
      <Button
        variant="gray"
        size="icon-sm"
        className="relative"
        aria-label={n ? `Notificaciones, ${n} ${n === 1 ? "pendiente" : "pendientes"}` : "Notificaciones"}
        aria-expanded={abierta}
        aria-haspopup="dialog"
        onClick={() => {
          haptico();
          setAbierta((a) => !a);
        }}
      >
        <Bell strokeWidth={2.3} />
        {n ? (
          <span
            aria-hidden
            data-testid="insignia"
            className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[11px] leading-none font-bold text-white tabular shadow-[0_0_0_2px_var(--background)]"
          >
            {n > 9 ? "9+" : n}
          </span>
        ) : null}
      </Button>
      {abierta
        ? createPortal(
            <Burbuja porConfirmar={porConfirmar} porRevisar={porRevisar} avisos={nuevos} alCerrar={() => setAbierta(false)} />,
            document.body,
          )
        : null}
    </>
  );
}

function Burbuja({
  porConfirmar,
  porRevisar,
  avisos,
  alCerrar,
}: {
  porConfirmar: Cobro[];
  porRevisar: number;
  avisos: Aviso[];
  alCerrar: () => void;
}) {
  const accion = useAccionCobro();
  const quitar = useQuitarAviso();
  const qc = useQueryClient();
  const enLinea = useEnLinea();
  const unaVez = useUnaVez();
  const hoy = hoyIso();
  const nada = !porConfirmar.length && !porRevisar && !avisos.length;

  const pagado = (c: Cobro) =>
    unaVez(async () => {
      try {
        await accion.mutateAsync({ tipo: "confirmar", id: c.id });
        haptico();
        // Abajo: arriba taparía el "Se pagó" del que sigue en la burbuja.
        toast.success(`${c.nombre}: pagado ${dinero(c.montoCentavos, c.moneda)}`, {
          position: "bottom-center",
          action: { label: "Deshacer", onClick: () => accion.mutate({ tipo: "deshacer", id: c.id }) },
        });
      } catch (error) {
        toast.error(mensajeDeError(error), { position: "bottom-center" });
      }
    });

  const ir = (hash: string) => {
    haptico();
    alCerrar();
    navegar(hash);
  };

  const abrirAviso = (a: Aviso) => {
    void quitar
      .mutateAsync({ id: a.id, accion: "leido" })
      .catch(() => {})
      .finally(() => void qc.invalidateQueries({ queryKey: ["plan", "avisos"] }));
    if (a.enlace?.startsWith("#")) ir(a.enlace);
    else ir(hashDe("avisos"));
  };

  const fila =
    "relative flex w-full min-w-0 items-center gap-3 py-2.5 pr-3 pl-3.5 text-left [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[3.6rem] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']";

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-[60] animate-aparecer bg-black/10" onClick={alCerrar} />
      <div
        role="dialog"
        aria-label="Notificaciones"
        // Fondo sólido: con vidrio, lo de Inicio se leía a través. Lo de adentro se desplaza y "Ver todas" queda
        // siempre abajo, a la vista.
        className="fixed top-[calc(env(safe-area-inset-top)+52px)] right-[max(0.625rem,env(safe-area-inset-right))] left-[max(0.625rem,env(safe-area-inset-left))] z-[61] mx-auto flex max-h-[calc(100dvh-env(safe-area-inset-top)-140px)] max-w-[420px] origin-top-right animate-burbuja flex-col overflow-hidden rounded-[22px] border-[0.5px] border-[var(--vidrio-borde)] bg-elevated shadow-[0_18px_50px_rgb(0_0_0/0.22),0_2px_8px_rgb(0_0_0/0.08)] min-[452px]:mr-[max(0.625rem,env(safe-area-inset-right))]"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {nada ? (
            <div className="px-5 py-6 text-center">
              <p className="text-[17px] font-semibold">Estás al día</p>
              <p className="mt-0.5 text-[15px] text-muted-foreground">Nada espera tu respuesta.</p>
            </div>
          ) : null}

          {porConfirmar.length ? (
            <div className="pt-2">
              <h2 className="px-4 pb-0.5 text-[13px] font-medium text-muted-foreground">Por confirmar</h2>
              <div>
                {porConfirmar.slice(0, MAXIMO).map((c) => (
                  // En pantallas angostas (≤360 px) la pregunta usa todo el ancho y "Se pagó" baja junto a los detalles,
                  // en chico. Toda la fila abre el cobro, menos "Se pagó", que va encima.
                  <div key={c.id} data-cobro={c.id} className={cn(fila, "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-y-0.5 max-[360px]:gap-x-2.5")}>
                    <LogoPago nombre={c.nombre} tipo={c.tipo} tamano={36} className="col-start-1 row-start-1 row-end-3" />
                    <button
                      type="button"
                      className="col-start-2 row-start-1 min-w-0 self-end text-left after:absolute after:inset-0 after:content-[''] active:opacity-60 max-[360px]:col-end-4"
                      onClick={() => {
                        haptico();
                        alCerrar();
                        abrirCobros([c.id]);
                      }}
                    >
                      <span className="line-clamp-2 text-[16px] leading-5 font-semibold">¿Ya se pagó {c.nombre}?</span>
                    </button>
                    <span className="col-start-2 row-start-2 min-w-0 self-start text-[14px] leading-5 text-muted-foreground max-[360px]:self-center">
                      <span className="tabular">{dinero(c.montoCentavos, c.moneda)}</span> · {cuandoFue(c.fecha, hoy, { corto: true })}
                      {c.cuenta ? ` · ${c.cuenta}` : ""}
                    </span>
                    <Button
                      variant="tinted"
                      size="sm"
                      className="relative z-[1] col-start-3 row-start-1 row-end-3 max-[360px]:row-start-2 max-[360px]:h-[30px] max-[360px]:px-3 max-[360px]:text-[14px]"
                      aria-label={`${c.nombre} se pagó`}
                      disabled={!enLinea}
                      onClick={() => void pagado(c)}
                    >
                      Se pagó
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {porRevisar > 0 || avisos.length ? (
            <div className={cn(porConfirmar.length && "mt-1 border-t-[0.5px] border-separator")}>
              {porRevisar > 0 ? (
                <button type="button" className={cn(fila, "fila-presionable")} onClick={() => ir(hashDe("movimientos", { revisar: "1", mes: "todo" }))}>
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-orange text-white">
                    <CircleAlert className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[16px] leading-5 font-semibold">
                      {porRevisar} {porRevisar === 1 ? "movimiento" : "movimientos"} por revisar
                    </span>
                    <span className="mt-0.5 block text-[14px] leading-5 text-muted-foreground text-pretty">Les falta algo o no estoy seguro</span>
                  </span>
                  <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground/60" />
                </button>
              ) : null}
              {avisos.slice(0, MAXIMO).map((a) => {
                const [Icono, color] = ICONOS[a.tipo] ?? [TriangleAlert, "var(--tint)"];
                return (
                  <button key={a.id} type="button" data-aviso={a.id} className={cn(fila, "fila-presionable items-start")} onClick={() => abrirAviso(a)}>
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
                      style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, var(--card))`, color }}
                    >
                      <Icono className="size-5" strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[16px] leading-5 font-semibold">{a.titulo}</span>
                      <span className="mt-0.5 block break-words text-[14px] leading-5 text-muted-foreground text-pretty">{a.texto}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="flex h-12 w-full shrink-0 items-center justify-center border-t-[0.5px] border-separator bg-elevated text-[15px] font-semibold text-tint active:opacity-60"
          onClick={() => ir(hashDe("avisos"))}
        >
          Ver todas
        </button>
      </div>
    </>
  );
}
