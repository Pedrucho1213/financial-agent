import { describe, expect, test } from "bun:test";
import { hablar } from "../src/ai/asistente";
import { MockLanguageModelV4 } from "ai/test";
import { confirmacionDirecta } from "../src/ai/confirmacion";
import { etiquetaDelPeriodo, respuestaDeConsulta } from "../src/ai/consultas";
import { crearHerramientas } from "../src/ai/herramientas";
import { construirInstrucciones } from "../src/ai/instrucciones";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { analizar, proyeccionDelMes } from "../src/finanzas/analisis";
import { type Contexto, crearContexto } from "../src/finanzas/contexto";
import { crearMovimiento, eliminarMovimiento, resumir } from "../src/finanzas/movimientos";
import { fijarPresupuesto } from "../src/finanzas/planes";
import { crearRecurrente } from "../src/finanzas/recurrentes";
import { sumarDias } from "../src/lib/fechas";
import { AHORA, llamada, preparar, texto } from "./ayuda";

// Miércoles 7 de octubre de 2026 (ver ayuda.ts).

const previa = (ctx: Contexto): Contexto => ({ ...ctx, entradaId: "previa", textoOriginal: undefined });
const gasto = (ctx: Contexto, monto: number, categoria: string, fecha: string, extra: Record<string, unknown> = {}) =>
  crearMovimiento(previa(ctx), { tipo: "gasto", monto, categoria, fecha, ...extra });
const llamar = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const pregunta = (ctx: Contexto, frase: string): Contexto => ({ ...ctx, textoOriginal: frase, entradaId: crypto.randomUUID() });

/** Septiembre completo y la primera semana de octubre, con más restaurantes en octubre. */
function conMesPasado() {
  const p = preparar();
  const { ctx } = p;
  for (let dia = 1; dia <= 30; dia++) {
    const fecha = `2026-09-${String(dia).padStart(2, "0")}`;
    gasto(ctx, 100, "Café", fecha, { comercio: "Cielito" });
    if (dia % 7 === 0) gasto(ctx, 1400, "Súper", fecha, { comercio: "Walmart" });
    if (dia === 3) gasto(ctx, 300, "Restaurantes", fecha);
  }
  for (let dia = 1; dia <= 7; dia++) {
    const fecha = `2026-10-0${dia}`;
    gasto(ctx, 100, "Café", fecha, { comercio: "Cielito" });
    if (dia === 7) gasto(ctx, 1400, "Súper", fecha, { comercio: "Walmart" });
  }
  gasto(ctx, 900, "Restaurantes", "2026-10-02");
  gasto(ctx, 800, "Restaurantes", "2026-10-05");
  return p;
}

