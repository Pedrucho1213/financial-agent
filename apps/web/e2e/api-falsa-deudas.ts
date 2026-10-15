import { type ApiFalsa, HOY } from "./api-falsa";

// Deudas y préstamos con personas: alta a mano, abonos, editar, borrar y deshacer. Las deudas por persona se arman
// en cada GET a partir de los préstamos y sus abonos, como el servidor.

type Peticion = {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  json: (estado: number, datos: unknown) => Promise<void>;
};

type Direccion = "debo" | "me_deben";
type AbonoFalso = { id: string; fecha: string; montoCentavos: number; cuenta: string | null; nota: string | null };
export type PrestamoFalso = {
  id: string;
  persona: string;
  direccion: Direccion;
  montoCentavos: number;
  fecha: string;
  cuenta: string | null;
  descripcion: string | null;
  abonos: AbonoFalso[];
  eliminado?: boolean;
};

export type DatosDeudas = { prestamos: PrestamoFalso[]; siguiente: number; edicion: boolean; borradas: string[][] };

const iso = (dia: string) => `${dia}T18:00:00.000Z`;

/** Como las de Pedro (15-oct): Mamá con abonos, Milton sin abonar, Juan que le debe a él y una ya saldada. */
export function deudasComoPedro(): DatosDeudas {
  return {
    siguiente: 1,
    edicion: true,
    borradas: [],
    prestamos: [
      {
        id: "pres-mama",
        persona: "Mamá",
        direccion: "debo",
        montoCentavos: 38_733_00,
        fecha: iso("2026-07-02"),
        cuenta: "Revolut",
        descripcion: "Para el enganche",
        abonos: [
          { id: "abo-1", fecha: iso("2026-08-15"), montoCentavos: 2_000_00, cuenta: "Revolut", nota: null },
          { id: "abo-2", fecha: iso("2026-09-15"), montoCentavos: 2_000_00, cuenta: "Revolut", nota: null },
          { id: "abo-3", fecha: iso("2026-10-01"), montoCentavos: 2_000_00, cuenta: null, nota: "En efectivo" },
        ],
      },
      { id: "pres-milton", persona: "Milton Ventura", direccion: "debo", montoCentavos: 20_000_00, fecha: iso("2026-10-10"), cuenta: null, descripcion: null, abonos: [] },
      {
        id: "pres-juan",
        persona: "Juan",
        direccion: "me_deben",
        montoCentavos: 1_500_00,
        fecha: iso("2026-09-20"),
        cuenta: "Efectivo",
        descripcion: "Boletos del concierto",
        abonos: [{ id: "abo-4", fecha: iso("2026-09-28"), montoCentavos: 500_00, cuenta: null, nota: null }],
      },
      {
        id: "pres-caro",
        persona: "Caro",
        direccion: "debo",
        montoCentavos: 800_00,
        fecha: iso("2026-08-01"),
        cuenta: null,
        descripcion: "Cena",
        abonos: [{ id: "abo-5", fecha: iso("2026-08-20"), montoCentavos: 800_00, cuenta: null, nota: null }],
      },
    ],
  };
}

export function conDeudas(api: ApiFalsa, datos = deudasComoPedro()) {
  api.deudas = datos;
  return api;
}

const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const pagado = (p: PrestamoFalso) => p.abonos.reduce((s, a) => s + a.montoCentavos, 0);
const vivos = (d: DatosDeudas) => d.prestamos.filter((p) => !p.eliminado);

function prestamoApp(p: PrestamoFalso) {
  const pagadoCentavos = pagado(p);
  const pendienteCentavos = Math.max(0, p.montoCentavos - pagadoCentavos);
  const ultimo = p.abonos.at(-1)?.fecha ?? p.fecha;
  return {
    id: p.id,
    persona: p.persona,
    direccion: p.direccion,
    montoCentavos: p.montoCentavos,
    pagadoCentavos,
    pendienteCentavos,
    descripcion: p.descripcion,
    creadoEn: p.fecha,
    saldadoEn: pendienteCentavos === 0 ? ultimo : null,
  };
}

const clave = (p: Pick<PrestamoFalso, "persona" | "direccion">) => `${normal(p.persona)}|${p.direccion}`;

/** Las filas de cada deuda (persona y sentido), la más vieja primero. */
function grupos(d: DatosDeudas) {
  const g = new Map<string, PrestamoFalso[]>();
  for (const p of [...vivos(d)].sort((a, b) => a.fecha.localeCompare(b.fecha))) g.set(clave(p), [...(g.get(clave(p)) ?? []), p]);
  return [...g.values()];
}

function deudaApp(ps: PrestamoFalso[]) {
  const prestado = ps.reduce((s, p) => s + p.montoCentavos, 0);
  const pagadoTotal = ps.reduce((s, p) => s + pagado(p), 0);
  const pendiente = Math.max(0, prestado - pagadoTotal);
  const movimientos = ps
    .flatMap((p) => [
      { tipo: "prestamo" as const, fecha: p.fecha, montoCentavos: p.montoCentavos, cuenta: p.cuenta },
      ...p.abonos.map((a) => ({ tipo: "abono" as const, fecha: a.fecha, montoCentavos: a.montoCentavos, cuenta: a.cuenta })),
    ])
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  return {
    id: ps[0]!.id,
    persona: ps[0]!.persona,
    direccion: ps[0]!.direccion,
    prestadoCentavos: prestado,
    pagadoCentavos: pagadoTotal,
    pendienteCentavos: pendiente,
    desde: ps[0]!.fecha,
    saldada: pendiente === 0,
    descripcion: [...ps].reverse().find((p) => p.descripcion)?.descripcion ?? null,
    movimientos,
  };
}

