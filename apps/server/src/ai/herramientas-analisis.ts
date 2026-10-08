import { tool } from "ai";
import { z } from "zod";
import { analizar } from "../finanzas/analisis";
import type { Contexto } from "../finanzas/contexto";

/** Envuelve una herramienta: guarda la acción y devuelve los errores de validación como texto. */
type Ejecutar = <A, R>(nombre: string, fn: (args: A) => R) => (args: A) => Promise<R | { error: string }>;

// Solo lee: no cambia nada.
export const CONSULTAS_ANALISIS = new Set(["analizar"]);

/** "¿Cómo voy?", "¿en qué puedo ahorrar?", "¿cómo cerraré el mes?": el análisis lo hace el código. */
export function herramientasAnalisis(ctx: Contexto, ejecutar: Ejecutar) {
  return {
    analizar: tool({
      description:
        'Analiza sus gastos y trae la respuesta lista para decir. como_voy: "¿cómo voy?", "¿cómo voy esta semana?". comparar: "¿gasto más que el mes pasado?", "¿en qué gasté más que antes?". ahorrar: "¿en qué puedo ahorrar?", "dame un consejo", "¿tengo gastos hormiga?". proyeccion: "¿cuánto voy a gastar este mes?", "¿cómo voy a cerrar el mes?", "¿me va a alcanzar?".',
      inputSchema: z.object({
        enfoque: z.enum(["como_voy", "comparar", "ahorrar", "proyeccion"]),
        periodo: z.enum(["mes", "semana"]).optional().describe("mes por omisión; semana si pregunta por la semana."),
      }),
      execute: ejecutar("analizar", ({ enfoque, periodo }) => {
        const a = analizar(ctx, { enfoque, periodo });
        return { respuesta: a.respuesta, hallazgos: a.hallazgos.map((h) => h.texto) };
      }),
    }),
  };
}
