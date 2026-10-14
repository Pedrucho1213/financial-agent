import { CircleGauge, GitCommitHorizontal, Inbox, Server, Sparkles } from "lucide-react";
import { mensajeDeError } from "../../lib/api";
import type { EstadoSistema, useEstadoSistema } from "../../lib/cuenta";
import { haceCuanto } from "../../lib/formato";
import { cn } from "../../lib/utils";
import { Fila, Grupo, IconoAjuste } from "../ui/lista";
import { Skeleton } from "../ui/skeleton";

/** Una línea para la fila de Ajustes: verde si todo va bien; si no, qué revisar. */
export function resumenSistema(e: EstadoSistema | null | undefined): { color: string; texto: string } | null {
  if (e === undefined) return null;
  if (e === null) return { color: "#ff9500", texto: "Actualiza el servidor" };
  if (!e.ia.disponible) return { color: "#ff3b30", texto: "IA no disponible" };
  if (e.cola.conError > 0) return { color: "#ff9500", texto: `${e.cola.conError} con error` };
  return { color: "#34c759", texto: "Todo bien" };
}

export function Punto({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

/** Estado de la Mac: servidor, IA y dictados en cola. Un servidor viejo responde 404 y solo se avisa. */
export function Sistema({ estado }: { estado: ReturnType<typeof useEstadoSistema> }) {
  const e = estado.data;
  const ia = e
    ? e.ia.cargada
      ? { color: "#34c759", texto: "Lista" }
      : e.ia.disponible
        ? { color: "#ffcc00", texto: "Se carga al hablar" }
        : { color: "#ff3b30", texto: "No disponible" }
    : null;

  return (
    <Grupo titulo="Sistema" aria-label="Sistema">
      {e === null ? (
        <Fila>
          <p className="py-3 text-[15px] text-muted-foreground">Actualiza el servidor para ver su estado.</p>
        </Fila>
      ) : e && ia ? (
        <>
          <Fila
            sangria="3.75rem"
            icono={
              <IconoAjuste color="#8e8e93">
                <Server />
              </IconoAjuste>
            }
            titulo="Servidor"
            subtitulo={e.servidor ? `Encendido desde ${haceCuanto(e.servidor.arrancadoEn)}` : undefined}
            valor={
              <span className="inline-flex">
                <Punto color="#34c759" />
                <span className="sr-only">En línea</span>
              </span>
            }
          />
          {/* La versión solo le llega al dueño de la instalación. */}
          {e.servidor ? (
            <Fila
              sangria="3.75rem"
              icono={
                <IconoAjuste color="#636366">
                  <GitCommitHorizontal />
                </IconoAjuste>
              }
              titulo="Versión"
              subtitulo={e.servidor.commitEn ? `Desplegada ${haceCuanto(e.servidor.commitEn)}` : undefined}
              valor={<span className="font-mono text-[15px]">{e.servidor.commit?.slice(0, 7) ?? "Sin dato"}</span>}
            />
          ) : null}
          <Fila
            sangria="3.75rem"
            icono={
              <IconoAjuste color="linear-gradient(180deg,#5e5ce6,#1c1c1e)">
                <Sparkles />
              </IconoAjuste>
            }
            titulo="IA"
            subtitulo={e.ia.modelo}
            valor={
              <span className="inline-flex items-center gap-1.5">
                <Punto color={ia.color} />
                {ia.texto}
              </span>
            }
          />
          {e.uso ? <FilaUsoIa uso={e.uso} /> : null}
          {/* Con algo en cola, el detalle va abajo: a la derecha no cabe junto al título. */}
          <Fila
            sangria="3.75rem"
            icono={
              <IconoAjuste color="#007aff">
                <Inbox />
              </IconoAjuste>
            }
            titulo="Dictados"
            subtitulo={
              e.cola.pendientes > 0 || e.cola.conError > 0 ? (
                <>
                  {e.cola.pendientes > 0 ? `${e.cola.pendientes} en proceso` : null}
                  {e.cola.pendientes > 0 && e.cola.conError > 0 ? " · " : null}
                  {e.cola.conError > 0 ? <span className="text-negative">{e.cola.conError} con error</span> : null}
                </>
              ) : undefined
            }
            valor={e.cola.pendientes === 0 && e.cola.conError === 0 ? "Nada pendiente" : undefined}
          />
        </>
      ) : estado.isError ? (
        <Fila>
          <p className="py-3 text-[15px] text-muted-foreground">{mensajeDeError(estado.error)}</p>
        </Fila>
      ) : (
        <div className="space-y-3 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      )}
    </Grupo>
  );
}

const usd = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Consultas de IA de hoy ("7 de 40"); al dueño, además, lo gastado este mes por todas las cuentas. */
function FilaUsoIa({ uso }: { uso: NonNullable<EstadoSistema["uso"]> }) {
  const mes = uso.mes;
  return (
    <Fila
      sangria="3.75rem"
      icono={
        <IconoAjuste color="#ff9500">
          <CircleGauge />
        </IconoAjuste>
      }
      titulo="Consultas de IA hoy"
      subtitulo={
        uso.aviso ??
        (mes
          ? `Este mes, todas las cuentas: ${usd(mes.costoUsd)}${mes.presupuestoUsd ? ` de ${usd(mes.presupuestoUsd)}` : ""} USD`
          : uso.limite !== null
            ? "Se renuevan cada día"
            : undefined)
      }
      valor={
        <span className={cn("tabular-nums", uso.quedan === 0 && !uso.modoBasico && "text-negative")}>
          {uso.limite !== null ? `${uso.consultas} de ${uso.limite}` : uso.consultas}
        </span>
      }
    />
  );
}

