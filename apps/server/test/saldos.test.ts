import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { confirmacionDirecta } from "../src/ai/confirmacion";
import { crearHerramientas } from "../src/ai/herramientas";
import { cuentas as tablaCuentas } from "../src/db/schema";
import { encontrarOCrearCuenta } from "../src/finanzas/catalogos";
import type { Contexto } from "../src/finanzas/contexto";
import {
  datoDeCuentas,
  esPagoDeTarjeta,
  esSaldoDicho,
  estadosDeCuentas,
  fijarCuenta,
  hablaDeCuentas,
  moverDinero,
  observacionDeCuentas,
  totalesDeCuentas,
} from "../src/finanzas/cuentas";
import { buscarMovimientos, crearMovimiento, deshacer, editarMovimiento, ErrorFinanzas } from "../src/finanzas/movimientos";
import { disponible, registrarMsi } from "../src/finanzas/planes";
import { listarAvisos } from "../src/finanzas/avisos";
import { revisar } from "../src/finanzas/revisor";
import { AHORA, preparar } from "./ayuda";

// Cada dictado, unos minutos después del anterior: el saldo dicho cuenta lo que pasó después.
let reloj = 0;
const dictado = (ctx: Contexto, texto?: string): Contexto => {
  reloj += 1;
  const ahora = new Date(AHORA.getTime() + reloj * 60_000);
  return { ...ctx, ahoraIso: ahora.toISOString(), textoOriginal: texto, entradaId: `dictado-${reloj}` };
};
const llamar = async (ctx: Contexto, nombre: string, args: unknown) =>
  (crearHerramientas(ctx, []) as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<any> }>)[nombre]!.execute(args, {});
const estado = (ctx: Contexto, nombre: string) => estadosDeCuentas(ctx).find((e) => e.nombre === nombre)!;
const pesos = (centavos: number | null) => (centavos === null ? null : centavos / 100);

describe("saldo dicho por voz", () => {
  test("tengo 20 mil en Revolut y 10 mil en Bancomer: dos cuentas con su saldo, sin gasto ni ingreso", async () => {
    const { ctx } = preparar();
    const c = dictado(ctx, "Te aviso que tengo 20 mil pesos en mi cuenta de Revolut y 10 mil pesos en mi cuenta de Bancomer");
    const r = await llamar(c, "cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 20000 }, { cuenta: "mi cuenta de Bancomer", saldo: 10000 }] });
    expect(r.confirmacion).toBe("Listo, Revolut tiene $20,000 y Bancomer tiene $10,000.");
    expect(r.montos).toBe(2);
    expect(pesos(estado(ctx, "Revolut").saldoCentavos)).toBe(20000);
    expect(estado(ctx, "Revolut").tipo).toBe("debito");
    expect(pesos(estado(ctx, "Bancomer").saldoCentavos)).toBe(10000);
    expect(buscarMovimientos(ctx, { periodo: "todo" }).encontrados).toBe(0);
    // La confirmación sale de la herramienta, sin otra vuelta del modelo, aunque la frase empiece con "tengo".
    const sola = confirmacionDirecta("tengo 20 mil en Revolut y 10 mil en Bancomer", ctx.hoy, [{ herramienta: "cuentas", resultado: r }]);
    expect(sola).toBe(r.confirmacion);
    // Con una pregunta, el modelo sigue.
    expect(confirmacionDirecta("tengo 20 mil en Revolut, ¿cuánto puedo gastar hoy?", ctx.hoy, [{ herramienta: "cuentas", resultado: r }])).toBeUndefined();
  });

  test("lo que se gasta después baja el saldo; lo que pasó antes de decirlo ya estaba incluido", async () => {
    const { ctx } = preparar();
    await llamar(dictado(ctx, "tengo 5 mil en BBVA"), "cuentas", { cuentas: [{ cuenta: "BBVA", saldo: 5000 }] });
    crearMovimiento(dictado(ctx, "gasté 300 en el súper con BBVA"), { tipo: "gasto", monto: 300, cuenta: "BBVA" });
    // "Ayer" ocurrió antes de que dijera su saldo: no se descuenta otra vez.
    crearMovimiento(dictado(ctx, "ayer gasté 200 en tacos con BBVA"), { tipo: "gasto", monto: 200, cuenta: "BBVA", fecha: "ayer" });
    crearMovimiento(dictado(ctx, "me depositaron 1000 en BBVA"), { tipo: "ingreso", monto: 1000, cuenta: "bbva" });
    // En dólares no se sabe a cuánto se cobró.
    crearMovimiento(dictado(ctx, "20 dólares con BBVA"), { tipo: "gasto", monto: 20, moneda: "USD", cuenta: "BBVA" });
    expect(pesos(estado(ctx, "BBVA").saldoCentavos)).toBe(5700);
  });

  test("una cuenta sin saldo dicho no se inventa: nada de negativos", () => {
    const { ctx } = preparar();
    crearMovimiento(dictado(ctx, "gasté 300 con la Nu"), { tipo: "gasto", monto: 300, cuenta: "Nu" });
    const e = estado(ctx, "Nu");
    expect(e.conocido).toBe(false);
    expect(e.saldoCentavos).toBeNull();
    expect(totalesDeCuentas(estadosDeCuentas(ctx)).sinSaldo).toEqual(["Nu"]);
  });

  test("tarjeta de crédito: disponible sin límite, luego el límite, y los gastos con ella", async () => {
    const { ctx } = preparar();
    let r = await llamar(dictado(ctx, "oye te recuerdo que tengo 7000 pesos disponibles en mi tarjeta de crédito Nu"), "cuentas", {
      cuentas: [{ cuenta: "tarjeta de crédito Nu", disponible: 7000 }],
    });
    expect(r.confirmacion).toBe("Listo, en Nu te quedan $7,000 disponibles.");
    let nu = estado(ctx, "Nu");
    expect(nu.tipo).toBe("credito");
    expect(pesos(nu.disponibleCentavos)).toBe(7000);
    expect(nu.deudaCentavos).toBeNull();
    r = await llamar(dictado(ctx, "tengo un límite de 30 mil en la Nu"), "cuentas", { cuentas: [{ cuenta: "la Nu", limite: 30000 }] });
    nu = estado(ctx, "Nu");
    expect(pesos(nu.deudaCentavos)).toBe(23000);
    expect(pesos(nu.disponibleCentavos)).toBe(7000);
    expect(r.confirmacion).toBe("Listo, en Nu debes $23,000 y te quedan $7,000 disponibles de $30,000.");
    crearMovimiento(dictado(ctx, "gasté mil con la Nu"), { tipo: "gasto", monto: 1000, cuenta: "Nu" });
    nu = estado(ctx, "Nu");
    expect(pesos(nu.deudaCentavos)).toBe(24000);
    expect(pesos(nu.disponibleCentavos)).toBe(6000);
  });

  test("tengo ocupado x de la tarjeta es su deuda; con límite y ocupado sale el disponible", async () => {
    const { ctx } = preparar();
    await llamar(dictado(ctx, "en la Invex tengo un límite de 20 mil y tengo ocupados 4 mil"), "cuentas", {
      cuentas: [{ cuenta: "Invex", limite: 20000, deuda: 4000 }],
    });
    const invex = estado(ctx, "Invex");
    expect(invex.tipo).toBe("credito");
    expect(pesos(invex.disponibleCentavos)).toBe(16000);
  });

  test("en una tarjeta, 'tengo 7 mil' es lo disponible y 'tengo un saldo de 3 mil' o 'debo' es la deuda", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx, "tengo un límite de 10 mil en la Invex"), { cuenta: "Invex", limite: 10000 });
    fijarCuenta(dictado(ctx, "tengo 7 mil en la Invex"), { cuenta: "Invex", saldo: 7000 });
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(3000);
    fijarCuenta(dictado(ctx, "debo 4 mil de la Invex"), { cuenta: "Invex", saldo: 4000 });
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(4000);
    fijarCuenta(dictado(ctx, "mi Invex tiene un saldo de 2 mil"), { cuenta: "Invex", saldo: 2000 });
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(2000);
  });

  test("'disponibles' en una cuenta de débito es su saldo, no la vuelve tarjeta de crédito", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx, "tengo 7 mil disponibles en BBVA"), { cuenta: "BBVA", disponible: 7000 });
    const bbva = estado(ctx, "BBVA");
    expect(bbva.esCredito).toBe(false);
    expect(pesos(bbva.saldoCentavos)).toBe(7000);
  });

  test("día de corte y de pago, y avisa cuando el pago está cerca", () => {
    const { ctx } = preparar();
    const r = fijarCuenta(dictado(ctx, "mi Nu corta el 5 y se paga el 10, debo 3 mil"), { cuenta: "Nu", diaCorte: 5, diaPago: 10, deuda: 3000 });
    expect(r.estado.diaPago).toBe(10);
    // Hoy es 7 de octubre: faltan 3 días.
    expect(observacionDeCuentas(ctx, estadosDeCuentas(ctx))).toBe("Ojo, Nu se paga en 3 días y debes $3,000.");
    expect(() => fijarCuenta(dictado(ctx, "corta el 40"), { cuenta: "Nu", diaCorte: 40 })).toThrow(ErrorFinanzas);
  });

  test("deshacer regresa el saldo anterior, y una cuenta recién creada se archiva", async () => {
    const { ctx } = preparar();
    await llamar(dictado(ctx, "tengo 5 mil en BBVA"), "cuentas", { cuentas: [{ cuenta: "BBVA", saldo: 5000 }] });
    await llamar(dictado(ctx, "tengo 8 mil en BBVA"), "cuentas", { cuentas: [{ cuenta: "BBVA", saldo: 8000 }] });
    expect(pesos(estado(ctx, "BBVA").saldoCentavos)).toBe(8000);
    deshacer(dictado(ctx, "deshaz eso"));
    expect(pesos(estado(ctx, "BBVA").saldoCentavos)).toBe(5000);
    deshacer(dictado(ctx, "deshaz eso"));
    expect(estadosDeCuentas(ctx).map((e) => e.nombre)).toEqual([]);
    expect(estadosDeCuentas(ctx, { archivadas: true }).map((e) => e.nombre)).toEqual(["BBVA"]);
  });

  test("si dice el saldo de la tarjeta de crédito y tiene dos, pregunta cuál", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Nu", limite: 10000 });
    fijarCuenta(dictado(ctx), { cuenta: "Invex", limite: 20000 });
    expect(() => fijarCuenta(dictado(ctx, "tengo 7000 disponibles en mi tarjeta de crédito"), { cuenta: "mi tarjeta de crédito", disponible: 7000 })).toThrow(
      "¿Cuál? Tienes Nu e Invex.",
    );
  });
});

