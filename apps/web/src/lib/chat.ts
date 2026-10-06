import { useSyncExternalStore } from "react";
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
const enCurso = new Set<string>();

function emitir(nuevo: Estado) {
  estado = nuevo;
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch {
    // nada
  }
  for (const o of oyentes) o();
}

function cambiarMensaje(id: string, cambios: Partial<Mensaje>) {
  emitir({ ...estado, mensajes: estado.mensajes.map((m) => (m.id === id ? { ...m, ...cambios } : m)) });
}

function refrescarSiHizoAlgo(acciones: Accion[] | undefined) {
  if (!acciones?.length) return;
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

/** Espera en /v1/entradas/:client_id hasta que el dictado quede listo o falle. */
async function esperarEntrada(idMensaje: string, clientId: string) {
  if (enCurso.has(clientId)) return;
  enCurso.add(clientId);
  try {
    let fallos = 0;
    for (let i = 0; i < MAX_CONSULTAS; i++) {
      let r: EstadoEntrada;
      try {
        r = await api<EstadoEntrada>(`/v1/entradas/${encodeURIComponent(clientId)}?esperar_ms=${ESPERA_ENTRADA_MS}`);
      } catch (error) {
        if (error instanceof ErrorApi && error.estado === 404) {
          cambiarMensaje(idMensaje, { estado: "error", texto: "No encontré ese mensaje en tu Mac." });
          return;
        }
        if (++fallos > 3) throw error;
        await pausa(3000);
        continue;
      }
      if (r.estado === "listo") {
        cambiarMensaje(idMensaje, { texto: r.respuesta ?? "Listo.", acciones: r.acciones ?? [], estado: undefined });
        if (r.conversacion_id) emitir({ ...estado, conversacionId: r.conversacion_id });
        refrescarSiHizoAlgo(r.acciones);
        return;
      }
      if (r.estado === "error") {
        cambiarMensaje(idMensaje, { estado: "error", texto: "No pude terminarlo. Tu Mac lo volverá a intentar sola." });
        return;
      }
    }
    cambiarMensaje(idMensaje, { estado: "pendiente", texto: "Sigue en proceso. Te aviso en Movimientos cuando quede." });
  } catch (error) {
    cambiarMensaje(idMensaje, { estado: "error", texto: mensajeDeError(error) });
  } finally {
    enCurso.delete(clientId);
  }
}

export async function enviarMensaje(texto: string) {
  const limpio = texto.trim();
  if (!limpio) return;
  const clientId = uuid();
  const idRespuesta = `r-${clientId}`;
  emitir({
    ...estado,
    mensajes: [
      ...estado.mensajes,
      { id: `u-${clientId}`, rol: "yo", texto: limpio },
      { id: idRespuesta, rol: "asistente", texto: "", estado: "pensando", clientId },
    ],
  });

  try {
    const r = await api<RespuestaHablar>("/v1/hablar", {
      method: "POST",
      body: {
        texto: limpio,
        client_id: clientId,
        ...(estado.conversacionId ? { conversacion_id: estado.conversacionId } : {}),
        espera_ms: ESPERA_HABLAR_MS,
      },
    });
    if (r.conversacion_id) emitir({ ...estado, conversacionId: r.conversacion_id });
    if (r.pendiente) {
      cambiarMensaje(idRespuesta, { texto: r.respuesta, estado: r.esperar ? "esperando" : "pendiente" });
      await esperarEntrada(idRespuesta, clientId);
      return;
    }
    cambiarMensaje(idRespuesta, { texto: r.respuesta, acciones: r.acciones ?? [], estado: undefined });
    refrescarSiHizoAlgo(r.acciones);
  } catch (error) {
    const cuerpo = error instanceof ErrorApi ? (error.cuerpo as { respuesta?: string } | null) : null;
    cambiarMensaje(idRespuesta, { estado: "error", texto: cuerpo?.respuesta ?? mensajeDeError(error) });
  }
}

/** Al volver a abrir la app, retoma las respuestas que se quedaron esperando. */
export function retomarPendientes() {
  for (const m of estado.mensajes) {
    if (m.clientId && (m.estado === "esperando" || m.estado === "pendiente" || m.estado === "pensando")) {
      void esperarEntrada(m.id, m.clientId);
    }
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
