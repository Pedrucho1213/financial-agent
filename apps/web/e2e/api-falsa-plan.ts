import { type ApiFalsa, CATEGORIAS, HOY } from "./api-falsa";

// Presupuestos, metas, préstamos, MSI y "disponible hoy", con las formas que acordó el hilo de la IA (docs/api.md).

type Peticion = {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  consulta: URLSearchParams;
  json: (estado: number, datos: unknown) => Promise<void>;
};

export type PresupuestoFalso = { id: string; categoriaId: string | null; limiteCentavos: number };
export type MetaFalsa = { id: string; nombre: string; objetivoCentavos: number; ahorradoCentavos: number; fechaLimite: string | null };

export function planInicial() {
  return {
    avisos: [
      {
        id: "av-1",
        tipo: "hormiga" as const,
        titulo: "Gastos hormiga en Oxxo",
        texto: "Llevas $136 en 3 visitas este mes. Al año serían unos $8,200.",
        fecha: "2026-10-06",
        vence: null,
        prioridad: 2 as const,
        enlace: "#movimientos?texto=Oxxo",
        leidoEn: null as string | null,
      },
      {
        id: "av-2",
        tipo: "presupuesto" as const,
        titulo: "Te pasaste en Entretenimiento",
        texto: "Llevas $278 de $250 y apenas va el día 6.",
        fecha: "2026-10-06",
        vence: null,
        prioridad: 1 as const,
        enlace: "#presupuestos",
        leidoEn: null as string | null,
      },
    ],
    presupuestos: [
      { id: "pre-1", categoriaId: null, limiteCentavos: 30_000_00 },
      { id: "pre-2", categoriaId: "cat-comida", limiteCentavos: 3_000_00 },
      { id: "pre-3", categoriaId: "cat-entretenimiento", limiteCentavos: 250_00 },
    ] as PresupuestoFalso[],
    metas: [
      { id: "meta-1", nombre: "Viaje a Japón", objetivoCentavos: 60_000_00, ahorradoCentavos: 21_500_00, fechaLimite: "2027-04-01" },
      { id: "meta-2", nombre: "Fondo de emergencia", objetivoCentavos: 40_000_00, ahorradoCentavos: 40_000_00, fechaLimite: null },
    ] as MetaFalsa[],
    prestamos: [
      {
        id: "pres-1",
        persona: "Juan",
        direccion: "me_deben" as const,
        montoCentavos: 1_500_00,
        pagadoCentavos: 500_00,
        pendienteCentavos: 1_000_00,
        descripcion: "Boletos del concierto",
        creadoEn: "2026-09-20T18:00:00.000Z",
        saldadoEn: null,
      },
    ],
    msi: {
      compras: [
        {
          id: "msi-1",
          descripcion: "iPhone 17 Pro Max",
          totalCentavos: 32_999_00,
          meses: 12,
          mensualidadCentavos: 2_749_92,
          primerCargo: "2026-07-15",
          pagadas: 3,
          restanteCentavos: 24_749_25,
          proximoCargo: "2026-10-15",
          cuenta: "BBVA",
        },
      ],
      mensualCentavos: 2_749_92,
    },
  };
}

// api-falsa.ts importa este archivo: HOY se lee al usarse, no al cargar.
const DIAS_DEL_MES = 31;
const diaDeHoy = () => Number(HOY.slice(8, 10));