describe("mover dinero", () => {
  test("pagar a la tarjeta baja la deuda y el saldo de la cuenta de donde salió", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "BBVA", saldo: 20000 });
    fijarCuenta(dictado(ctx), { cuenta: "Nu", tipo: "credito", limite: 30000, deuda: 8000 });
    const r = await llamar(dictado(ctx, "te aviso que acabo de pagar 5 mil a la Nu desde BBVA"), "mover_dinero", {
      tipo: "pago_tarjeta",
      monto: 5000,
      desde: "BBVA",
      hacia: "Nu",
    });
    expect(r.confirmacion).toBe("Listo, pago de $5,000 a Nu desde BBVA. Ahora en Nu debes $3,000 y te quedan $27,000 disponibles de $30,000 y BBVA tiene $15,000.");
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(3000);
    expect(pesos(estado(ctx, "BBVA").saldoCentavos)).toBe(15000);
    const [m] = buscarMovimientos(ctx, { periodo: "todo" }).movimientos;
    expect(m).toMatchObject({ tipo: "pago_tarjeta", cuenta: "BBVA", cuenta_destino: "Nu" });
  });

  test("abono a la tarjeta sin decir de dónde: si solo dice la tarjeta, es el destino; si tiene una sola, esa", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Invex", deuda: 4000 });
    // El modelo puso la tarjeta como "desde".
    moverDinero(dictado(ctx, "abone 1000 a la Invex"), { tipo: "pago_tarjeta", monto: 1000, desde: "Invex" });
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(3000);
    moverDinero(dictado(ctx, "acabo de abonar 500 a la tarjeta"), { tipo: "pago_tarjeta", monto: 500 });
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(2500);
  });

  test("con dos tarjetas y sin decir cuál, pregunta", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Nu", deuda: 1 });
    fijarCuenta(dictado(ctx), { cuenta: "Invex", deuda: 1 });
    expect(() => moverDinero(dictado(ctx, "pagué 500 a la tarjeta"), { tipo: "pago_tarjeta", monto: 500 })).toThrow("Pregunta a qué tarjeta fue el pago: tiene Nu e Invex.");
  });

  test("transferencia entre cuentas propias y retiro de cajero", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "BBVA", saldo: 10000 });
    fijarCuenta(dictado(ctx), { cuenta: "Revolut", saldo: 2000 });
    const t = await llamar(dictado(ctx, "acabo de transferir 3 mil de BBVA a Revolut"), "mover_dinero", { tipo: "transferencia", monto: 3000, desde: "BBVA", hacia: "Revolut" });
    expect(t.confirmacion).toBe("Listo, pasaste $3,000 de BBVA a Revolut. Ahora BBVA tiene $7,000 y Revolut tiene $5,000.");
    const r = await llamar(dictado(ctx, "saqué mil del cajero de BBVA"), "mover_dinero", { tipo: "retiro", monto: 1000, desde: "BBVA" });
    expect(r.confirmacion).toBe("Listo, retiro de $1,000 de BBVA a efectivo. Ahora BBVA tiene $6,000.");
    expect(estado(ctx, "Efectivo").tipo).toBe("efectivo");
    // El efectivo no tenía saldo dicho: no se inventa.
    expect(estado(ctx, "Efectivo").conocido).toBe(false);
  });

  test("dinero a otra persona no es una transferencia entre cuentas propias", () => {
    const { ctx } = preparar();
    expect(() => moverDinero(dictado(ctx, "le transferí 500 a Juan"), { tipo: "transferencia", monto: 500, desde: "BBVA", hacia: "Juan" })).toThrow(/no es una de sus cuentas/);
    // Una cuenta nueva que suena a cuenta sí se crea.
    moverDinero(dictado(ctx, "pasé 500 de BBVA a mi cuenta de ahorro"), { tipo: "transferencia", monto: 500, desde: "BBVA", hacia: "mi cuenta de ahorro" });
    expect(estadosDeCuentas(ctx).map((e) => e.nombre).sort()).toEqual(["Ahorro", "BBVA"]);
  });

  test("registrar_movimientos con un pago de tarjeta se va por mover_dinero", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Nu", deuda: 5000 });
    const r = await llamar(dictado(ctx, "pagué 2 mil de la tarjeta Nu"), "registrar_movimientos", { movimientos: [{ tipo: "pago_tarjeta", monto: 2000, cuenta: "Nu" }] });
    expect(r.registrados[0]).toMatchObject({ tipo: "pago_tarjeta", cuenta_destino: "Nu" });
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(3000);
    expect(confirmacionDirecta("pagué 2 mil de la tarjeta Nu", ctx.hoy, [{ herramienta: "registrar_movimientos", resultado: r }])).toBe(
      "Listo, pago de tarjeta de $2,000 a Nu.",
    );
  });

  test("una compra a meses aparta el total de la tarjeta y sus mensualidades no cuentan dos veces", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Nu", limite: 30000, deuda: 0 });
    registrarMsi(dictado(ctx, "compré una pantalla de 12 mil a 12 meses con la Nu"), { descripcion: "pantalla", total: 12000, meses: 12, cuenta: "Nu" });
    // La primera mensualidad (hoy) quedó como gasto con la Nu, pero la tarjeta ya apartó la compra completa.
    expect(buscarMovimientos(ctx, { periodo: "todo" }).encontrados).toBe(1);
    expect(pesos(estado(ctx, "Nu").disponibleCentavos)).toBe(18000);
  });

  test("una compra a meses con una cuenta sin tipo la vuelve tarjeta de crédito", () => {
    const { ctx } = preparar();
    registrarMsi(dictado(ctx), { descripcion: "tenis", total: 3000, meses: 3, cuenta: "Banorte" });
    expect(estado(ctx, "Banorte").tipo).toBe("credito");
  });
});

