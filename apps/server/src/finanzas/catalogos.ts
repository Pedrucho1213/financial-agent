import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { categorias, comercios, cuentas, TIPOS_CUENTA } from "../db/schema";
import { normalizar } from "../lib/texto";

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

function inferirTipoCuenta(texto: string): (typeof TIPOS_CUENTA)[number] {
  const t = normalizar(texto);
  if (t.includes("efectivo") || t.includes("cash")) return "efectivo";
  if (t.includes("credito")) return "credito";
  if (t.includes("debito")) return "debito";
  if (t.includes("transferencia") || t.includes("spei")) return "transferencia";
  if (t.includes("vales")) return "vales";
  if (t.includes("mercado pago") || t.includes("paypal")) return "monedero";
  return "otra";
}

/**
 * Encuentra la cuenta mencionada ("la BBVA", "con efectivo") o la crea.
 * Decir el método de pago es opcional, así que sin texto no hay cuenta.
 */
export function encontrarOCrearCuenta(db: Db, usuarioId: string, texto: string | undefined) {
  if (!texto?.trim()) return undefined;
  let buscado = normalizar(texto);
  while (/^(con|la|el|mi|mis|tarjeta|cuenta|de) /.test(buscado)) {
    buscado = buscado.replace(/^\S+ /, "");
  }
  const lista = db.select().from(cuentas).where(eq(cuentas.usuarioId, usuarioId)).all();
  const existente = lista.find((c) =>
    [c.nombre, ...c.alias].some((n) => {
      const x = normalizar(n);
      return x === buscado || x.split(" ").includes(buscado) || buscado.split(" ").includes(x);
    }),
  );
  if (existente) return existente;
  let nombre = texto.trim();
  while (/^(con|la|el|mi|mis|tarjeta|cuenta|de)\s+/i.test(nombre)) {
    nombre = nombre.replace(/^\S+\s+/, "");
  }
  const tipo = inferirTipoCuenta(texto);
  return db
    .insert(cuentas)
    .values({ usuarioId, nombre: tipo === "efectivo" ? "Efectivo" : nombre, tipo })
    .returning()
    .get();
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
