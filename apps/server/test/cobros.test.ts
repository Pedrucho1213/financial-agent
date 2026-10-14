import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { MockLanguageModelV4 } from "ai/test";
import { crearHerramientas } from "../src/ai/herramientas";
import { crearApp } from "../src/app";
import { crearDispositivo, crearUsuario } from "../src/auth";
import type { Db } from "../src/db/client";
import { avisos, cobros, dispositivos, movimientos, recurrentes } from "../src/db/schema";
import {
  cobrosApp,
  cobrosHabilitado,
  confirmarCobro,
  deshacerCobro,
  posponerCobro,
  saltarCobro,
  sincronizarCobros,
} from "../src/finanzas/cobros";
import { type Contexto, crearContexto } from "../src/finanzas/contexto";
import { crearMovimiento, eliminarMovimiento } from "../src/finanzas/movimientos";
import { porPagarEsteMes } from "../src/finanzas/planes";
import { crearRecurrente } from "../src/finanzas/recurrentes";
import { fechaLocal } from "../src/lib/fechas";
import { enviarAvisosDelDia } from "../src/push/avisos-manana";
import { enviarPreguntasDeCobros } from "../src/push/cobros";
import { type EnviarPush, suscribir } from "../src/push/notificaciones";
import { guardarPreferencias } from "../src/push/preferencias";
import { AHORA, llamada, preparar, texto } from "./ayuda";

const ZONA = "America/Mexico_City";
const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMtsHJWSeD1h4ztT4fjpQ";
const LLAVES = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

// Estas pruebas prenden la confirmación de cobros como la tiene la cuenta dueña.
let antes: string | undefined;
beforeEach(() => {
  antes = process.env.CONFIRMAR_COBROS;
  process.env.CONFIRMAR_COBROS = "dueno";
});
afterEach(() => {
  process.env.CONFIRMAR_COBROS = antes;
});

/** El mismo usuario otro día (10:00 en Ciudad de México). */
const elDia = (ctx: Contexto, fecha: string, hora = "16:00"): Contexto =>
  crearContexto({ db: ctx.db, usuarioId: ctx.usuarioId, zonaHoraria: ZONA, monedaBase: "MXN", ahora: new Date(`${fecha}T${hora}:00Z`) });

/** Un pago fijo dado de alta hace tiempo (los cobros no se crean de antes de que existiera). */
function fijo(ctx: Contexto, nombre: string, monto: number, dia: number, extra: { cuenta?: string; tipo?: "suscripcion" | "renta" } = {}) {
  const r = crearRecurrente(ctx, { nombre, tipo: extra.tipo ?? "suscripcion", monto, frecuencia: "mensual", dia, cuenta: extra.cuenta });
  ctx.db.update(recurrentes).set({ creadoEn: "2026-08-01T12:00:00.000Z" }).where(eq(recurrentes.id, r.id)).run();
  return r;
}

const herramienta = (ctx: Contexto, nombre: string, args: unknown) =>
  ((crearHerramientas(ctx, []) as Record<string, { execute?: unknown }>)[nombre]!.execute as (a: unknown, o: unknown) => Promise<any>)(args, {});
const dictado = (ctx: Contexto, frase: string): Contexto => ({ ...ctx, textoOriginal: frase, entradaId: crypto.randomUUID() });
const gastos = (db: Db) => db.select().from(movimientos).all().filter((m) => !m.eliminadoEn);

describe("interruptor", () => {
  test("abierta a todas las cuentas, salvo que se regrese a la dueña o se apague", () => {
    const { db, usuario } = preparar();
    const otra = crearUsuario(db, "Ana");
    expect(cobrosHabilitado(db, usuario.id, "")).toBe(true);
    expect(cobrosHabilitado(db, otra.id, "")).toBe(true);
    expect(cobrosHabilitado(db, otra.id, "1")).toBe(true);
    expect(cobrosHabilitado(db, usuario.id, "dueno")).toBe(true);
    expect(cobrosHabilitado(db, otra.id, "dueno")).toBe(false);
    expect(cobrosHabilitado(db, usuario.id, "0")).toBe(false);
  });

  test("apagada no crea cobros ni cambia nada", () => {
    process.env.CONFIRMAR_COBROS = "0";
    const { ctx, db } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    sincronizarCobros(ctx);
    expect(db.select().from(cobros).all()).toEqual([]);
  });
});

