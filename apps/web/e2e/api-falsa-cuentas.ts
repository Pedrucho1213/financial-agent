import { type ApiFalsa, HOY, type MovimientoApp, mov } from "./api-falsa";

// Cuentas, tarjetas, transferencias y etiquetas, con el contrato del hilo "Cuentas, tarjetas y tags" (PR #38).
// Solo responde si la prueba llama a conCuentas(api): sin eso, /v1/cuentas da 404 como un servidor viejo.

type Peticion = {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  consulta: URLSearchParams;
  json: (estado: number, datos: unknown) => Promise<void>;
};

type TipoCuenta = "efectivo" | "debito" | "credito" | "otra";

/** Lo que guarda el servidor falso; null es "no se sabe". */
export type CuentaFalsa = {
  id: string;
  nombre: string;
  tipo: TipoCuenta;
  archivada: boolean;
  /** Débito y efectivo. */
  saldo: number | null;
  /** Crédito: lo usado. */
  deuda: number | null;
  limite: number | null;
  diaCorte: number | null;
  diaPago: number | null;
  saldoEn: string | null;
  mes: { entradaCentavos: number; salidaCentavos: number };
};

export type EtiquetaFalsa = { id: string; nombre: string; activaDesde: string | null; activaHasta: string | null };

export type DatosCuentas = { cuentas: CuentaFalsa[]; etiquetas: EtiquetaFalsa[]; observacion: string | null; siguiente: number };

const cuenta = (c: Partial<CuentaFalsa> & Pick<CuentaFalsa, "id" | "nombre" | "tipo">): CuentaFalsa => ({
  archivada: false,
  saldo: null,
  deuda: null,
  limite: null,
  diaCorte: null,
  diaPago: null,
  saldoEn: c.saldo !== undefined || c.deuda !== undefined ? "2026-10-04T18:00:00.000Z" : null,
  mes: { entradaCentavos: 0, salidaCentavos: 0 },
  ...c,
});

/** BBVA y efectivo con saldo, Revolut sin saldo, Nu con poca deuda, Banamex casi al límite, Liverpool archivada. */
export function cuentasIniciales(): DatosCuentas {
  return {
    cuentas: [
      cuenta({ id: "cta-bbva", nombre: "BBVA", tipo: "debito", saldo: 18_450_00, mes: { entradaCentavos: 18_750_00, salidaCentavos: 3_400_00 } }),
      cuenta({ id: "cta-efectivo", nombre: "Efectivo", tipo: "efectivo", saldo: 1_200_00 }),
      cuenta({ id: "cta-revolut", nombre: "Revolut", tipo: "debito" }),
      cuenta({ id: "cta-nu", nombre: "Nu", tipo: "credito", deuda: 4_500_00, limite: 30_000_00, diaCorte: 1, diaPago: 20 }),
      cuenta({ id: "cta-banamex", nombre: "Banamex Oro", tipo: "credito", deuda: 27_600_00, limite: 30_000_00, diaCorte: 18, diaPago: 8 }),
      cuenta({ id: "cta-liverpool", nombre: "Liverpool", tipo: "credito", archivada: true, deuda: 0, limite: 15_000_00 }),
    ],
    etiquetas: [
      { id: "eti-viaje", nombre: "Viaje oaxaca", activaDesde: "2026-10-03", activaHasta: "2026-10-09" },
      { id: "eti-trabajo", nombre: "Trabajo", activaDesde: null, activaHasta: null },
      { id: "eti-deducible", nombre: "Deducible", activaDesde: null, activaHasta: null },
    ],
    observacion: "Banamex Oro está al 92% de su límite y se paga en 2 días.",
    siguiente: 1,
  };
}

/** Prende cuentas y etiquetas en el servidor falso y le pone cuenta y etiquetas a unos movimientos. */
export function conCuentas(api: ApiFalsa, datos = cuentasIniciales()) {
  api.cuentas = datos;
  const etiquetar = (comercio: string, ids: string[]) => {
    for (const m of api.movimientos.filter((x) => x.comercio === comercio)) m.etiquetas = ids.map((id) => ({ id, nombre: datos.etiquetas.find((e) => e.id === id)!.nombre }));
  };
  etiquetar("La Casa de Toño", ["eti-viaje"]);
  etiquetar("Pemex", ["eti-viaje", "eti-trabajo"]);
  etiquetar("Uber", ["eti-trabajo"]);
  for (const m of api.movimientos) {
    const c = datos.cuentas.find((x) => x.nombre === m.cuenta);
    m.cuentaId = c?.id ?? null;
    m.cuentaDestino ??= null;
    m.cuentaDestinoId ??= null;
    m.etiquetas ??= [];
  }
  // El traspaso de la semilla va de Nu a BBVA.
  const traspaso = api.movimientos.find((m) => m.tipo === "transferencia");
  if (traspaso) Object.assign(traspaso, { cuentaDestino: "BBVA", cuentaDestinoId: "cta-bbva" });
  return api;
}

