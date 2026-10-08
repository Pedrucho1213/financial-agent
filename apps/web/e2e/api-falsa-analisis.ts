import { type ApiFalsa, type MovimientoApp, mov } from "./api-falsa";

// Un año de historia (oct 2025 a ago 2026) para probar Análisis con 6 meses y un año.
// Siempre la misma: números de un generador con semilla fija. No toca septiembre ni octubre de 2026,
// así las demás pruebas (que cuentan esos meses) siguen igual.

function generador(semilla: number) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dos = (n: number) => String(n).padStart(2, "0");

export function historial(): MovimientoApp[] {
  const azar = generador(1213);
  const lista: MovimientoApp[] = [];
  const entre = (a: number, b: number) => Math.round((a + azar() * (b - a)) * 100) / 100;
  for (let i = 0; i < 11; i++) {
    const f = new Date(2025, 9 + i, 1, 12);
    const mes = `${f.getFullYear()}-${dos(f.getMonth() + 1)}`;
    const dias = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
    const d = (n: number) => `${mes}-${dos(Math.min(dias, n))}`;
    lista.push(mov(d(1), "ingreso", 18750, "Sueldo", null, { descripcion: "Quincena", origen: "app" }));
    lista.push(mov(d(15), "ingreso", 18750, "Sueldo", null, { descripcion: "Quincena", origen: "app" }));
    lista.push(mov(d(1), "gasto", 12500, "Renta", null, { descripcion: "Renta", origen: "app", cuenta: "BBVA" }));
    lista.push(mov(d(2), "gasto", 299, "Streaming", "Netflix", { origen: "importacion", cuenta: "Nu" }));
    lista.push(mov(d(5), "gasto", 129, "Música", "Spotify", { origen: "importacion", cuenta: "Nu" }));
    lista.push(mov(d(24), "gasto", entre(480, 760), "Luz", "CFE", { cuenta: "BBVA" }));
    for (const dia of [4, 11, 18, 25]) {
      const tienda = ["Walmart", "Soriana", "Costco"][Math.floor(azar() * 3)] ?? "Walmart";
      lista.push(mov(d(dia), "gasto", entre(700, 1900), "Súper", tienda, { cuenta: azar() < 0.7 ? "BBVA" : "Nu" }));
    }
    const cafes = 3 + Math.floor(azar() * 5);
    for (let c = 0; c < cafes; c++) lista.push(mov(d(2 + Math.floor(azar() * 26)), "gasto", 85, "Café", "Starbucks", { cuenta: "BBVA" }));
    const uber = 2 + Math.floor(azar() * 5);
    for (let c = 0; c < uber; c++) lista.push(mov(d(1 + Math.floor(azar() * 27)), "gasto", entre(90, 240), "Taxi y apps", "Uber"));
    // Restaurantes y salidas en fin de semana.
    for (let dia = 1; dia <= dias; dia++) {
      const sem = new Date(f.getFullYear(), f.getMonth(), dia, 12).getDay();
      if ((sem === 6 || sem === 0) && azar() < 0.45) {
        lista.push(mov(d(dia), "gasto", entre(320, 1300), azar() < 0.6 ? "Restaurantes" : "Salidas", azar() < 0.5 ? "Contramar" : "La Casa de Toño"));
      }
    }
    // Julio: vacaciones (más de lo que entró ese mes).
    if (mes === "2026-07") {
      lista.push(mov(d(10), "gasto", 14_800, "Eventos", "Volaris", { cuenta: "BBVA" }));
      lista.push(mov(d(12), "gasto", 6_350, "Restaurantes", "Mar y Tierra", { cuenta: "BBVA" }));
    }
    if (mes === "2025-12") lista.push(mov(d(20), "gasto", 5_400, "Ropa y calzado", "Liverpool", { cuenta: "BBVA" }));
  }
  return lista;
}

/** Suma el año de historia a una API falsa (además de septiembre y octubre). */
export function conHistorial(api: ApiFalsa) {
  api.movimientos.push(...historial());
  return api;
}