describe("cobros pendientes", () => {
  test("llegada su fecha queda pendiente; no de antes de prenderlo ni de antes de existir", () => {
    const { ctx, db } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    fijo(ctx, "Spotify", 129, 5); // ya pasó cuando se prendió: no se pregunta
    fijo(ctx, "Renta", 7000, 10, { tipo: "renta" }); // todavía no llega
    const r = cobrosApp(ctx);
    expect(r.porConfirmar.map((c) => [c.nombre, c.fecha, c.montoCentavos])).toEqual([["Netflix", "2026-10-07", 21900]]);
    expect(r.insignia).toBe(1);
    // El 10 llega la renta; Netflix sigue esperando.
    const dia10 = elDia(ctx, "2026-10-10");
    expect(cobrosApp(dia10).porConfirmar.map((c) => c.nombre)).toEqual(["Netflix", "Renta"]);
    // Uno nuevo que se cobra hoy pero se creó hoy sí cuenta; uno de un día que ya pasó, no.
    crearRecurrente(dia10, { nombre: "Gym", tipo: "servicio", monto: 500, frecuencia: "mensual", dia: 10 });
    crearRecurrente(dia10, { nombre: "Disney", tipo: "suscripcion", monto: 159, frecuencia: "mensual", dia: 9 });
    db.update(recurrentes).set({ creadoEn: "2026-10-10T15:00:00.000Z" }).where(eq(recurrentes.nombre, "Gym")).run();
    db.update(recurrentes).set({ creadoEn: "2026-10-10T15:00:00.000Z" }).where(eq(recurrentes.nombre, "Disney")).run();
    expect(cobrosApp(dia10).porConfirmar.map((c) => c.nombre)).toEqual(["Netflix", "Gym", "Renta"]);
  });

  test("si ya estaba anotado (aunque sea antes de la fecha) queda pagado solo", () => {
    const { ctx } = preparar({ ahora: new Date("2026-10-05T16:00:00Z") });
    fijo(ctx, "Renta", 7000, 7, { tipo: "renta" });
    sincronizarCobros(ctx);
    // El 5 pagó la renta del 7.
    crearMovimiento(dictado(ctx, "pagué la renta 7000"), { tipo: "gasto", monto: 7000, descripcion: "Renta" });
    const dia7 = elDia(ctx, "2026-10-07");
    const r = cobrosApp(dia7);
    expect(r.porConfirmar).toEqual([]);
    expect(r.recientes.map((c) => [c.nombre, c.estado, c.confirmadoPor])).toEqual([["Renta", "pagado", "empate"]]);
  });

  test("un ciclo que nadie contestó queda sin confirmar al llegar el siguiente", () => {
    const { ctx } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    sincronizarCobros(ctx);
    const noviembre = cobrosApp(elDia(ctx, "2026-11-07"));
    expect(noviembre.porConfirmar.map((c) => c.fecha)).toEqual(["2026-11-07"]);
    expect(noviembre.recientes.map((c) => [c.fecha, c.estado])).toEqual([["2026-10-07", "sin_confirmar"]]);
  });

  test("pausada o cancelada ya no se pregunta", () => {
    const { ctx, db } = preparar();
    const r = fijo(ctx, "Netflix", 219, 7);
    sincronizarCobros(ctx);
    db.update(recurrentes).set({ activo: false, estado: "pausada" }).where(eq(recurrentes.id, r.id)).run();
    expect(cobrosApp(ctx).porConfirmar).toEqual([]);
  });
});

