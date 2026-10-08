// Cuentas y tarjetas con su saldo real. El usuario dice cuánto tiene ("tengo 20 mil en Revolut", "en la Nu
// tengo 7 mil disponibles de 30 mil"); eso queda como punto de partida y el saldo de hoy es ese más todo lo
// que se movió después: gastos, ingresos, transferencias, pagos de tarjeta y compras a meses. Sin punto de
// partida el saldo no se conoce y no se inventa (antes salía negativo porque no sabía cuánto había).
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { comprasMsi, cuentas, movimientos, TIPOS_CUENTA } from "../db/schema";
import { aCentavos, formatearMonto } from "../lib/dinero";
import { fechaLocal, mediodiaUtc } from "../lib/fechas";
import { montosDelTexto } from "../lib/numeros";
import { normalizar } from "../lib/texto";
import { type Cuenta, encontrarOCrearCuenta, enLista, inferirTipoCuenta } from "./catalogos";
import type { Contexto } from "./contexto";
import { cambioDeCuenta, crearMovimiento, ErrorFinanzas, registrarEnBitacora } from "./movimientos";

export type TipoCuenta = (typeof TIPOS_CUENTA)[number];

export type EstadoCuenta = {
  id: string;
  nombre: string;
  tipo: TipoCuenta;
  institucion: string | null;
  alias: string[];
  archivada: boolean;
  esCredito: boolean;
  /** Si se sabe cuánto hay (o cuánto se debe): el usuario lo dijo alguna vez. */
  conocido: boolean;
  /** Lo que tiene. En una tarjeta de crédito es menos lo que debe (-3,000 si debe 3,000). */
  saldoCentavos: number | null;
  /** Solo tarjetas de crédito: lo que debe (negativo si tiene saldo a favor). */
  deudaCentavos: number | null;
  /** Tarjetas de crédito: lo que todavía puede usar. En las demás, lo mismo que el saldo. */
  disponibleCentavos: number | null;
  limiteCentavos: number | null;
  /** Cuándo dijo el saldo por última vez. */
  saldoEn: string | null;
  diaCorte: number | null;
  diaPago: number | null;
};

const $ = (ctx: Contexto, centavos: number) => formatearMonto(centavos, ctx.monedaBase);

/** Cómo cambia el saldo de cada cuenta por un movimiento: sale de `cuentaId` y llega a `cuentaDestinoId`. */
function efectoDe(m: Pick<typeof movimientos.$inferSelect, "tipo" | "montoCentavos">): { origen: number; destino: number } {
  switch (m.tipo) {
    case "ingreso":
      return { origen: m.montoCentavos, destino: 0 };
    case "gasto":
      return { origen: -m.montoCentavos, destino: 0 };
    default:
      // Transferencia o pago de tarjeta: sale de una y llega a la otra (en la tarjeta baja la deuda).
      return { origen: -m.montoCentavos, destino: m.montoCentavos };
  }
}

/**
 * Lo que se movió en cada cuenta después de que el usuario dijo su saldo. Las mensualidades de una compra a
 * meses no cuentan: la tarjeta ya apartó la compra completa el día que se hizo.
 * Solo cuenta lo que está en la moneda base: no se sabe a cuánto se cobró un gasto en dólares.
 */
function movidoDesdeElSaldo(ctx: Contexto, lista: Cuenta[]): Map<string, number> {
  const conSaldo = lista.filter((c) => c.saldoEn);
  const movido = new Map<string, number>();
  if (!conSaldo.length) return movido;
  const desde = new Map(conSaldo.map((c) => [c.id, c.saldoEn!]));
  const ids = [...desde.keys()];
  const sumar = (id: string | null, centavos: number, momento: string) => {
    if (!id || !centavos) return;
    const ancla = desde.get(id);
    if (!ancla || momento <= ancla) return;
    movido.set(id, (movido.get(id) ?? 0) + centavos);
  };
  const filas = ctx.db
    .select()
    .from(movimientos)
    .where(
      and(
        eq(movimientos.usuarioId, ctx.usuarioId),
        isNull(movimientos.eliminadoEn),
        isNull(movimientos.msiId),
        eq(movimientos.moneda, ctx.monedaBase),
        or(inArray(movimientos.cuentaId, ids), inArray(movimientos.cuentaDestinoId, ids)),
      ),
    )
    .all();
  for (const m of filas) {
    const efecto = efectoDe(m);
    sumar(m.cuentaId, efecto.origen, m.ocurridoEn);
    if (m.cuentaDestinoId !== m.cuentaId) sumar(m.cuentaDestinoId, efecto.destino, m.ocurridoEn);
  }
  const compras = ctx.db
    .select()
    .from(comprasMsi)
    .where(and(eq(comprasMsi.usuarioId, ctx.usuarioId), isNull(comprasMsi.eliminadoEn), inArray(comprasMsi.cuentaId, ids)))
    .all();
  // La compra cuenta desde el día en que se hizo, no desde que se anotó: si se anota tarde, ya venía en el
  // saldo que dijo después de comprar.
  for (const c of compras) {
    const momento = fechaLocal(new Date(c.creadoEn), ctx.zonaHoraria) === c.primerCargo ? c.creadoEn : mediodiaUtc(c.primerCargo, ctx.zonaHoraria);
    sumar(c.cuentaId, -c.totalCentavos, momento);
  }
  return movido;
}

