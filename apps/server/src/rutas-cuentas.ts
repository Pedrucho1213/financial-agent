import type { Hono } from "hono";
import { z } from "zod";
import type { VariablesAuth } from "./auth";
import { TIPOS_CUENTA } from "./db/schema";
import type { Contexto } from "./finanzas/contexto";
import {
  archivarCuenta,
  crearCuenta,
  estadoDeCuenta,
  estadosDeCuentas,
  fijarCuenta,
  flujoPorCuenta,
  moverDinero,
  observacionDeCuentas,
  totalesDeCuentas,
} from "./finanzas/cuentas";
import {
  activarEtiqueta,
  desactivarEtiqueta,
  eliminarEtiqueta,
  idsDeEtiquetas,
  listarVigentes,
  renombrarEtiqueta,
  resumenEtiquetas,
} from "./finanzas/etiquetas";
import { ErrorFinanzas } from "./finanzas/movimientos";
import { listarMovimientosApp, movimientoApp } from "./finanzas/vista";
import { obtenerPropio } from "./finanzas/movimientos";
import { resolverPeriodo } from "./lib/fechas";
import { normalizar } from "./lib/texto";

const monto = z.coerce.number().min(-1e10).max(1e10);
const montoPositivo = z.coerce.number().positive().max(1e10);
const dia = z.coerce.number().int().min(1).max(31);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD.");

const esquemaCuenta = z.object({
  nombre: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS_CUENTA).optional(),
  saldo: monto.optional(),
  disponible: monto.optional(),
  deuda: monto.optional(),
  limite: montoPositivo.nullable().optional(),
  dia_corte: dia.nullable().optional(),
  dia_pago: dia.nullable().optional(),
});
const esquemaEdicionCuenta = esquemaCuenta.partial().extend({ archivada: z.boolean().optional() });

