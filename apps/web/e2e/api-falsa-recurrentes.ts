import type { ApiFalsa } from "./api-falsa";

// Suscripciones y pagos fijos (GET /v1/recurrentes?todos=1, POST, PATCH y DELETE /v1/recurrentes/:id).
// Hoy es 6 de octubre de 2026. Sin conRecurrentes(), las rutas responden 404 como un servidor viejo.

type Estado = "activa" | "pausada" | "cancelada" | "archivada";
export type RecurrenteFalso = {
  id: string;
  nombre: string;
  tipo: string;
  montoCentavos: number;
  moneda: string;
  frecuencia: "semanal" | "quincenal" | "mensual" | "anual";
  dia: number;
  mes: number | null;
  categoriaId: string | null;
  categoria: string | null;
  cuentaId: string | null;
  cuenta: string | null;
  estado: Estado;
  estadoEn: string | null;
  creadoEn: string;
};

type Peticion = {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  consulta: URLSearchParams;
  json: (estado: number, datos: unknown) => Promise<void>;
};

const HOY = "2026-10-06";
const datos = new WeakMap<ApiFalsa, { lista: RecurrenteFalso[]; siguiente: number }>();

const r = (x: Partial<RecurrenteFalso> & Pick<RecurrenteFalso, "id" | "nombre" | "montoCentavos" | "dia">): RecurrenteFalso => ({
  tipo: "suscripcion",
  moneda: "MXN",
  frecuencia: "mensual",
  mes: null,
  categoriaId: null,
  categoria: null,
  cuentaId: null,
  cuenta: null,
  estado: "activa",
  estadoEn: null,
  creadoEn: "2026-09-01T12:00:00.000Z",
  ...x,
});

export function recurrentesIniciales(): RecurrenteFalso[] {
  return [
    r({ id: "rec-netflix", nombre: "Netflix", montoCentavos: 219_00, dia: 8, categoria: "Streaming", cuentaId: "cta-nu", cuenta: "Nu" }),
    r({ id: "rec-spotify", nombre: "Spotify", montoCentavos: 129_00, dia: 20, categoria: "Música" }),
    r({ id: "rec-renta", nombre: "Renta", tipo: "renta", montoCentavos: 9_500_00, dia: 1, categoria: "Renta" }),
    r({ id: "rec-icloud", nombre: "iCloud", montoCentavos: 49_00, dia: 15, estado: "pausada", estadoEn: "2026-10-01T12:00:00.000Z" }),
    r({ id: "rec-max", nombre: "Max", montoCentavos: 149_00, dia: 3, estado: "cancelada", estadoEn: "2026-09-20T12:00:00.000Z" }),
    r({ id: "rec-gym", nombre: "Gimnasio viejo", montoCentavos: 600_00, dia: 5, estado: "archivada", estadoEn: "2026-08-01T12:00:00.000Z" }),
  ];
}

export function conRecurrentes(api: ApiFalsa, lista = recurrentesIniciales()) {
  datos.set(api, { lista, siguiente: 1 });
  return api;
}

export function recurrentesDe(api: ApiFalsa) {
  return datos.get(api)?.lista ?? [];
}

const sumarDias = (iso: string, n: number) => {
  const f = new Date(`${iso}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().slice(0, 10);
};

function proximoCobro(x: RecurrenteFalso): string {
  const [a, m] = HOY.split("-").map(Number) as [number, number];
  const fecha = (anio: number, mes: number, dia: number) => `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  if (x.frecuencia === "semanal") {
    const hoy = (new Date(`${HOY}T12:00:00Z`).getUTCDay() + 6) % 7 + 1;
    return sumarDias(HOY, (x.dia - hoy + 7) % 7);
  }
  if (x.frecuencia === "anual") {
    const este = fecha(a, x.mes ?? m, x.dia);
    return este >= HOY ? este : fecha(a + 1, x.mes ?? m, x.dia);
  }
  const este = fecha(a, m, x.dia);
  return este >= HOY ? este : fecha(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1, x.dia);
}

const mensual = (x: RecurrenteFalso) =>
  x.frecuencia === "semanal" ? Math.round((x.montoCentavos * 52) / 12) : x.frecuencia === "quincenal" ? x.montoCentavos * 2 : x.frecuencia === "anual" ? Math.round(x.montoCentavos / 12) : x.montoCentavos;

const app = (x: RecurrenteFalso) => ({ ...x, proximoCobro: x.estado === "activa" ? proximoCobro(x) : null, mensualCentavos: mensual(x) });

export async function atenderRecurrentes(api: ApiFalsa, { metodo, ruta, cuerpo, consulta, json }: Peticion) {
  const d = datos.get(api);
  if (!d || !ruta.startsWith("/v1/recurrentes")) return;
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const cuentaDe = (id: unknown) => (typeof id === "string" ? (api.cuentas?.cuentas.find((c) => c.id === id)?.nombre ?? null) : null);

  if (metodo === "GET" && ruta === "/v1/recurrentes" && consulta.get("todos") === "1") {
    const orden = { activa: 0, pausada: 1, cancelada: 2, archivada: 3 };
    const lista = d.lista.map(app).sort((x, y) => orden[x.estado] - orden[y.estado] || (x.proximoCobro ?? "").localeCompare(y.proximoCobro ?? ""));
    const total = lista.filter((x) => x.estado === "activa" && x.tipo !== "ingreso").reduce((s, x) => s + x.mensualCentavos, 0);
    return json(200, { recurrentes: lista, mensualCentavos: total, moneda: "MXN" });
  }
  if (metodo === "POST" && ruta === "/v1/recurrentes") {
    const nuevo = r({
      id: `rec-nuevo-${d.siguiente++}`,
      nombre: String(b.nombre),
      tipo: String(b.tipo),
      montoCentavos: Math.round(Number(b.monto) * 100),
      frecuencia: b.frecuencia as RecurrenteFalso["frecuencia"],
      dia: Number(b.dia),
      mes: (b.mes as number | null) ?? null,
      cuentaId: (b.cuenta_id as string | null) ?? null,
      cuenta: cuentaDe(b.cuenta_id),
      creadoEn: `${HOY}T18:30:00.000Z`,
    });
    d.lista.push(nuevo);
    return json(201, app(nuevo));
  }
  const m = ruta.match(/^\/v1\/recurrentes\/([\w-]+)$/);
  const x = m ? d.lista.find((y) => y.id === m[1]) : undefined;
  if (m && !x) return json(400, { error: "Ese pago fijo no existe." });
  if (metodo === "PATCH" && x) {
    if (typeof b.nombre === "string") x.nombre = b.nombre;
    if (typeof b.tipo === "string") x.tipo = b.tipo;
    if (typeof b.monto === "number") x.montoCentavos = Math.round(b.monto * 100);
    if (typeof b.frecuencia === "string") x.frecuencia = b.frecuencia as RecurrenteFalso["frecuencia"];
    if (typeof b.dia === "number") x.dia = b.dia;
    if ("mes" in b) x.mes = (b.mes as number | null) ?? null;
    if ("cuenta_id" in b) {
      x.cuentaId = (b.cuenta_id as string | null) ?? null;
      x.cuenta = cuentaDe(b.cuenta_id);
    }
    if (typeof b.estado === "string" && b.estado !== x.estado) {
      x.estado = b.estado as Estado;
      x.estadoEn = `${HOY}T18:30:00.000Z`;
    }
    return json(200, app(x));
  }
  if (metodo === "DELETE" && x) {
    d.lista = d.lista.filter((y) => y !== x);
    return json(200, { ok: true });
  }
}
