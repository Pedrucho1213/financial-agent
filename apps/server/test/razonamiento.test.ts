import { expect, test } from "bun:test";
import { sinRazonamiento } from "../src/ai/asistente";

test("las respuestas normales en español quedan igual, aunque traigan nombres en inglés", () => {
  for (const r of [
    "Listo, café de $50 en Café.",
    "Ya anoté 120 en Pull and Bear y 300 en The Home Depot.",
    "Llevas $3,200 en Uber Eats este mes.\n- Lunes: $400\n- Martes: $250",
    "Te quedan $6,701 disponibles en Revolut crédito. ¿Lo pagas antes del corte?",
    "Aquí va el resumen del mes: gastaste $12,000.",
    "Según la regla 50/30/20, te conviene ahorrar $3,000.",
  ]) {
    expect(sinRazonamiento(r)).toBe(r);
  }
});

test("se quita lo que piensa en voz alta y queda lo que se le dice", () => {
  expect(sinRazonamiento("The user repeated the same expense. I'll ask. ¿Otro café de $50?")).toBe("¿Otro café de $50?");
  expect(sinRazonamiento("Como indican mis instrucciones, pregunto primero. ¿Es otra compra?")).toBe("¿Es otra compra?");
  expect(sinRazonamiento("Let me check the balance first.")).toBe("");
  // Lo que dio Claude en la Mac sobre f399037: la cita en español no la salva.
  expect(sinRazonamiento('This is an identical recent entry (jue 21:07: "gasté 50 pesos en un café"). ¿Otro café de 50 pesos?')).toBe("¿Otro café de 50 pesos?");
});
