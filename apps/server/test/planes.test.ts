import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearHerramientas } from "../src/ai/herramientas";
import { construirInstrucciones } from "../src/ai/instrucciones";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { entradas } from "../src/db/schema";
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
