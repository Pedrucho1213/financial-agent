import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearHerramientas } from "../src/ai/herramientas";
import { construirInstrucciones } from "../src/ai/instrucciones";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { eq } from "drizzle-orm";
import { cuentas, entradas, movimientos } from "../src/db/schema";
import { avisoDelDia, avisosPorEnviar, guardarAviso, listarAvisos, marcarEnviados } from "../src/finanzas/avisos";
import { listarCategorias } from "../src/finanzas/catalogos";
import { type Contexto, crearContexto } from "../src/finanzas/contexto";
import { recordar } from "../src/finanzas/memorias";
import { buscarMovimientos, crearMovimiento, deshacer, revertirEntrada } from "../src/finanzas/movimientos";
import {
  abonarPrestamo,
  aportarMeta,
  crearMeta,
  datoDePresupuesto,
  disponible,
  estadoPresupuestos,
  fechaLimiteDe,
  fijarPresupuesto,
  listarMetas,
  listarMsi,
  listarPrestamos,
  quitarPresupuesto,
  registrarMsi,
  registrarPrestamo,
  respuestaDisponible,
} from "../src/finanzas/planes";
import { cobrosPorAvisar, crearRecurrente } from "../src/finanzas/recurrentes";
import { revisar, revisarPendientes } from "../src/finanzas/revisor";
import { AHORA, llamada, preparar, texto } from "./ayuda";

// Miércoles 7 de octubre de 2026 (ver ayuda.ts): quedan 25 días del mes, hoy incluido.

const llamar = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const dictado = (ctx: Contexto, frase: string): Contexto => ({ ...ctx, textoOriginal: frase, entradaId: crypto.randomUUID() });
const otroDia = (ctx: Contexto, fecha: string, hora = "16:00:00Z") =>
  crearContexto({ db: ctx.db, usuarioId: ctx.usuarioId, zonaHoraria: ctx.zonaHoraria, monedaBase: ctx.monedaBase, ahora: new Date(`${fecha}T${hora}`) });
const gasto = (ctx: Contexto, monto: number, categoria: string, extra: Record<string, unknown> = {}) =>
  crearMovimiento({ ...ctx, entradaId: "previa" }, { tipo: "gasto", monto, categoria, ...extra });

describe("presupuestos", () => {
  test("una categoría principal incluye sus subcategorías; el general, todo", () => {
    const { ctx } = preparar();
    fijarPresupuesto(ctx, { categoria: "comida", monto: 3000 });
    fijarPresupuesto(ctx, { categoria: "del mes", monto: 15000 });
    gasto(ctx, 1500, "Súper");
    gasto(ctx, 900, "Café");
    gasto(ctx, 600, "Gasolina");
    // Del mes pasado: no cuenta.
    gasto(ctx, 5000, "Súper", { fecha: "2026-09-30" });
    const e = estadoPresupuestos(ctx);
    expect(e.presupuestos.map((p) => [p.categoria, p.gastadoCentavos / 100, p.porcentaje, p.estado])).toEqual([
      ["General", 3000, 20, "bien"],
      ["Comida", 2400, 80, "cerca"],
    ]);
    // 2,400 en 7 días: al ritmo actual cierra en 2,400 / 7 * 31.
    expect(e.presupuestos[1]!.proyeccionCentavos).toBe(1062900);
    expect(e.total).toEqual({ limiteCentavos: 1500000, gastadoCentavos: 300000 });
  });

  test("fijarlo otra vez lo cambia y quitarlo se puede deshacer", () => {
    const { ctx } = preparar();
    fijarPresupuesto(dictado(ctx, "presupuesto de súper 2 mil"), { categoria: "el súper", monto: 2000 });
    fijarPresupuesto(dictado(ctx, "mejor 2500"), { categoria: "Súper", monto: 2500 });
    expect(estadoPresupuestos(ctx).presupuestos.map((p) => p.limiteCentavos)).toEqual([250000]);
    quitarPresupuesto(dictado(ctx, "quita el del súper"), { categoria: "súper" });
    expect(estadoPresupuestos(ctx).presupuestos).toHaveLength(0);
    deshacer(ctx);
    expect(estadoPresupuestos(ctx).presupuestos.map((p) => p.limiteCentavos)).toEqual([250000]);
    deshacer(ctx);
    expect(estadoPresupuestos(ctx).presupuestos.map((p) => p.limiteCentavos)).toEqual([200000]);
    expect(() => fijarPresupuesto(ctx, { categoria: "unicornios", monto: 10 })).toThrow(/No existe la categoría/);
  });

  test("el dato útil sale solo al cruzar el 80% o el 100%", () => {
    const { ctx } = preparar();
    fijarPresupuesto(ctx, { categoria: "Comida", monto: 1000 });
    const cats = listarCategorias(ctx.db, ctx.usuarioId);
    const cafe = cats.find((c) => c.nombre === "Café")!.id;
    const nuevo = (monto: number) => ({ categoriaId: cafe, montoCentavos: monto * 100, fecha: ctx.hoy, moneda: "MXN" });
    gasto(ctx, 500, "Café");
    expect(datoDePresupuesto(ctx, [nuevo(500)])).toBeUndefined();
    gasto(ctx, 320, "Café");
    expect(datoDePresupuesto(ctx, [nuevo(320)])).toBe("Vas en 82% de tu presupuesto de Comida.");
    gasto(ctx, 50, "Café");
    expect(datoDePresupuesto(ctx, [nuevo(50)])).toBeUndefined();
    gasto(ctx, 250, "Café");
    expect(datoDePresupuesto(ctx, [nuevo(250)])).toBe("Ya te pasaste de tu presupuesto de Comida por $120.");
    // Otra categoría, otra moneda u otro mes: nada.
    expect(datoDePresupuesto(ctx, [{ ...nuevo(900), moneda: "USD" }])).toBeUndefined();
  });
});

