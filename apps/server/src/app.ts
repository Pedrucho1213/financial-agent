import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { consultarEntrada, type Dependencias, type Respuesta, ErrorEnProceso, ErrorIA, hablar } from "./ai/asistente";
import { guardarDescarga, limpiarDescargas, tomarDescarga } from "./atajo/descargas";
import { ErrorFirma, firmarAtajo, generarAtajo, generarAtajoApplePay, guionBienvenida, NOMBRE_ATAJO_APPLE_PAY } from "./atajo/generar";
import {
  asignarUsuarios,
  cambiarCuenta,
  canjearInvitacion,
  cerrarOtrosDispositivos,
  comprobarCodigoActual,
  consultarInvitacion,
  crearDispositivoPara,
  crearInvitacion,
  devolverInvitacion,
  entrarConCodigo,
  ErrorCuenta,
  ErrorInvitacion,
  listarDispositivos,
  normalizarUsuario,
  ponerCodigo,
  quitarCodigo,
  requiereToken,
  revocarAtajosSinUsar,
  revocarDispositivo,
  validarCodigoPersonal,
  type VariablesAuth,
  verificarCodigo,
} from "./auth";
import { entradas, invitaciones, usuarios } from "./db/schema";
import { esDevolucion, fraseDePago, pagoDeTransaccion } from "./finanzas/applepay";
import { avisoDelDia } from "./finanzas/avisos";
import { listarCategorias, nombreCompleto } from "./finanzas/catalogos";
import { crearContexto } from "./finanzas/contexto";
import { hablaDeCuentas, nombresDeTarjetas } from "./finanzas/cuentas";
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
import { and, count, eq, gte, sql } from "drizzle-orm";
import { avisoDeDictado, conversacionPorContestar } from "./push/dictados";
import { desuscribir, type EnviarPush, ErrorSuscripcion, estadoPush, notificar, suscribir, tienePush } from "./push/notificaciones";
import { notaDelGasto } from "./finanzas/comentario";
import { rutasIa } from "./rutas-ia";
import { rutasPlanes } from "./rutas-planes";
import { rutasCuentas } from "./rutas-cuentas";
import { servirApp } from "./web";
import type { EstadoIa } from "./ai/modelo";
import type { ControlIa } from "./ai/encendido";

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
  /** Para "Estado del sistema" en Ajustes: cómo está la IA. Sin esto se reporta como no disponible. */
  estadoIa?: () => Promise<EstadoIa>;
  /** Interruptor de la IA para desarrollo (IA_INTERRUPTOR). Sin él, /v1/ia no existe. */
  controlIa?: ControlIa;
  /** Qué versión del código corre (commit y su fecha), para saber qué está desplegado. */
  version?: { commit: string | null; commitEn: string | null };
  /** Límites del código personal; las pruebas los bajan para no verificar cien veces con argon2. */
  limitesCodigo?: Partial<{ fallosPorUsuarioIp: number; fallosPorUsuario: number; verificandoALaVez: number }>;
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
  // La transacción completa como texto y su tipo, por si la Cartera cambia el nombre de una propiedad.
  entrada: z.coerce.string().transform((t) => t.trim().slice(0, 500)).optional(),
  tipo: z.coerce.string().transform((t) => t.trim().slice(0, 100)).optional(),
  lat: numeroOpcional(-90, 90),
  lon: numeroOpcional(-180, 180),
  capturado_en: fechaOpcional,
});

const esquemaSuscripcion = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({ p256dh: z.string().trim().min(80).max(120), auth: z.string().trim().min(16).max(64) }),
  origen: z.url({ protocol: /^https?$/ }).max(300).optional(),
  // La app la manda desde un iPhone: solo esas notificaciones permiten la respuesta rápida del Atajo.
  en_iphone: z.boolean().optional(),
});

const PRUEBA_PUSH_CADA_MS = 15_000;
// La automatización de la Cartera a veces corre dos veces por el mismo pago, segundos aparte y cada vez
// con otro folio.
const PAGO_REPETIDO_MS = 90_000;

/**
 * Lo que el Atajo dice cuando registró y el resultado llega por notificación. Va cambiando para que no
 * siempre diga lo mismo; la primera es "Anotado".
 */
