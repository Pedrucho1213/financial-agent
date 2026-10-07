import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Todos los montos se guardan en centavos (enteros) para evitar errores de redondeo.
// Todas las tablas de datos llevan usuario_id: el sistema es multiusuario desde el inicio.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const creadoEn = () =>
  text("creado_en")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

export const usuarios = sqliteTable("usuarios", {
  id: id(),
  nombre: text("nombre").notNull(),
  creadoEn: creadoEn(),
  // Último día (YYYY-MM-DD) que el revisor nocturno buscó fugas para este usuario.
  revisadoPara: text("revisado_para"),
});

export const dispositivos = sqliteTable(
  "dispositivos",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    nombre: text("nombre").notNull(),
    tokenHash: text("token_hash").notNull(),
    creadoEn: creadoEn(),
    ultimoUso: text("ultimo_uso"),
    revocadoEn: text("revocado_en"),
  },
  (t) => [uniqueIndex("dispositivos_token_hash").on(t.tokenHash)],
);

// Código de 6 caracteres para entrar desde un dispositivo nuevo. Sin usuario_id es para
// alguien nuevo; con usuario_id agrega otro dispositivo a esa cuenta. Sirve una sola vez.
export const invitaciones = sqliteTable(
  "invitaciones",
  {
    id: id(),
    codigo: text("codigo").notNull(),
    usuarioId: text("usuario_id").references(() => usuarios.id),
    // Quién la generó (vacío si salió de la terminal de la Mac).
    creadaPor: text("creada_por").references(() => usuarios.id),
    expiraEn: text("expira_en").notNull(),
    usadaEn: text("usada_en"),
    dispositivoId: text("dispositivo_id"),
    creadoEn: creadoEn(),
  },
  (t) => [uniqueIndex("invitaciones_codigo").on(t.codigo)],
);

export const TIPOS_CUENTA = [
  "efectivo",
  "debito",
  "credito",
  "transferencia",
  "vales",
  "monedero",
  "otra",
] as const;

export const cuentas = sqliteTable("cuentas", {
  id: id(),
  usuarioId: text("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  nombre: text("nombre").notNull(),
  tipo: text("tipo", { enum: TIPOS_CUENTA }).notNull().default("otra"),
  institucion: text("institucion"),
  // Formas alternativas de nombrarla ("la Nu", "mi tarjeta oro"), como JSON.
  alias: text("alias", { mode: "json" }).$type<string[]>().notNull().default([]),
  diaCorte: integer("dia_corte"),
  diaPago: integer("dia_pago"),
  archivada: integer("archivada", { mode: "boolean" }).notNull().default(false),
  creadoEn: creadoEn(),
});

export const categorias = sqliteTable(
  "categorias",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    nombre: text("nombre").notNull(),
    padreId: text("padre_id"),
    tipo: text("tipo", { enum: ["gasto", "ingreso"] }).notNull(),
    // Para la regla 50/30/20: necesidad, gusto o ahorro.
    naturaleza: text("naturaleza", { enum: ["necesidad", "gusto", "ahorro"] }),
    creadoEn: creadoEn(),
  },
  (t) => [index("categorias_usuario").on(t.usuarioId)],
);

export const comercios = sqliteTable(
  "comercios",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    nombre: text("nombre").notNull(),
    nombreNormalizado: text("nombre_normalizado").notNull(),
    // Categoría que suele llevar; se aprende de las correcciones.
    categoriaId: text("categoria_id"),
    creadoEn: creadoEn(),
  },
  (t) => [uniqueIndex("comercios_usuario_nombre").on(t.usuarioId, t.nombreNormalizado)],
);

export const TIPOS_MOVIMIENTO = ["gasto", "ingreso", "transferencia", "pago_tarjeta"] as const;