describe("metas", () => {
  test("crear con plazo sugiere cuánto apartar y aportar avanza", () => {
    const { ctx } = preparar();
    const m = crearMeta(ctx, { nombre: "un viaje a Japón", objetivo: 30000, fechaLimite: "para diciembre" });
    expect([m.nombre, m.fechaLimite, m.mensualSugeridoCentavos]).toEqual(["Viaje a Japón", "2026-12-31", 1000000]);
    const a = aportarMeta(ctx, { nombre: "el viaje", monto: 7500 });
    expect([a.ahorradoCentavos, a.porcentaje, a.recienCompletada]).toEqual([750000, 25, false]);
    expect(() => aportarMeta(ctx, { nombre: "viaje", monto: -8000 })).toThrow(/solo hay \$7,500/);
    // Con una sola meta no hace falta nombrarla.
    expect(aportarMeta(ctx, { monto: 22500 }).recienCompletada).toBe(true);
    crearMeta(ctx, { nombre: "Fondo de emergencia", objetivo: 50000 });
    expect(() => aportarMeta(ctx, { nombre: "coche", monto: 10 })).toThrow(/Las que hay: Viaje a Japón, Fondo de emergencia/);
    expect(listarMetas(ctx).metas.map((x) => x.completada)).toEqual([true, false]);
  });

  test("la fecha límite siempre es a futuro", () => {
    const { ctx } = preparar();
    expect(fechaLimiteDe(ctx, "marzo")).toBe("2027-03-31");
    expect(fechaLimiteDe(ctx, "junio 2028")).toBe("2028-06-30");
    expect(fechaLimiteDe(ctx, "2027-01-15")).toBe("2027-01-15");
    expect(fechaLimiteDe(ctx, undefined)).toBeNull();
    expect(() => fechaLimiteDe(ctx, "cuando pueda")).toThrow(/No entendí la fecha/);
  });
});

describe("préstamos entre personas", () => {
  test("se suman por persona y los abonos van del más antiguo al más nuevo", () => {
    const { ctx } = preparar();
    registrarPrestamo(ctx, { persona: "a Juan", direccion: "me_deben", monto: 500 });
    const segundo = registrarPrestamo(ctx, { persona: "juan", direccion: "me_deben", monto: 300 });
    expect([segundo.persona, segundo.totalPendienteCentavos]).toEqual(["Juan", 80000]);
    registrarPrestamo(ctx, { persona: "Ana", direccion: "debo", monto: 1000 });
    const abono = abonarPrestamo(ctx, { persona: "Juan", monto: 600 });
    expect([abono.abonadoCentavos, abono.pendienteCentavos, abono.saldado]).toEqual([60000, 20000, false]);
    expect(listarPrestamos(ctx).prestamos.map((p) => [p.persona, p.pendienteCentavos])).toEqual([
      ["Juan", 20000],
      ["Ana", 100000],
    ]);
    // Sin monto, salda todo.
    expect(abonarPrestamo(ctx, { persona: "Juan" }).saldado).toBe(true);
    expect(listarPrestamos(ctx)).toMatchObject({ meDebenCentavos: 0, deboCentavos: 100000 });
    expect(() => abonarPrestamo(ctx, { persona: "Ana", monto: 2000 })).toThrow(/solo quedan \$1,000/);
    expect(() => abonarPrestamo(ctx, { persona: "Pedro", monto: 10 })).toThrow(/Hay con: Ana/);
  });

  test("con préstamos en los dos sentidos pide saber cuál", () => {
    const { ctx } = preparar();
    registrarPrestamo(ctx, { persona: "Luis", direccion: "me_deben", monto: 100 });
    registrarPrestamo(ctx, { persona: "Luis", direccion: "debo", monto: 50 });
    expect(() => abonarPrestamo(ctx, { persona: "Luis", monto: 50 })).toThrow(/dos sentidos/);
    expect(abonarPrestamo(ctx, { persona: "Luis", monto: 50, direccion: "debo" }).saldado).toBe(true);
  });
});

describe("meses sin intereses", () => {
  test("cada mensualidad queda como gasto cuando llega, y el último cargo absorbe el redondeo", () => {
    const { ctx } = preparar();
    const c = registrarMsi(dictado(ctx, "pantalla de mil a 3 meses"), { descripcion: "pantalla", total: 1000, meses: 3, cuenta: "BBVA" });
    expect([c.descripcion, c.mensualidadCentavos, c.pagadas, c.restanteCentavos, c.proximoCargo, c.cuenta]).toEqual([
      "Pantalla",
      33333,
      1,
      66667,
      "2026-11-07",
      "BBVA",
    ]);
    const enNoviembre = otroDia(ctx, "2026-11-08");
    const enEnero = otroDia(ctx, "2027-01-08");
    revisar(enNoviembre);
    revisar(enEnero);
    // Revisar dos veces no duplica.
    revisar(enEnero);
    const mensualidades = buscarMovimientos(enEnero, { texto: "MSI", periodo: "2026-10-01..2027-01-31", limite: 10 }).movimientos;
    expect(mensualidades.map((m) => [m.fecha, m.monto, m.cuenta])).toEqual([
      ["2026-12-07", "$333.34", "BBVA"],
      ["2026-11-07", "$333.33", "BBVA"],
      ["2026-10-07", "$333.33", "BBVA"],
    ]);
    expect(listarMsi(enEnero).compras).toHaveLength(0);
    expect(listarMsi(enEnero, { todas: true }).compras[0]!.restanteCentavos).toBe(0);
  });

  test("deshacer la compra quita también la mensualidad que se anotó", () => {
    const { ctx } = preparar();
    registrarMsi(dictado(ctx, "iPhone de 24 mil a 12 meses"), { descripcion: "iPhone", total: 24000, meses: 12 });
    expect(buscarMovimientos(ctx, { texto: "iPhone" }).encontrados).toBe(1);
    deshacer(ctx);
    expect(buscarMovimientos(ctx, { texto: "iPhone" }).encontrados).toBe(0);
    expect(listarMsi(ctx).compras).toHaveLength(0);
  });
});

