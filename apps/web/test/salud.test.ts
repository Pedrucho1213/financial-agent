import { describe, expect, test } from "bun:test";
import { ErrorApi } from "../src/lib/api";
import { detalleCorto, nivelDePuntos, NIVELES, puntoDelArco, type SaludFinanciera, saludParaMostrar, tramoDelArco } from "../src/lib/salud";

const base: SaludFinanciera = {
  nivel: "sobregirado",
  nivelSinAlertas: null,
  puntaje: null,
  titulo: "Sobregirado",
  resumen: "Por esto: Revolut crédito va al 91% de su límite.",
  alertas: ["Revolut crédito va al 91% de su límite."],
  pilares: [],
  ingresos: { esteMesCentavos: 0, mensualCentavos: null, enOtraMoneda: false },
  base: { desde: "2026-10-07", hasta: "2026-10-14", dias: 8, gastoMensualCentavos: 1_868_240, pocosDatos: true },
  mexico: [],
  rubros: [],
  consejos: [],
  faltan: [],
  fuentes: [],
};

describe("salud financiera en la app", () => {
  test("los niveles cubren de 0 a 100 sin huecos", () => {
    expect(NIVELES[0]!.desde).toBe(0);
    expect(NIVELES.at(-1)!.hasta).toBe(100);
    for (let i = 1; i < NIVELES.length; i++) expect(NIVELES[i]!.desde).toBe(NIVELES[i - 1]!.hasta);
    expect([0, 24, 25, 64, 65, 85, 100].map(nivelDePuntos)).toEqual(["sobregirado", "sobregirado", "en_riesgo", "vamos_bien", "excelente", "optimizando", "optimizando"]);
  });

  test("el arco: 0 a la izquierda, 50 arriba, 100 a la derecha", () => {
    const p = (v: number) => {
      const { x, y } = puntoDelArco(v, 100, 100, 50);
      return [Math.round(x), Math.round(y)];
    };
    expect(p(0)).toEqual([50, 100]);
    expect(p(50)).toEqual([100, 50]);
    expect(p(100)).toEqual([150, 100]);
    expect(p(-20)).toEqual([50, 100]);
    expect(tramoDelArco(0, 100, 100, 100, 50)).toBe("M 50.00 100.00 A 50 50 0 0 1 150.00 100.00");
  });

  test("la línea de Inicio: la alerta corta, la calificación o qué falta", () => {
    expect(detalleCorto(base)).toBe("Sobregirado · Revolut crédito al 91%");
    expect(detalleCorto({ ...base, nivel: "vamos_bien", titulo: "Vamos bien", alertas: [], puntaje: 58 })).toBe("Vamos bien · 58 de 100");
    expect(detalleCorto({ ...base, nivel: null, titulo: "Aún no sé", alertas: [] })).toBe("Dime tu ingreso para calificarte");
  });

  test("si el servidor dice 404, no se muestra aunque haya una copia guardada", () => {
    expect(saludParaMostrar({ data: base, error: null })).toBe(base);
    expect(saludParaMostrar({ data: base, error: new ErrorApi(404, "No encontrado.") })).toBeUndefined();
    // Sin conexión se sigue viendo lo último que se supo.
    expect(saludParaMostrar({ data: base, error: new ErrorApi(0, "Sin conexión") })).toBe(base);
  });
});
