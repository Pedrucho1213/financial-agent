import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { mensajeErrorDictado, type Reconocedor, reconocedorDisponible, unirDictado } from "./voz";

/** Tras una pausa así de larga se da por terminado lo dicho (Safari a veces no corta solo). */
export const SILENCIO_MS = 1800;
/** Si en este tiempo no se oyó nada, se deja de escuchar. */
export const SIN_VOZ_MS = 8000;

type Opciones = {
  /** Lo dicho hasta ahora, unido a lo que ya estaba escrito. */
  alTexto: (t: string) => void;
  /** Terminó de hablar: se manda lo dicho. */
  alTerminar: (t: string) => void;
};

/**
 * Dictado para el chat: escucha, va escribiendo lo que entiende y lo manda solo al terminar de hablar.
 * Cancelar deja el campo como estaba. `automatico` es cuando la IA preguntó algo y se vuelve a escuchar
 * sin tocar nada: ahí un silencio o un permiso negado no muestran avisos.
 */
export function useDictado({ alTexto, alTerminar }: Opciones) {
  const [Reconocimiento] = useState(reconocedorDisponible);
  const [escuchando, setEscuchando] = useState(false);
  const [oyendo, setOyendo] = useState(false);
  const activo = useRef<{ rec: Reconocedor; cancelado: boolean; terminar: () => void } | null>(null);
  const callbacks = useRef({ alTexto, alTerminar });
  callbacks.current = { alTexto, alTerminar };

  useEffect(
    () => () => {
      if (activo.current) {
        activo.current.cancelado = true;
        activo.current.rec.abort();
      }
    },
    [],
  );

  const empezar = (base: string, automatico = false) => {
    if (!Reconocimiento || activo.current) return;
    const rec = new Reconocimiento();
    rec.lang = "es-MX";
    rec.interimResults = true;
    rec.continuous = false;
    let dicho = "";
    let aviso: string | null = null;
    let reloj = 0;
    const sesion = { rec, cancelado: false, terminar: () => rec.stop() };
    const esperar = (ms: number) => {
      window.clearTimeout(reloj);
      reloj = window.setTimeout(() => rec.stop(), ms);
    };
    rec.onresult = (e) => {
      dicho = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("")
        .trim();
      if (sesion.cancelado) return;
      setOyendo(true);
      callbacks.current.alTexto(unirDictado(base, dicho));
      esperar(SILENCIO_MS);
    };
    rec.onerror = (e) => {
      if (automatico || sesion.cancelado) return;
      aviso = mensajeErrorDictado(e.error);
    };
    rec.onend = () => {
      window.clearTimeout(reloj);
      activo.current = null;
      setEscuchando(false);
      setOyendo(false);
      if (sesion.cancelado) {
        callbacks.current.alTexto(base);
        return;
      }
      // En iPhone el último resultado a veces no llega marcado como final: se manda lo que se oyó.
      if (dicho) return callbacks.current.alTerminar(unirDictado(base, dicho));
      if (aviso) toast.error(aviso);
      else if (!automatico) toast("No te escuché. Toca el micrófono y vuelve a intentarlo.");
    };
    activo.current = sesion;
    setEscuchando(true);
    try {
      rec.start();
      esperar(SIN_VOZ_MS);
    } catch {
      activo.current = null;
      setEscuchando(false);
    }
  };

  /** Deja de escuchar y manda lo que se oyó. */
  const terminar = () => activo.current?.terminar();

  /** Deja de escuchar sin mandar nada; el campo vuelve a lo que tenía. */
  const cancelar = () => {
    const a = activo.current;
    if (!a) return;
    a.cancelado = true;
    a.rec.abort();
  };

  return { disponible: !!Reconocimiento, escuchando, oyendo, empezar, terminar, cancelar };
}
