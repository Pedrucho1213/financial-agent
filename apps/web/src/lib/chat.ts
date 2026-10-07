import { useSyncExternalStore } from "react";
import { olvidarDeshacer } from "./acciones";
import { api, ErrorApi, mensajeDeError } from "./api";
import { clienteConsultas } from "./consultas";
import { alCerrarSesion } from "./sesion";
import type { Accion, EstadoEntrada, RespuestaHablar } from "./tipos";

// La conversación vive aquí (no en la pantalla) para seguir esperando respuestas
// aunque cambies de pestaña. Se guarda en sessionStorage: dura lo que la sesión.

export type Mensaje = {
  id: string;
  rol: "yo" | "asistente";
  texto: string;
  acciones?: Accion[];
  /** pensando: sin texto todavía; esperando: con texto provisional; pendiente: la Mac lo termina sola. */
  estado?: "pensando" | "esperando" | "pendiente" | "error";
  clientId?: string;
  /** Lo que dijo la persona: Reintentar lo reenvía con el mismo client_id (la Mac no lo duplica). */
  pregunta?: string;
  reintentable?: boolean;
  /** No se sabe si llegó a la Mac: al volver a la app se pregunta antes de ofrecer reenviarlo. */
  incierto?: boolean;
};

type Estado = { mensajes: Mensaje[]; conversacionId?: string };

const CLAVE = "fa_chat";
const ESPERA_HABLAR_MS = 60_000;
const ESPERA_ENTRADA_MS = 45_000;
const MAX_CONSULTAS = 8;

function cargar(): Estado {
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    if (crudo) return JSON.parse(crudo) as Estado;
  } catch {
    // nada
  }
  return { mensajes: [] };
}

let estado: Estado = cargar();
const oyentes = new Set<() => void>();
/** client_id que ya se están consultando en /v1/entradas. */
const enCurso = new Set<string>();
/** client_id con un POST /v1/hablar en vuelo. */
const enviando = new Set<string>();

function emitir(nuevo: Estado) {
  estado = nuevo;
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch {
    // nada
  }
  for (const o of oyentes) o();
}

/** El mensaje sigue en la conversación actual (no se empezó otra mientras tanto). */
const vigente = (id: string) => estado.mensajes.some((m) => m.id === id);

function cambiarMensaje(id: string, cambios: Partial<Mensaje>) {
  if (!vigente(id)) return;
  emitir({ ...estado, mensajes: estado.mensajes.map((m) => (m.id === id ? { ...m, ...cambios } : m)) });
}

/** Una respuesta tardía de una conversación anterior no se mete en la nueva. */
function adoptarConversacion(idMensaje: string, conversacionId: string | undefined) {
  if (conversacionId && vigente(idMensaje)) emitir({ ...estado, conversacionId });
}

function refrescarSiHizoAlgo(acciones: Accion[] | undefined) {
  if (!acciones?.length) return;
  // Lo que hizo el chat es ahora "lo último": el Deshacer de un aviso anterior desharía esto.
  if (acciones.some(accionCambiaDatos)) olvidarDeshacer();
  void clienteConsultas.invalidateQueries({ queryKey: ["tablero"] });
  void clienteConsultas.invalidateQueries({ queryKey: ["movimientos"] });
}

export function nuevaConversacion() {
  emitir({ mensajes: [] });
}

alCerrarSesion(() => {
  estado = { mensajes: [] };
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // nada
  }
});

function uuid() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const pausa = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function codigoDe(error: unknown) {
  return error instanceof ErrorApi ? error.estado : 0; // 0: sin respuesta (red caída, app en segundo plano, tiempo agotado)
}

/**
 * Pregunta a la Mac por un dictado (GET /v1/entradas/:client_id) hasta que quede listo o falle.
 * Es lo que se hace cuando no se sabe si el POST llegó: reenviar a ciegas lo duplicaría.
 */
async function esperarEntrada(idMensaje: string, clientId: string) {
  if (enCurso.has(clientId)) return;
  enCurso.add(clientId);
  try {
    const actual = estado.mensajes.find((m) => m.id === idMensaje);
    if (actual?.estado === "error") cambiarMensaje(idMensaje, { estado: "pensando", texto: "", reintentable: false });
    let fallos = 0;
    for (let i = 0; i < MAX_CONSULTAS; i++) {
      if (!vigente(idMensaje)) return;
      let r: EstadoEntrada;
      try {
        r = await api<EstadoEntrada>(`/v1/entradas/${encodeURIComponent(clientId)}?esperar_ms=${ESPERA_ENTRADA_MS}`);
      } catch (error) {
        const codigo = codigoDe(error);
        if (codigo === 404) {
          cambiarMensaje(idMensaje, { estado: "error", texto: "Este mensaje no llegó a tu Mac.", reintentable: true, incierto: false });
          return;
        }
        if (codigo !== 0 && codigo < 500) throw error;
        if (++fallos > 3) {
          cambiarMensaje(idMensaje, {
            estado: "error",
            texto: "No hay conexión con tu Mac. Al volver la reviso; si no llegó, podrás reintentarlo.",
            reintentable: true,
            incierto: true,
          });
          return;
        }
        await pausa(3000);
        continue;
      }
      if (r.estado === "listo") {
        refrescarSiHizoAlgo(r.acciones);
        cambiarMensaje(idMensaje, { texto: r.respuesta ?? "Listo.", acciones: r.acciones ?? [], estado: undefined, incierto: false });
        adoptarConversacion(idMensaje, r.conversacion_id);
        return;
      }
      if (r.estado === "error") {
        cambiarMensaje(idMensaje, { estado: "error", texto: "No pude terminarlo.", reintentable: true, incierto: false });
        return;
      }
    }
    cambiarMensaje(idMensaje, { estado: "pendiente", texto: "Sigue en proceso. Te aviso en Movimientos cuando quede." });
  } catch (error) {
    cambiarMensaje(idMensaje, { estado: "error", texto: mensajeDeError(error), incierto: false });
  } finally {
    enCurso.delete(clientId);
  }
}

