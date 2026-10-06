import { describe, expect, test } from "bun:test";
import { confirmacionDirecta } from "../src/ai/confirmacion";

const HOY = "2026-10-07";
const mov = (datos: Record<string, unknown>) => ({ fecha: HOY, tipo: "gasto", monto: "$85", ...datos });
const registro = (...movimientos: Record<string, unknown>[]) => ({
  herramienta: "registrar_movimientos",
  resultado: { registrados: movimientos.map(mov) },
});

describe("confirmación sin otra vuelta del modelo", () => {
  test("un registro dice qué se guardó, con la fecha si no es hoy", () => {
    expect(confirmacionDirecta("Gasté 85 en un café", HOY, [registro({ categoria: "Comida > Café", descripcion: "café" })])).toBe(
      "Listo, café de $85.",
    );
    expect(
      confirmacionDirecta("El Uber de ayer fueron 120 con la Nu", HOY, [
        registro({ monto: "$120", categoria: "Transporte > Taxi y apps", comercio: "Uber", cuenta: "Nu", fecha: "2026-10-06" }),
      ]),
    ).toBe("Listo, Uber de $120 en Taxi y apps con Nu de ayer.");
    expect(
      confirmacionDirecta("El viernes gasté 300 en tacos", HOY, [registro({ monto: "$300", categoria: "Comida", descripcion: "tacos", fecha: "2026-10-02" })]),
    ).toBe("Listo, tacos de $300 en Comida del viernes 2 de octubre.");
  });

  test("varios registros van en una sola frase y avisa si una categoría quedó por revisar", () => {
    expect(
      confirmacionDirecta("Café 60 y gasolina 800", HOY, [
        registro({ monto: "$60", categoria: "Comida > Café" }, { monto: "$800", categoria: "Transporte > Gasolina", revisar: true }),
      ]),
    ).toBe("Listo, café de $60 y gasolina de $800. No supe bien la categoría; la dejé para que la revises.");
  });

  test("deja seguir al modelo si la frase pide algo más que registrar", () => {
    // Dos montos y un solo registro: quizá falta uno.
    expect(confirmacionDirecta("Café 60 y gasolina 800", HOY, [registro({ monto: "$60" })])).toBeUndefined();
    expect(confirmacionDirecta("Gasté 200 en tacos, ¿cuánto llevo?", HOY, [registro({})])).toBeUndefined();
    expect(confirmacionDirecta("Netflix me cobra 219 cada mes", HOY, [registro({})])).toBeUndefined();
    expect(confirmacionDirecta("Anota 50 de pan y borra el café", HOY, [registro({})])).toBeUndefined();
    // Frases compuestas que encontró QA: una pregunta al final, algo que se repite o una corrección aparte.
    for (const frase of [
      "Gasté 85 en café y registra que el Uber de ayer fue con la Nu",
      "Gasté 85 en café, apúntalo y dime cómo voy",
      "Gasté 85 en café. Cómo voy este mes",
      "Pago Netflix 219 al mes",
      "Compré una tele de 12 mil a 12 meses sin intereses",
    ]) {
      expect(confirmacionDirecta(frase, HOY, [registro({})])).toBeUndefined();
    }
    expect(confirmacionDirecta("Gasté 85", HOY, [{ herramienta: "registrar_movimientos", resultado: { error: "x" } }])).toBeUndefined();
    expect(confirmacionDirecta("¿Cuánto gasté hoy?", HOY, [{ herramienta: "consultar_gastos", resultado: { total: "$85" } }])).toBeUndefined();
    expect(confirmacionDirecta("Gasté 85", HOY, [])).toBeUndefined();
  });

  test("corregir, borrar y deshacer de un solo golpe", () => {
    expect(
      confirmacionDirecta("Fueron 95, no 85", HOY, [{ herramienta: "editar_movimiento", resultado: { editado: mov({ monto: "$95", comercio: "Starbucks", categoria: "Comida > Café" }) } }]),
    ).toBe("Listo, quedó Starbucks de $95 en Café.");
    expect(
      confirmacionDirecta("Era del viernes", HOY, [{ herramienta: "editar_movimiento", resultado: { editado: mov({ fecha: "2026-10-02", comercio: "Oxxo" }) } }]),
    ).toBe("Listo, quedó Oxxo de $85 del viernes 2 de octubre.");
    expect(
      confirmacionDirecta("Borra el último café", HOY, [{ herramienta: "eliminar_movimiento", resultado: { eliminado: mov({ categoria: "Comida > Café" }) } }]),
    ).toBe("Listo, borré café de $85.");
    expect(confirmacionDirecta("Deshaz eso", HOY, [{ herramienta: "deshacer", resultado: { deshecho: true } }])).toBe("Listo, lo deshice.");
    // Con "y" puede venir una segunda parte que el modelo todavía no hizo.
    expect(
      confirmacionDirecta("Borra el café y el Uber", HOY, [{ herramienta: "eliminar_movimiento", resultado: { eliminado: mov({}) } }]),
    ).toBeUndefined();
  });
});
