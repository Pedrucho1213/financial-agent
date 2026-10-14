import { describe, expect, test } from "bun:test";
import { crearHerramientas } from "../src/ai/herramientas";
import { debeAPersona, hablaDePrestamo, pagaPrestamo, prestaDinero } from "../src/ai/herramientas-planes";
import { datosDelUsuario } from "../src/ai/instrucciones";
import type { Contexto } from "../src/finanzas/contexto";
import { esPagoDeTarjeta, estadosDeCuentas, fijarCuenta } from "../src/finanzas/cuentas";
import { buscarMovimientos, deshacer } from "../src/finanzas/movimientos";
import { abonarPrestamo, clavePersona, deudasPorPersona, listarPrestamos, registrarPrestamo } from "../src/finanzas/planes";
import { preparar } from "./ayuda";

// Deudas con personas, como las dice Pedro: "le debo 30 mil a mi mamá", "le acabo de transferir 2 mil a mi mamá
// desde mi cuenta Revolut". Sin modelo: se llama cada herramienta como lo haría la IA y se revisa lo que quedó.

const llamar = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const dictado = (ctx: Contexto, frase: string): Contexto => ({ ...ctx, textoOriginal: frase, entradaId: crypto.randomUUID() });
/** Sus cuentas, dichas un minuto antes para que los movimientos de la prueba cuenten en el saldo. */
const conCuentas = (ctx: Contexto) => {
  const antes = { ...ctx, ahoraIso: new Date(Date.parse(ctx.ahoraIso) - 60_000).toISOString() };
  fijarCuenta(antes, { cuenta: "Revolut", tipo: "debito", saldo: 19291 });
  fijarCuenta(antes, { cuenta: "Revolut crédito", tipo: "credito", limite: 34000, deuda: 5000 });
  fijarCuenta(antes, { cuenta: "Nu", tipo: "credito", limite: 33600, deuda: 3000, diaCorte: 3, diaPago: 23 });
};
const saldo = (ctx: Contexto, nombre: string) => estadosDeCuentas(ctx).find((e) => e.nombre === nombre)!;

describe("la misma persona dicha de varias formas", () => {
  test("mamá, madre y jefa son ella; se guarda como Mamá", () => {
    const { ctx } = preparar();
    expect(["mi mamá", "a mi madre", "Mi jefa", "mami"].map(clavePersona)).toEqual(["mama", "mama", "mama", "mama"]);
    const p = registrarPrestamo(ctx, { persona: "mi madre", direccion: "debo", monto: 30000 });
    expect(p.persona).toBe("Mamá");
    // Otro préstamo de "mi mamá" se suma al de antes, y "mi jefa" abona al mismo.
    expect(registrarPrestamo(ctx, { persona: "mi mamá", direccion: "debo", monto: 5000 }).totalPendienteCentavos).toBe(3_500_000);
    expect(abonarPrestamo(ctx, { persona: "mi jefa", monto: 2000 }).pendienteCentavos).toBe(3_300_000);
    // Un nombre propio no cambia.
    expect(registrarPrestamo(ctx, { persona: "a Juan", direccion: "me_deben", monto: 500 }).persona).toBe("Juan");
  });
});

