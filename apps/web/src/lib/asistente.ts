import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

// GET /v1/analisis: lo mismo que la IA dice por voz a "¿cómo cierro el mes?" o "¿en qué ahorro?",
// con cada hallazgo aparte. Lo calcula el servidor (sin modelo), así que es rápido y siempre igual.

export type EnfoqueAsistente = "como_voy" | "comparar" | "ahorrar" | "proyeccion";

export type HallazgoAsistente = {
  tipo: "comparacion" | "sube" | "baja" | "mayor" | "proyeccion" | "presupuesto" | "hormiga" | "suscripciones" | "recortable";
  texto: string;
  ahorroMensualCentavos?: number;
};

export type AnalisisAsistente = {
  enfoque: EnfoqueAsistente;
  periodo: "mes" | "semana";
  respuesta: string;
  hallazgos: HallazgoAsistente[];
  gastadoCentavos: number;
  comparadoCon?: string;
  baseCentavos?: number;
  proyeccion?: { cierreCentavos: number; ritmoDiarioCentavos: number; porPagarCentavos: number; ingresosCentavos: number };
};

/** Los tipos que son ideas para ahorrar (traen cuánto al mes). */
export const IDEAS_AHORRO: HallazgoAsistente["tipo"][] = ["hormiga", "suscripciones", "recortable"];

/**
 * La clave empieza con "movimientos": cualquier gasto nuevo, borrado o corrección la refresca (refrescarDatos).
 * Lleva el mes para que, al cambiar de mes, no se vea un momento lo del anterior. Un minuto fresco, como el
 * resto de Análisis: lo que se dicta por voz no pasa por la app.
 * Un servidor sin /v1/analisis (404) no se reintenta: la sección simplemente no sale.
 */
export function useAsistente(enfoque: EnfoqueAsistente, mes: string, activo = true) {
  return useQuery({
    queryKey: ["movimientos", "asistente", enfoque, mes] as const,
    enabled: activo,
    staleTime: 60_000,
    queryFn: ({ signal }) => api<AnalisisAsistente>(`/v1/analisis?enfoque=${enfoque}`, { signal }),
  });
}