describe("¿cuánto puedo gastar hoy?", () => {
  test("ingresos esperados menos lo gastado y lo que falta pagar, entre los días que quedan", () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Quincena", tipo: "ingreso", monto: 10000, frecuencia: "quincenal", dia: 15 });
    crearRecurrente(ctx, { nombre: "Renta", tipo: "renta", monto: 6000, frecuencia: "mensual", dia: 20 });
    gasto(ctx, 2000, "Súper", { fecha: "2026-10-03" });
    gasto(ctx, 100, "Café");
    const d = disponible(ctx);
    // 20,000 de quincenas - 2,100 gastado - 6,000 de renta = 11,900; con los 100 de hoy, 12,000 / 25 días.
    expect(d).toMatchObject({ base: "ingresos", ingresosCentavos: 2000000, comprometidoCentavos: 600000, libreMesCentavos: 1190000, diasRestantes: 25, porDiaCentavos: 48000, disponibleHoyCentavos: 38000 });
    expect(respuestaDisponible(ctx, d)).toBe("Hoy te quedan $380 de los $480 que te tocan por día, ya apartando $6,000 de pagos que faltan.");
  });

  test("sin ingresos usa el presupuesto general, y sin nada pide un dato", () => {
    const { ctx } = preparar();
    expect(disponible(ctx).base).toBeNull();
    expect(respuestaDisponible(ctx)).toMatch(/necesito saber cuánto te entra/);
    fijarPresupuesto(ctx, { monto: 10000 });
    expect(disponible(ctx)).toMatchObject({ base: "presupuestos", porDiaCentavos: 40000 });
    expect(respuestaDisponible(ctx)).toBe("Hoy puedes gastar hasta $400 para cerrar bien el mes.");
    gasto(ctx, 11000, "Súper");
    expect(respuestaDisponible(ctx)).toBe("Este mes ya no te queda margen: con lo que falta pagar te pasas por $1,000.");
  });
});

describe("herramientas de la IA", () => {
  test("cada una confirma lo que guardó y se puede deshacer", async () => {
    const { ctx } = preparar();
    let r = await llamar(dictado(ctx, "mi presupuesto de comida es de 3 mil al mes"), "presupuesto", { categoria: "Comida", monto: 3000 });
    expect(r.confirmacion).toBe("Listo, tu presupuesto de Comida es de $3,000 al mes.");
    r = await llamar(dictado(ctx, "quiero juntar 20 mil para un viaje"), "meta", { accion: "crear", nombre: "Viaje", monto: 20000 });
    expect(r.confirmacion).toBe("Listo, tu meta Viaje es juntar $20,000.");
    r = await llamar(dictado(ctx, "aparté 5 mil para el viaje"), "meta", { accion: "aportar", nombre: "viaje", monto: 5000 });
    expect(r.confirmacion).toBe("Listo, apartaste $5,000. En Viaje llevas $5,000 de $20,000, el 25%.");
    r = await llamar(dictado(ctx, "le presté 500 a Juan"), "prestamo", { accion: "le_preste", persona: "Juan", monto: 500 });
    expect(r.confirmacion).toBe("Listo, anoté que le prestaste $500 a Juan.");
    r = await llamar(dictado(ctx, "Juan me pagó 200"), "prestamo", { accion: "me_pagaron", persona: "Juan", monto: 200 });
    expect(r.confirmacion).toBe("Listo, abono de $200. Todavía Juan te debe $300.");
    r = await llamar(dictado(ctx, "compré una tele de 12 mil a 12 meses sin intereses con la Nu"), "compra_msi", { descripcion: "tele", total: 12000, meses: 12, cuenta: "Nu" });
    expect(r.confirmacion).toBe("Listo, Tele de $12,000 a 12 meses sin intereses con Nu: $1,000 al mes.");
    r = await llamar(dictado(ctx, "¿cuánto le presté a Juan?"), "consultar_planes", { que: "prestamos" });
    expect(r.personas).toEqual([{ persona: "Juan", le_debe_al_usuario: "$300" }]);
    expect(deshacer(ctx).deshecho).toBe(true);
    expect(listarMsi(ctx).compras).toHaveLength(0);
    // Las metas y personas aparecen en las instrucciones para que la IA las reconozca.
    const instrucciones = construirInstrucciones(ctx);
    expect(instrucciones).toContain("Sus metas: Viaje.");
    expect(instrucciones).toContain("Préstamos pendientes con: Juan.");
  });

  test("préstamos, metas y meses sin intereses no se registran como gasto", async () => {
    const { ctx } = preparar();
    const gastoDe = (monto: number) => ({ movimientos: [{ tipo: "gasto", monto }] });
    expect((await llamar(dictado(ctx, "compré unos tenis de 3 mil a 6 MSI"), "registrar_movimientos", gastoDe(3000))).error).toMatch(/compra_msi/);
    expect((await llamar(dictado(ctx, "Le presté 500 a Juan"), "registrar_movimientos", gastoDe(500))).error).toMatch(/prestamo/);
    registrarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 500 });
    expect((await llamar(dictado(ctx, "Juan me pagó 200"), "registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 200 }] })).error).toMatch(/prestamo/);
    crearMeta(ctx, { nombre: "Viaje", objetivo: 1000 });
    expect((await llamar(dictado(ctx, "aparté 300 para el viaje"), "registrar_movimientos", gastoDe(300))).error).toMatch(/meta/);
    // Un gasto normal, o varios montos con un préstamo en medio, sí se registran.
    expect((await llamar(dictado(ctx, "pagué 300 de la comida con Juan"), "registrar_movimientos", gastoDe(300))).registrados).toHaveLength(1);
    expect((await llamar(dictado(ctx, "200 de tacos y le presté 100 a Juan"), "registrar_movimientos", gastoDe(200))).registrados).toHaveLength(1);
  });

  test("con la app: registrar dice el dato útil y la confirmación no necesita otra vuelta del modelo", async () => {
    const { db, usuario, ctx } = preparar();
    fijarPresupuesto(ctx, { categoria: "Comida", monto: 1000 });
    gasto(ctx, 700, "Súper");
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const modelo = new MockLanguageModelV4({
      doGenerate: [
        llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 150, categoria: "Café", comercio: "Starbucks" }] }),
        llamada("meta", { accion: "crear", nombre: "Viaje", monto: 20000, fecha_limite: "diciembre" }),
        llamada("consultar_planes", { que: "cuanto_puedo_gastar" }),
        texto("no debería llegar aquí"),
      ] as never,
    });
    const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    let n = 0;
    const hablar = async (frase: string) =>
      (await (
        await app.request("/v1/hablar", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ texto: frase, client_id: `planes-${String(++n).padStart(4, "0")}`, capturado_en: AHORA.toISOString() }),
        })
      ).json()) as { respuesta: string; dato?: string };
    const r = await hablar("Gasté 150 en un café en Starbucks");
    expect(r.respuesta).toBe("Listo, Starbucks de 150 pesos en Café. Vas en 85% de tu presupuesto de Comida.");
    expect(r.dato).toBe("Vas en 85% de tu presupuesto de Comida.");
    expect((await hablar("Quiero juntar 20 mil para un viaje en diciembre")).respuesta).toBe(
      "Listo, tu meta Viaje es juntar 20,000 pesos. Para llegar a tiempo, aparta unos 6,667 pesos al mes.",
    );
    // Quedan 150 del presupuesto de Comida para 25 días y hoy ya se gastaron 850 en comida.
    expect((await hablar("¿Cuánto puedo gastar hoy?")).respuesta).toBe(
      "Hoy ya gastaste tu parte del día, que era de 40 pesos. Para cerrar bien el mes, mejor ya no gastes hoy.",
    );
    expect(modelo.doGenerateCalls).toHaveLength(3);
  });
});

