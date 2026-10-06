import { Hono } from "hono";
import { z } from "zod";
import { consultarEntrada, type Dependencias, ErrorEnProceso, ErrorIA, hablar } from "./ai/asistente";
import { ErrorFirma, firmarAtajo, generarAtajo } from "./atajo/generar";
import {
  canjearInvitacion,
  consultarInvitacion,
  crearDispositivoPara,
  crearInvitacion,
  ErrorInvitacion,
  listarDispositivos,
  requiereToken,
  revocarDispositivo,
  type VariablesAuth,
} from "./auth";
import { usuarios } from "./db/schema";
import { listarCategorias, nombreCompleto } from "./finanzas/catalogos";
import { crearContexto } from "./finanzas/contexto";
import {
  crearMovimiento,
  deshacer,
  editarMovimiento,
  eliminarMovimiento,
  ErrorFinanzas,
  obtenerPropio,
  resumir,
} from "./finanzas/movimientos";
import { listarRecurrentes } from "./finanzas/recurrentes";
import { listarMovimientosApp, movimientoApp, tablero } from "./finanzas/vista";
import { esPregunta } from "./lib/texto";
import { eq } from "drizzle-orm";
import { servirApp } from "./web";

export type OpcionesApp = Dependencias & {
  /** Precarga el modelo de IA; en pruebas no hace nada. */
  despertar?: () => Promise<unknown>;
  /**
   * Cuánto espera el iPhone antes de que la Mac conteste "pendiente" y termine sola.
   * Sin valor, espera a que la IA termine.
   */
  espera?: { registroMs: number; preguntaMs: number };
  /** Firma el Atajo generado; en la Mac usa `shortcuts sign`. Las pruebas lo reemplazan. */
  firmarAtajo?: (xml: string) => Promise<Uint8Array>;
  /** Carpeta con la PWA compilada. Sin ella, la app no se sirve. */
  carpetaWeb?: string;
};

const MAX_ESPERA_MS = 120_000;

const esquemaHablar = z.object({
  texto: z.string().trim().min(1).max(2000),
  client_id: z.string().trim().min(8).max(100),
  conversacion_id: z.string().trim().max(100).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  lugar: z.string().trim().max(300).optional(),
  capturado_en: z.iso.datetime({ offset: true }).optional(),
  // Para clientes que prefieren esperar otra cantidad (la prueba de modelos espera todo).
  espera_ms: z.coerce.number().int().min(0).max(MAX_ESPERA_MS).optional(),
});

// Los Atajos mandan "" en los campos vacíos; se tratan como ausentes.
function sinVacios(cuerpo: unknown): unknown {
  if (!cuerpo || typeof cuerpo !== "object") return cuerpo;
  return Object.fromEntries(Object.entries(cuerpo).filter(([, v]) => v !== "" && v !== null));
}

const esquemaMovimiento = z.object({
  tipo: z.enum(["gasto", "ingreso", "transferencia", "pago_tarjeta"]),
  monto: z.coerce.number().positive().max(1e10),
  moneda: z.string().trim().length(3).optional(),
  categoria_id: z.string().trim().min(1).nullable().optional(),
  comercio: z.string().trim().max(200).optional(),
  descripcion: z.string().trim().max(500).optional(),
  cuenta: z.string().trim().max(200).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD.").optional(),
});

const esquemaRegistro = z.object({
  codigo: z.string().trim().min(6).max(12),
  nombre: z.string().trim().max(80).optional(),
  dispositivo: z.string().trim().min(1).max(80),
});

// Un código tiene 31^6 combinaciones; aun así, frena a quien intente adivinarlos.
// Detrás de Tailscale todas las peticiones llegan desde 127.0.0.1, así que el límite es global.
const VENTANA_INTENTOS_MS = 10 * 60_000;
const MAX_INTENTOS_FALLIDOS = 20;
const ATAJO_VIGENCIA_MS = 10 * 60_000;

