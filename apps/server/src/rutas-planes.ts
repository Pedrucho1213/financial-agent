import type { Hono } from "hono";
import { z } from "zod";
import type { VariablesAuth } from "./auth";
import { analizar, type Enfoque, type PeriodoAnalisis } from "./finanzas/analisis";
import { descartarAviso, listarAvisos, marcarLeido } from "./finanzas/avisos";
import type { Contexto } from "./finanzas/contexto";
import {
  aportarMeta,
  crearMeta,
  disponible,
  editarMeta,
  eliminarMeta,
  esFechaValida,
  estadoPresupuestos,
  fijarPresupuesto,
  listarMetas,
  listarMsi,
  deudaPorId,
  deudasEdicionHabilitada,
  deudasPorPersona,
  editarDeuda,
  eliminarDeuda,
  listarPrestamos,
  abonarPrestamo,
  moverPorDeuda,
  registrarPrestamo,
  metaApp,
  quitarPresupuesto,
} from "./finanzas/planes";
import { revisar } from "./finanzas/revisor";
import { estadoDeCuenta } from "./finanzas/cuentas";
import { ErrorFinanzas } from "./finanzas/movimientos";

const monto = z.coerce.number().positive().max(1e10);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD.").refine(esFechaValida, "Esa fecha no existe.");

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

const direccion = z.enum(["debo", "me_deben"]);
const esquemaPrestamo = z.object({
  persona: z.string().trim().min(1).max(80),
  direccion,
  monto,
  descripcion: z.string().trim().max(500).optional(),
  cuenta_id: z.string().trim().min(1).optional(),
  fecha: fecha.optional(),
});
const esquemaAbono = z.object({ monto: monto.optional(), cuenta_id: z.string().trim().min(1).optional() });
const esquemaEdicionPrestamo = z
  .object({
    persona: z.string().trim().min(1).max(80).optional(),
    monto: monto.optional(),
    pendiente: z.coerce.number().min(0).max(1e10).optional(),
    descripcion: z.string().trim().max(500).nullable().optional(),
    direccion: direccion.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), "Di qué cambiar.")
  .refine((d) => d.monto === undefined || d.pendiente === undefined, "Manda el total o lo que queda, no los dos.");

const esquemaAnalisis = z.object({
  enfoque: z.enum(["como_voy", "comparar", "ahorrar", "proyeccion"] satisfies Enfoque[]).default("como_voy"),
  periodo: z.enum(["mes", "semana"] satisfies PeriodoAnalisis[]).optional(),
});

