import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { api, ErrorApi } from "./api";
import { useRefrescarDatos } from "./consultas";

// Cobros de suscripciones y pagos fijos: en su fecha la app pregunta si ya se pagaron (GET /v1/cobros). Si el
// servidor lo tiene apagado para esta cuenta (CONFIRMAR_COBROS), contesta 404 y la app no muestra nada.

export type EstadoCobro = "pendiente" | "pagado" | "saltado" | "sin_confirmar";

export type SugerenciaCobro = { movimientoId: string; titulo: string; montoCentavos: number; moneda: string; fecha: string; cuenta: string | null };

export type Cobro = {
  id: string;
  recurrenteId: string;
  nombre: string;
  tipo: string;
  fecha: string;
  montoCentavos: number;
  moneda: string;
  cuentaId: string | null;
  cuenta: string | null;
  estado: EstadoCobro;
  /** "Todavía no": se vuelve a preguntar mañana. */
  pospuesto: boolean;
  montoRealCentavos: number | null;
  movimientoId: string | null;
  confirmadoPor: "app" | "voz" | "apple_pay" | "empate" | "auto" | null;
  confirmadoEn: string | null;
  /** Lo que se pagó la vez anterior, si fue otro monto: si se repite, se propone actualizar el precio. */
  anteriorDistintoCentavos: number | null;
  /** Gastos ya anotados que podrían ser este pago. */
  sugerencias: SugerenciaCobro[];
};

export type Cobros = { porConfirmar: Cobro[]; recientes: Cobro[]; insignia: number };

export type GrupoAviso = "cobros" | "tarjetas" | "presupuestos" | "fugas" | "deudas";
export type PreferenciasAvisos = { tipos: Record<GrupoAviso, boolean>; desde: number; hasta: number };

// Con "recurrentes" al frente: refrescarDatos (un gasto nuevo, borrado o corregido) también la refresca, porque
// un gasto puede ser el pago de un cobro.
const CLAVE = ["recurrentes", "cobros"] as const;

export function useCobros(activo = true) {
  return useQuery({
    queryKey: CLAVE,
    enabled: activo,
    staleTime: 30_000,
    // 404: apagado para esta cuenta (o servidor viejo). No se reintenta.
    retry: (n, e) => !(e instanceof ErrorApi && e.estado === 404) && n < 2,
    // Inicio, la campana y el número del ícono la usan a la vez: un 404 no se vuelve a pedir en cada pantalla.
    retryOnMount: false,
    queryFn: ({ signal }) => api<Cobros>("/v1/cobros", { signal }),
  });
}

/** Los cobros, o undefined si el servidor dijo que no (404): así, al apagarlo, todo desaparece aunque haya copia guardada. */
export function cobrosParaMostrar(q: { data?: Cobros; error: unknown }): Cobros | undefined {
  if (q.error instanceof ErrorApi && q.error.estado === 404) return undefined;
  return q.data;
}

export type DatosConfirmar = { monto?: number; cuenta_id?: string | null; movimiento_id?: string; actualizar_precio?: boolean };

type Accion =
  | { tipo: "confirmar"; id: string; datos?: DatosConfirmar }
  | { tipo: "varios"; ids: string[] }
  | { tipo: "posponer" | "saltar" | "deshacer"; id: string };

type Respuesta = { cobro?: Cobro; cobros?: Cobro[]; sugerirPausa?: boolean };

/** Confirmar, posponer, "no se pagó" o deshacer. Cambia gastos, saldos y el tablero: se refresca todo. */
export function useAccionCobro() {
  const refrescar = useRefrescarDatos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Accion) => {
      if (a.tipo === "varios") return api<Respuesta>("/v1/cobros/confirmar", { method: "POST", body: { ids: a.ids } });
      const ruta = `/v1/cobros/${encodeURIComponent(a.id)}/${a.tipo}`;
      return api<Respuesta>(ruta, { method: "POST", body: a.tipo === "confirmar" ? (a.datos ?? {}) : undefined });
    },
    // Lo resuelto sale de "por confirmar" de inmediato; la respuesta del servidor trae lo demás.
    onMutate: async (a) => {
      if (a.tipo === "deshacer") return;
      await qc.cancelQueries({ queryKey: CLAVE });
      const quitar = new Set(a.tipo === "varios" ? a.ids : [a.id]);
      qc.setQueryData<Cobros>(CLAVE, (d) => {
        if (!d) return d;
        const porConfirmar =
          a.tipo === "posponer"
            ? d.porConfirmar.map((c) => (quitar.has(c.id) ? { ...c, pospuesto: true } : c))
            : d.porConfirmar.filter((c) => !quitar.has(c.id));
        return { ...d, porConfirmar, insignia: porConfirmar.filter((c) => !c.pospuesto).length };
      });
    },
    onSettled: () => refrescar(),
  });
}

