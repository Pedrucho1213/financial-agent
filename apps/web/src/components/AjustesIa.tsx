import { Infinity as Infinito, Power, PowerOff, Timer } from "lucide-react";
import { useEnLinea } from "../lib/conexion";
import { type ControlIa, PLAZOS, useCambiarIa, useControlIa } from "../lib/ia";
import { Spinner } from "./Spinner";
import { Fila, FilaBoton, Grupo, IconoAjuste } from "./ui/lista";
import { Segmented } from "./ui/segmented";
import { Switch } from "./ui/switch";

const hora = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit" });
// Sin espacios que se puedan cortar: a 320 el renglón se parte en el «·», no a media hora.
const pegado = (texto: string) => texto.replace(/\s/g, "\u00a0");
const gb = (bytes: number) => pegado(`${(bytes / 1e9).toLocaleString("es-MX", { maximumFractionDigits: 1 })} GB`);

function describir(ia: ControlIa) {
  if (!ia.disponible && !ia.cargada) return { color: "#ff3b30", texto: "No disponible", detalle: "Ollama no responde o no tiene el modelo." };
  if (ia.cargada) {
    const plazo = ia.hasta ? `Hasta ${pegado(hora.format(new Date(ia.hasta)))}` : "Sin límite";
    return { color: "#34c759", texto: "Encendida", detalle: ia.memoria ? `${plazo} · ${gb(ia.memoria)}` : plazo };
  }
  if (ia.apagadaAMano) return { color: "#8e8e93", texto: "Apagada", detalle: "Se enciende con tu próximo dictado." };
  if (ia.siempre) return { color: "#ffcc00", texto: "Encendiéndose", detalle: "Tu Mac la carga en menos de un minuto." };
  return { color: "#8e8e93", texto: "Apagada", detalle: "Se enciende al dictar." };
}

/**
 * Ajustes › IA: herramienta de desarrollo para dejar el modelo siempre en memoria o soltarlo tras un rato,
 * y encenderlo o apagarlo a mano. Solo para la cuenta dueña; desaparece con IA_INTERRUPTOR=0 en la Mac.
 */
export function AjustesIa({ habilitado }: { habilitado: boolean }) {
  const enLinea = useEnLinea();
  const consulta = useControlIa(habilitado);
  const cambiar = useCambiarIa();
  const ia = consulta.data;
  if (!habilitado || !ia) return null;

  const e = describir(ia);
  const trabajando = cambiar.isPending && cambiar.variables?.tipo !== "modo";
  const bloqueado = !enLinea || cambiar.isPending;

  return (
    <Grupo
      titulo="IA en tu Mac"
      aria-label="IA en tu Mac"
      pie="Herramienta de desarrollo, solo la ves tú. Encendida contesta en unos 2 s y ocupa unos 8 GB de memoria; apagada, el primer dictado tarda unos 13 s."
    >
      <Fila
        sangria="3.75rem"
        icono={
          <IconoAjuste color={ia.cargada ? "linear-gradient(180deg,#4cd964,#34c759)" : "#8e8e93"}>
            <Power />
          </IconoAjuste>
        }
        titulo="Estado"
        // Puede ocupar dos renglones a 320: que no se corte la hora ni la memoria.
        subtitulo={<span className="whitespace-normal">{e.detalle}</span>}
        valor={
          <span className="inline-flex items-center gap-1.5" aria-live="polite">
            <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
            {e.texto}
          </span>
        }
      />
      <Fila
        sangria="3.75rem"
        icono={
          <IconoAjuste color="linear-gradient(180deg,#5e5ce6,#3634a3)">
            <Infinito />
          </IconoAjuste>
        }
        titulo={<span className="whitespace-normal">Siempre encendida</span>}
        valor={
          <Switch
            aria-label="Siempre encendida"
            checked={ia.siempre}
            disabled={bloqueado}
            onCheckedChange={(siempre) => cambiar.mutate({ tipo: "modo", cambio: { siempre } })}
          />
        }
      />
      {ia.siempre ? null : (
        // Sin icono a la izquierda: a 320 los cuatro plazos caben completos.
        <Fila>
          <div className="min-w-0 flex-1 py-2.5">
            <div className="flex items-center gap-2 pb-2">
              <Timer aria-hidden className="size-[18px] text-[#ff9500]" />
              Apagar tras {ia.minutos === 60 ? "1 hora" : `${ia.minutos} min`} sin uso
            </div>
            <Segmented
              etiqueta="Apagar tras"
              opciones={PLAZOS.map((m) => ({ valor: String(m), etiqueta: m === 60 ? "1 h" : `${m} min` }))}
              valor={String(ia.minutos)}
              onChange={(v) => {
                if (!bloqueado && Number(v) !== ia.minutos) cambiar.mutate({ tipo: "modo", cambio: { minutos: Number(v) } });
              }}
            />
          </div>
        </Fila>
      )}
      <FilaBoton
        sangria="3.75rem"
        icono={
          <IconoAjuste color={ia.cargada ? "linear-gradient(180deg,#ff6b5f,#ff3b30)" : "linear-gradient(180deg,#4cd964,#34c759)"}>
            {ia.cargada ? <PowerOff /> : <Power />}
          </IconoAjuste>
        }
        titulo={
          <span className={ia.cargada ? "text-destructive" : "text-primary"}>
            {trabajando
              ? cambiar.variables?.tipo === "apagar"
                ? "Apagando…"
                : "Encendiendo…"
              : ia.cargada
                ? "Apagar ahora"
                : "Encender ahora"}
          </span>
        }
        valor={trabajando ? <Spinner className="size-4" /> : undefined}
        disabled={bloqueado || (!ia.cargada && !ia.disponible)}
        onClick={() => cambiar.mutate({ tipo: ia.cargada ? "apagar" : "encender" })}
      />
    </Grupo>
  );
}
