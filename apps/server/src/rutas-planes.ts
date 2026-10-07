import type { Hono } from "hono";
import { z } from "zod";
import type { VariablesAuth } from "./auth";
import { descartarAviso, listarAvisos, marcarLeido } from "./finanzas/avisos";
import type { Contexto } from "./finanzas/contexto";
import {
  aportarMeta,
  crearMeta,
  disponible,
  editarMeta,
  eliminarMeta,
  estadoPresupuestos,
  fijarPresupuesto,
  listarMetas,
  listarMsi,
  listarPrestamos,
  metaApp,
  quitarPresupuesto,
} from "./finanzas/planes";
import { revisar } from "./finanzas/revisor";

const monto = z.coerce.number().positive().max(1e10);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD.");

const esquemaPresupuesto = z.object({ categoria_id: z.string().trim().min(1).nullable().optional(), limite: monto });
const esquemaMeta = z.object({
  nombre: z.string().trim().min(1).max(80),
  objetivo: monto,
  ahorrado: z.coerce.number().min(0).max(1e10).optional(),
  fecha_limite: fecha.nullable().optional(),
});
const esquemaEdicionMeta = z.object({
  nombre: z.string().trim().min(1).max(80).optional(),
  objetivo: monto.optional(),
  fecha_limite: fecha.nullable().optional(),
});
const esquemaAporte = z.object({ monto: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 1e10, "El monto no puede ser cero.") });

type Errores = { error: string; detalles?: unknown };
const invalido = (error: z.ZodError): Errores => ({ error: "Datos inválidos.", detalles: z.flattenError(error).fieldErrors });

/**
 * Presupuestos, metas, préstamos, MSI, "¿cuánto puedo gastar hoy?" y los avisos del revisor, para la app.
 * Los errores de validación de finanzas (ErrorFinanzas) ya se convierten en 400 en `v1`.
 */
export function rutasPlanes(v1: Hono<{ Variables: VariablesAuth }>, contexto: (usuarioId: string) => Contexto) {
  v1.get("/presupuestos", (c) => c.json(estadoPresupuestos(contexto(c.get("usuarioId")), c.req.query("mes") || undefined)));

  v1.put("/presupuestos", async (c) => {
    const cuerpo = esquemaPresupuesto.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    return c.json(fijarPresupuesto(contexto(c.get("usuarioId")), { categoriaId: cuerpo.data.categoria_id ?? null, monto: cuerpo.data.limite }));
  });

  v1.delete("/presupuestos/:id", (c) => {
    quitarPresupuesto(contexto(c.get("usuarioId")), { id: c.req.param("id") });
    return c.json({ ok: true });
  });

  v1.get("/metas", (c) => c.json(listarMetas(contexto(c.get("usuarioId")))));

  v1.post("/metas", async (c) => {
    const cuerpo = esquemaMeta.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const d = cuerpo.data;
    return c.json(crearMeta(contexto(c.get("usuarioId")), { nombre: d.nombre, objetivo: d.objetivo, ahorrado: d.ahorrado, fechaLimite: d.fecha_limite }), 201);
  });

  v1.patch("/metas/:id", async (c) => {
    const cuerpo = esquemaEdicionMeta.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const { nombre, objetivo, fecha_limite } = cuerpo.data;
    return c.json(editarMeta(contexto(c.get("usuarioId")), { id: c.req.param("id"), cambios: { nombre, objetivo, fechaLimite: fecha_limite } }));
  });

  v1.post("/metas/:id/aportes", async (c) => {
    const cuerpo = esquemaAporte.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const ctx = contexto(c.get("usuarioId"));
    const { aportadoCentavos: _, recienCompletada: __, ...meta } = aportarMeta(ctx, { id: c.req.param("id"), monto: cuerpo.data.monto });
    return c.json(meta satisfies ReturnType<typeof metaApp>);
  });

  v1.delete("/metas/:id", (c) => {
    eliminarMeta(contexto(c.get("usuarioId")), { id: c.req.param("id") });
    return c.json({ ok: true });
  });

  v1.get("/prestamos", (c) => c.json(listarPrestamos(contexto(c.get("usuarioId")), { todos: c.req.query("todos") === "1" })));

  v1.get("/msi", (c) => c.json(listarMsi(contexto(c.get("usuarioId")), { todas: c.req.query("todas") === "1" })));

  v1.get("/disponible", (c) => c.json(disponible(contexto(c.get("usuarioId")))));

  v1.get("/avisos", (c) => c.json(listarAvisos(contexto(c.get("usuarioId")), { todos: c.req.query("todos") === "1" })));

  v1.post("/avisos/revisar", (c) => c.json(revisar(contexto(c.get("usuarioId")))));

  v1.post("/avisos/:id/leido", (c) => c.json(marcarLeido(contexto(c.get("usuarioId")), c.req.param("id"))));

  v1.post("/avisos/:id/descartar", (c) => c.json(descartarAviso(contexto(c.get("usuarioId")), c.req.param("id"))));
}