export const movimientos = sqliteTable(
  "movimientos",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    tipo: text("tipo", { enum: TIPOS_MOVIMIENTO }).notNull(),
    montoCentavos: integer("monto_centavos").notNull(),
    moneda: text("moneda").notNull().default("MXN"),
    categoriaId: text("categoria_id"),
    comercioId: text("comercio_id"),
    cuentaId: text("cuenta_id"),
    cuentaDestinoId: text("cuenta_destino_id"),
    descripcion: text("descripcion"),
    // Fecha local del usuario (YYYY-MM-DD), usada para agrupar por día y mes.
    fecha: text("fecha").notNull(),
    // Momento exacto en UTC.
    ocurridoEn: text("ocurrido_en").notNull(),
    lat: real("lat"),
    lon: real("lon"),
    lugar: text("lugar"),
    origen: text("origen", { enum: ["voz", "app", "apple_pay", "importacion"] })
      .notNull()
      .default("voz"),
    textoOriginal: text("texto_original"),
    entradaId: text("entrada_id"),
    recurrenteId: text("recurrente_id"),
    msiId: text("msi_id"),
    // La IA no estaba segura (por ejemplo, de la categoría).
    revisar: integer("revisar", { mode: "boolean" }).notNull().default(false),
    creadoEn: creadoEn(),
    actualizadoEn: text("actualizado_en"),
    eliminadoEn: text("eliminado_en"),
  },
  (t) => [
    index("movimientos_usuario_fecha").on(t.usuarioId, t.fecha),
    index("movimientos_entrada").on(t.entradaId),
  ],
);

export const FRECUENCIAS = ["semanal", "quincenal", "mensual", "anual"] as const;
export const TIPOS_RECURRENTE = [
  "suscripcion",
  "renta",
  "servicio",
  "prestamo",
  "ingreso",
  "otro",
] as const;