describe("reconocer las frases", () => {
  test("abonos a una persona con la que tiene préstamo", () => {
    const personas = ["Mamá", "Juan"];
    for (const frase of [
      "Le acabo de transferir 2 mil a mi mamá desde mi cuenta Revolut",
      "le deposité 1500 a mi madre",
      "A mi mamá le mandé 2 mil",
      "ya le aboné 2 mil a mi mamá",
      "le pagué 2 mil a mi jefa de Revolut",
      "transferí 500 a Juan",
      "Mi mamá me depositó 500",
      "Juan ya me pagó 200",
    ]) {
      expect([frase, pagaPrestamo(frase, personas)]).toEqual([frase, true]);
    }
    for (const frase of [
      "le transferí 2 mil a Revolut",
      "transferí 2 mil de BBVA a Revolut",
      "le compré un regalo de 500 a mi mamá",
      "le deposité 5 mil a la Nu",
      "le transferí 2 mil a mi mamá de la renta",
      "le transferí 300 a Ana",
    ]) {
      expect([frase, pagaPrestamo(frase, personas)]).toEqual([frase, false]);
    }
  });

  test("una deuda con una persona, no con una tarjeta", () => {
    expect(debeAPersona("Le debo 30 mil a mi mamá")).toBe("mama");
    expect(debeAPersona("a mi hermano le debo 2 mil")).toBe("hermano");
    expect(debeAPersona("debo 4 mil pesos a Juan")).toBe("juan");
    expect(debeAPersona("le debo 5 mil a la Nu")).toBeUndefined();
    expect(debeAPersona("debo 4 mil de la Invex")).toBeUndefined();
    expect(debeAPersona("debo 3 mil a meses sin intereses")).toBeUndefined();
    expect(debeAPersona("le debo 3 mil a la tarjeta")).toBeUndefined();
    expect(debeAPersona("le debo 3 mil a Klar")).toBeUndefined();
    // Una tarjeta con nombre propio que no parece banco.
    expect(debeAPersona("le debo 3 mil a la Oro", ["Oro"])).toBeUndefined();
    // Prestar sigue igual.
    expect(prestaDinero("mi mamá me prestó 30 mil")).toBe(true);
  });

  test("lo de las tarjetas sigue siendo de tarjetas", () => {
    expect(esPagoDeTarjeta("ya le deposité 5 mil a la Nu", ["Nu"])).toBe(true);
    expect(esPagoDeTarjeta("acabo de comprar unos tenis de 2 mil con la Nu", ["Nu"])).toBe(false);
  });

  test("con un préstamo o un abono, el Atajo espera para decir cuánto queda", () => {
    const { ctx } = preparar();
    registrarPrestamo(ctx, { persona: "Mamá", direccion: "debo", monto: 30000 });
    expect(hablaDePrestamo(ctx, "le acabo de transferir 2 mil a mi madre")).toBe(true);
    expect(hablaDePrestamo(ctx, "le debo 3 mil a mi hermano")).toBe(true);
    expect(hablaDePrestamo(ctx, "gasté 300 en tacos")).toBe(false);
  });
});

