import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { consultarEntrada, type Dependencias, ErrorEnProceso, ErrorIA, hablar } from "./ai/asistente";
import { ErrorFirma, firmarAtajo, generarAtajo, generarAtajoApplePay, guionBienvenida, NOMBRE_ATAJO_APPLE_PAY } from "./atajo/generar";
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
import { entradas, invitaciones, usuarios } from "./db/schema";
import { fraseDePago } from "./finanzas/applepay";
import { avisoDelDia } from "./finanzas/avisos";
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
import { montosParaVoz } from "./lib/dinero";
import { hostsDeLaPeticion, ipDelCliente, LimiteIntentos } from "./lib/limites";
import { montosDelTexto } from "./lib/numeros";
import { esOrdenSobreLoAnotado, esPregunta } from "./lib/texto";
import { and, eq, gte } from "drizzle-orm";
import { avisoDeDictado, conversacionPorContestar } from "./push/dictados";
import { desuscribir, type EnviarPush, ErrorSuscripcion, estadoPush, notificar, suscribir, tienePush } from "./push/notificaciones";
import { rutasPlanes } from "./rutas-planes";
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
  /** Envía una notificación push; las pruebas lo reemplazan. */
  enviarPush?: EnviarPush;
  /** mailto: o https: que se le da al servicio de push. Sin valor, la dirección pública del servidor. */
  contactoPush?: string;
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
  // El modelo del dispositivo ("iPhone", "Apple Watch"), para un Atajo que lo mande.
  equipo: z.string().trim().max(60).optional(),
  // Para clientes que prefieren esperar otra cantidad (la prueba de modelos espera todo).
  espera_ms: z.coerce.number().int().min(0).max(MAX_ESPERA_MS).optional(),
});

// Lo que manda el Atajo de Apple Pay. Va por /v1/hablar para que la cola sin conexión del Atajo
// principal también lo reenvíe.
const esquemaApplePay = z.object({
  origen: z.literal("apple_pay"),
  client_id: z.string().trim().min(8).max(100),
  monto: z.coerce.string().trim().max(60).optional(),
  comercio: z.coerce.string().trim().max(200).optional(),
  nombre: z.coerce.string().trim().max(200).optional(),
  tarjeta: z.coerce.string().trim().max(200).optional(),
  lat: numeroOpcional(-90, 90),
  lon: numeroOpcional(-180, 180),
  capturado_en: fechaOpcional,
});

const esquemaSuscripcion = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({ p256dh: z.string().trim().min(80).max(120), auth: z.string().trim().min(16).max(64) }),
  origen: z.url({ protocol: /^https?$/ }).max(300).optional(),
});

/** Lo que el Atajo dice cuando registró y el resultado llega por notificación. */
export const RESPUESTA_RAPIDA = "Anotado.";

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
 * La pregunta puede ir en medio ("¿Cuál de los dos? El de $85 o el de $60."). La clave va solo cuando es
 * true, así el Atajo solo revisa si existe.
 */