describe("la IA no confunde un saldo con un ingreso", () => {
  test("registrar 'tengo 20 mil en Revolut' como ingreso se desvía a cuentas", async () => {
    const { ctx } = preparar();
    const c = dictado(ctx, "tengo 20 mil en Revolut");
    const r = await llamar(c, "registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 20000, cuenta: "Revolut" }] });
    expect(r.error).toMatch(/usa cuentas/);
    expect(buscarMovimientos(ctx, { periodo: "todo" }).encontrados).toBe(0);
  });

  test("pagar a la tarjeta como gasto se desvía a mover_dinero; pagar con la tarjeta es gasto", async () => {
    const { ctx } = preparar();
    const r = await llamar(dictado(ctx, "le pagué 5 mil a la tarjeta"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 5000 }] });
    expect(r.error).toMatch(/mover_dinero/);
    const g = await llamar(dictado(ctx, "pagué 300 en el súper con la tarjeta de crédito"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 300, categoria: "Súper" }] });
    expect(g.registrados).toHaveLength(1);
  });

  test("reconoce las frases de cuentas", () => {
    const si = [
      "Te aviso que tengo 20 mil pesos en mi cuenta de Revolut y 10 mil pesos en mi cuenta de Bancomer",
      "oye te recuerdo que tengo 7000 pesos disponibles en mi tarjeta de crédito",
      "te aviso que acabo de pagar 3 mil a la tarjeta de crédito Nu",
      "tengo un límite disponible de 30 mil en la Nu",
      "tengo ocupado 5 mil de la tarjeta Invex",
      "acabo de abonar 2 mil a la tarjeta",
      "acabo de transferir 2 mil de BBVA a Revolut",
      "retiré mil del cajero",
      "mi saldo en BBVA es de 4500",
      "debo 8 mil de la tarjeta de crédito",
    ];
    const no = [
      "gasté 300 en el súper con la tarjeta de crédito",
      "pagué 150 de Uber con la Nu",
      "tengo que pagar 500 de luz",
      "compré unos tenis de 1,899 en Liverpool",
      "me pagaron la quincena, 12 mil",
      "le presté 500 a Juan",
      "café 60 y gasolina 800",
    ];
    for (const f of si) expect([f, hablaDeCuentas(f)]).toEqual([f, true]);
    for (const f of no) expect([f, hablaDeCuentas(f)]).toEqual([f, false]);
    expect(esSaldoDicho("tengo 20 mil en Revolut")).toBe(true);
    expect(esSaldoDicho("gasté 200 y tengo 3 tacos")).toBe(false);
    expect(esPagoDeTarjeta("le pagué 5 mil a la tarjeta")).toBe(true);
    expect(esPagoDeTarjeta("pagué 300 con la tarjeta de crédito")).toBe(false);
  });

  test("las frases de la batería de QA: otro orden, 'tiene', sin cuenta, y pagos a una tarjeta por su nombre", () => {
    for (const f of [
      "En Bancomer tengo mil 500",
      "En BBVA tengo 4 mil",
      "Mi cuenta de ahorro en Nu tiene 45 mil y la de débito 3 mil",
      "Tengo 5 mil",
      "Ahora traigo 800 pesos",
      "Transferí 5 mil a Revolut",
      "Pasé mil del efectivo a Bancomer",
    ]) {
      expect([f, hablaDeCuentas(f)]).toEqual([f, true]);
    }
    expect(esSaldoDicho("Tengo 5 mil")).toBe(true);
    expect(esSaldoDicho("tengo 5 hijos y gasté 300")).toBe(false);
    const tarjetas = ["Nu"];
    for (const f of ["Te aviso que acabo de pagar 3 mil a la Nu desde Bancomer", "Abono de 1500 a la Nu", "Ya pagué la Nu", "Pagué el total de la Nu con Revolut"]) {
      expect([f, esPagoDeTarjeta(f, tarjetas)]).toEqual([f, true]);
    }
    for (const f of ["Pagué la cena con la Nu", "Pagué 300 de Uber con la Nu", "Le pagué 200 a Nubia", "Gasté 1,500 en el súper con la Nu"]) {
      expect([f, esPagoDeTarjeta(f, tarjetas)]).toEqual([f, false]);
    }
    // Sin saber que la Nu es tarjeta, "pagar a la Nu" no se reconoce.
    expect(esPagoDeTarjeta("Abono de 1500 a la Nu")).toBe(false);
  });

  test("'tengo 5 mil' sin decir dónde: no se guarda en una cuenta que eligió el modelo", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Revolut", tipo: "debito", saldo: 1000 });
    const r = await llamar(dictado(ctx, "Tengo 5 mil"), "cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 5000 }] });
    expect(r.error).toContain("No dijo en qué cuenta");
    expect(pesos(estado(ctx, "Revolut").saldoCentavos)).toBe(1000);
    // Al contestar "en Revolut" ya la nombró.
    const ok = await llamar({ ...dictado(ctx, "en Revolut"), dichoAntes: ["Tengo 5 mil"] }, "cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 5000 }] });
    expect(ok.confirmacion).toBe("Listo, Revolut tiene $5,000.");
    // "En BBVA tengo 4 mil" con Bancomer: es la misma cuenta, no otra.
    fijarCuenta(dictado(ctx), { cuenta: "Bancomer", tipo: "debito", saldo: 10000 });
    await llamar(dictado(ctx, "En BBVA tengo 4 mil"), "cuentas", { cuentas: [{ cuenta: "BBVA", saldo: 4000 }] });
    expect(estadosDeCuentas(ctx).map((e) => [e.nombre, pesos(e.saldoCentavos)])).toEqual([
      ["Revolut", 5000],
      ["Bancomer", 4000],
    ]);
    // "Mi tarjeta de crédito" con una sola tarjeta: el modelo la llama por su nombre y vale.
    fijarCuenta(dictado(ctx), { cuenta: "Nu", tipo: "credito", limite: 30000, deuda: 0 });
    const nu = await llamar(dictado(ctx, "tengo 7000 disponibles en mi tarjeta de crédito"), "cuentas", { cuentas: [{ cuenta: "Nu", disponible: 7000 }] });
    expect(nu.error).toBeUndefined();
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(23000);
  });

  test("'pagué la tarjeta' sin cifra pregunta cuánto; 'el total' sí vale", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Nu", tipo: "credito", limite: 30000, deuda: 12000 });
    const r = await llamar(dictado(ctx, "Pagué la tarjeta"), "mover_dinero", { tipo: "pago_tarjeta", monto: 12000, hacia: "Nu" });
    expect(r.error).toContain("No dijo cuánto");
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(12000);
    await llamar(dictado(ctx, "Pagué el total de la Nu con Revolut"), "mover_dinero", { tipo: "pago_tarjeta", monto: 12000, desde: "Revolut", hacia: "Nu" });
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(0);
  });

  test("un pago de tarjeta con solo la tarjeta (como lo manda la app) baja la deuda; también al editar un gasto a pago", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Nu", tipo: "credito", limite: 30000, deuda: 5000 });
    crearMovimiento(dictado(ctx), { tipo: "pago_tarjeta", monto: 2000, cuenta: "Nu" });
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(3000);
    const g = crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 1000, cuenta: "Nu" });
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(4000);
    editarMovimiento(dictado(ctx), g.id, { tipo: "pago_tarjeta" });
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(2000);
    // Una cuenta sin tipo a la que se le paga se vuelve tarjeta de crédito y es el destino.
    const stori = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "Mi Stori")!;
    ctx.db.update(tablaCuentas).set({ tipo: "otra" }).where(eq(tablaCuentas.id, stori.id)).run();
    const pago = crearMovimiento(dictado(ctx), { tipo: "pago_tarjeta", monto: 100, cuenta: "Stori" });
    expect(pago).toMatchObject({ cuenta: undefined, cuenta_destino: "Stori" });
    expect(estado(ctx, "Stori").tipo).toBe("credito");
  });

  test("una compra a meses anotada tarde ya venía en el saldo que dijo después de comprar", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Nu", tipo: "credito", limite: 30000, disponible: 20000 });
    registrarMsi(dictado(ctx), { descripcion: "pantalla", total: 12000, meses: 12, cuenta: "Nu", fecha: "2026-08-01" });
    expect(pesos(estado(ctx, "Nu").disponibleCentavos)).toBe(20000);
    // Una de hoy, después de decirlo, sí lo baja.
    registrarMsi(dictado(ctx), { descripcion: "tenis", total: 2400, meses: 6, cuenta: "Nu" });
    expect(pesos(estado(ctx, "Nu").disponibleCentavos)).toBe(17600);
  });

  test("al encontrar una cuenta archivada o sin tipo en un gasto, el cambio se puede deshacer", () => {
    const { ctx } = preparar();
    const banorte = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "Banorte")!;
    ctx.db.update(tablaCuentas).set({ archivada: true }).run();
    crearMovimiento(dictado(ctx, "gasté 100 con la tarjeta de crédito Banorte"), { tipo: "gasto", monto: 100, cuenta: "tarjeta de crédito Banorte" });
    expect(ctx.db.select().from(tablaCuentas).get()).toMatchObject({ id: banorte.id, archivada: false, tipo: "credito" });
    deshacer(dictado(ctx, "deshaz eso"));
    expect(ctx.db.select().from(tablaCuentas).get()).toMatchObject({ archivada: true, tipo: "otra" });
    // Buscar por cuenta no cambia nada.
    buscarMovimientos(dictado(ctx), { periodo: "todo", cuenta: "tarjeta de crédito Banorte" });
    expect(ctx.db.select().from(tablaCuentas).get()).toMatchObject({ archivada: true, tipo: "otra" });
  });

  test("transferir más de lo que había lo dice en vez de dejar un saldo negativo callado", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Bancomer", tipo: "debito", saldo: 10000 });
    fijarCuenta(dictado(ctx), { cuenta: "Revolut", tipo: "debito", saldo: 20000 });
    const r = await llamar(dictado(ctx, "Transferí 50 mil de Bancomer a Revolut"), "mover_dinero", { tipo: "transferencia", monto: 50000, desde: "Bancomer", hacia: "Revolut" });
    expect(r.confirmacion).toBe(
      "Listo, pasaste $50,000 de Bancomer a Revolut. Ahora Revolut tiene $70,000. Ojo, es más de lo que tenías en Bancomer; si no es así, dime cuánto tienes ahí.",
    );
  });
});

