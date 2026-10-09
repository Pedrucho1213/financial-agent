import { describe, expect, test } from "bun:test";
import { fechaDelTexto, fechaLocal, mediodiaUtc, mencionaFecha, resolverFecha, resolverPeriodo } from "../src/lib/fechas";
import { montoConPalabras, montosDelTexto } from "../src/lib/numeros";
import { montoMensual, proximoCobro } from "../src/finanzas/recurrentes";

const HOY = "2026-10-07"; // miércoles

describe("resolverFecha", () => {
  test("entiende hoy, ayer y antier", () => {
    expect(resolverFecha(undefined, HOY)).toBe(HOY);
    expect(resolverFecha("hoy", HOY)).toBe(HOY);
    expect(resolverFecha("ayer", HOY)).toBe("2026-10-06");
    expect(resolverFecha("antier", HOY)).toBe("2026-10-05");
  });
  test("un día de la semana es el más reciente", () => {
    expect(resolverFecha("el viernes", HOY)).toBe("2026-10-02");
    expect(resolverFecha("lunes", HOY)).toBe("2026-10-05");
    expect(resolverFecha("miércoles", HOY)).toBe(HOY);
    expect(resolverFecha("el miércoles pasado", HOY)).toBe("2026-09-30");
  });
  test("acepta fechas exactas y rechaza lo que no entiende", () => {
    expect(resolverFecha("2026-09-15", HOY)).toBe("2026-09-15");
    expect(resolverFecha("la otra vez", HOY)).toBeNull();
  });
});

describe("resolverPeriodo", () => {
  test("periodos comunes", () => {
    expect(resolverPeriodo("este_mes", HOY)).toEqual({ desde: "2026-10-01", hasta: HOY });
    expect(resolverPeriodo("mes_pasado", HOY)).toEqual({ desde: "2026-09-01", hasta: "2026-09-30" });
    expect(resolverPeriodo("esta_semana", HOY)).toEqual({ desde: "2026-10-05", hasta: HOY });
    expect(resolverPeriodo("semana_pasada", HOY)).toEqual({ desde: "2026-09-28", hasta: "2026-10-04" });
    expect(resolverPeriodo("ayer", HOY)).toEqual({ desde: "2026-10-06", hasta: "2026-10-06" });
    expect(resolverPeriodo("2026-02", HOY)).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(resolverPeriodo("ultimos_7_dias", HOY)).toEqual({ desde: "2026-10-01", hasta: HOY });
    expect(resolverPeriodo("este_año", HOY)).toEqual({ desde: "2026-01-01", hasta: HOY });
  });
});

describe("zona horaria", () => {
  test("la fecha local de Ciudad de México no es la de UTC en la noche", () => {
    expect(fechaLocal(new Date("2026-10-08T03:00:00Z"), "America/Mexico_City")).toBe("2026-10-07");
  });
  test("mediodía local en UTC", () => {
    expect(mediodiaUtc("2026-10-06", "America/Mexico_City")).toBe("2026-10-06T18:00:00.000Z");
  });
});

describe("recurrentes", () => {
  test("próximo cobro mensual, ajustado a fin de mes", () => {
    expect(proximoCobro({ frecuencia: "mensual", dia: 15, mes: null }, HOY)).toBe("2026-10-15");
    expect(proximoCobro({ frecuencia: "mensual", dia: 1, mes: null }, HOY)).toBe("2026-11-01");
    expect(proximoCobro({ frecuencia: "mensual", dia: 31, mes: null }, "2026-11-05")).toBe("2026-11-30");
  });
  test("quincenal, semanal y anual", () => {
    expect(proximoCobro({ frecuencia: "quincenal", dia: 15, mes: null }, "2026-10-16")).toBe("2026-10-30");
    expect(proximoCobro({ frecuencia: "semanal", dia: 5, mes: null }, HOY)).toBe("2026-10-09");
    expect(proximoCobro({ frecuencia: "anual", dia: 3, mes: 2 }, HOY)).toBe("2027-02-03");
  });
  test("monto mensual equivalente", () => {
    expect(montoMensual({ frecuencia: "anual", montoCentavos: 120000 })).toBe(10000);
    expect(montoMensual({ frecuencia: "quincenal", montoCentavos: 500000 })).toBe(1000000);
  });
});

describe("fechas dichas de otras formas", () => {
  test("día del mes, hace N días y meses por nombre", () => {
    expect(fechaDelTexto("El 1 de este mes pagué 350", HOY)).toBe("2026-10-01");
    expect(fechaDelTexto("el primero pagué la renta", HOY)).toBe("2026-10-01");
    expect(fechaDelTexto("el 15 de septiembre fui al cine", HOY)).toBe("2026-09-15");
    // Un mes que todavía no llega es del año pasado.
    expect(fechaDelTexto("el 20 de diciembre", HOY)).toBe("2025-12-20");
    expect(fechaDelTexto("hace 3 días gasté 200", HOY)).toBe("2026-10-04");
    expect(fechaDelTexto("hace una semana", HOY)).toBe("2026-09-30");
    expect(fechaDelTexto("Pago 9,500 de renta cada primero de mes", HOY)).toBeNull();
    expect(resolverFecha("el 15", HOY)).toBeNull();
  });

  test("entiende las fechas que mandan los modelos en otros formatos", () => {
    expect(resolverFecha("05/10/2026", HOY)).toBe("2026-10-05");
    expect(resolverFecha("5/10", HOY)).toBe("2026-10-05");
    expect(resolverFecha("2026-10-05T00:00:00", HOY)).toBe("2026-10-05");
    expect(resolverFecha("lunes 5 de octubre", HOY)).toBe("2026-10-05");
    expect(resolverFecha("1 de octubre", HOY)).toBe("2026-10-01");
    // "31/02" no existe: se rechaza y el movimiento queda para revisar.
    expect(resolverFecha("31/02", HOY)).toBeNull();
    expect(resolverFecha("31 de febrero", HOY)).toBeNull();
    expect(resolverFecha("13/13", HOY)).toBeNull();
  });

  test("sabe si la frase habla de algún momento", () => {
    expect(mencionaFecha("la semana pasada pagué 300")).toBe(true);
    expect(mencionaFecha("Compré unos tenis de 1,899 en Liverpool")).toBe(false);
  });
});

