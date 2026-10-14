import type { Hono } from "hono";
import { z } from "zod";
import type { VariablesAuth } from "./auth";
import { ESTADOS_RECURRENTE, FRECUENCIAS, TIPOS_RECURRENTE } from "./db/schema";
import type { Contexto } from "./finanzas/contexto";
import {
  crearRecurrenteApp,
  editarRecurrenteApp,
  eliminarRecurrenteApp,
  listarRecurrentes,
  recurrentesApp,
} from "./finanzas/recurrentes";

const campos = {
  nombre: z.string().trim().min(1).max(80),
  tipo: z.enum(TIPOS_RECURRENTE),
  monto: z.coerce.number().positive().max(1e10),
  frecuencia: z.enum(FRECUENCIAS),
  dia: z.coerce.number().int().min(1).max(31),
  mes: z.coerce.number().int().min(1).max(12).nullable().optional(),
  cuenta_id: z.string().trim().min(1).nullable().optional(),
};
const esquemaNuevo = z.object(campos);
const esquemaEdicion = z.object({
  ...campos,
  nombre: campos.nombre.optional(),
  tipo: campos.tipo.optional(),
  monto: campos.monto.optional(),
  frecuencia: campos.frecuencia.optional(),
  dia: campos.dia.optional(),
  estado: z.enum(ESTADOS_RECURRENTE).optional(),
  confirmar_solo: z.boolean().optional(),
});

const invalido = (error: z.ZodError) => ({ error: "Datos inválidos.", detalles: z.flattenError(error).fieldErrors });

/**
 * Suscripciones y pagos fijos (#suscripciones en la app): verlos todos, editarlos, pausarlos, cancelarlos y archivarlos.
 * Los errores de finanzas (ErrorFinanzas) ya se convierten en 400 en `v1`.
 */
export function rutasRecurrentes(v1: Hono<{ Variables: VariablesAuth }>, contexto: (usuarioId: string) => Contexto) {
  // Sin ?todos=1 es lo mismo que contesta la IA: solo los activos.
  v1.get("/recurrentes", (c) => {
    const ctx = contexto(c.get("usuarioId"));
    return c.json(c.req.query("todos") === "1" ? recurrentesApp(ctx) : listarRecurrentes(ctx));
  });

  v1.post("/recurrentes", async (c) => {
    const cuerpo = esquemaNuevo.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const { cuenta_id, ...datos } = cuerpo.data;
    return c.json(crearRecurrenteApp(contexto(c.get("usuarioId")), { ...datos, cuentaId: cuenta_id }), 201);
  });

  v1.patch("/recurrentes/:id", async (c) => {
    const cuerpo = esquemaEdicion.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const { cuenta_id, confirmar_solo, ...cambios } = cuerpo.data;
    return c.json(
      editarRecurrenteApp(contexto(c.get("usuarioId")), c.req.param("id"), { ...cambios, cuentaId: cuenta_id, confirmarSolo: confirmar_solo }),
    );
  });

  v1.delete("/recurrentes/:id", (c) => {
    eliminarRecurrenteApp(contexto(c.get("usuarioId")), c.req.param("id"));
    return c.json({ ok: true });
  });
}
