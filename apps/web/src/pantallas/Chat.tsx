import { ArrowUp, ArrowUpRight, AudioLines, Check, CircleAlert, Clock, Mic, RotateCw, Search, Sparkles, SquarePen, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ContenidoMovimiento } from "../components/FilaMovimiento";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { FilaBoton, Grupo } from "../components/ui/lista";
import {
  accionCambiaDatos,
  enviarMensaje,
  etiquetaAccion,
  idsRegistrados,
  type Mensaje,
  nuevaConversacion,
  reintentar,
  abrirConversacion,
  useChat,
  yaSeLeyo,
} from "../lib/chat";
import { eliminarConDeshacer } from "../lib/acciones";
import { mensajeDeError } from "../lib/api";
import { abrirDetalle, useMovimiento } from "../lib/consultas";
import { type EstadoSistema, useEstadoSistema } from "../lib/cuenta";
import { hashDe, navegar, useRuta } from "../lib/ruta";
import { useEnLinea } from "../lib/conexion";
import { useDictado } from "../lib/dictado";
import { useTeclado } from "../lib/teclado";
import { cn } from "../lib/utils";
import { callar, cambiarLeerEnVoz, desbloquearLectura, lecturaDisponible, leer, useVoz } from "../lib/voz";

const SUGERENCIAS = [
  "¿Cómo voy este mes?",
  "¿En qué puedo ahorrar?",
  "Gasté 85 en café con débito",
  "¿Qué pagos fijos tengo?",
];

/** Las respuestas y las fichas son tarjetas blancas sobre el fondo gris; en oscuro no llevan sombra. */
const SOMBRA = "shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_18px_rgb(0_0_0/0.05)] dark:shadow-none";

/** Fichas bajo la última respuesta para seguir preguntando (las que ya preguntaste no salen). */
const FICHAS = ["¿Cómo voy este mes?", "¿En qué puedo ahorrar?", "¿Qué pagos fijos tengo?", "¿Cuánto debo en tarjetas?"];