type Errores = { error: string; detalles?: unknown };
// La app elige la fecha en un calendario: una fecha pasada es un error, no "la del año que viene" como en la voz.
const fechaPasada: Errores = { error: "Datos inválidos.", detalles: { fecha_limite: ["La fecha límite ya pasó."] } };
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
    const ctx = contexto(c.get("usuarioId"));
    if (d.fecha_limite && d.fecha_limite < ctx.hoy) return c.json(fechaPasada, 400);
    return c.json(crearMeta(ctx, { nombre: d.nombre, objetivo: d.objetivo, ahorrado: d.ahorrado, fechaLimite: d.fecha_limite }), 201);
  });

  v1.patch("/metas/:id", async (c) => {
    const cuerpo = esquemaEdicionMeta.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const { nombre, objetivo, fecha_limite } = cuerpo.data;
    const ctx = contexto(c.get("usuarioId"));
    if (fecha_limite && fecha_limite < ctx.hoy) return c.json(fechaPasada, 400);
    return c.json(editarMeta(ctx, { id: c.req.param("id"), cambios: { nombre, objetivo, fechaLimite: fecha_limite } }));
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

  v1.get("/prestamos", (c) => {
    const ctx = contexto(c.get("usuarioId"));
    const todos = c.req.query("todos") === "1";
    // `personas`: una deuda por persona y sentido, con sus abonos, para el apartado de Deudas de la app.
    // `edicion`: si la app puede dar de alta, abonar, editar y borrar (interruptor DEUDAS_PERSONAS).
    return c.json({
      ...listarPrestamos(ctx, { todos }),
      personas: deudasPorPersona(ctx, { todos }),
      edicion: deudasEdicionHabilitada(ctx.db, ctx.usuarioId),
    });
  });

  // Alta, abono, edición y borrado desde la app. Cada petición es una sola acción en la bitácora, así que
  // "Deshacer" regresa el abono junto con el dinero que movió en la cuenta.
  const conEdicion = (usuarioId: string): Contexto | undefined => {
    const ctx = { ...contexto(usuarioId), entradaId: `app-${crypto.randomUUID()}` };
    return deudasEdicionHabilitada(ctx.db, usuarioId) ? ctx : undefined;
  };
  const noEncontrado = { error: "No encontrado." };
  // El nombre de la cuenta elegida en la app, si es suya.
  // Valida que la cuenta sea suya (si no, 400) y la pasa por id: dos cuentas parecidas («Efectivo» y «Cartera») no se confunden.
  const cuentaElegida = (ctx: Contexto, id: string | undefined) => (id ? estadoDeCuenta(ctx, id).id : undefined);
  // Una deuda que no existe, o que es de otro usuario, es un 404 y no un 400.
  const existe = (ctx: Contexto, id: string) => {
    try {
      return deudaPorId(ctx, id);
    } catch (error) {
      if (error instanceof ErrorFinanzas) return undefined;
      throw error;
    }
  };

  v1.post("/prestamos", async (c) => {
    const ctx = conEdicion(c.get("usuarioId"));
    if (!ctx) return c.json(noEncontrado, 404);
    const cuerpo = esquemaPrestamo.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const d = cuerpo.data;
    if (d.fecha && d.fecha > ctx.hoy) return c.json({ error: "Datos inválidos.", detalles: { fecha: ["La fecha no puede ser futura."] } }, 400);
    const cuenta = cuentaElegida(ctx, d.cuenta_id);
    const p = registrarPrestamo(ctx, { persona: d.persona, direccion: d.direccion, monto: d.monto, descripcion: d.descripcion, fecha: d.fecha });
    if (cuenta) moverPorDeuda(ctx, { persona: p.persona, direccion: p.direccion, que: "prestamo", centavos: p.montoCentavos, cuentaId: cuenta, fecha: d.fecha });
    return c.json(deudaPorId(ctx, p.id), 201);
  });

  v1.post("/prestamos/:id/abonos", async (c) => {
    const ctx = conEdicion(c.get("usuarioId"));
    if (!ctx) return c.json(noEncontrado, 404);
    const deuda = existe(ctx, c.req.param("id"));
    if (!deuda) return c.json(noEncontrado, 404);
    const cuerpo = esquemaAbono.safeParse(await c.req.json().catch(() => ({})));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    if (deuda.saldada) return c.json({ error: "Esa deuda ya está saldada." }, 400);
    const cuenta = cuentaElegida(ctx, cuerpo.data.cuenta_id);
    const a = abonarPrestamo(ctx, { persona: deuda.persona, direccion: deuda.direccion, monto: cuerpo.data.monto });
    if (cuenta) moverPorDeuda(ctx, { persona: deuda.persona, direccion: deuda.direccion, que: "abono", centavos: a.abonadoCentavos, cuentaId: cuenta });
    return c.json(deudaPorId(ctx, deuda.id));
  });

  v1.patch("/prestamos/:id", async (c) => {
    const ctx = conEdicion(c.get("usuarioId"));
    if (!ctx) return c.json(noEncontrado, 404);
    const deuda = existe(ctx, c.req.param("id"));
    if (!deuda) return c.json(noEncontrado, 404);
    const cuerpo = esquemaEdicionPrestamo.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    return c.json(editarDeuda(ctx, deuda.id, cuerpo.data));
  });

  v1.delete("/prestamos/:id", (c) => {
    const ctx = conEdicion(c.get("usuarioId"));
    if (!ctx) return c.json(noEncontrado, 404);
    const deuda = existe(ctx, c.req.param("id"));
    if (!deuda) return c.json(noEncontrado, 404);
    const e = eliminarDeuda(ctx, deuda.id);
    return c.json({ ok: true, persona: e.persona, pendienteCentavos: e.pendienteCentavos });
  });

  v1.get("/msi", (c) => c.json(listarMsi(contexto(c.get("usuarioId")), { todas: c.req.query("todas") === "1" })));

  v1.get("/disponible", (c) => c.json(disponible(contexto(c.get("usuarioId")))));

  // Lo mismo que la IA dice a "¿cómo voy?", "¿en qué puedo ahorrar?" o "¿cómo cierro el mes?", con cada hallazgo aparte.
  v1.get("/analisis", (c) => {
    const consulta = esquemaAnalisis.safeParse({ enfoque: c.req.query("enfoque") || undefined, periodo: c.req.query("periodo") || undefined });
    if (!consulta.success) return c.json(invalido(consulta.error), 400);
    return c.json(analizar(contexto(c.get("usuarioId")), consulta.data));
  });

  v1.get("/avisos", (c) => c.json(listarAvisos(contexto(c.get("usuarioId")), { todos: c.req.query("todos") === "1" })));

  v1.post("/avisos/revisar", (c) => c.json(revisar(contexto(c.get("usuarioId")))));

  v1.post("/avisos/:id/leido", (c) => c.json(marcarLeido(contexto(c.get("usuarioId")), c.req.param("id"))));

  v1.post("/avisos/:id/descartar", (c) => c.json(descartarAviso(contexto(c.get("usuarioId")), c.req.param("id"))));
}
