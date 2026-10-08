import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { categorias, comercios, cuentas, TIPOS_CUENTA } from "../db/schema";
import { normalizar } from "../lib/texto";
import { ErrorFinanzas } from "./movimientos";

type Naturaleza = "necesidad" | "gusto" | "ahorro";
type Semilla = { nombre: string; naturaleza?: Naturaleza; hijas?: string[] };

// Categorías iniciales pensadas para México. El usuario puede cambiarlas hablando.
export const CATEGORIAS_GASTO: Semilla[] = [
  { nombre: "Vivienda", naturaleza: "necesidad", hijas: ["Renta", "Luz", "Agua", "Gas", "Internet y teléfono", "Mantenimiento"] },
  { nombre: "Comida", naturaleza: "necesidad", hijas: ["Súper", "Restaurantes", "Café", "Antojos", "Delivery"] },
  { nombre: "Transporte", naturaleza: "necesidad", hijas: ["Gasolina", "Taxi y apps", "Transporte público", "Estacionamiento", "Casetas", "Auto"] },
  { nombre: "Salud", naturaleza: "necesidad", hijas: ["Médico", "Farmacia", "Seguro", "Gimnasio"] },
  { nombre: "Suscripciones", naturaleza: "gusto", hijas: ["Streaming", "Música", "Software", "Otras suscripciones"] },
  { nombre: "Entretenimiento", naturaleza: "gusto", hijas: ["Cine", "Salidas", "Juegos", "Eventos"] },
  { nombre: "Compras", naturaleza: "gusto", hijas: ["Ropa y calzado", "Electrónica", "Hogar"] },
  { nombre: "Cuidado personal", naturaleza: "gusto" },
  { nombre: "Educación", naturaleza: "necesidad" },
  { nombre: "Mascotas", naturaleza: "necesidad" },
  { nombre: "Regalos", naturaleza: "gusto" },
  { nombre: "Viajes", naturaleza: "gusto" },
  { nombre: "Comisiones e intereses", naturaleza: "necesidad" },
  { nombre: "Otros gastos", naturaleza: "gusto" },
];

export const CATEGORIAS_INGRESO: Semilla[] = [
  { nombre: "Sueldo" },
  { nombre: "Freelance" },
  { nombre: "Rentas cobradas" },
  { nombre: "Reembolsos" },
  { nombre: "Otros ingresos" },
];

// Palabras que la gente usa y la categoría a la que apuntan.
const SINONIMOS: Record<string, string> = {
  supermercado: "Súper",
  despensa: "Súper",
  uber: "Taxi y apps",
  didi: "Taxi y apps",
  taxi: "Taxi y apps",
  metro: "Transporte público",
  camion: "Transporte público",
  netflix: "Streaming",
  spotify: "Música",
  quincena: "Sueldo",
  nomina: "Sueldo",
  salario: "Sueldo",
  "comida rapida": "Restaurantes",
  rappi: "Delivery",
  "uber eats": "Delivery",
  "didi food": "Delivery",
  telefono: "Internet y teléfono",
  celular: "Internet y teléfono",
  internet: "Internet y teléfono",
  ropa: "Ropa y calzado",
  zapatos: "Ropa y calzado",
  tenis: "Ropa y calzado",
  medicina: "Farmacia",
  medicinas: "Farmacia",
  doctor: "Médico",
  comisiones: "Comisiones e intereses",
  intereses: "Comisiones e intereses",
  otros: "Otros gastos",
  renta: "Renta",
  casero: "Renta",
  luz: "Luz",
  cfe: "Luz",
  agua: "Agua",
  gas: "Gas",
  cafe: "Café",
  starbucks: "Café",
  super: "Súper",
  walmart: "Súper",
  soriana: "Súper",
  chedraui: "Súper",
  costco: "Súper",
  gasolina: "Gasolina",
  pemex: "Gasolina",
  caseta: "Casetas",
  casetas: "Casetas",
  estacionamiento: "Estacionamiento",
  cine: "Cine",
  cinepolis: "Cine",
  cinemex: "Cine",
  farmacia: "Farmacia",
  gimnasio: "Gimnasio",
  gym: "Gimnasio",
  restaurante: "Restaurantes",
  magna: "Gasolina",
  gasolinera: "Gasolina",
  telmex: "Internet y teléfono",
  izzi: "Internet y teléfono",
  totalplay: "Internet y teléfono",
  telcel: "Internet y teléfono",
  comision: "Comisiones e intereses",
  reembolso: "Reembolsos",
  devolucion: "Reembolsos",
};