function estadoDe(c: Cuenta, movido: number): EstadoCuenta {
  const esCredito = c.tipo === "credito";
  const conocido = c.saldoEn !== null && c.saldoCentavos !== null;
  let saldo: number | null = null;
  let deuda: number | null = null;
  let disponible: number | null = null;
  if (conocido && esCredito && c.saldoTipo === "disponible") {
    disponible = c.saldoCentavos! + movido;
    if (c.limiteCentavos !== null) {
      deuda = c.limiteCentavos - disponible;
      saldo = -deuda || 0;
    }
  } else if (conocido) {
    saldo = c.saldoCentavos! + movido;
    if (esCredito) {
      deuda = -saldo || 0;
      disponible = c.limiteCentavos !== null ? c.limiteCentavos + saldo : null;
    } else {
      disponible = saldo;
    }
  }
  return {
    id: c.id,
    nombre: c.nombre,
    tipo: c.tipo,
    institucion: c.institucion,
    alias: c.alias,
    archivada: c.archivada,
    esCredito,
    conocido,
    saldoCentavos: saldo,
    deudaCentavos: deuda,
    disponibleCentavos: disponible,
    limiteCentavos: c.limiteCentavos,
    saldoEn: c.saldoEn,
    diaCorte: c.diaCorte,
    diaPago: c.diaPago,
  };
}

function cuentasDelUsuario(ctx: Contexto): Cuenta[] {
  return ctx.db.select().from(cuentas).where(eq(cuentas.usuarioId, ctx.usuarioId)).all();
}

/** El estado de todas las cuentas (las archivadas solo con `archivadas`). */
export function estadosDeCuentas(ctx: Contexto, opciones: { archivadas?: boolean } = {}): EstadoCuenta[] {
  const lista = cuentasDelUsuario(ctx).filter((c) => opciones.archivadas || !c.archivada);
  const movido = movidoDesdeElSaldo(ctx, lista);
  return lista.map((c) => estadoDe(c, movido.get(c.id) ?? 0));
}

export function estadoDeCuenta(ctx: Contexto, cuentaId: string): EstadoCuenta {
  const c = cuentasDelUsuario(ctx).find((x) => x.id === cuentaId);
  if (!c) throw new ErrorFinanzas("No existe esa cuenta.");
  return estadoDe(c, movidoDesdeElSaldo(ctx, [c]).get(c.id) ?? 0);
}

/** Lo que suma todo: el dinero en cuentas, lo que debe en tarjetas y lo que le queda de crédito. */
export function totalesDeCuentas(estados: EstadoCuenta[]) {
  const debito = estados.filter((e) => !e.esCredito && e.saldoCentavos !== null);
  const credito = estados.filter((e) => e.esCredito);
  const suma = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  return {
    dineroCentavos: suma(debito.map((e) => e.saldoCentavos)),
    deudaCentavos: suma(credito.map((e) => (e.deudaCentavos !== null && e.deudaCentavos > 0 ? e.deudaCentavos : 0))),
    disponibleCreditoCentavos: suma(credito.map((e) => e.disponibleCentavos)),
    limiteCreditoCentavos: suma(credito.map((e) => e.limiteCentavos)),
    /** Patrimonio líquido: lo que tiene menos lo que debe en tarjetas. */
    netoCentavos: suma(debito.map((e) => e.saldoCentavos)) - suma(credito.map((e) => e.deudaCentavos)),
    cuentasConSaldo: debito.length,
    tarjetasConDeuda: credito.filter((e) => e.deudaCentavos !== null).length,
    sinSaldo: estados.filter((e) => !e.conocido).map((e) => e.nombre),
  };
}

/** "Revolut: $20,000", "Nu: debes $3,000 y te quedan $27,000 disponibles". */
export function describirSaldo(ctx: Contexto, e: EstadoCuenta): string {
  if (!e.conocido) return `de ${e.nombre} no sé cuánto tienes`;
  if (!e.esCredito) return `${e.nombre} tiene ${$(ctx, e.saldoCentavos!)}`;
  const partes: string[] = [];
  if (e.deudaCentavos !== null) {
    partes.push(e.deudaCentavos > 0 ? `debes ${$(ctx, e.deudaCentavos)}` : e.deudaCentavos < 0 ? `tienes ${$(ctx, -e.deudaCentavos)} a favor` : "no debes nada");
  }
  if (e.disponibleCentavos !== null) {
    const deCuanto = e.limiteCentavos !== null ? ` de ${$(ctx, e.limiteCentavos)}` : "";
    partes.push(e.disponibleCentavos >= 0 ? `te quedan ${$(ctx, e.disponibleCentavos)} disponibles${deCuanto}` : `te pasaste del límite por ${$(ctx, -e.disponibleCentavos)}`);
  }
  return `en ${e.nombre} ${enLista(partes)}`;
}

// ------------------------------------------------------------------ Decir cuánto hay

