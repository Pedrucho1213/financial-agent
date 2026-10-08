import { describe, expect, test } from "bun:test";
import { cubetas, diasEntre, diaSemana, esPeriodo, lunesDe, moverRef, rangoAnterior, rangoDe, sumarDias, tituloRango } from "../src/lib/periodos";

describe("periodos", () => {
  test("rango de cada periodo", () => {
    expect(rangoDe("semana", "2026-10-06")).toEqual({ desde: "2026-10-05", hasta: "2026-10-11" });
    expect(rangoDe("mes", "2026-02-10")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoDe("6m", "2026-10-06")).toEqual({ desde: "2026-05-01", hasta: "2026-10-31" });
    expect(rangoDe("anio", "2026-10-06")).toEqual({ desde: "2025-11-01", hasta: "2026-10-31" });
  });

  test("el anterior es igual de largo y justo antes", () => {
    expect(rangoAnterior("semana", "2026-10-06")).toEqual({ desde: "2026-09-28", hasta: "2026-10-04" });
    expect(rangoAnterior("mes", "2026-03-31")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoAnterior("6m", "2026-10-06")).toEqual({ desde: "2025-11-01", hasta: "2026-04-30" });
    expect(rangoAnterior("anio", "2026-01-15")).toEqual({ desde: "2024-02-01", hasta: "2025-01-31" });
  });

  test("moverse entre periodos cruza meses y años", () => {
    expect(moverRef("semana", "2026-10-01", -1)).toBe("2026-09-21");
    expect(moverRef("mes", "2026-01-31", -1)).toBe("2025-12-01");
    expect(moverRef("6m", "2026-10-06", 1)).toBe("2027-04-01");
    expect(moverRef("anio", "2026-10-06", -1)).toBe("2025-10-01");
  });

  test("días de la semana y lunes", () => {
    expect(diaSemana("2026-10-05")).toBe(1);
    expect(diaSemana("2026-10-11")).toBe(7);
    expect(lunesDe("2026-11-01")).toBe("2026-10-26");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(diasEntre("2026-10-01", "2026-10-31")).toBe(31);
    expect(diasEntre("2026-03-01", "2026-03-31")).toBe(31);
  });

  test("cubetas: días, semanas (cortadas en las orillas) y meses", () => {
    expect(cubetas("mes", rangoDe("mes", "2026-10-06"))).toHaveLength(31);
    const semanas = cubetas("6m", rangoDe("6m", "2026-10-06"));
    // 1 de mayo de 2026 es viernes: la primera semana va del 1 al 3.
    expect(semanas[0]).toMatchObject({ desde: "2026-05-01", hasta: "2026-05-03", corta: "may", larga: "1–3 may" });
    expect(semanas[1]).toMatchObject({ desde: "2026-05-04", hasta: "2026-05-10", corta: "" });
    expect(semanas.at(-1)?.hasta).toBe("2026-10-31");
    // Sin huecos ni días repetidos.
    for (let i = 1; i < semanas.length; i++) expect(sumarDias(semanas[i - 1]?.hasta ?? "", 1)).toBe(semanas[i]?.desde ?? "");
    const meses = cubetas("anio", rangoDe("anio", "2026-10-06"));
    expect(meses.map((m) => m.corta).join("")).toBe("NDEFMAMJJASO");
    expect(meses[0]?.larga).toBe("Noviembre 2025");
  });

  test("la cubeta de un día dice el día de la semana", () => {
    expect(cubetas("semana", rangoDe("semana", "2026-10-06"))[0]?.larga).toBe("Lunes 5 oct");
  });

  test("títulos", () => {
    expect(tituloRango("semana", rangoDe("semana", "2026-10-06"))).toBe("5–11 oct 2026");
    expect(tituloRango("semana", rangoDe("semana", "2026-10-01"))).toBe("28 sep – 4 oct 2026");
    expect(tituloRango("mes", rangoDe("mes", "2026-10-06"))).toBe("Octubre 2026");
    expect(tituloRango("6m", rangoDe("6m", "2026-10-06"))).toBe("may – oct 2026");
    expect(tituloRango("anio", rangoDe("anio", "2026-10-06"))).toBe("nov 2025 – oct 2026");
  });

  test("esPeriodo solo acepta los cuatro", () => {
    expect(esPeriodo("mes")).toBe(true);
    expect(esPeriodo("dia")).toBe(false);
    expect(esPeriodo(null)).toBe(false);
  });
});
