import type { ApiFalsa } from "./api-falsa";

// Cobros por confirmar (GET /v1/cobros, POST /v1/cobros/:id/{confirmar,posponer,saltar,deshacer}, POST
// /v1/cobros/confirmar) y preferencias de avisos (GET y PUT /v1/avisos/preferencias). Hoy es 6 de octubre de 2026.
// Sin conCobros(), todo responde 404: así lo ve una cuenta que no es la dueña (o un servidor viejo).

type Estado = "pendiente" | "pagado" | "saltado" | "sin_confirmar";
export type CobroFalso = {
  id: string;
  recurrenteId: string;
  nombre: string;
  tipo: string;
  fecha: string;
  montoCentavos: number;
  moneda: string;
  cuentaId: string | null;
  cuenta: string | null;
  estado: Estado;
  pospuesto: boolean;
  montoRealCentavos: number | null;
  movimientoId: string | null;
  confirmadoPor: "app" | "voz" | "apple_pay" | "empate" | "auto" | null;
  confirmadoEn: string | null;
  anteriorDistintoCentavos: number | null;
  sugerencias: { movimientoId: string; titulo: string; montoCentavos: number; moneda: string; fecha: string; cuenta: string | null }[];
};

type Peticion = {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  json: (estado: number, datos: unknown) => Promise<void>;
};

const c = (x: Partial<CobroFalso> & Pick<CobroFalso, "id" | "nombre" | "fecha" | "montoCentavos">): CobroFalso => ({
  recurrenteId: `rec-${x.id.replace(/^cob-/, "")}`,
  tipo: "suscripcion",
  moneda: "MXN",
  cuentaId: null,
  cuenta: null,
  estado: "pendiente",
  pospuesto: false,
  montoRealCentavos: null,
  movimientoId: null,
  confirmadoPor: null,
  confirmadoEn: null,
  anteriorDistintoCentavos: null,
  sugerencias: [],
  ...x,
});

/**
 * Disney+ se cobra hoy ($159 con Nu; la vez pasada fueron $179 y ya hay un "DISNEY PLUS" anotado). La renta tocaba
 * el 1 y nadie contestó. El agua, "todavía no" (se pregunta mañana). Ya contestados: Spotify por voz y Max no se pagó.
 */
export function cobrosIniciales(): CobroFalso[] {
  return [
    c({ id: "cob-renta", recurrenteId: "rec-renta", nombre: "Renta", tipo: "renta", fecha: "2026-10-01", montoCentavos: 9_500_00 }),
    c({ id: "cob-agua", nombre: "Agua", tipo: "servicio", fecha: "2026-10-04", montoCentavos: 310_00, pospuesto: true }),
    c({
      id: "cob-disney",
      nombre: "Disney+",
      fecha: "2026-10-06",
      montoCentavos: 159_00,
      cuentaId: "cta-nu",
      cuenta: "Nu",
      anteriorDistintoCentavos: 179_00,
      sugerencias: [{ movimientoId: "mov-disney", titulo: "DISNEY PLUS", montoCentavos: 179_00, moneda: "MXN", fecha: "2026-10-05", cuenta: "Nu" }],
    }),
    c({
      id: "cob-spotify",
      recurrenteId: "rec-spotify",
      nombre: "Spotify",
      fecha: "2026-09-20",
      montoCentavos: 129_00,
      estado: "pagado",
      montoRealCentavos: 129_00,
      movimientoId: "mov-spotify",
      confirmadoPor: "voz",
      confirmadoEn: "2026-09-20T20:00:00.000Z",
    }),
    c({ id: "cob-max", nombre: "Max", fecha: "2026-09-03", montoCentavos: 149_00, estado: "saltado", confirmadoPor: "app", confirmadoEn: "2026-09-04T01:00:00.000Z" }),
  ];
}

const datos = new WeakMap<
  ApiFalsa,
  { lista: CobroFalso[]; preferencias: { tipos: Record<string, boolean>; desde: number; hasta: number }; antes: Map<string, CobroFalso> }
>();

export function conCobros(api: ApiFalsa, lista = cobrosIniciales()) {
  datos.set(api, {
    lista,
    preferencias: { tipos: { cobros: true, tarjetas: true, presupuestos: true, fugas: true, deudas: true }, desde: 9, hasta: 21 },
    antes: new Map(),
  });
  return api;
}

export function cobrosDe(api: ApiFalsa) {
  return datos.get(api)?.lista ?? [];
}

