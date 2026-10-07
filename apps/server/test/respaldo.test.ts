import { describe, expect, test } from "bun:test";
import { correccionDeCuenta } from "../src/ai/respaldo";

describe("corrección de cuenta sin el modelo (QA-020)", () => {
  test("reconoce 'fue/era/lo pagué con' más un medio de pago", () => {
    expect(correccionDeCuenta("El súper de hoy fue con la tarjeta de crédito Nu", [])).toEqual({
      buscar: { texto: "el super de", periodo: "hoy" },
      cuenta: "la tarjeta de crédito Nu",
    });
    // Un "con" antes del verbo es parte del gasto.
    expect(correccionDeCuenta("El café con leche de hoy fue con la Nu", [])?.cuenta).toBe("la Nu");
    expect(correccionDeCuenta("El Uber del viernes era con la BBVA.", [])?.buscar).toEqual({ texto: "el uber del", periodo: "viernes" });
    // Sin día, el más reciente de la última semana.
    expect(correccionDeCuenta("lo de Walmart lo pagué con efectivo", [])?.buscar).toEqual({
      texto: "lo de walmart",
      periodo: "ultima_semana",
      mas_reciente: true,
    });
    // Una cuenta que ya tienes aunque no suene a banco.
    expect(correccionDeCuenta("el café fue con la de mi esposa", ["La de mi esposa"])?.cuenta).toBe("la de mi esposa");
  });

  test("no confunde otras frases", () => {
    expect(correccionDeCuenta("La cena fue con mis amigos", [])).toBeUndefined();
    expect(correccionDeCuenta("El súper fue de 500 con la Nu", [])).toBeUndefined(); // trae monto: lo hace el modelo
    expect(correccionDeCuenta("¿El súper fue con la Nu?", [])).toBeUndefined();
    expect(correccionDeCuenta("gasté en el súper con la Nu", [])).toBeUndefined();
    expect(correccionDeCuenta("hoy fue con la Nu", [])).toBeUndefined(); // no dice qué gasto
    // Dice más de una cosa (QA-022): lo decide el modelo.
    expect(correccionDeCuenta("El súper de hoy fue con Nu, no con BBVA", [])).toBeUndefined();
    expect(correccionDeCuenta("El súper fue con la Nu y el Uber con BBVA", [])).toBeUndefined();
    expect(correccionDeCuenta("Lo del súper fue con tarjeta de crédito, no de débito", [])).toBeUndefined();
    expect(correccionDeCuenta("El súper fue con la Nu, gracias", [])).toBeUndefined();
  });
});
