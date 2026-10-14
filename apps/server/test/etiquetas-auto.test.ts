import { describe, expect, test } from "bun:test";
import { confirmarRegistro } from "../src/ai/confirmacion";
import { construirInstrucciones } from "../src/ai/instrucciones";
import { crearUsuario } from "../src/auth";
import { analizar } from "../src/finanzas/analisis";
import type { Contexto } from "../src/finanzas/contexto";
import { eliminarEtiqueta, resumenEtiquetas } from "../src/finanzas/etiquetas";
import { ciudadCercana, etiquetasAutoHabilitadas, viajesTerminados } from "../src/finanzas/etiquetas-auto";
import { aplicarPlan, deshacerEtiquetado, leerRespuesta, lineasParaIa, planDeViajes } from "../src/finanzas/etiquetas-historial";
import { buscarMovimientos, crearMovimiento, editarMovimiento } from "../src/finanzas/movimientos";
import { sumarDias } from "../src/lib/fechas";
import { AHORA, preparar } from "./ayuda";

const CDMX = { lat: 19.43, lon: -99.13, lugar: "Roma Norte" };
const CANCUN = { lat: 21.16, lon: -86.85, lugar: "Zona Hotelera" };
const TOLUCA = { lat: 19.28, lon: -99.65 };

let reloj = 0;
/** Un dictado nuevo, un minuto después, desde ese lugar y ese día. */
const en = (ctx: Contexto, ubicacion?: Contexto["ubicacion"], texto?: string, dias = 0): Contexto => {
  reloj += 1;
  const ahora = new Date(AHORA.getTime() + dias * 86_400_000 + reloj * 60_000);
  return { ...ctx, hoy: sumarDias(ctx.hoy, dias), ahoraIso: ahora.toISOString(), ubicacion, textoOriginal: texto, entradaId: `e-${reloj}` };
};
const gasto = (ctx: Contexto, monto: number, comercio: string, extra: Record<string, unknown> = {}) =>
  crearMovimiento(ctx, { tipo: "gasto", monto, comercio, ...extra });
/** Cinco gastos en casa para saber dónde vive. */
const enCasa = (ctx: Contexto) => [1, 2, 3, 4, 5].forEach((i) => gasto(en(ctx, CDMX), 100 + i, `Tienda ${i}`, { categoria: "Restaurantes" }));
const etiquetasDe = (ctx: Contexto, comercio: string) =>
  buscarMovimientos(ctx, { texto: comercio, periodo: "todo", limite: 20 }).movimientos.map((m) => m.etiquetas ?? []);