export function estadoDe(c: CuentaFalsa) {
  const esCredito = c.tipo === "credito";
  const conocido = esCredito ? c.deuda !== null : c.saldo !== null;
  return {
    id: c.id,
    nombre: c.nombre,
    tipo: c.tipo,
    institucion: null,
    alias: [],
    archivada: c.archivada,
    esCredito,
    conocido,
    saldoCentavos: esCredito ? (c.deuda === null ? null : -c.deuda) : c.saldo,
    deudaCentavos: esCredito ? c.deuda : null,
    disponibleCentavos: esCredito ? (c.limite !== null && c.deuda !== null ? c.limite - c.deuda : null) : c.saldo,
    limiteCentavos: c.limite,
    saldoEn: c.saldoEn,
    diaCorte: c.diaCorte,
    diaPago: c.diaPago,
  };
}

function totales(cuentas: CuentaFalsa[]) {
  const estados = cuentas.filter((c) => !c.archivada).map(estadoDe);
  const debito = estados.filter((e) => !e.esCredito && e.saldoCentavos !== null);
  const credito = estados.filter((e) => e.esCredito);
  const suma = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  return {
    dineroCentavos: suma(debito.map((e) => e.saldoCentavos)),
    deudaCentavos: suma(credito.map((e) => (e.deudaCentavos !== null && e.deudaCentavos > 0 ? e.deudaCentavos : 0))),
    disponibleCreditoCentavos: suma(credito.map((e) => e.disponibleCentavos)),
    limiteCreditoCentavos: suma(credito.map((e) => e.limiteCentavos)),
    netoCentavos: suma(debito.map((e) => e.saldoCentavos)) - suma(credito.map((e) => e.deudaCentavos)),
    cuentasConSaldo: debito.length,
    tarjetasConDeuda: credito.filter((e) => e.deudaCentavos !== null).length,
    sinSaldo: estados.filter((e) => !e.conocido).map((e) => e.nombre),
  };
}

/** Como el servidor: la primera letra en mayúscula ("viaje" → "Viaje"). */
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const centavos = (pesos: unknown) => Math.round(Number(pesos) * 100);
const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function resumenEtiquetas(api: ApiFalsa, datos: DatosCuentas, desde?: string, hasta?: string) {
  return datos.etiquetas
    .map((e) => {
      const suyas = api.movimientos.filter(
        (m) => m.etiquetas?.some((x) => x.id === e.id) && (!desde || m.fecha >= desde) && (!hasta || m.fecha <= hasta),
      );
      const suma = (l: MovimientoApp[]) => l.reduce((s, m) => s + m.montoCentavos, 0);
      return {
        id: e.id,
        nombre: e.nombre,
        activaDesde: e.activaDesde,
        activaHasta: e.activaHasta,
        activa: !!e.activaDesde && !!e.activaHasta && e.activaDesde <= HOY && HOY <= e.activaHasta,
        cantidad: suyas.length,
        gastadoCentavos: suma(suyas.filter((m) => m.tipo === "gasto")),
        ingresadoCentavos: suma(suyas.filter((m) => m.tipo === "ingreso")),
        ultimoUso: suyas.reduce<string | null>((max, m) => (!max || m.fecha > max ? m.fecha : max), null),
      };
    })
    .sort((a, b) => b.gastadoCentavos - a.gastadoCentavos || a.nombre.localeCompare(b.nombre));
}

/** Lo que el tablero agrega con cuentas: los totales y el gasto por etiqueta del mes. */
export function extraTablero(api: ApiFalsa, mes: string) {
  const datos = api.cuentas;
  if (!datos) return {};
  return {
    cuentas: totales(datos.cuentas),
    porEtiqueta: resumenEtiquetas(api, datos, `${mes}-01`, `${mes}-31`).map((e) => ({
      id: e.id,
      nombre: e.nombre,
      gastadoCentavos: e.gastadoCentavos,
      ingresadoCentavos: e.ingresadoCentavos,
      cantidad: e.cantidad,
      activa: e.activa,
    })),
  };
}