export function usePreferenciasAvisos(activo = true) {
  return useQuery({
    queryKey: ["avisos-preferencias"] as const,
    enabled: activo,
    retry: (n, e) => !(e instanceof ErrorApi && e.estado === 404) && n < 2,
    retryOnMount: false,
    queryFn: ({ signal }) => api<PreferenciasAvisos>("/v1/avisos/preferencias", { signal }),
  });
}

export function useGuardarPreferencias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cambios: { tipos?: Partial<Record<GrupoAviso, boolean>>; desde?: number; hasta?: number }) =>
      api<PreferenciasAvisos>("/v1/avisos/preferencias", { method: "PUT", body: cambios }),
    // El interruptor se mueve al tocarlo; si falla, vuelve.
    onMutate: async (cambios) => {
      await qc.cancelQueries({ queryKey: ["avisos-preferencias"] });
      const antes = qc.getQueryData<PreferenciasAvisos>(["avisos-preferencias"]);
      if (antes) qc.setQueryData<PreferenciasAvisos>(["avisos-preferencias"], { ...antes, ...cambios, tipos: { ...antes.tipos, ...cambios.tipos } });
      return { antes };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(["avisos-preferencias"], ctx?.antes),
    onSuccess: (p) => qc.setQueryData(["avisos-preferencias"], p),
  });
}

/** El número en el ícono de la app: cuántos cobros esperan respuesta. Se quita si el módulo está apagado. */
export function useInsigniaDeLaApp() {
  const q = useCobros();
  const cobros = cobrosParaMostrar(q);
  const apagado = q.error instanceof ErrorApi && q.error.estado === 404;
  const n = cobros?.insignia;
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (apagado || n === 0) void nav.clearAppBadge?.().catch(() => {});
    else if (typeof n === "number") void nav.setAppBadge?.(n).catch(() => {});
  }, [n, apagado]);
}

// Una sola hoja de confirmación para toda la app: la abren la notificación (#inicio?confirmar=<ids>), la tarjeta
// de Inicio y el centro de notificaciones. Sin ids: todos los que esperan respuesta.
type EstadoHoja = { abierta: boolean; ids: string[] | null; clave: number };
let hoja: EstadoHoja = { abierta: false, ids: null, clave: 0 };
const oyentes = new Set<() => void>();

function emitir(nuevo: EstadoHoja) {
  hoja = nuevo;
  for (const o of oyentes) o();
}

export function abrirCobros(ids: string[] | null = null) {
  emitir({ abierta: true, ids, clave: hoja.clave + 1 });
}

export function cerrarCobros() {
  emitir({ ...hoja, abierta: false });
}

export function useHojaCobros() {
  return useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    () => hoja,
  );
}

/** "hoy", "ayer", "el 5 de octubre" (o "5 oct" en listas). */
export function cuandoFue(fecha: string, hoy: string, { corto = false } = {}) {
  if (fecha === hoy) return "hoy";
  const d = (Date.parse(`${hoy}T12:00:00`) - Date.parse(`${fecha}T12:00:00`)) / 86400000;
  if (Math.round(d) === 1) return "ayer";
  const f = new Date(`${fecha}T12:00:00`);
  // Con espacio que no se rompe: en una fila angosta "1 oct" no se parte en dos renglones.
  if (corto) return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(f).replace(".", "").replace(/\s/g, " ");
  return `el ${new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long" }).format(f)}`;
}

export const QUIEN_CONFIRMO: Record<NonNullable<Cobro["confirmadoPor"]>, string> = {
  app: "en la app",
  voz: "por voz",
  apple_pay: "con Apple Pay",
  empate: "al anotarlo",
  auto: "sola",
};
