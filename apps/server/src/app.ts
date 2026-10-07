import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { consultarEntrada, type Dependencias, ErrorEnProceso, ErrorIA, hablar } from "./ai/asistente";
import { ErrorFirma, firmarAtajo, generarAtajo } from "./atajo/generar";
import {
  canjearInvitacion,
  consultarInvitacion,
  crearDispositivoPara,
  crearInvitacion,
  devolverInvitacion,
  ErrorInvitacion,
  listarDispositivos,
  requiereToken,
  revocarAtajosSinUsar,
  revocarDispositivo,
  type VariablesAuth,
} from "./auth";
import { invitaciones, usuarios } from "./db/schema";
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
import { hostsDeLaPeticion, ipDelCliente, LimiteIntentos } from "./lib/limites";
import { montosDelTexto } from "./lib/numeros";
import { esPregunta } from "./lib/texto";
import { and, eq, gte } from "drizzle-orm";
import { servirApp } from "./web";

export type OpcionesApp = Dependencias & {
  /** Precarga el modelo de IA con las instrucciones del usuario; en pruebas no hace nada. */
  despertar?: (usuarioId: string) => Promise<unknown>;
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

// El Atajo manda números con coma en español ("19,4326") y fechas en el formato del iPhone.
// Un dato opcional que no se entiende se ignora: rechazar el dictado lo dejaría atorado en la cola.
const numeroOpcional = (min: number, max: number) =>
  z.preprocess((v) => {
    const n = typeof v === "string" ? Number(v.trim().replace(",", ".")) : Number(v);
    return v !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  }, z.number().optional());

const fechaOpcional = z.preprocess((v) => {
  if (typeof v !== "string") return undefined;
  const fecha = new Date(v.trim());
  return Number.isNaN(fecha.getTime()) ? undefined : fecha.toISOString();
}, z.string().optional());

// iOS nombra "Ubicación" a la ubicación actual cuando no le pone nombre de lugar: eso no es un lugar.
const LUGAR_GENERICO = /^(mi |tu )?(ubicaci[oó]n( actual)?|current location|location)$/i;

const esquemaHablar = z.object({
  texto: z.string().trim().min(1).max(2000),
  client_id: z.string().trim().min(8).max(100),
  conversacion_id: z.string().trim().max(100).optional(),
  lat: numeroOpcional(-90, 90),
  lon: numeroOpcional(-180, 180),
  lugar: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((lugar) => (lugar && !LUGAR_GENERICO.test(lugar) ? lugar : undefined)),
  capturado_en: fechaOpcional,
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

// Al editar, null borra el dato (la app lo manda así); sin el campo, no se toca.
const esquemaEdicion = esquemaMovimiento.partial().extend({
  comercio: esquemaMovimiento.shape.comercio.unwrap().nullable().optional(),
  descripcion: esquemaMovimiento.shape.descripcion.unwrap().nullable().optional(),
  cuenta: esquemaMovimiento.shape.cuenta.unwrap().nullable().optional(),
});

const esquemaServidor = z.url({ protocol: /^https?$/ });

const esquemaRegistro = z.object({
  codigo: z.string().trim().min(6).max(12),
  nombre: z.string().trim().max(80).optional(),
  dispositivo: z.string().trim().min(1).max(80),
});

// Un código tiene 31^6 combinaciones; aun así, frena a quien intente adivinarlos. El límite es por IP
// para que un extraño no bloquee a los demás, con un tope total por si llegan de muchas IPs.
const VENTANA_INTENTOS_MS = 10 * 60_000;
const MAX_INTENTOS_POR_IP = 20;
const MAX_INTENTOS_TOTAL = 200;
const ATAJO_VIGENCIA_MS = 10 * 60_000;
// iOS puede pedir el archivo más de una vez al abrirlo; después de eso el enlace ya no sirve.
const ATAJO_MAX_DESCARGAS = 5;
// Códigos que una cuenta puede crear al día.
const MAX_INVITACIONES_DIA = { usuario: 5, dispositivo: 20 };
// Los cuerpos válidos son de unos cientos de bytes (un dictado, a lo más 2,000 caracteres); esto frena
// a quien manda megas antes de leerlos.
const MAX_CUERPO = 16 * 1024;

// La app no carga nada de fuera: scripts y datos solo del mismo origen.
const POLITICA_CONTENIDO = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "blob:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'"],
  manifestSrc: ["'self'"],
  workerSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

const cuerpoMuyGrande = (c: Context) => c.json({ error: "La petición es demasiado grande." }, 413);

/**
 * El Atajo sigue escuchando solo si la respuesta le pregunta algo a la persona; si no, contesta y se cierra.
 * La clave va solo cuando es true, así el Atajo solo revisa si existe.
 */
function conSeguir<T extends { respuesta?: string; pendiente?: boolean }>(r: T): T & { seguir?: true } {
  return !r.pendiente && r.respuesta && /\?\s*$/.test(r.respuesta) ? { ...r, seguir: true } : r;
}

/** La dirección del Atajo tiene que ser este mismo servidor, como lo ve quien la pide. */
function servidorPropio(c: Context, servidor: string): boolean {
  const hosts = hostsDeLaPeticion(c);
  const pedido = new URL(servidor).host.toLowerCase();
  if (hosts.includes(pedido)) return true;
  console.warn(`Atajo rechazado: servidor ${pedido}, Host ${c.req.header("host")}, X-Forwarded-Host ${c.req.header("x-forwarded-host")}`);
  return false;
}
const NOMBRE_ATAJO = "Atajo Finanzas";

export function crearApp(opciones: OpcionesApp) {
  const { db } = opciones;
  const app = new Hono<{ Variables: VariablesAuth }>();
  const intentos = new LimiteIntentos(VENTANA_INTENTOS_MS, MAX_INTENTOS_POR_IP, MAX_INTENTOS_TOTAL);
  const atajos = new Map<string, { archivo: Uint8Array; expira: number; descargas: number }>();
  const firmar = opciones.firmarAtajo ?? firmarAtajo;
  const contexto = (usuarioId: string) =>
    crearContexto({ db, usuarioId, zonaHoraria: opciones.zonaHoraria, monedaBase: opciones.monedaBase });

  /** Arma y firma el Atajo con ese token y lo deja unos minutos para descargarlo. Lanza ErrorFirma. */
  const prepararAtajo = async (servidor: string, token: string, usuarioId: string, dispositivoId: string) => {
    const nombre = db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).get()?.nombre;
    const archivo = await firmar(generarAtajo({ servidor: servidor.replace(/\/+$/, ""), token, nombre }));
    revocarAtajosSinUsar(db, usuarioId, NOMBRE_ATAJO, dispositivoId);
    const id = crypto.randomUUID();
    const expira = Date.now() + ATAJO_VIGENCIA_MS;
    for (const [clave, a] of atajos) if (a.expira < Date.now()) atajos.delete(clave);
    atajos.set(id, { archivo, expira, descargas: 0 });
    return { url: `/atajo/${id}.shortcut`, expiraEn: new Date(expira).toISOString(), nombre: nombre ?? null };
  };
  const sinFirma = (error: ErrorFirma) => {
    console.error("No se pudo firmar el Atajo:", error.message);
    return { error: "Esta computadora no puede firmar Atajos.", detalle: error.message };
  };

  app.use(
    secureHeaders({
      contentSecurityPolicy: POLITICA_CONTENIDO,
      referrerPolicy: "no-referrer",
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use("/v1/*", bodyLimit({ maxSize: MAX_CUERPO, onError: cuerpoMuyGrande }));
  app.get("/salud", (c) => c.json({ ok: true }));

  // Rutas públicas: entrar con un código de invitación y descargar el Atajo recién preparado.
  const publico = new Hono();
  const demasiadosIntentos = (c: Context) => intentos.bloqueado(ipDelCliente(c));
  const errorInvitacion = (c: Context, error: unknown) => {
    if (!(error instanceof ErrorInvitacion)) throw error;
    if (error.estado !== 400) intentos.fallo(ipDelCliente(c));
    return error;
  };

  publico.get("/invitaciones/:codigo", (c) => {
    if (demasiadosIntentos(c)) return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    try {
      return c.json(consultarInvitacion(db, c.req.param("codigo")));
    } catch (error) {
      const e = errorInvitacion(c, error);
      return c.json({ error: e.message }, e.estado);
    }
  });

  publico.post("/registro", async (c) => {
    if (demasiadosIntentos(c)) return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    const cuerpo = esquemaRegistro.safeParse(sinVacios(await c.req.json().catch(() => null)));
    if (!cuerpo.success) {
      return c.json({ error: "Petición inválida.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    try {
      return c.json(canjearInvitacion(db, cuerpo.data), 201);
    } catch (error) {
      const e = errorInvitacion(c, error);
      return c.json({ error: e.message }, e.estado);
    }
  });
  // El enlace para instalar el Atajo directo: un código de dispositivo se vuelve el Atajo de esa cuenta.
  publico.post("/atajo/canjear", async (c) => {
    if (demasiadosIntentos(c)) return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    const cuerpo = z
      .object({ codigo: z.string().trim().min(6).max(12), servidor: esquemaServidor })
      .safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "Faltan el código o la dirección del servidor." }, 400);
    const { codigo, servidor } = cuerpo.data;
    if (!servidorPropio(c, servidor)) return c.json({ error: "La dirección del servidor no es esta." }, 400);
    let canje: ReturnType<typeof canjearInvitacion>;
    try {
      canje = canjearInvitacion(db, { codigo, dispositivo: NOMBRE_ATAJO, soloCuentaExistente: true });
    } catch (error) {
      const e = errorInvitacion(c, error);
      return c.json({ error: e.message }, e.estado);
    }
    try {
      return c.json(await prepararAtajo(servidor, canje.token, canje.usuario.id, canje.dispositivo.id), 201);
    } catch (error) {
      // Sin Atajo no se gasta el código: se puede volver a intentar con el mismo enlace.
      devolverInvitacion(db, codigo, canje.dispositivo.id);
      if (error instanceof ErrorFirma) return c.json(sinFirma(error), 501);
      throw error;
    }
  });
  app.route("/v1", publico);

  app.get("/atajo/:archivo", (c) => {
    const id = c.req.param("archivo").replace(/\.shortcut$/, "");
    const atajo = atajos.get(id);
    if (!atajo || atajo.expira < Date.now() || atajo.descargas >= ATAJO_MAX_DESCARGAS) {
      atajos.delete(id);
      return c.text("Este enlace ya venció. Vuelve a pedir el Atajo desde la app.", 410);
    }
    // El archivo lleva un token: solo se puede bajar unas pocas veces.
    if (c.req.method === "GET") atajo.descargas++;
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
    const crudo = await c.req.json().catch(() => null);
    // Un dictado vacío (Siri no escuchó nada) no es un error: si fuera 400, el Atajo dejaría
    // el archivo en la cola para siempre y no diría nada.
    if (crudo && typeof crudo === "object" && typeof crudo.texto === "string" && !crudo.texto.trim()) {
      const conversacion = typeof crudo.conversacion_id === "string" ? crudo.conversacion_id : "";
      return c.json(conSeguir({ respuesta: "No te escuché. ¿Me lo repites?", conversacion_id: conversacion, acciones: [] }));
    }
    const cuerpo = esquemaHablar.safeParse(sinVacios(crudo));
    if (!cuerpo.success) {
      return c.json({ error: "Petición inválida.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const p = cuerpo.data;
    // Sin monto, lo que conteste importa tanto como en una pregunta: puede pedir un dato ("¿de cuánto fue?")
    // o decir qué borró o cambió. Si contestara "Anotado" y lo terminara sola, nadie oiría esa respuesta.
    const pregunta = esPregunta(p.texto) || montosDelTexto(p.texto).length === 0;
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
      return c.json(conSeguir(respuesta), respuesta.pendiente ? 202 : 200);
    } catch (error) {
      if (error instanceof ErrorEnProceso) {
        return c.json({ error: error.message, respuesta: "Ese mensaje todavía se está procesando.", reintentar: true }, 409);
      }
      if (error instanceof ErrorIA) {
        console.error("Fallo de la IA:", error.message);
        // reintentar le indica al Atajo que deje el dictado en la cola; cualquier otra respuesta
      // (incluido un 400, que no se arregla reenviando) le permite borrarlo.
        return c.json(
          {
            error: "La IA no respondió.",
            respuesta: "No pude procesarlo ahora; queda guardado en tu iPhone para enviarlo después.",
            reintentar: true,
          },
          503,
        );
      }
      throw error;
    }
  });

  // Estado de un dictado que quedó pendiente. Con ?esperar_ms= espera a que termine.
  v1.get("/entradas/:client_id", async (c) => {
    const esperaMs = Math.min(Math.max(Number(c.req.query("esperar_ms") ?? 0) || 0, 0), MAX_ESPERA_MS);
    const estado = await consultarEntrada(db, c.get("usuarioId"), c.req.param("client_id"), esperaMs);
    if (!estado) return c.json({ error: "No conozco ese dictado." }, 404);
    return c.json(conSeguir(estado));
  });

  // El Atajo lo llama al abrirse para que el modelo ya esté cargado cuando termines de hablar.
  v1.post("/despertar", (c) => {
    void opciones.despertar?.(c.get("usuarioId"));
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
    const hace24h = new Date(Date.now() - 86_400_000).toISOString();
    const creadas = db
      .select({ usuarioId: invitaciones.usuarioId })
      .from(invitaciones)
      .where(and(eq(invitaciones.creadaPor, usuarioId), gte(invitaciones.creadoEn, hace24h)))
      .all()
      .filter((i) => (cuerpo.data.para === "usuario" ? !i.usuarioId : !!i.usuarioId)).length;
    if (creadas >= MAX_INVITACIONES_DIA[cuerpo.data.para]) {
      return c.json({ error: "Ya creaste muchos códigos hoy. Inténtalo mañana." }, 429);
    }
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
    const cuerpo = esquemaEdicion.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) {
      return c.json({ error: "Datos inválidos.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const ctx = contexto(c.get("usuarioId"));
    const { categoria_id, comercio, descripcion, cuenta, ...cambios } = cuerpo.data;
    const id = c.req.param("id");
    // editarMovimiento borra con "".
    const texto = (v: string | null | undefined) => (v === null ? "" : v);
    editarMovimiento(ctx, id, {
      ...cambios,
      comercio: texto(comercio),
      descripcion: texto(descripcion),
      cuenta: texto(cuenta),
      categoriaId: categoria_id,
    });
    return c.json(movimientoApp(ctx, obtenerPropio(ctx, id)));
  });

  v1.delete("/movimientos/:id", (c) => {
    eliminarMovimiento(contexto(c.get("usuarioId")), c.req.param("id"));
    return c.json({ ok: true });
  });

  v1.post("/deshacer", (c) => c.json(deshacer(contexto(c.get("usuarioId")))));

  v1.get("/tablero", (c) => c.json(tablero(contexto(c.get("usuarioId")), c.req.query("mes") || undefined)));

  v1.get("/recurrentes", (c) => c.json(listarRecurrentes(contexto(c.get("usuarioId")))));

  const AGRUPACIONES = ["ninguno", "categoria", "subcategoria", "comercio", "dia"] as const;
  // ?tipo=ingreso resume ingresos; ?agrupar= cambia la agrupación (categoría por omisión).
  v1.get("/resumen", (c) => {
    const tipo = c.req.query("tipo") === "ingreso" ? "ingreso" : "gasto";
    const agruparPor = AGRUPACIONES.find((a) => a === c.req.query("agrupar")) ?? "categoria";
    return c.json(resumir(contexto(c.get("usuarioId")), { periodo: c.req.query("periodo") ?? "este_mes", tipo, agruparPor }));
  });

  // Prepara el Atajo con un token propio y deja el archivo firmado 10 minutos para descargarlo.
  v1.post("/atajo", async (c) => {
    const cuerpo = z.object({ servidor: esquemaServidor }).safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "Falta la dirección del servidor (servidor)." }, 400);
    if (!servidorPropio(c, cuerpo.data.servidor)) return c.json({ error: "La dirección del servidor no es esta." }, 400);
    const usuarioId = c.get("usuarioId");
    const { token, dispositivo } = crearDispositivoPara(db, usuarioId, NOMBRE_ATAJO);
    try {
      return c.json(await prepararAtajo(cuerpo.data.servidor, token, usuarioId, dispositivo.id), 201);
    } catch (error) {
      // Sin Atajo, el token nuevo no sirve de nada.
      revocarDispositivo(db, usuarioId, dispositivo.id);
      if (error instanceof ErrorFirma) return c.json(sinFirma(error), 501);
      throw error;
    }
  });

  app.route("/v1", v1);
  if (opciones.carpetaWeb) app.get("*", servirApp(opciones.carpetaWeb));
  return app;
}