describe("montos dichos con palabras", () => {
  test("junta palabras, mil y k", () => {
    expect(montosDelTexto("Mil doscientos cincuenta de súper")).toEqual([1250]);
    expect(montosDelTexto("Dos mil quinientos de luz")).toEqual([2500]);
    expect(montosDelTexto("ochenta y cinco pesos en un café")).toEqual([85]);
    // El dictado parte los centavos con un espacio (2026-10-09); "100. 20 personas" sigue siendo dos números.
    expect(montosDelTexto("en Invex tengo un total de 37,581. 21 pesos")).toEqual([37581.21]);
    expect(montosDelTexto("tengo 37,581. 21")).toEqual([37581.21]);
    expect(montosDelTexto("pagué 100. 20 personas fueron")).toEqual([100, 20]);
    expect(montosDelTexto("Uber 100. 25 pesos de propina")).toEqual([100, 25]);
    expect(montosDelTexto("café 45. 30 pesos el pan")).toEqual([45, 30]);
    expect(montosDelTexto("veintitrés mil cuatrocientos")).toEqual([23400]);
    expect(montosDelTexto("Me pagaron la quincena, 12 mil")).toEqual([12000]);
    expect(montosDelTexto("Gasté 1.5k en ropa")).toEqual([1500]);
    expect(montosDelTexto("Cobré 2,350.75 de una factura")).toEqual([2350.75]);
    expect(montosDelTexto("Una coca de 25, unas papas de 18")).toEqual([25, 18]);
  });

  test("ignora artículos, días y centavos", () => {
    expect(montosDelTexto("un café de sesenta")).toEqual([60]);
    expect(montosDelTexto("hace dos días gasté 300")).toEqual([300]);
    expect(montosDelTexto("Pagué 199 pesos con 90 centavos")).toEqual([199]);
    expect(montoConPalabras("Compré unos tenis de 1,899")).toBe(false);
    expect(montoConPalabras("3 mil")).toBe(true);
  });
});

describe("hallazgos de QA", () => {
  test("los millones no se multiplican por el mil que sigue", () => {
    expect(montosDelTexto("Vendí mi coche en un millón doscientos mil")).toEqual([1_200_000]);
    expect(montosDelTexto("un millón quinientos mil pesos")).toEqual([1_500_000]);
    expect(montosDelTexto("dos millones trescientos cuarenta y cinco mil seiscientos")).toEqual([2_345_600]);
    expect(montosDelTexto("un millón de pesos")).toEqual([1_000_000]);
    expect(montosDelTexto("1.5 millones")).toEqual([1_500_000]);
    expect(montoConPalabras("un millón")).toBe(true);
  });

  test("fechas: hace un mes, la semana pasada, fechas que no existen y días que aún no llegan", () => {
    expect(resolverFecha("hace un mes", HOY)).toBe("2026-09-07");
    expect(resolverFecha("hace 2 meses", HOY)).toBe("2026-08-07");
    expect(resolverFecha("la semana pasada", HOY)).toBe("2026-09-30");
    expect(fechaDelTexto("hace un mes pagué 500 de dentista", HOY)).toBe("2026-09-07");
    // Dicho el 7 de octubre: el 15 es de este año; diciembre todavía no llega, así que es del pasado.
    expect(resolverFecha("15 de octubre", HOY)).toBe("2026-10-15");
    expect(resolverFecha("15 de diciembre", HOY)).toBe("2025-12-15");
    expect(resolverFecha("30/02/2026", HOY)).toBeNull();
  });

  test("periodos: quincena, mes por nombre y última semana", () => {
    expect(resolverPeriodo("esta_quincena", HOY)).toEqual({ desde: "2026-10-01", hasta: HOY });
    expect(resolverPeriodo("quincena_pasada", HOY)).toEqual({ desde: "2026-09-16", hasta: "2026-09-30" });
    expect(resolverPeriodo("quincena_pasada", "2026-10-20")).toEqual({ desde: "2026-10-01", hasta: "2026-10-15" });
    expect(resolverPeriodo("quincena_pasada", "2026-01-10")).toEqual({ desde: "2025-12-16", hasta: "2025-12-31" });
    expect(resolverPeriodo("septiembre", HOY)).toEqual({ desde: "2026-09-01", hasta: "2026-09-30" });
    expect(resolverPeriodo("noviembre", HOY)).toEqual({ desde: "2025-11-01", hasta: "2025-11-30" });
    expect(resolverPeriodo("ultima_semana", HOY)).toEqual({ desde: "2026-10-01", hasta: HOY });
  });
});