describe("nombres de cuentas", () => {
  test("Bancomer es BBVA, la tarjeta de crédito a secas es la única que hay", () => {
    const { ctx } = preparar();
    const bbva = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "BBVA")!;
    expect(encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "mi cuenta de Bancomer")!.id).toBe(bbva.id);
    const generica = encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "con la tarjeta de crédito")!;
    expect(generica).toMatchObject({ nombre: "Tarjeta de crédito", tipo: "credito" });
    expect(encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "la tarjeta de crédito")!.id).toBe(generica.id);
    encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "la Invex");
    // Con dos, al registrar un gasto no se adivina.
    expect(encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "la tarjeta de crédito")).toBeUndefined();
    // "Tarjeta de crédito Banorte" le pone el tipo a una cuenta que no lo tenía.
    encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "Banorte");
    expect(encontrarOCrearCuenta(ctx.db, ctx.usuarioId, "mi tarjeta de crédito Banorte")!.tipo).toBe("credito");
    expect(ctx.db.select().from(tablaCuentas).all().length).toBe(4);
  });
});

describe("feedback", () => {
  test("avisa cuando un gasto deja la tarjeta casi sin crédito o la cuenta en negativo, una sola vez", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Nu", limite: 20000, deuda: 17000 });
    const nu = estado(ctx, "Nu").id;
    const g1 = crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 1500, cuenta: "Nu" });
    expect(datoDeCuentas(ctx, [{ cuentaId: nu, montoCentavos: 150000, moneda: "MXN" }])).toBe("Ojo, en Nu ya solo te quedan $1,500 disponibles.");
    expect(g1.cuenta).toBe("Nu");
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 100, cuenta: "Nu" });
    expect(datoDeCuentas(ctx, [{ cuentaId: nu, montoCentavos: 10000, moneda: "MXN" }])).toBeUndefined();
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 2000, cuenta: "Nu" });
    expect(datoDeCuentas(ctx, [{ cuentaId: nu, montoCentavos: 200000, moneda: "MXN" }])).toBe("Ojo, con esto te pasaste del límite de Nu por $600.");

    fijarCuenta(dictado(ctx), { cuenta: "BBVA", saldo: 300 });
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 500, cuenta: "BBVA" });
    const bbva = estado(ctx, "BBVA").id;
    expect(datoDeCuentas(ctx, [{ cuentaId: bbva, montoCentavos: 50000, moneda: "MXN" }])).toBe(
      "Con esto BBVA quedaría en menos $200; si no es así, dime cuánto tienes ahí.",
    );
  });

  test("consultar_cuentas: todo junto, con una observación si la hay", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Revolut", saldo: 20000 });
    fijarCuenta(dictado(ctx), { cuenta: "Bancomer", saldo: 10000 });
    fijarCuenta(dictado(ctx), { cuenta: "Nu", limite: 10000, deuda: 9000 });
    crearMovimiento(dictado(ctx), { tipo: "gasto", monto: 100, cuenta: "Efectivo" });
    const r = await llamar(dictado(ctx, "¿cuánto dinero tengo?"), "consultar_cuentas", {});
    expect(r.respuesta).toBe(
      "Tienes $30,000 en tus cuentas, debes $9,000 en tarjetas y te quedan $1,000 de crédito disponible. Revolut tiene $20,000, Bancomer tiene $10,000 y en Nu debes $9,000 y te quedan $1,000 disponibles de $10,000. Ojo, Nu va al 90% de su límite. De Efectivo no sé cuánto tienes.",
    );
    const una = await llamar(dictado(ctx, "¿cuánto tengo en Revolut?"), "consultar_cuentas", { cuenta: "Revolut" });
    expect(una.respuesta).toBe("Revolut tiene $20,000.");
    expect(confirmacionDirecta("¿cuánto tengo en Revolut?", ctx.hoy, [{ herramienta: "consultar_cuentas", resultado: una }])).toBe("Revolut tiene $20,000.");
    const nada = await llamar(dictado(ctx, "¿cuánto tengo en Efectivo?"), "consultar_cuentas", { cuenta: "efectivo" });
    expect(nada.respuesta).toMatch(/No sé cuánto tienes en Efectivo/);
  });

  test("¿cuánto puedo gastar hoy? usa el saldo de sus cuentas si no sabe sus ingresos", () => {
    const { ctx } = preparar();
    expect(disponible(ctx).base).toBeNull();
    fijarCuenta(dictado(ctx), { cuenta: "Revolut", saldo: 25000 });
    const d = disponible(ctx);
    expect(d.base).toBe("saldos");
    // Del 7 al 31 de octubre son 25 días.
    expect(d.porDiaCentavos).toBe(100000);
  });
});

