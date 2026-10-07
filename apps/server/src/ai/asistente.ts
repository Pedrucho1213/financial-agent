import { generateText, isStepCount, type LanguageModel, type ModelMessage } from "ai";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { cuentas, entradas, mensajes, movimientos } from "../db/schema";
import { type Contexto, crearContexto } from "../finanzas/contexto";
import { habitoMencionado, hablaDeOtroMonto } from "../finanzas/habitos";
import { revertirEntrada } from "../finanzas/movimientos";
import { datoDePresupuesto } from "../finanzas/planes";
import { cobrosPorAvisar } from "../finanzas/recurrentes";
import { formatearMonto } from "../lib/dinero";
import { montosDelTexto } from "../lib/numeros";
import { esOrdenSobreLoAnotado, esPregunta, normalizar, pideInformacion, tipoDelTexto } from "../lib/texto";
import { confirmacionDirecta, confirmarRegistro, type Ejecutada } from "./confirmacion";
import { construirInstrucciones, datosDelUsuario } from "./instrucciones";
import { pagoDeFrase } from "../finanzas/applepay";
import { crearHerramientas, type Accion } from "./herramientas";
import { CONSULTAS_PLANES } from "./herramientas-planes";
import { correccionDeCuenta } from "./respaldo";

export type Peticion = {
  texto: string;
  /** Lo genera el iPhone; si el mismo dictado llega dos veces, se responde lo mismo sin repetir nada. */
  clientId: string;
  conversacionId?: string;
  lat?: number;
  lon?: number;
  lugar?: string;
  /** Cuándo se dictó (ISO). Importa cuando el dictado esperó en la cola sin conexión. */
  capturadoEn?: string;
  /** Un pago con Apple Pay que mandó el Atajo de la Cartera; por omisión, un dictado. */
  origen?: Entrada["origen"];
};

export type Respuesta = {
  respuesta: string;
  conversacion_id: string;
  acciones: Accion[];
  duplicado?: boolean;
  /** La Mac sigue procesando; la respuesta final se consulta en /v1/entradas/:client_id. */
  pendiente?: boolean;
  /** Con pendiente: era una pregunta y vale la pena esperar la respuesta en /v1/entradas/:client_id. */
  esperar?: boolean;
  /** El dato útil que se agregó a la respuesta ("Vas en 82% de tu presupuesto de Comida."), por separado. */
  dato?: string;
};

export type Dependencias = {
  db: Db;
  modelo: LanguageModel;
  zonaHoraria: string;
  monedaBase: string;
  /** Pausas entre reintentos de un dictado que falló en segundo plano. */
  reintentosMs?: number[];
  /**
   * Un dictado que nadie estaba esperando terminó (con su respuesta) o se dio por perdido (sin ella).
   * Es lo que manda la notificación con lo que el iPhone ya no alcanzó a oír.
   */
  alTerminarSinEspera?: (entrada: Entrada, respuesta: Respuesta | undefined) => void;
  /** Si `alTerminarSinEspera` le hará llegar la respuesta a esa cuenta (tiene notificaciones). */
  notificaSinEspera?: (usuarioId: string) => boolean;
  /** Cuántos usuarios atiende la IA a la vez (OLLAMA_NUM_PARALLEL). Por omisión, uno. */
  paralelo?: number;
};

export type OpcionesHablar = {
  /** Cuánto esperar antes de contestar "pendiente" y seguir en segundo plano. Sin valor, espera todo. */
  esperaMs?: number;
  /** Si es una pregunta (o una orden sin monto), la respuesta "pendiente" invita a esperar en vez de decir "anotado". */
  esPregunta?: boolean;
};

export class ErrorIA extends Error {}
/** El mismo dictado ya se está procesando (la cola lo reenvió antes de que terminara). */
export class ErrorEnProceso extends Error {}

// Una conversación se retoma si su último mensaje tiene menos de 30 minutos.
const VIGENCIA_CONVERSACION_MS = 30 * 60_000;
const MAX_MENSAJES_HISTORIAL = 24;

function cargarHistorial(db: Db, usuarioId: string, conversacionId: string): ModelMessage[] {
  const desde = new Date(Date.now() - VIGENCIA_CONVERSACION_MS).toISOString();
  const filas = db
    .select()
    .from(mensajes)
    .where(
      and(eq(mensajes.usuarioId, usuarioId), eq(mensajes.conversacionId, conversacionId), gte(mensajes.creadoEn, desde)),
    )
    .orderBy(asc(mensajes.creadoEn), asc(sql`rowid`))
    .all()
    .map((m) => m.contenido as ModelMessage);
  const recientes = filas.slice(-MAX_MENSAJES_HISTORIAL);
  // No empezar a media llamada de herramienta: el historial arranca en un mensaje del usuario.
  const inicio = recientes.findIndex((m) => m.role === "user");
  return inicio === -1 ? [] : recientes.slice(inicio);
}