describe("confirmar en la app", () => {
  test("sí, se pagó: anota el gasto en su cuenta, del día del cobro, y se puede deshacer", () => {
    const { ctx, db } = preparar();
    fijo(ctx, "Netflix", 219, 7, { cuenta: "Nu" });
    const [c] = cobrosApp(ctx).porConfirmar;
    const despues = elDia(ctx, "2026-10-09");
    const { cobro } = confirmarCobro(despues, c!.id);
    expect(cobro.estado).toBe("pagado");
    const [m] = gastos(db);
    expect([m!.montoCentavos, m!.fecha, m!.origen, m!.recurrenteId]).toEqual([21900, "2026-10-07", "app", c!.recurrenteId]);
    expect(cobro.cuenta).toBe("Nu");
    expect(cobrosApp(despues).insignia).toBe(0);
    // Dos veces no anota dos.
    confirmarCobro(despues, c!.id);
    expect(gastos(db)).toHaveLength(1);
    expect(deshacerCobro(despues, c!.id).cobro.estado).toBe("pendiente");
    expect(gastos(db)).toHaveLength(0);
  });

  test("con otro monto, y si dice que así cuesta ahora, cambia el precio (y deshacer lo regresa)", () => {
    const { ctx, db } = preparar();
    const r = fijo(ctx, "Netflix", 219, 7);
    const [c] = cobrosApp(ctx).porConfirmar;
    confirmarCobro(ctx, c!.id, { monto: 249, actualizarPrecio: true });
    expect(gastos(db)[0]!.montoCentavos).toBe(24900);
    expect(db.select().from(recurrentes).where(eq(recurrentes.id, r.id)).get()!.montoCentavos).toBe(24900);
    deshacerCobro(ctx, c!.id);
    expect(db.select().from(recurrentes).where(eq(recurrentes.id, r.id)).get()!.montoCentavos).toBe(21900);
    // El mes siguiente, la app sabe que la vez anterior se pagó distinto.
    confirmarCobro(ctx, c!.id, { monto: 249 });
    expect(cobrosApp(elDia(ctx, "2026-11-07")).porConfirmar[0]!.anteriorDistintoCentavos).toBe(24900);
  });

  test("¿ya lo anotaste?: sugiere el gasto que parece, lo liga sin anotar otro y aprende su comercio", () => {
    const { ctx, db } = preparar();
    const r = fijo(ctx, "iCloud", 49, 7);
    crearMovimiento({ ...ctx, origen: "apple_pay" }, { tipo: "gasto", monto: 49, comercio: "APPLE.COM/BILL" });
    const [c] = cobrosApp(ctx).porConfirmar;
    expect(c!.sugerencias.map((s) => [s.titulo, s.montoCentavos])).toEqual([["APPLE.COM/BILL", 4900]]);
    confirmarCobro(ctx, c!.id, { movimientoId: c!.sugerencias[0]!.movimientoId });
    expect(gastos(db)).toHaveLength(1);
    expect(db.select().from(recurrentes).where(eq(recurrentes.id, r.id)).get()!.comercioId).toBeTruthy();
    // Deshacer suelta el gasto, no lo borra.
    deshacerCobro(ctx, c!.id);
    expect(gastos(db)).toHaveLength(1);
    expect(gastos(db)[0]!.recurrenteId).toBeNull();
    // El mes siguiente, el cobro de Apple ya se reconoce solo.
    const noviembre = elDia(ctx, "2026-11-07");
    crearMovimiento({ ...noviembre, origen: "apple_pay" }, { tipo: "gasto", monto: 49, comercio: "APPLE.COM/BILL" });
    expect(cobrosApp(noviembre).porConfirmar).toEqual([]);
  });

  test("todavía no: hasta mañana no cuenta en el número del ícono", () => {
    const { ctx } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    const [c] = cobrosApp(ctx).porConfirmar;
    expect(posponerCobro(ctx, c!.id).cobro.pospuesto).toBe(true);
    expect(cobrosApp(ctx).insignia).toBe(0);
    expect(cobrosApp(elDia(ctx, "2026-10-08")).insignia).toBe(1);
  });

  test("este mes no se pagó: dos seguidos ofrecen pausarla", () => {
    const { ctx } = preparar();
    fijo(ctx, "Spotify", 129, 7);
    const [octubre] = cobrosApp(ctx).porConfirmar;
    expect(saltarCobro(ctx, octubre!.id).sugerirPausa).toBe(false);
    const nov = elDia(ctx, "2026-11-07");
    const [noviembre] = cobrosApp(nov).porConfirmar;
    expect(saltarCobro(nov, noviembre!.id).sugerirPausa).toBe(true);
  });

  test("si el gasto se borra, el cobro vuelve a estar pendiente", () => {
    const { ctx, db } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    const [c] = cobrosApp(ctx).porConfirmar;
    confirmarCobro(ctx, c!.id);
    eliminarMovimiento(ctx, gastos(db)[0]!.id);
    expect(cobrosApp(ctx).porConfirmar.map((x) => x.estado)).toEqual(["pendiente"]);
  });

  test("confirmar sola: al llegar la fecha se anota sin preguntar", () => {
    const { ctx, db } = preparar();
    const r = fijo(ctx, "Gym", 500, 7);
    db.update(recurrentes).set({ confirmarSolo: true }).where(eq(recurrentes.id, r.id)).run();
    const { porConfirmar, recientes } = cobrosApp(ctx);
    expect(porConfirmar).toEqual([]);
    expect(recientes.map((c) => [c.nombre, c.confirmadoPor])).toEqual([["Gym", "auto"]]);
    expect(gastos(db).map((m) => m.montoCentavos)).toEqual([50000]);
  });

  test("lo que falta pagar del mes cuenta lo pendiente y no lo pagado ni lo saltado", () => {
    const { ctx } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    fijo(ctx, "Spotify", 129, 7);
    const dia9 = elDia(ctx, "2026-10-09");
    const [netflix, spotify] = cobrosApp(ctx).porConfirmar;
    // El 9, los dos del 7 siguen pendientes: se deben.
    expect(porPagarEsteMes(dia9)).toBe(21900 + 12900);
    confirmarCobro(dia9, netflix!.id);
    saltarCobro(dia9, spotify!.id);
    expect(porPagarEsteMes(dia9)).toBe(0);
  });
});