describe("etiquetas automáticas", () => {
  test("abiertas a todas las cuentas; dueno las deja a la cuenta dueña y 0 las apaga", () => {
    const { db, usuario } = preparar();
    const otra = crearUsuario(db, "Ana");
    expect(etiquetasAutoHabilitadas(db, otra.id, undefined)).toBe(true);
    expect(etiquetasAutoHabilitadas(db, otra.id, "dueno")).toBe(false);
    expect(etiquetasAutoHabilitadas(db, usuario.id, "dueno")).toBe(true);
    expect(etiquetasAutoHabilitadas(db, usuario.id, "0")).toBe(false);
  });

  test("un gasto lejos de casa lleva la etiqueta de su viaje; la confirmación la dice solo la primera vez", () => {
    const { ctx } = preparar();
    enCasa(ctx);
    const primero = gasto(en(ctx, CANCUN), 450, "Tacos", { categoria: "Antojos" });
    const segundo = gasto(en(ctx, CANCUN), 900, "Hotel", { categoria: "Viajes" });
    expect(primero.etiquetas).toEqual(["Viaje Cancún"]);
    expect(primero.viaje_nuevo).toBe("Viaje Cancún");
    expect(segundo.etiquetas).toEqual(["Viaje Cancún"]);
    expect(segundo.viaje_nuevo).toBeUndefined();
    expect(confirmarRegistro([primero], ctx.hoy)).toBe("Listo, Tacos de $450 en Antojos. Lo etiqueté como Viaje Cancún.");
    expect(confirmarRegistro([segundo], ctx.hoy)).toBe("Listo, Hotel de $900 en Viajes.");
    // Cerca de casa (Toluca está a 60 km) no es viaje, ni sin ubicación.
    expect(gasto(en(ctx, TOLUCA), 80, "Café").etiquetas).toBeUndefined();
    expect(gasto(en(ctx), 80, "Pan").etiquetas).toBeUndefined();
  });

  test("sin historia con ubicación no se sabe dónde vive, y con ETIQUETAS_AUTO=0 no se pone", () => {
    const { ctx } = preparar();
    expect(gasto(en(ctx, CANCUN), 450, "Tacos").etiquetas).toBeUndefined();
    enCasa(ctx);
    process.env.ETIQUETAS_AUTO = "0";
    try {
      expect(gasto(en(ctx, CANCUN), 450, "Tacos").etiquetas).toBeUndefined();
    } finally {
      delete process.env.ETIQUETAS_AUTO;
    }
  });

  test("un viaje meses después a la misma ciudad lleva el mes; si borró la del viaje, no vuelve", () => {
    const { ctx } = preparar();
    enCasa(ctx);
    gasto(en(ctx, CANCUN), 450, "Tacos");
    const despues = gasto(en(ctx, CANCUN, undefined, 60), 300, "Playa");
    expect(despues.etiquetas).toEqual(["Viaje Cancún diciembre 2026"]);
    eliminarEtiqueta(en(ctx, undefined, undefined, 60), { nombre: "Viaje Cancún diciembre 2026" });
    expect(gasto(en(ctx, CANCUN, undefined, 61), 200, "Helado").etiquetas).toBeUndefined();
  });

  test("al regresar, el revisor avisa cuánto costó el viaje", () => {
    const { ctx } = preparar();
    enCasa(ctx);
    gasto(en(ctx, CANCUN), 450, "Tacos");
    gasto(en(ctx, CANCUN), 900, "Hotel");
    expect(viajesTerminados({ ...ctx, hoy: sumarDias(ctx.hoy, 1) })).toEqual([]);
    const [aviso] = viajesTerminados({ ...ctx, hoy: sumarDias(ctx.hoy, 2) });
    expect(aviso).toMatchObject({ tipo: "viaje", titulo: "Tu viaje a Cancún", texto: "Gastaste $1,350 en 2 gastos, el 7 de octubre." });
    expect(viajesTerminados({ ...ctx, hoy: sumarDias(ctx.hoy, 20) })).toEqual([]);
  });

  test("aprende del comercio: la etiqueta que le puso a la última compra ahí, la siguiente la lleva sola", () => {
    const { ctx } = preparar();
    gasto(en(ctx), 500, "Office Depot", { etiquetas: ["Trabajo"] });
    expect(gasto(en(ctx), 200, "Office Depot").etiquetas).toEqual(["Trabajo"]);
    // Innecesario no se hereda: es de esa compra.
    gasto(en(ctx), 150, "Rappi", { etiquetas: ["Innecesario"] });
    expect(gasto(en(ctx), 180, "Rappi").etiquetas).toBeUndefined();
    // Si se la quita a la última, la que sigue ya no la lleva.
    const [ultima] = buscarMovimientos(ctx, { texto: "Office Depot", periodo: "todo", limite: 1 }).movimientos;
    editarMovimiento(en(ctx), ultima!.id, { quitarEtiquetas: ["Trabajo"] });
    expect(gasto(en(ctx), 90, "Office Depot").etiquetas).toBeUndefined();
  });

  test("si le quitó Innecesario a algo de un comercio, no se vuelve a poner solo ahí, salvo que él lo diga", () => {
    const { ctx } = preparar();
    const cafe = gasto(en(ctx), 60, "Starbucks", { etiquetas: ["Innecesario"] });
    editarMovimiento(en(ctx, undefined, "no fue innecesario"), cafe.id, { quitarEtiquetas: ["Innecesario"] });
    expect(gasto(en(ctx), 65, "Starbucks", { etiquetas: ["Innecesario"] }).etiquetas).toBeUndefined();
    expect(gasto(en(ctx, undefined, "este sí fue innecesario"), 70, "Starbucks", { etiquetas: ["Innecesario"] }).etiquetas).toEqual(["Innecesario"]);
    expect(gasto(en(ctx), 300, "Uber Eats", { etiquetas: ["Innecesario"] }).etiquetas).toEqual(["Innecesario"]);
  });

  test("la confirmación dice lo innecesario y las de contexto", () => {
    const { ctx } = preparar();
    const antojo = gasto(en(ctx), 120, "Oxxo", { etiquetas: ["Innecesario"], categoria: "Antojos" });
    const comida = gasto(en(ctx), 800, "La Docena", { etiquetas: ["Trabajo"], categoria: "Restaurantes" });
    expect(confirmarRegistro([antojo], ctx.hoy)).toBe("Listo, Oxxo de $120 en Antojos. Lo marqué como innecesario.");
    expect(confirmarRegistro([antojo, comida], ctx.hoy)).toBe(
      "Listo, Oxxo de $120 en Antojos y La Docena de $800 en Restaurantes. Los etiqueté como Trabajo. Marqué uno como innecesario.",
    );
  });

  test("lo marcado como innecesario sale en las ideas de ahorro", () => {
    const { ctx } = preparar();
    for (const [monto, comercio] of [[350, "Rappi"], [420, "Didi Food"], [380, "Uber Eats"]] as const) gasto(en(ctx), monto, comercio, { etiquetas: ["Innecesario"], categoria: "Delivery" });
    const r = analizar(ctx, { enfoque: "ahorrar" });
    expect(r.respuesta).toContain("Lo que marqué como innecesario te cuesta unos");
  });

  test("las instrucciones piden ponerlas solas solo si están abiertas", () => {
    const { ctx } = preparar();
    expect(construirInstrucciones(ctx)).toContain('"Innecesario" a un gasto solo si es claramente prescindible');
    process.env.ETIQUETAS_AUTO = "0";
    try {
      expect(construirInstrucciones(ctx)).toContain("Al registrar, pon etiquetas solo si las dice.");
    } finally {
      delete process.env.ETIQUETAS_AUTO;
    }
  });

  test("ciudadCercana nombra destinos conocidos y nada en medio del mar", () => {
    expect(ciudadCercana(CANCUN)).toBe("Cancún");
    expect(ciudadCercana({ lat: 20.63, lon: -87.07 })).toBe("Playa del Carmen");
    expect(ciudadCercana({ lat: 23, lon: -93 })).toBeUndefined();
  });
});