describe("recordar y adivinar con qué paga", () => {
  test("lo que pidió recordar decide la cuenta: por comercio, por categoría o para todo", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 1, cuenta: "Nu" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 1, cuenta: "BBVA" });
    recordar(ctx, "Paga el Oxxo en efectivo");
    recordar(ctx, "La gasolina la paga con la BBVA");
    const registrar = async (frase: string, m: Record<string, unknown>) =>
      (await llamar(dictado(ctx, frase), "registrar_movimientos", { movimientos: [{ tipo: "gasto", ...m }] })).registrados[0].cuenta;
    expect(await registrar("80 en el Oxxo", { monto: 80, comercio: "Oxxo", categoria: "Antojos" })).toBe("Efectivo");
    expect(await registrar("mil de gasolina", { monto: 1000, categoria: "Gasolina" })).toBe("BBVA");
    expect(await registrar("200 de tacos", { monto: 200, categoria: "Restaurantes" })).toBeUndefined();
    recordar(ctx, "Siempre paga con la Nu");
    expect(await registrar("200 de tacos", { monto: 200, categoria: "Restaurantes" })).toBe("Nu");
    // Lo que dice manda.
    expect(await registrar("80 en el Oxxo con la BBVA", { monto: 80, comercio: "Oxxo", cuenta: "BBVA" })).toBe("BBVA");
  });

  test("sin comercio, con qué paga siempre esa categoría", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 900, categoria: "Gasolina", cuenta: "Revolut", fecha: "2026-09-20" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 1000, categoria: "Gasolina", cuenta: "Revolut", fecha: "2026-10-01" });
    const r = await llamar(dictado(ctx, "le eché 800 de gasolina"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 800, categoria: "Gasolina" }] });
    expect(r.registrados[0].cuenta).toBe("Revolut");
  });

  test('"recuerda que mi último gasto fue en pesos" corrige el registro, no es un recuerdo', async () => {
    const { ctx } = preparar();
    const r = await llamar(dictado(ctx, "Recuerda que mi último gasto no fue de dólares fue de pesos mexicanos"), "recordar", { texto: "El último gasto fue en pesos" });
    expect(r.error).toMatch(/editar_movimiento/);
    expect((await llamar(dictado(ctx, "Recuerda que el Oxxo lo pago en efectivo"), "recordar", { texto: "Paga el Oxxo en efectivo" })).recordado).toBe("Paga el Oxxo en efectivo");
  });
});

describe("revisor nocturno", () => {
  test("encuentra gastos hormiga, suscripciones olvidadas o repetidas y cobros que vienen", () => {
    const { ctx } = preparar();
    for (let i = 0; i < 8; i++) gasto(ctx, 65, "Café", { comercio: "Starbucks", fecha: `2026-10-0${(i % 7) + 1}` });
    gasto(ctx, 129, "Música", { comercio: "Spotify", fecha: "2026-09-05" });
    gasto(ctx, 129, "Música", { comercio: "Spotify", fecha: "2026-10-05" });
    crearMovimiento({ ...ctx, textoOriginal: "Acabo de pagar mi suscripción de AppleCare Plus de 379" }, { tipo: "gasto", monto: 379, categoria: "Software", descripcion: "Suscripción AppleCare Plus" });
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 8, categoria: "Streaming" });
    crearRecurrente(ctx, { nombre: "Disney", tipo: "suscripcion", monto: 179, frecuencia: "mensual", dia: 20, categoria: "Streaming" });
    const r = revisar(ctx);
    const lista = listarAvisos(ctx).avisos;
    expect(r.nuevos).toBe(lista.length);
    const por = (tipo: string) => lista.filter((a) => a.tipo === tipo).map((a) => a.texto);
    expect(por("hormiga")).toEqual(["En los últimos 30 días gastaste $520 en Starbucks, 8 veces. Al año serían unos $6,300."]);
    expect(por("suscripcion_olvidada")).toEqual([
      'Spotify te cobró $129 dos meses seguidos y no lo tengo como pago fijo. Si es cada mes, dime "Spotify cada mes" y te aviso antes del cobro.',
      'Anotaste AppleCare Plus de $379 como suscripción. Si se cobra cada mes, dime "AppleCare Plus cada mes" y te aviso antes del próximo cobro.',
    ]);
    expect(por("suscripcion_duplicada")).toEqual(["Pagas Netflix ($219) y Disney ($179), todas de Streaming: unos $398 al mes. Si no usas alguna, cancelarla es dinero libre."]);
    expect(por("cobro_proximo")).toEqual(["Mañana se cobra Netflix de $219."]);
    // Lo mismo otra vez no se repite.
    expect(revisar(ctx).nuevos).toBe(0);
  });

  test("avisa de un presupuesto que al ritmo actual se va a pasar", () => {
    const { ctx } = preparar();
    const dia12 = otroDia(ctx, "2026-10-12");
    fijarPresupuesto(dia12, { categoria: "Comida", monto: 3000 });
    gasto(dia12, 2000, "Súper", { fecha: "2026-10-10" });
    revisar(dia12);
    expect(listarAvisos(dia12).avisos.map((a) => a.texto)).toContain(
      "Al ritmo que vas, cerrarías el mes en $5,167 y tu presupuesto de Comida es de $3,000. Te quedan $1,000 para 20 días.",
    );
  });

  test("el aviso del día no repite un cobro que la voz ya dijo, y el push no manda lo ya dicho", () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 8 });
    guardarAviso(ctx, { tipo: "hormiga", clave: "x", titulo: "Gasto hormiga", texto: "Mucho café.", prioridad: 2 });
    revisar(ctx);
    const primero = avisoDelDia(ctx)!;
    expect(primero.aviso.texto).toBe("Mañana se cobra Netflix de $219.");
    // La voz lo dice al registrar algo: el aviso del día pasa al siguiente y el push ya no lo manda.
    cobrosPorAvisar(ctx)!.marcar();
    expect(avisoDelDia(ctx)!.aviso.texto).toBe("Mucho café.");
    const porEnviar = avisosPorEnviar(ctx.db, "America/Mexico_City", AHORA);
    expect(porEnviar.map((a) => a.texto)).toEqual(["Mucho café."]);
    marcarEnviados(ctx.db, porEnviar.map((a) => a.id));
    expect(avisosPorEnviar(ctx.db, "America/Mexico_City", AHORA)).toHaveLength(0);
    avisoDelDia(ctx)!.marcar();
    expect(avisoDelDia(ctx)).toBeUndefined();
  });

  test("corre una vez al día, desde las 3 de la mañana y solo sin dictados recientes", () => {
    const { db, ctx } = preparar();
    const opciones = { db, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" };
    // 2:30 en Ciudad de México: todavía no.
    expect(revisarPendientes(opciones, new Date("2026-10-07T08:30:00Z"))).toEqual([]);
    expect(revisarPendientes(opciones, new Date("2026-10-07T09:30:00Z"))).toEqual([ctx.usuarioId]);
    expect(revisarPendientes(opciones, new Date("2026-10-07T15:00:00Z"))).toEqual([]);
    // Al día siguiente, si alguien acaba de dictar, espera a que la Mac quede libre.
    db.insert(entradas).values({ usuarioId: ctx.usuarioId, clientId: "c1", conversacionId: "x", texto: "hola", capturadoEn: "2026-10-08T14:55:00Z", creadoEn: "2026-10-08T14:55:00Z" }).run();
    expect(revisarPendientes(opciones, new Date("2026-10-08T15:00:00Z"))).toEqual([]);
    expect(revisarPendientes(opciones, new Date("2026-10-08T15:20:00Z"))).toEqual([ctx.usuarioId]);
  });
});

