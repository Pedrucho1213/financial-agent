// Tipos de la API (docs/api.md). Montos en centavos salvo `monto`.

export type TipoMovimiento = "gasto" | "ingreso" | "transferencia" | "pago_tarjeta";
export type Origen = "voz" | "app" | "apple_pay" | "importacion";

export type MovimientoApp = {
  id: string;
  fecha: string;
  ocurridoEn: string;
  tipo: TipoMovimiento;
  montoCentavos: number;
  monto: string;
  moneda: string;
  categoriaId: string | null;
  categoria: string | null;
  comercio: string | null;
  descripcion: string | null;
  cuenta: string | null;
  lugar: string | null;
  lat: number | null;
  lon: number | null;
  origen: Origen;
  textoOriginal: string | null;
  revisar: boolean;
};

export type Categoria = {
  id: string;
  nombre: string;
  nombreCompleto: string;
  padreId: string | null;
  tipo: "gasto" | "ingreso";
  naturaleza: "necesidad" | "gusto" | "ahorro" | null;
};

export type Invitacion = { para: "usuario" | "dispositivo"; nombre?: string };

export type Registro = {
  token: string;
  usuario: { id: string; nombre: string };
  dispositivo: { id: string; nombre: string };
};

export type Dispositivo = {
  id: string;
  nombre: string;
  creadoEn: string;
  ultimoUso: string | null;
  actual: boolean;
};

export type Yo = {
  /** `usuario` y `tieneCodigo` llegan con el servidor que permite entrar con usuario y código. */
  usuario: { id: string; nombre: string; usuario?: string; tieneCodigo?: boolean };
  dispositivo: { id: string; nombre: string };
  dispositivos: Dispositivo[];
  moneda: string;
  zonaHoraria: string;
  hoy: string;
};

export type InvitacionCreada = { codigo: string; para: "usuario" | "dispositivo"; expiraEn: string };

/** POST /v1/atajo: el archivo firmado queda unos minutos en `url` (relativa). */
export type AtajoPreparado = { url: string; expiraEn: string };

/** POST /v1/atajo/canjear: igual, con el nombre de la cuenta dueña del código. */
export type AtajoCanjeado = AtajoPreparado & { nombre: string };

export type Tablero = {
  mes: string;
  hoy: string;
  moneda: string;
  totales: {
    gastadoCentavos: number;
    ingresadoCentavos: number;
    balanceCentavos: number;
    gastadoHoyCentavos: number;
    cantidadGastos: number;
    gastadoMesAnteriorCentavos: number;
    gastadoMesAnteriorMismaFechaCentavos: number;
  };
  porCategoria: { categoriaId: string | null; nombre: string; centavos: number; cantidad: number }[];
  porMes: { mes: string; gastadoCentavos: number; ingresadoCentavos: number }[];
  porDiaSemana: { dia: number; centavos: number }[];
  mayores: MovimientoApp[];
  frecuentes: { nombre: string; cantidad: number; centavos: number }[];
  recurrentesProximos: {
    id: string;
    nombre: string;
    tipo?: string;
    montoCentavos: number;
    moneda: string;
    proximoCobro: string;
    frecuencia: string;
  }[];
  porRevisar: number;
};

export type Accion = { herramienta: string; argumentos?: unknown; resultado?: unknown };

export type RespuestaHablar = {
  respuesta: string;
  conversacion_id: string;
  acciones: Accion[];
  duplicado?: boolean;
  pendiente?: boolean;
  esperar?: boolean;
};

export type EstadoEntrada = {
  estado: "procesando" | "listo" | "error";
  respuesta?: string;
  conversacion_id?: string;
  acciones?: Accion[];
};

export type DatosMovimiento = {
  tipo?: TipoMovimiento;
  monto?: number;
  moneda?: string;
  categoria_id?: string | null;
  comercio?: string | null;
  descripcion?: string | null;
  cuenta?: string | null;
  fecha?: string;
};

/** GET /v1/presupuestos?mes= (contrato acordado con el hilo de la IA; ver docs/api.md). */
export type Presupuesto = {
  id: string;
  /** null = tope para todo el gasto del mes. */
  categoriaId: string | null;
  /** "General" (sin categoría), "Comida" o "Comida > Café". Uno de una principal incluye sus subcategorías. */
  categoria: string | null;
  limiteCentavos: number;
  gastadoCentavos: number;
  restanteCentavos: number;
  /** Entero; pasa de 100 si se excedió. */
  porcentaje: number;
  /** Lo que se gastaría al cierre del mes al ritmo actual. */
  proyeccionCentavos: number;
  estado: "bien" | "cerca" | "excedido";
};
export type Presupuestos = {
  mes: string;
  hoy: string;
  diasDelMes: number;
  diaDelMes: number;
  presupuestos: Presupuesto[];
  total: { limiteCentavos: number; gastadoCentavos: number };
};

/** GET /v1/metas */
export type Meta = {
  id: string;
  nombre: string;
  objetivoCentavos: number;
  ahorradoCentavos: number;
  porcentaje: number;
  fechaLimite: string | null;
  /** Cuánto apartar al mes para llegar a tiempo; null sin fecha. */
  mensualSugeridoCentavos: number | null;
  completada: boolean;
};
export type Metas = { metas: Meta[] };

/** GET /v1/disponible: "¿cuánto puedo gastar hoy?". base null = no hay con qué calcularlo. */
export type Disponible = {
  hoy: string;
  diasRestantes: number;
  porDiaCentavos: number;
  disponibleHoyCentavos: number;
  libreMesCentavos: number;
  /** "saldos": sin ingresos ni presupuestos, pero con lo que tiene en sus cuentas. */
  base: "ingresos" | "presupuestos" | "saldos" | null;
  ingresosCentavos: number;
  gastadoCentavos: number;
  comprometidoCentavos: number;
};

/** GET /v1/prestamos */
export type Prestamo = {
  id: string;
  persona: string;
  direccion: "me_deben" | "debo";
  montoCentavos: number;
  pagadoCentavos: number;
  pendienteCentavos: number;
  descripcion: string | null;
  creadoEn: string;
  saldadoEn: string | null;
};
export type Prestamos = { prestamos: Prestamo[]; meDebenCentavos: number; deboCentavos: number };

/** GET /v1/msi: compras a meses sin intereses. */
export type CompraMsi = {
  id: string;
  descripcion: string;
  totalCentavos: number;
  meses: number;
  mensualidadCentavos: number;
  /** El próximo cargo: la última mensualidad absorbe el redondeo. Viejos servidores no lo mandan. */
  proximoMontoCentavos?: number | null;
  primerCargo: string;
  pagadas: number;
  restanteCentavos: number;
  proximoCargo: string | null;
  cuenta: string | null;
};
export type ComprasMsi = { compras: CompraMsi[]; mensualCentavos: number };

/** GET /v1/avisos: lo que encontró el revisor nocturno (fugas, cobros próximos, presupuestos). */
export type Aviso = {
  id: string;
  tipo:
    | "hormiga"
    | "suscripcion_olvidada"
    | "suscripcion_duplicada"
    | "cobro_proximo"
    | "presupuesto"
    | "meta"
    | "msi"
    | "prestamo"
    | "gasto_inusual"
    | "tarjeta_pago"
    | "tarjeta_limite";
  titulo: string;
  texto: string;
  fecha: string;
  vence: string | null;
  /** 1 = alta. */
  prioridad: 1 | 2 | 3;
  /** Pantalla de la app: "#movimientos?texto=Starbucks", "#presupuestos", "#metas"… */
  enlace: string | null;
  leidoEn: string | null;
};
