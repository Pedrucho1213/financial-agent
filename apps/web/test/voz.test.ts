import { describe, expect, test } from "bun:test";
import { elegirVoz, mensajeErrorDictado, textoParaLeer, unirDictado } from "../src/lib/voz";

describe("voz del chat", () => {
  test("lo dictado se suma a lo escrito sin espacios de más", () => {
    expect(unirDictado("", " gasté 85 ")).toBe("Gasté 85");
    expect(unirDictado("", "¿cómo voy?")).toBe("¿Cómo voy?");
    expect(unirDictado("Uber de", "Nu")).toBe("Uber de Nu");
    expect(unirDictado("Uber de ", "230")).toBe("Uber de 230");
    expect(unirDictado("Hola", "")).toBe("Hola");
  });

  test("se lee sin marcas ni viñetas, y MSI completo", () => {
    expect(textoParaLeer("Llevas **1,234 pesos** en _Comida_.\n- Café: 85 pesos\n- Uber: 230 pesos")).toBe(
      "Llevas 1,234 pesos en Comida. Café: 85 pesos. Uber: 230 pesos",
    );
    expect(textoParaLeer("¿Lo pagaste a 6 MSI?\nAvísame.")).toBe("¿Lo pagaste a 6 meses sin intereses? Avísame.");
  });

  test("elige la voz de México y deja fuera las de juguete", () => {
    const voces = [
      { lang: "en-US", name: "Samantha", localService: true },
      { lang: "es-ES", name: "Mónica", localService: true },
      { lang: "es-MX", name: "Eddy (Español (México))", localService: true },
      { lang: "es-MX", name: "Paulina", localService: true },
    ];
    expect(elegirVoz(voces)?.name).toBe("Paulina");
    expect(elegirVoz(voces.filter((v) => v.name !== "Paulina"))?.name).toBe("Mónica");
    expect(elegirVoz([{ lang: "es_MX", name: "Paulina (Mejorada)", localService: false }, ...voces])?.name).toBe("Paulina (Mejorada)");
    expect(elegirVoz([{ lang: "en-US", name: "Samantha", localService: true }])).toBeUndefined();
  });

  test("los errores del dictado dicen qué hacer; los esperados no avisan", () => {
    expect(mensajeErrorDictado("not-allowed")).toContain("micrófono");
    expect(mensajeErrorDictado("network")).toContain("internet");
    expect(mensajeErrorDictado("aborted")).toBeNull();
    expect(mensajeErrorDictado("no-speech")).toBeNull();
  });
});