function aplicar(c: CuentaFalsa, b: Record<string, unknown>) {
  if (typeof b.nombre === "string") c.nombre = b.nombre.trim();
  if (typeof b.tipo === "string") {
    const antes = c.tipo === "credito";
    c.tipo = b.tipo as TipoCuenta;
    // Pasar de débito a crédito (o al revés): el saldo anterior ya no significa lo mismo.
    if (antes !== (c.tipo === "credito")) Object.assign(c, { saldo: null, deuda: null, saldoEn: null });
  }
  const ahora = "2026-10-06T18:30:00.000Z";
  if (b.saldo !== undefined) {
    if (c.tipo === "credito") c.deuda = centavos(b.saldo);
    else c.saldo = centavos(b.saldo);
    c.saldoEn = ahora;
  }
  if (b.deuda !== undefined) {
    c.tipo = "credito";
    c.deuda = centavos(b.deuda);
    c.saldoEn = ahora;
  }
  if (b.limite !== undefined) c.limite = b.limite === null ? null : centavos(b.limite);
  if (b.disponible !== undefined && c.limite !== null) {
    c.deuda = c.limite - centavos(b.disponible);
    c.saldoEn = ahora;
  }
  if (b.dia_corte !== undefined) c.diaCorte = b.dia_corte as number | null;
  if (b.dia_pago !== undefined) c.diaPago = b.dia_pago as number | null;
  if (typeof b.archivada === "boolean") c.archivada = b.archivada;
}

/** Lo que sale de una cuenta (o se carga a una tarjeta) y lo que llega. */
function mover(c: CuentaFalsa | undefined, monto: number, sale: boolean) {
  if (!c) return;
  if (c.tipo === "credito") {
    if (c.deuda !== null) c.deuda += sale ? monto : -monto;
  } else if (c.saldo !== null) c.saldo += sale ? -monto : monto;
  if (sale) c.mes.salidaCentavos += monto;
  else c.mes.entradaCentavos += monto;
}