/** Lo que debe a personas y lo que le deben, para `totales.personas` de /v1/cuentas. */
export function totalesDeudas(d: DatosDeudas) {
  const deudas = grupos(d).map(deudaApp);
  const suma = (dir: Direccion) => deudas.filter((p) => p.direccion === dir).reduce((s, p) => s + p.pendienteCentavos, 0);
  return { deboCentavos: suma("debo"), meDebenCentavos: suma("me_deben") };
}

/** Devuelve undefined si la ruta no es de aquí. */
export async function atenderDeudas(api: ApiFalsa, { metodo, ruta, cuerpo, consulta, json }: Peticion & { consulta: URLSearchParams }): Promise<void | undefined> {
  const d = api.deudas;
  if (!d) return undefined;
  if (metodo === "POST" && ruta === "/v1/deshacer") {
    const ids = d.borradas.pop();
    if (!ids) return undefined;
    for (const p of d.prestamos) if (ids.includes(p.id)) p.eliminado = false;
    return json(200, { deshecho: true, mensaje: "Listo, regresé la deuda." });
  }
  if (!ruta.startsWith("/v1/prestamos")) return undefined;
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const centavos = (v: unknown) => Math.round(Number(v) * 100);
  const fechaDe = (v: unknown) => (typeof v === "string" && v ? iso(v.slice(0, 10)) : iso(HOY));
  const cuentaDe = (id: unknown) => (typeof id === "string" ? (api.cuentas?.cuentas.find((c) => c.id === id)?.nombre ?? null) : null);

  if (metodo === "GET" && ruta === "/v1/prestamos") {
    const todos = consulta.get("todos") === "1";
    const t = totalesDeudas(d);
    const personas = grupos(d)
      .map(deudaApp)
      .filter((x) => todos || !x.saldada);
    return json(200, {
      prestamos: vivos(d).map(prestamoApp).filter((p) => todos || !p.saldadoEn),
      meDebenCentavos: t.meDebenCentavos,
      deboCentavos: t.deboCentavos,
      edicion: d.edicion,
      personas,
    });
  }
  if (!d.edicion) return json(404, { error: "No encontrado." });
  if (metodo === "POST" && ruta === "/v1/prestamos") {
    const persona = typeof b.persona === "string" ? b.persona.trim() : "";
    const monto = centavos(b.monto);
    if (!persona || !(monto > 0)) return json(400, { error: "Dime a quién y cuánto." });
    const p: PrestamoFalso = {
      id: `pres-n${d.siguiente++}`,
      persona,
      direccion: b.direccion === "me_deben" ? "me_deben" : "debo",
      montoCentavos: monto,
      fecha: fechaDe(b.fecha),
      cuenta: cuentaDe(b.cuenta_id),
      descripcion: typeof b.descripcion === "string" ? b.descripcion : null,
      abonos: [],
    };
    // Con la misma persona y sentido se suma a su deuda (mismo nombre que la que ya estaba).
    const misma = vivos(d).find((x) => clave(x) === clave(p));
    if (misma) p.persona = misma.persona;
    d.prestamos.push(p);
    return json(201, deudaApp(grupos(d).find((g) => g.includes(p))!));
  }
  const m = ruta.match(/^\/v1\/prestamos\/([^/]+)(\/abonos)?$/);
  const filas = m ? grupos(d).find((g) => g.some((p) => p.id === m[1])) : undefined;
  if (!m || !filas) return json(404, { error: "No encontrado." });
  const deuda = deudaApp(filas);

  if (metodo === "POST" && m[2]) {
    const monto = b.monto === undefined ? deuda.pendienteCentavos : centavos(b.monto);
    if (deuda.saldada) return json(400, { error: "Esa deuda ya está saldada." });
    if (!(monto > 0)) return json(400, { error: "El monto tiene que ser mayor a cero." });
    if (monto > deuda.pendienteCentavos) return json(400, { error: `Solo quedan $${deuda.pendienteCentavos / 100} pendientes.` });
    let resto = monto;
    for (const p of filas) {
      const aqui = Math.min(resto, p.montoCentavos - pagado(p));
      if (aqui <= 0) continue;
      p.abonos.push({ id: `abo-n${d.siguiente++}`, fecha: iso(HOY), montoCentavos: aqui, cuenta: cuentaDe(b.cuenta_id), nota: null });
      resto -= aqui;
      if (!resto) break;
    }
    return json(200, deudaApp(filas));
  }
  if (metodo === "PATCH" && !m[2]) {
    if (b.monto !== undefined && b.pendiente !== undefined) return json(400, { error: "Manda el total o lo pendiente, no los dos." });
    const total =
      b.monto !== undefined ? centavos(b.monto) : b.pendiente !== undefined ? deuda.pagadoCentavos + centavos(b.pendiente) : deuda.prestadoCentavos;
    if (total < deuda.pagadoCentavos) return json(400, { error: "No puede quedar debajo de lo ya abonado." });
    // La diferencia va al préstamo más nuevo.
    const ultimo = filas.at(-1)!;
    ultimo.montoCentavos += total - deuda.prestadoCentavos;
    for (const p of filas) {
      if (typeof b.persona === "string" && b.persona.trim()) p.persona = b.persona.trim();
      if (b.direccion === "debo" || b.direccion === "me_deben") p.direccion = b.direccion;
    }
    if (b.descripcion !== undefined) ultimo.descripcion = (b.descripcion as string | null) || null;
    return json(200, deudaApp(filas));
  }
  if (metodo === "DELETE" && !m[2]) {
    for (const p of filas) p.eliminado = true;
    d.borradas.push(filas.map((p) => p.id));
    return json(200, { ok: true, persona: deuda.persona, pendienteCentavos: deuda.pendienteCentavos });
  }
  return undefined;
}
