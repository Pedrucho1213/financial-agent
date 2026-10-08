import { describe, expect, test } from "bun:test";
import { analizar, construirInsights, type Fila, mesesConFlujo, minutoDelDia, normalizar } from "../src/lib/analisis";
import type { Categoria } from "../src/lib/tipos";

// Cálculos de Análisis sin navegador. TZ=America/Mexico_City (ver package.json).

const cat = (id: string, nombre: string, padreId: string | null, naturaleza: Categoria["naturaleza"], tipo: Categoria["tipo"] = "gasto"): Categoria => ({
  id,
  nombre,
  nombreCompleto: nombre,
  padreId,
  tipo,
  naturaleza,
});

const CATS: Categoria[] = [
  cat("comida", "Comida", null, "necesidad"),
  cat("cafe", "Café", "comida", "necesidad"),
  cat("restaurantes", "Restaurantes", "comida", "necesidad"),
  cat("transporte", "Transporte", null, "necesidad"),
  cat("uber", "Taxi y apps", "transporte", "necesidad"),
  cat("entretenimiento", "Entretenimiento", null, "gusto"),
  // Una subcategoría sin naturaleza propia hereda la de su principal.
  cat("cine", "Cine", "entretenimiento", null),
  cat("compras", "Compras", null, "gusto"),
  cat("sueldo", "Sueldo", null, null, "ingreso"),
];

let n = 0;
function f(fecha: string, pesos: number, extra: Partial<Fila> = {}): Fila {
  n += 1;
  return { id: `m${n}`, f: fecha, h: 13 * 60 + 15, t: "gasto", c: Math.round(pesos * 100), m: "MXN", k: null, n: null, e: "x", a: null, ...extra };
}

const base = { hoy: "2026-10-06", moneda: "MXN", categorias: CATS };

describe("minutoDelDia", () => {
  test("una hora real da su minuto local", () => {
    expect(minutoDelDia("2026-10-06T21:40:12.345Z")).toBe(15 * 60 + 40);
  });
  test("el mediodía exacto (registros con otra fecha) no es una hora real", () => {
    expect(minutoDelDia("2026-10-03T18:00:00.000Z")).toBeNull();
  });
  test("un texto que no es fecha da null", () => {
    expect(minutoDelDia("ayer")).toBeNull();
  });
});

describe("normalizar", () => {
  test("ignora mayúsculas, acentos y espacios de más", () => {
    expect(normalizar("  Cinépolis   VIP ")).toBe("cinepolis vip");
  });
});