export function crearApp(opciones: OpcionesApp) {
  const { db } = opciones;
  const app = new Hono<{ Variables: VariablesAuth }>();
  const fallidos: number[] = [];
  const atajos = new Map<string, { archivo: Uint8Array; expira: number }>();
  const firmar = opciones.firmarAtajo ?? firmarAtajo;
  const contexto = (usuarioId: string) =>
    crearContexto({ db, usuarioId, zonaHoraria: opciones.zonaHoraria, monedaBase: opciones.monedaBase });

  app.get("/salud", (c) => c.json({ ok: true }));

  // Rutas públicas: entrar con un código de invitación y descargar el Atajo recién preparado.
  const publico = new Hono();
  const demasiadosIntentos = () => {
    const desde = Date.now() - VENTANA_INTENTOS_MS;
    while (fallidos.length && fallidos[0]! < desde) fallidos.shift();
    return fallidos.length >= MAX_INTENTOS_FALLIDOS;
  };
  const errorInvitacion = (error: unknown) => {
    if (!(error instanceof ErrorInvitacion)) throw error;
    if (error.estado !== 400) fallidos.push(Date.now());
    return error;
  };

  publico.get("/invitaciones/:codigo", (c) => {
    if (demasiadosIntentos()) return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    try {
      return c.json(consultarInvitacion(db, c.req.param("codigo")));
    } catch (error) {
      const e = errorInvitacion(error);
      return c.json({ error: e.message }, e.estado);
    }
  });

  publico.post("/registro", async (c) => {
    if (demasiadosIntentos()) return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    const cuerpo = esquemaRegistro.safeParse(sinVacios(await c.req.json().catch(() => null)));
    if (!cuerpo.success) {
      return c.json({ error: "Petición inválida.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    try {
      return c.json(canjearInvitacion(db, cuerpo.data), 201);
    } catch (error) {
      const e = errorInvitacion(error);
      return c.json({ error: e.message }, e.estado);
    }
  });
  app.route("/v1", publico);

  app.get("/atajo/:archivo", (c) => {
    const id = c.req.param("archivo").replace(/\.shortcut$/, "");
    const atajo = atajos.get(id);
    if (!atajo || atajo.expira < Date.now()) {
      atajos.delete(id);
      return c.text("Este enlace ya venció. Vuelve a pedir el Atajo desde la app.", 410);
    }
    return c.body(atajo.archivo as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="Finanzas.shortcut"',
      "Cache-Control": "no-store",
    });
  });

  const v1 = new Hono<{ Variables: VariablesAuth }>();
  v1.use(requiereToken(db));

  // Punto de entrada único: registrar o preguntar, por voz o texto.
  v1.post("/hablar", async (c) => {
    const cuerpo = esquemaHablar.safeParse(sinVacios(await c.req.json().catch(() => null)));
    if (!cuerpo.success) {
      return c.json({ error: "Petición inválida.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const p = cuerpo.data;
    const pregunta = esPregunta(p.texto);
    const esperaMs = p.espera_ms ?? (pregunta ? opciones.espera?.preguntaMs : opciones.espera?.registroMs);
    try {
      const respuesta = await hablar(
        opciones,
        c.get("usuarioId"),
        {
          texto: p.texto,
          clientId: p.client_id,
          conversacionId: p.conversacion_id,
          lat: p.lat,
          lon: p.lon,
          lugar: p.lugar,
          capturadoEn: p.capturado_en,
        },
        { esperaMs, esPregunta: pregunta },
      );
      // 202: la Mac ya lo guardó y lo termina sola; el Atajo no debe reenviarlo.
      return c.json(respuesta, respuesta.pendiente ? 202 : 200);
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

  // Estado de un dictado que quedó pendiente. Con ?esperar_ms= espera a que termine.
  v1.get("/entradas/:client_id", async (c) => {
    const esperaMs = Math.min(Math.max(Number(c.req.query("esperar_ms") ?? 0) || 0, 0), MAX_ESPERA_MS);
    const estado = await consultarEntrada(db, c.get("usuarioId"), c.req.param("client_id"), esperaMs);
    if (!estado) return c.json({ error: "No conozco ese dictado." }, 404);
    return c.json(estado);
  });

  // El Atajo lo llama al abrirse para que el modelo ya esté cargado cuando termines de hablar.
  v1.post("/despertar", (c) => {
    void opciones.despertar?.();
    return c.json({ ok: true });
  });

  // Errores de validación de las operaciones de finanzas: 400 con el mensaje en español.
  v1.onError((error, c) => {
    if (error instanceof ErrorFinanzas) return c.json({ error: error.message }, 400);
    throw error;
  });

  v1.get("/yo", (c) => {
    const usuarioId = c.get("usuarioId");
    const usuario = db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).get()!;
    const actual = c.get("dispositivoId");
    const lista = listarDispositivos(db, usuarioId);
    const propio = lista.find((d) => d.id === actual)!;
    return c.json({
      usuario: { id: usuario.id, nombre: usuario.nombre },
      dispositivo: { id: propio.id, nombre: propio.nombre },
      dispositivos: lista.map((d) => ({
        id: d.id,
        nombre: d.nombre,
        creadoEn: d.creadoEn,
        ultimoUso: d.ultimoUso,
        actual: d.id === actual,
      })),
      moneda: opciones.monedaBase,
      zonaHoraria: opciones.zonaHoraria,
      hoy: contexto(usuarioId).hoy,
    });
  });

  v1.post("/invitaciones", async (c) => {
    const cuerpo = z
      .object({ para: z.enum(["usuario", "dispositivo"]) })
      .safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: 'Indica para: "usuario" o "dispositivo".' }, 400);
    const usuarioId = c.get("usuarioId");
    const invitacion = crearInvitacion(db, {
      usuarioId: cuerpo.data.para === "dispositivo" ? usuarioId : undefined,
      creadaPor: usuarioId,
    });
    return c.json(invitacion, 201);
  });

  v1.delete("/dispositivos/:id", (c) => {
    if (!revocarDispositivo(db, c.get("usuarioId"), c.req.param("id"))) {
      return c.json({ error: "No encontré ese dispositivo." }, 404);
    }
    return c.json({ ok: true });
  });

  v1.get("/categorias", (c) => {
    const cats = listarCategorias(db, c.get("usuarioId"));
    return c.json({
      categorias: cats.map((x) => ({
        id: x.id,
        nombre: x.nombre,
        nombreCompleto: nombreCompleto(cats, x.id),
        padreId: x.padreId,
        tipo: x.tipo,
        naturaleza: x.naturaleza,
      })),
    });
  });

  v1.get("/movimientos", (c) => {
    const q = c.req.query();
    return c.json(
      listarMovimientosApp(contexto(c.get("usuarioId")), {
        desde: q.desde || undefined,
        hasta: q.hasta || undefined,
        periodo: q.periodo || undefined,
        tipo: (q.tipo || undefined) as never,
        categoriaId: q.categoria_id || undefined,
        texto: q.texto || undefined,
        revisar: q.revisar === "1" || q.revisar === "true",
        limite: q.limite ? Number(q.limite) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      }),
    );
  });

  v1.post("/movimientos", async (c) => {
    const cuerpo = esquemaMovimiento.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) {
      return c.json({ error: "Datos inválidos.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const ctx = contexto(c.get("usuarioId"));
    const { categoria_id, ...datos } = cuerpo.data;
    const creado = crearMovimiento(ctx, { ...datos, categoriaId: categoria_id ?? undefined, origen: "app" });
    return c.json(movimientoApp(ctx, obtenerPropio(ctx, creado.id)), 201);
  });

  v1.patch("/movimientos/:id", async (c) => {
    const cuerpo = esquemaMovimiento.partial().safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) {
      return c.json({ error: "Datos inválidos.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const ctx = contexto(c.get("usuarioId"));
    const { categoria_id, ...cambios } = cuerpo.data;
    const id = c.req.param("id");
    editarMovimiento(ctx, id, { ...cambios, categoriaId: categoria_id ?? undefined });
    return c.json(movimientoApp(ctx, obtenerPropio(ctx, id)));
  });

  v1.delete("/movimientos/:id", (c) => {
    eliminarMovimiento(contexto(c.get("usuarioId")), c.req.param("id"));
    return c.json({ ok: true });
  });

  v1.post("/deshacer", (c) => c.json(deshacer(contexto(c.get("usuarioId")))));

  v1.get("/tablero", (c) => c.json(tablero(contexto(c.get("usuarioId")), c.req.query("mes") || undefined)));

  v1.get("/recurrentes", (c) => c.json(listarRecurrentes(contexto(c.get("usuarioId")))));

  v1.get("/resumen", (c) =>
    c.json(resumir(contexto(c.get("usuarioId")), { periodo: c.req.query("periodo") ?? "este_mes", agruparPor: "categoria" })),
  );

  // Prepara el Atajo con un token propio y deja el archivo firmado 10 minutos para descargarlo.
  v1.post("/atajo", async (c) => {
    const cuerpo = z
      .object({ servidor: z.url({ protocol: /^https?$/ }) })
      .safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "Falta la dirección del servidor (servidor)." }, 400);
    const servidor = cuerpo.data.servidor.replace(/\/+$/, "");
    const usuarioId = c.get("usuarioId");
    const { token, dispositivo } = crearDispositivoPara(db, usuarioId, "Atajo Finanzas");
    try {
      const archivo = await firmar(generarAtajo({ servidor, token }));
      const id = crypto.randomUUID();
      const expira = Date.now() + ATAJO_VIGENCIA_MS;
      for (const [clave, a] of atajos) if (a.expira < Date.now()) atajos.delete(clave);
      atajos.set(id, { archivo, expira });
      return c.json({ url: `/atajo/${id}.shortcut`, expiraEn: new Date(expira).toISOString() }, 201);
    } catch (error) {
      // Sin Atajo, el token nuevo no sirve de nada.
      revocarDispositivo(db, usuarioId, dispositivo.id);
      if (error instanceof ErrorFirma) {
        console.error("No se pudo firmar el Atajo:", error.message);
        return c.json({ error: "Esta computadora no puede firmar Atajos.", detalle: error.message }, 501);
      }
      throw error;
    }
  });

  app.route("/v1", v1);
  if (opciones.carpetaWeb) app.get("*", servirApp(opciones.carpetaWeb));
  return app;
}