describe("empatar pagos", () => {
  test("un gasto dictado o de Apple Pay que es la suscripción la deja pagada", () => {
    const { ctx } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    sincronizarCobros(ctx);
    crearMovimiento({ ...ctx, origen: "apple_pay" }, { tipo: "gasto", monto: 219, comercio: "NETFLIX.COM" });
    // Sin el empate del registro, el de la sincronización lo encuentra igual.
    expect(cobrosApp(ctx).porConfirmar).toEqual([]);
  });

  test("con duda (dos de Apple con el mismo comercio y otro monto) no liga nada", async () => {
    const { ctx } = preparar();
    fijo(ctx, "Apple Music", 129, 7);
    fijo(ctx, "Apple TV", 149, 7);
    sincronizarCobros(ctx);
    const r = await herramienta(dictado(ctx, "apple 139"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 139, comercio: "Apple" }] });
    expect(r.registrados[0].pago_de).toBeUndefined();
    expect(cobrosApp(ctx).porConfirmar).toHaveLength(2);
    // El de monto exacto sí.
    const exacto = await herramienta(dictado(ctx, "apple 149"), "registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 149, comercio: "Apple" }] });
    expect(exacto.registrados[0].pago_de).toBe("Apple TV (queda pagado)");
  });

  test("un gasto parecido de otra cosa no es el pago", async () => {
    const { ctx } = preparar();
    fijo(ctx, "Gym", 500, 7);
    sincronizarCobros(ctx);
    await herramienta(dictado(ctx, "tenis para el gym 1500"), "registrar_movimientos", {
      movimientos: [{ tipo: "gasto", monto: 1500, descripcion: "tenis para el gym" }],
    });
    expect(cobrosApp(ctx).porConfirmar.map((c) => c.nombre)).toEqual(["Gym"]);
  });
});