describe("analizar: totales y comparación", () => {
  const filas = [
    f("2026-10-01", 100, { k: "cafe" }),
    f("2026-10-05", 200, { k: "uber" }),
    f("2026-10-06", 50, { k: "cafe" }),
    f("2026-10-01", 1000, { t: "ingreso", k: "sueldo" }),
    // Septiembre: al 6, $250; el mes completo, $1,250.
    f("2026-09-02", 250, { k: "cafe" }),
    f("2026-09-20", 1000, { k: "compras" }),
    // Otra moneda: no suma, pero se cuenta.
    f("2026-10-04", 30, { m: "USD" }),
    // Un traspaso no es gasto.
    f("2026-10-03", 5000, { t: "transferencia" }),
  ];
  const a = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" });

  test("suma gastos e ingresos del periodo en la moneda base", () => {
    expect(a.totales.gasto).toBe(35_000);
    expect(a.totales.ingreso).toBe(100_000);
    expect(a.totales.neto).toBe(65_000);
    expect(a.totales.cantidad).toBe(3);
    expect(a.otrasMonedas).toBe(1);
  });

  test("en curso, el anterior se compara al mismo día", () => {
    expect(a.enCurso).toBe(true);
    expect(a.corteAnterior).toBe("2026-09-06");
    expect(a.totales.gastoAnterior).toBe(25_000);
    expect(a.totales.gastoAnteriorCompleto).toBe(125_000);
  });

  test("un periodo cerrado se compara completo", () => {
    const sep = analizar(filas, { ...base, periodo: "mes", ref: "2026-09-15" });
    expect(sep.enCurso).toBe(false);
    expect(sep.corteAnterior).toBe("2026-08-31");
    expect(sep.totales.gasto).toBe(125_000);
  });

  test("las cubetas del mes son sus días y las de después de hoy son futuras", () => {
    expect(a.cubetas).toHaveLength(31);
    expect(a.cubetas[0]?.gasto).toBe(10_000);
    expect(a.cubetas[5]?.futuro).toBe(false);
    expect(a.cubetas[6]?.futuro).toBe(true);
  });

  test("las categorías se agrupan en la principal y llevan lo del anterior", () => {
    const comida = a.categorias.find((c) => c.id === "comida");
    expect(comida).toMatchObject({ nombre: "Comida", centavos: 15_000, cantidad: 2, anterior: 25_000 });
    // Compras no tuvo nada al 6 de septiembre: no aparece con 0 y 0.
    expect(a.categorias.find((c) => c.id === "compras")).toBeUndefined();
  });

  test("el filtro de categoría incluye sus subcategorías y quita los ingresos", () => {
    const solo = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06", categoria: "comida" });
    expect(solo.totales.gasto).toBe(15_000);
    expect(solo.totales.ingreso).toBe(0);
    const sub = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06", categoria: "cafe" });
    expect(sub.totales.gasto).toBe(15_000);
  });

  test("con una categoría elegida, el desglose es por subcategoría", () => {
    const filas2 = [f("2026-10-01", 100, { k: "cafe" }), f("2026-10-02", 300, { k: "restaurantes" }), f("2026-10-02", 20, { k: "comida" })];
    const solo = analizar(filas2, { ...base, periodo: "mes", ref: "2026-10-06", categoria: "comida" });
    expect(solo.categorias.map((c) => [c.nombre, c.centavos])).toEqual([
      ["Restaurantes", 30_000],
      ["Café", 10_000],
      ["Sin subcategoría", 2_000],
    ]);
  });

  test("el mayor gasto del periodo", () => {
    expect(a.mayor?.c).toBe(20_000);
  });
});