export function sembrarCategorias(db: Db, usuarioId: string) {
  const existentes = db.select().from(categorias).where(eq(categorias.usuarioId, usuarioId)).all();
  if (existentes.length > 0) return;
  db.transaction((tx) => {
    for (const [tipo, lista] of [
      ["gasto", CATEGORIAS_GASTO],
      ["ingreso", CATEGORIAS_INGRESO],
    ] as const) {
      for (const semilla of lista) {
        const padre = tx
          .insert(categorias)
          .values({ usuarioId, nombre: semilla.nombre, tipo, naturaleza: semilla.naturaleza })
          .returning()
          .get();
        for (const hija of semilla.hijas ?? []) {
          tx.insert(categorias)
            .values({ usuarioId, nombre: hija, tipo, padreId: padre.id, naturaleza: semilla.naturaleza })
            .run();
        }
      }
    }
  });
}

export type Categoria = typeof categorias.$inferSelect;

export function listarCategorias(db: Db, usuarioId: string): Categoria[] {
  return db.select().from(categorias).where(eq(categorias.usuarioId, usuarioId)).all();
}

/** Busca la categoría que más se parece al texto. Prefiere el tipo pedido (gasto o ingreso). */
export function encontrarCategoria(
  lista: Categoria[],
  texto: string | undefined,
  tipo: "gasto" | "ingreso",
): Categoria | undefined {
  if (!texto) return undefined;
  const buscado = normalizar(texto);
  const sinonimo = SINONIMOS[buscado];
  const candidatas = [...lista].sort((a, b) => Number(b.tipo === tipo) - Number(a.tipo === tipo));
  const porNombre = (n: string) => candidatas.find((c) => normalizar(c.nombre) === normalizar(n));
  return (
    porNombre(texto) ??
    (sinonimo ? porNombre(sinonimo) : undefined) ??
    // "Taxi" coincide con "Taxi y apps"; "cafes" con "Café".
    candidatas.find((c) => normalizar(c.nombre).split(" ").includes(buscado)) ??
    candidatas.find((c) => buscado.startsWith(normalizar(c.nombre)))
  );
}

// Usos de una palabra que no nombran su categoría: "súper ricos" no es el súper, "un agua"
// es una bebida y no el recibo, "clase de tenis" no son zapatos.
const FALSOS_AMIGOS = [
  /\bsuper (rico|rica|ricos|ricas|bueno|buena|buenos|buenas|caro|cara|caros|caras|barato|barata|baratos|baratas|padre|padres|chido|chida|chidos|chidas|sabroso|sabrosa|sabrosos|sabrosas|bien|mal|feo|fea|lleno|llena|tarde|temprano|rapido|rapida)\b/g,
  /\b(un|una|unas|unos|botella de|botellita de|vaso de|garrafon de) agua\b|\bagua (mineral|natural|de sabor|de coco|de jamaica|de horchata|de limon|fresca|embotellada)\b/g,
  /\b(de|jugar|juego|jugue) tenis\b/g,
];

function sinFalsosAmigos(plano: string): string {
  return FALSOS_AMIGOS.reduce((texto, patron) => texto.replace(patron, " "), plano);
}

/** Hojas del tipo dado (o hijas de `padre`) que la frase nombra por su nombre o un sinónimo. */
export function hojasMencionadas(
  lista: Categoria[],
  texto: string | null | undefined,
  tipo: "gasto" | "ingreso",
  padre?: Categoria,
): Categoria[] {
  if (!texto) return [];
  const plano = ` ${sinFalsosAmigos(normalizar(texto))} `;
  const dice = (palabra: string) => plano.includes(` ${normalizar(palabra)} `);
  return lista.filter(
    (c) =>
      c.tipo === tipo &&
      (padre ? c.padreId === padre.id : !lista.some((h) => h.padreId === c.id)) &&
      (dice(c.nombre) || Object.entries(SINONIMOS).some(([palabra, nombre]) => nombre === c.nombre && dice(palabra))),
  );
}

/** Si la frase respalda la categoría: la nombra, usa un sinónimo o una palabra parecida ("regalo" y "Regalos"). */
export function fraseRespalda(lista: Categoria[], categoria: Categoria, texto: string | null | undefined): boolean {
  if (!texto) return false;
  if (hojasMencionadas(lista, texto, categoria.tipo as "gasto" | "ingreso").some((c) => c.id === categoria.id)) return true;
  const palabras = normalizar(texto).split(" ").filter((p) => p.length >= 4);
  return normalizar(categoria.nombre)
    .split(" ")
    .filter((n) => n.length >= 4)
    .some((n) => palabras.some((p) => p.startsWith(n) || n.startsWith(p)));
}

