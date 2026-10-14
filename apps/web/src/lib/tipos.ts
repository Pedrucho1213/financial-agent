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
  /** Transferencias y pagos de tarjeta: a dónde llegó el dinero. Viejos servidores no lo mandan. */
  cuentaDestino?: string | null;
  etiquetas?: { id: string; nombre: string }[];
  lugar: string | null;
  lat: number | null;
  lon: number | null;
  origen: Origen;
  textoOriginal: string | null;
  revisar: boolean;
  /** Con cuentas y etiquetas (servidores nuevos). En una transferencia o pago, `cuenta` es de donde sale. */
  cuentaId?: string | null;
  cuentaDestinoId?: string | null;
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
  /** Si puede crear códigos para cuentas nuevas (por omisión, solo la cuenta dueña). Servidores anteriores no lo mandan. */
  puedeInvitar?: boolean;
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
  /** Servidores con cuentas: los mismos totales que /v1/cuentas. */
  cuentas?: TotalesCuentas;
  porEtiqueta?: { id: string; nombre: string; gastadoCentavos: number; ingresadoCentavos: number; cantidad: number; activa: boolean }[];
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
  /** Transferencias y pagos de tarjeta: a dónde llega (nombre). */
  cuenta_destino?: string | null;
  /** Ids de etiquetas; al editar, la lista completa. */
  etiquetas?: string[];
  fecha?: string;
};

// ------------------------------------------------------------------ Cuentas, tarjetas y etiquetas
// Todo en centavos de la moneda base. null es "no se sabe": nunca se muestra como 0.

/** Los del servidor: "con Mercado Pago" crea un monedero; "vales" unos vales. */
export type TipoCuenta = "efectivo" | "debito" | "credito" | "transferencia" | "vales" | "monedero" | "otra";

export type EstadoCuenta = {
  id: string;
  nombre: string;
  tipo: TipoCuenta;
  institucion: string | null;
  alias: string[];
  archivada: boolean;
  esCredito: boolean;
  /** Si alguna vez dijo cuánto hay (o cuánto debe). */
  conocido: boolean;
  /** Lo que tiene; en crédito, menos lo que debe. */
  saldoCentavos: number | null;
  /** Solo crédito: lo usado (negativo si hay saldo a favor). */
  deudaCentavos: number | null;
  /** Crédito: límite menos deuda. Débito: igual al saldo. */
  disponibleCentavos: number | null;
  limiteCentavos: number | null;
  /** Cuándo dijo el saldo (ISO). */
  saldoEn: string | null;
  diaCorte: number | null;
  diaPago: number | null;
};

export type CuentaConMes = EstadoCuenta & {
  mes: { entradaCentavos: number; salidaCentavos: number };
  /** Movimientos de los últimos 90 días con esta cuenta (falta en un servidor viejo). */
  usos?: number;
};

export type TotalesCuentas = {
  dineroCentavos: number;
  deudaCentavos: number;
  disponibleCreditoCentavos: number;
  limiteCreditoCentavos: number;
  netoCentavos: number;
  cuentasConSaldo: number;
  tarjetasConDeuda: number;
  /** Nombres de las cuentas de las que no se sabe el saldo. */
  sinSaldo: string[];
};

/** GET /v1/cuentas */
export type Cuentas = { cuentas: CuentaConMes[]; totales: TotalesCuentas; observacion: string | null };

/** GET /v1/cuentas/:id */
export type DetalleCuenta = { cuenta: EstadoCuenta; movimientos: MovimientoApp[]; totalMovimientos: number };

/** POST /v1/cuentas y PATCH /v1/cuentas/:id (montos en pesos). */
export type DatosCuenta = {
  nombre?: string;
  tipo?: TipoCuenta;
  saldo?: number;
  disponible?: number;
  deuda?: number;
  limite?: number | null;
  dia_corte?: number | null;
  dia_pago?: number | null;
  archivada?: boolean;
};

/** POST /v1/transferencias */
export type DatosMover = {
  tipo: "transferencia" | "pago_tarjeta" | "retiro";
  monto: number;
  desde_id?: string;
  hacia_id?: string;
  fecha?: string;
  descripcion?: string;
  etiquetas?: string[];
};

/** GET /v1/etiquetas. Una etiqueta activa se pone sola en los gastos de esos días. */
export type Etiqueta = {
  id: string;
  nombre: string;
  activaDesde: string | null;
  activaHasta: string | null;
  activa: boolean;
  cantidad: number;
  gastadoCentavos: number;
  ingresadoCentavos: number;
  ultimoUso: string | null;
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
/** Un préstamo o un abono de una deuda, con la cuenta de la que salió o a la que llegó, si la dijo. */
export type MovimientoDeuda = { tipo: "prestamo" | "abono"; fecha: string; montoCentavos: number; cuenta: string | null };
/** Una deuda por persona y sentido ("le debes a Mamá"), con todos sus préstamos y abonos juntos. */
export type DeudaPersona = {
  persona: string;
  direccion: "me_deben" | "debo";
  prestadoCentavos: number;
  pagadoCentavos: number;
  pendienteCentavos: number;
  desde: string;
  movimientos: MovimientoDeuda[];
};
// `personas` llega con la versión del servidor que trae el apartado de deudas.
export type Prestamos = { prestamos: Prestamo[]; meDebenCentavos: number; deboCentavos: number; personas?: DeudaPersona[] };

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

export type EstadoRecurrente = "activa" | "pausada" | "cancelada" | "archivada";
export type TipoRecurrente = "suscripcion" | "renta" | "servicio" | "prestamo" | "ingreso" | "otro";
export type Frecuencia = "semanal" | "quincenal" | "mensual" | "anual";

/** Una suscripción o pago fijo (GET /v1/recurrentes?todos=1). */
export type Recurrente = {
  id: string;
  nombre: string;
  tipo: TipoRecurrente;
  montoCentavos: number;
  moneda: string;
  frecuencia: Frecuencia;
  /** Día del mes (1-31); en semanal, día de la semana (1 lunes ... 7 domingo). */
  dia: number;
  /** Solo en anual (1-12). */
  mes: number | null;
  categoriaId: string | null;
  categoria: string | null;
  cuentaId: string | null;
  cuenta: string | null;
  estado: EstadoRecurrente;
  estadoEn: string | null;
  /** Solo de las activas. */
  proximoCobro: string | null;
  mensualCentavos: number;
  creadoEn: string;
  /** En su fecha se anota sola, sin preguntar (domiciliada). Falta en servidores viejos. */
  confirmarSolo?: boolean;
};

export type Recurrentes = { recurrentes: Recurrente[]; mensualCentavos: number; moneda: string };

export type DatosRecurrente = {
  nombre?: string;
  tipo?: TipoRecurrente;
  monto?: number;
  frecuencia?: Frecuencia;
  dia?: number;
  mes?: number | null;
  cuenta_id?: string | null;
  estado?: EstadoRecurrente;
  confirmar_solo?: boolean;
};