describe("por voz", () => {
  test("ya pagué Netflix, y si lo vuelve a decir no anota otro", async () => {
    const { ctx, db } = preparar();
    fijo(ctx, "Netflix", 219, 7, { cuenta: "Nu" });
    const r = await herramienta(dictado(ctx, "ya pagué Netflix"), "marcar_cobro", { nombre: "Netflix", pagado: true });
    expect(r.confirmacion).toBe("Listo, Netflix de octubre quedó pagado con $219.");
    expect(gastos(db)).toHaveLength(1);
    const otra = await herramienta(dictado(ctx, "ya pagué Netflix"), "marcar_cobro", { nombre: "Netflix", pagado: true });
    expect(otra.ya_estaba).toBeTruthy();
    expect(gastos(db)).toHaveLength(1);
  });

  test("pagué Netflix pero fueron 249: lo anota con 249; un monto que no dijo no cuenta", async () => {
    const { ctx, db } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    await herramienta(dictado(ctx, "pagué Netflix"), "marcar_cobro", { nombre: "Netflix", pagado: true, monto: 300 });
    expect(gastos(db)[0]!.montoCentavos).toBe(21900);
    const nov = elDia(ctx, "2026-11-07");
    const r = await herramienta(dictado(nov, "pagué Netflix pero fueron 249"), "marcar_cobro", { nombre: "Netflix", pagado: true, monto: 249 });
    expect(r.esperado).toBe("$219");
    expect(gastos(db).map((m) => m.montoCentavos)).toEqual([21900, 24900]);
  });

  test("si ya lo había dictado sin ligarse, lo liga en vez de anotar otro", async () => {
    const { ctx, db } = preparar();
    fijo(ctx, "Renta", 7000, 7, { tipo: "renta" });
    crearMovimiento(ctx, { tipo: "gasto", monto: 7000, descripcion: "Renta del depa" });
    db.delete(cobros).run();
    db.update(movimientos).set({ recurrenteId: null }).run();
    const r = await herramienta(dictado(ctx, "ya pagué la renta"), "marcar_cobro", { nombre: "Renta", pagado: true });
    expect(gastos(db)).toHaveLength(1);
    expect(r.ya_estaba).toBeTruthy();
  });

  test("este mes no pagué Spotify", async () => {
    const { ctx } = preparar();
    fijo(ctx, "Spotify", 129, 7);
    const r = await herramienta(dictado(ctx, "este mes no pagué Spotify"), "marcar_cobro", { nombre: "Spotify", pagado: false });
    expect(r.confirmacion).toBe("Va, Spotify de octubre queda como no pagado.");
    expect(cobrosApp(ctx).porConfirmar).toEqual([]);
  });

  test("registrar_movimientos con 'ya pagué Netflix' manda a marcar_cobro una vez", async () => {
    const { ctx } = preparar();
    fijo(ctx, "Netflix", 219, 7);
    const ya = dictado(ctx, "ya pagué Netflix");
    const herramientas = crearHerramientas(ya, []) as Record<string, { execute?: unknown }>;
    const registrar = herramientas.registrar_movimientos!.execute as (a: unknown, o: unknown) => Promise<any>;
    const args = { movimientos: [{ tipo: "gasto", monto: 219, comercio: "Netflix" }] };
    expect((await registrar(args, {})).error).toContain("marcar_cobro");
    // Si el modelo insiste, se anota y se liga.
    expect((await registrar(args, {})).registrados[0].pago_de).toBe("Netflix (queda pagado)");
  });

  test("con la confirmación apagada no existe marcar_cobro", () => {
    process.env.CONFIRMAR_COBROS = "0";
    const { ctx } = preparar();
    expect("marcar_cobro" in crearHerramientas(ctx, [])).toBe(false);
  });
});

const TARDE = "2026-10-07T21:00:00.000Z";

/** La app con un modelo falso: para la pregunta del Atajo y su respuesta. */
function montar(respuestas: unknown[]) {
  const { db, usuario, ctx } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
  const app = crearApp({ db, modelo, zonaHoraria: ZONA, monedaBase: "MXN" });
  let n = 0;
  // 15:00 del día del cobro: la voz ya pregunta.
  const hablar = async (frase: string, conversacion_id?: string, capturado = TARDE) => {
    const r = await app.request("/v1/hablar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ texto: frase, client_id: `cobros-${String(++n).padStart(4, "0")}`, conversacion_id, capturado_en: capturado }),
    });
    return (await r.json()) as { respuesta: string; conversacion_id: string; acciones: { herramienta: string }[] };
  };
  const pedir = (ruta: string, init: RequestInit = {}) =>
    app.request(ruta, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
  return { ctx, db, modelo, hablar, pedir };
}