describe("API para la app", () => {
  test("presupuestos, metas, préstamos, MSI, disponible y avisos", async () => {
    const { db, usuario, ctx } = preparar();
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: [] as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const pedir = async (ruta: string, metodo = "GET", cuerpo?: unknown) => {
      const r = await app.request(ruta, {
        method: metodo,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      return { estado: r.status, cuerpo: (await r.json()) as any };
    };
    const comida = listarCategorias(db, usuario.id).find((c) => c.nombre === "Comida")!;
    let r = await pedir("/v1/presupuestos", "PUT", { categoria_id: comida.id, limite: 3000 });
    expect([r.estado, r.cuerpo.categoria, r.cuerpo.limiteCentavos]).toEqual([200, "Comida", 300000]);
    expect((await pedir("/v1/presupuestos", "PUT", { limite: 15000 })).cuerpo.categoria).toBe("General");
    expect((await pedir("/v1/presupuestos", "PUT", { categoria_id: "no-existe", limite: 1 })).estado).toBe(400);
    r = await pedir("/v1/presupuestos");
    expect(r.cuerpo.presupuestos.map((p: any) => p.categoriaId)).toEqual([null, comida.id]);
    expect((await pedir(`/v1/presupuestos/${r.cuerpo.presupuestos[1].id}`, "DELETE")).cuerpo).toEqual({ ok: true });

    // En la app la fecha se elige: una que ya pasó, o que no existe, es un error.
    expect((await pedir("/v1/metas", "POST", { nombre: "Viaje", objetivo: 10000, fecha_limite: "2025-01-15" })).estado).toBe(400);
    expect((await pedir("/v1/metas", "POST", { nombre: "Viaje", objetivo: 10000, fecha_limite: "2027-02-30" })).estado).toBe(400);
    r = await pedir("/v1/metas", "POST", { nombre: "Viaje", objetivo: 10000, fecha_limite: "2027-12-31" });
    expect(r.estado).toBe(201);
    const id = r.cuerpo.id;
    expect((await pedir(`/v1/metas/${id}/aportes`, "POST", { monto: 2500 })).cuerpo).toMatchObject({ ahorradoCentavos: 250000, porcentaje: 25 });
    expect((await pedir(`/v1/metas/${id}/aportes`, "POST", { monto: 0 })).estado).toBe(400);
    expect((await pedir(`/v1/metas/${id}`, "PATCH", { objetivo: 5000, fecha_limite: null })).cuerpo).toMatchObject({ porcentaje: 50, fechaLimite: null });
    expect((await pedir("/v1/metas")).cuerpo.metas).toHaveLength(1);
    expect((await pedir(`/v1/metas/${id}`, "DELETE")).cuerpo).toEqual({ ok: true });
    expect((await pedir(`/v1/metas/${id}/aportes`, "POST", { monto: 1 })).estado).toBe(400);

    registrarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 500 });
    expect((await pedir("/v1/prestamos")).cuerpo).toMatchObject({ meDebenCentavos: 50000, deboCentavos: 0 });
    registrarMsi(ctx, { descripcion: "Tele", total: 6000, meses: 6 });
    expect((await pedir("/v1/msi")).cuerpo).toMatchObject({ mensualCentavos: 100000 });
    expect((await pedir("/v1/disponible")).cuerpo).toHaveProperty("porDiaCentavos");

    guardarAviso(ctx, { tipo: "hormiga", clave: "a", titulo: "Hormiga", texto: "Mucho café." });
    r = await pedir("/v1/avisos");
    expect(r.cuerpo.avisos.map((a: any) => a.texto)).toEqual(["Mucho café."]);
    await pedir(`/v1/avisos/${r.cuerpo.avisos[0].id}/leido`, "POST");
    expect((await pedir("/v1/avisos")).cuerpo.avisos).toHaveLength(0);
    expect((await pedir("/v1/avisos?todos=1")).cuerpo.avisos).toHaveLength(1);
    expect((await pedir("/v1/avisos/no-existe/descartar", "POST")).estado).toBe(400);
    expect((await pedir("/v1/avisos/revisar", "POST")).cuerpo).toHaveProperty("nuevos");
  });
});

