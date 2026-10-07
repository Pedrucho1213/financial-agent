import type { Page, Route } from "@playwright/test";
import { atenderCuenta } from "./api-falsa-cuenta";
import { atenderPlan, planInicial } from "./api-falsa-plan";

// API falsa que sigue docs/api.md, para probar la app sin el servidor.

export const HOY = "2026-10-06";
export const TOKEN = "fa_prueba_123";

type Tipo = "gasto" | "ingreso" | "transferencia" | "pago_tarjeta";
type Origen = "voz" | "app" | "apple_pay" | "importacion";

export type MovimientoApp = {
  id: string;
  fecha: string;
  ocurridoEn: string;
  tipo: Tipo;
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

type Categoria = {
  id: string;
  nombre: string;
  nombreCompleto: string;
  padreId: string | null;
  tipo: "gasto" | "ingreso";
  naturaleza: "necesidad" | "gusto" | "ahorro" | null;
};

const SEMILLAS_GASTO: [string, string[]][] = [
  ["Vivienda", ["Renta", "Luz", "Agua", "Gas", "Internet y teléfono", "Mantenimiento"]],
  ["Comida", ["Súper", "Restaurantes", "Café", "Antojos", "Delivery"]],
  ["Transporte", ["Gasolina", "Taxi y apps", "Transporte público", "Estacionamiento", "Casetas", "Auto"]],
  ["Salud", ["Médico", "Farmacia", "Seguro", "Gimnasio"]],
  ["Suscripciones", ["Streaming", "Música", "Software", "Otras suscripciones"]],
  ["Entretenimiento", ["Cine", "Salidas", "Juegos", "Eventos"]],
  ["Compras", ["Ropa y calzado", "Electrónica", "Hogar"]],
  ["Cuidado personal", []],
  ["Educación", []],
  ["Otros gastos", []],
];
const SEMILLAS_INGRESO = ["Sueldo", "Freelance", "Reembolsos", "Otros ingresos"];

function slug(t: string) {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-");
}

export const CATEGORIAS: Categoria[] = [
  ...SEMILLAS_GASTO.flatMap(([padre, hijas]) => [
    { id: `cat-${slug(padre)}`, nombre: padre, nombreCompleto: padre, padreId: null, tipo: "gasto" as const, naturaleza: null },
    ...hijas.map((h) => ({
      id: `cat-${slug(h)}`,
      nombre: h,
      nombreCompleto: `${padre} > ${h}`,
      padreId: `cat-${slug(padre)}`,
      tipo: "gasto" as const,
      naturaleza: null,
    })),
  ]),
  ...SEMILLAS_INGRESO.map((n) => ({
    id: `cat-${slug(n)}`,
    nombre: n,
    nombreCompleto: n,
    padreId: null,
    tipo: "ingreso" as const,
    naturaleza: null,
  })),
];

function cat(nombre: string) {
  const c = CATEGORIAS.find((x) => x.nombre === nombre);
  if (!c) throw new Error(`Categoría ${nombre}`);
  return c;
}

let siguienteId = 1;
function mov(
  fecha: string,
  tipo: Tipo,
  pesos: number,
  categoria: string | null,
  comercio: string | null,
  extra: Partial<MovimientoApp> = {},
): MovimientoApp {
  const c = categoria ? cat(categoria) : null;
  const centavos = Math.round(pesos * 100);
  const id = `mov-${String(siguienteId++).padStart(3, "0")}`;
  return {
    id,
    fecha,
    ocurridoEn: `${fecha}T${String(8 + (siguienteId % 12)).padStart(2, "0")}:${String((siguienteId * 7) % 60).padStart(2, "0")}:00-06:00`,
    tipo,
    montoCentavos: centavos,
    monto: (centavos / 100).toFixed(2),
    moneda: "MXN",
    categoriaId: c?.id ?? null,
    categoria: c?.nombreCompleto ?? null,
    comercio,
    descripcion: null,
    cuenta: null,
    lugar: null,
    lat: null,
    lon: null,
    origen: "voz",
    textoOriginal: null,
    revisar: false,
    ...extra,
  };
}

export function movimientosIniciales(): MovimientoApp[] {
  siguienteId = 1;
  return [
    mov("2026-10-06", "gasto", 85, "Café", "Starbucks", {
      textoOriginal: "gasté 85 en un café en el Starbucks de Reforma",
      cuenta: "BBVA",
      lugar: "Starbucks Reforma",
      lat: 19.427,
      lon: -99.1677,
    }),
    mov("2026-10-06", "gasto", 132.5, "Taxi y apps", "Uber", { textoOriginal: "uber de 132.50 a la oficina" }),
    mov("2026-10-06", "gasto", 52, "Antojos", "Oxxo", { textoOriginal: "52 en el oxxo", lat: 19.4205, lon: -99.163 }),
    mov("2026-10-05", "gasto", 1245.9, "Súper", "Walmart", { textoOriginal: "súper en walmart 1245.90", cuenta: "Nu", lat: 19.396, lon: -99.156 }),
    mov("2026-10-05", "gasto", 46, "Antojos", "Oxxo", { textoOriginal: "46 de unas papas en el oxxo", lat: 19.4206, lon: -99.1631 }),
    mov("2026-10-05", "gasto", 129, "Música", "Spotify", { origen: "importacion" }),
    mov("2026-10-04", "gasto", 486, "Restaurantes", "La Casa de Toño", { textoOriginal: "cenamos en la casa de toño, 486", lat: 19.415, lon: -99.169 }),
    mov("2026-10-04", "gasto", 38, "Antojos", "Oxxo", { textoOriginal: "un agua en el oxxo 38" }),
    mov("2026-10-03", "gasto", 900, "Gasolina", "Pemex", { origen: "apple_pay", cuenta: "BBVA", lat: 19.44, lon: -99.19 }),
    mov("2026-10-03", "gasto", 278, "Cine", "Cinépolis", { textoOriginal: "cine 278" }),
    mov("2026-10-03", "transferencia", 2000, null, null, { descripcion: "Traspaso a ahorro", origen: "app", cuenta: "Nu" }),
    mov("2026-10-02", "gasto", 299, "Streaming", "Netflix", { origen: "importacion" }),
    mov("2026-10-02", "gasto", 214.3, "Farmacia", "Farmacia San Pablo", {
      textoOriginal: "farmacia 214 con 30",
      revisar: true,
    }),
    mov("2026-10-02", "gasto", 349, "Internet y teléfono", "Telcel", { textoOriginal: "recarga telcel 349", revisar: true }),
    mov("2026-10-01", "gasto", 12500, "Renta", null, { descripcion: "Renta de octubre", origen: "app" }),
    mov("2026-10-01", "ingreso", 18750, "Sueldo", null, { descripcion: "Quincena", textoOriginal: "me cayó la quincena, 18750" }),
    mov("2026-09-28", "gasto", 640, "Salidas", "Bar El Depósito", { textoOriginal: "640 en el depósito" }),
    mov("2026-09-27", "gasto", 750, "Farmacia", "Farmacia Guadalajara"),
    mov("2026-09-26", "gasto", 1890.4, "Súper", "Costco"),
    mov("2026-09-24", "gasto", 645.5, "Luz", "CFE"),
    mov("2026-09-21", "gasto", 310, "Cine", "Cinemex"),
    mov("2026-09-18", "gasto", 1105.6, "Súper", "Soriana"),
    mov("2026-09-15", "ingreso", 18750, "Sueldo", null, { descripcion: "Quincena" }),
    mov("2026-09-15", "gasto", 499, "Gimnasio", "Sports World"),
    mov("2026-09-12", "gasto", 1240, "Restaurantes", "Contramar"),
    mov("2026-09-10", "gasto", 900, "Gasolina", "Shell"),
    mov("2026-09-08", "gasto", 2350, "Ropa y calzado", "Liverpool"),
    // Hasta el 6 de septiembre suman $13,980 (gastadoMesAnteriorMismaFechaCentavos); el mes, $24,310.50.
    mov("2026-09-05", "gasto", 201, "Taxi y apps", "DiDi"),
    mov("2026-09-03", "gasto", 980, "Súper", "Soriana"),
    mov("2026-09-02", "gasto", 299, "Streaming", "Netflix", { origen: "importacion" }),
    mov("2026-09-01", "gasto", 12500, "Renta", null, { descripcion: "Renta de septiembre", origen: "app" }),
  ];
}

type Peticion = { metodo: string; ruta: string; cuerpo: unknown; consulta: URLSearchParams; autorizacion?: string };

/** Vigencia del archivo del Atajo: 10 minutos después de la hora fija de las pruebas. */
/** PNG de 1×1 gris claro para los mosaicos del mapa. */
const MOSAICO = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8+/fvfwAJ+gP9Tq3W0wAAAABJRU5ErkJggg==";

export const ATAJO_EXPIRA = "2026-10-06T18:40:00.000Z";

export class ApiFalsa {
  movimientos = movimientosIniciales();
  dispositivos = [
    { id: "dis-1", nombre: "iPhone 17 Pro Max", creadoEn: "2026-09-20T18:00:00.000Z", ultimoUso: "2026-10-06T17:40:00.000Z", actual: true },
    { id: "dis-2", nombre: "Atajo", creadoEn: "2026-09-21T02:00:00.000Z", ultimoUso: "2026-10-06T16:05:00.000Z", actual: false },
    { id: "dis-3", nombre: "MacBook Pro", creadoEn: "2026-09-22T03:00:00.000Z", ultimoUso: "2026-10-04T01:30:00.000Z", actual: false },
  ];
  peticiones: Peticion[] = [];
  eliminados: MovimientoApp[] = [];
  /** Respuestas en orden para /v1/entradas/:client_id. */
  entradas: object[] = [];
  /** Respuesta para POST /v1/hablar: [estado, cuerpo]. */
  hablar: [number, object] = [200, { respuesta: "Listo.", conversacion_id: "conv-1", acciones: [] }];
  /**
   * Cómo fallan los próximos POST /v1/hablar, en orden (después responden normal), como el servidor real:
   * - "corte": la Mac lo recibe y lo termina, pero la conexión se cae antes de responder.
   * - "perdido": la petición nunca llega a la Mac.
   * - "procesando": 409, ese client_id ya se está procesando (y termina enseguida).
   * - "ia": 503, la IA no respondió; reenviarlo con el mismo client_id lo procesa de nuevo.
   */
  fallasHablar: ("corte" | "perdido" | "procesando" | "ia")[] = [];
  /** Lo que la Mac sabe de cada dictado, por client_id (lo que responde /v1/entradas/:client_id). */
  dictados = new Map<string, { estado: "procesando" | "listo" | "error"; respuesta?: object }>();
  /** Códigos de invitación ya canjeados (responden 410). */
  usados = new Set<string>();
  /** Cuántas de las próximas firmas del Atajo fallan con 501 (el código sigue sirviendo). */
  fallasFirma = 0;
  private atajos = 0;
  /** Presupuestos, metas, préstamos y MSI (ver api-falsa-plan.ts). */
  plan = planInicial();
  /** Datos de la cuenta que se pueden cambiar en Ajustes (ver api-falsa-cuenta.ts). */
  cuenta = { nombre: "Pedro Ramírez", usuario: "pedro", tieneCodigo: false, codigo: null as string | null };

  async instalar(page: Page) {
    await page.route(/\/v1\//, (route) => this.atender(route));
    // Los mosaicos del mapa no salen a internet en las pruebas: un cuadro liso.
    await page.route(/basemaps\.cartocdn\.com/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(MOSAICO, "base64") }),
    );
    // El archivo del Atajo llega como descarga, igual que en el servidor: la página no se va.
    await page.route(/\/atajo\/[\w-]+\.shortcut$/, (route) => {
      const url = new URL(route.request().url());
      this.peticiones.push({ metodo: route.request().method(), ruta: url.pathname, cuerpo: null, consulta: url.searchParams });
      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "Content-Disposition": 'attachment; filename="Finanzas.shortcut"', "Cache-Control": "no-store" },
        body: "atajo",
      });
    });
  }

  de(metodo: string, ruta: string | RegExp) {
    return this.peticiones.filter((p) => p.metodo === metodo && (typeof ruta === "string" ? p.ruta === ruta : ruta.test(p.ruta)));
  }

  private async atender(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const metodo = req.method();
    const ruta = url.pathname;
    let cuerpo: unknown = null;
    try {
      cuerpo = req.postDataJSON();
    } catch {
      cuerpo = null;
    }
    this.peticiones.push({ metodo, ruta, cuerpo, consulta: url.searchParams, autorizacion: req.headers().authorization });
    const json = (estado: number, datos: unknown) =>
      route.fulfill({ status: estado, contentType: "application/json", body: JSON.stringify(datos) });

    // Usuario, código y estado del sistema: api-falsa-cuenta.ts.
    // Cada módulo responde con `responder`; si no respondió, la ruta no era suya.
    let respondido = false;
    const responder = (estado: number, datos: unknown) => {
      respondido = true;
      return json(estado, datos);
    };
    await atenderCuenta(this, { metodo, ruta, cuerpo, autorizado: req.headers().authorization === `Bearer ${TOKEN}`, json: responder });
    if (respondido) return;

    // Públicas
    let m = ruta.match(/^\/v1\/invitaciones\/([A-Z0-9]+)$/);
    if (metodo === "GET" && m) {
      const codigo = m[1];
      if (codigo === "ABC123") return json(200, { para: "usuario" });
      if (codigo === "DEV456") return json(200, { para: "dispositivo", nombre: "Pedro" });
      if (codigo === "VIEJO1" || this.usados.has(codigo ?? "")) return json(410, { error: "La invitación ya se usó o venció." });
      if (codigo === "MUCHOS") return json(429, { error: "Demasiados intentos." });
      return json(404, { error: "No existe esa invitación." });
    }
    if (metodo === "POST" && ruta === "/v1/registro") {
      const b = cuerpo as { codigo: string; nombre?: string; dispositivo: string };
      return json(201, {
        token: TOKEN,
        usuario: { id: "usr-1", nombre: b.nombre ?? "Pedro" },
        dispositivo: { id: "dis-9", nombre: b.dispositivo },
      });
    }

    if (metodo === "POST" && ruta === "/v1/atajo/canjear") {
      const b = (cuerpo ?? {}) as { codigo?: string; servidor?: string };
      const codigo = String(b.codigo ?? "").toUpperCase();
      if (!codigo || !b.servidor) return json(400, { error: "Faltan el código o la dirección del servidor." });
      if (codigo === "VIEJO1" || this.usados.has(codigo)) return json(410, { error: "La invitación ya se usó o venció." });
      if (codigo === "MUCHOS") return json(429, { error: "Demasiados intentos." });
      if (codigo === "ABC123") return json(400, { error: "Ese código es para crear una cuenta." });
      if (codigo !== "DEV456") return json(404, { error: "No existe esa invitación." });
      if (this.fallasFirma > 0) {
        this.fallasFirma -= 1;
        return json(501, { error: "Esta computadora no puede firmar Atajos.", detalle: "shortcuts sign terminó con error" });
      }
      this.usados.add(codigo);
      return json(201, { url: `/atajo/${this.nuevoAtajo()}.shortcut`, expiraEn: ATAJO_EXPIRA, nombre: "Pedro" });
    }

    if (req.headers().authorization !== `Bearer ${TOKEN}`) return json(401, { error: "Token inválido." });

    if (metodo === "POST" && ruta === "/v1/atajo") {
      return json(201, { url: `/atajo/${this.nuevoAtajo()}.shortcut`, expiraEn: ATAJO_EXPIRA });
    }

    if (metodo === "GET" && ruta === "/v1/yo") {
      return json(200, {
        usuario: { id: "usr-1", nombre: this.cuenta.nombre, usuario: this.cuenta.usuario, tieneCodigo: this.cuenta.tieneCodigo },
        dispositivo: { id: "dis-1", nombre: "iPhone 17 Pro Max" },
        dispositivos: this.dispositivos,
        moneda: "MXN",
        zonaHoraria: "America/Mexico_City",
        hoy: HOY,
      });
    }
    if (metodo === "POST" && ruta === "/v1/invitaciones") {
      const b = cuerpo as { para: "usuario" | "dispositivo" };
      return json(201, { codigo: "K7M2QX", para: b.para, expiraEn: "2026-10-08T00:15:00.000Z" });
    }
    m = ruta.match(/^\/v1\/dispositivos\/(.+)$/);
    if (metodo === "DELETE" && m) {
      this.dispositivos = this.dispositivos.filter((d) => d.id !== m?.[1]);
      return json(200, { ok: true });
    }
    await atenderPlan(this, { metodo, ruta, cuerpo, consulta: url.searchParams, json: responder });
    if (respondido) return;
    if (metodo === "GET" && ruta === "/v1/categorias") return json(200, { categorias: CATEGORIAS });
    if (metodo === "GET" && ruta === "/v1/movimientos") return json(200, this.buscar(url.searchParams));
    if (metodo === "POST" && ruta === "/v1/movimientos") {
      const b = cuerpo as Record<string, unknown>;
      const c = CATEGORIAS.find((x) => x.id === b.categoria_id) ?? null;
      const nuevo = mov((b.fecha as string) ?? HOY, b.tipo as Tipo, Number(b.monto), c?.nombre ?? null, (b.comercio as string) ?? null, {
        origen: "app",
        descripcion: (b.descripcion as string) ?? null,
        cuenta: (b.cuenta as string) ?? null,
      });
      nuevo.id = `mov-nuevo-${this.movimientos.length}`;
      this.movimientos.unshift(nuevo);
      return json(201, nuevo);
    }
    m = ruta.match(/^\/v1\/movimientos\/(.+)$/);
    if (m) {
      const i = this.movimientos.findIndex((x) => x.id === m?.[1]);
      const actual = this.movimientos[i];
      if (!actual) return json(404, { error: "No existe ese movimiento." });
      if (metodo === "GET") return json(200, actual);
      if (metodo === "PATCH") {
        const b = cuerpo as Record<string, unknown>;
        const c = "categoria_id" in b ? (CATEGORIAS.find((x) => x.id === b.categoria_id) ?? null) : undefined;
        const centavos = b.monto !== undefined ? Math.round(Number(b.monto) * 100) : actual.montoCentavos;
        const editado: MovimientoApp = {
          ...actual,
          ...(b.tipo ? { tipo: b.tipo as Tipo } : {}),
          ...(b.fecha ? { fecha: b.fecha as string } : {}),
          ...("comercio" in b ? { comercio: b.comercio as string | null } : {}),
          ...("descripcion" in b ? { descripcion: b.descripcion as string | null } : {}),
          ...("cuenta" in b ? { cuenta: b.cuenta as string | null } : {}),
          ...(c !== undefined ? { categoriaId: c?.id ?? null, categoria: c?.nombreCompleto ?? null } : {}),
          montoCentavos: centavos,
          monto: (centavos / 100).toFixed(2),
          revisar: false,
        };
        this.movimientos[i] = editado;
        return json(200, editado);
      }
      if (metodo === "DELETE") {
        this.movimientos.splice(i, 1);
        this.eliminados.push(actual);
        return json(200, { ok: true });
      }
    }
    if (metodo === "POST" && ruta === "/v1/deshacer") {
      const ultimo = this.eliminados.pop();
      if (!ultimo) return json(200, { deshecho: false, mensaje: "No hay nada que deshacer." });
      this.movimientos.push(ultimo);
      return json(200, { deshecho: true, mensaje: `Listo, regresé ${ultimo.comercio ?? "el movimiento"}.` });
    }
    if (metodo === "GET" && ruta === "/v1/tablero") return json(200, this.tablero(url.searchParams.get("mes") ?? HOY.slice(0, 7)));
    if (metodo === "POST" && ruta === "/v1/hablar") {
      const id = String((cuerpo as { client_id?: string } | null)?.client_id ?? "");
      const previo = this.dictados.get(id);
      // Mismo client_id ya terminado: la misma respuesta, sin registrar nada otra vez.
      if (previo?.estado === "listo") return json(200, { ...previo.respuesta, duplicado: true });
      const falla = this.fallasHablar.shift();
      const [estado, datos] = this.hablar;
      if (falla === "perdido") return route.abort("internetdisconnected");
      if (falla === "ia") {
        this.dictados.set(id, { estado: "error" });
        return json(503, {
          error: "La IA no respondió.",
          respuesta: "No pude procesarlo ahora; queda guardado en tu iPhone para enviarlo después.",
          reintentar: true,
        });
      }
      if (falla === "procesando") {
        this.dictados.set(id, { estado: "listo", respuesta: datos });
        return json(409, { error: "Ese dictado todavía se está procesando.", respuesta: "Ese mensaje todavía se está procesando.", reintentar: true });
      }
      this.dictados.set(id, estado === 202 ? { estado: "procesando" } : { estado: "listo", respuesta: datos });
      if (falla === "corte") return route.abort("connectionreset");
      return json(estado, datos);
    }
    m = ruta.match(/^\/v1\/entradas\/(.+)$/);
    if (metodo === "GET" && m) {
      // Una secuencia fija (this.entradas) manda; si no, lo que la Mac sabe de ese dictado.
      const siguiente = this.entradas.shift();
      if (siguiente) return json(200, siguiente);
      const dictado = this.dictados.get(decodeURIComponent(m[1] ?? ""));
      if (!dictado) return json(404, { error: "No conozco ese dictado." });
      return json(200, dictado.estado === "listo" ? { ...dictado.respuesta, estado: "listo" } : { estado: dictado.estado });
    }
    return json(404, { error: `Ruta falsa no definida: ${metodo} ${ruta}` });
  }

  private nuevoAtajo() {
    this.atajos += 1;
    return `0f8b6c1e-2d4a-4c5e-9a7b-${String(this.atajos).padStart(12, "0")}`;
  }

  private ordenados() {
    return [...this.movimientos].sort((a, b) => (a.fecha === b.fecha ? b.ocurridoEn.localeCompare(a.ocurridoEn) : b.fecha.localeCompare(a.fecha)));
  }

  private buscar(q: URLSearchParams) {
    let lista = this.ordenados();
    const desde = q.get("desde");
    const hasta = q.get("hasta");
    if (desde) lista = lista.filter((m) => m.fecha >= desde);
    if (hasta) lista = lista.filter((m) => m.fecha <= hasta);
    const tipo = q.get("tipo");
    if (tipo) lista = lista.filter((m) => m.tipo === tipo);
    const categoria = q.get("categoria_id");
    if (categoria) {
      const ids = new Set([categoria, ...CATEGORIAS.filter((c) => c.padreId === categoria).map((c) => c.id)]);
      lista = lista.filter((m) => m.categoriaId && ids.has(m.categoriaId));
    }
    const texto = q.get("texto")?.toLowerCase();
    if (texto) lista = lista.filter((m) => `${m.comercio ?? ""} ${m.descripcion ?? ""}`.toLowerCase().includes(texto));
    if (q.get("revisar") === "1") lista = lista.filter((m) => m.revisar);
    const limite = Math.min(Number(q.get("limite") ?? 100), 500);
    const offset = Number(q.get("offset") ?? 0);
    return { total: lista.length, movimientos: lista.slice(offset, offset + limite) };
  }

  tablero(mes: string) {
    const delMes = this.movimientos.filter((m) => m.fecha.startsWith(mes));
    const gastos = delMes.filter((m) => m.tipo === "gasto");
    const suma = (l: MovimientoApp[]) => l.reduce((s, m) => s + m.montoCentavos, 0);
    const gastado = suma(gastos);
    const ingresado = suma(delMes.filter((m) => m.tipo === "ingreso"));
    const porPadre = new Map<string, { categoriaId: string | null; nombre: string; centavos: number; cantidad: number }>();
    for (const g of gastos) {
      const c = CATEGORIAS.find((x) => x.id === g.categoriaId);
      const padre = c?.padreId ? CATEGORIAS.find((x) => x.id === c.padreId) : c;
      const clave = padre?.id ?? "sin";
      const e = porPadre.get(clave) ?? { categoriaId: padre?.id ?? null, nombre: padre?.nombre ?? "Sin categoría", centavos: 0, cantidad: 0 };
      e.centavos += g.montoCentavos;
      e.cantidad += 1;
      porPadre.set(clave, e);
    }
    const frecuentes = new Map<string, { nombre: string; cantidad: number; centavos: number }>();
    for (const g of gastos.filter((x) => x.comercio)) {
      const e = frecuentes.get(g.comercio ?? "") ?? { nombre: g.comercio ?? "", cantidad: 0, centavos: 0 };
      e.cantidad += 1;
      e.centavos += g.montoCentavos;
      frecuentes.set(e.nombre, e);
    }
    const historico: Record<string, [number, number]> = {
      "2026-05": [2_198_040, 3_750_000],
      "2026-06": [2_634_510, 3_750_000],
      "2026-07": [3_105_090, 4_120_000],
      "2026-08": [2_287_760, 3_750_000],
      "2026-09": [2_431_050, 3_750_000],
    };
    const porMes = Array.from({ length: 6 }, (_, i) => {
      const [a, mm] = mes.split("-").map(Number);
      const f = new Date(a ?? 2026, (mm ?? 1) - 6 + i, 1);
      const clave = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
      const h = historico[clave];
      return clave === mes
        ? { mes: clave, gastadoCentavos: gastado, ingresadoCentavos: ingresado }
        : { mes: clave, gastadoCentavos: h?.[0] ?? 0, ingresadoCentavos: h?.[1] ?? 0 };
    });
    return {
      mes,
      hoy: HOY,
      moneda: "MXN",
      totales: {
        gastadoCentavos: gastado,
        ingresadoCentavos: ingresado,
        balanceCentavos: ingresado - gastado,
        gastadoHoyCentavos: suma(gastos.filter((m) => m.fecha === HOY)),
        cantidadGastos: gastos.length,
        gastadoMesAnteriorCentavos: 2_431_050,
        gastadoMesAnteriorMismaFechaCentavos: 1_398_000,
      },
      porCategoria: [...porPadre.values()].sort((a, b) => b.centavos - a.centavos),
      porMes,
      porDiaSemana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, centavos: dia * 10_000 })),
      mayores: [...gastos].sort((a, b) => b.montoCentavos - a.montoCentavos).slice(0, 5),
      frecuentes: [...frecuentes.values()].filter((f) => f.cantidad > 1).sort((a, b) => b.cantidad - a.cantidad),
      recurrentesProximos: [
        { id: "rec-1", nombre: "Smart Fit", montoCentavos: 49_900, moneda: "MXN", proximoCobro: "2026-10-15", frecuencia: "mensual" },
        { id: "rec-2", nombre: "Renta", montoCentavos: 1_250_000, moneda: "MXN", proximoCobro: "2026-11-01", frecuencia: "mensual" },
        { id: "rec-3", nombre: "Netflix", montoCentavos: 29_900, moneda: "MXN", proximoCobro: "2026-11-02", frecuencia: "mensual" },
      ],
      porRevisar: delMes.filter((m) => m.revisar).length,
    };
  }
}

/** Entra con sesión ya guardada y la fecha fija en el 6 de octubre de 2026. */
export async function prepararSesion(page: Page, api = new ApiFalsa()) {
  await page.clock.setFixedTime(new Date("2026-10-06T12:30:00-06:00"));
  await api.instalar(page);
  await page.addInitScript((token) => {
    if (!sessionStorage.getItem("fa_prueba_iniciada")) {
      localStorage.setItem("fa_token", token);
      sessionStorage.setItem("fa_prueba_iniciada", "1");
    }
  }, TOKEN);
  return api;
}

/** Portapapeles falso (lo que se copia se puede leer de vuelta), para probar Copiar y Pegar código. */
export async function portapapelesFalso(page: Page, inicial = "") {
  await page.addInitScript((texto) => {
    let contenido = texto;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          contenido = t;
        },
        readText: async () => contenido,
      },
    });
  }, inicial);
}

/** Como si se abriera desde la pantalla de inicio (app web instalada en iOS). */
export async function comoAppDeInicio(page: Page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { configurable: true, value: true }));
}
