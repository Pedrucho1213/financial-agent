import {
  defaultShouldDehydrateQuery,
  type Query,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { removeOldestQuery } from "@tanstack/react-query-persist-client";
import { api, ErrorApi } from "./api";
import { alCerrarSesion } from "./sesion";
import { aFila, type Fila } from "./filas";
import type { Categoria, DatosMovimiento, MovimientoApp, Tablero, TipoMovimiento, Yo } from "./tipos";
import { rangoDelMes } from "./formato";
import { sumarDias } from "./periodos";
import { hashDetalle, navegar } from "./ruta";

const DIA = 24 * 60 * 60 * 1000;

export const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 7 * DIA,
      retry: (intentos, error) => !(error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) && intentos < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export const persistidor = createSyncStoragePersister({
  storage: typeof window === "undefined" ? undefined : window.localStorage,
  key: "fa_cache",
  // Si localStorage se llena (~5 MB en iOS), quita la consulta más vieja y reintenta,
  // en vez de dejar de guardar todo el caché sin avisar.
  retry: removeOldestQuery,
});

/**
 * Qué se guarda para abrir sin conexión. De Análisis, solo el periodo en pantalla: un año son dos años
 * de movimientos, y cada periodo recorrido sería otra copia en localStorage.
 */
export function guardarSinConexion(q: Query) {
  if (!defaultShouldDehydrateQuery(q)) return false;
  return q.queryKey[1] !== "analisis" || q.getObserversCount() > 0;
}

alCerrarSesion(() => {
  clienteConsultas.clear();
  try {
    localStorage.removeItem("fa_cache");
  } catch {
    // nada
  }
});

export const claves = {
  yo: ["yo"] as const,
  categorias: ["categorias"] as const,
  tablero: (mes: string) => ["tablero", mes] as const,
  movimientos: (f: FiltrosMovimientos) => ["movimientos", f] as const,
};

export function useYo() {
  return useQuery({ queryKey: claves.yo, queryFn: () => api<Yo>("/v1/yo") });
}

export function useCategorias() {
  return useQuery({
    queryKey: claves.categorias,
    queryFn: () => api<{ categorias: Categoria[] }>("/v1/categorias").then((r) => r.categorias),
    staleTime: 60 * 60 * 1000,
  });
}

export function useTablero(mes: string) {
  return useQuery({
    queryKey: claves.tablero(mes),
    queryFn: () => api<Tablero>(`/v1/tablero?mes=${mes}`),
    placeholderData: (previo) => previo,
  });
}

export type FiltrosMovimientos = {
  /** YYYY-MM o "todo" */
  mes: string;
  tipo?: TipoMovimiento;
  categoria?: string;
  texto?: string;
  revisar?: boolean;
  /** Id de cuenta: lo que salió o llegó a ella. */
  cuenta?: string;
  etiqueta?: string;
};

export const POR_PAGINA = 50;

export function parametrosMovimientos(f: FiltrosMovimientos, offset: number) {
  const p = new URLSearchParams();
  if (f.mes === "todo") {
    // El contrato no tiene "todo": se pide un rango amplio.
    p.set("desde", "2000-01-01");
    p.set("hasta", "2099-12-31");
  } else {
    const { desde, hasta } = rangoDelMes(f.mes);
    p.set("desde", desde);
    p.set("hasta", hasta);
  }
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.categoria) p.set("categoria_id", f.categoria);
  if (f.texto) p.set("texto", f.texto);
  if (f.revisar) p.set("revisar", "1");
  if (f.cuenta) p.set("cuenta_id", f.cuenta);
  if (f.etiqueta) p.set("etiqueta_id", f.etiqueta);
  p.set("limite", String(POR_PAGINA));
  p.set("offset", String(offset));
  return p;
}

type PaginaMovimientos = { total: number; movimientos: MovimientoApp[] };

export function useMovimientos(f: FiltrosMovimientos) {
  return useInfiniteQuery({
    queryKey: claves.movimientos(f),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api<PaginaMovimientos>(`/v1/movimientos?${parametrosMovimientos(f, pageParam)}`, { signal }),
    getNextPageParam: (ultima, paginas) => {
      const cargados = paginas.reduce((n, p) => n + p.movimientos.length, 0);
      return cargados < ultima.total && ultima.movimientos.length > 0 ? cargados : undefined;
    },
    placeholderData: (previo) => previo,
  });
}

/**
 * Gasto de cada día del mes, por moneda (índice 0 = día 1), para la gráfica de ritmo.
 * Guarda solo las sumas, no los movimientos: pesa poco en el caché sin conexión.
 * La clave empieza con "movimientos" para que se refresque con cualquier cambio.
 */