describe("lo que encontró QA con el modelo real", () => {
  test("ahora tengo 18 mil en Revolut: aunque el modelo repita Bancomer, se fija Revolut y Bancomer no cambia", async () => {
    const { ctx } = preparar();
    await llamar(dictado(ctx, "tengo 20 mil en Revolut y 10 mil en Bancomer"), "cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 20000 }, { cuenta: "Bancomer", saldo: 10000 }] });
    const r = await llamar(dictado(ctx, "Ahora tengo 18 mil en Revolut"), "cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 18000 }, { cuenta: "Bancomer", saldo: 5000 }] });
    expect(r.error).toBeUndefined();
    expect(r.confirmacion).toBe("Listo, Revolut tiene $18,000.");
    expect(pesos(estado(ctx, "Revolut").saldoCentavos)).toBe(18000);
    expect(pesos(estado(ctx, "Bancomer").saldoCentavos)).toBe(10000);
  });

  test("tengo 5 mil sin decir dónde: se pregunta, salvo que conteste una pregunta en la conversación", async () => {
    const { ctx } = preparar();
    const r = await llamar(dictado(ctx, "tengo 5 mil"), "cuentas", { cuentas: [{ cuenta: "BBVA", saldo: 5000 }] });
    expect(r.error).toContain("No dijo en qué cuenta");
    const enCharla = { ...dictado(ctx, "son 5 mil"), enConversacion: true };
    const s = await llamar(enCharla, "cuentas", { cuentas: [{ cuenta: "BBVA", saldo: 5000 }] });
    expect(s.error).toBeUndefined();
    expect(pesos(estado(ctx, "BBVA").saldoCentavos)).toBe(5000);
  });

  test("tengo 300 dólares en Wise: crea la cuenta sin saldo y pregunta cuántos pesos son", async () => {
    const { ctx } = preparar();
    const r = await llamar(dictado(ctx, "Tengo 300 dólares en Wise"), "cuentas", { cuentas: [{ cuenta: "Wise", saldo: 300 }] });
    expect(r.confirmacion).toBe("Llevo tus cuentas en pesos y no sé a cuánto cambiarlos. ¿Cuántos pesos son tus 300 dólares en Wise?");
    expect(estado(ctx, "Wise").saldoCentavos).toBeNull();
    // En pesos sí se guarda.
    await llamar(dictado(ctx, "tengo 5,400 pesos en Wise"), "cuentas", { cuentas: [{ cuenta: "Wise", saldo: 5400 }] });
    expect(pesos(estado(ctx, "Wise").saldoCentavos)).toBe(5400);
  });

  test("préstamos con la cuenta dicha mueven su saldo; sin cuenta, no se toca ninguna", async () => {
    const { ctx } = preparar();
    await llamar(dictado(ctx, "tengo 2 mil en efectivo y 10 mil en Bancomer"), "cuentas", { cuentas: [{ cuenta: "efectivo", saldo: 2000 }, { cuenta: "Bancomer", saldo: 10000 }] });
    const a = await llamar(dictado(ctx, "Le presté 500 a Juan de mi efectivo"), "prestamo", { accion: "le_preste", persona: "Juan", monto: 500, cuenta: "efectivo" });
    expect(a.confirmacion).toBe("Listo, anoté que le prestaste $500 a Juan. Ahora Efectivo tiene $1,500.");
    expect(pesos(estado(ctx, "Efectivo").saldoCentavos)).toBe(1500);
    const b = await llamar(dictado(ctx, "Juan me pagó 200 en efectivo"), "prestamo", { accion: "me_pagaron", persona: "Juan", monto: 200, cuenta: "efectivo" });
    expect(b.confirmacion).toContain("Ahora Efectivo tiene $1,700.");
    await llamar(dictado(ctx, "Mi hermano me prestó 2 mil y me los depositó a Bancomer"), "prestamo", { accion: "me_prestaron", persona: "mi hermano", monto: 2000, cuenta: "Bancomer" });
    expect(pesos(estado(ctx, "Bancomer").saldoCentavos)).toBe(12000);
    // El modelo puso una cuenta que la frase no dice: no se adivina.
    await llamar(dictado(ctx, "le presté 100 a Ana"), "prestamo", { accion: "le_preste", persona: "Ana", monto: 100, cuenta: "Bancomer" });
    expect(pesos(estado(ctx, "Bancomer").saldoCentavos)).toBe(12000);
    // No son gastos ni ingresos, y se deshacen con el préstamo.
    const movs = buscarMovimientos(ctx, { periodo: "todo" }).movimientos;
    expect(movs.map((m) => m.tipo)).toEqual(["transferencia", "transferencia", "transferencia"]);
    deshacer(dictado(ctx, "deshaz eso"));
    deshacer(dictado(ctx, "deshaz eso"));
    expect(pesos(estado(ctx, "Bancomer").saldoCentavos)).toBe(10000);
  });

  test("pagué la tarjeta de crédito sin tarjetas conocidas: la crea y anota el pago", () => {
    const { ctx } = preparar();
    const r = moverDinero(dictado(ctx, "Pagué la tarjeta de crédito, 5 mil"), { tipo: "pago_tarjeta", monto: 5000 });
    expect(r.movimiento.tipo).toBe("pago_tarjeta");
    const tarjeta = estadosDeCuentas(ctx).find((e) => e.esCredito);
    expect(tarjeta?.nombre).toBe(r.movimiento.cuenta_destino);
  });
});

describe("después del PR de cuentas", () => {
  test("pesos y dólares en la misma frase: los pesos se guardan y solo se pregunta por los dólares", async () => {
    const { ctx } = preparar();
    const r = await llamar(dictado(ctx, "tengo 300 dólares en Wise y 10 mil en Bancomer"), "cuentas", {
      cuentas: [{ cuenta: "Wise", saldo: 300 }, { cuenta: "Bancomer", saldo: 10000 }],
    });
    expect(r.confirmacion).toBe("Listo, Bancomer tiene $10,000. Llevo tus cuentas en pesos y no sé a cuánto cambiarlos. ¿Cuántos pesos son tus 300 dólares en Wise?");
    expect(pesos(estado(ctx, "Bancomer").saldoCentavos)).toBe(10000);
    expect(estado(ctx, "Wise").saldoCentavos).toBeNull();
    // Con la cifra lejos de la moneda, no se adivina cuál era: ninguna con saldo en pesos.
    const s = await llamar(dictado(ctx, "tengo 500 en Revolut, en euros"), "cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 500 }] });
    expect(s.confirmacion).toBe("Llevo tus cuentas en pesos y no sé a cuánto cambiarlos. ¿Cuántos pesos son tus 500 euros en Revolut?");
    expect(estado(ctx, "Revolut").saldoCentavos).toBeNull();
  });

  test("cifras con coma y otras formas de decir dólares", async () => {
    for (const [frase, cifra] of [
      ["Tengo 1,500 dólares en Wise y 10,000 pesos en Bancomer", "1,500"],
      ["Tengo 2,000 USD en Wise y 10 mil en Bancomer", "2,000"],
      ["Tengo US$1,500 en Wise y 10 mil en Bancomer", "1,500"],
    ] as const) {
      const { ctx } = preparar();
      const monto = Number(cifra.replace(",", ""));
      const r = await llamar(dictado(ctx, frase), "cuentas", { cuentas: [{ cuenta: "Wise", saldo: monto }, { cuenta: "Bancomer", saldo: 10000 }] });
      expect(r.confirmacion).toBe(`Listo, Bancomer tiene $10,000. Llevo tus cuentas en pesos y no sé a cuánto cambiarlos. ¿Cuántos pesos son tus ${cifra} dólares en Wise?`);
      expect(pesos(estado(ctx, "Bancomer").saldoCentavos)).toBe(10000);
      expect(estado(ctx, "Wise").saldoCentavos).toBeNull();
    }
  });

  test("totales de crédito: solo las tarjetas con límite y disponible conocidos", () => {
    const { ctx } = preparar();
    // Límite sin deuda dicha: no se sabe cuánto lleva usado.
    fijarCuenta(dictado(ctx, "la Nu tiene límite de 30 mil"), { cuenta: "Nu", tipo: "credito", limite: 30000 });
    let t = totalesDeCuentas(estadosDeCuentas(ctx));
    expect(t).toMatchObject({ limiteCreditoCentavos: 0, disponibleCreditoCentavos: 0, sinSaldo: ["Nu"] });
    // Con la deuda ya cuenta; una con solo el disponible no entra en el límite ni en su disponible.
    fijarCuenta(dictado(ctx, "debo 5 mil de la Nu"), { cuenta: "Nu", deuda: 5000 });
    fijarCuenta(dictado(ctx, "tengo 7 mil disponibles en la tarjeta de crédito Invex"), { cuenta: "Invex", tipo: "credito", disponible: 7000 });
    t = totalesDeCuentas(estadosDeCuentas(ctx));
    expect(t).toMatchObject({ limiteCreditoCentavos: 3000000, disponibleCreditoCentavos: 2500000, sinSaldo: [] });
    // Archivada, no se suma.
    const nu = estado(ctx, "Nu");
    expect(totalesDeCuentas([{ ...nu, archivada: true }]).limiteCreditoCentavos).toBe(0);
  });

  test("por voz, el crédito disponible incluye la tarjeta de la que solo se sabe el disponible", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx, "la Nu"), { cuenta: "Nu", tipo: "credito", limite: 30000, deuda: 5000 });
    fijarCuenta(dictado(ctx, "la Invex"), { cuenta: "Invex", tipo: "credito", disponible: 7000 });
    const r = await llamar(dictado(ctx, "¿cuánto crédito me queda?"), "consultar_cuentas", {});
    expect(r.respuesta).toContain("te quedan $32,000 de crédito disponible");
  });

  test("los avisos de una tarjeta abren esa cuenta en la app", () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx, "la Nu"), { cuenta: "Nu", tipo: "credito", limite: 10000, deuda: 9500, diaPago: Number(ctx.hoy.slice(8, 10)) });
    revisar(ctx);
    const nu = estado(ctx, "Nu");
    const deTarjeta = listarAvisos(ctx).avisos.filter((a) => a.tipo.startsWith("tarjeta_"));
    expect(deTarjeta.map((a) => a.tipo).sort()).toEqual(["tarjeta_limite", "tarjeta_pago"]);
    expect(deTarjeta.every((a) => a.enlace === `#cuenta?id=${nu.id}`)).toBe(true);
  });
});