const HOY = "2026-10-06";
const resuelto = (x: CobroFalso) => x.estado === "pagado" || x.estado === "saltado";

function listar(lista: CobroFalso[]) {
  const porConfirmar = lista.filter((x) => x.estado === "pendiente" && x.fecha <= HOY).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const recientes = lista.filter((x) => resuelto(x) || x.estado === "sin_confirmar").sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { porConfirmar, recientes, insignia: porConfirmar.filter((x) => !x.pospuesto).length };
}

export async function atenderCobros(api: ApiFalsa, { metodo, ruta, cuerpo, json }: Peticion) {
  if (!ruta.startsWith("/v1/cobros") && ruta !== "/v1/avisos/preferencias") return;
  const d = datos.get(api);
  if (!d) return json(404, { error: "No encontrado." });
  const b = (cuerpo ?? {}) as Record<string, unknown>;

  if (ruta === "/v1/avisos/preferencias") {
    if (metodo === "GET") return json(200, d.preferencias);
    if (metodo === "PUT") {
      const desde = typeof b.desde === "number" ? b.desde : d.preferencias.desde;
      const hasta = typeof b.hasta === "number" ? b.hasta : d.preferencias.hasta;
      if (hasta <= desde) return json(400, { error: "El horario debe terminar después de empezar." });
      d.preferencias = { tipos: { ...d.preferencias.tipos, ...(b.tipos as Record<string, boolean> | undefined) }, desde, hasta };
      return json(200, d.preferencias);
    }
  }
  if (metodo === "GET" && ruta === "/v1/cobros") return json(200, listar(d.lista));

  const pagar = (x: CobroFalso, datosPago: Record<string, unknown> = {}) => {
    if (x.estado === "pagado") return;
    d.antes.set(x.id, { ...x });
    const sugerido = x.sugerencias.find((s) => s.movimientoId === datosPago.movimiento_id);
    x.estado = "pagado";
    x.pospuesto = false;
    x.montoRealCentavos = sugerido?.montoCentavos ?? (typeof datosPago.monto === "number" ? Math.round(datosPago.monto * 100) : x.montoCentavos);
    x.movimientoId = sugerido?.movimientoId ?? `mov-cobro-${x.id}`;
    x.confirmadoPor = "app";
    x.confirmadoEn = `${HOY}T18:30:00.000Z`;
    if ("cuenta_id" in datosPago) x.cuentaId = (datosPago.cuenta_id as string | null) ?? null;
    if (datosPago.actualizar_precio) x.montoCentavos = x.montoRealCentavos;
  };

  if (metodo === "POST" && ruta === "/v1/cobros/confirmar") {
    const ids = (b.ids as string[] | undefined) ?? [];
    const lista = ids.map((id) => d.lista.find((x) => x.id === id)).filter((x): x is CobroFalso => !!x);
    for (const x of lista) pagar(x);
    return json(200, { cobros: lista });
  }
  const m = ruta.match(/^\/v1\/cobros\/([\w-]+)\/(confirmar|posponer|saltar|deshacer)$/);
  const x = m ? d.lista.find((y) => y.id === m[1]) : undefined;
  if (m && !x) return json(400, { error: "Ese cobro no existe." });
  if (metodo !== "POST" || !m || !x) return json(404, { error: `Ruta falsa no definida: ${metodo} ${ruta}` });
  switch (m[2]) {
    case "confirmar":
      pagar(x, b);
      return json(200, { cobro: x });
    case "posponer":
      if (x.estado !== "pendiente") return json(400, { error: "Ese cobro ya no está pendiente." });
      x.pospuesto = true;
      return json(200, { cobro: x });
    case "saltar": {
      if (x.estado === "pagado") return json(400, { error: "Ese cobro ya está pagado; si no se pagó, primero deshazlo." });
      d.antes.set(x.id, { ...x });
      x.estado = "saltado";
      x.confirmadoPor = "app";
      // La renta tampoco se pagó el mes pasado: se ofrece pausarla.
      return json(200, { cobro: x, sugerirPausa: x.id === "cob-renta" });
    }
    case "deshacer": {
      const previo = d.antes.get(x.id);
      Object.assign(
        x,
        previo && previo.estado === "pendiente"
          ? previo
          : { estado: "pendiente", montoRealCentavos: null, movimientoId: null, confirmadoPor: null, confirmadoEn: null, pospuesto: false },
      );
      d.antes.delete(x.id);
      return json(200, { cobro: x });
    }
  }
}