describe("el Atajo pregunta", () => {
  test("tras anotar algo pregunta por el cobro de hoy, y el 'sí' lo confirma sin la IA", async () => {
    const { ctx, db, modelo, hablar } = montar([llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }), texto("Listo.")]);
    fijo(ctx, "Netflix", 219, 7);
    const primera = await hablar("café 85");
    expect(primera.respuesta).toEndWith("Por cierto, ¿ya se cobró Netflix de 219 pesos?");
    const llamadas = modelo.doGenerateCalls.length;
    const si = await hablar("sí", primera.conversacion_id);
    expect(si.respuesta).toBe("Listo, anoté Netflix de 219 pesos como pagado.");
    expect(modelo.doGenerateCalls.length).toBe(llamadas);
    expect(db.select().from(cobros).get()!.estado).toBe("pagado");
    // Ya no vuelve a preguntar.
    expect(db.select().from(cobros).get()!.pregunta).toBeNull();
  });

  test("'todavía no' pregunta mañana; y no pregunta dos veces el mismo día", async () => {
    const registrar = llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] });
    const { ctx, db, hablar } = montar([registrar, texto("Listo."), registrar, texto("Listo.")]);
    fijo(ctx, "Netflix", 219, 7);
    const primera = await hablar("café 85");
    expect((await hablar("todavía no", primera.conversacion_id)).respuesta).toBe("Va, te pregunto mañana.");
    expect(db.select().from(cobros).get()!.posponerHasta).toBe("2026-10-08");
    expect((await hablar("otro café 85")).respuesta).not.toContain("Netflix");
  });

  test("en la mañana del día del cobro todavía no pregunta", async () => {
    const { ctx, hablar } = montar([llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }), texto("Listo.")]);
    fijo(ctx, "Netflix", 219, 7);
    expect((await hablar("café 85", undefined, AHORA.toISOString())).respuesta).not.toContain("Netflix");
  });

  test("pagó con otro monto: pregunta si ese es el precio nuevo y el 'sí' lo cambia", async () => {
    const { ctx, db, hablar } = montar([llamada("marcar_cobro", { nombre: "Netflix", pagado: true, monto: 249 })]);
    const r = fijo(ctx, "Netflix", 219, 7);
    const primera = await hablar("pagué Netflix pero fueron 249");
    expect(primera.respuesta).toBe("Listo, Netflix de octubre quedó pagado con 249 pesos. ¿Ahora Netflix cuesta 249 pesos cada vez?");
    const si = await hablar("sí", primera.conversacion_id);
    expect(si.respuesta).toBe("Listo, desde ahora Netflix es de 249 pesos.");
    expect(db.select().from(recurrentes).where(eq(recurrentes.id, r.id)).get()!.montoCentavos).toBe(24900);
  });
});

