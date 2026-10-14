import type { Hono } from "hono";
import { z } from "zod";
import type { VariablesAuth } from "./auth";
import type { Db } from "./db/client";
import {
  cobrosApp,
  cobrosHabilitado,
  confirmarCobro,
  confirmarVarios,
  deshacerCobro,
  posponerCobro,
  saltarCobro,
} from "./finanzas/cobros";
import type { Contexto } from "./finanzas/contexto";
import { GRUPOS_AVISO, guardarPreferencias, preferenciasDe } from "./push/preferencias";

const esquemaConfirmar = z.object({
  monto: z.coerce.number().positive().max(1e10).optional(),
  cuenta_id: z.string().trim().min(1).nullable().optional(),
  movimiento_id: z.string().trim().min(1).optional(),
  actualizar_precio: z.boolean().optional(),
});
const esquemaVarios = z.object({ ids: z.array(z.string().trim().min(1)).min(1).max(20) });
const esquemaPreferencias = z.object({
  tipos: z.partialRecord(z.enum(GRUPOS_AVISO as [string, ...string[]]), z.boolean()).optional(),
  desde: z.number().int().min(0).max(23).optional(),
  hasta: z.number().int().min(1).max(24).optional(),
});

const invalido = (error: z.ZodError) => ({ error: "Datos inválidos.", detalles: z.flattenError(error).fieldErrors });

/**
 * Confirmar los cobros de suscripciones y pagos fijos, y qué avisos quiere por notificación. Con CONFIRMAR_COBROS=dueno
 * o =0, las cuentas que no lo tienen reciben 404 y la app no lo muestra.
 */
export function rutasCobros(v1: Hono<{ Variables: VariablesAuth }>, db: Db, contexto: (usuarioId: string) => Contexto) {
  v1.use("/cobros/*", async (c, next) => {
    if (!cobrosHabilitado(db, c.get("usuarioId"))) return c.json({ error: "No encontrado." }, 404);
    await next();
  });
  v1.use("/cobros", async (c, next) => {
    if (!cobrosHabilitado(db, c.get("usuarioId"))) return c.json({ error: "No encontrado." }, 404);
    await next();
  });
  v1.use("/avisos/preferencias", async (c, next) => {
    if (!cobrosHabilitado(db, c.get("usuarioId"))) return c.json({ error: "No encontrado." }, 404);
    await next();
  });

  v1.get("/cobros", (c) => c.json(cobrosApp(contexto(c.get("usuarioId")))));

  v1.post("/cobros/confirmar", async (c) => {
    const cuerpo = esquemaVarios.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    return c.json(confirmarVarios(contexto(c.get("usuarioId")), cuerpo.data.ids));
  });

  v1.post("/cobros/:id/confirmar", async (c) => {
    const cuerpo = esquemaConfirmar.safeParse((await c.req.json().catch(() => null)) ?? {});
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const { cuenta_id, movimiento_id, actualizar_precio, monto } = cuerpo.data;
    return c.json(
      confirmarCobro(contexto(c.get("usuarioId")), c.req.param("id"), {
        monto,
        cuentaId: cuenta_id,
        movimientoId: movimiento_id,
        actualizarPrecio: actualizar_precio,
        origen: "app",
      }),
    );
  });

  v1.post("/cobros/:id/posponer", (c) => c.json(posponerCobro(contexto(c.get("usuarioId")), c.req.param("id"))));
  v1.post("/cobros/:id/saltar", (c) => c.json(saltarCobro(contexto(c.get("usuarioId")), c.req.param("id"))));
  v1.post("/cobros/:id/deshacer", (c) => c.json(deshacerCobro(contexto(c.get("usuarioId")), c.req.param("id"))));

  v1.get("/avisos/preferencias", (c) => c.json(preferenciasDe(db, c.get("usuarioId"))));
  v1.put("/avisos/preferencias", async (c) => {
    const cuerpo = esquemaPreferencias.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const { desde, hasta, tipos } = cuerpo.data;
    if (desde !== undefined && hasta !== undefined && hasta <= desde) return c.json({ error: "El horario debe terminar después de empezar." }, 400);
    try {
      return c.json(guardarPreferencias(db, c.get("usuarioId"), { desde, hasta, tipos }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "El horario no es válido." }, 400);
    }
  });
}