function conSeguir<T extends { respuesta?: string; pendiente?: boolean }>(r: T): T & { seguir?: true } {
  return !r.pendiente && r.respuesta?.includes("?") ? { ...r, seguir: true } : r;
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
/** Cada Atajo que la app puede instalar: el nombre de su dispositivo (su token) y el del archivo. */
const ATAJOS = {
  finanzas: { dispositivo: NOMBRE_ATAJO, archivo: "Finanzas.shortcut" },
  apple_pay: { dispositivo: "Atajo Apple Pay", archivo: `${NOMBRE_ATAJO_APPLE_PAY}.shortcut` },
} as const;
type TipoAtajo = keyof typeof ATAJOS;

export function crearApp(opciones: OpcionesApp) {
  const { db } = opciones;
  const app = new Hono<{ Variables: VariablesAuth }>();
  const intentos = new LimiteIntentos(VENTANA_INTENTOS_MS, MAX_INTENTOS_POR_IP, MAX_INTENTOS_TOTAL);
  const atajos = new Map<string, { archivo: Uint8Array; nombre: string; expira: number; descargas: number }>();
  /** Lo que el Atajo lee en voz: los montos dichos ("50 pesos", no "$50") y si sigue escuchando. */
  const paraVoz = <T extends { respuesta?: string; pendiente?: boolean }>(r: T) =>
    conSeguir(r.respuesta ? { ...r, respuesta: montosParaVoz(r.respuesta, opciones.monedaBase) } : r);
  const firmar = opciones.firmarAtajo ?? firmarAtajo;
  // Lo que el iPhone ya no esperó llega por notificación a quien las tenga activas.
  const deps = {
    ...opciones,
    alTerminarSinEspera: opciones.alTerminarSinEspera ?? avisoDeDictado(db, opciones.enviarPush),
    notificaSinEspera: opciones.notificaSinEspera ?? ((usuarioId: string) => tienePush(db, usuarioId)),
  };
  /**
   * La primera respuesta del día que oye el Atajo lleva el aviso del día (fugas, presupuestos), una sola vez.
   * No va detrás de una pregunta (la pregunta tiene que ser lo último que se oye), de una espera ni de un
   * dato útil (uno por respuesta basta).
   */
  const conAvisoDelDia = <T extends { respuesta: string; pendiente?: boolean; duplicado?: boolean; dato?: string }>(
    usuarioId: string,
    r: T,
    rapida: boolean,
  ): T => {
    if (r.duplicado || r.dato || (r.pendiente && !rapida) || r.respuesta.includes("?")) return r;
    const delDia = avisoDelDia(contexto(usuarioId));
    if (!delDia) return r;
    delDia.marcar();
    return { ...r, respuesta: `${r.respuesta} Por cierto: ${delDia.aviso.texto}` };
  };
  const contexto = (usuarioId: string) =>
    crearContexto({ db, usuarioId, zonaHoraria: opciones.zonaHoraria, monedaBase: opciones.monedaBase });

  /** Arma y firma el Atajo con ese token y lo deja unos minutos para descargarlo. Lanza ErrorFirma. */
  const prepararAtajo = async (
    servidor: string,
    token: string,
    usuarioId: string,
    dispositivoId: string,
    tipo: TipoAtajo = "finanzas",
  ) => {
    const nombre = db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).get()?.nombre;
    const datos = { servidor: servidor.replace(/\/+$/, ""), token };
    const archivo = await firmar(tipo === "apple_pay" ? generarAtajoApplePay(datos) : generarAtajo({ ...datos, nombre }));
    revocarAtajosSinUsar(db, usuarioId, ATAJOS[tipo].dispositivo, dispositivoId);
    const id = crypto.randomUUID();
    const expira = Date.now() + ATAJO_VIGENCIA_MS;
    for (const [clave, a] of atajos) if (a.expira < Date.now()) atajos.delete(clave);
    atajos.set(id, { archivo, nombre: ATAJOS[tipo].archivo, expira, descargas: 0 });
    return { url: `/atajo/${id}.shortcut`, expiraEn: new Date(expira).toISOString(), nombre: nombre ?? null, tipo };
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
      // iOS le pone al Atajo el nombre del archivo.
      "Content-Disposition": `attachment; filename="${atajo.nombre}"; filename*=UTF-8''${encodeURIComponent(atajo.nombre)}`,
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
      return c.json(paraVoz({ respuesta: "No te escuché. ¿Me lo repites?", conversacion_id: conversacion, acciones: [] }));
    }
    if (crudo && typeof crudo === "object" && crudo.origen === "apple_pay") return pagoApplePay(c, crudo);
    const cuerpo = esquemaHablar.safeParse(sinVacios(crudo));
    if (!cuerpo.success) {
      return c.json({ error: "Petición inválida.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const p = cuerpo.data;
    const usuarioId = c.get("usuarioId");
    // El Atajo no manda espera_ms; la app y las pruebas sí.
    const delAtajo = p.espera_ms === undefined;
    // Sin monto, lo que conteste importa tanto como en una pregunta: puede pedir un dato ("¿de cuánto fue?")
    // o decir qué borró o cambió. Si contestara "Anotado" y lo terminara sola, nadie oiría esa respuesta.
    // Lo mismo al borrar o cambiar algo, aunque diga el monto: "borra el café de 85" (QA-029).
    const pregunta = esPregunta(p.texto) || montosDelTexto(p.texto).length === 0 || esOrdenSobreLoAnotado(p.texto);
    // Con notificaciones, un registro no espera a la IA: el Atajo dice "Anotado" y termina, y lo que
    // anotó llega en una notificación. Las preguntas se siguen contestando en voz.
    // En el reloj no: la notificación va a la app del iPhone y, si no está cerca, nunca le llega.
    // Se reconoce por `equipo` o por el User-Agent; el del Atajo queda en el registro para comprobarlo.
    const agente = c.req.header("user-agent") ?? "";
    if (delAtajo && process.env.NODE_ENV !== "test") console.log(`Atajo desde: ${agente.slice(0, 160)}`);
    const enReloj = /watch/i.test(p.equipo ?? "") || /watch/i.test(agente);
    const rapida = delAtajo && !pregunta && !enReloj && tienePush(db, usuarioId);
    const esperaMs = p.espera_ms ?? (rapida ? 0 : pregunta ? opciones.espera?.preguntaMs : opciones.espera?.registroMs);
    try {
      let respuesta = await hablar(
        deps,
        usuarioId,
        {
          texto: p.texto,
          clientId: p.client_id,
          // Una pregunta que llegó por notificación se contesta con el siguiente dictado.
          conversacionId: p.conversacion_id ?? (delAtajo ? conversacionPorContestar(usuarioId) : undefined),
          lat: p.lat,
          lon: p.lon,
          lugar: p.lugar,
          capturadoEn: p.capturado_en,
        },
        { esperaMs, esPregunta: pregunta },
      );
      if (rapida && respuesta.pendiente) respuesta = { ...respuesta, respuesta: RESPUESTA_RAPIDA };
      if (delAtajo) respuesta = conAvisoDelDia(usuarioId, respuesta, rapida);
      // 202: la Mac ya lo guardó y lo termina sola; el Atajo no debe reenviarlo.
      return c.json(paraVoz(respuesta), respuesta.pendiente ? 202 : 200);
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

  /**
   * Un pago con Apple Pay: se registra en segundo plano y lo anotado llega por notificación, con el
   * detalle abierto para agregar lo que falte. Sin monto (el Atajo corrido a mano) es una prueba.
   */
  const pagoApplePay = async (c: Context<{ Variables: VariablesAuth }>, crudo: object) => {
    const cuerpo = esquemaApplePay.safeParse(sinVacios(crudo));
    if (!cuerpo.success) {
      return c.json({ error: "Petición inválida.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const p = cuerpo.data;
    const usuarioId = c.get("usuarioId");
    const texto = fraseDePago(p, opciones.monedaBase);
    if (!texto) {
      const prueba = !p.monto && !p.comercio && !p.nombre && !p.tarjeta;
      if (prueba) {
        await notificar(
          db,
          usuarioId,
          { titulo: "Apple Pay listo", cuerpo: "Cuando pagues con Apple Pay, lo anoto solo y te aviso aquí.", url: "/#inicio" },
          opciones.enviarPush,
        );
      }
      return c.json({
        respuesta: prueba ? "Listo. Cuando pagues con Apple Pay lo anoto solo." : "Ese pago no trae monto; no anoté nada.",
        prueba,
        acciones: [],
      });
    }
    try {
      const respuesta = await hablar(
        deps,
        usuarioId,
        { texto, clientId: p.client_id, origen: "apple_pay", lat: p.lat, lon: p.lon, capturadoEn: p.capturado_en },
        { esperaMs: 0, esPregunta: false },
      );
      // El Atajo no dice nada: si terminó al instante, la notificación sale de aquí.
      if (!respuesta.pendiente && !respuesta.duplicado) {
        const entrada = db
          .select()
          .from(entradas)
          .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.clientId, p.client_id)))
          .get();
        if (entrada) deps.alTerminarSinEspera(entrada, respuesta);
      }
      return c.json(respuesta, respuesta.pendiente ? 202 : 200);
    } catch (error) {
      if (error instanceof ErrorEnProceso) return c.json({ error: error.message, reintentar: true }, 409);
      if (error instanceof ErrorIA) return c.json({ error: "La IA no respondió.", reintentar: true }, 503);
      throw error;
    }
  };

  // Notificaciones: la llave para suscribirse, si este dispositivo ya está suscrito, suscribirse y probar.
  v1.get("/push", (c) => c.json(estadoPush(db, c.get("usuarioId"), c.get("dispositivoId"))));

  v1.post("/push/suscripcion", async (c) => {
    const cuerpo = esquemaSuscripcion.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "La suscripción no es válida." }, 400);
    const { endpoint, keys, origen } = cuerpo.data;
    // Apple pide un contacto; la dirección pública con la que se abrió la app sirve, si es este servidor.
    const propio = origen && origen.startsWith("https://") && hostsDeLaPeticion(c).includes(new URL(origen).host.toLowerCase());
    const contacto = opciones.contactoPush ?? (propio ? new URL(origen).origin : "mailto:finanzas@example.com");
    try {
      suscribir(db, c.get("usuarioId"), c.get("dispositivoId"), { endpoint, p256dh: keys.p256dh, auth: keys.auth, contacto });
    } catch (error) {
      if (error instanceof ErrorSuscripcion) return c.json({ error: error.message }, 400);
      throw error;
    }
    return c.json(estadoPush(db, c.get("usuarioId"), c.get("dispositivoId")), 201);
  });

  v1.delete("/push/suscripcion", (c) => {
    desuscribir(db, c.get("dispositivoId"));
    return c.json({ ok: true });
  });

  v1.post("/push/prueba", async (c) => {
    const nombre = db.select().from(usuarios).where(eq(usuarios.id, c.get("usuarioId"))).get()?.nombre.split(" ")[0];
    const llegaron = await notificar(
      db,
      c.get("usuarioId"),
      {
        titulo: "Notificaciones activas",
        cuerpo: `${nombre ? `Listo, ${nombre}. ` : "Listo. "}Cuando registres algo con el Atajo, aquí te confirmo qué anoté.`,
        url: "/#ajustes",
        etiqueta: "prueba",
      },
      opciones.enviarPush,
    );
    if (!llegaron) return c.json({ error: "No llegó a ningún dispositivo. Vuelve a activar las notificaciones.", enviadas: 0 }, 502);
    return c.json({ enviadas: llegaron });
  });

  // La bienvenida que dice el Atajo la primera vez, con el nombre que tenga la cuenta en ese momento.
  v1.get("/atajo/bienvenida", (c) => {
    const nombre = db.select().from(usuarios).where(eq(usuarios.id, c.get("usuarioId"))).get()?.nombre;
    const guion = guionBienvenida(nombre);
    return c.json({ ...guion, explicacion: guion.explicacion.join(" ") });
  });

  // Estado de un dictado que quedó pendiente. Con ?esperar_ms= espera a que termine.
  v1.get("/entradas/:client_id", async (c) => {
    const esperaMs = Math.min(Math.max(Number(c.req.query("esperar_ms") ?? 0) || 0, 0), MAX_ESPERA_MS);
    const estado = await consultarEntrada(db, c.get("usuarioId"), c.req.param("client_id"), esperaMs);
    if (!estado) return c.json({ error: "No conozco ese dictado." }, 404);
    return c.json(paraVoz(estado));
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

  rutasPlanes(v1, contexto);

  // Prepara el Atajo con un token propio y deja el archivo firmado 10 minutos para descargarlo.
  // tipo "apple_pay" prepara el Atajo que corre la automatización de la Cartera.
  v1.post("/atajo", async (c) => {
    const cuerpo = z
      .object({ servidor: esquemaServidor, tipo: z.enum(["finanzas", "apple_pay"]).default("finanzas") })
      .safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "Falta la dirección del servidor (servidor)." }, 400);
    if (!servidorPropio(c, cuerpo.data.servidor)) return c.json({ error: "La dirección del servidor no es esta." }, 400);
    const usuarioId = c.get("usuarioId");
    const { tipo } = cuerpo.data;
    const { token, dispositivo } = crearDispositivoPara(db, usuarioId, ATAJOS[tipo].dispositivo);
    try {
      return c.json(await prepararAtajo(cuerpo.data.servidor, token, usuarioId, dispositivo.id, tipo), 201);
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