describe("análisis por voz", () => {
  test("sin gastos lo dice en vez de inventar", () => {
    const { ctx } = preparar();
    const a = analizar(ctx, { enfoque: "como_voy" });
    expect(a.respuesta).toStartWith("Todavía no tengo gastos tuyos");
    expect(a.hallazgos).toEqual([]);
  });

  test("con pocos gastos dice cuánto lleva y en qué, pero no proyecta", () => {
    const { ctx } = preparar();
    gasto(ctx, 12500, "Renta", "2026-10-01");
    gasto(ctx, 900, "Súper", "2026-10-03");
    gasto(ctx, 300, "Taxi y apps", "2026-10-06");
    const a = analizar(ctx, { enfoque: "como_voy" });
    expect(a.respuesta).toStartWith("Este mes llevas $13,700 en gastos.");
    expect(a.respuesta).toContain("Lo que más pesa es Vivienda");
    expect(a.proyeccion).toBeUndefined();
    const p = analizar(ctx, { enfoque: "proyeccion" });
    expect(p.respuesta).toBe("Este mes llevas $13,700 en gastos. Todavía no tengo suficientes gastos tuyos para calcular cómo cerrarías el mes.");
  });

  test("cómo voy: compara con el mes pasado a estas alturas y dice qué subió", () => {
    const { ctx } = conMesPasado();
    const a = analizar(ctx, { enfoque: "como_voy" });
    // Octubre del 1 al 7: 700 de café, 1,400 de súper y 1,700 de restaurantes = 3,800.
    // Septiembre del 1 al 7: 700 de café, 1,400 de súper y 300 de restaurantes = 2,400.
    expect(a.gastadoCentavos).toBe(380_000);
    expect(a.baseCentavos).toBe(240_000);
    expect(a.comparadoCon).toBe("el mes pasado a estas alturas");
    expect(a.respuesta).toStartWith("Este mes llevas $3,800 en gastos, un 58% más que el mes pasado a estas alturas ($2,400).");
    // Se dice la subcategoría: "Comida subió" no dice qué cambiar.
    expect(a.respuesta).toContain("Lo que más subió es Restaurantes: $1,700 contra $300.");
    expect(a.respuesta).toContain("Al ritmo que vas, cerrarías el mes en unos");
  });

  test("comparar dice lo que subió y lo que bajó", () => {
    const { ctx } = conMesPasado();
    gasto(ctx, 600, "Gasolina", "2026-09-02");
    const a = analizar(ctx, { enfoque: "comparar" });
    expect(a.respuesta).toContain("Lo que más subió es Restaurantes");
    expect(a.respuesta).toContain("Bajaste en Gasolina: $0 contra $600.");
  });

  test("sin mes pasado compara los últimos 7 días contra los 7 anteriores", () => {
    const { ctx } = preparar();
    // Empezó a registrar el 20 de septiembre.
    for (let n = 0; n <= 17; n++) gasto(ctx, n >= 11 ? 300 : 100, "Antojos", sumarDias("2026-09-20", n));
    const a = analizar(ctx, { enfoque: "como_voy" });
    expect(a.comparadoCon).toBe("los 7 días anteriores");
    expect(a.respuesta).toStartWith("En los últimos 7 días llevas $2,100 en gastos, un 200% más que los 7 días anteriores ($700).");
  });

  test("comparar sin historia lo dice", () => {
    const { ctx } = preparar();
    for (let dia = 1; dia <= 7; dia++) gasto(ctx, 200, "Café", `2026-10-0${dia}`);
    const a = analizar(ctx, { enfoque: "comparar" });
    expect(a.respuesta).toContain("Todavía no tengo con qué compararlo");
    expect(a.comparadoCon).toBeUndefined();
  });

  test("la semana: de lunes a hoy contra el mismo tramo de la semana pasada", () => {
    const { ctx } = conMesPasado();
    const a = analizar(ctx, { enfoque: "como_voy", periodo: "semana" });
    // Lunes 5 a miércoles 7: 300 de café, 1,400 de súper y 800 de restaurantes. Semana pasada (28 al 30): 300 de café + 1,400 del súper del 28.
    expect(a.respuesta).toStartWith("Esta semana llevas $2,500 en gastos, un 47% más que la semana pasada a estas alturas ($1,700).");
    expect(a.proyeccion).toBeUndefined();
  });

  test("proyección: gastado + ritmo variable por los días que faltan + fijos que faltan", () => {
    const { ctx } = preparar();
    for (let dia = 1; dia <= 7; dia++) gasto(ctx, 200, "Café", `2026-10-0${dia}`);
    // La renta ya se pagó (es fija: no marca el ritmo) y una laptop es de una vez.
    gasto(ctx, 8000, "Renta", "2026-10-01");
    gasto(ctx, 15000, "Electrónica", "2026-10-03");
    crearRecurrente(ctx, { nombre: "Quincena", tipo: "ingreso", monto: 15000, frecuencia: "quincenal", dia: 15 });
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 300, frecuencia: "mensual", dia: 20 });
    const p = proyeccionDelMes(ctx)!;
    expect(p.ritmoDiarioCentavos).toBe(20_000);
    expect(p.porPagarCentavos).toBe(30_000);
    expect(p.ingresosCentavos).toBe(3_000_000);
    // 24,400 gastado + 200 × 24 días + 300 de Netflix = 29,500.
    expect(p.cierreCentavos).toBe(2_950_000);
    const a = analizar(ctx, { enfoque: "proyeccion" });
    expect(a.respuesta).toBe(
      "Al ritmo que vas, cerrarías el mes en unos $29,500; con lo que te entra te sobrarían unos $500. Gastas unos $200 en un día normal y te faltan $300 de pagos fijos.",
    );
  });

  test("proyección: los pagos fijos que faltan cuentan aunque haya presupuestos por categoría", () => {
    const { ctx } = preparar();
    for (let dia = 1; dia <= 7; dia++) gasto(ctx, 100, "Café", `2026-10-0${dia}`);
    crearRecurrente(ctx, { nombre: "Renta", tipo: "renta", monto: 8000, frecuencia: "mensual", dia: 25 });
    const sin = proyeccionDelMes(ctx)!;
    fijarPresupuesto(ctx, { categoria: "Restaurantes", monto: 2000 });
    const con = proyeccionDelMes(ctx)!;
    expect(sin.porPagarCentavos).toBe(800_000);
    expect(con.porPagarCentavos).toBe(800_000);
    expect(con.cierreCentavos).toBe(sin.cierreCentavos);
  });

  test("proyección que no alcanza", () => {
    const { ctx } = preparar();
    for (let dia = 1; dia <= 7; dia++) gasto(ctx, 1000, "Restaurantes", `2026-10-0${dia}`);
    crearRecurrente(ctx, { nombre: "Quincena", tipo: "ingreso", monto: 10000, frecuencia: "quincenal", dia: 15 });
    const a = analizar(ctx, { enfoque: "proyeccion" });
    expect(a.respuesta).toStartWith("Al ritmo que vas, cerrarías el mes en unos $31,000: te faltarían unos $11,000 para lo que te entra.");
  });

  test("un presupuesto pasado se dice al preguntar cómo va", () => {
    const { ctx } = conMesPasado();
    fijarPresupuesto(ctx, { categoria: "Restaurantes", monto: 1000 });
    const a = analizar(ctx, { enfoque: "como_voy" });
    expect(a.respuesta).toContain("Ojo: ya te pasaste del presupuesto de Restaurantes por $700.");
  });

  test("ahorrar: gastos hormiga, recortables y suscripciones repetidas, del que más deja al que menos", () => {
    const { ctx } = preparar();
    for (let n = 0; n < 20; n += 2) gasto(ctx, 90, "Café", sumarDias("2026-10-07", -n), { comercio: "Starbucks" });
    gasto(ctx, 1200, "Restaurantes", "2026-10-01");
    gasto(ctx, 900, "Restaurantes", "2026-09-25");
    gasto(ctx, 2500, "Súper", "2026-09-28");
    crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 299, frecuencia: "mensual", dia: 20, categoria: "Streaming" });
    crearRecurrente(ctx, { nombre: "Disney", tipo: "suscripcion", monto: 159, frecuencia: "mensual", dia: 12, categoria: "Streaming" });
    const a = analizar(ctx, { enfoque: "ahorrar" });
    const tipos = a.hallazgos.filter((h) => h.ahorroMensualCentavos !== undefined).map((h) => [h.tipo, h.ahorroMensualCentavos]);
    // 900 de Starbucks en 19 días ≈ 1,421 al mes: la mitad ≈ 700. Restaurantes 2,100 → 3,316 al mes, un tercio ≈ 1,100.
    expect(tipos).toEqual([
      ["recortable", 110_000],
      ["hormiga", 70_000],
      ["suscripciones", 15_900],
    ]);
    expect(a.respuesta).toBe(
      "En Restaurantes se te van unos $3,300 al mes; bajarle un tercio te deja $1,100. En los últimos 30 días gastaste $900 en Starbucks, 10 veces. Al año serían unos $11,000.",
    );
    // El café ya salió como hormiga: no se repite como recortable, y el súper no es recortable.
    expect(a.hallazgos.some((h) => h.tipo === "recortable" && h.texto.includes("Café"))).toBe(false);
    expect(a.hallazgos.some((h) => h.ahorroMensualCentavos !== undefined && h.texto.includes("Súper"))).toBe(false);
  });

  test("ahorrar sin fugas lo dice", () => {
    const { ctx } = preparar();
    for (let dia = 1; dia <= 7; dia++) gasto(ctx, 1500, "Súper", `2026-10-0${dia}`);
    expect(analizar(ctx, { enfoque: "ahorrar" }).respuesta).toStartWith("No veo fugas claras");
  });

  test("solo cuenta gastos propios en la moneda base y sin borrar", () => {
    const { ctx, db } = conMesPasado();
    gasto(ctx, 500, "Café", "2026-10-06", { moneda: "USD" });
    const otro = crearUsuario(db, "Otra");
    sembrarCategorias(db, otro.id);
    gasto({ ...ctx, usuarioId: otro.id }, 99_999, "Café", "2026-10-06");
    const borrado = gasto(ctx, 7_777, "Café", "2026-10-06");
    eliminarMovimiento(ctx, borrado.id);
    expect(analizar(ctx, { enfoque: "como_voy" }).gastadoCentavos).toBe(380_000);
  });

  test("la herramienta devuelve la respuesta y la confirmación directa la dice sin otra vuelta", async () => {
    const { ctx } = conMesPasado();
    const resultado = await llamar(pregunta(ctx, "¿Cómo voy este mes?"), "analizar", { enfoque: "como_voy" });
    expect(resultado.respuesta).toStartWith("Este mes llevas $3,800");
    expect(confirmacionDirecta("¿Cómo voy este mes?", ctx.hoy, [{ herramienta: "analizar", resultado }])).toBe(resultado.respuesta);
    // Con una segunda parte, el modelo sigue.
    expect(confirmacionDirecta("¿Cómo voy y cuánto me queda?", ctx.hoy, [{ herramienta: "analizar", resultado }])).toBeUndefined();
  });

  test("las instrucciones mandan a analizar las preguntas de cómo va", () => {
    const { ctx } = preparar();
    expect(construirInstrucciones(ctx)).toContain("se responde con analizar");
  });
});