describe("analizar: ¿se puede comparar con el anterior?", () => {
  test("si se empezó a anotar a medio periodo anterior, no se compara (ni se dicen insights de comparación)", () => {
    // Empezó a anotar el 20 de septiembre: octubre contra un septiembre a medias engaña.
    const filas = [f("2026-09-20", 100, { k: "cafe" }), f("2026-10-02", 900, { k: "restaurantes" }), f("2026-10-03", 900, { k: "restaurantes" }), f("2026-09-21", 100, { k: "cafe" }), f("2026-09-22", 100, { k: "cafe" })];
    const a = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" });
    expect(a.comparable).toBe(false);
    expect(construirInsights(a).map((i) => i.id)).not.toContain("sube");
  });

  test("con unos días de holgura al inicio, sí se compara", () => {
    const filas = [f("2026-09-03", 100), f("2026-10-02", 100)];
    expect(analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" }).comparable).toBe(true);
    // Un año (el anterior empieza el 1 de nov de 2024): 36 días de holgura.
    expect(analizar([f("2024-11-30", 1)], { ...base, periodo: "anio", ref: "2026-10-06" }).comparable).toBe(true);
    expect(analizar([f("2024-12-20", 1)], { ...base, periodo: "anio", ref: "2026-10-06" }).comparable).toBe(false);
  });

  test("sin ningún registro no hay con qué comparar", () => {
    expect(analizar([], { ...base, periodo: "semana", ref: "2026-10-06" }).comparable).toBe(false);
  });
});

describe("analizar: días, horas y naturaleza", () => {
  test("los días sin gastar empiezan a contar desde el primer registro", () => {
    const filas = [f("2026-10-03", 10), f("2026-10-06", 10)];
    const a = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" });
    // Del 3 al 6: 4 días, dos sin gastar (4 y 5), seguidos.
    expect(a.diasConsiderados).toBe(4);
    expect(a.sinGasto).toEqual({ dias: 2, racha: 2 });
    expect(a.totales.porDia).toBe(500);
  });

  test("el promedio por día de la semana divide entre cuántos de esos días hubo", () => {
    // Del 28 de sep (lunes) al 4 de oct (domingo); el domingo 4 gastó 70.
    const filas = [f("2026-09-28", 10), f("2026-10-04", 70)];
    const a = analizar(filas, { ...base, hoy: "2026-10-04", periodo: "semana", ref: "2026-10-01" });
    expect(a.rango).toEqual({ desde: "2026-09-28", hasta: "2026-10-04" });
    expect(a.diaSemana[0]).toEqual({ centavos: 1_000, dias: 1 });
    expect(a.diaSemana[6]).toEqual({ centavos: 7_000, dias: 1 });
    expect(a.cubetas.map((c) => c.corta).join("")).toBe("LMMJVSD");
  });

  test("los momentos del día solo usan horas reales", () => {
    const filas = [f("2026-10-01", 10, { h: 8 * 60 }), f("2026-10-02", 10, { h: 21 * 60 }), f("2026-10-02", 10, { h: 23 * 60 + 59 }), f("2026-10-03", 10, { h: null })];
    const a = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" });
    expect(a.conHora).toBe(3);
    expect(a.momentos.manana.cantidad).toBe(1);
    expect(a.momentos.noche.cantidad).toBe(2);
    expect(a.momentos.madrugada.cantidad).toBe(0);
  });

  test("necesidad y gusto; una subcategoría sin naturaleza toma la de su principal", () => {
    const filas = [f("2026-10-01", 100, { k: "cafe" }), f("2026-10-02", 40, { k: "cine" }), f("2026-10-02", 5)];
    const a = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" });
    expect(a.naturaleza).toEqual({ necesidad: 10_000, gusto: 4_000, ahorro: 0, sin: 500 });
  });

  test("el mapa de calor reparte niveles y deja en 0 los días sin gasto", () => {
    const filas = [10, 20, 30, 40, 50, 60, 70, 80].map((p, i) => f(`2026-10-0${i + 1}`, p));
    const a = analizar(filas, { ...base, hoy: "2026-10-09", periodo: "mes", ref: "2026-10-09" });
    const niveles = a.dias.slice(0, 9).map((d) => d.nivel);
    expect(niveles).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 0]);
    expect(a.dias.at(-1)?.futuro).toBe(true);
  });

  test("los comercios con otras mayúsculas o acentos son uno solo", () => {
    const filas = [f("2026-10-01", 10, { n: "Oxxo" }), f("2026-10-02", 10, { n: "OXXO" }), f("2026-10-02", 10, { n: "Cinépolis" }), f("2026-10-03", 10, { n: "Cinepolis" })];
    const a = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" });
    expect(a.comercios.map((c) => [c.nombre, c.cantidad])).toEqual([
      ["Oxxo", 2],
      ["Cinépolis", 2],
    ]);
  });

  test("sin cuenta queda como «Sin decir»", () => {
    const filas = [f("2026-10-01", 10, { a: "BBVA" }), f("2026-10-02", 30, { a: "bbva" }), f("2026-10-02", 10)];
    const a = analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" });
    expect(a.cuentas.map((c) => [c.nombre, c.centavos])).toEqual([
      ["BBVA", 4_000],
      ["Sin decir", 1_000],
    ]);
  });

  test("sin ningún registro todo queda en cero, sin dividir entre cero", () => {
    const a = analizar([], { ...base, periodo: "anio", ref: "2026-10-06" });
    expect(a.totales.porDia).toBe(0);
    expect(a.totales.ticket).toBe(0);
    expect(a.promedioCubeta).toBe(0);
    expect(a.cubetas).toHaveLength(12);
    expect(construirInsights(a)).toEqual([]);
  });

  test("6 meses en semanas: el promedio no cuenta semanas futuras ni antes del primer registro", () => {
    const filas = [f("2026-09-07", 700), f("2026-09-14", 700)];
    const a = analizar(filas, { ...base, periodo: "6m", ref: "2026-10-06" });
    // Del 7 sep (primer registro) a hoy: semanas del 7, 14, 21, 28 sep y 5 oct = 5.
    expect(a.promedioCubeta).toBe(Math.round(140_000 / 5));
    expect(a.cubetas.at(-1)?.futuro).toBe(true);
  });
});

