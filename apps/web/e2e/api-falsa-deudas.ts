import type { ApiFalsa } from "./api-falsa";

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

export type DatosDeudas = { prestamos: PrestamoFalso[]; siguiente: number };

const iso = (dia: string) => `${dia}T18:00:00.000Z`;

/** Como las de Pedro (15-oct): Mamá con abonos, Milton sin abonar, Juan que le debe y una ya saldada. */
export function deudasComoPedro(): DatosDeudas {
  return {
    siguiente: 1,
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
        direccion: "me_deben",
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

function personas(d: DatosDeudas) {
  const grupos = new Map<string, PrestamoFalso[]>();
  for (const p of vivos(d)) {
    const clave = `${normal(p.persona)}|${p.direccion}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
  }
  return [...grupos.values()].map((ps) => {
    const prestado = ps.reduce((s, p) => s + p.montoCentavos, 0);
    const pagadoTotal = ps.reduce((s, p) => s + pagado(p), 0);
    const movimientos = ps
      .flatMap((p) => [
        { tipo: "prestamo" as const, id: p.id, fecha: p.fecha, montoCentavos: p.montoCentavos, cuenta: p.cuenta, nota: p.descripcion },
        ...p.abonos.map((a) => ({ tipo: "abono" as const, id: a.id, fecha: a.fecha, montoCentavos: a.montoCentavos, cuenta: a.cuenta, nota: a.nota })),
      ])
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    return {
      persona: ps[0]!.persona,
      direccion: ps[0]!.direccion,
      prestadoCentavos: prestado,
      pagadoCentavos: pagadoTotal,
      pendienteCentavos: Math.max(0, prestado - pagadoTotal),
      desde: ps.map((p) => p.fecha).sort()[0]!,
      movimientos,
    };
  });
}

/** Lo que debe a personas y lo que le deben, para los totales de /v1/cuentas. */
export function totalesDeudas(d: DatosDeudas) {
  const suma = (dir: Direccion) => personas(d).filter((p) => p.direccion === dir).reduce((s, p) => s + p.pendienteCentavos, 0);
  return { deboPersonasCentavos: suma("debo"), meDebenCentavos: suma("me_deben") };
}

/** Devuelve undefined si la ruta no es de aquí. */
export async function atenderDeudas(api: ApiFalsa, { metodo, ruta, cuerpo, json }: Peticion): Promise<void | undefined> {
  const d = api.deudas;
  if (!d || !ruta.startsWith("/v1/prestamos")) return undefined;
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const centavos = (v: unknown) => Math.round(Number(v) * 100);
  const fechaDe = (v: unknown) => (typeof v === "string" && v ? iso(v.slice(0, 10)) : new Date().toISOString());

  if (metodo === "GET" && ruta === "/v1/prestamos") {
    const t = totalesDeudas(d);
    return json(200, { prestamos: vivos(d).map(prestamoApp), meDebenCentavos: t.meDebenCentavos, deboCentavos: t.deboPersonasCentavos, personas: personas(d) });
  }
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
      cuenta: typeof b.cuenta === "string" && b.cuenta ? b.cuenta : null,
      descripcion: typeof b.descripcion === "string" ? b.descripcion : null,
      abonos: [],
    };
    d.prestamos.push(p);
    return json(201, prestamoApp(p));
  }
  if (metodo === "POST" && ruta === "/v1/prestamos/abonos") {
    const monto = centavos(b.monto);
    const suyos = vivos(d)
      .filter((p) => p.direccion === b.direccion && normal(p.persona) === normal(String(b.persona ?? "")))
      .sort((x, y) => x.fecha.localeCompare(y.fecha));
    const falta = suyos.reduce((s, p) => s + p.montoCentavos - pagado(p), 0);
    if (!suyos.length) return json(404, { error: "No encontré esa deuda." });
    if (!(monto > 0) || monto > falta) return json(400, { error: "El abono es más de lo que falta." });
    // Al préstamo más viejo que aún deba.
    let resto = monto;
    for (const p of suyos) {
      const aqui = Math.min(resto, p.montoCentavos - pagado(p));
      if (aqui <= 0) continue;
      p.abonos.push({ id: `abo-n${d.siguiente++}`, fecha: fechaDe(b.fecha), montoCentavos: aqui, cuenta: typeof b.cuenta === "string" && b.cuenta ? b.cuenta : null, nota: typeof b.descripcion === "string" ? b.descripcion : null });
      resto -= aqui;
      if (!resto) break;
    }
    return json(201, { ok: true });
  }
  let m = ruta.match(/^\/v1\/prestamos\/abonos\/(.+)$/);
  if (metodo === "DELETE" && m) {
    for (const p of d.prestamos) p.abonos = p.abonos.filter((a) => a.id !== m?.[1]);
    return json(200, { ok: true });
  }
  m = ruta.match(/^\/v1\/prestamos\/([^/]+)\/restaurar$/);
  if (metodo === "POST" && m) {
    const p = d.prestamos.find((x) => x.id === m?.[1]);
    if (!p) return json(404, { error: "No encontrado." });
    p.eliminado = false;
    return json(200, prestamoApp(p));
  }
  m = ruta.match(/^\/v1\/prestamos\/([^/]+)$/);
  const p = m ? d.prestamos.find((x) => x.id === m?.[1] && !x.eliminado) : undefined;
  if (m && !p) return json(404, { error: "No encontrado." });
  if (metodo === "PATCH" && p) {
    if (typeof b.persona === "string" && b.persona.trim()) p.persona = b.persona.trim();
    if (b.direccion === "debo" || b.direccion === "me_deben") p.direccion = b.direccion;
    if (b.monto !== undefined) p.montoCentavos = centavos(b.monto);
    if (b.fecha !== undefined) p.fecha = fechaDe(b.fecha);
    if (b.descripcion !== undefined) p.descripcion = (b.descripcion as string | null) || null;
    return json(200, prestamoApp(p));
  }
  if (metodo === "DELETE" && p) {
    p.eliminado = true;
    return json(200, { ok: true });
  }
  return undefined;
}