export async function atenderCuentas(api: ApiFalsa, { metodo, ruta, cuerpo, consulta, json }: Peticion) {
  const datos = api.cuentas;
  if (!datos) return;
  const b = (cuerpo ?? {}) as Record<string, unknown>;

  if (metodo === "GET" && ruta === "/v1/cuentas") {
    const con = consulta.get("archivadas") === "1";
    const lista = datos.cuentas.filter((c) => con || !c.archivada);
    return json(200, {
      cuentas: lista.map((c) => ({ ...estadoDe(c), mes: c.mes })),
      totales: totales(datos.cuentas),
      observacion: datos.observacion,
    });
  }
  if (metodo === "POST" && ruta === "/v1/cuentas") {
    const nombre = typeof b.nombre === "string" ? b.nombre.trim() : "";
    if (!nombre) return json(400, { error: "Datos inválidos.", detalles: { nombre: ["Requerido"] } });
    const existe = datos.cuentas.find((c) => normal(c.nombre) === normal(nombre));
    if (existe && !existe.archivada) return json(409, { error: `Ya tienes una cuenta llamada ${existe.nombre}.` });
    const c = existe ?? cuenta({ id: `cta-nueva-${datos.siguiente++}`, nombre, tipo: (b.tipo as TipoCuenta) ?? "otra" });
    c.archivada = false;
    if (!existe) datos.cuentas.push(c);
    aplicar(c, { ...b, nombre: undefined });
    return json(201, estadoDe(c));
  }
  let m = ruta.match(/^\/v1\/cuentas\/([^/]+)$/);
  if (m) {
    const c = datos.cuentas.find((x) => x.id === m?.[1]);
    if (!c) return json(400, { error: "No existe esa cuenta." });
    if (metodo === "GET") {
      const suyos = api.movimientos
        .filter((x) => x.cuentaId === c.id || x.cuentaDestinoId === c.id)
        .sort((a, b) => b.fecha.localeCompare(a.fecha));
      return json(200, { cuenta: estadoDe(c), movimientos: suyos.slice(0, 30), totalMovimientos: suyos.length });
    }
    if (metodo === "PATCH") {
      if (typeof b.nombre === "string" && datos.cuentas.some((x) => x !== c && !x.archivada && normal(x.nombre) === normal(b.nombre as string))) {
        return json(400, { error: `Ya tienes una cuenta llamada ${b.nombre}.` });
      }
      aplicar(c, b);
      return json(200, estadoDe(c));
    }
  }
  if (metodo === "POST" && ruta === "/v1/transferencias") {
    const monto = centavos(b.monto);
    if (!(monto > 0)) return json(400, { error: "Datos inválidos.", detalles: { monto: ["Debe ser positivo"] } });
    const desde = datos.cuentas.find((c) => c.id === b.desde_id);
    let hacia = datos.cuentas.find((c) => c.id === b.hacia_id);
    if (b.tipo === "retiro" && !hacia) hacia = datos.cuentas.find((c) => c.tipo === "efectivo");
    if (!desde && !hacia) return json(400, { error: "Pregunta de qué cuenta a qué cuenta movió el dinero." });
    if (desde && hacia && desde.id === hacia.id) return json(400, { error: "El dinero sale y llega a la misma cuenta: pregunta a cuál fue." });
    const tipo = hacia?.tipo === "credito" || b.tipo === "pago_tarjeta" ? "pago_tarjeta" : "transferencia";
    mover(desde, monto, true);
    mover(hacia, monto, false);
    const nuevo = mov((b.fecha as string) ?? HOY, tipo, monto / 100, null, null, {
      origen: "app",
      descripcion: (b.descripcion as string) ?? (b.tipo === "retiro" ? "Retiro de efectivo" : null),
      cuenta: desde?.nombre ?? null,
      cuentaId: desde?.id ?? null,
      cuentaDestino: hacia?.nombre ?? null,
      cuentaDestinoId: hacia?.id ?? null,
      etiquetas: [],
    });
    nuevo.id = `mov-mover-${api.movimientos.length}`;
    api.movimientos.unshift(nuevo);
    return json(201, { movimiento: nuevo, cuentas: [desde, hacia].filter((c): c is CuentaFalsa => !!c).map(estadoDe) });
  }

  if (metodo === "GET" && ruta === "/v1/etiquetas") {
    const periodo = consulta.get("periodo");
    if (periodo && periodo !== "este_mes") return json(400, { error: `No entendí el periodo "${periodo}".` });
    const mes = HOY.slice(0, 7);
    return json(200, { etiquetas: periodo ? resumenEtiquetas(api, datos, `${mes}-01`, `${mes}-31`) : resumenEtiquetas(api, datos) });
  }
  if (metodo === "POST" && ruta === "/v1/etiquetas") {
    const nombre = typeof b.nombre === "string" ? mayuscula(b.nombre.replace(/#/g, " ").trim()) : "";
    if (!nombre) return json(400, { error: "Datos inválidos." });
    if (datos.etiquetas.some((e) => normal(e.nombre) === normal(nombre))) return json(409, { error: "Ya tienes esa etiqueta." });
    const e: EtiquetaFalsa = {
      id: `eti-nueva-${datos.siguiente++}`,
      nombre,
      activaDesde: (b.activa_desde as string) ?? (b.activa_hasta ? HOY : null),
      activaHasta: (b.activa_hasta as string) ?? null,
    };
    datos.etiquetas.push(e);
    return json(201, resumenEtiquetas(api, datos).find((x) => x.id === e.id));
  }
  m = ruta.match(/^\/v1\/etiquetas\/([^/]+)$/);
  if (m) {
    const e = datos.etiquetas.find((x) => x.id === m?.[1]);
    if (!e) return json(404, { error: "No existe esa etiqueta." });
    if (metodo === "PATCH") {
      if (typeof b.nombre === "string") e.nombre = mayuscula(b.nombre.trim());
      if (b.activa_hasta === null || b.activa_desde === null) Object.assign(e, { activaDesde: null, activaHasta: null });
      else if (b.activa_desde || b.activa_hasta) {
        e.activaDesde = (b.activa_desde as string) ?? HOY;
        e.activaHasta = (b.activa_hasta as string) ?? e.activaDesde;
      }
      for (const x of api.movimientos) for (const t of x.etiquetas ?? []) if (t.id === e.id) t.nombre = e.nombre;
      return json(200, resumenEtiquetas(api, datos).find((x) => x.id === e.id));
    }
    if (metodo === "DELETE") {
      datos.etiquetas.splice(datos.etiquetas.indexOf(e), 1);
      for (const x of api.movimientos) x.etiquetas = x.etiquetas?.filter((t) => t.id !== e.id);
      return json(200, { ok: true });
    }
  }
}

/** Para POST/PATCH /v1/movimientos: ids de etiquetas a { id, nombre } y la cuenta destino. */
export function extraMovimiento(api: ApiFalsa, b: Record<string, unknown>): Partial<MovimientoApp> {
  const datos = api.cuentas;
  if (!datos) return {};
  const extra: Partial<MovimientoApp> = {};
  if (Array.isArray(b.etiquetas)) {
    extra.etiquetas = (b.etiquetas as string[]).flatMap((id) => {
      const e = datos.etiquetas.find((x) => x.id === id);
      return e ? [{ id: e.id, nombre: e.nombre }] : [];
    });
  }
  if ("cuenta_destino" in b) {
    const c = datos.cuentas.find((x) => b.cuenta_destino && normal(x.nombre) === normal(b.cuenta_destino as string));
    extra.cuentaDestino = c?.nombre ?? ((b.cuenta_destino as string | null) || null);
    extra.cuentaDestinoId = c?.id ?? null;
  }
  if ("cuenta" in b) extra.cuentaId = datos.cuentas.find((x) => b.cuenta && normal(x.nombre) === normal(b.cuenta as string))?.id ?? null;
  return extra;
}
