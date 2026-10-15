import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearHerramientas } from "../src/ai/herramientas";
import { hablaDeDeudaCon, hablaDePrestamo } from "../src/ai/herramientas-planes";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import type { Contexto } from "../src/finanzas/contexto";
import { estadosDeCuentas, fijarCuenta } from "../src/finanzas/cuentas";
import { crearMovimiento, deshacer } from "../src/finanzas/movimientos";
import { abonarPrestamo, deudaPorId, deudasEdicionHabilitada, deudasPorPersona, editarDeuda, eliminarDeuda, registrarPrestamo } from "../src/finanzas/planes";
import { preparar } from "./ayuda";

// Deudas y préstamos como submódulo: alta, abono, editar y borrar desde la app y por voz, y sus totales en Cuentas.
// Con los datos de Pedro: le debe 32,733 a su mamá y 20,000 a Milton Ventura.

type Json = Record<string, any>;

function montar() {
  const { db, usuario } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: [] as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
  const pedirCon = (tk: string) => async (ruta: string, metodo = "GET", cuerpo?: unknown) => {
    await Bun.sleep(2);
    const r = await app.request(ruta, {
      method: metodo,
      headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { estado: r.status, cuerpo: (await r.json()) as Json };
  };
  return { db, usuario, pedir: pedirCon(token), pedirCon };
}

const llamar = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const dictado = (ctx: Contexto, frase: string): Contexto => ({ ...ctx, textoOriginal: frase, entradaId: crypto.randomUUID() });

describe("interruptor DEUDAS_PERSONAS", () => {
  test("por omisión solo la cuenta dueña; todos lo abre y 0 lo apaga", () => {
    const { db, usuario } = preparar();
    const julissa = crearUsuario(db, "Julissa");
    expect(deudasEdicionHabilitada(db, usuario.id, undefined)).toBe(true);
    expect(deudasEdicionHabilitada(db, julissa.id, undefined)).toBe(false);
    expect(deudasEdicionHabilitada(db, julissa.id, "dueno")).toBe(false);
    expect(deudasEdicionHabilitada(db, julissa.id, "todos")).toBe(true);
    expect(deudasEdicionHabilitada(db, usuario.id, "0")).toBe(false);
  });
});

describe("editar y borrar una deuda", () => {
  test("el total nuevo se ajusta sin bajar de lo abonado; lo que queda también; deshacer lo regresa", () => {
    const { ctx } = preparar();
    const a = registrarPrestamo(ctx, { persona: "mi mamá", direccion: "debo", monto: 30000 });
    registrarPrestamo(ctx, { persona: "mi madre", direccion: "debo", monto: 2733 });
    abonarPrestamo(ctx, { persona: "mamá", monto: 5000 });
    const d = deudaPorId(ctx, a.id);
    expect(d).toMatchObject({ persona: "Mamá", prestadoCentavos: 3_273_300, pagadoCentavos: 500_000, pendienteCentavos: 2_773_300, saldada: false });

    // "Ahora nada más le debo 20 mil": total = abonado + lo que queda.
    expect(editarDeuda(ctx, d.id, { pendiente: 20000 })).toMatchObject({ prestadoCentavos: 2_500_000, pendienteCentavos: 2_000_000 });
    // No puede quedar debajo de lo abonado.
    expect(() => editarDeuda(ctx, d.id, { monto: 4000 })).toThrow("abonados");
    // Bajar el total a lo abonado la salda; el préstamo nuevo que quedó en cero se quita.
    const saldada = editarDeuda(ctx, d.id, { monto: 5000 });
    expect(saldada).toMatchObject({ pendienteCentavos: 0, saldada: true });
    expect(deudasPorPersona(ctx)).toEqual([]);
    deshacer(ctx);
    expect(deudaPorId(ctx, d.id).pendienteCentavos).toBe(2_000_000);
  });

  test("renombrar y cambiar el sentido; borrar la deuda entera y deshacer", () => {
    const { ctx } = preparar();
    const m = registrarPrestamo(ctx, { persona: "Milton", direccion: "debo", monto: 20000 });
    expect(editarDeuda(ctx, m.id, { persona: "Milton Ventura", descripcion: "Lo del coche" })).toMatchObject({ persona: "Milton Ventura", descripcion: "Lo del coche" });
    expect(editarDeuda(ctx, m.id, { direccion: "me_deben" }).direccion).toBe("me_deben");
    const e = eliminarDeuda(ctx, m.id);
    expect(e).toEqual({ persona: "Milton Ventura", direccion: "me_deben", pendienteCentavos: 2_000_000 });
    expect(deudasPorPersona(ctx, { todos: true })).toEqual([]);
    deshacer(ctx);
    expect(deudasPorPersona(ctx)[0]).toMatchObject({ persona: "Milton Ventura", pendienteCentavos: 2_000_000 });
  });
});

describe("API de deudas para la app", () => {
  test("alta con cuenta, abono, editar, borrar y deshacer", async () => {
    const { pedir } = montar();
    const revolut = (await pedir("/v1/cuentas", "POST", { nombre: "Revolut", tipo: "debito", saldo: 18000 })).cuerpo;

    const vacio = await pedir("/v1/prestamos");
    expect(vacio.cuerpo).toMatchObject({ edicion: true, personas: [], deboCentavos: 0 });

    // Le presté 2 mil a Juan desde Revolut: sale de la cuenta sin ser gasto.
    const juan = await pedir("/v1/prestamos", "POST", { persona: "Juan", direccion: "me_deben", monto: 2000, cuenta_id: revolut.id });
    expect(juan.estado).toBe(201);
    expect(juan.cuerpo).toMatchObject({ persona: "Juan", direccion: "me_deben", pendienteCentavos: 200_000, saldada: false });
    expect(juan.cuerpo.movimientos[0]).toMatchObject({ tipo: "prestamo", cuenta: "Revolut" });
    expect((await pedir(`/v1/cuentas/${revolut.id}`)).cuerpo.cuenta.saldoCentavos).toBe(1_600_000);

    // Abono que llega a Revolut.
    const abono = await pedir(`/v1/prestamos/${juan.cuerpo.id}/abonos`, "POST", { monto: 500, cuenta_id: revolut.id });
    expect(abono.cuerpo).toMatchObject({ pendienteCentavos: 150_000, pagadoCentavos: 50_000 });
    expect(abono.cuerpo.movimientos[0]).toMatchObject({ tipo: "abono", montoCentavos: 50_000, cuenta: "Revolut" });
    expect((await pedir(`/v1/cuentas/${revolut.id}`)).cuerpo.cuenta.saldoCentavos).toBe(1_650_000);
    // Más de lo que queda: error claro.
    expect((await pedir(`/v1/prestamos/${juan.cuerpo.id}/abonos`, "POST", { monto: 5000 })).estado).toBe(400);
    // Deshacer el abono regresa la deuda y el dinero de la cuenta (una sola acción).
    await pedir("/v1/deshacer", "POST");
    expect((await pedir(`/v1/cuentas/${revolut.id}`)).cuerpo.cuenta.saldoCentavos).toBe(1_600_000);
    expect((await pedir("/v1/prestamos")).cuerpo.personas[0].pendienteCentavos).toBe(200_000);

    // Deuda con fecha de hace un mes, y una fecha futura no.
    expect((await pedir("/v1/prestamos", "POST", { persona: "Milton Ventura", direccion: "debo", monto: 20000, fecha: "2099-01-01" })).estado).toBe(400);
    const milton = await pedir("/v1/prestamos", "POST", { persona: "Milton Ventura", direccion: "debo", monto: 20000, fecha: "2026-09-01" });
    expect(milton.cuerpo.desde.slice(0, 10)).toBe("2026-09-01");

    // Editar: lo que queda, y validaciones.
    expect((await pedir(`/v1/prestamos/${milton.cuerpo.id}`, "PATCH", { pendiente: 18000 })).cuerpo).toMatchObject({ pendienteCentavos: 1_800_000 });
    expect((await pedir(`/v1/prestamos/${milton.cuerpo.id}`, "PATCH", {})).estado).toBe(400);
    expect((await pedir(`/v1/prestamos/${milton.cuerpo.id}`, "PATCH", { monto: 1, pendiente: 1 })).estado).toBe(400);
    expect((await pedir("/v1/prestamos/no-existe", "PATCH", { monto: 1 })).estado).toBe(404);

    // Liquidar sin monto.
    const liquidada = await pedir(`/v1/prestamos/${juan.cuerpo.id}/abonos`, "POST", {});
    expect(liquidada.cuerpo).toMatchObject({ pendienteCentavos: 0, saldada: true });
    expect((await pedir("/v1/prestamos?todos=1")).cuerpo.personas.find((p: Json) => p.persona === "Juan").saldada).toBe(true);

    // Borrar.
    expect((await pedir(`/v1/prestamos/${milton.cuerpo.id}`, "DELETE")).cuerpo).toEqual({ ok: true, persona: "Milton Ventura", pendienteCentavos: 1_800_000 });
    expect((await pedir("/v1/prestamos")).cuerpo.personas).toEqual([]);
    await pedir("/v1/deshacer", "POST");
    expect((await pedir("/v1/prestamos")).cuerpo.deboCentavos).toBe(1_800_000);
  });

  test("Cuentas resta lo que debe a personas; lo que le deben no suma", async () => {
    const { pedir } = montar();
    await pedir("/v1/cuentas", "POST", { nombre: "Revolut", tipo: "debito", saldo: 18283.19 });
    await pedir("/v1/cuentas", "POST", { nombre: "Nu", tipo: "credito", limite: 33600, deuda: 24537.81 });
    await pedir("/v1/prestamos", "POST", { persona: "mi mamá", direccion: "debo", monto: 32733 });
    await pedir("/v1/prestamos", "POST", { persona: "Juan", direccion: "me_deben", monto: 1000 });
    const { totales } = (await pedir("/v1/cuentas")).cuerpo;
    // El neto de siempre no cambia: cuentas menos tarjetas.
    expect(totales.netoCentavos).toBe(1_828_319 - 2_453_781);
    // Lo que debe a personas resta como una tarjeta; lo que le deben va aparte y no suma.
    expect(totales.personas).toEqual({ meDebenCentavos: 100_000, deboCentavos: 3_273_300, netoCentavos: 1_828_319 - 2_453_781 - 3_273_300 });
    expect((await pedir("/v1/tablero")).cuerpo.cuentas.personas.deboCentavos).toBe(3_273_300);
  });

  test("otra cuenta sin el interruptor: sin edición ni totales de personas", async () => {
    const { db, pedirCon } = montar();
    const julissa = crearUsuario(db, "Julissa");
    const pedir = pedirCon(crearDispositivo(db, julissa.id, "iPhone"));
    expect((await pedir("/v1/prestamos")).cuerpo.edicion).toBe(false);
    expect((await pedir("/v1/prestamos", "POST", { persona: "Ana", direccion: "debo", monto: 100 })).estado).toBe(404);
    expect((await pedir("/v1/cuentas")).cuerpo.totales.personas).toBeNull();
  });

  test("no se puede tocar la deuda de otra cuenta", async () => {
    const { db, pedir, pedirCon } = montar();
    const milton = (await pedir("/v1/prestamos", "POST", { persona: "Milton", direccion: "debo", monto: 20000 })).cuerpo;
    const otro = crearUsuario(db, "Otro");
    process.env.DEUDAS_PERSONAS = "todos";
    try {
      const ajeno = pedirCon(crearDispositivo(db, otro.id, "iPhone"));
      expect((await ajeno(`/v1/prestamos/${milton.id}`, "DELETE")).estado).toBe(404);
      expect((await ajeno(`/v1/prestamos/${milton.id}/abonos`, "POST", { monto: 1 })).estado).toBe(404);
    } finally {
      delete process.env.DEUDAS_PERSONAS;
    }
    expect((await pedir("/v1/prestamos")).cuerpo.deboCentavos).toBe(2_000_000);
  });
});

describe("la IA corrige y borra deudas", () => {
  const conDeudas = () => {
    const { ctx } = preparar();
    registrarPrestamo(ctx, { persona: "mi mamá", direccion: "debo", monto: 32733 });
    registrarPrestamo(ctx, { persona: "Milton Ventura", direccion: "debo", monto: 20000 });
    return ctx;
  };

  test("solo la cuenta con el interruptor ve la herramienta corregir_prestamo; prestamo queda igual que antes", () => {
    const { ctx, db } = preparar();
    const ana = { ...ctx, usuarioId: crearUsuario(db, "Ana").id };
    expect(Object.keys(crearHerramientas(ctx, []))).toContain("corregir_prestamo");
    expect(Object.keys(crearHerramientas(ana, []))).not.toContain("corregir_prestamo");
  });

  test("reconoce cuándo habla de la deuda y no de un movimiento", () => {
    const personas = ["Mamá", "Milton Ventura"];
    expect(hablaDeDeudaCon("Borra la deuda con Milton", personas)).toBe(true);
    expect(hablaDeDeudaCon("cámbiale a 18 mil lo de Milton", personas, true)).toBe(true);
    expect(hablaDeDeudaCon("borra el préstamo de mi mamá", personas)).toBe(true);
    // "Lo de" al borrar puede ser un movimiento; el pago a mi mamá es un movimiento.
    expect(hablaDeDeudaCon("borra lo de Milton", personas)).toBe(false);
    expect(hablaDeDeudaCon("borra el pago a mi mamá", personas)).toBe(false);
    expect(hablaDeDeudaCon("borra la deuda con Juan", personas)).toBe(false);
  });

  test('"cámbiale a 18 mil lo de Milton", "ahora nada más le debo 30 mil a mi mamá" y "borra la deuda con Milton"', async () => {
    const ctx = conDeudas();
    const total = await llamar(dictado(ctx, "cámbiale a 18 mil lo de Milton"), "corregir_prestamo", { accion: "cambiar", persona: "Milton", monto: 18000 });
    expect(total.confirmacion).toBe("Listo, corregido: le debes $18,000 a Milton Ventura.");

    // El modelo lo manda como préstamo nuevo: una vez se le pide cambiar; la segunda vez se respeta.
    const frase = "ahora nada más le debo 30 mil a mi mamá";
    const ctxFrase = dictado(ctx, frase);
    const herramientas = crearHerramientas(ctxFrase, []) as Record<string, { execute?: unknown }>;
    const prestamo = (args: unknown) => (herramientas.prestamo!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
    expect((await prestamo({ accion: "me_prestaron", persona: "mi mamá", monto: 30000 })).error).toContain("corregir_prestamo con accion cambiar y queda");
    const corregida = await (herramientas.corregir_prestamo!.execute as (a: unknown, o: unknown) => Promise<any>)({ accion: "cambiar", persona: "mi mamá", queda: 30000 }, {});
    expect(corregida.confirmacion).toBe("Listo, corregido: le debes $30,000 a tu mamá.");

    const borrada = await llamar(dictado(ctx, "borra la deuda con Milton"), "corregir_prestamo", { accion: "borrar", persona: "Milton" });
    expect(borrada.confirmacion).toBe("Listo, borré la deuda de $18,000 que tenías con Milton Ventura.");
    expect(deudasPorPersona(ctx).map((d) => d.persona)).toEqual(["Mamá"]);
  });

  test('"ahora nada más le debo 20 mil" con abonos es lo que queda aunque el modelo lo mande como monto', async () => {
    const { ctx } = preparar();
    registrarPrestamo(ctx, { persona: "mi mamá", direccion: "debo", monto: 30000 });
    abonarPrestamo(ctx, { persona: "mamá", monto: 5000 });
    const r = await llamar(dictado(ctx, "ahora nada más le debo 20 mil a mi mamá"), "corregir_prestamo", { accion: "cambiar", persona: "Mamá", monto: 20000 });
    expect(r.deuda).toMatchObject({ pendienteCentavos: 2_000_000, pagadoCentavos: 500_000, prestadoCentavos: 2_500_000 });
    // "En realidad fueron 28 mil" sí es el total.
    const t = await llamar(dictado(ctx, "en realidad fueron 28 mil lo de mi mamá"), "corregir_prestamo", { accion: "cambiar", persona: "Mamá", monto: 28000 });
    expect(t.deuda).toMatchObject({ prestadoCentavos: 2_800_000, pendienteCentavos: 2_300_000 });
  });

  test('"ya le terminé de pagar a mi mamá" salda todo; "¿cuánto me deben?" responde', async () => {
    const ctx = conDeudas();
    registrarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 2000 });
    const r = await llamar(dictado(ctx, "ya le terminé de pagar a mi mamá"), "prestamo", { accion: "le_pague", persona: "mi mamá" });
    expect(r.confirmacion).toBe("Listo, ya no le debes nada a tu mamá.");
    const c = await llamar(dictado(ctx, "¿cuánto me deben?"), "consultar_planes", { que: "prestamos" });
    expect(c).toMatchObject({ total_le_deben: "$2,000", total_debe: "$20,000" });
  });

  test("borrar un movimiento que en realidad es la deuda se manda una vez a prestamo", async () => {
    const ctx = conDeudas();
    crearMovimiento(ctx, { tipo: "gasto", monto: 100, comercio: "Oxxo" });
    const c = dictado(ctx, "borra la deuda con Milton");
    const h = crearHerramientas(c, []) as Record<string, { execute?: unknown }>;
    const eliminar = (args: unknown) => (h.eliminar_movimiento!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
    expect((await eliminar({ buscar: { texto: "Milton" } })).error).toContain("usa corregir_prestamo");
    expect(hablaDePrestamo(c, "cámbiale a 18 mil lo de Milton")).toBe(true);
  });

  test("¿cuánto debo? cuenta también lo de personas", async () => {
    const ctx = conDeudas();
    const antes = { ...ctx, ahoraIso: new Date(Date.parse(ctx.ahoraIso) - 60_000).toISOString() };
    fijarCuenta(antes, { cuenta: "Revolut", tipo: "debito", saldo: 18000 });
    fijarCuenta(antes, { cuenta: "Nu", tipo: "credito", limite: 33600, deuda: 24000 });
    expect(estadosDeCuentas(ctx)).toHaveLength(2);
    const r = await llamar(dictado(ctx, "¿cuánto debo?"), "consultar_cuentas", {});
    expect(r.respuesta).toContain("le debes $52,733 a tu mamá y a Milton Ventura");
    registrarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 500 });
    expect((await llamar(dictado(ctx, "¿cuánto tengo?"), "consultar_cuentas", {})).respuesta).not.toContain("Juan");
  });
});