describe("notificaciones", () => {
  function conPush(db: Db, usuarioId: string) {
    crearDispositivo(db, usuarioId, "iPhone");
    const dispositivoId = db.select().from(dispositivos).all().at(-1)!.id;
    suscribir(db, usuarioId, dispositivoId, { endpoint: ENDPOINT, ...LLAVES, contacto: "mailto:a@b.mx" });
  }
  const enviadasCon = () => {
    const enviadas: { titulo: string; cuerpo: string; url: string; etiqueta?: string; insignia?: number }[] = [];
    const enviar: EnviarPush = async (_s, m) => (enviadas.push(JSON.parse(m)), { ok: true, estado: 201, vencida: false });
    return { enviadas, enviar };
  };

  test("en la tarde pregunta por todos los del día en una sola, abre la hoja y no repite", async () => {
    const { ctx, db, usuario } = preparar();
    conPush(db, usuario.id);
    fijo(ctx, "Netflix", 219, 7, { cuenta: "Nu" });
    fijo(ctx, "Spotify", 129, 7);
    const { enviadas, enviar } = enviadasCon();
    // A las 10 todavía no.
    expect(await enviarPreguntasDeCobros(db, ZONA, "MXN", new Date("2026-10-07T16:00:00Z"), enviar)).toBe(0);
    // A las 19:10.
    expect(await enviarPreguntasDeCobros(db, ZONA, "MXN", new Date("2026-10-08T01:10:00Z"), enviar)).toBe(1);
    expect(enviadas[0]!.titulo).toBe("¿Ya se cobraron Netflix y Spotify?");
    expect(enviadas[0]!.url).toStartWith("/#inicio?confirmar=");
    expect(enviadas[0]!.url.split("=")[1]!.split(",")).toHaveLength(2);
    expect(enviadas[0]!.insignia).toBe(2);
    expect(await enviarPreguntasDeCobros(db, ZONA, "MXN", new Date("2026-10-08T01:40:00Z"), enviar)).toBe(0);
    // Al día siguiente, solo el que sigue pendiente, con su monto y cuenta.
    const spotify = cobrosApp(ctx).porConfirmar.find((c) => c.nombre === "Spotify")!;
    confirmarCobro(ctx, spotify.id);
    expect(await enviarPreguntasDeCobros(db, ZONA, "MXN", new Date("2026-10-09T01:10:00Z"), enviar)).toBe(1);
    expect(enviadas[1]).toMatchObject({ titulo: "¿Ya se cobró Netflix?", cuerpo: "$219 en Nu. Toca para confirmarlo.", insignia: 1 });
  });

  test("a lo mucho tres notificaciones por cobro, y nada si apagó los cobros", async () => {
    const { ctx, db, usuario } = preparar();
    conPush(db, usuario.id);
    fijo(ctx, "Netflix", 219, 7);
    const { enviadas, enviar } = enviadasCon();
    for (const dia of ["08", "09", "10", "11"]) await enviarPreguntasDeCobros(db, ZONA, "MXN", new Date(`2026-10-${dia}T01:10:00Z`), enviar);
    expect(enviadas).toHaveLength(3);

    const otro = preparar();
    conPush(otro.db, otro.usuario.id);
    fijo(otro.ctx, "Netflix", 219, 7);
    guardarPreferencias(otro.db, otro.usuario.id, { tipos: { cobros: false } });
    expect(await enviarPreguntasDeCobros(otro.db, ZONA, "MXN", new Date("2026-10-08T01:10:00Z"), enviar)).toBe(0);
  });

  test("con un horario que termina a las 18, pregunta a las 17", async () => {
    const { ctx, db, usuario } = preparar();
    conPush(db, usuario.id);
    fijo(ctx, "Netflix", 219, 7);
    guardarPreferencias(db, usuario.id, { desde: 8, hasta: 18 });
    const { enviar } = enviadasCon();
    expect(await enviarPreguntasDeCobros(db, ZONA, "MXN", new Date("2026-10-07T22:30:00Z"), enviar)).toBe(0);
    expect(await enviarPreguntasDeCobros(db, ZONA, "MXN", new Date("2026-10-07T23:10:00Z"), enviar)).toBe(1);
  });

  test("la de la mañana respeta los tipos apagados y el horario", async () => {
    const { db, usuario } = preparar();
    conPush(db, usuario.id);
    const creadoEn = "2026-10-07T09:00:00.000Z";
    const aviso = (tipo: "hormiga" | "presupuesto", titulo: string) =>
      db.insert(avisos).values({ usuarioId: usuario.id, tipo, clave: titulo, titulo, texto: titulo, fecha: "2026-10-07", prioridad: 1, creadoEn }).run();
    aviso("hormiga", "Cafés");
    aviso("presupuesto", "Súper");
    guardarPreferencias(db, usuario.id, { tipos: { fugas: false }, desde: 11 });
    const { enviadas, enviar } = enviadasCon();
    // 10:00: antes de su horario.
    expect(await enviarAvisosDelDia(db, ZONA, new Date("2026-10-07T16:00:00Z"), enviar)).toBe(0);
    expect(await enviarAvisosDelDia(db, ZONA, new Date("2026-10-07T17:30:00Z"), enviar)).toBe(1);
    expect(enviadas.map((e) => e.titulo)).toEqual(["Súper"]);
  });

  test("sin la confirmación abierta, nada cambia: sin pregunta de la tarde ni número en el ícono", async () => {
    process.env.CONFIRMAR_COBROS = "0";
    const { ctx, db, usuario } = preparar();
    conPush(db, usuario.id);
    fijo(ctx, "Netflix", 219, 7);
    const { enviadas, enviar } = enviadasCon();
    expect(await enviarPreguntasDeCobros(db, ZONA, "MXN", new Date("2026-10-08T01:10:00Z"), enviar)).toBe(0);
    db.insert(avisos).values({ usuarioId: usuario.id, tipo: "hormiga", clave: "x", titulo: "Cafés", texto: "x", fecha: "2026-10-07", prioridad: 1, creadoEn: "2026-10-07T09:00:00.000Z" }).run();
    await enviarAvisosDelDia(db, ZONA, new Date("2026-10-07T16:00:00Z"), enviar);
    expect(enviadas[0]!.insignia).toBeUndefined();
  });
});