export const RESPUESTAS_RAPIDAS = ["Anotado.", "Listo.", "Ya quedó.", "Hecho.", "Va, anotado.", "Registrado."] as const;

// Herramientas que cambian algo ya guardado: lo que la IA conteste sobre eso se oye, no se tapa.
const CAMBIAN_LO_ANOTADO = new Set(["editar_movimiento", "eliminar_movimiento", "deshacer", "editar_recurrente", "olvidar"]);

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
  // Transferencias y pagos de tarjeta: a qué cuenta llegó.
  cuenta_destino: z.string().trim().max(200).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD.").optional(),
  // Ids de etiquetas; al editar, la lista completa.
  etiquetas: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});

// Al editar, null borra el dato (la app lo manda así); sin el campo, no se toca.
const esquemaEdicion = esquemaMovimiento.partial().extend({
  comercio: esquemaMovimiento.shape.comercio.unwrap().nullable().optional(),
  descripcion: esquemaMovimiento.shape.descripcion.unwrap().nullable().optional(),
  cuenta: esquemaMovimiento.shape.cuenta.unwrap().nullable().optional(),
  cuenta_destino: esquemaMovimiento.shape.cuenta_destino.unwrap().nullable().optional(),
});

const esquemaServidor = z.url({ protocol: /^https?$/ });

const esquemaRegistro = z.object({
  codigo: z.string().trim().min(6).max(12),
  nombre: z.string().trim().max(80).optional(),
  dispositivo: z.string().trim().min(1).max(80),
});

const esquemaEntrar = z.object({
  usuario: z.string().trim().min(1).max(64),
  codigo: z.string().min(1).max(256),
  dispositivo: z.string().trim().min(1).max(80),
});

// El código personal no vence, así que además del límite por IP hay dos por usuario: 10 fallos en 15
// minutos desde una IP lo frenan para esa IP, y 100 desde cualquier lado lo frenan del todo. Así quien
// adivina el usuario no deja fuera a su dueño, y adivinar un código de 8 caracteres sigue tomando años.
// argon2 tarda y usa 64 MB: pocas verificaciones a la vez, y cambiar el código también tiene tope.
const VENTANA_USUARIO_MS = 15 * 60_000;
const MAX_FALLOS_USUARIO_IP = 10;
const MAX_FALLOS_USUARIO = 100;
const MAX_VERIFICANDO = 4;
const MAX_CAMBIOS_CODIGO_HORA = 10;

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
  // Mosaicos del mapa de dónde gastas (CARTO), solo si el usuario enciende "Mostrar calles": CARTO
  // ve qué zonas del mapa se miran (no los gastos). Apagado por omisión.
  imgSrc: ["'self'", "data:", "blob:", "https://*.basemaps.cartocdn.com"],
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
  finanzas: { dispositivo: NOMBRE_ATAJO, archivo: "Finanzas.shortcut", sufijo: "" },
  apple_pay: { dispositivo: "Atajo Apple Pay", archivo: `${NOMBRE_ATAJO_APPLE_PAY}.shortcut`, sufijo: ".applepay" },
} as const;
type TipoAtajo = keyof typeof ATAJOS;

/** Lo que la app ve de la cuenta: nunca el hash del código, solo si tiene uno. */
const datosDeCuenta = (u: typeof usuarios.$inferSelect) => ({
  id: u.id,
  nombre: u.nombre,
  usuario: u.usuario,
  tieneCodigo: !!u.codigoHash,
});