export type DatosCuenta = {
  cuenta: string;
  /** La app la elige de una lista: con el id no hace falta adivinar por el nombre. */
  id?: string;
  tipo?: TipoCuenta;
  /** Dinero que tiene (débito, efectivo). */
  saldo?: number;
  /** Tarjeta de crédito: lo que todavía puede gastar. */
  disponible?: number;
  /** Tarjeta de crédito: lo que debe ("tengo ocupados 5 mil"). */
  deuda?: number;
  /** Tarjeta de crédito: su límite (null lo quita, desde la app). */
  limite?: number | null;
  diaCorte?: number | null;
  diaPago?: number | null;
  nuevoNombre?: string;
};

const montoValido = (monto: number | undefined, que: string, puedeSerNegativo = false) => {
  if (monto === undefined) return undefined;
  if (!Number.isFinite(monto) || Math.abs(monto) > 1e10) throw new ErrorFinanzas(`${que} no es válido.`);
  if (!puedeSerNegativo && monto < 0) throw new ErrorFinanzas(`${que} no puede ser negativo.`);
  return aCentavos(monto);
};
const diaValido = (dia: number | undefined, que: string) => {
  if (dia === undefined) return undefined;
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new ErrorFinanzas(`El día de ${que} debe estar entre 1 y 31.`);
  return dia;
};

/**
 * Lo que el usuario dice de una cuenta: cuánto tiene, el límite o la deuda de una tarjeta, su día de corte o
 * de pago, su tipo o su nombre. El saldo dicho queda como punto de partida desde este momento. Se crea la
 * cuenta si no existe. Todo va a la bitácora: "deshaz eso" lo regresa.
 */
export function fijarCuenta(ctx: Contexto, datos: DatosCuenta): { estado: EstadoCuenta; nueva: boolean; dijo: string[] } {
  let saldo = montoValido(datos.saldo, "El saldo", true);
  let disponible = montoValido(datos.disponible, "El disponible", true);
  const deuda = montoValido(datos.deuda, "La deuda", true);
  const limite = datos.limite === null ? null : montoValido(datos.limite, "El límite");
  const diaCorte = datos.diaCorte === null ? null : diaValido(datos.diaCorte, "corte");
  const diaPago = datos.diaPago === null ? null : diaValido(datos.diaPago, "pago");
  const previas = new Map(cuentasDelUsuario(ctx).map((c) => [c.id, c]));
  const plano = normalizar(ctx.textoOriginal ?? "");
  // Límite, deuda, corte y pago son de tarjeta de crédito. "Tengo 7 mil disponibles en BBVA" también se dice
  // de una de débito: "disponible" solo dice crédito si la cuenta ya lo es o la frase lo dice.
  const diceCredito = inferirTipoCuenta(datos.cuenta) === "credito" || datos.tipo === "credito" || /\b(credito|tdc)\b/.test(plano);
  const deCredito = deuda !== undefined || !!limite || !!diaCorte || !!diaPago || (disponible !== undefined && diceCredito);
  // "La tarjeta de crédito" a secas: la única que tenga; si tiene varias, que diga cuál.
  const texto = deCredito && inferirTipoCuenta(datos.cuenta) === "otra" && /^(la |mi )?(tarjeta|tdc)$/i.test(datos.cuenta.trim()) ? `${datos.cuenta} de crédito` : datos.cuenta;
  const encontrada = datos.id ? previas.get(datos.id) : encontrarOCrearCuenta(ctx.db, ctx.usuarioId, texto, { siAmbigua: "error" });
  if (!encontrada) throw new ErrorFinanzas("¿De qué cuenta o tarjeta?");
  const nueva = !previas.has(encontrada.id);
  // encontrarOCrearCuenta pudo ponerle tipo o desarchivarla: el "antes" de la bitácora es como estaba.
  const antes = previas.get(encontrada.id);
  const cambios: Partial<Cuenta> = {};
  if (antes?.archivada && !encontrada.archivada) cambios.archivada = false;
  let tipo = datos.tipo ?? encontrada.tipo;
  if (tipo !== "credito" && !deCredito && disponible !== undefined && saldo === undefined) [saldo, disponible] = [disponible, undefined];
  // En una tarjeta, "tengo 7 mil en la Invex" es lo disponible; "tengo un saldo de 3 mil" o "debo 3 mil", la deuda.
  if ((tipo === "credito" || deCredito) && saldo !== undefined && disponible === undefined && deuda === undefined) {
    const diceDeuda = /\b(debo|deuda|adeudo|ocupad[oa]s?|usad[oa]s?|saldo|gastad[oa]s?|corte)\b/.test(plano);
    if (!diceDeuda && /\b(disponibles?|tengo|me quedan?|libres?|traigo)\b/.test(plano)) [disponible, saldo] = [saldo, undefined];
  }
  // Límite, deuda o disponible solo los tiene una tarjeta de crédito.
  if (deCredito && tipo !== "credito") {
    if (datos.tipo && datos.tipo !== "credito") throw new ErrorFinanzas(`Límite, deuda y disponible son de tarjetas de crédito, y ${encontrada.nombre} es de ${datos.tipo}.`);
    tipo = "credito";
  }
  if (tipo !== encontrada.tipo || (antes && tipo !== antes.tipo)) cambios.tipo = tipo;
  if (datos.nuevoNombre?.trim()) {
    const otro = cuentasDelUsuario(ctx).find((c) => c.id !== encontrada.id && !c.archivada && normalizar(c.nombre) === normalizar(datos.nuevoNombre!));
    if (otro) throw new ErrorFinanzas(`Ya tienes una cuenta llamada ${otro.nombre}.`);
    cambios.nombre = datos.nuevoNombre.trim().slice(0, 60);
  }
  if (diaCorte !== undefined) cambios.diaCorte = diaCorte;
  if (diaPago !== undefined) cambios.diaPago = diaPago;

  // El estado de hoy antes de cambiar nada: con él se traduce lo que dijo a un punto de partida nuevo.
  const ahora = ctx.ahoraIso;
  const actual = estadoDe({ ...encontrada, tipo }, movidoDesdeElSaldo(ctx, [encontrada]).get(encontrada.id) ?? 0);
  const esCredito = tipo === "credito";
  if (limite === null) cambios.limiteCentavos = null;
  if (limite !== undefined && limite !== null && esCredito) {
    cambios.limiteCentavos = limite;
    // Se sabía lo disponible pero no el límite: con el límite, la deuda ya se conoce.
    if (actual.conocido && encontrada.saldoTipo === "disponible" && disponible === undefined && deuda === undefined && saldo === undefined) {
      Object.assign(cambios, { saldoCentavos: actual.disponibleCentavos! - limite, saldoTipo: "saldo", saldoEn: ahora });
    }
  }
  const limiteFinal = cambios.limiteCentavos !== undefined ? cambios.limiteCentavos : encontrada.limiteCentavos;
  if (esCredito) {
    // En una tarjeta, "tengo un saldo de 3 mil" casi siempre es lo que debe.
    const debe = deuda ?? (saldo !== undefined && disponible === undefined ? saldo : undefined);
    if (debe !== undefined) Object.assign(cambios, { saldoCentavos: -debe, saldoTipo: "saldo", saldoEn: ahora });
    else if (disponible !== undefined) {
      Object.assign(
        cambios,
        limiteFinal !== null
          ? { saldoCentavos: disponible - limiteFinal, saldoTipo: "saldo", saldoEn: ahora }
          : { saldoCentavos: disponible, saldoTipo: "disponible", saldoEn: ahora },
      );
    }
  } else if (saldo !== undefined) {
    Object.assign(cambios, { saldoCentavos: saldo, saldoTipo: "saldo", saldoEn: ahora });
  }
  // Pasó de crédito a débito (o al revés): el punto de partida anterior ya no significa lo mismo.
  const tipoAntes = antes?.tipo ?? encontrada.tipo;
  if (tipo !== tipoAntes && encontrada.saldoEn && cambios.saldoEn === undefined && (tipo === "credito") !== (tipoAntes === "credito")) {
    Object.assign(cambios, { saldoCentavos: null, saldoTipo: null, saldoEn: null });
  }
  if (!nueva && Object.keys(cambios).length === 0) {
    return { estado: actual, nueva, dijo: [] };
  }
  const despues = Object.keys(cambios).length
    ? ctx.db.update(cuentas).set(cambios).where(eq(cuentas.id, encontrada.id)).returning().get()!
    : encontrada;
  if (nueva) registrarEnBitacora(ctx, "cuentas", despues.id, "crear", undefined, despues);
  else registrarEnBitacora(ctx, "cuentas", despues.id, "editar", antes, despues);
  const dijo = Object.keys(cambios);
  return { estado: estadoDeCuenta(ctx, despues.id), nueva, dijo };
}