describe("consultas sin segunda vuelta", () => {
  test("cómo se dice cada periodo", () => {
    const hoy = "2026-10-07";
    const dicho = (p?: string) => etiquetaDelPeriodo(p, hoy)?.texto;
    expect(dicho(undefined)).toBe("Este mes");
    expect(dicho("hoy")).toBe("Hoy");
    expect(dicho("ayer")).toBe("Ayer");
    expect(dicho("esta_semana")).toBe("Esta semana");
    expect(dicho("semana pasada")).toBe("La semana pasada");
    expect(dicho("mes_pasado")).toBe("El mes pasado");
    expect(dicho("ultimos_30_dias")).toBe("En los últimos 30 días");
    expect(dicho("septiembre")).toBe("En septiembre");
    expect(dicho("2026-10")).toBe("Este mes");
    expect(dicho("noviembre")).toBe("En noviembre de 2025");
    expect(dicho("viernes")).toBe("El viernes");
    expect(dicho("2026-10-06")).toBe("Ayer");
    expect(dicho("2026-10-01")).toBe("El 1 de octubre");
    expect(dicho("2026-10-01..2026-10-05")).toBeUndefined();
  });

  function datos() {
    const p = preparar();
    gasto(p.ctx, 60, "Café", "2026-10-06", { comercio: "Starbucks" });
    gasto(p.ctx, 45, "Café", "2026-10-06", { comercio: "Oxxo" });
    gasto(p.ctx, 230, "Taxi y apps", "2026-10-06", { comercio: "Uber" });
    gasto(p.ctx, 1850, "Súper", "2026-10-07", { comercio: "Walmart" });
    crearMovimiento(previa(p.ctx), { tipo: "ingreso", monto: 12000, categoria: "Sueldo", fecha: "2026-10-01" });
    return p;
  }
  const decir = (ctx: Contexto, frase: string, args: Parameters<typeof respuestaDeConsulta>[1]) =>
    respuestaDeConsulta(pregunta(ctx, frase), args, resumir(ctx, { ...args, agruparPor: args.agrupar_por }));

  test("totales con el filtro que se usó", () => {
    const { ctx } = datos();
    expect(decir(ctx, "¿Cuánto gasté ayer en café?", { periodo: "ayer", categoria: "café" })).toBe("Ayer gastaste $105 en Café.");
    expect(decir(ctx, "¿Cuánto gasté en Uber ayer?", { periodo: "ayer", texto: "Uber" })).toBe("Ayer gastaste $230 en Uber.");
    expect(decir(ctx, "¿Cuánto llevo gastado este mes?", { periodo: "este_mes" })).toBe("Este mes llevas $2,185 en gastos.");
    expect(decir(ctx, "¿Cuánto llevo en comida?", { categoria: "Comida" })).toBe("Este mes llevas $1,955 en Comida.");
    expect(decir(ctx, "¿Cuánto me han pagado este mes?", { periodo: "este_mes", tipo: "ingreso" })).toBe("Este mes te han entrado $12,000.");
    expect(decir(ctx, "¿Cuánto gasté la semana pasada?", { periodo: "semana_pasada" })).toBe("La semana pasada no tienes gastos registrados.");
    expect(decir(ctx, "y en Uber?", { periodo: "este_mes", texto: "Uber" })).toBe("Este mes llevas $230 en Uber.");
  });

  test("agrupado: lo que más y lo que sigue", () => {
    const { ctx } = datos();
    expect(decir(ctx, "¿En qué categoría gasté más este mes?", { periodo: "este_mes", agrupar_por: "categoria" })).toBe(
      "Este mes gastaste más en Comida: $1,955 de $2,185. Le sigue Transporte con $230.",
    );
    expect(decir(ctx, "¿Cuál es la categoría donde más gasto?", { agrupar_por: "subcategoria" })).toBe(
      "Este mes gastaste más en Comida > Súper: $1,850 de $2,185. Le siguen Transporte > Taxi y apps con $230 y Comida > Café con $105.",
    );
  });

  test("lo que no es un total sencillo lo redacta el modelo", () => {
    const { ctx } = datos();
    const ninguna = [
      ["¿Cuánto gasté en café y en Uber?", { categoria: "café" }],
      ["¿Cuánto gasto en promedio al día?", {}],
      ["¿Cuántos cafés compré ayer?", { periodo: "ayer", categoria: "café" }],
      ["¿Gasté más que el mes pasado?", { periodo: "mes_pasado" }],
      ["¿Cuál fue mi último gasto?", {}],
      ["¿Cuánto me queda de presupuesto?", {}],
      ["¿Cuánto gasté por día la semana pasada?", { periodo: "semana_pasada", agrupar_por: "dia" }],
      ["Gasté 50 en café", {}],
      ["¿Cuánto gasté del 1 al 5?", { periodo: "2026-10-01..2026-10-05" }],
    ] as const;
    for (const [frase, args] of ninguna) expect([frase, decir(ctx, frase, args)]).toEqual([frase, undefined]);
  });

  test("con otras monedas o con la nota de pagos fijos, no se arma", async () => {
    const { ctx } = datos();
    gasto(ctx, 20, "Café", "2026-10-07", { moneda: "USD" });
    expect(decir(ctx, "¿Cuánto llevo este mes?", {})).toBeUndefined();
    const vacio = preparar().ctx;
    crearRecurrente(vacio, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 20 });
    const r = await llamar(pregunta(vacio, "¿Cuánto pago al mes?"), "consultar_gastos", { periodo: "este_mes" });
    expect(r.nota).toBeDefined();
    expect(r.respuesta).toBeUndefined();
  });

  test("con el modelo falso: la pregunta se contesta con una sola llamada", async () => {
    const { db, usuario, ctx } = datos();
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const modelo = new MockLanguageModelV4({
      doGenerate: [llamada("consultar_gastos", { periodo: "ayer", texto: "Uber" }), texto("No debería llegar aquí.")] as never,
    });
    const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const pedir = async (frase: string) => {
      const r = await app.request("/v1/hablar", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ texto: frase, client_id: crypto.randomUUID(), capturado_en: AHORA.toISOString() }),
      });
      return (await r.json()) as { respuesta: string };
    };
    expect((await pedir("¿Cuánto gasté en Uber ayer?")).respuesta).toBe("Ayer gastaste 230 pesos en Uber.");
    expect(modelo.doGenerateCalls.length).toBe(1);
    void ctx;
  });

  test("con el modelo falso: cómo voy se contesta con una sola llamada", async () => {
    const { db, usuario } = conMesPasado();
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const modelo = new MockLanguageModelV4({ doGenerate: [llamada("analizar", { enfoque: "ahorrar" }), texto("No debería llegar aquí.")] as never });
    const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const r = await app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ texto: "¿En qué puedo ahorrar?", client_id: crypto.randomUUID(), capturado_en: AHORA.toISOString() }),
    });
    const { respuesta } = (await r.json()) as { respuesta: string };
    expect(respuesta).toContain("Cielito");
    expect(modelo.doGenerateCalls.length).toBe(1);
  });
});