describe("la conversación de la deuda con mamá", () => {
  test("le debo, le abono desde Revolut, cuánto le debo y deshacer", async () => {
    const { ctx } = preparar();
    conCuentas(ctx);

    // 1. "Le debo 30 mil a mi mamá": no es gasto ni una tarjeta "Mamá".
    let frase = dictado(ctx, "Le debo 30 mil a mi mamá");
    expect((await llamar(frase, "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 30000 }] })).error).toMatch(/prestamo/);
    expect((await llamar(frase, "cuentas", { cuentas: [{ cuenta: "Mamá", deuda: 30000 }] })).error).toMatch(/prestamo con accion me_prestaron/);
    let r = await llamar(frase, "prestamo", { accion: "me_prestaron", persona: "mi mamá", monto: 30000 });
    expect(r.confirmacion).toBe("Listo, anoté que le debes $30,000 a tu mamá.");
    expect(estadosDeCuentas(ctx).map((e) => e.nombre)).toEqual(["Revolut", "Revolut crédito", "Nu"]);

    // 2. "Le acabo de transferir 2 mil a mi mamá desde mi cuenta Revolut": un abono que sale de la Revolut de débito.
    frase = dictado(ctx, "Le acabo de transferir 2 mil a mi mamá desde mi cuenta Revolut");
    expect((await llamar(frase, "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 2000, cuenta: "Revolut" }] })).error).toMatch(/prestamo/);
    expect((await llamar(frase, "mover_dinero", { tipo: "transferencia", monto: 2000, desde: "Revolut", hacia: "mamá" })).error).toMatch(/le_pague/);
    r = await llamar(frase, "prestamo", { accion: "le_pague", persona: "mamá", monto: 2000, cuenta: "Revolut" });
    expect(r.confirmacion).toBe("Listo, abono de $2,000. Todavía le debes a tu mamá $28,000. Ahora Revolut tiene $17,291.");
    expect(saldo(ctx, "Revolut").saldoCentavos).toBe(1_729_100);
    expect(saldo(ctx, "Revolut crédito").deudaCentavos).toBe(500_000);
    // No cuenta como gasto.
    expect(buscarMovimientos(ctx, { periodo: "todo" }).movimientos.filter((m) => m.tipo === "gasto")).toHaveLength(0);

    // 3. "Le deposité otros 2 mil a mi madre", sin cuenta: solo baja la deuda.
    frase = dictado(ctx, "le deposité otros 2 mil a mi madre");
    r = await llamar(frase, "prestamo", { accion: "le_pague", persona: "mi madre", monto: 2000 });
    expect(r.confirmacion).toBe("Listo, abono de $2,000. Todavía le debes a tu mamá $26,000.");

    // 4. "¿Cuánto le debo a mi mamá?"
    r = await llamar(dictado(ctx, "¿cuánto le debo a mi mamá?"), "consultar_planes", { que: "prestamos", persona: "mi mamá" });
    expect(r.personas).toEqual([{ persona: "Mamá", el_usuario_le_debe: "$26,000" }]);
    expect(datosDelUsuario(ctx)).toContain("Préstamos pendientes con: Mamá (el usuario le debe).");

    // 5. El apartado de la app: lo prestado, lo abonado y cada movimiento, el más nuevo primero.
    let [deuda] = deudasPorPersona(ctx);
    expect(deuda).toMatchObject({ persona: "Mamá", direccion: "debo", prestadoCentavos: 3_000_000, pagadoCentavos: 400_000, pendienteCentavos: 2_600_000 });
    expect(deuda!.movimientos.map((m) => [m.tipo, m.montoCentavos, m.cuenta])).toEqual([
      ["abono", 200_000, null],
      ["abono", 200_000, "Revolut"],
      ["prestamo", 3_000_000, null],
    ]);

    // 6. "Deshaz eso": el último abono sale del historial y la deuda regresa.
    expect(deshacer(ctx).deshecho).toBe(true);
    [deuda] = deudasPorPersona(ctx);
    expect([deuda!.pendienteCentavos, deuda!.movimientos.length]).toEqual([2_800_000, 2]);

    // 7. Saldarla: ya no aparece, salvo con todos.
    r = await llamar(dictado(ctx, "ya le pagué todo a mi mamá"), "prestamo", { accion: "le_pague", persona: "mamá" });
    expect(r.confirmacion).toBe("Listo, ya no le debes nada a tu mamá.");
    expect(deudasPorPersona(ctx)).toHaveLength(0);
    expect(deudasPorPersona(ctx, { todos: true })[0]).toMatchObject({ pendienteCentavos: 0, pagadoCentavos: 3_000_000 });
    expect(listarPrestamos(ctx).deboCentavos).toBe(0);
  });

  test("un abono que salda un préstamo y sigue con otro es uno solo en el historial", () => {
    const { ctx } = preparar();
    registrarPrestamo(ctx, { persona: "Mamá", direccion: "debo", monto: 1000 });
    registrarPrestamo(ctx, { persona: "Mamá", direccion: "debo", monto: 1000 });
    abonarPrestamo({ ...ctx, entradaId: "abono" }, { persona: "mamá", monto: 1500 });
    const [deuda] = deudasPorPersona(ctx);
    expect(deuda!.movimientos.filter((m) => m.tipo === "abono").map((m) => m.montoCentavos)).toEqual([150_000]);
    expect(deuda!.pendienteCentavos).toBe(50_000);
  });
});

describe("fechas de las tarjetas por voz", () => {
  test("¿cuándo pago la Nu? dice el corte, el pago y lo que debe", async () => {
    const { ctx } = preparar();
    conCuentas(ctx);
    // Hoy es 7 de octubre (ayuda.ts): el 23 es en 16 días.
    let r = await llamar(dictado(ctx, "¿Cuándo pago la Nu?"), "consultar_cuentas", { cuenta: "Nu" });
    expect(r.respuesta).toBe("Nu corta el día 3 y se paga el día 23, en 16 días. Debes $3,000.");
    r = await llamar(dictado(ctx, "¿Qué día corta la Revolut crédito?"), "consultar_cuentas", { cuenta: "Revolut crédito" });
    expect(r.respuesta).toMatch(/^No me has dicho el día de corte ni de pago de Revolut crédito/);
    r = await llamar(dictado(ctx, "¿Cuándo tengo que pagar mis tarjetas?"), "consultar_cuentas", {});
    expect(r.respuesta).toContain("Nu corta el día 3 y se paga el día 23, en 16 días.");
    // Preguntar cuánto debe sigue igual.
    r = await llamar(dictado(ctx, "¿Cuánto debo de la Nu?"), "consultar_cuentas", { cuenta: "Nu" });
    expect(r.respuesta).not.toContain("corta");
  });
});

describe("familiares sin nombre", () => {
  test('"mi hermano" basta: se guarda como Hermano y la voz dice "tu hermano"', async () => {
    const { ctx } = preparar();
    let r = await llamar(dictado(ctx, "Mi hermano me prestó 5 mil"), "prestamo", { accion: "me_prestaron", persona: "mi hermano", monto: 5000 });
    expect(r.confirmacion).toBe("Listo, anoté que tu hermano te prestó $5,000.");
    r = await llamar(dictado(ctx, "Ya le pagué 2 mil a mi hermano"), "prestamo", { accion: "le_pague", persona: "hermano", monto: 2000 });
    expect(r.confirmacion).toBe("Listo, abono de $2,000. Todavía le debes a tu hermano $3,000.");
    expect(listarPrestamos(ctx).prestamos.map((p) => p.persona)).toEqual(["Hermano"]);
  });
});