/** "Listo, Revolut tiene $20,000 y Bancomer $10,000." */
export function confirmarCuentas(ctx: Contexto, resultados: ReturnType<typeof fijarCuenta>[]): string {
  const partes = resultados.map(({ estado: e, dijo, nueva }) => {
    const saldoNuevo = dijo.includes("saldoEn") || dijo.includes("limiteCentavos");
    const datos: string[] = [];
    if (saldoNuevo || (nueva && e.conocido)) datos.push(describirSaldo(ctx, e));
    if (dijo.includes("diaCorte") && e.diaCorte) datos.push(`${e.nombre} corta el día ${e.diaCorte}`);
    if (dijo.includes("diaPago") && e.diaPago) datos.push(`${e.nombre} se paga el día ${e.diaPago}`);
    if (dijo.includes("nombre")) datos.push(`la cuenta ahora se llama ${e.nombre}`);
    if (!datos.length && dijo.includes("tipo")) datos.push(`${e.nombre} quedó como ${NOMBRE_TIPO[e.tipo]}`);
    if (!datos.length) datos.push(nueva ? `agregué ${e.nombre}` : `${e.nombre} ya estaba así`);
    return enLista(datos);
  });
  return `Listo, ${enLista(partes)}.`;
}

export const NOMBRE_TIPO: Record<TipoCuenta, string> = {
  efectivo: "efectivo",
  debito: "cuenta de débito",
  credito: "tarjeta de crédito",
  transferencia: "cuenta para transferencias",
  vales: "vales",
  monedero: "monedero",
  otra: "cuenta",
};

// ------------------------------------------------------------------ Mover dinero entre cuentas