test("un dictado que falla a medias no deja metas ni préstamos duplicados", () => {
  const { ctx } = preparar({ entradaId: "e1" });
  crearMeta(ctx, { nombre: "Viaje", objetivo: 1000 });
  registrarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 100 });
  revertirEntrada(ctx, "e1");
  expect(listarMetas(ctx).metas).toHaveLength(0);
  expect(listarPrestamos(ctx).prestamos).toHaveLength(0);
  // Y el reintento puede volver a crearlos.
  crearMeta(ctx, { nombre: "Viaje", objetivo: 1000 });
  expect(listarMetas(ctx).metas).toHaveLength(1);
});

describe("casos de la revisión de código", () => {
  test("los atajos a meta, préstamo o MSI no se roban gastos normales", async () => {
    const { ctx } = preparar();
    crearMeta(ctx, { nombre: "Carro nuevo", objetivo: 100000 });
    registrarPrestamo(ctx, { persona: "Luz", direccion: "me_deben", monto: 300 });
    registrarMsi(ctx, { descripcion: "pantalla", total: 12000, meses: 12 });
    const gastoDe = (monto: number) => ({ movimientos: [{ tipo: "gasto", monto }] });
    for (const [frase, monto] of [
      ["le puse 500 de gasolina al carro", 500],
      ["ya le pagué la luz, 800", 800],
      ["pagué la mensualidad del gym, 600", 600],
      ["me prestaron el coche y le eché 500 de gasolina", 500],
      ["le pagué a Luz 300 del corte de pelo", 300],
      ["guardé 200 en el carro para casetas", 200],
    ] as const) {
      expect((await llamar(dictado(ctx, frase), "registrar_movimientos", gastoDe(monto))).registrados).toHaveLength(1);
    }
    // Y los que sí son lo siguen siendo.
    expect((await llamar(dictado(ctx, "Luz ya me pagó 300"), "registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 300 }] })).error).toMatch(/prestamo/);
    expect((await llamar(dictado(ctx, "aparté 2 mil para el carro"), "registrar_movimientos", gastoDe(2000))).error).toMatch(/meta/);
    expect((await llamar(dictado(ctx, "guardé 500 al carro nuevo"), "registrar_movimientos", gastoDe(500))).error).toMatch(/meta/);
    expect((await llamar(dictado(ctx, "le devolví los 300 a Luz"), "registrar_movimientos", gastoDe(300))).error).toMatch(/prestamo/);
    expect((await llamar(dictado(ctx, "saqué una tele de 9 mil a 12 meses"), "registrar_movimientos", gastoDe(9000))).error).toMatch(/compra_msi/);
    expect((await llamar(dictado(ctx, "Luz me pagó 200 de lo que le debía"), "registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 200 }] })).error).toMatch(/prestamo/);
    // La mensualidad de una compra a meses ya se anota sola: anotarla a mano la contaría dos veces.
    expect((await llamar(dictado(ctx, "pagué la mensualidad de la pantalla, mil pesos"), "registrar_movimientos", gastoDe(1000))).error).toMatch(/ya se anotan solas el día del cargo; la próxima es el 2026-11-07/);
    // Si el modelo insiste en que es un gasto, la regla cede: puede equivocarse.
    const herramientas = crearHerramientas(dictado(ctx, "me prestaron 800 para las casetas"), []) as Record<string, { execute?: unknown }>;
    const registrar = (a: unknown) => (herramientas.registrar_movimientos!.execute as (a: unknown, o: unknown) => Promise<any>)(a, {});
    expect((await registrar(gastoDe(800))).error).toMatch(/prestamo/);
    expect((await registrar(gastoDe(800))).registrados).toHaveLength(1);
  });

  test("con dos Juanes, abonar o prestar a \"Juan\" pregunta cuál", () => {
    const { ctx } = preparar();
    registrarPrestamo(ctx, { persona: "Juan Pérez", direccion: "me_deben", monto: 500 });
    registrarPrestamo(ctx, { persona: "Juan López", direccion: "me_deben", monto: 300 });
    expect(() => abonarPrestamo(ctx, { persona: "Juan", monto: 700 })).toThrow(/Coinciden Juan Pérez y Juan López/);
    expect(() => registrarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 100 })).toThrow(/Coinciden/);
    expect(abonarPrestamo(ctx, { persona: "Juan López", monto: 300 }).saldado).toBe(true);
    // Con un solo Juan, "Juan" es él; "Juan Pérez" no se junta con un "Juan" que ya estaba.
    expect(registrarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 100 }).persona).toBe("Juan Pérez");
    const { ctx: otro } = preparar();
    registrarPrestamo(otro, { persona: "Ana", direccion: "me_deben", monto: 100 });
    expect(registrarPrestamo(otro, { persona: "Ana Ruiz", direccion: "me_deben", monto: 50 }).totalPendienteCentavos).toBe(5000);
  });

  test("quitar un presupuesto o una meta sin decir cuál pregunta si hay varios", async () => {
    const { ctx } = preparar();
    fijarPresupuesto(ctx, { categoria: "del mes", monto: 15000 });
    fijarPresupuesto(ctx, { categoria: "Comida", monto: 3000 });
    expect(() => quitarPresupuesto(ctx, {})).toThrow(/Hay varios presupuestos: General, Comida/);
    expect(quitarPresupuesto(ctx, { categoria: "general" }).categoria).toBe("General");
    expect(quitarPresupuesto(ctx, {}).categoria).toBe("Comida");
    crearMeta(ctx, { nombre: "Viaje", objetivo: 1000 });
    crearMeta(ctx, { nombre: "Fondo", objetivo: 1000 });
    expect((await llamar(dictado(ctx, "borra la meta"), "meta", { accion: "eliminar" })).error).toMatch(/Hay varias metas: Viaje, Fondo/);
  });

  test("el metro y la gasolina no son fugas", () => {
    const { ctx } = preparar();
    for (let i = 1; i <= 7; i++) gasto(ctx, 50, "Transporte público", { fecha: `2026-10-0${i}` });
    gasto(ctx, 800, "Gasolina", { comercio: "Pemex", fecha: "2026-09-05" });
    gasto(ctx, 800, "Gasolina", { comercio: "Pemex", fecha: "2026-10-05" });
    revisar(ctx);
    expect(listarAvisos(ctx).avisos.filter((a) => a.tipo === "hormiga" || a.tipo === "suscripcion_olvidada")).toHaveLength(0);
  });

  test("una mensualidad borrada o movida no vuelve en la noche", () => {
    const { ctx } = preparar();
    registrarMsi(ctx, { descripcion: "pantalla", total: 3000, meses: 3 });
    const noviembre = otroDia(ctx, "2026-11-08");
    revisar(noviembre);
    const [segunda, primera] = buscarMovimientos(noviembre, { texto: "MSI", periodo: "2026-10-01..2026-11-30" }).movimientos;
    expect([primera!.fecha, segunda!.fecha]).toEqual(["2026-10-07", "2026-11-07"]);
    // La primera la borra; la segunda la pasa al corte de la tarjeta.
    noviembre.db.update(movimientos).set({ eliminadoEn: new Date().toISOString() }).where(eq(movimientos.id, primera!.id)).run();
    noviembre.db.update(movimientos).set({ fecha: "2026-11-10" }).where(eq(movimientos.id, segunda!.id)).run();
    revisar(otroDia(ctx, "2026-11-09"));
    expect(buscarMovimientos(noviembre, { texto: "MSI", periodo: "2026-10-01..2026-11-30" }).movimientos.map((m) => m.fecha)).toEqual(["2026-11-10"]);
  });

  test("un primer cargo a meses dicho a futuro es del año que viene, no del pasado", () => {
    const { ctx } = preparar();
    const c = registrarMsi(ctx, { descripcion: "sala", total: 12000, meses: 12, fecha: "15 de noviembre" });
    expect([c.primerCargo, c.pagadas]).toEqual(["2026-11-15", 0]);
    expect(buscarMovimientos(ctx, { texto: "sala" }).encontrados).toBe(0);
    // Una compra de hace unos meses sí queda en el pasado.
    expect(registrarMsi(ctx, { descripcion: "laptop", total: 12000, meses: 12, fecha: "15 de agosto" }).primerCargo).toBe("2026-08-15");
  });

  test("un pago fijo que ya se pagó antes de su día no se cuenta dos veces", () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Quincena", tipo: "ingreso", monto: 10000, frecuencia: "quincenal", dia: 15 });
    crearRecurrente(ctx, { nombre: "Renta del departamento", tipo: "renta", monto: 6000, frecuencia: "mensual", dia: 20 });
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 25 });
    expect(disponible(ctx).comprometidoCentavos).toBe(621900);
    crearMovimiento({ ...ctx, textoOriginal: "pagué la renta, 6 mil" }, { tipo: "gasto", monto: 6000, descripcion: "Renta", fecha: "2026-10-05" });
    expect(disponible(ctx).comprometidoCentavos).toBe(21900);
    // La renta de septiembre no paga la de octubre.
    const { ctx: otro } = preparar();
    crearRecurrente(otro, { nombre: "Renta del departamento", tipo: "renta", monto: 6000, frecuencia: "mensual", dia: 20 });
    crearMovimiento(otro, { tipo: "gasto", monto: 6000, descripcion: "Renta", fecha: "2026-09-20" });
    expect(disponible(otro).comprometidoCentavos).toBe(600000);
    // Ni la de fin de mes, ni un cobro del mes pasado anotado un día tarde, ni algo del gym que no es la mensualidad.
    const { ctx: c3 } = preparar();
    const nov7 = otroDia(c3, "2026-11-07");
    crearRecurrente(nov7, { nombre: "Renta", tipo: "renta", monto: 6000, frecuencia: "mensual", dia: 31 });
    crearRecurrente(nov7, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 15 });
    crearRecurrente(nov7, { nombre: "Gym", tipo: "suscripcion", monto: 600, frecuencia: "mensual", dia: 20 });
    crearMovimiento(nov7, { tipo: "gasto", monto: 6000, descripcion: "Renta", fecha: "2026-10-31" });
    crearMovimiento(nov7, { tipo: "gasto", monto: 219, descripcion: "Netflix", fecha: "2026-10-16" });
    crearMovimiento(nov7, { tipo: "gasto", monto: 1500, descripcion: "Tenis para el gym", fecha: "2026-11-02" });
    expect(disponible(nov7).comprometidoCentavos).toBe(681900);
    // Quincenal del 10 y el 25: lo del 25 de febrero no paga el 10 de marzo.
    const { ctx: c4 } = preparar();
    const mar3 = otroDia(c4, "2027-03-03");
    crearRecurrente(mar3, { nombre: "Colegiatura", tipo: "otro", monto: 3000, frecuencia: "quincenal", dia: 10 });
    crearMovimiento(mar3, { tipo: "gasto", monto: 3000, descripcion: "Colegiatura", fecha: "2027-02-25" });
    expect(disponible(mar3).comprometidoCentavos).toBe(600000);
  });

  test("con presupuestos por categoría no dice que apartó pagos, y uno dentro de otro no cuenta doble", () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 25 });
    fijarPresupuesto(ctx, { categoria: "Comida", monto: 5000 });
    fijarPresupuesto(ctx, { categoria: "Restaurantes", monto: 2000 });
    gasto(ctx, 500, "Restaurantes", { fecha: "2026-10-02" });
    expect(estadoPresupuestos(ctx).total).toEqual({ limiteCentavos: 500000, gastadoCentavos: 50000 });
    const d = disponible(ctx);
    expect([d.base, d.comprometidoCentavos, d.libreMesCentavos]).toEqual(["presupuestos", 0, 450000]);
    expect(respuestaDisponible(ctx, d)).toBe("Hoy puedes gastar hasta $180 para cerrar bien el mes.");
  });

  test("el aviso de un cobro guarda el día exacto y se dice Mañana u Hoy al leerlo", () => {
    const { ctx } = preparar();
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 9 });
    revisar(ctx);
    const texto = (c: Contexto) => listarAvisos(c).avisos.find((a) => a.tipo === "cobro_proximo")?.texto;
    expect(texto(ctx)).toBe("El viernes 9 se cobra Netflix de $219.");
    expect(texto(otroDia(ctx, "2026-10-08"))).toBe("Mañana se cobra Netflix de $219.");
    expect(texto(otroDia(ctx, "2026-10-09"))).toBe("Hoy se cobra Netflix de $219.");
  });

  test("deshacer un abono no borra otro que llegó después", () => {
    const { ctx } = preparar();
    crearMeta(ctx, { nombre: "Viaje", objetivo: 10000 });
    registrarPrestamo(ctx, { persona: "Juan", direccion: "me_deben", monto: 1000 });
    const a = { ...ctx, entradaId: "a" };
    const b = { ...ctx, entradaId: "b" };
    aportarMeta(a, { nombre: "viaje", monto: 500 });
    abonarPrestamo(a, { persona: "Juan", monto: 1000 });
    aportarMeta(b, { nombre: "viaje", monto: 200 });
    revertirEntrada(ctx, "a");
    expect(listarMetas(ctx).metas[0]!.ahorradoCentavos).toBe(20000);
    const p = listarPrestamos(ctx).prestamos[0]!;
    expect([p.pagadoCentavos, p.saldadoEn]).toEqual([0, null]);
  });

  test('"la meta del viaje" no confunde palabras vacías con el nombre', () => {
    const { ctx } = preparar();
    crearMeta(ctx, { nombre: "Viaje", objetivo: 10000 });
    crearMeta(ctx, { nombre: "Fondo del hogar", objetivo: 10000 });
    expect(aportarMeta(ctx, { nombre: "meta del viaje", monto: 100 }).nombre).toBe("Viaje");
    expect(aportarMeta(ctx, { nombre: "la meta para el fondo del hogar", monto: 100 }).nombre).toBe("Fondo del hogar");
  });

  test("un recuerdo con dos cuentas toma la que no está negada", async () => {
    const { ctx } = preparar();
    crearMovimiento(ctx, { tipo: "gasto", monto: 1, cuenta: "Nu" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 1, cuenta: "BBVA" });
    recordar(ctx, "El Uber ya no lo pago con la BBVA, ahora con la Nu");
    const r = await llamar(dictado(ctx, "120 de Uber"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 120, comercio: "Uber", categoria: "Taxi y apps" }] });
    expect(r.registrados[0].cuenta).toBe("Nu");
    // Y una cuenta cuyo nombre contiene a otra no se confunde con la corta.
    ctx.db.insert(cuentas).values({ usuarioId: ctx.usuarioId, nombre: "BBVA Azul", tipo: "credito" }).run();
    recordar(ctx, "La gasolina la pago con la BBVA Azul");
    const g = await llamar(dictado(ctx, "mil de gasolina"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 1000, categoria: "Gasolina" }] });
    expect(g.registrados[0].cuenta).toBe("BBVA Azul");
  });

  test("la fecha límite se valida de verdad y una pasada se mueve al año que viene", () => {
    const { ctx } = preparar();
    expect(() => fechaLimiteDe(ctx, "2026-13-45")).toThrow(/no existe/);
    expect(() => fechaLimiteDe(ctx, "2027-02-30")).toThrow(/no existe/);
    expect(fechaLimiteDe(ctx, "2025-12-31")).toBe("2026-12-31");
    // Con el año dicho, o un AAAA-MM-DD de hace más de un año, ya pasó.
    expect(() => fechaLimiteDe(ctx, "2025-03-01")).toThrow(/ya pasó/);
    expect(() => fechaLimiteDe(ctx, "marzo de 2026")).toThrow(/ya pasó/);
    // Fin de febrero que cae en bisiesto.
    expect(fechaLimiteDe(otroDia(ctx, "2027-03-07"), "para febrero")).toBe("2028-02-29");
  });

  test('"mi último gasto" es el último gasto que anotó, no un ingreso ni uno con fecha más nueva', async () => {
    const { ctx } = preparar();
    gasto(ctx, 85, "Café");
    crearMovimiento({ ...ctx, entradaId: "previa2" }, { tipo: "gasto", monto: 20, moneda: "USD", categoria: "Taxi y apps", comercio: "Uber", fecha: "ayer" });
    crearMovimiento({ ...ctx, entradaId: "previa3" }, { tipo: "ingreso", monto: 500, categoria: "Otros ingresos" });
    const r = await llamar(dictado(ctx, "mi último gasto no fue en dólares, fue en pesos"), "editar_movimiento", {
      buscar: { mas_reciente: true },
      cambios: { moneda: "MXN" },
    });
    expect(r.error).toBeUndefined();
    const uber = buscarMovimientos(ctx, { texto: "Uber" }).movimientos[0]!;
    expect(uber.monto).toBe("$20");
  });

  test("deshacer una compra a meses quita las mensualidades del revisor; la última dice su monto exacto", () => {
    const { ctx } = preparar();
    const compra = { ...ctx, entradaId: "compra" };
    registrarMsi(compra, { descripcion: "pantalla", total: 1000, meses: 3 });
    const diciembre = otroDia(ctx, "2026-12-06");
    revisar(diciembre);
    expect(listarAvisos(diciembre).avisos.find((a) => a.tipo === "msi")?.texto).toBe("Mañana llega la mensualidad 3 de 3 de Pantalla: $333.34.");
    expect(buscarMovimientos(diciembre, { texto: "MSI", periodo: "2026-10-01..2026-12-31" }).encontrados).toBe(2);
    revertirEntrada(diciembre, "compra");
    expect(buscarMovimientos(diciembre, { texto: "MSI", periodo: "2026-10-01..2026-12-31" }).encontrados).toBe(0);
  });

  test('"a 6 meses con intereses" no es una compra a meses sin intereses', async () => {
    const { ctx } = preparar();
    const r = await llamar(dictado(ctx, "compré un celular de 6 mil a 6 meses con intereses"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 6000 }] });
    expect(r.registrados).toHaveLength(1);
  });
});