export function Chat() {
  const { mensajes } = useChat();
  const enLinea = useEnLinea();
  const teclado = useTeclado();
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const final = useRef<HTMLDivElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  // Alto de la caja de texto (crece hasta 5 líneas, con el contador encima): la conversación deja ese espacio abajo.
  const [altoEntrada, setAltoEntrada] = useState(54);
  const ocupado = mensajes.some((m) => m.estado === "pensando");
  const { leerEnVoz, leyendo } = useVoz();
  const dictado = useDictado({ alTexto: setTexto, alTerminar: (t) => enviar(t, true) });
  const estado = useEstadoSistema();
  const uso = estado.data?.uso;
  const maximo = uso?.maxCaracteres ?? 1500;
  const largo = texto.trim().length;
  const muyLargo = largo > maximo;
  // Con algo escrito, el micrófono se quita para darle espacio a la caja (para dictar más, el del teclado).
  const ocultarMic = largo > 0 && !dictado.escuchando;

  // Una notificación con una pregunta o un problema abre #chat?conversacion=<id>: se carga esa conversación
  // para leer el mensaje y contestar ahí. El parámetro se quita para no recargarla al volver a la pestaña.
  const conversacion = useRuta().params.get("conversacion");
  useEffect(() => {
    if (!conversacion) return;
    navegar(hashDe("chat"), { reemplazar: true });
    abrirConversacion(conversacion).catch((error) => toast.error(mensajeDeError(error)));
  }, [conversacion]);

  // Bajar al último mensaje cuando llega algo nuevo.
  const ultimo = mensajes.at(-1);
  useLayoutEffect(() => {
    // Sin mensajes no hay a dónde bajar: la pantalla vacía abre arriba.
    if (!mensajes.length) return;
    final.current?.scrollIntoView({ block: "end", behavior: mensajes.length > 2 ? "smooth" : "auto" });
  }, [mensajes.length, ultimo?.texto, ultimo?.estado]);

  useLayoutEffect(() => {
    const el = formulario.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAltoEntrada(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Si la caja crece mientras escribes, lo último se sigue viendo arriba de ella.
  const hayMensajes = mensajes.length > 0;
  useEffect(() => {
    if (hayMensajes) final.current?.scrollIntoView({ block: "end" });
  }, [altoEntrada, hayMensajes]);

  // El campo crece con el texto, hasta 5 líneas. También al cambiar de ancho (el micrófono se va o regresa):
  // con más ancho, lo que ocupaba dos líneas puede caber en una.
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    const ajustar = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 22 * 5 + 14)}px`;
    };
    ajustar();
    let ancho = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === ancho) return;
      ancho = el.offsetWidth;
      ajustar();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [texto]);

  // Al terminar cada respuesta se vuelve a pedir cuántas consultas quedan.
  const { refetch } = estado;
  useEffect(() => {
    if (!ocupado) void refetch();
  }, [ocupado, refetch]);

  const enviar = (t = texto, porVoz = false) => {
    // Un dictado más largo que el máximo también se manda: la Mac contesta que lo diga en partes.
    if (!t.trim() || !enLinea || ocupado || (!porVoz && t.trim().length > maximo)) return;
    setTexto("");
    callar();
    void enviarMensaje(t, { porVoz });
  };

  const dictar = () => {
    callar();
    desbloquearLectura();
    campo.current?.blur();
    dictado.empezar(texto);
  };

  // Lo que se dictó se contesta en voz alta, como Siri. Si la IA pregunta algo, al terminar de leer
  // vuelve a escuchar para contestarle sin tocar nada (igual que el Atajo).
  const ahora = useRef({ enLinea, ultimoId: ultimo?.id, texto, dictado });
  ahora.current = { enLinea, ultimoId: ultimo?.id, texto, dictado };
  useEffect(() => {
    const m = mensajes.find((x) => x.porVoz && x.estado !== "pensando" && x.estado !== "esperando");
    if (!m) return;
    yaSeLeyo(m.id);
    if (!leerEnVoz || !lecturaDisponible() || document.visibilityState !== "visible") return;
    const pregunta = !m.estado && m.texto.includes("?");
    leer(m.id, m.texto, () => {
      const a = ahora.current;
      if (pregunta && a.enLinea && a.ultimoId === m.id && !a.texto.trim()) a.dictado.empezar("", true);
    });
  }, [mensajes, leerEnVoz]);
  // Al salir de la IA se calla (lo que llegue mientras tanto se lee al volver).
  useEffect(() => () => callar(), []);

  const alternarLectura = () => {
    cambiarLeerEnVoz(!leerEnVoz);
    toast(leerEnVoz ? "Ya no leeré las respuestas en voz alta." : "Te leeré en voz alta lo que me dictes.");
  };

  return (
    <Pantalla
      titulo="IA"
      tituloCompacto={<TituloIa uso={uso} />}
      barraFija
      derecha={
        <div className="flex items-center gap-2">
          {dictado.disponible && lecturaDisponible() ? (
            <Button
              variant="gray"
              size="icon-sm"
              aria-label="Leer respuestas en voz alta"
              aria-pressed={leerEnVoz}
              onClick={alternarLectura}
            >
              {leerEnVoz ? <Volume2 strokeWidth={2.25} /> : <VolumeX strokeWidth={2.25} className="text-muted-foreground" />}
            </Button>
          ) : null}
          {mensajes.length ? (
            <Button
              variant="gray"
              size="icon-sm"
              aria-label="Nueva conversación"
              onClick={() => {
                callar();
                dictado.cancelar();
                nuevaConversacion();
              }}
            >
              <SquarePen strokeWidth={2.25} />
            </Button>
          ) : null}
        </div>
      }
    >
      <div style={{ paddingBottom: Math.max(96, altoEntrada + 24) }}>
        {mensajes.length === 0 ? (
          <div className="flex flex-col items-center pt-7 text-center animate-entrar">
            <span
              aria-hidden
              className="flex size-16 items-center justify-center rounded-[20px] bg-linear-140 from-[#4aa3ff] to-[#5856d6] text-white shadow-[0_8px_24px_rgb(88_86_214/0.28)]"
            >
              <Sparkles className="size-8" strokeWidth={1.75} />
            </span>
            <h1 className="mt-3.5 text-[26px] leading-tight font-bold tracking-[-0.02em]">¿En qué te ayudo?</h1>
            <p className="mt-1 max-w-[30ch] text-[15px] leading-snug text-balance text-muted-foreground">
              {dictado.disponible
                ? "Pregunta por tus gastos o dime lo que compraste. Toca el micrófono para hablar."
                : "Pregunta por tus gastos o dime lo que compraste."}
            </p>
            {uso?.aviso ? (
              <p className={cn("mt-2 max-w-[20rem] text-[15px] text-balance", uso.modoBasico ? "text-muted-foreground" : "text-negative")}>
                {uso.aviso}
              </p>
            ) : null}
            <Grupo className="mt-[22px] w-full text-left">
              {SUGERENCIAS.map((s) => (
                <FilaBoton
                  key={s}
                  titulo={<span className="text-tint">{s}</span>}
                  icono={<ArrowUpRight aria-hidden className="size-[22px] text-tint" strokeWidth={2.25} />}
                  sangria="2.9rem"
                  disabled={!enLinea}
                  onClick={() => enviar(s)}
                />
              ))}
            </Grupo>
            {dictado.disponible && lecturaDisponible() ? (
              <p className="mt-2 px-4 text-[13px] leading-snug text-balance text-muted-foreground">
                Modo voz: si dictas, te contesto en voz alta y vuelvo a escuchar si te pregunto algo.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <ol className="flex flex-col pt-2" aria-live="polite">
              {mensajes.map((m, i) => (
                <Burbuja key={m.id} m={m} pegada={mensajes[i - 1]?.rol === m.rol} enLinea={enLinea} leyendo={leyendo === m.id} />
              ))}
            </ol>
            {!ocupado && !dictado.escuchando && ultimo?.rol === "asistente" && ultimo.estado !== "esperando" ? (
              <Fichas
                opciones={FICHAS.filter((f) => !mensajes.some((m) => m.rol === "yo" && m.texto === f))}
                disabled={!enLinea}
                alElegir={(f) => enviar(f)}
              />
            ) : null}
          </>
        )}
        {/* Al bajar, lo último queda arriba de la caja de texto, no detrás. */}
        <div ref={final} style={{ scrollMarginBottom: `calc(var(--barra-inferior) + ${altoEntrada + 20}px)` }} />
      </div>

      <form
        ref={formulario}
        onSubmit={(e) => {
          e.preventDefault();
          // Mientras escucha, Enviar deja de escuchar y manda lo dicho (una sola vez).
          if (dictado.escuchando) dictado.terminar();
          else enviar();
        }}
        className={cn(
          "pointer-events-none fixed inset-x-0 z-30 transition-[bottom] duration-300 ease-ios",
          teclado ? "bottom-[calc(var(--teclado,0px)+8px)]" : "bottom-[calc(var(--barra-inferior)+10px-var(--hueco,0px))]",
        )}
      >
        <Contador largo={largo} maximo={maximo} porConsulta={uso?.caracteresPorConsulta ?? 500} />
        <div className="pointer-events-auto mx-auto flex max-w-3xl items-end px-safe">
          <div className={cn("vidrio relative flex min-h-11 min-w-0 flex-1 items-end rounded-[22px]", ocupado && "brillo-ia")}>
            {dictado.escuchando ? (
              <span role="status" aria-label="Escuchando" className="absolute bottom-[13px] left-4 flex h-[18px] animate-aparecer items-center">
                <Onda fuerte={dictado.oyendo} />
              </span>
            ) : null}
            <label htmlFor="mensaje" className="sr-only">
              Mensaje
            </label>
            <textarea
              ref={campo}
              id="mensaje"
              rows={1}
              value={texto}
              readOnly={dictado.escuchando}
              onChange={(e) => {
                callar();
                setTexto(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              enterKeyHint="send"
              placeholder={dictado.escuchando ? "Te escucho…" : enLinea ? "Pregunta o dime un gasto" : "Sin conexión"}
              disabled={!enLinea}
              className={cn(
                "relative block max-h-[124px] min-h-11 w-full resize-none bg-transparent py-[11px] text-[17px] leading-[22px] outline-none placeholder:text-placeholder max-[359px]:text-[16px]",
                dictado.escuchando ? "pl-[62px] placeholder:text-foreground" : "pl-4",
                // Sin texto no hay botón de enviar: el texto de ayuda cabe en una línea aun a 320 px.
                texto.trim() ? "pr-12" : "pr-4",
              )}
            />
            <button
              type="submit"
              aria-label="Enviar"
              disabled={!texto.trim() || !enLinea || (ocupado && !dictado.escuchando) || (muyLargo && !dictado.escuchando)}
              className="absolute right-[5px] bottom-[5px] flex size-[34px] items-center justify-center rounded-full bg-primary text-white transition-[transform,opacity] duration-200 ease-ios active:scale-90 disabled:scale-75 disabled:opacity-0"
            >
              <ArrowUp className="size-[19px]" strokeWidth={3} />
            </button>
          </div>
          {dictado.disponible ? (
            // Al escribir, el micrófono se encoge y se va para que la caja use su espacio; al borrar todo, regresa
            // con un pequeño rebote (como los botones de iOS). Mientras escucha siempre está la X.
            <div
              className={cn(
                "flex shrink-0 justify-end transition-[width,margin] duration-[380ms] ease-ios",
                ocultarMic ? "ml-0 w-0" : "ml-2 w-11",
              )}
            >
              {dictado.escuchando ? (
                <button
                  type="button"
                  onClick={dictado.cancelar}
                  aria-label="Cancelar dictado"
                  className="flex size-11 shrink-0 animate-escalar items-center justify-center rounded-full bg-destructive text-white shadow-[var(--vidrio-sombra)] transition-transform duration-200 ease-ios active:scale-90"
                >
                  <X className="size-[22px]" strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={dictar}
                  disabled={!enLinea || ocupado}
                  aria-label="Dictar"
                  aria-hidden={ocultarMic || undefined}
                  tabIndex={ocultarMic ? -1 : undefined}
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-[var(--vidrio-sombra)] active:scale-90 disabled:opacity-40",
                    ocultarMic
                      ? "pointer-events-none scale-50 opacity-0 transition-[scale,opacity] duration-200 ease-ios"
                      : "scale-100 opacity-100 transition-[scale,opacity] duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  )}
                >
                  <Mic className="size-[22px]" strokeWidth={2.25} />
                </button>
              )}
            </div>
          ) : null}
        </div>
      </form>
    </Pantalla>
  );
}

/**
 * Arriba del campo, solo cuando el mensaje ya cuenta como más de una consulta o se pasa del máximo: cuántos caracteres
 * lleva. Lo que le queda hoy va bajo el título (TituloIa).
 */
function Contador({ largo, maximo, porConsulta }: { largo: number; maximo: number; porConsulta: number }) {
  if (largo <= porConsulta) return null;
  const muyLargo = largo > maximo;
  return (
    <div className="pointer-events-none mx-auto mb-1.5 flex max-w-3xl justify-end px-safe">
      <span
        role="status"
        className={cn(
          "vidrio animate-aparecer rounded-full px-3 py-1 text-[12px] font-semibold tabular-nums",
          muyLargo ? "text-negative" : "text-muted-foreground",
        )}
      >
        {largo}/{maximo} · {muyLargo ? "Muy largo, divídelo en partes" : `Cuenta como ${Math.ceil(largo / porConsulta)} consultas`}
      </span>
    </div>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * "IA" y, debajo y en pequeño, lo que le queda hoy, como el "en línea" de Mensajes: las consultas, el modo básico o
 * por qué no hay IA. La cuenta dueña, que no tiene tope, ve lo gastado del mes contra el presupuesto.
 */
function TituloIa({ uso }: { uso: EstadoSistema["uso"] }) {
  // [larga, corta]: a menos de 360 px el título tiene unos 128 px, así que va la versión corta.
  const lineas: [string, string] | undefined = !uso
    ? undefined
    : uso.modoBasico
      ? ["Modo básico hasta mañana", "Modo básico"]
      : uso.aviso
        ? ["Sin IA por ahora", "Sin IA por ahora"]
        : uso.quedan != null
          ? uso.quedan === 1
            ? ["Te queda 1 consulta hoy", "Queda 1 consulta"]
            : [`Te quedan ${uso.quedan} consultas hoy`, `Quedan ${uso.quedan} consultas`]
          : uso.mes?.presupuestoUsd
            ? [
                `${usd(uso.mes.costoUsd)} de ${usd(uso.mes.presupuestoUsd)} USD este mes`,
                `${usd(uso.mes.costoUsd)} de $${Math.round(uso.mes.presupuestoUsd)} USD`,
              ]
            : undefined;
  const alerta = !!uso?.aviso && !uso.modoBasico;
  return (
    <span className="flex flex-col items-center leading-tight">
      <span>IA</span>
      {lineas ? (
        <span
          className={cn(
            "max-w-full animate-aparecer truncate text-[11px] font-normal tabular-nums",
            alerta ? "text-negative" : "text-muted-foreground",
          )}
        >
          <span className="max-[359px]:hidden">{lineas[0]}</span>
          <span className="hidden max-[359px]:inline">{lineas[1]}</span>
        </span>
      ) : null}
    </span>
  );
}

function Burbuja({ m, pegada, enLinea, leyendo }: { m: Mensaje; pegada: boolean; enLinea: boolean; leyendo: boolean }) {
  const mia = m.rol === "yo";
  const registrados = mia ? [] : idsRegistrados(m.acciones);
  return (
    <li className={cn("flex flex-col animate-burbuja", mia ? "items-end" : "items-start", pegada ? "mt-1" : "mt-2.5")}>
      {m.estado === "pensando" && !m.texto ? (
        <div className={cn("flex h-[38px] items-center gap-1 rounded-[19px] rounded-bl-md bg-card px-4", SOMBRA)} aria-label="Pensando">
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
          className={cn(
            "max-w-[82%] rounded-[19px] px-[13px] py-[9px] text-[16px] leading-[21px]",
            mia ? "rounded-br-md bg-primary text-primary-foreground" : cn("rounded-bl-md bg-card text-foreground", SOMBRA),
            registrados.length ? "w-[88%] max-w-[88%] max-[359px]:w-full max-[359px]:max-w-full" : null,
          )}
        >
          <div data-seleccionable className={cn("break-words whitespace-pre-wrap", m.estado === "esperando" && "text-muted-foreground")}>
            {m.texto}
          </div>
          {registrados.length ? (
            <div className="-mx-1 mt-2.5 mb-1 overflow-hidden rounded-[14px] bg-background dark:bg-muted">
              {registrados.slice(0, 5).map((id) => (
                <Registrado key={id} id={id} />
              ))}
            </div>
          ) : null}
          {m.acciones?.length ? (
            <ul className="mt-1.5 flex flex-wrap items-center gap-1.5" aria-label="Lo que hizo">
              {m.acciones.map((a, i) => {
                const cambia = accionCambiaDatos(a);
                return (
                  <li
                    key={`${a.herramienta}-${i}`}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold",
                      cambia ? "bg-positive/15 text-positive" : "bg-fill text-muted-foreground",
                    )}
                  >
                    {cambia ? <Check className="size-3" strokeWidth={3} /> : <Search className="size-3" strokeWidth={2.5} />}
                    {etiquetaAccion(a)}
                  </li>
                );
              })}
              {registrados.length === 1 ? <Deshacer id={registrados[0]!} enLinea={enLinea} /> : null}
            </ul>
          ) : null}
        </div>
      )}
      {leyendo ? (
        <button
          type="button"
          onClick={callar}
          aria-label="Dejar de leer"
          className="relative mt-1 flex animate-aparecer items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold text-tint after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] active:opacity-60"
        >
          <AudioLines className="size-3.5 animate-pulse" strokeWidth={2.5} />
          Leyendo · Toca para callar
        </button>
      ) : null}
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
    </li>
  );
}

/**
 * Lo que anotó la respuesta, como en Movimientos y con sus datos de ahora (si lo editaste después, se ve editado).
 * Tocarlo abre su detalle. Si ya no existe (lo borraste), no sale.
 */
function Registrado({ id }: { id: string }) {
  const { data: m, isError } = useMovimiento(id);
  if (isError) return null;
  if (!m) return <div aria-hidden className="h-[62px] animate-pulse [&+&]:border-t [&+&]:border-separator" />;
  return (
    <button
      type="button"
      onClick={() => abrirDetalle(m)}
      aria-label={`Ver ${m.comercio ?? m.descripcion ?? "el movimiento"}`}
      className={cn(
        "block w-full text-left transition-colors active:bg-fill [&+&]:border-t [&+&]:border-separator",
        // Un poco más chica que en Movimientos: dentro de la burbuja hay menos ancho y los montos grandes no deben apretar el nombre.
        "[&_[data-movimiento]]:gap-2.5 [&_[data-movimiento]]:px-2.5 [&_[data-movimiento]_.line-clamp-2]:text-[14px] [&_[data-movimiento]_.tabular]:text-[15px] [&_[data-movimiento]_.truncate]:text-[16px]",
      )}
    >
      <ContenidoMovimiento m={m} />
    </button>
  );
}

/** "Deshacer" de algo que acaba de anotar: lo borra (con su propio Deshacer en el aviso, por si fue sin querer). */
function Deshacer({ id, enLinea }: { id: string; enLinea: boolean }) {
  const { data: m, isError } = useMovimiento(id);
  // Dos toques rápidos no mandan dos DELETE (el segundo saldría como error).
  const [borrando, setBorrando] = useState(false);
  if (!m || isError) return null;
  return (
    <li>
      <button
        type="button"
        disabled={!enLinea || borrando}
        onClick={() => {
          setBorrando(true);
          void eliminarConDeshacer(m).finally(() => setBorrando(false));
        }}
        className="relative ml-1 text-[14px] font-medium text-tint after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] active:opacity-50 disabled:opacity-40"
      >
        Deshacer
      </button>
    </li>
  );
}

/** Sugerencias en fichas que se deslizan de lado, bajo la última respuesta. */
function Fichas({ opciones, disabled, alElegir }: { opciones: string[]; disabled: boolean; alElegir: (texto: string) => void }) {
  if (!opciones.length) return null;
  return (
    <div
      role="group"
      aria-label="Sugerencias"
      className="-mx-4 mt-4 flex animate-aparecer gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {opciones.map((f) => (
        <button
          key={f}
          type="button"
          disabled={disabled}
          onClick={() => alElegir(f)}
          className={cn(
            "h-8 shrink-0 rounded-full bg-card px-3 text-[14px] font-medium whitespace-nowrap transition-transform duration-150 ease-ios active:scale-95 disabled:opacity-40",
            SOMBRA,
          )}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

/** Barras que se mueven mientras escucha; más altas cuando ya te está oyendo. */
function Onda({ fuerte }: { fuerte: boolean }) {
  return (
    <span aria-hidden className="flex h-[18px] items-center gap-[3px] text-destructive">
      {[0.55, 0.85, 1, 0.75, 0.5].map((alto, i) => (
        <span
          key={i}
          className="w-[3px] animate-onda rounded-full bg-current transition-[height] duration-300 ease-ios"
          style={{ height: `${(fuerte ? alto : alto * 0.45) * 18}px`, animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  );
}