// Lo que suena a una cuenta propia y no a una persona: "Revolut", "mi cuenta de ahorro", "efectivo".
const PARECE_CUENTA =
  /\b(cuenta|tarjeta|tdc|tdd|efectivo|cash|cartera|ahorro|ahorros|inversion|nomina|debito|credito|monedero|vales|cajero|banco|bbva|bancomer|nu|banorte|santander|hsbc|banamex|citibanamex|scotiabank|scotia|inbursa|azteca|banregio|bancoppel|coppel|afirme|bajio|amex|american express|liverpool|klar|stori|uala|openbank|revolut|hey|invex|rappicard|didi|mercado pago|paypal|spin|albo|fondeadora|cetes|gbm|nu ?bank|vexi|plata)\b/;

export type DatosMover = {
  tipo?: "transferencia" | "pago_tarjeta" | "retiro";
  monto: number;
  desde?: string;
  hacia?: string;
  /** La app las elige de una lista: con el id no se busca por nombre. */
  desdeId?: string;
  haciaId?: string;
  fecha?: string;
  descripcion?: string;
  etiquetas?: string[];
};

/** Encuentra una cuenta propia por cómo la nombró; si no existe y suena a cuenta, la crea. */
function cuentaPropia(ctx: Contexto, texto: string | undefined, rol: "desde" | "hacia"): Cuenta | undefined {
  if (!texto?.trim()) return undefined;
  const existente = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, texto, { siAmbigua: "error", soloExistente: true, alCambiar: cambioDeCuenta(ctx) });
  if (existente) return existente;
  if (!PARECE_CUENTA.test(normalizar(texto))) {
    throw new ErrorFinanzas(
      rol === "hacia"
        ? `"${texto}" no es una de sus cuentas. Si le mandó dinero a otra persona, es un gasto (registrar_movimientos) o un préstamo (prestamo); si es una cuenta suya nueva, llámala con mover_dinero diciendo "cuenta ${texto}".`
        : `"${texto}" no es una de sus cuentas. Si el dinero se lo dio otra persona, es un ingreso o un préstamo.`,
    );
  }
  return encontrarOCrearCuenta(ctx.db, ctx.usuarioId, texto, { siAmbigua: "error", alCambiar: cambioDeCuenta(ctx) });
}

/**
 * Transferencias entre cuentas propias, retiros de cajero, pagos o abonos a una tarjeta de crédito y
 * disposiciones de efectivo. No es gasto ni ingreso: el dinero cambia de lugar. Devuelve el movimiento y
 * cómo quedaron las cuentas que se conocen.
 */
export function moverDinero(ctx: Contexto, datos: DatosMover) {
  const porId = (id: string) => {
    const c = cuentasDelUsuario(ctx).find((x) => x.id === id);
    if (!c) throw new ErrorFinanzas("No existe esa cuenta.");
    return c;
  };
  let desde = datos.desdeId ? porId(datos.desdeId) : cuentaPropia(ctx, datos.desde, "desde");
  let hacia = datos.haciaId ? porId(datos.haciaId) : datos.tipo === "retiro" && !datos.hacia ? encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "efectivo", { alCambiar: cambioDeCuenta(ctx) }) : cuentaPropia(ctx, datos.hacia, "hacia");
  let tipo: "transferencia" | "pago_tarjeta" = datos.tipo === "pago_tarjeta" ? "pago_tarjeta" : "transferencia";
  if (tipo === "pago_tarjeta" && !hacia) {
    // "Pagué la Nu" con solo una cuenta dicha: si es de crédito, es a la que se pagó.
    if (desde?.tipo === "credito") [hacia, desde] = [desde, undefined];
    else {
      const tarjetas = cuentasDelUsuario(ctx).filter((c) => c.tipo === "credito" && !c.archivada);
      if (tarjetas.length === 1) hacia = tarjetas[0];
      else if (tarjetas.length > 1) throw new ErrorFinanzas(`Pregunta a qué tarjeta fue el pago: tiene ${enLista(tarjetas.map((c) => c.nombre))}.`);
      // Sin tarjetas conocidas, "pagué la tarjeta de crédito" es la única que tiene: se crea con ese nombre.
      else hacia = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "tarjeta de crédito", { alCambiar: cambioDeCuenta(ctx) });
    }
  }
  if (!desde && !hacia) throw new ErrorFinanzas("Pregunta de qué cuenta a qué cuenta movió el dinero.");
  if (desde && hacia && desde.id === hacia.id) throw new ErrorFinanzas("El dinero sale y llega a la misma cuenta: pregunta a cuál fue.");
  // Lo que llega a una tarjeta de crédito es un pago; una tarjeta de "otra" a la que se le paga es de crédito.
  if (hacia && tipo === "pago_tarjeta" && hacia.tipo === "otra") {
    registrarEnBitacora(ctx, "cuentas", hacia.id, "editar", { tipo: hacia.tipo }, { tipo: "credito" });
    hacia = ctx.db.update(cuentas).set({ tipo: "credito" }).where(eq(cuentas.id, hacia.id)).returning().get()!;
  }
  if (hacia?.tipo === "credito") tipo = "pago_tarjeta";
  const movimiento = crearMovimiento(ctx, {
    tipo,
    monto: datos.monto,
    cuenta: desde?.nombre,
    cuentaDestino: hacia?.nombre,
    descripcion: datos.descripcion || (datos.tipo === "retiro" ? "Retiro de efectivo" : undefined),
    fecha: datos.fecha,
    etiquetas: datos.etiquetas,
  });
  const estados = [desde, hacia].filter((c): c is Cuenta => !!c).map((c) => estadoDeCuenta(ctx, c.id));
  return { movimiento, cuentas: estados, confirmacion: confirmarMovimiento(ctx, tipo, datos, desde, hacia, estados) };
}