const esquemaMover = z.object({
  tipo: z.enum(["transferencia", "pago_tarjeta", "retiro"]),
  monto: montoPositivo,
  desde_id: z.string().trim().min(1).optional(),
  hacia_id: z.string().trim().min(1).optional(),
  fecha: fecha.optional(),
  descripcion: z.string().trim().max(500).optional(),
  etiquetas: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

const esquemaEtiqueta = z.object({
  nombre: z.string().trim().min(1).max(40),
  activa_desde: fecha.optional(),
  activa_hasta: fecha.optional(),
});
const esquemaEdicionEtiqueta = z.object({
  nombre: z.string().trim().min(1).max(40).optional(),
  activa_desde: fecha.nullable().optional(),
  activa_hasta: fecha.nullable().optional(),
});

const invalido = (error: z.ZodError) => ({ error: "Datos inválidos.", detalles: z.flattenError(error).fieldErrors });

/**
 * Cuentas y tarjetas con su saldo, dinero entre cuentas y etiquetas, para la app. Los errores de finanzas
 * (ErrorFinanzas) ya se convierten en 400 en `v1`.
 */
export function rutasCuentas(v1: Hono<{ Variables: VariablesAuth }>, contextoBase: (usuarioId: string) => Contexto) {
  // Cada petición de la app es una sola acción en la bitácora: activar una etiqueta que marca 5 gastos
  // se deshace de una vez, no de uno en uno.
  const contexto = (usuarioId: string): Contexto => ({ ...contextoBase(usuarioId), entradaId: `app-${crypto.randomUUID()}` });
  // Todas sus cuentas con el saldo de hoy, lo que entró y salió este mes y los totales.
  v1.get("/cuentas", (c) => {
    const ctx = contexto(c.get("usuarioId"));
    const estados = estadosDeCuentas(ctx, { archivadas: c.req.query("archivadas") === "1" });
    const mes = resolverPeriodo("este_mes", ctx.hoy)!;
    const flujo = flujoPorCuenta(ctx, mes.desde, mes.hasta);
    return c.json({
      cuentas: estados.map((e) => ({ ...e, mes: flujo.get(e.id) ?? { entradaCentavos: 0, salidaCentavos: 0 } })),
      totales: totalesDeCuentas(estados.filter((e) => !e.archivada)),
      observacion: observacionDeCuentas(ctx, estados.filter((e) => !e.archivada)) ?? null,
    });
  });

  // Una cuenta que no existe, o que es de otro usuario, es un 404 y no un 400.
  const cuentaDe = (ctx: Contexto, id: string) => {
    try {
      return estadoDeCuenta(ctx, id);
    } catch (error) {
      if (error instanceof ErrorFinanzas) return undefined;
      throw error;
    }
  };

  v1.get("/cuentas/:id", (c) => {
    const ctx = contexto(c.get("usuarioId"));
    const estado = cuentaDe(ctx, c.req.param("id"));
    if (!estado) return c.json({ error: "No existe esa cuenta." }, 404);
    const recientes = listarMovimientosApp(ctx, { cuentaId: estado.id, limite: 30 });
    return c.json({ cuenta: estado, movimientos: recientes.movimientos, totalMovimientos: recientes.total });
  });

  v1.post("/cuentas", async (c) => {
    const cuerpo = esquemaCuenta.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const ctx = contexto(c.get("usuarioId"));
    const d = cuerpo.data;
    const existe = estadosDeCuentas(ctx, { archivadas: true }).find((e) => normalizar(e.nombre) === normalizar(d.nombre));
    if (existe && !existe.archivada) return c.json({ error: `Ya tienes una cuenta llamada ${existe.nombre}.` }, 409);
    const id = existe?.id ?? crearCuenta(ctx, d.nombre, d.tipo).id;
    if (existe?.archivada) archivarCuenta(ctx, id, false);
    const montos = [d.saldo, d.disponible, d.deuda, d.limite, d.dia_corte, d.dia_pago].some((x) => x !== undefined && x !== null);
    if (montos || (existe && d.tipo)) {
      fijarCuenta(ctx, {
        id,
        cuenta: d.nombre,
        tipo: d.tipo,
        saldo: d.saldo,
        disponible: d.disponible,
        deuda: d.deuda,
        limite: d.limite ?? undefined,
        diaCorte: d.dia_corte ?? undefined,
        diaPago: d.dia_pago ?? undefined,
      });
    }
    const estado = estadoDeCuenta(ctx, id);
    return c.json(estado, 201);
  });

  v1.patch("/cuentas/:id", async (c) => {
    const cuerpo = esquemaEdicionCuenta.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const ctx = contexto(c.get("usuarioId"));
    const id = c.req.param("id");
    const actual = cuentaDe(ctx, id);
    if (!actual) return c.json({ error: "No existe esa cuenta." }, 404);
    const { archivada, ...d } = cuerpo.data;
    if (Object.keys(d).length) {
      fijarCuenta(ctx, {
        id,
        cuenta: actual.nombre,
        tipo: d.tipo,
        saldo: d.saldo,
        disponible: d.disponible,
        deuda: d.deuda,
        limite: d.limite,
        diaCorte: d.dia_corte,
        diaPago: d.dia_pago,
        nuevoNombre: d.nombre && d.nombre !== actual.nombre ? d.nombre : undefined,
      });
    }
    if (archivada !== undefined) archivarCuenta(ctx, id, archivada);
    return c.json(estadoDeCuenta(ctx, id));
  });

  // Transferencias, pagos de tarjeta y retiros desde la app, eligiendo las cuentas de una lista.
  v1.post("/transferencias", async (c) => {
    const cuerpo = esquemaMover.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const ctx = contexto(c.get("usuarioId"));
    const d = cuerpo.data;
    const r = moverDinero(ctx, {
      tipo: d.tipo,
      monto: d.monto,
      desdeId: d.desde_id,
      haciaId: d.hacia_id,
      fecha: d.fecha,
      descripcion: d.descripcion,
      etiquetas: d.etiquetas,
    });
    return c.json({ movimiento: movimientoApp(ctx, obtenerPropio(ctx, r.movimiento.id)), cuentas: r.cuentas }, 201);
  });

  // Etiquetas con cuánto llevan; ?periodo= (este_mes, YYYY-MM...) limita lo que se suma.
  v1.get("/etiquetas", (c) => {
    const ctx = contexto(c.get("usuarioId"));
    const periodo = c.req.query("periodo");
    const rango = periodo ? resolverPeriodo(periodo, ctx.hoy) : null;
    if (periodo && !rango) return c.json({ error: `No entendí el periodo "${periodo}".` }, 400);
    return c.json({ etiquetas: resumenEtiquetas(ctx, rango ?? {}) });
  });

  v1.post("/etiquetas", async (c) => {
    const cuerpo = esquemaEtiqueta.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const ctx = contexto(c.get("usuarioId"));
    const { nombre, activa_desde, activa_hasta } = cuerpo.data;
    if (listarVigentes(ctx).some((e) => e.nombreNormalizado === normalizar(nombre))) return c.json({ error: "Ya tienes esa etiqueta." }, 409);
    const [id] = idsDeEtiquetas(ctx, [nombre]);
    if (activa_desde || activa_hasta) activarEtiqueta(ctx, { nombre, desde: activa_desde, hasta: activa_hasta });
    return c.json(resumenEtiquetas(ctx).find((e) => e.id === id), 201);
  });

  v1.patch("/etiquetas/:id", async (c) => {
    const cuerpo = esquemaEdicionEtiqueta.safeParse(await c.req.json().catch(() => null));
    if (!cuerpo.success) return c.json(invalido(cuerpo.error), 400);
    const ctx = contexto(c.get("usuarioId"));
    const id = c.req.param("id");
    let etiqueta = listarVigentes(ctx).find((e) => e.id === id);
    if (!etiqueta) return c.json({ error: "No existe esa etiqueta." }, 404);
    const { nombre, activa_desde, activa_hasta } = cuerpo.data;
    if (nombre && nombre !== etiqueta.nombre) etiqueta = renombrarEtiqueta(ctx, etiqueta.nombre, nombre);
    if (activa_hasta === null || activa_desde === null) desactivarEtiqueta(ctx, etiqueta.nombre);
    else if (activa_desde || activa_hasta) activarEtiqueta(ctx, { nombre: etiqueta.nombre, desde: activa_desde, hasta: activa_hasta });
    return c.json(resumenEtiquetas(ctx).find((e) => e.id === id));
  });

  v1.delete("/etiquetas/:id", (c) => {
    const ctx = contexto(c.get("usuarioId"));
    try {
      eliminarEtiqueta(ctx, { id: c.req.param("id") });
    } catch (error) {
      if (error instanceof ErrorFinanzas) return c.json({ error: error.message }, 404);
      throw error;
    }
    return c.json({ ok: true });
  });
}
