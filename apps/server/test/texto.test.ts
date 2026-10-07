import { describe, expect, test } from "bun:test";
import { esPregunta, monedaDelTexto } from "../src/lib/texto";

describe("esPregunta", () => {
  test("reconoce preguntas dictadas sin signos", () => {
    for (const frase of [
      "Oye, cuánto llevo gastado este mes",
      "Quiero saber cuánto gasté en Uber",
      "y en Uber",
      "Me puedes decir cuánto gasté",
      "Voy bien este mes",
      "Cuéntame cómo voy",
      "Necesito saber mis suscripciones",
      "Puedo gastar 500 hoy",
      "En qué gasto más",
      "Ver mis gastos",
      "Debo algo",
      "A ver mis suscripciones",
      "Lo de este mes",
      "Estoy gastando mucho",
      "Dame el resumen",
    ]) {
      expect(esPregunta(frase)).toBe(true);
    }
  });

  test("no confunde un registro con una pregunta", () => {
    for (const frase of ["Gasté 85 en café", "Tengo que pagar la renta el 5", "Hay que pagar 300 de luz", "Qué onda, gasté 200 en tacos", "y 50 de propina",
      "Y el Uber fue con la BBVA",
      "Me cobraron no sé cuánto de comisión, como 35",
      "Pagué 400 en que se llama, el Oxxo",
      "Borra el último",
      "Estoy pagando 200 de gym",
      "Netflix me cobró",
      "Me cobraron la anualidad",
    ]) {
      expect(esPregunta(frase)).toBe(false);
    }
  });
});

test("libras de peso no son libras esterlinas", () => {
  expect(monedaDelTexto("Compré 2 libras de carne en 180")).toBeUndefined();
  expect(monedaDelTexto("Pagué 20 libras en Londres")).toBe("GBP");
  expect(monedaDelTexto("Me cobraron 15 libras esterlinas")).toBe("GBP");
});