function confirmarMovimiento(
  ctx: Contexto,
  tipo: "transferencia" | "pago_tarjeta",
  datos: DatosMover,
  desde: Cuenta | undefined,
  hacia: Cuenta | undefined,
  estados: EstadoCuenta[],
) {
  const monto = $(ctx, aCentavos(datos.monto));
  const de = desde ? ` desde ${desde.nombre}` : "";
  const que =
    tipo === "pago_tarjeta"
      ? `pago de ${monto} a ${hacia!.nombre}${de}`
      : hacia?.tipo === "efectivo"
        ? `retiro de ${monto}${desde ? ` de ${desde.nombre}` : ""} a efectivo`
        : `pasaste ${monto}${desde ? ` de ${desde.nombre}` : ""}${hacia ? ` a ${hacia.nombre}` : ""}`;
  // Cómo quedaron las que se conocen; la tarjeta primero, que es lo que importa al pagarla.
  // Sacó más de lo que había: seguro el saldo cambió y no lo sabemos; no se dice "tiene menos 40 mil".
  const origen = estados.find((e) => e.conocido && e.id === desde?.id && !e.esCredito && e.saldoCentavos! < 0);
  const conocidas = estados.filter((e) => e.conocido && e !== origen).sort((a, b) => Number(b.esCredito) - Number(a.esCredito));
  const quedan = conocidas.length ? ` Ahora ${enLista(conocidas.map((e) => describirSaldo(ctx, e)))}.` : "";
  const ojo = origen ? ` Ojo, es más de lo que tenías en ${origen.nombre}; si no es así, dime cuánto tienes ahí.` : "";
  return `Listo, ${que}.${quedan}${ojo}`;
}

// ------------------------------------------------------------------ Lo que se dice después de un gasto

// Cuando una tarjeta baja de esto, o del 10% de su límite, vale la pena decirlo.
const POCO_CREDITO_CENTAVOS = 1_000_00;
const POCO_SALDO_CENTAVOS = 500_00;

/**
 * Después de anotar gastos con una cuenta de saldo conocido: si la tarjeta se quedó casi sin crédito o se
 * pasó del límite, o si la cuenta quedó en poco o en negativo (seguro el saldo cambió), una frase para
 * decirlo. Solo cuando el gasto la cruza: no se repite en cada gasto.
 */
export function datoDeCuentas(ctx: Contexto, gastos: { cuentaId: string | null; montoCentavos: number; moneda: string }[]): string | undefined {
  const porCuenta = new Map<string, number>();
  for (const g of gastos) {
    if (!g.cuentaId || g.moneda !== ctx.monedaBase) continue;
    porCuenta.set(g.cuentaId, (porCuenta.get(g.cuentaId) ?? 0) + g.montoCentavos);
  }
  for (const [cuentaId, gastado] of porCuenta) {
    const e = estadoDeCuenta(ctx, cuentaId);
    if (!e.conocido || e.saldoEn === null) continue;
    if (e.esCredito && e.disponibleCentavos !== null) {
      const despues = e.disponibleCentavos;
      const antes = despues + gastado;
      if (despues < 0 && antes >= 0) return `Ojo, con esto te pasaste del límite de ${e.nombre} por ${$(ctx, -despues)}.`;
      const poco = Math.max(POCO_CREDITO_CENTAVOS, e.limiteCentavos ? Math.round(e.limiteCentavos * 0.1) : 0);
      if (despues >= 0 && despues < poco && antes >= poco) return `Ojo, en ${e.nombre} ya solo te quedan ${$(ctx, despues)} disponibles.`;
    } else if (!e.esCredito && e.saldoCentavos !== null) {
      const despues = e.saldoCentavos;
      const antes = despues + gastado;
      if (despues < 0 && antes >= 0) return `Con esto ${e.nombre} quedaría en menos ${$(ctx, -despues)}; si no es así, dime cuánto tienes ahí.`;
      if (despues >= 0 && despues < POCO_SALDO_CENTAVOS && antes >= POCO_SALDO_CENTAVOS) return `En ${e.nombre} te quedan ${$(ctx, despues)}.`;
    }
  }
  return undefined;
}

// ------------------------------------------------------------------ Reconocer frases de cuentas