export function crearApp(opciones: OpcionesApp) {
  const { db } = opciones;
  const arrancadoEn = new Date().toISOString();
  limpiarDescargas(db);
  const app = new Hono<{ Variables: VariablesAuth }>();
  const intentos = new LimiteIntentos(VENTANA_INTENTOS_MS, MAX_INTENTOS_POR_IP, MAX_INTENTOS_TOTAL);
  const limites = opciones.limitesCodigo ?? {};
  const fallosPorUsuario = new LimiteIntentos(VENTANA_USUARIO_MS, limites.fallosPorUsuario ?? MAX_FALLOS_USUARIO, Number.POSITIVE_INFINITY);
  const fallosPorUsuarioIp = new LimiteIntentos(VENTANA_USUARIO_MS, limites.fallosPorUsuarioIp ?? MAX_FALLOS_USUARIO_IP, Number.POSITIVE_INFINITY);
  const verificandoALaVez = limites.verificandoALaVez ?? MAX_VERIFICANDO;
  const cambiosDeCodigo = new LimiteIntentos(60 * 60_000, MAX_CAMBIOS_CODIGO_HORA, Number.POSITIVE_INFINITY);
  asignarUsuarios(db);
  /** Lo que el Atajo lee en voz: los montos dichos ("50 pesos", no "$50") y si sigue escuchando. */
  const paraVoz = <T extends { respuesta?: string; pendiente?: boolean }>(r: T) =>
    conSeguir(r.respuesta ? { ...r, respuesta: montosParaVoz(r.respuesta, opciones.monedaBase) } : r);
  const firmar = opciones.firmarAtajo ?? firmarAtajo;
  const agentesVistos = new Set<string>();
  // Lo que el iPhone ya no esperó llega por notificación a quien las tenga activas.
  const deps = {
    ...opciones,
    alTerminarSinEspera: opciones.alTerminarSinEspera ?? avisoDeDictado(db, opciones.enviarPush),
    notificaSinEspera: opciones.notificaSinEspera ?? ((usuarioId: string) => tienePush(db, usuarioId)),
  };
  /**
   * La primera respuesta que oye el Atajo lleva el aviso del día (fugas, presupuestos) que no haya llegado ya
   * por notificación, una sola vez.
   * No va detrás de una pregunta (la pregunta tiene que ser lo último que se oye), de una espera ni de un
   * dato útil (uno por respuesta basta).
   */
  const conAvisoDelDia = <T extends { respuesta: string; pendiente?: boolean; duplicado?: boolean; dato?: string }>(
    usuarioId: string,
    r: T,
    rapida: boolean,
  ): T => {
    if (r.duplicado || r.dato || (r.pendiente && !rapida) || r.respuesta.includes("?")) return r;
    const ctx = contexto(usuarioId);
    // Cada aviso llega una sola vez: el que ya salió por notificación se da por dicho y se busca otro.
    for (let i = 0; i < 10; i++) {
      const delDia = avisoDelDia(ctx);
      if (!delDia) return r;
      delDia.marcar();
      if (!delDia.aviso.enviadoEn) return { ...r, respuesta: `${r.respuesta} Por cierto: ${delDia.aviso.texto}` };
    }
    return r;
  };
  /**
   * Con notificaciones: si al final no hubo comentario ni dato del presupuesto, el Atajo solo dice
   * "Anotado" y lo anotado llega por notificación, igual que si no la hubiera esperado. Si tardó más de
   * lo que se esperó, la notificación sale sola al terminar.
   */
  const rapidasDichas = new Map<string, number>();
  const respuestaRapida = (usuarioId: string) => {
    const n = rapidasDichas.get(usuarioId) ?? 0;
    rapidasDichas.set(usuarioId, n + 1);
    return RESPUESTAS_RAPIDAS[n % RESPUESTAS_RAPIDAS.length]!;
  };
  const sinComentarioEsRapida = (usuarioId: string, clientId: string, r: Respuesta): Respuesta => {
    if (r.pendiente) return { ...r, respuesta: respuestaRapida(usuarioId) };
    if (r.duplicado || r.comentario || r.dato || r.respuesta.includes("?")) return r;
    if (r.acciones.some((a) => CAMBIAN_LO_ANOTADO.has(a.herramienta))) return r;
    const entrada = db
      .select()
      .from(entradas)
      .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.clientId, clientId)))
      .get();
    if (entrada) deps.alTerminarSinEspera(entrada, r);
    return { ...r, respuesta: respuestaRapida(usuarioId) };
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
    const { id, expiraEn } = await guardarDescarga(db, usuarioId, archivo, ATAJO_VIGENCIA_MS);
    // El tipo va en el enlace (no es secreto) para que el archivo baje con su nombre.
    return { url: `/atajo/${id}${ATAJOS[tipo].sufijo}.shortcut`, expiraEn, nombre: nombre ?? null, tipo };
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

  // Verifica un código personal dentro de los límites. Cada intento se anota antes de verificar, porque
  // argon2 tarda: si se anotara después, muchas peticiones a la vez pasarían todas. Si sale bien, se retira.
  let verificando = 0;
  const conCodigo = async <T>(c: Context, usuario: string, verificar: () => Promise<T>) => {
    const ip = ipDelCliente(c);
    const clave = normalizarUsuario(usuario);
    const deEstaIp = `${clave} ${ip}`;
    const frenar = (error: string) => ({ respuesta: c.json({ error }, 429) });
    if (intentos.bloqueado(ip)) return frenar("Demasiados intentos. Espera unos minutos.");
    if (fallosPorUsuario.bloqueado(clave) || fallosPorUsuarioIp.bloqueado(deEstaIp)) {
      return frenar("Demasiados intentos con ese usuario. Espera unos minutos.");
    }
    if (verificando >= verificandoALaVez) return frenar("Hay muchos intentos a la vez. Prueba de nuevo en unos segundos.");
    const marcas = [intentos.fallo(ip), fallosPorUsuario.fallo(clave), fallosPorUsuarioIp.fallo(deEstaIp)] as const;
    const retirar = () => {
      intentos.perdonar(ip, marcas[0]);
      fallosPorUsuario.perdonar(clave, marcas[1]);
      fallosPorUsuarioIp.perdonar(deEstaIp, marcas[2]);
    };
    verificando++;
    try {
      const ok = await verificar();
      retirar();
      return { ok };
    } catch (error) {
      if (error instanceof ErrorCuenta && (error.estado === 401 || error.estado === 403)) {
        return { respuesta: c.json({ error: error.message }, error.estado) };
      }
      retirar();
      throw error;
    } finally {
      verificando--;
    }
  };

  // Entrar con usuario y código personal, sin código de invitación. El mismo 401 si el usuario no existe.
  publico.post("/entrar", async (c) => {
    if (demasiadosIntentos(c)) return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    const cuerpo = esquemaEntrar.safeParse(sinVacios(await c.req.json().catch(() => null)));
    if (!cuerpo.success) return c.json({ error: "Faltan el usuario, el código o el nombre del dispositivo." }, 400);
    const r = await conCodigo(c, cuerpo.data.usuario, () => entrarConCodigo(db, cuerpo.data));
    return r.respuesta ?? c.json(r.ok, 201);
  });

  publico.post("/atajo/entrar", async (c) => {
    if (demasiadosIntentos(c)) return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    const cuerpo = esquemaEntrar
      .omit({ dispositivo: true })
      .extend({ servidor: esquemaServidor })
      .safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "Faltan el usuario, el código o la dirección del servidor." }, 400);
    const { usuario, codigo, servidor } = cuerpo.data;
    if (!servidorPropio(c, servidor)) return c.json({ error: "La dirección del servidor no es esta." }, 400);
    const r = await conCodigo(c, usuario, () => verificarCodigo(db, usuario, codigo));
    if (r.respuesta) return r.respuesta;
    const { token, dispositivo } = crearDispositivoPara(db, r.ok.id, NOMBRE_ATAJO);
    try {
      return c.json(await prepararAtajo(servidor, token, r.ok.id, dispositivo.id), 201);
    } catch (error) {
      revocarDispositivo(db, r.ok.id, dispositivo.id);
      if (error instanceof ErrorFirma) return c.json(sinFirma(error), 501);
      throw error;
    }
  });
  app.route("/v1", publico);

  app.get("/atajo/:archivo", async (c) => {
    const [, id = "", applePay] = /^(.*?)(\.applepay)?\.shortcut$/.exec(c.req.param("archivo")) ?? [];
    const nombre = ATAJOS[applePay ? "apple_pay" : "finanzas"].archivo;
    // El archivo lleva un token: solo se puede bajar unas pocas veces.
    const archivo = await tomarDescarga(db, id, ATAJO_MAX_DESCARGAS, c.req.method === "GET");
    if (!archivo) return c.text("Este enlace ya venció. Vuelve a pedir el Atajo desde la app.", 410);
    return c.body(archivo as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": "application/octet-stream",
      // iOS le pone al Atajo el nombre del archivo.
      "Content-Disposition": `attachment; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
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
    // Lo mismo al borrar, cambiar o corregir algo, aunque diga el monto: "borra el café de 85" (QA-029),
    // "no eran 85, eran 95": se espera a la IA y se oye qué cambió.
    const pregunta = esPregunta(p.texto) || montosDelTexto(p.texto).length === 0 || esOrdenSobreLoAnotado(p.texto);
    // Con notificaciones, un registro no espera a la IA: el Atajo dice "Anotado" (o "Listo", "Hecho") y termina, y lo que
    // anotó llega en una notificación. Solo si el gasto tiene algo que vale la pena decir
    // (finanzas/comentario.ts), la espera para decirlo. Las preguntas se siguen contestando en voz.
    // En el reloj no: la notificación va a la app del iPhone y, si no está cerca, nunca le llega.
    // Se reconoce por `equipo` o por el User-Agent. Cada User-Agent nuevo del Atajo queda una vez en el
    // registro, para comprobar cómo se presenta el reloj.
    const agente = c.req.header("user-agent") ?? "";
    if (delAtajo && !agentesVistos.has(agente) && agentesVistos.size < 20) {
      agentesVistos.add(agente);
      if (process.env.NODE_ENV !== "test") console.log(`Atajo desde un User-Agent nuevo: ${agente.slice(0, 160)}`);
    }
    const enReloj = /watch/i.test(p.equipo ?? "") || /watch/i.test(agente);
    // "Tengo 20 mil en Revolut", "le pagué 3 mil a la Nu": no es un gasto sino cómo quedan sus cuentas,
    // y eso se oye al momento en vez de un "Anotado".
    const actualizaCuentas = hablaDeCuentas(p.texto, nombresDeTarjetas(contexto(usuarioId)));
    const rapida = delAtajo && !pregunta && !actualizaCuentas && !enReloj && tienePush(db, usuarioId);
    // Sin nada que comentar (nada raro en el gasto, poco historial, ya comentó lo del día), no la espera.
    const esperaMs =
      p.espera_ms ??
      (pregunta || actualizaCuentas ? opciones.espera?.preguntaMs : rapida && !notaDelGasto(contexto(usuarioId), p.texto) ? 0 : opciones.espera?.registroMs);
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
        { esperaMs, esPregunta: pregunta || actualizaCuentas },
      );
      if (rapida) respuesta = sinComentarioEsRapida(usuarioId, p.client_id, respuesta);
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
  const registrar = (linea: string) => {
    if (process.env.NODE_ENV !== "test") console.log(linea);
  };
  const pagoApplePay = async (c: Context<{ Variables: VariablesAuth }>, crudo: object) => {
    const cuerpo = esquemaApplePay.safeParse(sinVacios(crudo));
    if (!cuerpo.success) {
      const detalles = z.flattenError(cuerpo.error).fieldErrors;
      registrar(`Apple Pay: petición inválida en ${Object.keys(detalles).join(", ") || "el cuerpo"}`);
      return c.json({ error: "Petición inválida.", detalles }, 400);
    }
    const p = cuerpo.data;
    const usuarioId = c.get("usuarioId");
    // Si el monto no llegó como propiedad, puede venir en el texto completo de la transacción.
    const directo = fraseDePago(p, opciones.monedaBase);
    const respaldo = directo ? undefined : pagoDeTransaccion(p.entrada);
    const texto = directo ?? (respaldo && fraseDePago({ ...p, monto: respaldo.monto, nombre: p.nombre ?? respaldo.nombre }, opciones.monedaBase));
    // Una línea por pago en el log de la Mac: qué campos llegaron (sin sus valores) y qué se hizo.
    const anotar = (resultado: string) =>
      registrar(
        `Apple Pay: ${resultado}; llegaron ${
          (["monto", "comercio", "nombre", "tarjeta", "entrada", "lat"] as const).filter((k) => p[k] !== undefined).join(", ") || "ningún campo"
        }${p.tipo ? `; tipo ${JSON.stringify(p.tipo)}` : ""}${respaldo ? "; monto sacado del texto de la transacción" : ""}`,
      );
    if (!texto) {
      const prueba = !p.monto && !p.comercio && !p.nombre && !p.tarjeta && !p.entrada;
      const montoCrudo = p.monto || respaldo?.monto;
      const devolucion = !prueba && !!montoCrudo && esDevolucion(montoCrudo);
      anotar(prueba ? "prueba a mano" : devolucion ? "devolución" : "sin monto");
      if (!prueba && !devolucion) {
        // Llegó un pago de verdad pero sin monto legible: se avisa para anotarlo a mano, y el log guarda
        // cómo llegó la transacción para ajustar el Atajo.
        registrar(`Apple Pay sin monto, texto de la transacción: ${JSON.stringify(p.entrada?.slice(0, 160) ?? "")}`);
        notificar(
          db,
          usuarioId,
          { titulo: "Pago con Apple Pay", cuerpo: "No pude leer el monto de tu pago. Dímelo con el Atajo para anotarlo.", url: "/#inicio" },
          opciones.enviarPush,
        ).catch((error) => console.error("No se pudo avisar del pago sin monto:", error));
      }
      if (prueba) {
        // Sin esperarla: corrido a mano, el Atajo contesta enseguida aunque Apple tarde.
        notificar(
          db,
          usuarioId,
          { titulo: "Apple Pay listo", cuerpo: "Cuando pagues con Apple Pay, lo anoto solo y te aviso aquí.", url: "/#inicio" },
          opciones.enviarPush,
        ).catch((error) => console.error("No se pudo mandar la notificación de prueba:", error));
      }
      return c.json({
        respuesta: prueba
          ? "Listo. Cuando pagues con Apple Pay lo anoto solo."
          : devolucion
            ? "Es una devolución; no la anoté como gasto."
            : "Ese pago no trae monto; no anoté nada.",
        prueba,
        acciones: [],
      });
    }
    // Se compara la hora del pago (capturado_en), no la de llegada: dos compras iguales en la mañana y en
    // la tarde que la cola reenvía juntas son dos pagos.
    const momento = p.capturado_en ? Date.parse(p.capturado_en) : Date.now();
    const repetido = db
      .select({ clientId: entradas.clientId, capturadoEn: entradas.capturadoEn })
      .from(entradas)
      .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.origen, "apple_pay"), eq(entradas.texto, texto)))
      .all()
      .some((e) => e.clientId !== p.client_id && Math.abs(Date.parse(e.capturadoEn) - momento) <= PAGO_REPETIDO_MS);
    if (repetido) {
      anotar("repetido");
      return c.json({ respuesta: "Ese pago ya estaba anotado.", duplicado: true, acciones: [] });
    }
    anotar("se anota");
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
    const { endpoint, keys, origen, en_iphone: enIphone } = cuerpo.data;
    // Apple pide un contacto; la dirección pública con la que se abrió la app sirve, si es este servidor.
    const propio = origen && origen.startsWith("https://") && hostsDeLaPeticion(c).includes(new URL(origen).host.toLowerCase());
    const contacto = opciones.contactoPush ?? (propio ? new URL(origen).origin : "mailto:finanzas@example.com");
    try {
      suscribir(db, c.get("usuarioId"), c.get("dispositivoId"), { endpoint, p256dh: keys.p256dh, auth: keys.auth, contacto, enIphone });
    } catch (error) {
      if (error instanceof ErrorSuscripcion) return c.json({ error: error.message, ajena: error.ajena || undefined }, error.ajena ? 409 : 400);
      throw error;
    }
    return c.json(estadoPush(db, c.get("usuarioId"), c.get("dispositivoId")), 201);
  });

  v1.delete("/push/suscripcion", (c) => {
    desuscribir(db, c.get("dispositivoId"));
    return c.json({ ok: true });
  });

  // Una prueba cada tanto por dispositivo: cada una es una notificación en todos los de la cuenta.
  const ultimaPrueba = new Map<string, number>();
  v1.post("/push/prueba", async (c) => {
    const ahora = Date.now();
    if (ahora - (ultimaPrueba.get(c.get("dispositivoId")) ?? 0) < PRUEBA_PUSH_CADA_MS) {
      return c.json({ error: "Espera unos segundos antes de mandar otra prueba." }, 429);
    }
    // Antes de enviar: con pruebas en paralelo o envíos que fallan, el límite también aplica.
    ultimaPrueba.set(c.get("dispositivoId"), ahora);
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
    if (error instanceof ErrorCuenta) return c.json({ error: error.message }, error.estado);
    throw error;
  });

  v1.get("/yo", (c) => {
    const usuarioId = c.get("usuarioId");
    const usuario = db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).get()!;
    const actual = c.get("dispositivoId");
    const lista = listarDispositivos(db, usuarioId);
    const propio = lista.find((d) => d.id === actual)!;
    return c.json({
      usuario: datosDeCuenta(usuario),
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

  // Cambiar el usuario, cambiar o quitar el código: si ya hay un código, piden el actual (ver comprobarCodigoActual).
  const cuentaDe = (c: Context<{ Variables: VariablesAuth }>) =>
    db.select().from(usuarios).where(eq(usuarios.id, c.get("usuarioId"))).get()!;
  const faltaActual = (c: Context) => c.json({ error: "Escribe tu código actual." }, 400);

  v1.patch("/yo", async (c) => {
    const cuerpo = z
      .object({ nombre: z.string().max(200).optional(), usuario: z.string().max(200).optional(), actual: z.string().max(256).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "Manda nombre o usuario." }, 400);
    const { actual, ...cambios } = cuerpo.data;
    const cuenta = cuentaDe(c);
    const otroUsuario = cambios.usuario !== undefined && normalizarUsuario(cambios.usuario) !== cuenta.usuario;
    if (otroUsuario && cuenta.codigoHash) {
      if (!actual) return faltaActual(c);
      const r = await conCodigo(c, cuenta.usuario ?? cuenta.id, () => comprobarCodigoActual(cuenta, actual));
      if (r.respuesta) return r.respuesta;
    }
    return c.json({ usuario: datosDeCuenta(cambiarCuenta(db, cuenta.id, cambios)) });
  });

  v1.put("/yo/codigo", async (c) => {
    const cuerpo = z
      .object({ codigo: z.string().max(1000), actual: z.string().max(256).optional(), cerrarOtros: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json({ error: "Manda el código." }, 400);
    const { codigo, actual, cerrarOtros } = cuerpo.data;
    const cuenta = cuentaDe(c);
    const nuevo = validarCodigoPersonal(codigo, cuenta);
    if (cuenta.codigoHash && !actual) return faltaActual(c);
    if (cambiosDeCodigo.bloqueado(cuenta.id)) return c.json({ error: "Ya cambiaste el código muchas veces. Espera un rato." }, 429);
    cambiosDeCodigo.fallo(cuenta.id);
    const r = await conCodigo(c, cuenta.usuario ?? cuenta.id, async () => {
      await comprobarCodigoActual(cuenta, actual ?? "");
      await ponerCodigo(db, cuenta.id, nuevo);
    });
    if (r.respuesta) return r.respuesta;
    // Si pudo haber un token en malas manos: el código nuevo y, con cerrarOtros, todos los demás dispositivos fuera.
    const cerrados = cerrarOtros ? cerrarOtrosDispositivos(db, cuenta.id, c.get("dispositivoId")) : 0;
    return c.json({ ok: true, cerrados });
  });

  v1.delete("/yo/codigo", async (c) => {
    const cuerpo = z.object({ actual: z.string().max(256).optional() }).safeParse(await c.req.json().catch(() => ({})));
    const actual = cuerpo.success ? cuerpo.data.actual : undefined;
    const cuenta = cuentaDe(c);
    if (cuenta.codigoHash) {
      if (!actual) return faltaActual(c);
      const r = await conCodigo(c, cuenta.usuario ?? cuenta.id, () => comprobarCodigoActual(cuenta, actual));
      if (r.respuesta) return r.respuesta;
    }
    quitarCodigo(db, cuenta.id);
    return c.json({ ok: true });
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
        cuentaId: q.cuenta_id || undefined,
        etiquetaId: q.etiqueta_id || undefined,
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
    const { categoria_id, cuenta_destino, etiquetas, ...datos } = cuerpo.data;
    const creado = crearMovimiento(ctx, {
      ...datos,
      cuentaDestino: cuenta_destino,
      etiquetaIds: etiquetas,
      categoriaId: categoria_id ?? undefined,
      origen: "app",
    });
    return c.json(movimientoApp(ctx, obtenerPropio(ctx, creado.id)), 201);
  });

  // Detalle de un registro (la PWA lo abre al tocar una notificación).
  v1.get("/movimientos/:id", (c) => {
    const ctx = contexto(c.get("usuarioId"));
    try {
      return c.json(movimientoApp(ctx, obtenerPropio(ctx, c.req.param("id"))));
    } catch (error) {
      if (error instanceof ErrorFinanzas) return c.json({ error: "No existe ese movimiento." }, 404);
      throw error;
    }
  });

  v1.patch("/movimientos/:id", async (c) => {
    const cuerpo = esquemaEdicion.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) {
      return c.json({ error: "Datos inválidos.", detalles: z.flattenError(cuerpo.error).fieldErrors }, 400);
    }
    const ctx = contexto(c.get("usuarioId"));
    const { categoria_id, comercio, descripcion, cuenta, cuenta_destino, etiquetas, ...cambios } = cuerpo.data;
    const id = c.req.param("id");
    // editarMovimiento borra con "".
    const texto = (v: string | null | undefined) => (v === null ? "" : v);
    editarMovimiento(ctx, id, {
      ...cambios,
      comercio: texto(comercio),
      descripcion: texto(descripcion),
      cuenta: texto(cuenta),
      cuentaDestino: texto(cuenta_destino),
      etiquetaIds: etiquetas,
      categoriaId: categoria_id,
    });
    return c.json(movimientoApp(ctx, obtenerPropio(ctx, id)));
  });

  v1.delete("/movimientos/:id", (c) => {
    eliminarMovimiento(contexto(c.get("usuarioId")), c.req.param("id"));
    return c.json({ ok: true });
  });

  v1.post("/deshacer", (c) => c.json(deshacer(contexto(c.get("usuarioId")))));

  // Ajustes > Sistema: qué versión corre, desde cuándo, si la IA está lista y si hay dictados atorados.
  // Ajustes lo pide al abrirse: a Ollama se le pregunta como mucho cada 10 s, la pidan cuantos la pidan.
  let iaReciente: { en: number; estado: Promise<EstadoIa> } | null = null;
  const estadoIaReciente = () => {
    if (!iaReciente || Date.now() - iaReciente.en > 10_000) {
      const estado = (opciones.estadoIa?.() ?? Promise.resolve(null))
        .catch(() => null)
        .then((e) => e ?? { modelo: "", disponible: false, cargada: false });
      iaReciente = { en: Date.now(), estado };
    }
    return iaReciente.estado;
  };
  // El dueño es la primera cuenta (la que crea `bun run invitar -- --nombre ...` en una base vacía).
  const esDueno = (usuarioId: string) =>
    db.select({ id: usuarios.id }).from(usuarios).orderBy(usuarios.creadoEn, sql`rowid`).limit(1).get()?.id === usuarioId;

  v1.get("/estado", async (c) => {
    const usuarioId = c.get("usuarioId");
    // Solo la última semana: un error viejo ya no dice nada del estado de hoy.
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const contar = (estado: "procesando" | "error") =>
      db
        .select({ n: count() })
        .from(entradas)
        .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.estado, estado), gte(entradas.creadoEn, desde)))
        .get()?.n ?? 0;
    const { modelo, disponible, cargada } = await estadoIaReciente();
    const cola = { pendientes: contar("procesando"), conError: contar("error") };
    // El servidor es público: qué código y qué modelo corren, y desde cuándo, solo lo ve el dueño de la instalación.
    if (!esDueno(usuarioId)) return c.json({ servidor: null, ia: { disponible, cargada }, cola });
    return c.json({
      servidor: { commit: opciones.version?.commit ?? null, commitEn: opciones.version?.commitEn ?? null, arrancadoEn },
      ia: { modelo, disponible, cargada },
      cola,
    });
  });

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
  rutasCuentas(v1, contexto);
  // Al encender o apagar, Ajustes ve el estado nuevo de la IA sin esperar los 10 s del caché.
  if (opciones.controlIa) rutasIa(v1, { control: opciones.controlIa, esDueno, alCambiar: () => (iaReciente = null) });

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
