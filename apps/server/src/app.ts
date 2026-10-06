import type { LanguageModel } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { ErrorEnProceso, ErrorIA, hablar } from "./ai/asistente";
import { requiereToken, type VariablesAuth } from "./auth";
import type { Db } from "./db/client";
import { crearContexto } from "./finanzas/contexto";
import { buscarMovimientos, ErrorFinanzas, resumir } from "./finanzas/movimientos";

export type OpcionesApp = {
  db: Db;
  modelo: LanguageModel;
  zonaHoraria: string;
  monedaBase: string;
  /** Precarga el modelo de IA; en pruebas no hace nada. */
  despertar?: () => Promise<unknown>;
};

const esquemaHablar = z.object({
  texto: z.string().trim().min(1).max(2000),
  client_id: z.string().trim().min(8).max(100),
  conversacion_id: z.string().trim().max(100).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  lugar: z.string().trim().max(300).optional(),
  capturado_en: z.iso.datetime({ offset: true }).optional(),
});

// Los Atajos mandan "" en los campos vacíos; se tratan como ausentes.
function sinVacios(cuerpo: unknown): unknown {
  if (!cuerpo || typeof cuerpo !== "object") return cuerpo;
  return Object.fromEntries(Object.entries(cuerpo).filter(([, v]) => v !== "" && v !== null));
}

export function crearApp(opciones: OpcionesApp) {
  const { db } = opciones;
  const app = new Hono<{ Variables: VariablesAuth }>();

  app.get("/salud", (c) => c.json({ ok: true }));

  const v1 = new Hono<{ Variables: VariablesAuth }>();
  v1.use(requiereToken(db));

  // Punto de entrada único: registrar o preguntar, por voz o texto.
  v1.post("/hablar", async (c) => {
    const cuerpo = esquemaHablar.safeParse(sinVacios(await c.req.json().catch(() => null)));
    if (!cuerpo.success) {
      return c.json({ error: "Petición inválida.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const p = cuerpo.data;
    try {
      const respuesta = await hablar(opciones, c.get("usuarioId"), {
        texto: p.texto,
        clientId: p.client_id,
        conversacionId: p.conversacion_id,
        lat: p.lat,
        lon: p.lon,
        lugar: p.lugar,
        capturadoEn: p.capturado_en,
      });
      return c.json(respuesta);
    } catch (error) {
      if (error instanceof ErrorEnProceso) {
        return c.json({ error: error.message, respuesta: "Ese mensaje todavía se está procesando." }, 409);
      }
      if (error instanceof ErrorIA) {
        console.error("Fallo de la IA:", error.message);
        // 503 le indica al Atajo que deje el dictado en la cola y lo reintente después.
        return c.json({ error: "La IA no respondió.", respuesta: "No pude procesarlo ahora; queda guardado en tu iPhone para enviarlo después." }, 503);
      }
      throw error;
    }
  });

  // El Atajo lo llama al abrirse para que el modelo ya esté cargado cuando termines de hablar.
  v1.post("/despertar", (c) => {
    void opciones.despertar?.();
    return c.json({ ok: true });
  });

  v1.get("/movimientos", (c) => {
    const ctx = crearContexto({ db, usuarioId: c.get("usuarioId"), zonaHoraria: opciones.zonaHoraria, monedaBase: opciones.monedaBase });
    try {
      return c.json(
        buscarMovimientos(ctx, {
          periodo: c.req.query("periodo") ?? "este_mes",
          texto: c.req.query("texto"),
          limite: Number(c.req.query("limite") ?? 50),
        }),
      );
    } catch (error) {
      if (error instanceof ErrorFinanzas) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  v1.get("/resumen", (c) => {
    const ctx = crearContexto({ db, usuarioId: c.get("usuarioId"), zonaHoraria: opciones.zonaHoraria, monedaBase: opciones.monedaBase });
    try {
      return c.json(resumir(ctx, { periodo: c.req.query("periodo") ?? "este_mes", agruparPor: "categoria" }));
    } catch (error) {
      if (error instanceof ErrorFinanzas) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  app.route("/v1", v1);
  return app;
}