describe("API", () => {
  test("404 para las cuentas sin la confirmación abierta", async () => {
    const { db, pedir } = montar([]);
    const otra = crearUsuario(db, "Ana");
    const token = crearDispositivo(db, otra.id, "iPhone");
    const app = crearApp({ db, modelo: new MockLanguageModelV4(), zonaHoraria: ZONA, monedaBase: "MXN" });
    const ajena = await app.request("/v1/cobros", { headers: { authorization: `Bearer ${token}` } });
    expect(ajena.status).toBe(404);
    expect((await app.request("/v1/avisos/preferencias", { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    expect((await pedir("/v1/cobros")).status).toBe(200);
  });

  test("lista, confirma con otro monto, deshace y guarda preferencias", async () => {
    const { ctx, db, pedir } = montar([]);
    const hoy = fechaLocal(new Date(), ZONA);
    const r = crearRecurrente(ctx, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: Math.min(Number(hoy.slice(8)), 28) });
    db.update(recurrentes).set({ creadoEn: "2020-01-01T00:00:00.000Z" }).where(eq(recurrentes.id, r.id)).run();
    const lista = (await (await pedir("/v1/cobros")).json()) as { porConfirmar: { id: string; fecha: string }[] };
    // El día 29-31 Netflix (del 28) ya pasó al prenderlo: no hay nada que confirmar.
    if (Number(hoy.slice(8)) > 28) return expect(lista.porConfirmar).toEqual([]);
    const [c] = lista.porConfirmar;
    expect(c!.fecha).toBe(hoy);
    const confirmado = await pedir(`/v1/cobros/${c!.id}/confirmar`, { method: "POST", body: JSON.stringify({ monto: 249, actualizar_precio: true }) });
    expect(((await confirmado.json()) as { cobro: { estado: string; montoRealCentavos: number } }).cobro).toMatchObject({ estado: "pagado", montoRealCentavos: 24900 });
    const deshecho = await pedir(`/v1/cobros/${c!.id}/deshacer`, { method: "POST" });
    expect(((await deshecho.json()) as { cobro: { estado: string } }).cobro.estado).toBe("pendiente");
    expect((await pedir(`/v1/cobros/${c!.id}/confirmar`, { method: "POST", body: JSON.stringify({ monto: -1 }) })).status).toBe(400);
    expect((await pedir("/v1/avisos/preferencias", { method: "PUT", body: JSON.stringify({ desde: 20, hasta: 8 }) })).status).toBe(400);
    const prefs = await pedir("/v1/avisos/preferencias", { method: "PUT", body: JSON.stringify({ tipos: { fugas: false }, desde: 8 }) });
    expect(await prefs.json()).toEqual({ tipos: { cobros: true, tarjetas: true, presupuestos: true, fugas: false, deudas: true }, desde: 8, hasta: 21 });
    // Un cobro de otra cuenta no se puede tocar.
    const otra = preparar();
    expect((await pedir(`/v1/cobros/${otra.ctx.usuarioId}/confirmar`, { method: "POST", body: "{}" })).status).toBe(400);
  });
});