export const recurrentes = sqliteTable("recurrentes", {
  id: id(),
  usuarioId: text("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  nombre: text("nombre").notNull(),
  tipo: text("tipo", { enum: TIPOS_RECURRENTE }).notNull(),
  montoCentavos: integer("monto_centavos").notNull(),
  moneda: text("moneda").notNull().default("MXN"),
  frecuencia: text("frecuencia", { enum: FRECUENCIAS }).notNull(),
  // Día del mes (1-31); en semanal, día de la semana (1 = lunes ... 7 = domingo).
  dia: integer("dia").notNull(),
  // Solo para frecuencia anual (1-12).
  mes: integer("mes"),
  categoriaId: text("categoria_id"),
  cuentaId: text("cuenta_id"),
  avisarDiasAntes: integer("avisar_dias_antes").notNull().default(1),
  // El cobro (YYYY-MM-DD) del que la IA ya avisó, para no repetirlo en cada dictado.
  avisadoPara: text("avisado_para"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  entradaId: text("entrada_id"),
  creadoEn: creadoEn(),
  eliminadoEn: text("eliminado_en"),
});

// Compras a meses sin intereses.
export const comprasMsi = sqliteTable("compras_msi", {
  id: id(),
  usuarioId: text("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  descripcion: text("descripcion").notNull(),
  totalCentavos: integer("total_centavos").notNull(),
  meses: integer("meses").notNull(),
  mensualidadCentavos: integer("mensualidad_centavos").notNull(),
  primerCargo: text("primer_cargo").notNull(),
  cuentaId: text("cuenta_id"),
  creadoEn: creadoEn(),
  eliminadoEn: text("eliminado_en"),
});

// Límite mensual de gasto de una categoría (si es principal, incluye sus subcategorías).
export const presupuestos = sqliteTable("presupuestos", {
  id: id(),
  usuarioId: text("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  categoriaId: text("categoria_id").notNull(),
  limiteCentavos: integer("limite_centavos").notNull(),
  creadoEn: creadoEn(),
  eliminadoEn: text("eliminado_en"),
});

export const metas = sqliteTable("metas", {
  id: id(),
  usuarioId: text("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  nombre: text("nombre").notNull(),
  objetivoCentavos: integer("objetivo_centavos").notNull(),
  ahorradoCentavos: integer("ahorrado_centavos").notNull().default(0),
  fechaLimite: text("fecha_limite"),
  creadoEn: creadoEn(),
  eliminadoEn: text("eliminado_en"),
});

// Dinero prestado entre personas ("le presté 500 a Juan").
export const prestamosPersonales = sqliteTable("prestamos_personales", {
  id: id(),
  usuarioId: text("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  persona: text("persona").notNull(),
  direccion: text("direccion", { enum: ["me_deben", "debo"] }).notNull(),
  montoCentavos: integer("monto_centavos").notNull(),
  // Lo que ya se devolvió en abonos ("Juan me pagó 200").
  pagadoCentavos: integer("pagado_centavos").notNull().default(0),
  descripcion: text("descripcion"),
  saldadoEn: text("saldado_en"),
  creadoEn: creadoEn(),
  eliminadoEn: text("eliminado_en"),
});

// Datos que la IA debe recordar ("mi quincena llega el 15 y el último día").
export const memorias = sqliteTable("memorias", {
  id: id(),
  usuarioId: text("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  texto: text("texto").notNull(),
  creadoEn: creadoEn(),
});

// Cada cosa que el usuario dice. client_id lo genera el iPhone y evita duplicados
// cuando la cola sin conexión reenvía el mismo dictado.
export const entradas = sqliteTable(
  "entradas",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    clientId: text("client_id").notNull(),
    conversacionId: text("conversacion_id").notNull(),
    texto: text("texto").notNull(),
    lat: real("lat"),
    lon: real("lon"),
    lugar: text("lugar"),
    capturadoEn: text("capturado_en").notNull(),
    estado: text("estado", { enum: ["procesando", "listo", "error"] })
      .notNull()
      .default("procesando"),
    respuesta: text("respuesta", { mode: "json" }).$type<unknown>(),
    creadoEn: creadoEn(),
  },
  (t) => [uniqueIndex("entradas_usuario_client").on(t.usuarioId, t.clientId)],
);

// Historial de conversación para que la IA entienda "¿y en Uber?" después de otra pregunta.
export const mensajes = sqliteTable(
  "mensajes",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    conversacionId: text("conversacion_id").notNull(),
    // ModelMessage del AI SDK, como JSON.
    contenido: text("contenido", { mode: "json" }).$type<unknown>().notNull(),
    creadoEn: creadoEn(),
  },
  (t) => [index("mensajes_conversacion").on(t.usuarioId, t.conversacionId)],
);

export const TABLAS_BITACORA = [
  "movimientos",
  "recurrentes",
  "presupuestos",
  "metas",
  "prestamos_personales",
  "compras_msi",
] as const;

// Bitácora de cambios: permite deshacer cualquier cosa que hizo la IA.
export const bitacora = sqliteTable(
  "bitacora",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    entradaId: text("entrada_id"),
    tabla: text("tabla", { enum: TABLAS_BITACORA }).notNull(),
    registroId: text("registro_id").notNull(),
    accion: text("accion", { enum: ["crear", "editar", "eliminar"] }).notNull(),
    antes: text("antes", { mode: "json" }).$type<Record<string, unknown>>(),
    despues: text("despues", { mode: "json" }).$type<Record<string, unknown>>(),
    creadoEn: creadoEn(),
    deshechoEn: text("deshecho_en"),
    // La entrada que lo deshizo ("deshaz eso"): si esa entrada falla y se reintenta, se rehace.
    deshechoPor: text("deshecho_por"),
  },
  (t) => [index("bitacora_usuario").on(t.usuarioId, t.creadoEn)],
);

export const TIPOS_AVISO = [
  "hormiga",
  "suscripcion_olvidada",
  "suscripcion_duplicada",
  "cobro_proximo",
  "presupuesto",
  "meta",
  "msi",
  "prestamo",
  "gasto_inusual",
] as const;

// Lo que el revisor nocturno encontró (fugas, cobros que vienen, presupuestos en riesgo). El push y
// el Atajo los entregan; `clave` evita guardar dos veces el mismo hallazgo.
export const avisos = sqliteTable(
  "avisos",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    tipo: text("tipo", { enum: TIPOS_AVISO }).notNull(),
    clave: text("clave").notNull(),
    titulo: text("titulo").notNull(),
    texto: text("texto").notNull(),
    // Día del aviso y último día en que aplica (YYYY-MM-DD).
    fecha: text("fecha").notNull(),
    vence: text("vence"),
    // 1 alta, 2 media, 3 baja.
    prioridad: integer("prioridad").notNull().default(2),
    // Ruta de la app que muestra el detalle.
    enlace: text("enlace"),
    creadoEn: creadoEn(),
    enviadoEn: text("enviado_en"),
    dichoEn: text("dicho_en"),
    leidoEn: text("leido_en"),
    descartadoEn: text("descartado_en"),
  },
  (t) => [uniqueIndex("avisos_usuario_clave").on(t.usuarioId, t.clave), index("avisos_usuario_fecha").on(t.usuarioId, t.fecha)],
);