describe("tarjeta de la que solo se sabe el disponible", () => {
  test("al comparar deuda contra dinero y al consultar, se dice que falta su deuda", async () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx, "efectivo"), { cuenta: "Efectivo", tipo: "efectivo", saldo: 500 });
    fijarCuenta(dictado(ctx, "la BBVA Azul"), { cuenta: "BBVA Azul", tipo: "credito", limite: 10000, deuda: 2000 });
    fijarCuenta(dictado(ctx, "tengo 7 mil disponibles en la Nu"), { cuenta: "Nu", tipo: "credito", disponible: 7000 });
    expect(totalesDeCuentas(estadosDeCuentas(ctx)).sinDeuda).toEqual(["Nu"]);
    expect(observacionDeCuentas(ctx, estadosDeCuentas(ctx))).toBe(
      "Debes $1,500 más en tarjetas de lo que tienes en tus cuentas, sin contar Nu, de la que no sé cuánto debes.",
    );
    const r = await llamar(dictado(ctx, "¿cuánto tengo?"), "consultar_cuentas", {});
    expect(r.respuesta).toContain("sin contar Nu, de la que no sé cuánto debes.");
    expect(r.respuesta).not.toContain("dime su límite");
    // Sin esa comparación, se dice aparte.
    fijarCuenta(dictado(ctx, "tengo 5 mil en efectivo"), { cuenta: "Efectivo", saldo: 5000 });
    const s = await llamar(dictado(ctx, "¿cuánto tengo?"), "consultar_cuentas", {});
    expect(s.respuesta).toContain("De Nu no sé cuánto debes; dime su límite o cuánto debes.");
  });
});