function presupuestoApp(api: ApiFalsa, p: PresupuestoFalso, mes: string) {
  const cat = CATEGORIAS.find((c) => c.id === p.categoriaId) ?? null;
  const ids = cat ? new Set([cat.id, ...CATEGORIAS.filter((c) => c.padreId === cat.id).map((c) => c.id)]) : null;
  const gastado = api.movimientos
    .filter((m) => m.tipo === "gasto" && m.fecha.startsWith(mes) && (!ids || (m.categoriaId && ids.has(m.categoriaId))))
    .reduce((s, m) => s + m.montoCentavos, 0);
  const porcentaje = Math.round((gastado / p.limiteCentavos) * 100);
  return {
    id: p.id,
    categoriaId: p.categoriaId,
    categoria: cat?.nombreCompleto ?? "General",
    limiteCentavos: p.limiteCentavos,
    gastadoCentavos: gastado,
    restanteCentavos: p.limiteCentavos - gastado,
    porcentaje,
    proyeccionCentavos: Math.round((gastado / diaDeHoy()) * DIAS_DEL_MES),
    estado: porcentaje > 100 ? "excedido" : porcentaje >= 85 ? "cerca" : "bien",
  };
}

function metaApp(m: MetaFalsa) {
  const falta = Math.max(0, m.objetivoCentavos - m.ahorradoCentavos);
  const meses = m.fechaLimite ? Math.max(1, Math.ceil((Date.parse(m.fechaLimite) - Date.parse(HOY)) / (30 * 86_400_000))) : null;
  return {
    ...m,
    porcentaje: Math.round((m.ahorradoCentavos / m.objetivoCentavos) * 100),
    mensualSugeridoCentavos: meses && falta ? Math.ceil(falta / meses) : null,
    completada: falta === 0,
  };
}