describe("la app ve el mismo análisis", () => {
  test("GET /v1/analisis con cada hallazgo aparte; valida el enfoque", async () => {
    const { db, usuario } = conMesPasado();
    const token = crearDispositivo(db, usuario.id, "iPhone");
    const app = crearApp({ db, modelo: new MockLanguageModelV4({ doGenerate: [] as never }), zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
    const pedir = (ruta: string) => app.request(ruta, { headers: { authorization: `Bearer ${token}` } });
    const r = await pedir("/v1/analisis");
    expect(r.status).toBe(200);
    const a = (await r.json()) as { enfoque: string; respuesta: string; hallazgos: { tipo: string; texto: string }[] };
    // La app usa la fecha de hoy: aquí solo importa la forma (las cifras se prueban arriba).
    expect(a.enfoque).toBe("como_voy");
    expect(typeof a.respuesta).toBe("string");
    expect(Array.isArray(a.hallazgos)).toBe(true);
    expect((await pedir("/v1/analisis?enfoque=ahorrar&periodo=semana")).status).toBe(200);
    expect((await pedir("/v1/analisis?enfoque=borrar")).status).toBe(400);
    expect((await app.request("/v1/analisis")).status).toBe(401);
  });
});

// Para que `crearContexto` no quede sin usar si cambian las pruebas.
void crearContexto;

describe('"¿cómo voy?" sin el modelo', () => {
  const montar = () => {
    const p = conMesPasado();
    const modelo = new MockLanguageModelV4({ doGenerate: async () => texto("<<el modelo>>") as never });
    const decir = (frase: string) =>
      hablar({ db: p.db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" }, p.usuario.id, {
        texto: frase,
        clientId: crypto.randomUUID(),
        capturadoEn: AHORA.toISOString(),
      });
    return { ...p, modelo, decir };
  };

  for (const [frase, periodo] of [
    ["¿Cómo voy?", "mes"],
    ["Oye, ¿cómo voy este mes?", "mes"],
    ["¿Cómo vamos esta semana?", "semana"],
    ["¿Y cómo van mis gastos?", "mes"],
  ] as const) {
    test(`"${frase}" lo contesta el análisis, sin llamar al modelo`, async () => {
      const { ctx, modelo, decir } = montar();
      const r = await decir(frase);
      expect(modelo.doGenerateCalls).toHaveLength(0);
      expect(r.acciones.map((a) => a.herramienta)).toEqual(["analizar"]);
      const esperada = analizar(ctx, { enfoque: "como_voy", periodo }).respuesta;
      expect([esperada, esperada.replace(/\$([\d,]+)/g, "$1 pesos")]).toContain(r.respuesta);
    });
  }

  for (const frase of ["¿Cómo voy con mi presupuesto de comida?", "¿Cómo voy a cerrar el mes?", "¿Cómo voy con la meta del viaje?", "¿Cómo estás?"]) {
    test(`"${frase}" sí va al modelo`, async () => {
      const { modelo, decir } = montar();
      await decir(frase);
      expect(modelo.doGenerateCalls.length).toBeGreaterThan(0);
    });
  }
});