// Lo que le pasó a Pedro el 2026-10-09: "tengo un total de 37,581. 21" en Invex quedó como deuda, y al corregirlo
// en otro dictado el modelo guardó las cifras de los ejemplos (Revolut $20,000, Invex límite $30,000, Efectivo $5,000).
describe("Invex de Pedro (2026-10-09)", () => {
  const preparado = () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Revolut", tipo: "debito" });
    fijarCuenta(dictado(ctx), { cuenta: "Invex", tipo: "credito" });
    fijarCuenta(dictado(ctx), { cuenta: "Efectivo", tipo: "efectivo" });
    return ctx;
  };
  const DIJO_INVEX = "Te aviso que en mi tarjeta de crédito Invex tengo un total de 37,581. 21 pesos";
  const CORRIGE = "Ese registro que acabas de hacer no es algo que debo si no es lo que tengo actualmente disponible";

  test("'tengo un total de' en una tarjeta de crédito es lo disponible, aunque el modelo lo mande como deuda", async () => {
    const ctx = preparado();
    const r = await llamar(dictado(ctx, DIJO_INVEX), "cuentas", { cuentas: [{ cuenta: "Invex", tipo: "credito", deuda: 37581.21 }] });
    expect(r.error).toBeUndefined();
    const invex = estado(ctx, "Invex");
    expect(pesos(invex.disponibleCentavos)).toBe(37581.21);
    expect(invex.deudaCentavos).toBeNull();
    // Con el límite en la misma frase, lo que lleva usado sí es deuda.
    await llamar(dictado(ctx, "en Invex tengo 57,400 de límite y llevo 10 mil"), "cuentas", { cuentas: [{ cuenta: "Invex", limite: 57400, deuda: 10000 }] });
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(10000);
    // "Debo" sigue siendo deuda.
    await llamar(dictado(ctx, "en Invex debo 5 mil"), "cuentas", { cuentas: [{ cuenta: "Invex", deuda: 5000 }] });
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(5000);
  });

  test("cifras que nunca dijo no se guardan: ni las de los ejemplos ni en otras cuentas", async () => {
    const ctx = preparado();
    fijarCuenta(dictado(ctx, "en Revolut tengo 19,291"), { cuenta: "Revolut", saldo: 19291 });
    const inventado = {
      cuentas: [
        { cuenta: "Revolut", tipo: "debito", saldo: 20000, disponible: 20000 },
        { cuenta: "Invex", tipo: "credito", disponible: 10000, deuda: 10000, limite: 30000 },
        { cuenta: "Efectivo", tipo: "efectivo", saldo: 5000 },
      ],
    };
    // Sin lo que dijo antes, no hay de dónde sacar una cifra: se pregunta.
    const r = await llamar(dictado(ctx, CORRIGE), "cuentas", inventado);
    expect(r.error).toContain("no las dijo");
    expect(pesos(estado(ctx, "Revolut").saldoCentavos)).toBe(19291);
    expect(estado(ctx, "Invex").conocido).toBe(false);
    expect(estado(ctx, "Efectivo").conocido).toBe(false);
  });

  test("con lo que dijo antes en la conversación, corrige con su cifra y calcula la deuda al decir el límite", async () => {
    const ctx = preparado();
    await llamar(dictado(ctx, DIJO_INVEX), "cuentas", { cuentas: [{ cuenta: "Invex", deuda: 37581.21 }] });
    // El modelo repite la cifra de antes, ahora como disponible, y de paso inventa un límite: el límite no se guarda.
    const r = await llamar({ ...dictado(ctx, CORRIGE), dichoAntes: [DIJO_INVEX] }, "cuentas", {
      cuentas: [{ cuenta: "Invex", disponible: 37581.21, limite: 30000 }],
    });
    expect(r.error).toBeUndefined();
    expect(pesos(estado(ctx, "Invex").disponibleCentavos)).toBe(37581.21);
    expect(estado(ctx, "Invex").limiteCentavos).toBeNull();
    // "Mi límite es de 57,400": con lo disponible que ya sabía, sale lo que debe.
    const LIMITE = "mi límite de crédito de Invex es de 57,400";
    await llamar({ ...dictado(ctx, LIMITE), dichoAntes: [DIJO_INVEX, CORRIGE] }, "cuentas", { cuentas: [{ cuenta: "Invex", limite: 57400 }] });
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(19818.79);
    // "Corrige mi disponible a 37,581.12": el modelo puede mandar también la deuda que calculó (57,400 − 37,581.12).
    await llamar({ ...dictado(ctx, "corrige mi saldo disponible de Invex a 37,581.12"), dichoAntes: [DIJO_INVEX, CORRIGE, LIMITE] }, "cuentas", {
      cuentas: [{ cuenta: "Invex", disponible: 37581.12, deuda: 19818.88 }],
    });
    const invex = estado(ctx, "Invex");
    expect([pesos(invex.limiteCentavos), pesos(invex.disponibleCentavos), pesos(invex.deudaCentavos)]).toEqual([57400, 37581.12, 19818.88]);
  });
});

// 2026-10-09 00:44Z: "En mi tarjeta Nu de crédito..." se dictó como "tarjeta no de crédito"; con Invex como única
// tarjeta, el modelo le puso a Invex los 33,600 de la Nu y pisó su deuda.
describe("la Nu de Pedro oída como 'no' (2026-10-09)", () => {
  const DIJO_NU = "En mi tarjeta no de crédito tengo un límite disponible de 33,600 pesos";
  const conInvex = () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx), { cuenta: "Invex", tipo: "credito", limite: 57400, deuda: 19818.88 });
    return ctx;
  };

  test("no se lo pone a la única tarjeta que tiene: pregunta cuál es", async () => {
    const ctx = conInvex();
    const r = await llamar(dictado(ctx, DIJO_NU), "cuentas", { cuentas: [{ cuenta: "Invex", tipo: "credito", disponible: 33600 }] });
    expect(r.error).toContain('Nombró otra tarjeta ("no")');
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(19818.88);
    // Contesta "es la Nu": se crea como tarjeta de crédito con lo disponible que ya había dicho.
    const ok = await llamar({ ...dictado(ctx, "es la Nu"), enConversacion: true, dichoAntes: [DIJO_NU] }, "cuentas", {
      cuentas: [{ cuenta: "Nu", tipo: "credito", disponible: 33600 }],
    });
    expect(ok.error).toBeUndefined();
    expect([estado(ctx, "Nu").tipo, pesos(estado(ctx, "Nu").disponibleCentavos)]).toEqual(["credito", 33600]);
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(19818.88);
  });

  test("bien oída, 'mi tarjeta de crédito Nu' crea la Nu y no toca Invex", async () => {
    const ctx = conInvex();
    const frase = "en mi tarjeta de crédito Nu tengo un crédito disponible de 33600 mxn";
    expect((await llamar(dictado(ctx, frase), "cuentas", { cuentas: [{ cuenta: "Invex", disponible: 33600 }] })).error).toContain("Nombró otra tarjeta");
    const ok = await llamar(dictado(ctx, frase), "cuentas", { cuentas: [{ cuenta: "Nu", disponible: 33600 }] });
    expect(ok.confirmacion).toBe("Listo, en Nu te quedan $33,600 disponibles.");
    expect(pesos(estado(ctx, "Invex").deudaCentavos)).toBe(19818.88);
    // "Mi tarjeta de crédito" a secas con una sola tarjeta sigue valiendo.
    const { ctx: otro } = preparar();
    fijarCuenta(dictado(otro), { cuenta: "Invex", tipo: "credito", limite: 57400, deuda: 0 });
    const generica = await llamar(dictado(otro, "en mi tarjeta de crédito tengo 30 mil disponibles"), "cuentas", { cuentas: [{ cuenta: "Invex", disponible: 30000 }] });
    expect(generica.error).toBeUndefined();
    // Palabras comunes después de "tarjeta de crédito" no son un nombre (QA-100).
    for (const frase of ["ahora tengo 7 mil", "solo tengo 7 mil", "nada más tengo 7 mil", "todavía tengo 7 mil", "hoy tengo 7 mil", "apenas tengo 7 mil", "llevo 7 mil", "aún tengo 7 mil", "nomás tengo 7 mil"]) {
      const r = await llamar(dictado(otro, `En mi tarjeta de crédito ${frase} disponibles`), "cuentas", { cuentas: [{ cuenta: "Invex", disponible: 7000 }] });
      expect([frase, r.error]).toEqual([frase, undefined]);
    }
  });
});

// W6, 2026-10-09: "límite de 30 mil" y luego "33,600 disponibles" quedaba como $3,600 a favor sin preguntar.
describe("disponible mayor que el límite", () => {
  test("no se guarda: se pregunta si cambió el límite; con el límite nuevo o un saldo a favor dicho, sí", async () => {
    const { ctx } = preparar();
    const previo = "Tengo una tarjeta de crédito Nu con límite de 30 mil";
    await llamar(dictado(ctx, previo), "cuentas", { cuentas: [{ cuenta: "Nu", tipo: "credito", limite: 30000 }] });
    const dicho = { ...dictado(ctx, "En la Nu tengo 33,600 disponibles"), dichoAntes: [previo] };
    for (const args of [{ cuenta: "Nu", disponible: 33600 }, { cuenta: "Nu", disponible: 33600, limite: 30000 }]) {
      const r = await llamar(dicho, "cuentas", { cuentas: [args] });
      expect(r.error).toContain("no cuadra");
    }
    expect(estado(ctx, "Nu").conocido).toBe(false);
    await llamar(dictado(ctx, "mi límite de la Nu ahora es de 40 mil y tengo 33,600 disponibles"), "cuentas", {
      cuentas: [{ cuenta: "Nu", limite: 40000, disponible: 33600 }],
    });
    expect(pesos(estado(ctx, "Nu").deudaCentavos)).toBe(6400);
    const { ctx: otro } = preparar();
    await llamar(dictado(otro, previo), "cuentas", { cuentas: [{ cuenta: "Nu", tipo: "credito", limite: 30000 }] });
    const r = await llamar(dictado(otro, "en la Nu tengo 500 a favor, o sea 30,500 disponibles"), "cuentas", { cuentas: [{ cuenta: "Nu", disponible: 30500 }] });
    expect(r.error).toBeUndefined();
  });
});