// "Tengo 20 mil en Revolut", "me quedan 3 mil en la BBVA", "mi saldo en Nu es de 500", "en BBVA tengo 4 mil",
// "mi cuenta de ahorro en Nu tiene 45 mil".
const DICE_SALDO =
  /\b(tengo|traigo|me quedan|me queda|cuento con|hay|quedan|queda)\b.{0,40}\b(en|de) (la |el |mi |mis |tu )?(cuenta|tarjeta|\w+)|\ben (la |el |mi |mis )?\S+( \S+)? (tengo|traigo|me quedan?|hay)\b|\b(cuenta|tarjeta|tdc|debito|ahorro|ahorros|nomina)\b.{0,30}\b(tiene|trae)\b|\b(mi )?saldo (de|en|del)\b|\bdisponibles?\b|\blimite\b|\b(tengo )?(ocupad[oa]s?|usad[oa]s?)\b.{0,30}\btarjeta\b|\b(debo|adeudo)\b.{0,40}\b(tarjeta|credito|tdc)\b/;
// "Tengo 5 mil", "ahora traigo 800 pesos": un saldo sin decir dónde (se pregunta en cuál).
const SALDO_SIN_CUENTA =
  /^(?:(?:te aviso que|oye|ahora|ya|solo|nada mas|ahorita)\s+)*(tengo|traigo|me quedan?)\s+(como\s+|unos\s+)?\$?[\d.,]+(\s*(mil|k))?(\s*(pesos|varos|mxn))?(\s+(nada mas|en total|ahorita|disponibles?))?$/;
// Pagar o abonar a una tarjeta, no pagar con ella: "le pagué 5 mil a la Nu", "abono a la tarjeta".
const PAGA = "pague|pagar|pagamos|pagando|abone|abonar|abonando|abono|liquide|liquidar|deposite|depositar|meti|cubri";
const PAGA_TARJETA = new RegExp(
  `\\b(${PAGA})\\b.{0,40}\\b(a|para|de) (la |mi )?(tarjeta|tdc|credito)\\b|\\b(pago|abono) (de |a |para )?(la |mi )?(tarjeta|tdc)\\b|\\bpague (la|mi) (tarjeta|tdc)\\b`,
);
const CON_TARJETA = /\bcon (la |mi )?(tarjeta|tdc)( de credito| de debito)?\b/g;
// Mover dinero entre cuentas: "transferí 2 mil de BBVA a Revolut", "pasé mil del efectivo a Bancomer",
// "transferí 5 mil a Revolut", "retiré mil del cajero".
const MUEVE =
  /\b(transferi|transferir|traspase|pase|movi|mande|envie|meti)\b.{0,40}\b(de|desde|del) (la |el |mi )?\S+.{0,30}\b(a|para) (la |el |mi )?\S+|\b(transferi|transferir|transfiere|traspase)\b.{0,30}\b(a|para) (la |el |mi )?\S+|\b(retire|retirar|saque|sacar)\b.{0,30}\b(cajero|efectivo)\b|\bdisposicion de efectivo\b|\badelanto de efectivo\b/;

/** El pago a una tarjeta que nombra por su nombre: "le pagué 3 mil a la Nu", "ya pagué la Nu", "abono de 1500 a la Nu". */
function pagaATarjetaNombrada(plano: string, tarjetas: string[]): boolean {
  for (const tarjeta of tarjetas) {
    const nombre = normalizar(tarjeta).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!nombre) continue;
    // "Pagué la cena con la Nu" es un gasto con ella.
    const sinCon = plano.replace(new RegExp(`\\bcon (la |el |mi )?(tarjeta )?${nombre}\\b`, "g"), " ");
    if (new RegExp(`\\b(${PAGA})\\b.{0,40}\\b(a |para |de )?(la |el |mi )?(total de (la |el |mi )?)?(tarjeta )?${nombre}\\b`).test(sinCon)) return true;
  }
  return false;
}

/**
 * Si la frase habla de cuánto hay en una cuenta, del límite o la deuda de una tarjeta, de pagarle a una
 * tarjeta o de mover dinero entre cuentas. Son actualizaciones, no gastos: el Atajo espera a la IA para
 * decir cómo quedaron y el comentario de gasto raro no aplica. `tarjetas`: los nombres de sus tarjetas de
 * crédito, para reconocer "le pagué 3 mil a la Nu".
 */
export function hablaDeCuentas(texto: string, tarjetas: string[] = []): boolean {
  const plano = normalizar(texto);
  if (!montosDelTexto(texto).length && !/\b(disponible|limite|saldo)\b/.test(plano)) return false;
  return esSaldoDicho(plano) || esPagoDeTarjeta(plano, tarjetas) || MUEVE.test(plano);
}

// "Tengo que pagar 500", "tengo 3 tacos": "tengo" sin "en/de la cuenta" no es un saldo.
const NO_ES_SALDO = /\btengo que\b|\bhay que\b|\bgaste\b|\bcompre\b|\bme cobraron\b/;

/** "Tengo 20 mil en Revolut", "la Nu tiene un límite de 30 mil", "debo 5 mil de la tarjeta", "tengo 5 mil". */
export function esSaldoDicho(texto: string): boolean {
  const plano = normalizar(texto);
  if (NO_ES_SALDO.test(plano)) return false;
  if (SALDO_SIN_CUENTA.test(plano.replace(/[,.!]+$/, "").trim())) return true;
  return DICE_SALDO.test(plano) && (montosDelTexto(texto).length > 0 || /\b(disponible|limite|saldo)\b/.test(plano));
}