/** Devuelve undefined si la ruta no es de aquí. */
export async function atenderPlan(api: ApiFalsa, { metodo, ruta, cuerpo, consulta, json }: Peticion): Promise<void | undefined> {
  const plan = api.plan;
  if (api.sinPlan && /^\/v1\/(presupuestos|metas|disponible|prestamos|msi|avisos)\b/.test(ruta)) {
    return json(404, { error: "No existe." });
  }
  if (metodo === "GET" && ruta === "/v1/presupuestos") {
    const mes = consulta.get("mes") ?? HOY.slice(0, 7);
    const lista = plan.presupuestos.map((p) => presupuestoApp(api, p, mes));
    const global = lista.find((p) => p.categoriaId === null);
    return json(200, {
      mes,
      hoy: HOY,
      diasDelMes: DIAS_DEL_MES,
      diaDelMes: diaDeHoy(),
      presupuestos: lista,
      total: {
        limiteCentavos: global?.limiteCentavos ?? lista.reduce((s, p) => s + p.limiteCentavos, 0),
        gastadoCentavos: global?.gastadoCentavos ?? lista.reduce((s, p) => s + p.gastadoCentavos, 0),
      },
    });
  }
  if (metodo === "PUT" && ruta === "/v1/presupuestos") {
    const b = cuerpo as { categoria_id: string | null; limite: number };
    const limiteCentavos = Math.round(Number(b.limite) * 100);
    if (!(limiteCentavos > 0)) return json(400, { error: "El tope tiene que ser mayor a cero." });
    const existente = plan.presupuestos.find((p) => p.categoriaId === (b.categoria_id ?? null));
    if (existente) existente.limiteCentavos = limiteCentavos;
    else plan.presupuestos.push({ id: `pre-${plan.presupuestos.length + 10}`, categoriaId: b.categoria_id ?? null, limiteCentavos });
    const p = plan.presupuestos.find((x) => x.categoriaId === (b.categoria_id ?? null));
    return json(200, p ? presupuestoApp(api, p, HOY.slice(0, 7)) : null);
  }
  let m = ruta.match(/^\/v1\/presupuestos\/(.+)$/);
  if (metodo === "DELETE" && m) {
    plan.presupuestos = plan.presupuestos.filter((p) => p.id !== m?.[1]);
    return json(200, { ok: true });
  }

  if (metodo === "GET" && ruta === "/v1/metas") return json(200, { metas: plan.metas.map(metaApp) });
  if (metodo === "POST" && ruta === "/v1/metas") {
    const b = cuerpo as { nombre: string; objetivo: number; ahorrado?: number; fecha_limite?: string };
    const meta: MetaFalsa = {
      id: `meta-${plan.metas.length + 10}`,
      nombre: b.nombre,
      objetivoCentavos: Math.round(b.objetivo * 100),
      ahorradoCentavos: Math.round((b.ahorrado ?? 0) * 100),
      fechaLimite: b.fecha_limite ?? null,
    };
    plan.metas.push(meta);
    return json(201, metaApp(meta));
  }
  m = ruta.match(/^\/v1\/metas\/([^/]+)(\/aportes)?$/);
  if (m) {
    const meta = plan.metas.find((x) => x.id === m?.[1]);
    if (!meta) return json(404, { error: "No existe esa meta." });
    if (metodo === "POST" && m[2]) {
      const monto = Math.round(Number((cuerpo as { monto: number }).monto) * 100);
      if (meta.ahorradoCentavos + monto < 0) return json(400, { error: "No puedes sacar más de lo que llevas." });
      meta.ahorradoCentavos += monto;
      return json(200, metaApp(meta));
    }
    if (metodo === "PATCH") {
      const b = cuerpo as { nombre?: string; objetivo?: number; fecha_limite?: string | null };
      if (b.nombre !== undefined) meta.nombre = b.nombre;
      if (b.objetivo !== undefined) meta.objetivoCentavos = Math.round(b.objetivo * 100);
      if (b.fecha_limite !== undefined) meta.fechaLimite = b.fecha_limite;
      return json(200, metaApp(meta));
    }
    if (metodo === "DELETE") {
      plan.metas = plan.metas.filter((x) => x.id !== meta.id);
      return json(200, { ok: true });
    }
  }

  if (metodo === "GET" && ruta === "/v1/avisos") return json(200, { avisos: plan.avisos.filter((a) => !a.leidoEn) });
  m = ruta.match(/^\/v1\/avisos\/([^/]+)\/(leido|descartar)$/);
  if (metodo === "POST" && m) {
    const aviso = plan.avisos.find((a) => a.id === m?.[1]);
    if (!aviso) return json(404, { error: "No existe ese aviso." });
    if (m[2] === "descartar") {
      plan.avisos = plan.avisos.filter((a) => a !== aviso);
      return json(200, { ok: true });
    }
    aviso.leidoEn = "2026-10-06T18:31:00.000Z";
    return json(200, aviso);
  }

  if (metodo === "GET" && ruta === "/v1/prestamos") {
    const pendientes = plan.prestamos.filter((p) => !p.saldadoEn);
    const suma = (d: string) => pendientes.filter((p) => p.direccion === d).reduce((s, p) => s + p.pendienteCentavos, 0);
    return json(200, { prestamos: plan.prestamos, meDebenCentavos: suma("me_deben"), deboCentavos: suma("debo") });
  }
  if (metodo === "GET" && ruta === "/v1/msi") return json(200, plan.msi);
  if (metodo === "GET" && ruta === "/v1/disponible") {
    const global = plan.presupuestos.find((p) => p.categoriaId === null);
    if (!global) return json(200, { hoy: HOY, diasRestantes: 26, porDiaCentavos: 0, disponibleHoyCentavos: 0, libreMesCentavos: 0, base: null, ingresosCentavos: 0, gastadoCentavos: 0, comprometidoCentavos: 0 });
    const g = presupuestoApp(api, global, HOY.slice(0, 7));
    const comprometido = 2_749_92;
    const libre = Math.max(0, g.restanteCentavos - comprometido);
    const dias = DIAS_DEL_MES - diaDeHoy() + 1;
    return json(200, {
      hoy: HOY,
      diasRestantes: dias,
      porDiaCentavos: Math.floor(libre / dias),
      disponibleHoyCentavos: Math.floor(libre / dias),
      libreMesCentavos: libre,
      base: "presupuestos",
      ingresosCentavos: 18_750_00,
      gastadoCentavos: g.gastadoCentavos,
      comprometidoCentavos: comprometido,
    });
  }
  return undefined;
}