describe("construirInsights", () => {
  const ids = (l: { id: string }[]) => l.map((i) => i.id);

  test("avisa cuando una categoría sube mucho y celebra cuando otra baja", () => {
    const filas = [
      // Septiembre (cerrado, se compara completo con agosto).
      f("2026-09-03", 900, { k: "restaurantes" }),
      f("2026-09-05", 100, { k: "uber" }),
      f("2026-09-08", 50, { k: "cafe" }),
      // Agosto.
      f("2026-08-03", 300, { k: "restaurantes" }),
      f("2026-08-05", 600, { k: "uber" }),
      f("2026-08-08", 50, { k: "cafe" }),
    ];
    const l = construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-09-01" }));
    const sube = l.find((i) => i.id === "sube");
    expect(sube?.titulo).toBe("Comida subió 171%.");
    expect(sube?.accion?.ir).toBe("#movimientos?mes=2026-09&tipo=gasto&categoria=comida");
    expect(l.find((i) => i.id === "baja")?.titulo).toBe("Gastaste 83% menos en Transporte.");
    // Lo que pide atención va primero.
    expect(l[0]?.tono).toBe("atencion");
  });

  test("un cambio chico no es un insight", () => {
    const filas = [
      f("2026-09-03", 330, { k: "restaurantes" }),
      f("2026-09-05", 100, { k: "uber" }),
      f("2026-09-06", 100, { k: "uber" }),
      f("2026-08-03", 300, { k: "restaurantes" }),
      f("2026-08-05", 100, { k: "uber" }),
      f("2026-08-06", 100, { k: "uber" }),
    ];
    const l = construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-09-01" }));
    expect(ids(l)).not.toContain("sube");
    expect(ids(l)).not.toContain("baja");
  });

  test("sin periodo anterior con datos no se compara", () => {
    const filas = [f("2026-09-03", 900, { k: "restaurantes" }), f("2026-08-03", 10, { k: "cafe" })];
    const l = construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-09-01" }));
    expect(ids(l)).not.toContain("sube");
  });

  test("50/30/20: avisa si los gustos pasan del 30% de lo que entró", () => {
    const filas = [f("2026-09-01", 10_000, { t: "ingreso", k: "sueldo" }), f("2026-09-03", 4_000, { k: "cine" }), f("2026-09-04", 3_000, { k: "cafe" })];
    const l = construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-09-01" }));
    const g = l.find((i) => i.id === "gustos");
    expect(g?.titulo).toBe("Los gustos se llevaron el 40% de lo que te entró.");
    expect(g?.detalle).toContain("Necesidades: 30%; ahorro: 30%");
  });

  test("50/30/20: celebra si guardó al menos el 20%", () => {
    const filas = [f("2026-09-01", 10_000, { t: "ingreso" }), f("2026-09-03", 1_000, { k: "cine" }), f("2026-09-04", 3_000, { k: "cafe" })];
    const l = construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-09-01" }));
    expect(l.find((i) => i.id === "ahorro")?.titulo).toBe("Guardaste el 60% de lo que te entró.");
  });

  test("con el mes en curso no juzga el 50/30/20 (falta la otra quincena)", () => {
    const filas = [f("2026-10-01", 10_000, { t: "ingreso" }), f("2026-10-03", 5_000, { k: "cine" })];
    const l = construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-10-06" }));
    expect(ids(l)).not.toContain("gustos");
  });

  test("6 meses: cuenta los meses en rojo y el más tranquilo sin el mes en curso", () => {
    const filas = [
      f("2026-05-01", 1000, { t: "ingreso" }),
      f("2026-05-02", 1500),
      f("2026-06-01", 1000, { t: "ingreso" }),
      f("2026-06-02", 400),
      f("2026-07-01", 1000, { t: "ingreso" }),
      f("2026-07-02", 900),
      f("2026-08-01", 1000, { t: "ingreso" }),
      f("2026-08-02", 800),
      f("2026-10-02", 10),
    ];
    const a = analizar(filas, { ...base, periodo: "6m", ref: "2026-10-06" });
    expect(mesesConFlujo(a).map((m) => m.mes)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    const l = construirInsights(a);
    expect(l.find((i) => i.id === "rojos")?.titulo).toBe("En 1 de 6 meses gastaste más de lo que te entró.");
    expect(l.find((i) => i.id === "rojos")?.detalle).toBe("El más apretado: mayo.");
    // Octubre (con $10) va a medias: el más tranquilo es junio.
    expect(l.find((i) => i.id === "mejor")?.titulo).toBe("Junio fue tu mes más tranquilo: $400.");
  });

  test("días sin gastar, fin de semana y momento del día", () => {
    // Semana del 28 sep: entre semana $200 en 5 días (miércoles y viernes nada), sábado y domingo $300, todo de noche.
    const filas = [
      ...["2026-09-28", "2026-09-28", "2026-09-29"].map((d) => f(d, 50, { h: 20 * 60 })),
      f("2026-10-03", 300, { h: 21 * 60 }),
      f("2026-10-04", 300, { h: 22 * 60 }),
      f("2026-10-01", 50, { h: 19 * 60 + 30 }),
    ];
    const a = analizar(filas, { ...base, hoy: "2026-10-04", periodo: "semana", ref: "2026-10-04" });
    const l = construirInsights(a, { maximo: 10 });
    expect(l.find((i) => i.id === "finde")?.titulo).toBe("En fin de semana gastas 7.5 veces más por día.");
    expect(l.find((i) => i.id === "sin_gasto")?.titulo).toBe("2 días sin gastar esta semana.");
    expect(l.find((i) => i.id === "momento")?.titulo).toBe("100% de tus compras son en la noche.");
  });

  test("el doble se dice «el doble»", () => {
    const filas = [
      ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((d) => f(d, 150)),
      f("2026-10-03", 300),
      f("2026-10-04", 300),
    ];
    const l = construirInsights(analizar(filas, { ...base, hoy: "2026-10-04", periodo: "semana", ref: "2026-10-04" }));
    expect(l.find((i) => i.id === "finde")?.titulo).toBe("En fin de semana gastas el doble más por día.");
  });

  test("lugares nuevos y método de pago que concentra casi todo", () => {
    const filas = [
      f("2026-09-01", 100, { n: "Oxxo", a: "BBVA" }),
      f("2026-09-02", 100, { n: "Contramar", a: "BBVA" }),
      f("2026-09-03", 100, { n: "Liverpool", a: "BBVA" }),
      f("2026-09-04", 100, { n: "Costco", a: "BBVA" }),
      f("2026-09-05", 100, { n: "Oxxo", a: "Nu" }),
      f("2026-08-01", 100, { n: "Oxxo" }),
      f("2026-08-02", 100, { n: "Oxxo" }),
      f("2026-08-03", 100, { n: "Oxxo" }),
    ];
    const l = construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-09-01" }), { maximo: 10 });
    expect(l.find((i) => i.id === "nuevos")?.titulo).toBe("3 lugares nuevos este mes.");
    expect(l.find((i) => i.id === "nuevos")?.detalle).toBe("Contramar, Liverpool y Costco: $300.");
    expect(l.find((i) => i.id === "cuenta")?.titulo).toBe("El 80% de lo que pagaste este mes fue con BBVA.");
  });

  test("compra promedio que baja", () => {
    const filas = [
      ...[1, 2, 3, 4, 5].map((d) => f(`2026-09-0${d}`, 100)),
      ...[1, 2, 3, 4, 5].map((d) => f(`2026-08-0${d}`, 200)),
    ];
    const l = construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-09-01" }), { maximo: 10 });
    const t = l.find((i) => i.id === "ticket");
    expect(t?.titulo).toBe("Tu compra promedio bajó a $100.");
    expect(t?.tono).toBe("bueno");
  });

  test("nunca más del máximo", () => {
    const filas = [
      ...Array.from({ length: 20 }, (_, i) => f(`2026-09-${String(i + 1).padStart(2, "0")}`, 100 + i * 50, { n: `Lugar ${i}`, a: "BBVA", k: "cine", h: 21 * 60 })),
      ...Array.from({ length: 6 }, (_, i) => f(`2026-08-0${i + 1}`, 30, { k: "cafe" })),
      f("2026-09-01", 1000, { t: "ingreso" }),
    ];
    expect(construirInsights(analizar(filas, { ...base, periodo: "mes", ref: "2026-09-01" }), { maximo: 3 })).toHaveLength(3);
  });
});