/**
 * Subcategoría que se adivina por las palabras de la frase ("luz", "Uber", "cine").
 * Con `padre`, solo considera sus hijas. Responde solo si hay una única candidata.
 */
export function inferirSubcategoria(
  lista: Categoria[],
  textos: (string | null | undefined)[],
  tipo: "gasto" | "ingreso",
  padre?: Categoria,
): Categoria | undefined {
  for (const texto of textos) {
    const candidatas = hojasMencionadas(lista, texto, tipo, padre);
    if (candidatas.length === 1) return candidatas[0];
  }
  return undefined;
}

export function categoriaPorDefecto(lista: Categoria[], tipo: "gasto" | "ingreso") {
  return lista.find((c) => c.nombre === (tipo === "gasto" ? "Otros gastos" : "Otros ingresos"));
}

/** Nombre con su categoría padre: "Comida > Café". */
export function nombreCompleto(lista: Categoria[], categoriaId: string | null): string | null {
  if (!categoriaId) return null;
  const c = lista.find((x) => x.id === categoriaId);
  if (!c) return null;
  const padre = c.padreId ? lista.find((x) => x.id === c.padreId) : undefined;
  return padre ? `${padre.nombre} > ${c.nombre}` : c.nombre;
}

/** Ids de la categoría y de todas sus hijas, para filtrar "Comida" e incluir "Café". */
export function idsConHijas(lista: Categoria[], categoriaId: string): string[] {
  return [categoriaId, ...lista.filter((c) => c.padreId === categoriaId).map((c) => c.id)];
}

export type Cuenta = typeof cuentas.$inferSelect;
export type TipoCuenta = (typeof TIPOS_CUENTA)[number];

// Bancos que solo dan tarjeta de crédito, o solo cuenta de débito: el nombre dice el tipo.
const SOLO_CREDITO = /\b(invex|stori|amex|american express|rappi ?card|didi card|liverpool|palacio de hierro|sears)\b/;
const SOLO_DEBITO = /\b(revolut|hey banco|albo|fondeadora|spin|uala|openbank)\b/;

export function inferirTipoCuenta(texto: string): TipoCuenta {
  const t = normalizar(texto);
  if (t.includes("efectivo") || t.includes("cash") || /\b(cartera|bolsillo)\b/.test(t)) return "efectivo";
  if (t.includes("credito") || SOLO_CREDITO.test(t)) return "credito";
  if (t.includes("debito") || t.includes("nomina") || SOLO_DEBITO.test(t)) return "debito";
  if (t.includes("transferencia") || t.includes("spei")) return "transferencia";
  if (t.includes("vales")) return "vales";
  if (t.includes("mercado pago") || t.includes("paypal")) return "monedero";
  return "otra";
}

// El mismo banco con dos nombres: "Bancomer" es BBVA, "Citibanamex" es Banamex.
const MISMO_BANCO: Record<string, string> = { bancomer: "bbva", "bbva bancomer": "bbva", citibanamex: "banamex", "citi banamex": "banamex", "nu bank": "nu", nubank: "nu", "american express": "amex" };
const canonico = (nombre: string) => MISMO_BANCO[nombre] ?? nombre;

// Palabras que no son el nombre de la cuenta: "con la tarjeta de crédito", "mi cuenta de".
const RELLENO_CUENTA = /^(con|la|el|en|mi|mis|tu|tarjeta|tarjetas|cuenta|cuentas|de|del|credito|debito|banco|tdc|tdd|nomina)\s+/;
// Lo que queda si solo dijo el tipo: "la tarjeta de crédito", "mi débito".
const SOLO_TIPO = /^(credito|debito|tarjeta|cuenta|banco|tdc|tdd|nomina)$/;

/** "Con la tarjeta de crédito Nu" → "nu"; "mi tarjeta de crédito" → "credito". */
function nombreBuscado(texto: string): string {
  let buscado = normalizar(texto);
  while (RELLENO_CUENTA.test(buscado)) buscado = buscado.replace(/^\S+ /, "");
  return canonico(buscado);
}

export type OpcionesCuenta = {
  /**
   * Si dijo solo "la tarjeta de crédito" y tiene varias: "error" pide decir cuál; "ninguna" no pone
   * cuenta (al registrar un gasto, decir con qué pagó es opcional). Por omisión, "ninguna".
   */
  siAmbigua?: "error" | "ninguna";
  /** No crear la cuenta si no existe. */
  soloExistente?: boolean;
};

