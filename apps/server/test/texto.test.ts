import { describe, expect, test } from "bun:test";
import { montosParaVoz } from "../src/lib/dinero";
import { esOrdenSobreLoAnotado, esPregunta, monedaDelTexto } from "../src/lib/texto";

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

describe("montosParaVoz", () => {
  // La voz del iPhone lee "$50" como "50 dólares".
  test("los pesos se dicen pesos y las otras monedas por su nombre", () => {
    expect(montosParaVoz("Listo, Oxxo de $50 en Café.")).toBe("Listo, Oxxo de 50 pesos en Café.");
    expect(montosParaVoz("Llevas $1,250.50; ayer $85 y $1.")).toBe("Llevas 1,250.50 pesos; ayer 85 pesos y 1 peso.");
    expect(montosParaVoz("Spotify de 10 USD y Disney de 8 EUR.")).toBe("Spotify de 10 dólares y Disney de 8 euros.");
  });

  test("no repite la moneda si el modelo ya la escribió", () => {
    expect(montosParaVoz("$50 pesos, $20 USD, US$5 y $ 300")).toBe("50 pesos, 20 dólares, 5 dólares y 300 pesos");
    expect(montosParaVoz("Tienes 3 cafés y 2 Ubers.")).toBe("Tienes 3 cafés y 2 Ubers.");
  });

  test("una coma después del monto no se queda pegada al número", () => {
    expect(montosParaVoz("¿Fue de $3,500, como la vez pasada?")).toBe("¿Fue de 3,500 pesos, como la vez pasada?");
    expect(montosParaVoz("Llevas $1,250.50, y ayer 20 USD, nada más.")).toBe("Llevas 1,250.50 pesos, y ayer 20 dólares, nada más.");
    expect(montosParaVoz("Fueron $1,2500")).toBe("Fueron 1,2500 pesos");
  });
});

test("reconoce órdenes de borrar o cambiar algo ya anotado (QA-029)", () => {
  for (const frase of [
    "Borra el café de 85",
    "Bórrame el café de 85",
    "quítame el Uber de 120",
    "cámbiame el súper de 850 a la BBVA",
    "bórralos, los dos de 85",
    "pásale el súper de 850 a crédito",
    "quiero borrar el café de 85",
    "puedes borrar el café de 85",
    "corrige el Uber de 120, fueron 150",
    "deshaz lo último",
  ]) {
    expect(esOrdenSobreLoAnotado(frase)).toBe(true);
  }
  for (const frase of ["Gasté 85 en un café", "Qué pasa con mis gastos de 500", "Pagué la cancelación de 300"]) {
    expect(esOrdenSobreLoAnotado(frase)).toBe(false);
  }
});

test("reconoce correcciones que no dicen borra ni cambia, aunque traigan monto", () => {
  for (const frase of [
    "no eran 85, eran 95",
    "No, fueron 120, no 85",
    "eran 95 no 85",
    "me equivoqué, el café fue de 95",
    "perdón, me confundí, fueron 300",
    "en realidad fue con la BBVA",
    "en realidad pagué 450",
    "no fue en efectivo, fue con la Nu",
    "el Uber lo anotaste dos veces",
    "el súper está repetido",
    "actualiza el súper a 1,250",
    "modifícalo a 300",
    "ajusta la renta a 9 mil",
    "agrégale 20 de propina al café",
    "el último era de 150",
    "ese de 85 no lo anotes",
    "olvídalo",
  ]) {
    expect(esOrdenSobreLoAnotado(frase)).toBe(true);
  }
  for (const frase of [
    "gasolina 700",
    "tele de 8 mil",
    "me pagaron 5000",
    "no fue mucho, solo 50 de café",
    "fue 85 de café",
    "tacos 120 y eran para 3",
    "se me olvida decirte que gasté 50 en café",
    "se me olvidó anotar 200 de Uber",
    "compré un arreglo de flores de 400",
  ]) {
    expect(esOrdenSobreLoAnotado(frase)).toBe(false);
  }
});
