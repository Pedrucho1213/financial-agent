import { useMutation } from "@tanstack/react-query";
import { api } from "./api";
import { useRefrescarDatos } from "./consultas";
import type { DeudaPersona, Prestamo, Prestamos } from "./tipos";

// Deudas y préstamos con personas: alta a mano, abonos, editar y borrar. Lo mismo se puede por voz.

export type Direccion = DeudaPersona["direccion"];

/** POST /v1/prestamos y PATCH /v1/prestamos/:id (montos en pesos). */
export type DatosPrestamo = {
  persona?: string;
  direccion?: Direccion;
  monto?: number;
  fecha?: string;
  descripcion?: string | null;
  /** Nombre de la cuenta de la que salió (o a la que llegó) el dinero; vacío si no se movió. */
  cuenta?: string | null;
};

/** POST /v1/prestamos/abonos (monto en pesos). Se reparte en los préstamos más viejos de esa persona. */
export type DatosAbono = {
  persona: string;
  direccion: Direccion;
  monto: number;
  fecha?: string;
  descripcion?: string | null;
  cuenta?: string | null;
};

const sinAcentos = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

export const mismaPersona = (a: string, b: string) => sinAcentos(a) === sinAcentos(b);

/** La deuda de esa persona en ese sentido, o null si ya no está (se borró o se saldó y no se pidieron las saldadas). */
export function buscarDeuda(personas: DeudaPersona[], persona: string, direccion: Direccion) {
  return personas.find((d) => d.direccion === direccion && mismaPersona(d.persona, persona)) ?? null;
}

/** Ruta del detalle de una deuda. */
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
    g.movimientos.push({ tipo: "prestamo", id: p.id, fecha: p.creadoEn, montoCentavos: p.montoCentavos, cuenta: null, nota: p.descripcion });
    grupos.set(clave, g);
  }
  return [...grupos.values()];
}

/** Los préstamos sueltos de una deuda (para editar uno o borrarlos todos). */
export const prestamosDe = (datos: Prestamos | undefined, d: Pick<DeudaPersona, "persona" | "direccion">): Prestamo[] =>
  (datos?.prestamos ?? []).filter((p) => p.direccion === d.direccion && mismaPersona(p.persona, d.persona));

export function useGuardarPrestamo() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: ({ id, datos }: { id?: string; datos: DatosPrestamo }) =>
      id
        ? api<Prestamo>(`/v1/prestamos/${encodeURIComponent(id)}`, { method: "PATCH", body: datos })
        : api<Prestamo>("/v1/prestamos", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

/** Cambia el nombre (o el sentido) de todos los préstamos de una persona. */
export function useRenombrarDeuda() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: ({ ids, datos }: { ids: string[]; datos: Pick<DatosPrestamo, "persona" | "direccion"> }) =>
      Promise.all(ids.map((id) => api<Prestamo>(`/v1/prestamos/${encodeURIComponent(id)}`, { method: "PATCH", body: datos }))),
    onSuccess: () => refrescar(),
  });
}

export function useBorrarPrestamos() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api<{ ok: true }>(`/v1/prestamos/${encodeURIComponent(id)}`, { method: "DELETE" }))),
    onSuccess: () => refrescar(),
  });
}

/** Deshace un borrado: lo que se borró vuelve tal cual, con sus abonos. */
export function useRestaurarPrestamos() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => api<Prestamo>(`/v1/prestamos/${encodeURIComponent(id)}/restaurar`, { method: "POST" }))),
    onSuccess: () => refrescar(),
  });
}

export function useAbonar() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (datos: DatosAbono) => api<{ ok: true }>("/v1/prestamos/abonos", { method: "POST", body: datos }),
    onSuccess: () => refrescar(),
  });
}

export function useBorrarAbono() {
  const refrescar = useRefrescarDatos();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/v1/prestamos/abonos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => refrescar(),
  });
}