/**
 * Encuentra la cuenta mencionada ("la BBVA", "con efectivo", "Bancomer" para la BBVA) o la crea.
 * Decir el método de pago es opcional, así que sin texto no hay cuenta. "La tarjeta de crédito" a
 * secas es su única tarjeta de crédito; si dice el tipo de una cuenta que no lo tenía ("mi tarjeta de
 * crédito Invex"), se lo pone.
 */
export function encontrarOCrearCuenta(db: Db, usuarioId: string, texto: string | undefined, opciones: OpcionesCuenta = {}): Cuenta | undefined {
  if (!texto?.trim()) return undefined;
  const buscado = nombreBuscado(texto);
  const tipoDicho = inferirTipoCuenta(texto);
  const lista = db.select().from(cuentas).where(eq(cuentas.usuarioId, usuarioId)).all();
  const activas = lista.filter((c) => !c.archivada);
  const conTipo = (c: Cuenta): Cuenta => {
    const cambios: Partial<Cuenta> = {};
    if (c.archivada) cambios.archivada = false;
    // "Otra" no dice nada; un tipo dicho sí. Una de débito no se vuelve de crédito por una frase.
    if (c.tipo === "otra" && tipoDicho !== "otra" && tipoDicho !== "transferencia") cambios.tipo = tipoDicho;
    if (Object.keys(cambios).length === 0) return c;
    return db.update(cuentas).set(cambios).where(eq(cuentas.id, c.id)).returning().get()!;
  };
  if (!buscado || SOLO_TIPO.test(buscado) || buscado === "efectivo") {
    const tipo = buscado === "efectivo" ? "efectivo" : tipoDicho;
    const generico = tipo === "otra" || tipo === "transferencia";
    // "La tarjeta" o "la cuenta" sin tipo: sirve solo si tiene una sola de banco.
    const candidatas = activas.filter((c) => (generico ? ["credito", "debito", "otra"].includes(c.tipo) : c.tipo === tipo));
    if (candidatas.length === 1) return candidatas[0];
    if (candidatas.length > 1) {
      if (opciones.siAmbigua === "error") throw new ErrorFinanzas(`¿Cuál? Tienes ${enLista(candidatas.map((c) => c.nombre))}.`);
      return undefined;
    }
    if (opciones.soloExistente || !buscado) return undefined;
    if (!generico) {
      const nombre = { efectivo: "Efectivo", credito: "Tarjeta de crédito", debito: "Tarjeta de débito", vales: "Vales", monedero: "Monedero" }[tipo];
      return db.insert(cuentas).values({ usuarioId, nombre, tipo }).returning().get();
    }
  }
  // El nombre exacto primero: "BBVA Azul" no es "BBVA" si existen las dos. Las activas antes que las archivadas.
  const nombres = (c: Cuenta) => [c.nombre, ...c.alias].map((n) => canonico(nombreBuscado(n) || normalizar(n)));
  const coincide = (c: Cuenta) => nombres(c).some((x) => x.split(" ").includes(buscado) || buscado.split(" ").includes(x));
  const existente =
    activas.find((c) => nombres(c).includes(buscado)) ??
    lista.find((c) => nombres(c).includes(buscado)) ??
    activas.find(coincide) ??
    lista.find(coincide);
  if (existente) return conTipo(existente);
  if (opciones.soloExistente) return undefined;
  let nombre = texto.trim();
  while (/^(con|la|el|en|mi|mis|tarjeta|cuenta|de|del|cr[eé]dito|d[eé]bito|banco|nómina|nomina)\s+/i.test(nombre)) {
    nombre = nombre.replace(/^\S+\s+/, "");
  }
  nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  return db
    .insert(cuentas)
    .values({ usuarioId, nombre: tipoDicho === "efectivo" ? "Efectivo" : nombre, tipo: tipoDicho })
    .returning()
    .get();
}

/** "Nu, BBVA e Invex". */
export function enLista(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  const ultima = partes.at(-1)!;
  const y = /^(i|hi)/i.test(normalizar(ultima)) && !/^(hie|hia|hio)/i.test(normalizar(ultima)) ? "e" : "y";
  return `${partes.slice(0, -1).join(", ")} ${y} ${ultima}`;
}

export function encontrarOCrearComercio(db: Db, usuarioId: string, nombre: string | undefined) {
  if (!nombre?.trim()) return undefined;
  const nombreNormalizado = normalizar(nombre);
  const existente = db
    .select()
    .from(comercios)
    .where(and(eq(comercios.usuarioId, usuarioId), eq(comercios.nombreNormalizado, nombreNormalizado)))
    .get();
  if (existente) return existente;
  return db
    .insert(comercios)
    .values({ usuarioId, nombre: nombre.trim(), nombreNormalizado })
    .returning()
    .get();
}
