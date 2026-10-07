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
  usuario: { id: string; nombre: string };
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
