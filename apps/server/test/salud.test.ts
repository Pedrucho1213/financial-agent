import { afterEach, describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { hablar } from "../src/ai/asistente";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import type { Db } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import type { Contexto } from "../src/finanzas/contexto";
import { fijarCuenta } from "../src/finanzas/cuentas";
import { crearMovimiento } from "../src/finanzas/movimientos";
import { aportarMeta, crearMeta, registrarPrestamo } from "../src/finanzas/planes";
import { crearRecurrente } from "../src/finanzas/recurrentes";
import { decilDeIngreso, DECILES_HOGAR_CENTAVOS } from "../src/finanzas/referencias-mx";
import { interpolar, nivelDe, saludFinanciera, saludHabilitada, saludSinModelo } from "../src/finanzas/salud";
import { sumarDias } from "../src/lib/fechas";
import { preparar, texto } from "./ayuda";

// Martes 14 de octubre de 2026, 10:00 en Ciudad de México.
const HOY = new Date("2026-10-14T16:00:00Z");

const previa = (ctx: Contexto): Contexto => ({ ...ctx, entradaId: crypto.randomUUID(), textoOriginal: undefined });
const gasto = (ctx: Contexto, monto: number, categoria: string, fecha: string) => crearMovimiento(previa(ctx), { tipo: "gasto", monto, categoria, fecha });
const ingreso = (ctx: Contexto, monto: number, fecha: string, moneda?: string) =>
  crearMovimiento(previa(ctx), { tipo: "ingreso", monto, categoria: "Sueldo", fecha, ...(moneda ? { moneda } : {}) });

/** Todas las filas de todas las tablas: para comprobar que la salud financiera no cambia nada. */
function foto(db: Db): string {
  const sqlite = db.$client;
  const tablas = sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  return JSON.stringify(tablas.map(({ name }) => [name, sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

/**
 * Como la base de Pedro el 14-oct: 15 gastos del 7 al 12 de octubre, ningún ingreso, Revolut débito con
 * $18,791 y cuatro tarjetas (dos casi al tope), $32,733 que le debe a su mamá y $1,837 de pagos fijos.
 */
function comoPedro() {
  const p = preparar({ ahora: HOY });
  const { ctx } = p;
  fijarCuenta(ctx, { cuenta: "Revolut", tipo: "debito", saldo: 18_791 });
  fijarCuenta(ctx, { cuenta: "Efectivo", tipo: "efectivo" });
  fijarCuenta(ctx, { cuenta: "Invex", tipo: "credito", limite: 57_400, deuda: 19_818.88 });
  fijarCuenta(ctx, { cuenta: "Nu", tipo: "credito", limite: 33_600, deuda: 24_737.81 });
  fijarCuenta(ctx, { cuenta: "Mercado Pago Credito", tipo: "credito", limite: 33_200, deuda: 29_593 });
  fijarCuenta(ctx, { cuenta: "Revolut crédito", tipo: "credito", limite: 34_000, deuda: 30_948.87 });
  registrarPrestamo(previa(ctx), { persona: "mamá", direccion: "debo", monto: 32_733 });
  crearRecurrente(previa(ctx), { nombre: "Spotify", tipo: "suscripcion", monto: 139, frecuencia: "mensual", dia: 5 });
  crearRecurrente(previa(ctx), { nombre: "Internet", tipo: "servicio", monto: 1_698, frecuencia: "mensual", dia: 20 });
  const gastos: [number, string, string][] = [
    [300, "Súper", "2026-10-07"],
    [250, "Súper", "2026-10-08"],
    [247, "Súper", "2026-10-09"],
    [200, "Súper", "2026-10-10"],
    [250, "Súper", "2026-10-12"],
    [450, "Restaurantes", "2026-10-07"],
    [400.9, "Restaurantes", "2026-10-09"],
    [375, "Restaurantes", "2026-10-11"],
    [55, "Antojos", "2026-10-08"],
    [50, "Antojos", "2026-10-10"],
    [900, "Gasolina", "2026-10-08"],
    [561.52, "Taxi y apps", "2026-10-11"],
    [500, "Farmacia", "2026-10-09"],
    [238, "Médico", "2026-10-12"],
    [139, "Streaming", "2026-10-07"],
  ];
  for (const [monto, categoria, fecha] of gastos) gasto(ctx, monto, categoria, fecha);
  return p;
}

/** Tres meses completos con sueldo de $50,000, gastos de $30,000 al mes y $200,000 en el banco, sin deudas. */
function sano() {
  const p = preparar({ ahora: HOY });
  const { ctx } = p;
  fijarCuenta(ctx, { cuenta: "BBVA", tipo: "debito", saldo: 200_000 });
  for (const mes of ["2026-07", "2026-08", "2026-09"]) {
    ingreso(ctx, 25_000, `${mes}-01`);
    ingreso(ctx, 25_000, `${mes}-15`);
    gasto(ctx, 12_000, "Renta", `${mes}-02`);
    for (const dia of ["05", "12", "19", "26"]) gasto(ctx, 3_000, "Súper", `${mes}-${dia}`);
    gasto(ctx, 4_000, "Gasolina", `${mes}-10`);
    gasto(ctx, 2_000, "Restaurantes", `${mes}-20`);
  }
  // Lo que va de octubre, al mismo ritmo.
  ingreso(ctx, 25_000, "2026-10-01");
  gasto(ctx, 12_000, "Renta", "2026-10-02");
  gasto(ctx, 3_000, "Súper", "2026-10-05");
  gasto(ctx, 3_000, "Súper", "2026-10-12");
  return p;
}

afterEach(() => {
  delete process.env.SALUD_FINANCIERA;
});

describe("piezas", () => {
  test("interpolar: lineal entre puntos y topado en los extremos", () => {
    const tramos: [number, number][] = [[0, 0], [1, 50], [3, 100]];
    expect(interpolar(-5, tramos)).toBe(0);
    expect(interpolar(0.5, tramos)).toBe(25);
    expect(interpolar(2, tramos)).toBe(75);
    expect(interpolar(9, tramos)).toBe(100);
  });

  test("niveles por calificación", () => {
    expect([0, 24, 25, 44, 45, 64, 65, 84, 85, 100].map(nivelDe)).toEqual([
      "sobregirado", "sobregirado", "en_riesgo", "en_riesgo", "vamos_bien", "vamos_bien", "excelente", "excelente", "optimizando", "optimizando",
    ]);
  });

  test("decil de ingreso: el corte va a la mitad entre promedios", () => {
    expect(decilDeIngreso(0).decil).toBe(1);
    expect(decilDeIngreso(DECILES_HOGAR_CENTAVOS[4]).romano).toBe("V");
    expect(decilDeIngreso(25_000_00).decil).toBe(6);
    expect(decilDeIngreso(40_000_00).decil).toBe(9);
    expect(decilDeIngreso(101_000_00)).toEqual({ decil: 10, romano: "X" });
  });
});

describe("salud financiera", () => {
  test("sin datos: no califica ni inventa, y dice qué falta", () => {
    const { ctx } = preparar({ ahora: HOY });
    const s = saludFinanciera(ctx);
    expect(s.nivel).toBeNull();
    expect(s.puntaje).toBeNull();
    expect(s.titulo).toBe("Aún no sé");
    expect(s.pilares.every((p) => p.puntos === null)).toBe(false); // sin tarjetas ni deudas, la deuda sí se sabe: 100
    expect(s.pilares.find((p) => p.clave === "deuda")!.puntos).toBe(100);
    expect(s.faltan.join(" ")).toContain("No tengo ingresos tuyos");
    expect(s.faltan.join(" ")).toContain("días de gastos");
    expect(s.mexico).toEqual([]);
    expect(s.rubros).toEqual([]);
  });

  test("como la base de Pedro: Sobregirado por las tarjetas al tope, sin calificación porque falta el ingreso", () => {
    const { ctx } = comoPedro();
    const s = saludFinanciera(ctx);
    expect(s.nivel).toBe("sobregirado");
    expect(s.puntaje).toBeNull();
    expect(s.titulo).toBe("Sobregirado");
    // Mercado Pago va al 89%: cerca, pero la regla roja es desde 90%.
    expect(s.alertas).toEqual(["Revolut crédito va al 91% de su límite."]);
    expect(s.resumen).toBe("Por esto: Revolut crédito va al 91% de su límite.");
    expect(s.base).toMatchObject({ desde: "2026-10-07", dias: 8, pocosDatos: true });
    expect(s.ingresos).toEqual({ esteMesCentavos: 0, mensualCentavos: null, enOtraMoneda: false });
    // Pilares que necesitan el ingreso: sin calificar.
    const pilar = (clave: string) => s.pilares.find((p) => p.clave === clave)!;
    expect(pilar("margen").puntos).toBeNull();
    expect(pilar("gustos").puntos).toBeNull();
    expect(pilar("compromisos").puntos).toBeNull();
    expect(pilar("compromisos").valor).toBe("$1,837");
    // Lo que sí se sabe: el colchón y el uso de las tarjetas (66%).
    expect(pilar("colchon").puntos).not.toBeNull();
    expect(pilar("deuda").valor).toBe("66% de uso");
    expect(pilar("deuda").consejo).toBe("Baja Revolut crédito de 91% a menos de 70%: son $7,150.");
    // Lo que baja Revolut crédito (la que está al tope) a menos de 70%: 30,948.87 − 23,800 = 7,148.87.
    expect(s.consejos[0]!.texto).toStartWith("Abónale unos $7,150 a Revolut crédito para bajarla a menos de 70%");
    expect(s.consejos.at(-1)!.texto).toContain("me pagaron tantos pesos");
    // Si dejara de ganar: 18,791 / 4,884 = 3.8 meses de lo básico.
    const sinIngreso = s.mexico.find((c) => c.clave === "sin_ingreso")!;
    expect(sinIngreso.tu).toBe("3.8 meses");
    // Comer fuera: 1,330.90 en 8 días, unos $5,060 al mes.
    const fuera = s.mexico.find((c) => c.clave === "comer_fuera")!;
    expect(fuera.frase).toStartWith("A tu ritmo de estos 8 días, comer fuera te cuesta unos $5,060 al mes");
    expect(s.mexico.map((c) => c.clave)).not.toContain("ingreso");
    expect(s.faltan[0]).toContain("No tengo ingresos tuyos");
    // En qué se le va, contra México: la comida es la mayor parte.
    expect(s.rubros.find((r) => r.clave === "alimentos")!.tuProporcion).toBeCloseTo(2577.9 / 4916.42, 3);
    expect(s.rubros.reduce((t, r) => t + r.tuProporcion, 0)).toBeCloseTo(1, 6);
  });

  test("las dos tarjetas al 90% o más salen como alertas", () => {
    const { ctx } = comoPedro();
    fijarCuenta(ctx, { cuenta: "Mercado Pago Credito", deuda: 30_000 });
    const s = saludFinanciera(ctx);
    expect(s.alertas).toHaveLength(2);
    expect(s.alertas[1]).toMatch(/^Mercado Pago( Credito)? va al 90% de su límite\.$/);
    expect(s.resumen).toBe("Por esto: Revolut crédito va al 91% de su límite (y 1 más).");
    expect(s.consejos[0]!.texto).toMatch(/a Revolut crédito y Mercado Pago( Credito)? para bajarlas/);
  });

  test("con el sueldo dictado ya califica y lo compara con México", () => {
    const { ctx } = comoPedro();
    ingreso(ctx, 56_420, "2026-10-13");
    ingreso(ctx, 44_590, "2026-10-13");
    const s = saludFinanciera(ctx);
    // Con menos de un mes de datos, lo cobrado es el ingreso del mes.
    expect(s.ingresos).toMatchObject({ esteMesCentavos: 101_010_00, mensualCentavos: 101_010_00 });
    expect(s.puntaje).not.toBeNull();
    expect(s.nivel).toBe("sobregirado"); // la regla roja manda
    expect(s.pilares.every((p) => p.puntos !== null)).toBe(true);
    const ingresoMx = s.mexico.find((c) => c.clave === "ingreso")!;
    expect(ingresoMx.decil).toBe(10);
    expect(ingresoMx.frase).toBe("Estás en el decil X de los hogares de México: ganas más que alrededor del 90%.");
    expect(s.mexico.find((c) => c.clave === "pobreza")!.tu).toBe("21 veces");
    expect(s.mexico.find((c) => c.clave === "perceptor")!.tu).toBe("9.4 veces");
    expect(s.faltan).toEqual([]);
  });

  test("al bajar las tarjetas sale de Sobregirado y el nivel lo da la calificación", () => {
    const { ctx } = comoPedro();
    ingreso(ctx, 101_010, "2026-10-13");
    fijarCuenta(ctx, { cuenta: "Revolut crédito", deuda: 20_000 });
    fijarCuenta(ctx, { cuenta: "Mercado Pago Credito", deuda: 20_000 });
    const s = saludFinanciera(ctx);
    expect(s.alertas).toEqual([]);
    expect(s.nivel).not.toBe("sobregirado");
    expect(s.nivel).toBe(nivelDe(s.puntaje!));
  });

  test("finanzas sanas sin metas: Excelente (Optimizando pide metas con ahorro)", () => {
    const { ctx } = sano();
    const s = saludFinanciera(ctx);
    expect(s.alertas).toEqual([]);
    expect(s.puntaje).toBe(84);
    expect(s.nivel).toBe("excelente");
    expect(s.pilares.find((p) => p.clave === "margen")!.puntos).toBe(100);
    expect(s.pilares.find((p) => p.clave === "deuda")!.valor).toBe("Sin deuda");
    expect(s.mexico.find((c) => c.clave === "colchon")!.tu).toBe("Sí la pagas");
  });

  test("finanzas sanas con una meta con ahorro: Optimizando", () => {
    const { ctx } = sano();
    crearMeta(previa(ctx), { nombre: "Viaje", objetivo: 60_000 });
    aportarMeta(previa(ctx), { nombre: "Viaje", monto: 10_000 });
    const s = saludFinanciera(ctx);
    expect(s.puntaje).toBeGreaterThanOrEqual(85);
    expect(s.nivel).toBe("optimizando");
  });

  test("dos meses completos gastando más de lo que entra: Sobregirado", () => {
    const { ctx } = preparar({ ahora: HOY });
    fijarCuenta(ctx, { cuenta: "BBVA", tipo: "debito", saldo: 5_000 });
    for (const mes of ["2026-08", "2026-09"]) {
      ingreso(ctx, 20_000, `${mes}-01`);
      gasto(ctx, 24_000, "Renta", `${mes}-03`);
    }
    gasto(ctx, 500, "Súper", "2026-10-02");
    const s = saludFinanciera(ctx);
    expect(s.alertas).toContain("Llevas dos meses gastando más de lo que te entra.");
    expect(s.nivel).toBe("sobregirado");
  });

  test("un mes malo con datos de un solo mes no basta para la alerta de dos meses", () => {
    const { ctx } = preparar({ ahora: HOY });
    ingreso(ctx, 20_000, "2026-09-10");
    gasto(ctx, 24_000, "Renta", "2026-09-12");
    expect(saludFinanciera(ctx).alertas).not.toContain("Llevas dos meses gastando más de lo que te entra.");
  });

  test("ingresos en dólares: no se convierten y se pide decirlos en pesos", () => {
    const { ctx } = comoPedro();
    ingreso(ctx, 3_100, "2026-10-13", "USD");
    const s = saludFinanciera(ctx);
    expect(s.ingresos).toMatchObject({ mensualCentavos: null, enOtraMoneda: true });
    expect(s.faltan[0]).toContain("dímelos en pesos");
    expect(s.puntaje).toBeNull();
  });

  test("con más de un mes de datos, el ingreso se promedia por mes", () => {
    const { ctx } = preparar({ ahora: HOY });
    // Del 14 de agosto al 14 de octubre: 62 días, dos sueldos de 30,000.
    gasto(ctx, 100, "Súper", "2026-08-14");
    ingreso(ctx, 30_000, "2026-09-01");
    ingreso(ctx, 30_000, "2026-10-01");
    const s = saludFinanciera(ctx);
    expect(s.base.dias).toBe(62);
    expect(s.ingresos.mensualCentavos).toBe(Math.round(60_000_00 / (62 / 30.4)));
  });

  test("solo mira los últimos 90 días", () => {
    const { ctx } = preparar({ ahora: HOY });
    ingreso(ctx, 999_999, sumarDias("2026-10-14", -120));
    gasto(ctx, 100, "Súper", "2026-10-01");
    expect(saludFinanciera(ctx).ingresos.mensualCentavos).toBeNull();
  });

  test("solo lee: no cambia ni una fila de la base", () => {
    for (const armar of [comoPedro, sano]) {
      const { db, ctx } = armar();
      ingreso(ctx, 1_000, "2026-10-13");
      const antes = foto(db);
      saludFinanciera(ctx);
      saludSinModelo(ctx, "¿Cómo está mi salud financiera?");
      saludSinModelo(ctx, "¿Cómo estoy comparado con los mexicanos?");
      expect(foto(db)).toBe(antes);
    }
  });
});

describe("solo para la cuenta dueña mientras se prueba", () => {
  test("la cuenta que se creó primero sí; otra no; SALUD_FINANCIERA lo abre o lo apaga", () => {
    const { db, usuario } = preparar({ ahora: HOY });
    const otra = crearUsuario(db, "Ana");
    expect(saludHabilitada(db, usuario.id)).toBe(true);
    expect(saludHabilitada(db, otra.id)).toBe(false);
    expect(saludHabilitada(db, otra.id, "todos")).toBe(true);
    expect(saludHabilitada(db, usuario.id, "0")).toBe(false);
    expect(saludHabilitada(db, usuario.id, "")).toBe(true);
  });

  test("GET /v1/salud-financiera: la dueña la ve, otra cuenta recibe 404, y no escribe nada", async () => {
    const { db, usuario, ctx } = comoPedro();
    const otra = crearUsuario(db, "Ana");
    sembrarCategorias(db, otra.id);
    const modelo = new MockLanguageModelV4({ doGenerate: async () => texto("nada") as never });
    const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const pedir = (token: string) => app.request("/v1/salud-financiera", { headers: { authorization: `Bearer ${token}` } });
    const tokenPedro = crearDispositivo(db, usuario.id, "iPhone");
    const tokenAna = crearDispositivo(db, otra.id, "iPhone");
    const antes = foto(db);
    const r = await pedir(tokenPedro);
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as Record<string, unknown>;
    expect(cuerpo).toMatchObject({ nivel: "sobregirado", titulo: "Sobregirado", puntaje: null });
    expect((await pedir(tokenAna)).status).toBe(404);
    process.env.SALUD_FINANCIERA = "0";
    expect((await pedir(tokenPedro)).status).toBe(404);
    // Pedir con el token actualiza su "último uso": eso no es de la salud financiera. Lo demás, igual.
    const sinUso = (s: string) => s.replace(/"ultimo_uso":(null|"[^"]*")/g, "");
    expect(sinUso(foto(db))).toBe(sinUso(antes));
    void ctx;
  });
});

describe("por voz, sin modelo", () => {
  const montar = (armar = comoPedro) => {
    const p = armar();
    const modelo = new MockLanguageModelV4({ doGenerate: async () => texto("<<el modelo>>") as never });
    const decir = (frase: string, usuarioId = p.usuario.id) =>
      hablar({ db: p.db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" }, usuarioId, {
        texto: frase,
        clientId: crypto.randomUUID(),
        capturadoEn: HOY.toISOString(),
      });
    return { ...p, modelo, decir };
  };

  for (const frase of ["¿Cómo está mi salud financiera?", "Oye, ¿cómo va mi salud financiera?", "¿Cuál es mi salud financiera?", "Cómo ando de salud financiera"]) {
    test(`"${frase}" lo contesta el servidor`, async () => {
      const { modelo, decir } = montar();
      const r = await decir(frase);
      expect(modelo.doGenerateCalls).toHaveLength(0);
      expect(r.acciones.map((a) => a.herramienta)).toEqual(["analizar"]);
      expect(r.respuesta).toStartWith("Sobregirado. Por esto: Revolut crédito va al 91% de su límite.");
    });
  }

  for (const frase of ["¿Cómo estoy comparado con los mexicanos?", "¿Cómo estoy frente a México?", "¿En qué lugar estoy comparado con la gente?"]) {
    test(`"${frase}" compara con México sin el modelo`, async () => {
      const { modelo, decir } = montar();
      const r = await decir(frase);
      expect(modelo.doGenerateCalls).toHaveLength(0);
      expect(r.respuesta).toStartWith("Para compararte con México necesito tus ingresos");
      expect(r.respuesta).toContain("comer fuera te cuesta");
    });
  }

  test("con ingresos, la comparación dice el decil y la pobreza", async () => {
    const { ctx, decir } = montar();
    ingreso(ctx, 101_010, "2026-10-13");
    const r = await decir("¿Cómo estoy comparado con los mexicanos?");
    expect(r.respuesta).toStartWith("Estás en el decil X de los hogares de México");
    expect(r.respuesta).toContain("veces arriba de la línea de pobreza");
  });

  test("a otra cuenta no le cambia nada: va al modelo como antes", async () => {
    const { db, modelo, decir } = montar();
    const otra = crearUsuario(db, "Ana");
    sembrarCategorias(db, otra.id);
    const r = await decir("¿Cómo está mi salud financiera?", otra.id);
    expect(modelo.doGenerateCalls.length).toBeGreaterThan(0);
    expect(r.respuesta).toContain("el modelo");
  });

  for (const frase of ["Gasté 200 en salud", "¿Cuánto gasté en salud este mes?", "¿Cómo voy?", "Pagué la consulta de salud financiera 500"]) {
    test(`"${frase}" no la toma la salud financiera`, () => {
      const { ctx } = comoPedro();
      expect(saludSinModelo(ctx, frase)).toBeUndefined();
    });
  }
});