export function useGastoPorDia(mes: string, activo = true) {
  return useQuery({
    queryKey: ["movimientos", "por-dia", mes] as const,
    enabled: activo,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { desde, hasta } = rangoDelMes(mes);
      const dias = Number(hasta.slice(8, 10));
      const porMoneda: Record<string, number[]> = {};
      // El servidor da hasta 500 por página; un mes rara vez pasa de una.
      for (let offset = 0; offset < 5000; offset += 500) {
        const p = new URLSearchParams({ desde, hasta, tipo: "gasto", limite: "500", offset: String(offset) });
        const pagina = await api<PaginaMovimientos>(`/v1/movimientos?${p}`, { signal });
        for (const m of pagina.movimientos) {
          const dia = Number(m.fecha.slice(8, 10));
          const lista = (porMoneda[m.moneda] ??= Array.from({ length: dias }, () => 0));
          if (dia >= 1 && dia <= dias) lista[dia - 1] = (lista[dia - 1] ?? 0) + m.montoCentavos;
        }
        if (pagina.movimientos.length < 500 || offset + 500 >= pagina.total) break;
      }
      return { mes, dias, porMoneda };
    },
  });
}

/** Un movimiento por id (detalle; destino de una notificación). */
/** Abre el detalle con lo que ya se ve en la lista; el servidor lo confirma detrás. */
export function abrirDetalle(m: MovimientoApp) {
  clienteConsultas.setQueryData(["movimientos", "uno", m.id], m);
  navegar(hashDetalle(m.id));
}

export function useMovimiento(id: string | null) {
  return useQuery({
    queryKey: ["movimientos", "uno", id] as const,
    enabled: !!id,
    queryFn: ({ signal }) => api<MovimientoApp>(`/v1/movimientos/${encodeURIComponent(id ?? "")}`, { signal }),
  });
}

export type GastoConLugar = {
  id: string;
  fecha: string;
  centavos: number;
  moneda: string;
  lat: number;
  lon: number;
  lugar: string | null;
  comercio: string | null;
  descripcion: string | null;
};

/** Gastos con ubicación en un rango, para el mapa. Solo guarda lo que el mapa usa. */
export function useGastosConLugar(desde: string, hasta: string) {
  return useQuery({
    queryKey: ["movimientos", "mapa", desde, hasta] as const,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const lista: GastoConLugar[] = [];
      for (let offset = 0; offset < 5000; offset += 500) {
        const p = new URLSearchParams({ desde, hasta, tipo: "gasto", limite: "500", offset: String(offset) });
        const pagina = await api<PaginaMovimientos>(`/v1/movimientos?${p}`, { signal });
        for (const m of pagina.movimientos) {
          if (m.lat === null || m.lon === null) continue;
          lista.push({
            id: m.id,
            fecha: m.fecha,
            centavos: m.montoCentavos,
            moneda: m.moneda,
            lat: m.lat,
            lon: m.lon,
            lugar: m.lugar,
            comercio: m.comercio,
            descripcion: m.descripcion,
          });
        }
        if (pagina.movimientos.length < 500 || offset + 500 >= pagina.total) break;
      }
      return lista;
    },
  });
}

/**
 * Todos los movimientos de un rango, reducidos a lo que usa Análisis (el periodo y el anterior juntos).
 * La clave empieza con "movimientos": se refresca con cualquier cambio, como las demás.
 */
/** `antes`: si hay algún registro antes de `desde` (para saber si de verdad hay con qué comparar). */
export type FilasAnalisis = { desde: string; hasta: string; filas: Fila[]; antes: boolean };

export function useFilasAnalisis(desde: string, hasta: string) {
  return useQuery<FilasAnalisis>({
    queryKey: ["movimientos", "analisis", desde, hasta] as const,
    staleTime: 60_000,
    // Los periodos que ya no se ven salen pronto de memoria.
    gcTime: 10 * 60_000,
    placeholderData: (previo) => previo,
    queryFn: async ({ signal }) => {
      // Un solo registro anterior basta: si existe, la app ya se usaba aunque esos días no haya nada.
      const previo = new URLSearchParams({ hasta: sumarDias(desde, -1), limite: "1" });
      const antes = api<PaginaMovimientos>(`/v1/movimientos?${previo}`, { signal }).then((p) => p.total > 0)
        .catch(() => false);
      const filas: Fila[] = [];
      // 500 por página (lo más que da el servidor); un tope alto por si acaso.
      for (let offset = 0; offset < 20_000; offset += 500) {
        const p = new URLSearchParams({ desde, hasta, limite: "500", offset: String(offset) });
        const pagina = await api<PaginaMovimientos>(`/v1/movimientos?${p}`, { signal });
        for (const m of pagina.movimientos) filas.push(aFila(m));
        if (pagina.movimientos.length < 500 || offset + 500 >= pagina.total) break;
      }
      return { desde, hasta, filas, antes: await antes };
    },
  });
}

/** Después de cualquier cambio: tablero y listas se vuelven a pedir. */
export function useRefrescarDatos() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["tablero"] }),
      qc.invalidateQueries({ queryKey: ["movimientos"] }),
      qc.invalidateQueries({ queryKey: ["plan"] }),
      // Un gasto con cuenta cambia su saldo, y uno con etiqueta lo que lleva.
      qc.invalidateQueries({ queryKey: ["cuentas"] }),
      qc.invalidateQueries({ queryKey: ["etiquetas"] }),
    ]);
}

export function useGuardarMovimiento() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: DatosMovimiento }) =>
      id
        ? api<MovimientoApp>(`/v1/movimientos/${encodeURIComponent(id)}`, { method: "PATCH", body: datos })
        : api<MovimientoApp>("/v1/movimientos", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}