/** POST /v1/hablar para la respuesta `idRespuesta`, siempre con su mismo client_id. */
async function pedir(idRespuesta: string) {
  const m = estado.mensajes.find((x) => x.id === idRespuesta);
  if (!m?.clientId || m.pregunta === undefined || enviando.has(m.clientId) || enCurso.has(m.clientId)) return;
  const { clientId, pregunta } = m;
  enviando.add(clientId);
  cambiarMensaje(idRespuesta, { estado: "pensando", texto: "", acciones: undefined, reintentable: false, incierto: false });
  // Si iOS deja la petición colgada (app en segundo plano), no se queda "pensando" para siempre.
  const control = new AbortController();
  const limite = window.setTimeout(() => control.abort(), ESPERA_HABLAR_MS + 15_000);
  try {
    const r = await api<RespuestaHablar>("/v1/hablar", {
      method: "POST",
      signal: control.signal,
      body: {
        texto: pregunta,
        client_id: clientId,
        ...(estado.conversacionId ? { conversacion_id: estado.conversacionId } : {}),
        espera_ms: ESPERA_HABLAR_MS,
      },
    });
    adoptarConversacion(idRespuesta, r.conversacion_id);
    if (r.pendiente) {
      cambiarMensaje(idRespuesta, { texto: r.respuesta, estado: r.esperar ? "esperando" : "pendiente" });
      enviando.delete(clientId);
      await esperarEntrada(idRespuesta, clientId);
      return;
    }
    refrescarSiHizoAlgo(r.acciones);
    cambiarMensaje(idRespuesta, { texto: r.respuesta, acciones: r.acciones ?? [], estado: undefined });
  } catch (error) {
    const codigo = codigoDe(error);
    if (codigo === 0 || codigo === 409) {
      // Pudo haber llegado (o se sigue procesando): se pregunta a la Mac en vez de marcar error.
      enviando.delete(clientId);
      await esperarEntrada(idRespuesta, clientId);
      return;
    }
    // El texto del 503 ("queda guardado en tu iPhone") es para el Atajo: la app no guarda nada sola.
    cambiarMensaje(idRespuesta, {
      estado: "error",
      texto: codigo === 503 ? "No pude procesarlo ahora. Inténtalo de nuevo en un momento." : mensajeDeError(error),
      reintentable: codigo >= 500,
    });
  } finally {
    window.clearTimeout(limite);
    enviando.delete(clientId);
  }
}

export function enviarMensaje(texto: string) {
  const limpio = texto.trim();
  if (!limpio) return Promise.resolve();
  const clientId = uuid();
  const idRespuesta = `r-${clientId}`;
  emitir({
    ...estado,
    mensajes: [
      ...estado.mensajes,
      { id: `u-${clientId}`, rol: "yo", texto: limpio },
      { id: idRespuesta, rol: "asistente", texto: "", estado: "pensando", clientId, pregunta: limpio },
    ],
  });
  return pedir(idRespuesta);
}

/** Reenvía con el MISMO client_id: si la Mac ya lo tenía, responde lo mismo sin duplicarlo. */
export function reintentar(idRespuesta: string) {
  return pedir(idRespuesta);
}

/**
 * Al abrir la app o volver a ella: retoma lo que se quedó esperando y revisa lo que no se sabe
 * si llegó. Lo que tiene un POST en vuelo se deja terminar.
 */
export function retomarPendientes() {
  for (const m of estado.mensajes) {
    if (!m.clientId || enviando.has(m.clientId)) continue;
    const esperando = m.estado === "esperando" || m.estado === "pendiente" || m.estado === "pensando";
    if (esperando || (m.estado === "error" && m.incierto)) void esperarEntrada(m.id, m.clientId);
  }
}

export function useChat() {
  return useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    () => estado,
  );
}

const ETIQUETAS: Record<string, string> = {
  registrar_movimientos: "Registrado",
  editar_movimiento: "Editado",
  eliminar_movimiento: "Eliminado",
  deshacer: "Deshecho",
  buscar_movimientos: "Buscó movimientos",
  consultar_gastos: "Revisó tus gastos",
  registrar_recurrente: "Pago fijo guardado",
  listar_recurrentes: "Revisó pagos fijos",
};

export function etiquetaAccion(a: Accion) {
  if (a.herramienta === "registrar_movimientos") {
    const r = a.resultado as { registrados?: unknown[]; movimientos?: unknown[] } | undefined;
    const n = (Array.isArray(r?.registrados) ? r.registrados.length : 0) || (Array.isArray(r?.movimientos) ? r.movimientos.length : 0);
    if (n > 1) return `${n} registrados`;
  }
  return ETIQUETAS[a.herramienta] ?? a.herramienta.replace(/_/g, " ");
}

/** Acciones que cambian datos se destacan; las consultas van en gris. */
export function accionCambiaDatos(a: Accion) {
  return /^(registrar|editar|eliminar|deshacer)/.test(a.herramienta);
}