// 2026-10-09 01:2xZ: "tengo una tarjeta de crédito Revolut" convirtió su Revolut de débito en crédito y perdió su saldo.
describe("Revolut de débito y de crédito (2026-10-09)", () => {
  const conDebito = () => {
    const { ctx } = preparar();
    fijarCuenta(dictado(ctx, "en Revolut tengo 19,291"), { cuenta: "Revolut", tipo: "debito", saldo: 19291 });
    return ctx;
  };

  test("una tarjeta de crédito del mismo banco es otra cuenta; la de débito no se toca", async () => {
    for (const args of [{ cuenta: "Revolut", tipo: "credito" }, { cuenta: "tarjeta de crédito Revolut", disponible: 10000 }, { cuenta: "Revolut", tipo: "credito", disponible: 10000 }]) {
      const ctx = conDebito();
      const frase = `Tengo una tarjeta de crédito Revolut${"disponible" in args ? " con 10 mil disponibles" : ""}`;
      const r = await llamar(dictado(ctx, frase), "cuentas", { cuentas: [args] });
      expect(r.error).toBeUndefined();
      expect(estadosDeCuentas(ctx).map((e) => [e.nombre, e.tipo, pesos(e.disponibleCentavos)])).toEqual([
        ["Revolut", "debito", 19291],
        ["Revolut crédito", "credito", "disponible" in args ? 10000 : null],
      ]);
    }
  });

  test("después, cada frase va a la suya; 'en realidad es de crédito' sí cambia la cuenta", async () => {
    const ctx = conDebito();
    await llamar(dictado(ctx, "Tengo una tarjeta de crédito Revolut"), "cuentas", { cuentas: [{ cuenta: "Revolut", tipo: "credito" }] });
    await llamar(dictado(ctx, "en mi tarjeta de crédito Revolut tengo 8 mil disponibles"), "cuentas", { cuentas: [{ cuenta: "Revolut", tipo: "credito", disponible: 8000 }] });
    expect(pesos(estado(ctx, "Revolut crédito").disponibleCentavos)).toBe(8000);
    const gasto = crearMovimiento(dictado(ctx, "gasté 300 con mi tarjeta de crédito Revolut"), { tipo: "gasto", monto: 300, cuenta: "tarjeta de crédito Revolut" });
    expect(gasto.cuenta).toBe("Revolut crédito");
    expect(crearMovimiento(dictado(ctx, "gasté 100 con Revolut"), { tipo: "gasto", monto: 100, cuenta: "Revolut" }).cuenta).toBe("Revolut");
    // "Le pagué mil a la tarjeta Revolut": baja la deuda de la de crédito, no le suma al débito.
    fijarCuenta(dictado(ctx), { cuenta: "Revolut crédito", tipo: "credito", limite: 34000, disponible: 7700 });
    const debitoAntes = estado(ctx, "Revolut").saldoCentavos;
    moverDinero(dictado(ctx, "le pagué mil a la tarjeta Revolut"), { tipo: "pago_tarjeta", monto: 1000, hacia: "Revolut" });
    expect(pesos(estado(ctx, "Revolut crédito").deudaCentavos)).toBe(25300);
    expect(estado(ctx, "Revolut").saldoCentavos).toBe(debitoAntes);
    // Corregir el tipo de una sola cuenta sigue siendo posible.
    const { ctx: otro } = preparar();
    fijarCuenta(dictado(otro), { cuenta: "Hey", tipo: "debito" });
    await llamar(dictado(otro, "mi Hey en realidad es de crédito"), "cuentas", { cuentas: [{ cuenta: "Hey", tipo: "credito" }] });
    expect(estadosDeCuentas(otro).map((e) => [e.nombre, e.tipo])).toEqual([["Hey", "credito"]]);
  });
});

describe("Mercado Pago de Pedro (2026-10-09)", () => {
  test("'Mercado Pago de crédito' se llama Mercado Pago; un límite dicho una vez no es también lo disponible", async () => {
    const { ctx } = preparar();
    await llamar(dictado(ctx, "En mi tarjeta de Mercado pago de crédito tengo un límite total de 33,200 pesos"), "cuentas", {
      cuentas: [{ cuenta: "Mercado Pago de crédito", tipo: "credito", limite: 33200 }],
    });
    expect(estadosDeCuentas(ctx).map((e) => [e.nombre, e.tipo])).toEqual([["Mercado Pago", "credito"]]);
    // La frase se cortó: el modelo puso el límite también como disponible.
    await llamar(dictado(ctx, "Mi límite total es de 33,200 pesos en mi tarjeta de crédito Mercado pago y tengo un disponible"), "cuentas", {
      cuentas: [{ cuenta: "Mercado Pago", disponible: 33200, limite: 33200 }],
    });
    expect(estado(ctx, "Mercado Pago").conocido).toBe(false);
    // "No debo nada": el cero sí lo dijo.
    await llamar(dictado(ctx, "en Mercado Pago no debo nada"), "cuentas", { cuentas: [{ cuenta: "Mercado Pago", deuda: 0 }] });
    expect(pesos(estado(ctx, "Mercado Pago").disponibleCentavos)).toBe(33200);
  });

  // Investigación, 01:42Z: renombrada a "Mercado Pago Credito", "Mercado Pago" ya no la encontraba y se iba a duplicar.
  test("'Mercado Pago Credito' se encuentra diciendo 'Mercado Pago', con o sin 'de crédito'; Revolut sigue siendo la de débito", () => {
    const { ctx, db, usuario } = preparar();
    // Así queda después de renombrarla (al crearla, el "de crédito" del final no va en el nombre).
    db.insert(tablaCuentas).values({ usuarioId: usuario.id, nombre: "Mercado Pago Credito", tipo: "credito" }).run();
    fijarCuenta(dictado(ctx), { cuenta: "Revolut", tipo: "debito", saldo: 19291 });
    fijarCuenta(dictado(ctx), { cuenta: "Revolut crédito", tipo: "credito", limite: 34000 });
    const nombre = (texto: string) => encontrarOCrearCuenta(db, usuario.id, texto, { soloExistente: true, soloLeer: true })?.nombre;
    for (const texto of ["Mercado Pago", "mercado pago", "tarjeta de crédito Mercado Pago", "Mercado Pago de crédito", "mi tarjeta Mercado Pago Credito"]) {
      expect([texto, nombre(texto)]).toEqual([texto, "Mercado Pago Credito"]);
    }
    expect(nombre("Revolut")).toBe("Revolut");
    expect(nombre("mi cuenta de débito Revolut")).toBe("Revolut");
    expect(nombre("tarjeta de crédito Revolut")).toBe("Revolut crédito");
    expect(nombre("Revolut de crédito")).toBe("Revolut crédito");
    expect(crearMovimiento(dictado(ctx, "gasté 200 con Mercado Pago"), { tipo: "gasto", monto: 200, cuenta: "Mercado Pago" }).cuenta).toBe("Mercado Pago Credito");
    expect(estadosDeCuentas(ctx).map((e) => e.nombre).sort()).toEqual(["Mercado Pago Credito", "Revolut", "Revolut crédito"]);
  });
});
