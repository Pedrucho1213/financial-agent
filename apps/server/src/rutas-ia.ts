import type { Hono } from "hono";
import { z } from "zod";
import { type ControlIa, MINUTOS_MAX, MINUTOS_MIN } from "./ai/encendido";
import type { VariablesAuth } from "./auth";

const esquemaModo = z
  .object({
    siempre: z.boolean().optional(),
    minutos: z.number().int().min(MINUTOS_MIN).max(MINUTOS_MAX).optional(),
  })
  .strict()
  .refine((m) => m.siempre !== undefined || m.minutos !== undefined, "Manda siempre o minutos.");

/**
 * Interruptor de la IA (desarrollo): solo para la cuenta dueña de la instalación.
 * El servidor es público: a cualquier otra cuenta se le contesta 403 sin decir nada del modelo.
 */
export function rutasIa(
  v1: Hono<{ Variables: VariablesAuth }>,
  { control, esDueno, alCambiar }: { control: ControlIa; esDueno: (usuarioId: string) => boolean; alCambiar: () => void },
) {
  const soloDueno = "Solo la cuenta dueña de esta instalación puede encender o apagar la IA.";

  v1.get("/ia", async (c) => {
    if (!esDueno(c.get("usuarioId"))) return c.json({ error: soloDueno }, 403);
    return c.json(await control.estado());
  });

  v1.put("/ia", async (c) => {
    if (!esDueno(c.get("usuarioId"))) return c.json({ error: soloDueno }, 403);
    const cuerpo = esquemaModo.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "Datos inválidos", detalles: cuerpo.error.flatten() }, 400);
    const estado = await control.cambiar(cuerpo.data);
    alCambiar();
    return c.json(estado);
  });

  v1.post("/ia/encender", async (c) => {
    if (!esDueno(c.get("usuarioId"))) return c.json({ error: soloDueno }, 403);
    const estado = await control.encender();
    alCambiar();
    return c.json(estado);
  });

  v1.post("/ia/apagar", async (c) => {
    if (!esDueno(c.get("usuarioId"))) return c.json({ error: soloDueno }, 403);
    const estado = await control.apagar();
    alCambiar();
    return c.json(estado);
  });
}
