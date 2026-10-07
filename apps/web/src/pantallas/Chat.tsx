import { ArrowUp, Check, CircleAlert, Clock, MessageCircle, Mic, RotateCw, Search, SquarePen, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { FilaBoton, Grupo } from "../components/ui/lista";
import {
  accionCambiaDatos,
  enviarMensaje,
  etiquetaAccion,
  type Mensaje,
  nuevaConversacion,
  reintentar,
  useChat,
} from "../lib/chat";
import { useEnLinea } from "../lib/conexion";
import { useTeclado } from "../lib/teclado";
import { cn } from "../lib/utils";

const SUGERENCIAS = [
  "¿Cómo voy este mes?",
  "¿En qué puedo ahorrar?",
  "Gasté 85 en café con débito",
  "¿Qué pagos fijos tengo?",
];

// Web Speech API: solo existe en algunos navegadores (Safari y Chrome la tienen con prefijo).
type ResultadoVoz = { isFinal: boolean; 0: { transcript: string } };
type EventoVoz = { results: ArrayLike<ResultadoVoz> };
type Reconocedor = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: EventoVoz) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type ConstructorReconocedor = new () => Reconocedor;

function reconocedorDisponible(): ConstructorReconocedor | null {
  const w = window as unknown as { SpeechRecognition?: ConstructorReconocedor; webkitSpeechRecognition?: ConstructorReconocedor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function Chat() {
  const { mensajes } = useChat();
  const enLinea = useEnLinea();
  const teclado = useTeclado();
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const final = useRef<HTMLDivElement>(null);
  const ocupado = mensajes.some((m) => m.estado === "pensando");

  // Bajar al último mensaje cuando llega algo nuevo.
  const ultimo = mensajes.at(-1);
  useLayoutEffect(() => {
    final.current?.scrollIntoView({ block: "end", behavior: mensajes.length > 2 ? "smooth" : "auto" });
  }, [mensajes.length, ultimo?.texto, ultimo?.estado]);

  // El campo crece con el texto, hasta 5 líneas.
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 22 * 5 + 14)}px`;
  }, [texto]);

  const enviar = (t = texto) => {
    if (!t.trim() || !enLinea || ocupado) return;
    setTexto("");
    void enviarMensaje(t);
  };

  return (
    <Pantalla
      titulo="Chat"
      barraFija
      className="bg-card dark:bg-background"
      derecha={
        mensajes.length ? (
          <Button variant="plain" size="icon" aria-label="Nueva conversación" onClick={nuevaConversacion}>
            <SquarePen className="size-[22px]" />
          </Button>
        ) : null
      }
    >
      <div className="pb-24">
        {mensajes.length === 0 ? (
          <div className="flex flex-col items-center pt-10 text-center animate-entrar">
            <span
              aria-hidden
              className="flex size-16 items-center justify-center rounded-[18px] bg-linear-to-b from-[#5ac8fa] to-[#007aff] text-white shadow-[0_8px_24px_rgb(0_122_255/0.3)]"
            >
              <MessageCircle className="size-8" fill="currentColor" strokeWidth={0} />
            </span>
            <h1 className="mt-5 text-[28px] leading-tight font-bold tracking-[-0.02em]">¿En qué te ayudo?</h1>
            <p className="mt-2 max-w-[18rem] text-[17px] leading-snug text-balance text-muted-foreground">
              Pregunta por tus gastos o dime lo que compraste.
            </p>
            <Grupo className="mt-8 w-full text-left">
              {SUGERENCIAS.map((s) => (
                <FilaBoton
                  key={s}
                  titulo={<span className="text-tint">{s}</span>}
                  icono={<ArrowUp aria-hidden className="size-[18px] rotate-45 text-tint" strokeWidth={2.5} />}
                  sangria="2.9rem"
                  disabled={!enLinea}
                  onClick={() => enviar(s)}
                />
              ))}
            </Grupo>
          </div>
        ) : (
          <ol className="flex flex-col pt-2" aria-live="polite">
            {mensajes.map((m, i) => (
              <Burbuja key={m.id} m={m} pegada={mensajes[i - 1]?.rol === m.rol} enLinea={enLinea} />
            ))}
          </ol>
        )}
        <div ref={final} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
        className={cn(
          "pointer-events-none fixed inset-x-0 z-30 transition-[bottom] duration-300 ease-ios",
          teclado ? "bottom-[calc(var(--teclado,0px)+8px)]" : "bottom-[calc(var(--barra-inferior)+10px)]",
        )}
      >
        <div className="pointer-events-auto mx-auto flex max-w-3xl items-end gap-2 px-safe">
          <BotonMicrofono
            deshabilitado={!enLinea || ocupado}
            alTexto={setTexto}
            alTerminar={(t) => enviar(t)}
          />
          <div className={cn("vidrio relative flex min-h-11 min-w-0 flex-1 items-end rounded-[22px]", ocupado && "brillo-ia")}>
            <label htmlFor="mensaje" className="sr-only">
              Mensaje
            </label>
            <textarea
              ref={campo}
              id="mensaje"
              rows={1}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  enviar();
                }
              }}
              enterKeyHint="send"
              placeholder={enLinea ? "Pregunta o dime un gasto" : "Sin conexión"}
              disabled={!enLinea}
              className="block max-h-[124px] min-h-11 w-full resize-none bg-transparent py-[11px] pr-12 pl-4 text-[17px] leading-[22px] outline-none placeholder:text-placeholder"
            />
            <button
              type="submit"
              aria-label="Enviar"
              disabled={!texto.trim() || !enLinea || ocupado}
              className="absolute right-[5px] bottom-[5px] flex size-[34px] items-center justify-center rounded-full bg-primary text-white transition-[transform,opacity] duration-200 ease-ios active:scale-90 disabled:scale-75 disabled:opacity-0"
            >
              <ArrowUp className="size-[19px]" strokeWidth={3} />
            </button>
          </div>
        </div>
      </form>
    </Pantalla>
  );
}

function Burbuja({ m, pegada, enLinea }: { m: Mensaje; pegada: boolean; enLinea: boolean }) {
  const mia = m.rol === "yo";
  return (
    <li className={cn("flex flex-col animate-burbuja", mia ? "items-end" : "items-start", pegada ? "mt-1" : "mt-3")}>
      {m.estado === "pensando" && !m.texto ? (
        <div className="flex h-[38px] items-center gap-1 rounded-[20px] rounded-bl-md bg-bubble-in px-4" aria-label="Pensando">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-2 animate-punto rounded-full bg-muted-foreground"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      ) : (
        <div
          data-seleccionable
          className={cn(
            "max-w-[82%] rounded-[20px] px-3.5 py-2 text-[17px] leading-[22px] break-words whitespace-pre-wrap",
            mia ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-bubble-in text-foreground",
            m.estado === "esperando" && "text-muted-foreground",
          )}
        >
          {m.texto}
        </div>
      )}
      {m.estado === "esperando" ? (
        <span className="mt-1 flex items-center gap-1.5 px-2 text-[12px] text-muted-foreground">
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1 animate-punto rounded-full bg-current" style={{ animationDelay: `${i * 0.18}s` }} />
            ))}
          </span>
          Sigo pensando
        </span>
      ) : null}
      {m.estado === "pendiente" ? (
        <span className="mt-1 flex items-center gap-1 px-2 text-[12px] text-muted-foreground">
          <Clock className="size-3" /> Se termina en tu Mac
        </span>
      ) : null}
      {m.estado === "error" ? (
        <div className="mt-1 flex items-center gap-2 px-2">
          <span className="flex items-center gap-1 text-[12px] text-negative">
            <CircleAlert className="size-3" /> No se completó
          </span>
          {m.reintentable ? (
            <Button
              variant="tinted"
              size="sm"
              className="relative h-7 gap-1 px-2.5 text-[13px] after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] [&_svg:not([class*='size-'])]:size-3.5"
              disabled={!enLinea}
              onClick={() => void reintentar(m.id)}
            >
              <RotateCw strokeWidth={2.5} /> Reintentar
            </Button>
          ) : null}
        </div>
      ) : null}
      {m.acciones?.length ? (
        <ul className="mt-1.5 flex max-w-[90%] flex-wrap gap-1.5" aria-label="Lo que hizo">
          {m.acciones.map((a, i) => {
            const cambia = accionCambiaDatos(a);
            return (
              <li
                key={`${a.herramienta}-${i}`}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold",
                  cambia ? "bg-positive/15 text-positive" : "bg-fill text-muted-foreground",
                )}
              >
                {cambia ? <Check className="size-3" strokeWidth={3} /> : <Search className="size-3" strokeWidth={2.5} />}
                {etiquetaAccion(a)}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function BotonMicrofono({
  deshabilitado,
  alTexto,
  alTerminar,
}: {
  deshabilitado: boolean;
  alTexto: (t: string) => void;
  alTerminar: (t: string) => void;
}) {
  const [Reconocimiento] = useState(reconocedorDisponible);
  const [escuchando, setEscuchando] = useState(false);
  const activo = useRef<Reconocedor | null>(null);

  useEffect(() => () => activo.current?.stop(), []);

  if (!Reconocimiento) return null;

  const alternar = () => {
    if (escuchando) {
      activo.current?.stop();
      return;
    }
    const rec = new Reconocimiento();
    rec.lang = "es-MX";
    rec.interimResults = true;
    rec.continuous = false;
    let dicho = "";
    let terminado = false;
    rec.onresult = (e) => {
      dicho = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("")
        .trim();
      terminado = Array.from(e.results).every((r) => r.isFinal);
      alTexto(dicho);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast.error("Permite el micrófono para dictar.");
      }
    };
    rec.onend = () => {
      setEscuchando(false);
      activo.current = null;
      if (dicho && terminado) alTerminar(dicho);
    };
    activo.current = rec;
    setEscuchando(true);
    rec.start();
  };

  return (
    <button
      type="button"
      onClick={alternar}
      disabled={deshabilitado && !escuchando}
      aria-label={escuchando ? "Dejar de escuchar" : "Dictar"}
      aria-pressed={escuchando}
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-200 ease-ios active:scale-90 disabled:opacity-40",
        escuchando ? "bg-destructive text-white" : "vidrio text-tint",
      )}
    >
      {escuchando ? (
        <>
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-destructive/50" />
          <Square className="relative size-3.5" fill="currentColor" />
        </>
      ) : (
        <Mic className="size-[22px]" />
      )}
    </button>
  );
}
