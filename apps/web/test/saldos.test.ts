import { describe, expect, test } from "bun:test";
import {
  colorUso,
  creditoTotal,
  describirCuentas,
  faltan,
  enCuantosDias,
  leerCantidad,
  limpiarPesos,
  lineaCuenta,
  nombreTipo,
  proximaFecha,
  repartoDinero,
  separarCuentas,
  usoCredito,
} from "../src/lib/saldos";
import type { CuentaConMes } from "../src/lib/tipos";

const base: CuentaConMes = {
  id: "x",
  nombre: "X",
  tipo: "debito",
  institucion: null,
  alias: [],
  archivada: false,
  esCredito: false,
  conocido: true,
  saldoCentavos: 0,
  deudaCentavos: null,
  disponibleCentavos: 0,
  limiteCentavos: null,
  saldoEn: null,
  diaCorte: null,
  diaPago: null,
  mes: { entradaCentavos: 0, salidaCentavos: 0 },
};
const debito = (id: string, saldo: number | null, extra: Partial<CuentaConMes> = {}): CuentaConMes => ({
  ...base,
  id,
  nombre: id,
  conocido: saldo !== null,
  saldoCentavos: saldo,
  disponibleCentavos: saldo,
  ...extra,
});
const credito = (id: string, deuda: number | null, limite: number | null, extra: Partial<CuentaConMes> = {}): CuentaConMes => ({
  ...base,
  id,
  nombre: id,
  tipo: "credito",
  esCredito: true,
  conocido: deuda !== null,
  saldoCentavos: deuda === null ? null : -deuda,
  deudaCentavos: deuda,
  limiteCentavos: limite,
  disponibleCentavos: deuda !== null && limite !== null ? limite - deuda : null,
  ...extra,
});

describe("proximaFecha", () => {
  test("hoy cuenta; si ya pasó, el mes que viene", () => {
    expect(proximaFecha(6, "2026-10-06")).toBe("2026-10-06");
    expect(proximaFecha(20, "2026-10-06")).toBe("2026-10-20");
    expect(proximaFecha(1, "2026-10-06")).toBe("2026-11-01");
  });
  test("un 31 cae en el último día de un mes corto, y diciembre pasa a enero", () => {
    expect(proximaFecha(31, "2026-11-05")).toBe("2026-11-30");
    expect(proximaFecha(31, "2027-02-10")).toBe("2027-02-28");
    expect(proximaFecha(30, "2028-02-10")).toBe("2028-02-29");
    expect(proximaFecha(3, "2026-12-20")).toBe("2027-01-03");
  });
  test("en cuántos días", () => {
    expect(enCuantosDias("2026-10-06", "2026-10-06")).toBe("hoy");
    expect(enCuantosDias("2026-10-07", "2026-10-06")).toBe("mañana");
    expect(enCuantosDias("2026-11-01", "2026-10-06")).toBe("en 26 días");
  });
});

describe("tarjetas", () => {
  test("uso del límite; sin límite o sin deuda no se sabe (null, no 0)", () => {
    expect(usoCredito(credito("nu", 4_500_00, 30_000_00))).toBeCloseTo(0.15);
    expect(usoCredito(credito("nu", 4_500_00, null))).toBeNull();
    expect(usoCredito(credito("nu", null, 30_000_00))).toBeNull();
    // Saldo a favor: uso cero.
    expect(usoCredito(credito("nu", -500_00, 30_000_00))).toBe(0);
  });
  test("el color sube a naranja al 70% y a rojo al 90%, como el aviso del revisor", () => {
    expect(colorUso(0.5)).toBe("var(--tint)");
    expect(colorUso(0.7)).toBe("var(--orange)");
    expect(colorUso(0.9)).toBe("var(--negative)");
    expect(colorUso(1.2)).toBe("var(--negative)");
  });
});

