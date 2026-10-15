import { describe, expect, test } from "bun:test";
import { dinero } from "../src/lib/formato";

describe("dinero compacto", () => {
  // Espacios que no se parten (U+00A0), como los pone Intl. En el iPhone y en Chrome salía «−123 k$» (el signo de pesos al final).
  test("el signo de pesos va adelante, con un decimal", () => {
    expect(dinero(123_456_78, "MXN", { compacto: true })).toBe("$123.5\u00a0k");
    expect(dinero(-123_456_78, "MXN", { compacto: true })).toBe("−$123.5\u00a0k");
    expect(dinero(1_234_567_89, "MXN", { compacto: true })).toBe("$1.2\u00a0M");
    expect(dinero(100_000_00, "MXN", { compacto: true })).toBe("$100\u00a0k");
  });

  test("otra moneda lleva su código, como el formato normal", () => {
    expect(dinero(123_456_78, "USD")).toStartWith("USD");
    expect(dinero(123_456_78, "USD", { compacto: true })).toBe("USD\u00a0123.5\u00a0k");
  });

  test("sin compacto queda igual", () => {
    expect(dinero(123_456_78)).toBe("$123,456.78");
    expect(dinero(-5_00, "MXN", { signo: true })).toBe("−$5.00");
  });
});