/** Si la frase es un pago o abono a una tarjeta (no un gasto con ella). */
export function esPagoDeTarjeta(texto: string, tarjetas: string[] = []): boolean {
  const plano = normalizar(texto);
  return PAGA_TARJETA.test(plano.replace(CON_TARJETA, " ")) || pagaATarjetaNombrada(plano, tarjetas);
}

/** Los nombres (y alias) de sus tarjetas de crédito, para reconocer "le pagué a la Nu". */
export function nombresDeTarjetas(ctx: Contexto): string[] {
  return cuentasDelUsuario(ctx)
    .filter((c) => c.tipo === "credito" && !c.archivada)
    .flatMap((c) => [c.nombre, ...(c.alias ?? [])]);
}

// ------------------------------------------------------------------ Lo que vale la pena notar

const USO_ALTO = 0.8;
const DIAS_AVISO_PAGO = 5;

/**
 * Una observación sobre todas sus cuentas, si hay algo que notar: una tarjeta que se paga en estos días,
 * una casi al límite, o más deuda en tarjetas que dinero en cuentas. La IA la dice al consultar saldos.
 */
export function observacionDeCuentas(ctx: Contexto, estados: EstadoCuenta[]): string | undefined {
  const [anio, mes, dia] = ctx.hoy.split("-").map(Number) as [number, number, number];
  for (const e of estados) {
    if (!e.esCredito || !e.diaPago || e.deudaCentavos === null || e.deudaCentavos <= 0) continue;
    // El próximo día de pago: este mes si no ha pasado, si no el siguiente.
    const diasMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const faltan = e.diaPago >= dia ? Math.min(e.diaPago, diasMes) - dia : diasMes - dia + e.diaPago;
    if (faltan <= DIAS_AVISO_PAGO) {
      const cuando = faltan === 0 ? "hoy" : faltan === 1 ? "mañana" : `en ${faltan} días`;
      return `Ojo, ${e.nombre} se paga ${cuando} y debes ${$(ctx, e.deudaCentavos)}.`;
    }
  }
  const llena = estados
    .filter((e) => e.esCredito && e.limiteCentavos && e.deudaCentavos !== null && e.deudaCentavos / e.limiteCentavos >= USO_ALTO)
    .sort((a, b) => b.deudaCentavos! / b.limiteCentavos! - a.deudaCentavos! / a.limiteCentavos!)[0];
  if (llena) return `Ojo, ${llena.nombre} va al ${Math.min(999, Math.round((llena.deudaCentavos! / llena.limiteCentavos!) * 100))}% de su límite.`;
  const t = totalesDeCuentas(estados);
  if (t.cuentasConSaldo && t.tarjetasConDeuda && t.deudaCentavos > t.dineroCentavos) {
    return `Debes ${$(ctx, t.deudaCentavos - t.dineroCentavos)} más en tarjetas de lo que tienes en tus cuentas.`;
  }
  return undefined;
}

/** Archiva una cuenta (deja de aparecer y de sumarse) o la regresa. Sus movimientos se quedan. */
export function archivarCuenta(ctx: Contexto, id: string, archivada: boolean): EstadoCuenta {
  const antes = cuentasDelUsuario(ctx).find((c) => c.id === id);
  if (!antes) throw new ErrorFinanzas("No existe esa cuenta.");
  if (antes.archivada !== archivada) {
    const despues = ctx.db.update(cuentas).set({ archivada }).where(eq(cuentas.id, id)).returning().get()!;
    registrarEnBitacora(ctx, "cuentas", id, "editar", antes, despues);
  }
  return estadoDeCuenta(ctx, id);
}

/** Lo que entró y salió de cada cuenta en un periodo, para las gráficas de la app. */
export function flujoPorCuenta(ctx: Contexto, desde: string, hasta: string) {
  const filas = ctx.db
    .select()
    .from(movimientos)
    .where(and(eq(movimientos.usuarioId, ctx.usuarioId), isNull(movimientos.eliminadoEn), eq(movimientos.moneda, ctx.monedaBase)))
    .all()
    .filter((m) => m.fecha >= desde && m.fecha <= hasta);
  const flujo = new Map<string, { entradaCentavos: number; salidaCentavos: number }>();
  const sumar = (id: string | null, centavos: number) => {
    if (!id || !centavos) return;
    const f = flujo.get(id) ?? { entradaCentavos: 0, salidaCentavos: 0 };
    if (centavos > 0) f.entradaCentavos += centavos;
    else f.salidaCentavos -= centavos;
    flujo.set(id, f);
  };
  for (const m of filas) {
    const e = efectoDe(m);
    sumar(m.cuentaId, e.origen);
    sumar(m.cuentaDestinoId, e.destino);
  }
  return flujo;
}

/** Una cuenta nueva desde la app, con el nombre tal cual (sin buscar una parecida). */
export function crearCuenta(ctx: Contexto, nombre: string, tipo: TipoCuenta = "otra"): EstadoCuenta {
  const fila = ctx.db.insert(cuentas).values({ usuarioId: ctx.usuarioId, nombre: nombre.trim().slice(0, 60), tipo }).returning().get();
  registrarEnBitacora(ctx, "cuentas", fila.id, "crear", undefined, fila);
  return estadoDeCuenta(ctx, fila.id);
}
