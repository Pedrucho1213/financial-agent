import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { crearApp } from "../src/app";
import { crearDispositivo } from "../src/auth";
import { llamada, preparar } from "./ayuda";

type Json = Record<string, any>;

function montar(respuestas: unknown[] = []) {
  const { db, usuario } = preparar();
  const token = crearDispositivo(db, usuario.id, "iPhone");
  const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
  const app = crearApp({ db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" });
  const pedir = async (ruta: string, metodo = "GET", cuerpo?: unknown) => {
    // Cada petición en su propio milisegundo: el saldo dicho cuenta lo que pasó después.
    await Bun.sleep(2);
    const r = await app.request(ruta, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { estado: r.status, cuerpo: (await r.json()) as Json };
  };
  return { db, modelo, pedir };
}

describe("API de cuentas", () => {
  test("crear, ajustar el saldo, gastar con ella y ver cómo queda", async () => {
    const { pedir } = montar();
    const bbva = await pedir("/v1/cuentas", "POST", { nombre: "BBVA", tipo: "debito", saldo: 5000 });
    expect(bbva.estado).toBe(201);
    expect(bbva.cuerpo).toMatchObject({ nombre: "BBVA", tipo: "debito", saldoCentavos: 500000, conocido: true });
    expect((await pedir("/v1/cuentas", "POST", { nombre: "bbva" })).estado).toBe(409);
    // "BBVA Azul" es otra cuenta, aunque se parezca.
    expect((await pedir("/v1/cuentas", "POST", { nombre: "BBVA Azul" })).cuerpo.nombre).toBe("BBVA Azul");
    const nu = await pedir("/v1/cuentas", "POST", { nombre: "Nu", tipo: "credito", limite: 30000, deuda: 2000, dia_pago: 25 });
    expect(nu.cuerpo).toMatchObject({ esCredito: true, deudaCentavos: 200000, disponibleCentavos: 2800000, diaPago: 25 });

    expect((await pedir("/v1/movimientos", "POST", { tipo: "gasto", monto: 300, cuenta: "BBVA", etiquetas: [] })).estado).toBe(201);
    // Un pago a la Nu desde la app, con solo la tarjeta, baja la deuda (no la sube).
    const pagoApp = await pedir("/v1/movimientos", "POST", { tipo: "pago_tarjeta", monto: 500, cuenta: "Nu" });
    expect(pagoApp.cuerpo).toMatchObject({ cuentaDestino: "Nu", cuenta: null });
    expect((await pedir(`/v1/cuentas/${nu.cuerpo.id}`)).cuerpo.cuenta.deudaCentavos).toBe(150000);
    await pedir(`/v1/movimientos/${pagoApp.cuerpo.id}`, "DELETE");
    const pago = await pedir("/v1/transferencias", "POST", { tipo: "pago_tarjeta", monto: 1000, desde_id: bbva.cuerpo.id, hacia_id: nu.cuerpo.id });
    expect(pago.estado).toBe(201);
    expect(pago.cuerpo.movimiento).toMatchObject({ tipo: "pago_tarjeta", cuenta: "BBVA", cuentaDestino: "Nu", cuentaDestinoId: nu.cuerpo.id });

    const lista = await pedir("/v1/cuentas");
    const porNombre = Object.fromEntries(lista.cuerpo.cuentas.map((c: Json) => [c.nombre, c]));
    expect(porNombre.BBVA.saldoCentavos).toBe(370000);
    expect(porNombre.BBVA.mes).toEqual({ entradaCentavos: 0, salidaCentavos: 130000 });
    expect(porNombre.Nu.deudaCentavos).toBe(100000);
    expect(lista.cuerpo.totales).toMatchObject({ dineroCentavos: 370000, deudaCentavos: 100000, disponibleCreditoCentavos: 2900000, sinSaldo: ["BBVA Azul"] });

    // Detalle con sus movimientos, y el filtro de movimientos por cuenta.
    const detalle = await pedir(`/v1/cuentas/${bbva.cuerpo.id}`);
    expect(detalle.cuerpo.movimientos).toHaveLength(2);
    expect((await pedir(`/v1/movimientos?cuenta_id=${nu.cuerpo.id}`)).cuerpo.total).toBe(1);

    // El tablero trae los totales de cuentas.
    expect((await pedir("/v1/tablero")).cuerpo.cuentas).toMatchObject({ dineroCentavos: 370000 });

    // Editar: nuevo saldo, quitar el límite, archivar.
    const editada = await pedir(`/v1/cuentas/${bbva.cuerpo.id}`, "PATCH", { saldo: 9000, nombre: "BBVA Nómina" });
    expect(editada.cuerpo).toMatchObject({ nombre: "BBVA Nómina", saldoCentavos: 900000 });
    expect((await pedir(`/v1/cuentas/${nu.cuerpo.id}`, "PATCH", { limite: null })).cuerpo).toMatchObject({ limiteCentavos: null, disponibleCentavos: null, deudaCentavos: 100000 });
    await pedir(`/v1/cuentas/${bbva.cuerpo.id}`, "PATCH", { archivada: true });
    expect((await pedir("/v1/cuentas")).cuerpo.cuentas.map((c: Json) => c.nombre)).not.toContain("BBVA Nómina");
    expect((await pedir("/v1/cuentas?archivadas=1")).cuerpo.cuentas.map((c: Json) => c.nombre)).toContain("BBVA Nómina");
  });

  test("validación: montos raros, días fuera de rango y cuentas ajenas", async () => {
    const { pedir } = montar();
    expect((await pedir("/v1/cuentas", "POST", { nombre: "" })).estado).toBe(400);
    expect((await pedir("/v1/cuentas", "POST", { nombre: "X", dia_corte: 40 })).estado).toBe(400);
    expect((await pedir("/v1/cuentas", "POST", { nombre: "X", saldo: "mucho" })).estado).toBe(400);
    expect((await pedir("/v1/cuentas", "POST", { nombre: "Débito", tipo: "debito", limite: 5000 })).estado).toBe(400);
    expect((await pedir("/v1/cuentas/no-existe")).estado).toBe(404);
    const otro = montar();
    const ajena = await otro.pedir("/v1/cuentas", "POST", { nombre: "Secreta", saldo: 100 });
    expect((await pedir(`/v1/cuentas/${ajena.cuerpo.id}`)).estado).toBe(404);
    expect((await pedir(`/v1/cuentas/${ajena.cuerpo.id}`, "PATCH", { saldo: 1 })).estado).toBe(404);
    // La de otro sigue igual.
    expect((await otro.pedir(`/v1/cuentas/${ajena.cuerpo.id}`)).cuerpo.cuenta.saldoCentavos).toBe(10000);
    expect((await pedir("/v1/transferencias", "POST", { tipo: "transferencia", monto: 1, hacia_id: ajena.cuerpo.id })).estado).toBe(400);
  });

  test("etiquetas desde la app: crear, activar, poner en un movimiento, resumen y borrar", async () => {
    const { pedir } = montar();
    const viaje = await pedir("/v1/etiquetas", "POST", { nombre: "Viaje Oaxaca" });
    expect(viaje.estado).toBe(201);
    expect((await pedir("/v1/etiquetas", "POST", { nombre: "viaje oaxaca" })).estado).toBe(409);
    const m = await pedir("/v1/movimientos", "POST", { tipo: "gasto", monto: 250, descripcion: "mezcal", etiquetas: [viaje.cuerpo.id, "id-falso"] });
    expect(m.cuerpo.etiquetas).toEqual([{ id: viaje.cuerpo.id, nombre: "Viaje Oaxaca" }]);
    const trabajo = await pedir("/v1/etiquetas", "POST", { nombre: "Trabajo" });
    const editado = await pedir(`/v1/movimientos/${m.cuerpo.id}`, "PATCH", { etiquetas: [trabajo.cuerpo.id] });
    expect(editado.cuerpo.etiquetas.map((e: Json) => e.nombre)).toEqual(["Trabajo"]);
    expect((await pedir(`/v1/movimientos?etiqueta_id=${trabajo.cuerpo.id}`)).cuerpo.total).toBe(1);
    const activa = await pedir(`/v1/etiquetas/${viaje.cuerpo.id}`, "PATCH", { activa_hasta: "2026-10-31" });
    expect(activa.cuerpo).toMatchObject({ nombre: "Viaje Oaxaca", activaHasta: "2026-10-31" });
    const resumen = await pedir("/v1/etiquetas?periodo=este_mes");
    expect(resumen.cuerpo.etiquetas.find((e: Json) => e.nombre === "Trabajo")).toMatchObject({ cantidad: 1, gastadoCentavos: 25000 });
    // Al activarla, el mezcal (de esos días) también la lleva otra vez, sin perder Trabajo.
    expect((await pedir("/v1/tablero")).cuerpo.porEtiqueta).toEqual([
      { id: trabajo.cuerpo.id, nombre: "Trabajo", gastadoCentavos: 25000, ingresadoCentavos: 0, cantidad: 1, activa: false },
      { id: viaje.cuerpo.id, nombre: "Viaje Oaxaca", gastadoCentavos: 25000, ingresadoCentavos: 0, cantidad: 1, activa: true },
    ]);
    // Activar desde la app marcó gastos de esos días: un solo "deshacer" lo regresa todo.
    await pedir("/v1/movimientos", "POST", { tipo: "gasto", monto: 10, descripcion: "a" });
    await pedir("/v1/movimientos", "POST", { tipo: "gasto", monto: 20, descripcion: "b" });
    const playa = await pedir("/v1/etiquetas", "POST", { nombre: "Playa", activa_desde: "2026-10-01", activa_hasta: "2026-10-31" });
    expect(playa.cuerpo.cantidad).toBeGreaterThanOrEqual(2);
    await pedir("/v1/deshacer", "POST", {});
    expect((await pedir(`/v1/movimientos?etiqueta_id=${playa.cuerpo.id}`)).cuerpo.total).toBe(0);
    expect((await pedir(`/v1/etiquetas/${trabajo.cuerpo.id}`, "DELETE")).estado).toBe(200);
    expect((await pedir(`/v1/etiquetas/${trabajo.cuerpo.id}`, "DELETE")).estado).toBe(404);
    expect((await pedir(`/v1/movimientos/${m.cuerpo.id}`)).cuerpo.etiquetas.map((e: Json) => e.nombre)).toEqual(["Viaje Oaxaca"]);
  });
});

describe("por voz, de punta a punta", () => {
  test("'tengo 20 mil en Revolut y 10 mil en Bancomer': una vuelta del modelo y la confirmación con los saldos", async () => {
    const { pedir, modelo } = montar([
      llamada("cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 20000 }, { cuenta: "Bancomer", saldo: 10000 }] }),
    ]);
    const r = await pedir("/v1/hablar", "POST", {
      texto: "Te aviso que tengo 20 mil pesos en mi cuenta de Revolut y 10 mil pesos en mi cuenta de Bancomer",
      client_id: "saldo-0001",
    });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.respuesta).toBe("Listo, Revolut tiene 20,000 pesos y Bancomer tiene 10,000 pesos.");
    expect(modelo.doGenerateCalls).toHaveLength(1);
    const cuentas = await pedir("/v1/cuentas");
    expect(cuentas.cuerpo.totales.dineroCentavos).toBe(3000000);
    expect((await pedir("/v1/movimientos")).cuerpo.total).toBe(0);
  });

  test("si el modelo lo anota como ingreso, se le regresa y termina en cuentas", async () => {
    const { pedir, modelo } = montar([
      llamada("registrar_movimientos", { movimientos: [{ tipo: "ingreso", monto: 20000, cuenta: "Revolut" }] }),
      llamada("cuentas", { cuentas: [{ cuenta: "Revolut", saldo: 20000 }] }),
    ]);
    const r = await pedir("/v1/hablar", "POST", { texto: "tengo 20 mil en Revolut", client_id: "saldo-0002" });
    expect(r.cuerpo.respuesta).toBe("Listo, Revolut tiene 20,000 pesos.");
    expect(modelo.doGenerateCalls).toHaveLength(2);
    expect((await pedir("/v1/movimientos")).cuerpo.total).toBe(0);
  });

  test("un gasto que deja la tarjeta casi sin crédito lo dice al confirmar", async () => {
    const { pedir } = montar([llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 1500, descripcion: "tenis", categoria: "Ropa y calzado", cuenta: "Nu" }] })]);
    await pedir("/v1/cuentas", "POST", { nombre: "Nu", tipo: "credito", limite: 10000, deuda: 8000 });
    const r = await pedir("/v1/hablar", "POST", { texto: "compré unos tenis de 1500 con la Nu", client_id: "tarjeta-0001", espera_ms: 5000 });
    expect(r.cuerpo.respuesta).toBe("Listo, tenis de 1,500 pesos en Ropa y calzado con Nu. Ojo, en Nu ya solo te quedan 500 pesos disponibles.");
    expect(r.cuerpo.dato).toBe("Ojo, en Nu ya solo te quedan $500 disponibles.");
  });
});