describe("listas", () => {
  test("separar: dinero y tarjetas, conocidas primero y de mayor a menor; archivadas aparte", () => {
    const r = separarCuentas([
      debito("sin", null),
      debito("poco", 100),
      credito("chica", 100, 1000),
      debito("mucho", 5000),
      credito("grande", 900, 1000),
      credito("nose", null, 1000),
      debito("vieja", 10, { archivada: true }),
    ]);
    expect(r.dinero.map((c) => c.id)).toEqual(["mucho", "poco", "sin"]);
    expect(r.tarjetas.map((c) => c.id)).toEqual(["grande", "chica", "nose"]);
    expect(r.archivadas.map((c) => c.id)).toEqual(["vieja"]);
  });

  test("reparto: solo saldos conocidos y positivos; las chicas se juntan en Otras", () => {
    const r = repartoDinero([debito("a", 600), debito("b", 300), debito("c", 100), debito("neg", -50), debito("nose", null), credito("t", 10, 100)]);
    expect(r.map((p) => [p.nombre, Math.round(p.parte * 100)])).toEqual([
      ["a", 60],
      ["b", 30],
      ["c", 10],
    ]);
    const muchas = repartoDinero(["a", "b", "c", "d", "e", "f"].map((id, i) => debito(id, 600 - i * 100)), 4);
    expect(muchas.map((p) => p.nombre)).toEqual(["a", "b", "c", "Otras 3"]);
    expect(muchas.at(-1)?.centavos).toBe(300 + 200 + 100);
    expect(repartoDinero([debito("nose", null)])).toEqual([]);
  });

  test("lo que dice cada fila", () => {
    expect(lineaCuenta(debito("a", null), "MXN")).toBe("No sé cuánto hay");
    expect(lineaCuenta(credito("t", null, 1000_00), "MXN")).toBe("No sé cuánto debes");
    expect(lineaCuenta(debito("a", 100), "MXN")).toBe("Sin movimientos este mes");
    expect(lineaCuenta(debito("a", 100, { mes: { entradaCentavos: 18_750_00, salidaCentavos: 3_400_50 } }), "MXN")).toBe("Este mes +$18,750 −$3,400.50");
    expect(lineaCuenta(credito("t", 4_500_00, 30_000_00), "MXN")).toBe("$25,500 disponible");
    expect(lineaCuenta(credito("t", 31_000_00, 30_000_00), "MXN")).toBe("Te pasaste $1,000");
    expect(lineaCuenta(credito("t", -200_00, 30_000_00), "MXN")).toBe("$200 a favor");
    expect(lineaCuenta(credito("t", 100_00, null), "MXN")).toBe("Sin límite dicho");
  });

  test("cómo quedaron después de mover dinero: solo las que se conocen", () => {
    expect(describirCuentas([debito("BBVA", 16_950_00), credito("Nu", 3_000_00, 30_000_00), debito("Revolut", null)], "MXN")).toBe(
      "BBVA: $16,950.00 · Nu: debes $3,000.00",
    );
    expect(describirCuentas([credito("Nu", 0, 30_000_00)], "MXN")).toBe("Nu: no debes nada");
  });
});

describe("leerCantidad", () => {
  test("vacío es null; cero vale (no debo nada)", () => {
    expect(leerCantidad("")).toBeNull();
    expect(leerCantidad("0")).toBe(0);
    expect(leerCantidad("0.00")).toBe(0);
    expect(leerCantidad("5,000")).toBe(5000);
    expect(leerCantidad("1500,50")).toBe(1500.5);
  });
  test("con signo: saldo a favor o sobregiro (y lo que se teclea guarda el menos solo al inicio)", () => {
    expect(leerCantidad("-200")).toBe(-200);
    expect(leerCantidad("−1,500.50")).toBe(-1500.5);
    expect(leerCantidad("-0")).toBe(0);
    expect(leerCantidad("20-0")).toBe(200);
    expect(limpiarPesos("-2a0-0")).toBe("-200");
    expect(limpiarPesos("1-5")).toBe("15");
  });
});

describe("crédito de todas las tarjetas", () => {
  test("solo las que tienen deuda y límite; un límite sin deuda no es 100% usado", () => {
    const r = creditoTotal([
      credito("nu", 4_500_00, 30_000_00),
      credito("banamex", 27_600_00, 30_000_00),
      credito("hsbc", null, 30_000_00),
      credito("amex", 1_000_00, null),
      credito("vieja", 15_000_00, 15_000_00, { archivada: true }),
      debito("bbva", 100),
    ])!;
    expect(r.limite).toBe(60_000_00);
    expect(r.disponible).toBe(27_900_00);
    expect(r.uso).toBeCloseTo(32_100_00 / 60_000_00);
    expect(r.fuera).toEqual(["amex"]);
  });
  test("saldo a favor no resta uso; pasarse no da disponible negativo; sin ninguna, null", () => {
    const r = creditoTotal([credito("a", -500_00, 10_000_00), credito("b", 12_000_00, 10_000_00)])!;
    expect(r.uso).toBeCloseTo(0.6);
    expect(r.disponible).toBe(10_000_00);
    expect(creditoTotal([credito("hsbc", null, 30_000_00), debito("bbva", 100)])).toBeNull();
  });
});

describe("textos", () => {
  test("tipos del servidor y uno desconocido", () => {
    expect(nombreTipo("monedero")).toBe("Monedero");
    expect(nombreTipo("vales")).toBe("Vales");
    expect(nombreTipo("transferencia")).toBe("Cuenta");
    expect(nombreTipo("cripto")).toBe("Cuenta");
  });
  test("las que faltan en la suma", () => {
    expect(faltan([])).toBe("");
    expect(faltan(["Nu"])).toBe("falta Nu");
    expect(faltan(["Nu", "Revolut"])).toBe("faltan Nu y Revolut");
    expect(faltan(["a", "b", "c"])).toBe("faltan 3");
  });
});
