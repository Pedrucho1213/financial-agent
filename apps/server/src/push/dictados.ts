// La notificación con el resultado de un dictado que el iPhone ya no esperó: el Atajo dijo "Anotado"
// y terminó, o un pago con Apple Pay que se registró solo.
import type { Db } from "../db/client";
import type { Entrada, Respuesta } from "../ai/asistente";
import { PREGUNTA_TARJETA } from "../finanzas/tarjeta-wallet";
import { type EnviarPush, type Notificacion, notificar, tieneSuscripciones } from "./notificaciones";

type Registrado = { id?: string; monto?: string; comercio?: string; descripcion?: string; categoria?: string };

/** Los movimientos que dejó el dictado (registrados o corregidos), para abrir su detalle. */
function movimientosDe(respuesta: Respuesta): Registrado[] {
  return respuesta.acciones.flatMap((a) => {
    const r = a.resultado as { registrados?: Registrado[]; editado?: Registrado } | undefined;
    if (!r || typeof r !== "object") return [];
    if (a.herramienta === "registrar_movimientos" && Array.isArray(r.registrados)) return r.registrados;
    if (a.herramienta === "editar_movimiento" && r.editado) return [r.editado];
    return [];
  });
}

/** Cuántos movimientos caben en el enlace de una notificación (cada id son 36 caracteres). */
const MAX_DETALLE = 20;

const concepto = (m: Registrado) => m.comercio ?? m.categoria?.split(" > ").at(-1) ?? m.descripcion ?? "Movimiento";

// Una pregunta que llegó por notificación se contesta en el chat que abre la notificación, o abriendo el
// Atajo otra vez: el próximo dictado sigue esa conversación si llega pronto.
// Corto: pasado un rato, lo siguiente que dicta suele ser otro gasto y no la respuesta.
const VIGENCIA_PREGUNTA_MS = 5 * 60_000;
const preguntas = new Map<string, { conversacionId: string; hasta: number }>();

/** La conversación que quedó esperando respuesta por notificación (y la olvida). */
export function conversacionPorContestar(usuarioId: string, ahora = Date.now()): string | undefined {
  const p = preguntas.get(usuarioId);
  preguntas.delete(usuarioId);
  return p && p.hasta > ahora ? p.conversacionId : undefined;
}

/** El chat de la app abierto en esa conversación: ahí se lee el mensaje y se contesta (2026-10-12). */
export const urlDelChat = (conversacionId: string) => `/#chat?conversacion=${encodeURIComponent(conversacionId)}`;

export function notificacionDeDictado(entrada: Entrada, respuesta: Respuesta | undefined): Notificacion {
  const applePay = entrada.origen === "apple_pay";
  const etiqueta = `dictado-${entrada.id}`;
  if (!respuesta) {
    return {
      titulo: applePay ? "No pude anotar tu pago" : "No pude anotarlo",
      cuerpo: applePay
        ? `No pude procesar tu pago con Apple Pay (${entrada.texto}). Toca para aclararlo con la IA.`
        : `No pude procesar «${entrada.texto}». Toca para aclararlo con la IA.`,
      url: urlDelChat(entrada.conversacionId),
      etiqueta,
      urgencia: "high",
    };
  }
  const movimientos = movimientosDe(respuesta).filter((m) => m.id);
  // Un pago con Apple Pay no se contesta por voz (y su comercio puede traer "?": "WHY? CAFE"): solo pregunta
  // con qué tarjeta pagó cuando la Cartera no lo dejó claro.
  const pregunta = applePay ? respuesta.respuesta.includes(PREGUNTA_TARJETA) : respuesta.respuesta.includes("?");
  const prefijo = applePay ? "Apple Pay · " : "";
  const [primero] = movimientos;
  const titulo =
    movimientos.length === 1 && primero
      ? `${prefijo}${primero.monto ? `${primero.monto} · ` : ""}${concepto(primero)}`
      : movimientos.length > 1
        ? `${prefijo}${movimientos.length} movimientos anotados`
        : pregunta
          ? "Tengo una pregunta"
          : applePay
            ? "Apple Pay"
            : "Finanzas";
  const cuerpo = pregunta
    ? `${respuesta.respuesta} Toca para contestarme.`
    : applePay && movimientos.length
      ? `${respuesta.respuesta} Toca para agregar detalles.`
      : respuesta.respuesta;
  return {
    titulo,
    cuerpo,
    // Una pregunta, o un dictado que no dejó nada anotado, abre el chat en esa conversación para contestar ahí.
    // Un pago de Apple Pay abre el editor para agregarle detalles.
    // Con muchos movimientos el enlace no cabría en la notificación: abre la lista.
    url:
      pregunta || !movimientos.length
        ? urlDelChat(respuesta.conversacion_id)
        : movimientos.length <= MAX_DETALLE
        ? `/#movimientos?detalle=${movimientos.map((m) => m.id).join(",")}${applePay ? "&editar=1" : ""}`
        : "/#movimientos",
    etiqueta,
    urgencia: "high",
    // Pasado un día, ya no sirve saber que se anotó.
    ttl: 24 * 3600,
  };
}

/** El aviso para `alTerminarSinEspera`: si la cuenta recibe notificaciones, le manda el resultado. */
export function avisoDeDictado(db: Db, enviar?: EnviarPush) {
  return (entrada: Entrada, respuesta: Respuesta | undefined) => {
    // Aunque la última no haya llegado: es lo único que le avisa de este dictado.
    if (!tieneSuscripciones(db, entrada.usuarioId)) return;
    if (entrada.origen !== "apple_pay" && respuesta?.respuesta.includes("?")) {
      preguntas.set(entrada.usuarioId, { conversacionId: respuesta.conversacion_id, hasta: Date.now() + VIGENCIA_PREGUNTA_MS });
    }
    // Sin esperar, pero sin dejar un rechazo suelto: tumbaría el servidor.
    notificar(db, entrada.usuarioId, notificacionDeDictado(entrada, respuesta), enviar).catch((error) =>
      console.error("No se pudo mandar la notificación del dictado:", error),
    );
  };
}