// Palabras con las que el modelo dice que ya hizo algo ("Listo", "registré", "lo borré"), sin acentos.
const DICE_QUE_HIZO =
  /\b(listo|hecho|registre|registrado|registrada|registrados|anote|anotado|anotada|guarde|guardado|guardada|apunte|apuntado|elimine|eliminado|eliminada|borre|borrado|borrada|cambie|cambiado|corregi|corregido|corregida|actualice|actualizado|deshice)\b/;
// La frase trae un monto o pide algo que necesita herramientas.
const PIDE_ALGO =
  /\d|\b(mil|cien|ciento|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b|gast|pag|compr|cobr|deposit|transf|borr|elimin|quit|cambi|corrig|deshaz|cancel/;

const diceQueHizo = (respuesta: string) => !respuesta.includes("?") && DICE_QUE_HIZO.test(normalizar(respuesta));

/**
 * Sin herramientas no se guardó ni se consultó nada. Si aun así el modelo dice que lo hizo,
 * o contesta una pregunta con cifras o "no hay registros", su respuesta no es confiable.
 */
function respuestaSinSustento(pregunta: string, respuesta: string, acciones: Accion[]): boolean {
  if (acciones.length > 0 || respuesta.includes("?")) return false;
  if (esPregunta(pregunta)) return /\d|no (tengo|hay|encuentro|veo|tienes)/i.test(respuesta);
  return PIDE_ALGO.test(normalizar(pregunta)) && diceQueHizo(respuesta);
}

const AVISO_SIN_HERRAMIENTAS =
  "\n\nAviso: en tu intento anterior respondiste sin usar ninguna herramienta, así que no se guardó ni se consultó nada. " +
  "Si el usuario dictó un gasto o ingreso que ya hizo, regístralo; si pidió corregir o borrar, hazlo; si preguntó por sus finanzas, consúltalas. " +
  "Si no pidió nada de eso, responde sin decir que guardaste algo.";

const RESPUESTA_NO_GUARDADA = "No alcancé a guardar nada. ¿Me lo repites?";

/** Respuesta hablada cuando el modelo no dejó texto final. */
function respuestaPorOmision(acciones: Accion[]): string {
  return acciones.length ? "Listo." : "No entendí, ¿me lo repites?";
}

// Preguntas que solo ofrecen más ayuda ("¿En qué puedo ayudarte?", "¿Algo más?"): dejarían el micrófono
// abierto sin necesidad, y las instrucciones ya piden no hacerlas.
// "¿Quieres que borre el de las 9 o el de las 11?" sí pide una respuesta: "quieres que" solo es cortesía si ofrece ayuda.
const OFRECE_AYUDA =
  /^¿\s*(y\s+)?(en qu[eé] (m[aá]s )?(te |le )?(puedo |podr[ií]a )?(ayud|apoy|serv)|(hay |necesitas |quieres |deseas |se te ofrece )?algo m[aá]s|qu[eé] m[aá]s|((te|le) )?(puedo|podr[ií]a) (ayudar|apoyar)|(quieres|te gustar[ií]a|deseas|necesitas)\b[^?]*\b(ayud\w*|algo m[aá]s))/i;
// "¿De cuánto fue y con qué pagaste?": decir con qué pagó es opcional y nunca se pregunta.
const Y_CON_QUE_PAGO = /,?\s+y\s+con\s+qu[eé]\s+(lo\s+|la\s+)?(pagaste|pag[oó]|tarjeta|cuenta|m[eé]todo)[^?]*(?=\?)/i;
const CON_QUE_PAGO = /^¿\s*(y\s+)?con\s+qu[eé]\s+(lo\s+|la\s+)?(pagaste|pag[oó]|tarjeta|cuenta|m[eé]todo)[^?]*\?$/i;

/** Quita del texto del modelo las preguntas que no necesita que le contesten. */
function sinPreguntasDeMas(texto: string): string {
  const frases = texto.replace(Y_CON_QUE_PAGO, "").split(/(?<=[.!?])\s+/);
  const quedan = frases.filter((f) => !OFRECE_AYUDA.test(f.trim()) && !CON_QUE_PAGO.test(f.trim()));
  if (quedan.length) return quedan.join(" ");
  // Solo ofrecía ayuda ("¿En qué te ayudo?"); si solo preguntaba con qué pagó, mejor eso que nada.
  return frases.every((f) => OFRECE_AYUDA.test(f.trim())) ? "Aquí estoy." : texto;
}

function limpiarParaVoz(texto: string): string {
  return texto
    .replace(/\*\*?|__|`|#+\s/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Los dictados de cada usuario se procesan de uno en uno y en orden de llegada: así "deshaz eso"
// siempre va después de lo que deshace (también un pago de Apple Pay que llega mientras dictas).
// Los de usuarios distintos pueden ir a la vez, hasta `paralelo`, que debe coincidir con OLLAMA_NUM_PARALLEL.
const colasPorUsuario = new Map<string, Promise<unknown>>();
let ocupados = 0;
const esperandoLugar: (() => void)[] = [];

async function conLugar<T>(paralelo: number, trabajo: () => Promise<T>): Promise<T> {
  // Al terminar, el lugar pasa directo al siguiente que espera: nadie que llegue después se le adelanta.
  if (ocupados >= paralelo) await new Promise<void>((listo) => esperandoLugar.push(listo));
  else ocupados++;
  try {
    return await trabajo();
  } finally {
    const siguiente = esperandoLugar.shift();
    if (siguiente) siguiente();
    else ocupados--;
  }
}

function enCola<T>(deps: Dependencias, usuarioId: string, trabajo: () => Promise<T>): Promise<T> {
  const enLugar = () => conLugar(Math.max(1, deps.paralelo ?? 1), trabajo);
  const resultado = (colasPorUsuario.get(usuarioId) ?? Promise.resolve()).then(enLugar, enLugar);
  const fin = resultado.catch(() => {});
  colasPorUsuario.set(usuarioId, fin);
  fin.then(() => {
    if (colasPorUsuario.get(usuarioId) === fin) colasPorUsuario.delete(usuarioId);
  });
  return resultado;
}

/** Dictados que ya están en la cola, por id de entrada, para no procesar dos veces el mismo. */
const enCurso = new Map<string, Promise<Respuesta>>();

/**
 * Al apagar el servidor: espera a que terminen los dictados en curso, hasta `maximoMs`. Lo que no
 * alcance queda "procesando" en la base y `reanudarPendientes` lo retoma al arrancar.
 */
export async function terminarEnCurso(maximoMs: number): Promise<number> {
  const limite = Date.now() + maximoMs;
  while (enCurso.size > 0 && Date.now() < limite) {
    await Promise.race([Promise.allSettled([...enCurso.values()]), Bun.sleep(Math.max(0, limite - Date.now()))]);
  }
  return enCurso.size;
}

// Si la IA falla después de haber contestado "pendiente", la Mac reintenta sola.
const REINTENTOS_MS = [30_000, 120_000, 600_000];

const RESPUESTA_PENDIENTE = "Anotado. Lo termino de procesar en un momento.";
const RESPUESTA_PENDIENTE_PREGUNTA = "Dame un momento más, sigo revisando tus cuentas.";

/** Espera la promesa hasta `ms`; si no terminó, devuelve "tiempo" sin cancelarla. */
async function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T | "tiempo"> {
  let espera: ReturnType<typeof setTimeout> | undefined;
  const tiempo = new Promise<"tiempo">((listo) => {
    espera = setTimeout(() => listo("tiempo"), ms);
  });
  try {
    return await Promise.race([promesa, tiempo]);
  } finally {
    clearTimeout(espera);
  }
}

export async function hablar(
  deps: Dependencias,
  usuarioId: string,
  peticion: Peticion,
  opciones: OpcionesHablar = {},
): Promise<Respuesta> {
  const { db } = deps;
  // De aquí al insert no hay await: dos peticiones con el mismo client_id no pueden cruzarse.
  const previa = db
    .select()
    .from(entradas)
    .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.clientId, peticion.clientId)))
    .get();
  if (previa?.estado === "listo" && previa.respuesta) {
    return { ...(previa.respuesta as Respuesta), duplicado: true };
  }
  // Si esperaba su próximo reintento, el reenvío lo adelanta y se une a ese trabajo.
  if (previa) esperandoReintento.get(previa.id)?.();
  const existente = previa && enCurso.get(previa.id);
  if (!existente && previa?.estado === "procesando" && Date.now() - Date.parse(previa.creadoEn) < 2 * 60_000) {
    throw new ErrorEnProceso("Ese dictado todavía se está procesando.");
  }

  const entrada =
    previa ??
    db
      .insert(entradas)
      .values({
        usuarioId,
        clientId: peticion.clientId,
        conversacionId: peticion.conversacionId ?? crypto.randomUUID(),
        texto: peticion.texto,
        lat: peticion.lat,
        lon: peticion.lon,
        lugar: peticion.lugar,
        capturadoEn: (peticion.capturadoEn ? new Date(peticion.capturadoEn) : new Date()).toISOString(),
        origen: peticion.origen,
      })
      .returning()
      .get();
  if (previa && !existente) db.update(entradas).set({ estado: "procesando" }).where(eq(entradas.id, previa.id)).run();
  const trabajo = existente ?? encolar(deps, entrada);
  if (opciones.esperaMs === undefined) return trabajo;

  const resultado = await conLimite(trabajo, opciones.esperaMs);
  if (resultado !== "tiempo") return resultado;
  // Tardó más de lo que el iPhone espera: la Mac se queda con el dictado y lo termina sola.
  enSegundoPlano.add(entrada.id);
  return opciones.esPregunta
    ? { respuesta: RESPUESTA_PENDIENTE_PREGUNTA, conversacion_id: entrada.conversacionId, acciones: [], pendiente: true, esperar: true }
    : { respuesta: RESPUESTA_PENDIENTE, conversacion_id: entrada.conversacionId, acciones: [], pendiente: true };
}

export type Entrada = typeof entradas.$inferSelect;

/** Dictados que nadie está esperando: si fallan, la Mac los reintenta sola más tarde. */
const enSegundoPlano = new Set<string>();
/** Cuántas consultas (/v1/entradas con espera) están esperando cada dictado en este momento. */
const esperandoRespuesta = new Map<string, number>();

/** Avisa que terminó un dictado en segundo plano, salvo que alguien esté esperando su respuesta. */
function terminoSinEspera(deps: Dependencias, entrada: Entrada, respuesta: Respuesta | undefined) {
  if (!deps.alTerminarSinEspera || (esperandoRespuesta.get(entrada.id) ?? 0) > 0) return;
  try {
    deps.alTerminarSinEspera(entrada, respuesta);
  } catch (error) {
    console.error("Falló el aviso de un dictado terminado:", error);
  }
}

// Un dictado que ya recibió "Anotado" no se da por perdido: se reintenta (la última pausa se repite)
// hasta 24 horas después de dictarlo, y en cuanto otro dictado sale bien, porque la IA ya volvió.
// Si vuelve a fallar mientras otros sí salen, el problema es ese dictado: se deja en error para no
// frenar la cola cada vez (el reenvío del iPhone todavía lo puede recuperar).
const VIGENCIA_REINTENTOS_MS = 24 * 60 * 60_000;
const esperandoReintento = new Map<string, () => void>();
/** Dictados que salieron bien desde que arrancó el servidor, por base de datos. */
const exitosPorBase = new WeakMap<Db, number>();
const exitos = (db: Db) => exitosPorBase.get(db) ?? 0;

function encolar(deps: Dependencias, entrada: Entrada, intento = 0, exitosAlFallar?: number): Promise<Respuesta> {
  const trabajo = enCola(deps, entrada.usuarioId, () => procesar(deps, entrada));
  enCurso.set(entrada.id, trabajo);
  trabajo.then(
    (respuesta) => {
      enCurso.delete(entrada.id);
      if (enSegundoPlano.has(entrada.id)) terminoSinEspera(deps, entrada, respuesta);
      enSegundoPlano.delete(entrada.id);
      exitosPorBase.set(deps.db, exitos(deps.db) + 1);
      for (const reintentar of [...esperandoReintento.values()]) reintentar();
    },
    () => {
      enCurso.delete(entrada.id);
      if (!enSegundoPlano.has(entrada.id)) return;
      const pausas = deps.reintentosMs ?? REINTENTOS_MS;
      const pausa = pausas[Math.min(intento, pausas.length - 1)];
      const iaFunciona = exitosAlFallar !== undefined && exitos(deps.db) > exitosAlFallar;
      if (pausa === undefined || iaFunciona || Date.now() - Date.parse(entrada.creadoEn) > VIGENCIA_REINTENTOS_MS) {
        console.error(`Dictado ${entrada.clientId} sin procesar después de ${intento + 1} intentos; queda en error.`);
        enSegundoPlano.delete(entrada.id);
        terminoSinEspera(deps, entrada, undefined);
        return;
      }
      // Sigue pendiente para quien lo consulte: no es un error mientras se vaya a reintentar.
      deps.db.update(entradas).set({ estado: "procesando" }).where(eq(entradas.id, entrada.id)).run();
      const fallo = exitos(deps.db);
      const reintentar = () => {
        clearTimeout(espera);
        esperandoReintento.delete(entrada.id);
        const actual = deps.db.select().from(entradas).where(eq(entradas.id, entrada.id)).get();
        if (actual && actual.estado !== "listo" && !enCurso.has(entrada.id)) encolar(deps, actual, intento + 1, fallo);
      };
      const espera = setTimeout(reintentar, pausa);
      espera.unref?.();
      esperandoReintento.set(entrada.id, reintentar);
    },
  );
  return trabajo;
}

/**
 * Al arrancar, retoma lo que quedó a medias por un reinicio o un fallo de la IA en las últimas 24 horas.
 * Devuelve cuántos dictados volvió a poner en la cola.
 */
export function reanudarPendientes(deps: Dependencias): number {
  const desde = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const pendientes = deps.db
    .select()
    .from(entradas)
    .where(and(inArray(entradas.estado, ["procesando", "error"]), gte(entradas.creadoEn, desde)))
    .orderBy(asc(entradas.creadoEn))
    .all()
    .filter((e) => !enCurso.has(e.id));
  for (const e of pendientes) {
    deps.db.update(entradas).set({ estado: "procesando" }).where(eq(entradas.id, e.id)).run();
    encolar(deps, e);
    enSegundoPlano.add(e.id);
  }
  return pendientes.length;
}

const PRECALENTADO_VIGENTE_MS = 60_000;
const precalentados = new Map<string, { desde: number; trabajo: Promise<unknown> }>();

/**
 * Carga el modelo y deja procesadas las instrucciones y herramientas del usuario, que son iguales
 * en cada dictado: Ollama reutiliza ese prefijo y el primer dictado solo procesa la frase nueva.
 * Va por la cola del usuario para no competir con un dictado suyo que ya está en curso.
 */
export function precalentar(deps: Dependencias, usuarioId: string): Promise<unknown> {
  // Si el Atajo se abre varias veces seguidas, basta con un precalentado.
  const previo = precalentados.get(usuarioId);
  if (previo && Date.now() - previo.desde < PRECALENTADO_VIGENTE_MS) return previo.trabajo;
  const trabajo = enCola(deps, usuarioId, async () => {
    const ctx = crearContexto({ db: deps.db, usuarioId, zonaHoraria: deps.zonaHoraria, monedaBase: deps.monedaBase });
    // Las mismas definiciones, pero sin poder ejecutar nada.
    const herramientas = Object.fromEntries(
      Object.entries(crearHerramientas(ctx, [])).map(([nombre, h]) => [nombre, { ...h, execute: undefined }]),
    );
    await generateText({
      model: deps.modelo,
      instructions: construirInstrucciones(ctx),
      messages: [{ role: "user", content: "Hola" }],
      tools: herramientas,
      maxOutputTokens: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000),
    }).catch(() => undefined);
  });
  precalentados.set(usuarioId, { desde: Date.now(), trabajo });
  return trabajo;
}

export type EstadoEntrada = { estado: Entrada["estado"] } & Partial<Respuesta>;

/**
 * Estado de un dictado para el Atajo o la app: si ya terminó, su respuesta.
 * Con `esperaMs`, si sigue en la cola espera hasta ese tiempo a que termine.
 */
export async function consultarEntrada(
  db: Db,
  usuarioId: string,
  clientId: string,
  esperaMs = 0,
): Promise<EstadoEntrada | undefined> {
  const buscar = () =>
    db
      .select()
      .from(entradas)
      .where(and(eq(entradas.usuarioId, usuarioId), eq(entradas.clientId, clientId)))
      .get();
  const inicial = buscar();
  if (!inicial) return undefined;
  const trabajo = enCurso.get(inicial.id);
  if (trabajo && esperaMs > 0) {
    // Mientras alguien espera la respuesta, no hace falta mandarla por notificación.
    esperandoRespuesta.set(inicial.id, (esperandoRespuesta.get(inicial.id) ?? 0) + 1);
    try {
      await conLimite(trabajo.catch(() => undefined), esperaMs);
    } finally {
      const quedan = (esperandoRespuesta.get(inicial.id) ?? 1) - 1;
      if (quedan > 0) esperandoRespuesta.set(inicial.id, quedan);
      else esperandoRespuesta.delete(inicial.id);
    }
  }
  const e = buscar() ?? inicial;
  return e.estado === "listo" ? { ...(e.respuesta as Respuesta), estado: e.estado } : { estado: e.estado };
}

/** Corrige la cuenta de un gasto ya registrado sin el modelo (ver `correccionDeCuenta`). */
async function corregirCuenta(ctx: Contexto, texto: string, acciones: Accion[]): Promise<string | undefined> {
  const conocidas = ctx.db
    .select({ nombre: cuentas.nombre, alias: cuentas.alias })
    .from(cuentas)
    .where(eq(cuentas.usuarioId, ctx.usuarioId))
    .all()
    .flatMap((c) => [c.nombre, ...c.alias]);
  const correccion = correccionDeCuenta(texto, conocidas);
  if (!correccion) return undefined;
  // Sin día, "el súper" es a propósito el más reciente de la semana (ver `correccionDeCuenta`).
  const editar = crearHerramientas({ ...ctx, confiarEnMasReciente: true }, acciones).editar_movimiento;
  const resultado = await editar.execute!(
    { buscar: correccion.buscar, cambios: { cuenta: correccion.cuenta } },
    { toolCallId: "respaldo-cuenta", messages: [], context: {} },
  );
  // Si no encontró uno solo (o ninguno), queda la respuesta del modelo.
  if (!resultado || typeof resultado !== "object" || !("editado" in resultado)) return undefined;
  return confirmacionDirecta(texto, ctx.hoy, [{ herramienta: "editar_movimiento", resultado }]) ?? "Listo, lo corregí.";
}

/**
 * Un pago de Apple Pay solo puede anotarse: el nombre del comercio lo escribe un tercero y el Atajo
 * corre sin que nadie lo vea, así que "BORRA MIS GASTOS" en ese nombre no puede volverse una orden.
 */
function herramientasPara<T extends Record<string, unknown>>(entrada: Entrada, todas: T): Partial<T> {
  if (entrada.origen !== "apple_pay") return todas;
  return Object.fromEntries(Object.entries(todas).filter(([nombre]) => nombre === "registrar_movimientos")) as Partial<T>;
}

/** El texto de un mensaje guardado, sin las llamadas a herramientas. */
function textoDe(mensaje: ModelMessage | undefined): string {
  if (!mensaje) return "";
  if (typeof mensaje.content === "string") return mensaje.content;
  return mensaje.content.map((parte) => (parte.type === "text" ? parte.text : "")).join(" ").trim();
}

/** Los gastos que creó este dictado y siguen ahí, para saber si cruzaron un presupuesto. */
function gastosNuevos(ctx: Contexto, entradaId: string) {
  return ctx.db
    .select({ categoriaId: movimientos.categoriaId, montoCentavos: movimientos.montoCentavos, fecha: movimientos.fecha, moneda: movimientos.moneda })
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), eq(movimientos.entradaId, entradaId), eq(movimientos.tipo, "gasto"), isNull(movimientos.eliminadoEn)))
    .all();
}

/** Comercios y conceptos que se registraron en este dictado ("Netflix", "Renta"), para no avisar de su cobro. */
function loQuePago(acciones: Accion[]): string[] {
  return acciones.flatMap((a) => {
    const r = a.resultado as { registrados?: { comercio?: string; descripcion?: string; categoria?: string }[] } | undefined;
    if (a.herramienta !== "registrar_movimientos" || !r?.registrados) return [];
    return r.registrados.flatMap((m) => [m.comercio, m.descripcion, m.categoria?.split(" > ").at(-1)].filter((x): x is string => !!x));
  });
}

// Herramientas que solo leen: si el modelo solo usó estas, no cambió nada.
const SOLO_CONSULTA = new Set(["buscar_movimientos", "consultar_gastos", "listar_recurrentes", ...CONSULTAS_PLANES]);

// La respuesta pide elegir entre varios: "¿Cuál café?", "¿El de Oxxo o el de Starbucks?".
const PIDE_ELEGIR = /\b(cual|cuales)\b|\bo (el|la|los|las) de\b/;

// El modelo pregunta cuánto fue: "¿De cuánto fue?", "¿Qué monto?".
const PREGUNTA_EL_MONTO = /\b(cuanto|cuanta|monto|cantidad)\b/;

/**
 * "Ya pagué Netflix" sin decir cuánto y el modelo pregunta el monto: si siempre es el mismo, se anota
 * sin preguntar; si solo se pagó una vez, se propone ese ("¿fue de $3,500, como la vez pasada?").
 */
async function registrarDeSiempre(ctx: Contexto, texto: string, respuesta: string, acciones: Accion[]): Promise<string | undefined> {
  if (!respuesta.includes("?") || !PREGUNTA_EL_MONTO.test(normalizar(respuesta))) return undefined;
  if (montosDelTexto(texto).length > 0 || esOrdenSobreLoAnotado(texto) || hablaDeOtroMonto(texto)) return undefined;
  // Solo si dice que ya pagó o le pagaron: "Netflix subió de precio" o "cuánto me cuesta Netflix" no son un pago.
  const tipo = tipoDelTexto(texto);
  if (!tipo || pideInformacion(texto)) return undefined;
  const habito = habitoMencionado(ctx, texto, tipo);
  if (!habito) return undefined;
  if (!habito.seguro) return `¿Fue de ${formatearMonto(habito.montoCentavos, habito.moneda)}, como la vez pasada?`;
  const registrar = crearHerramientas(ctx, acciones).registrar_movimientos;
  const resultado = await registrar.execute!(
    {
      movimientos: [
        { tipo: habito.tipo, monto: habito.montoCentavos / 100, moneda: habito.moneda, comercio: habito.comercio, descripcion: habito.descripcion },
      ],
    },
    { toolCallId: "respaldo-de-siempre", messages: [], context: {} },
  );
  if (!resultado || typeof resultado !== "object" || !("registrados" in resultado)) return undefined;
  return confirmarRegistro(resultado.registrados, ctx.hoy);
}

async function anotarPagoDirecto(ctx: Contexto, texto: string, acciones: Accion[]): Promise<string | undefined> {
  const pago = pagoDeFrase(texto);
  if (!pago) return undefined;
  const registrar = crearHerramientas(ctx, acciones).registrar_movimientos;
  const resultado = await registrar.execute!(
    { movimientos: [{ tipo: "gasto", monto: pago.monto, moneda: pago.moneda, comercio: pago.comercio }] },
    { toolCallId: "respaldo-apple-pay", messages: [], context: {} },
  );
  if (!resultado || typeof resultado !== "object" || !("registrados" in resultado)) return undefined;
  return confirmarRegistro(resultado.registrados, ctx.hoy);
}

async function procesar(deps: Dependencias, entrada: Entrada): Promise<Respuesta> {
  const { db } = deps;
  const usuarioId = entrada.usuarioId;
  const conversacionId = entrada.conversacionId;
  const ctx = crearContexto({
    db,
    usuarioId,
    zonaHoraria: deps.zonaHoraria,
    monedaBase: deps.monedaBase,
    entradaId: entrada.id,
    textoOriginal: entrada.texto,
    ubicacion: { lat: entrada.lat ?? undefined, lon: entrada.lon ?? undefined, lugar: entrada.lugar ?? undefined },
    ahora: new Date(entrada.capturadoEn),
    origen: entrada.origen,
  });
  // Un intento anterior que falló a medias no debe dejar registros duplicados.
  revertirEntrada(ctx, entrada.id);

  const acciones: Accion[] = [];
  const mensajeUsuario: ModelMessage = { role: "user", content: entrada.texto };
  const historial = cargarHistorial(db, usuarioId, conversacionId);
  ctx.enConversacion = historial.length > 0;
  // Si la respuesta anterior pedía elegir ("¿cuál café, el de 60 o el de 85?"), lo que se dice ahora la
  // contesta y el modelo ya sabe de cuál se habla. Otra pregunta ("¿de cuánto fue?") o una conversación
  // sin pregunta (el chat de la app) no bastan.
  const anterior = textoDe(historial.findLast((m) => m.role === "assistant" && textoDe(m) !== ""));
  ctx.confiarEnMasReciente = anterior.includes("?") && PIDE_ELEGIR.test(normalizar(anterior));
  // Si un paso solo guardó, corrigió o borró, la confirmación se arma aquí y el modelo no da otra vuelta.
  let confirmacion: string | undefined;
  const generar = (aviso = "") => {
    confirmacion = undefined;
    // Lo que cambia mientras se usa (y el aviso de un reintento) va justo antes del dictado, no en las
    // instrucciones: así Ollama reutiliza lo ya procesado de instrucciones, herramientas e historial.
    const datos = [datosDelUsuario(ctx), aviso.trim()].filter(Boolean).join("\n\n");
    return generateText({
      model: deps.modelo,
      instructions: construirInstrucciones(ctx),
      messages: [...historial, ...(datos ? [{ role: "system" as const, content: datos }] : []), mensajeUsuario],
      allowSystemInMessages: true,
      tools: herramientasPara(entrada, crearHerramientas(ctx, acciones)),
      stopWhen: [
        isStepCount(6),
        ({ steps }) => {
          const ejecutadas: Ejecutada[] = (steps.at(-1)?.content ?? []).flatMap((parte) =>
            parte.type === "tool-result" ? [{ herramienta: parte.toolName, resultado: parte.output }] : parte.type === "tool-error" ? [{ herramienta: parte.toolName, resultado: { error: true } }] : [],
          );
          confirmacion = confirmacionDirecta(entrada.texto, ctx.hoy, ejecutadas);
          return confirmacion !== undefined;
        },
      ],
      temperature: 0.2,
      // Las respuestas son de una o dos frases; esto solo frena a un modelo que no para de escribir.
      maxOutputTokens: 600,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(90_000),
    });
  };
  let texto: string;
  let mensajesRespuesta: ModelMessage[];
  try {
    let resultado = await generar();
    texto = confirmacion ?? resultado.text;
    // Un "Listo" sin haber llamado a ninguna herramienta es una confirmación falsa: se reintenta una vez.
    if (respuestaSinSustento(entrada.texto, texto, acciones)) {
      resultado = await generar(AVISO_SIN_HERRAMIENTAS);
      texto = confirmacion ?? resultado.text;
    }
    mensajesRespuesta = resultado.response.messages;
    if (confirmacion) mensajesRespuesta = [...mensajesRespuesta, { role: "assistant", content: confirmacion }];
    // "El súper de hoy fue con la Nu" sin herramientas (o tras solo buscarlo): el modelo suele preguntar
    // el monto o "¿te refieres al de 230?"; se corrige aquí.
    const nadaCambio = () => acciones.every((a) => SOLO_CONSULTA.has(a.herramienta));
    if (nadaCambio()) {
      const corregido = await corregirCuenta(ctx, entrada.texto, acciones);
      if (corregido) {
        texto = corregido;
        mensajesRespuesta = [{ role: "assistant", content: corregido }];
      }
    }
    if (nadaCambio()) {
      const deSiempre = await registrarDeSiempre(ctx, entrada.texto, texto, acciones);
      if (deSiempre) {
        texto = deSiempre;
        mensajesRespuesta = [{ role: "assistant", content: deSiempre }];
      }
    }
    // Un pago de Apple Pay siempre se anota: si el modelo no lo hizo, se anota con lo que dio la Cartera.
    if (entrada.origen === "apple_pay" && nadaCambio()) {
      const directo = await anotarPagoDirecto(ctx, entrada.texto, acciones);
      if (directo) {
        texto = directo;
        mensajesRespuesta = [{ role: "assistant", content: directo }];
      }
    }
    if (nadaCambio() && PIDE_ALGO.test(normalizar(entrada.texto)) && diceQueHizo(texto)) {
      texto = RESPUESTA_NO_GUARDADA;
      mensajesRespuesta = [{ role: "assistant", content: texto }];
    }
  } catch (error) {
    revertirEntrada(ctx, entrada.id);
    db.update(entradas).set({ estado: "error" }).where(eq(entradas.id, entrada.id)).run();
    throw new ErrorIA(error instanceof Error ? error.message : String(error));
  }

  // Si hizo algo y no espera respuesta, aprovecha para dar un dato que importa: que cruzó el 80% o el
  // 100% de un presupuesto, o si no, un cobro que viene. Si el iPhone ya recibió "Anotado", nadie lo va
  // a oír: el aviso del cobro se deja para el próximo dictado.
  const puedeAgregar = acciones.length > 0 && !texto.includes("?");
  const dato = puedeAgregar ? datoDePresupuesto(ctx, gastosNuevos(ctx, entrada.id)) : undefined;
  const hablaDeCobros = acciones.some((a) => a.herramienta.endsWith("_recurrente") || a.herramienta === "listar_recurrentes");
  // Con notificaciones, lo que no se oye llega en la notificación.
  const alguienLoVe = !enSegundoPlano.has(entrada.id) || !!deps.notificaSinEspera?.(usuarioId);
  const cobros = puedeAgregar && !dato && !hablaDeCobros && alguienLoVe ? cobrosPorAvisar(ctx, loQuePago(acciones)) : undefined;
  const hablado = limpiarParaVoz(sinPreguntasDeMas(texto)) || respuestaPorOmision(acciones);
  const extra = dato ?? cobros?.aviso;

  const respuesta: Respuesta = {
    respuesta: extra ? `${hablado} ${extra}` : hablado,
    conversacion_id: conversacionId,
    acciones,
    ...(dato ? { dato } : {}),
  };
  db.transaction((tx) => {
    for (const contenido of [mensajeUsuario, ...mensajesRespuesta]) {
      tx.insert(mensajes).values({ usuarioId, conversacionId, contenido }).run();
    }
    tx.update(entradas).set({ estado: "listo", respuesta }).where(eq(entradas.id, entrada.id)).run();
    // Con la respuesta guardada: si algo falla antes, el aviso se da en el próximo dictado.
    cobros?.marcar();
  });
  return respuesta;
}
