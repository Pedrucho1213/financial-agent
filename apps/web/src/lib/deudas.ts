import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useRefrescarDatos } from "./consultas";
import type { DeudaPersona, Prestamos } from "./tipos";

// Deudas y préstamos con personas: alta a mano, abonos, editar y borrar (contrato en deudas/contrato-api.md del
// proyecto). Lo mismo se puede por voz.

export type Direccion = DeudaPersona["direccion"];

/** Con `todos`, también las saldadas (Cuentas y el detalle las necesitan; Plan no). */
export function usePrestamos({ todos = false }: { todos?: boolean } = {}) {
  return useQuery({
    queryKey: ["plan", "prestamos", todos ? "todos" : "pendientes"] as const,
    queryFn: ({ signal }) => api<Prestamos>(`/v1/prestamos${todos ? "?todos=1" : ""}`, { signal }),
  });
}

/** POST /v1/prestamos (monto en pesos). Si ya hay deuda con esa persona en ese sentido, se suma. */
export type DatosNuevaDeuda = {
  persona: string;
  direccion: Direccion;
  monto: number;
  fecha?: string;
  descripcion?: string;
  /** De dónde salió (le presté) o a dónde llegó (me prestó) el dinero. */
  cuenta_id?: string;
};

/** POST /v1/prestamos/:id/abonos (monto en pesos). */
export type DatosAbono = { monto: number; cuenta_id?: string };

/** PATCH /v1/prestamos/:id: corrige lo anotado, sin mover cuentas. `monto` y `pendiente` no van juntos. */
export type DatosEditarDeuda = { persona?: string; direccion?: Direccion; monto?: number; pendiente?: number; descripcion?: string | null };

const sinAcentos = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

export const mismaPersona = (a: string, b: string) => sinAcentos(a) === sinAcentos(b);

/** La deuda de esa persona en ese sentido, o null si ya no está. */
export function buscarDeuda(personas: DeudaPersona[], persona: string, direccion: Direccion) {
  return personas.find((d) => d.direccion === direccion && mismaPersona(d.persona, persona)) ?? null;
}

export const estaSaldada = (d: DeudaPersona) => d.saldada ?? d.pendienteCentavos <= 0;

/** Ruta del detalle de una deuda: por persona y sentido, que no cambian al juntar préstamos. */
export const hashDeuda = (d: Pick<DeudaPersona, "persona" | "direccion">) =>
  `#deuda?${new URLSearchParams({ persona: d.persona, dir: d.direccion }).toString()}`;

/** Un servidor viejo (o el caché de antes) no manda `personas`: se arman aquí, sin abonos, para que todo abra igual. */
export function personasDe(datos: Prestamos | undefined): DeudaPersona[] {
  if (!datos) return [];
  if (datos.personas) return datos.personas;
  const grupos = new Map<string, DeudaPersona>();
  for (const p of datos.prestamos) {
    const clave = `${sinAcentos(p.persona)}|${p.direccion}`;
    const g = grupos.get(clave) ?? {
      persona: p.persona,
      direccion: p.direccion,
      prestadoCentavos: 0,
      pagadoCentavos: 0,
      pendienteCentavos: 0,
      desde: p.creadoEn,
      movimientos: [],
    };
    g.prestadoCentavos += p.montoCentavos;
    g.pagadoCentavos += p.pagadoCentavos;
    g.pendienteCentavos += p.pendienteCentavos;
    if (p.creadoEn < g.desde) g.desde = p.creadoEn;
    g.movimientos.push({ tipo: "prestamo", fecha: p.creadoEn, montoCentavos: p.montoCentavos, cuenta: null });
    grupos.set(clave, g);
  }
  return [...grupos.values()];
}

export function useAgregarDeuda() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (datos: DatosNuevaDeuda) => api<DeudaPersona>("/v1/prestamos", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export function useAbonar() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: DatosAbono }) =>
      api<DeudaPersona>(`/v1/prestamos/${encodeURIComponent(id)}/abonos`, { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export function useEditarDeuda() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: DatosEditarDeuda }) =>
      api<DeudaPersona>(`/v1/prestamos/${encodeURIComponent(id)}`, { method: "PATCH", body: datos }),
    onSuccess: () => refrescar(),
  });
}

/** Borra toda la deuda con esa persona en ese sentido. «Deshacer» es POST /v1/deshacer. */
export function useBorrarDeuda() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/v1/prestamos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => refrescar(),
  });
}