describe("etiquetar el historial", () => {
  test("viajes del historial por ubicación, la respuesta de la IA solo agrega lo permitido, y se deshace", () => {
    const { db, ctx } = preparar();
    process.env.ETIQUETAS_AUTO = "0";
    try {
      enCasa(ctx);
      gasto(en(ctx, CANCUN, "450 de tacos en la playa"), 450, "Tacos", { categoria: "Antojos" });
      gasto(en(ctx, undefined, "comida con los del trabajo"), 800, "La Docena", { categoria: "Restaurantes" });
      gasto(en(ctx, undefined, "pagué la renta"), 9000, "Casero", { categoria: "Renta" });
    } finally {
      delete process.env.ETIQUETAS_AUTO;
    }
    const viajes = planDeViajes(ctx);
    expect(viajes.map((a) => [a.etiqueta, a.quePaso])).toEqual([["Viaje Cancún", "Tacos de $450 del 2026-10-07"]]);

    const lineas = lineasParaIa(ctx);
    const n = (comercio: string) => lineas.findIndex((l) => l.linea.includes(comercio)) + 1;
    expect(lineas[n("La Docena") - 1]!.linea).toContain('dijo: "comida con los del trabajo"');
    // La IA marca la renta como innecesaria y pone el comercio como etiqueta: eso no pasa.
    const respuesta = `${n("Tacos")}: Innecesario\n${n("La Docena")}: Trabajo\n${n("Casero")}: Innecesario, Casero`;
    const ia = leerRespuesta(respuesta, lineas, (m) => m.id);
    expect(ia.map((a) => [a.etiqueta, a.motivo])).toEqual([
      ["Innecesario", "innecesario"],
      ["Trabajo", "contexto"],
    ]);

    // Una etiqueta que borró no se revive.
    crearMovimiento(en(ctx), { tipo: "gasto", monto: 1, comercio: "X", etiquetas: ["Trabajo"] });
    eliminarEtiqueta(ctx, { nombre: "Trabajo" });
    const r = aplicarPlan(ctx, [...viajes, ...ia], "prueba");
    expect(r).toEqual({ cambiados: 1, creadas: 2 });
    expect(etiquetasDe(ctx, "Tacos")).toEqual([["Viaje Cancún", "Innecesario"]]);
    expect(etiquetasDe(ctx, "La Docena")).toEqual([[]]);

    // Una edición después del etiquetado se queda al deshacer.
    const [tacos] = buscarMovimientos(ctx, { texto: "Tacos", periodo: "todo", limite: 1 }).movimientos;
    editarMovimiento(en(ctx), tacos!.id, { etiquetas: ["Playa"] });
    expect(deshacerEtiquetado(db, "prueba")).toBe(1);
    expect(etiquetasDe(ctx, "Tacos")).toEqual([["Playa"]]);
    expect(resumenEtiquetas(ctx).map((e) => e.nombre)).toEqual(["Playa"]);
  });
});
