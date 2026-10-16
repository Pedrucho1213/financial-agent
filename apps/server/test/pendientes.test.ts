import { describe, expect, test } from "bun:test";
import { avisos } from "../src/db/schema";
import { avisoDelDia, avisosPorEnviar, guardarAviso, listarAvisos } from "../src/finanzas/avisos";
import { guardarPendiente, resolverPendiente } from "../src/finanzas/pendientes";
import { preparar } from "./ayuda";

const pendiente = (conversacionId: string, texto = "¿Cuánto fue y en dónde?") => ({
  conversacionId,
  titulo: "¿Cuánto pagaste con Apple Pay?",
  texto,
  zonaHoraria: "America/Mexico_City",
});

describe("pendientes", () => {
  test("van primero, siguen aunque sean viejos o ya los haya visto, y se van al resolverlos", () => {
    const { db, usuario, ctx } = preparar();
    guardarAviso(ctx, { tipo: "hormiga", clave: "h1", titulo: "Cafés", texto: "Llevas 12 cafés." });
    guardarPendiente(db, usuario.id, pendiente("c1"));
    // De hace dos semanas y ya leído: un aviso normal ya no saldría; lo pendiente sí.
    db.update(avisos).set({ fecha: "2026-09-20", leidoEn: new Date().toISOString() }).run();
    guardarAviso(ctx, { tipo: "meta", clave: "m1", titulo: "Meta", texto: "Vas bien." });
    expect(listarAvisos(ctx).avisos.map((a) => a.tipo)).toEqual(["pendiente", "meta"]);
    expect(resolverPendiente(db, usuario.id, "c1")).toBe(true);
    expect(resolverPendiente(db, usuario.id, "c1")).toBe(false);
    expect(listarAvisos(ctx, { todos: true }).avisos.map((a) => a.tipo)).toEqual(["meta"]);
  });

  test("la misma conversación es un solo pendiente; si vuelve a preguntar, reaparece con lo último", () => {
    const { db, usuario, ctx } = preparar();
    guardarPendiente(db, usuario.id, pendiente("c1"));
    resolverPendiente(db, usuario.id, "c1");
    guardarPendiente(db, usuario.id, pendiente("c1", "¿Con cuál tarjeta pagaste: Revolut o Revolut crédito?"));
    const lista = listarAvisos(ctx).avisos;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toEqual(
      expect.objectContaining({ texto: "¿Con cuál tarjeta pagaste: Revolut o Revolut crédito?", enlace: "#chat?conversacion=c1", prioridad: 1, leidoEn: null }),
    );
  });

  test("no los dice el Atajo ni los repite la notificación de la mañana: ya salieron al momento", () => {
    const { db, usuario, ctx } = preparar({ ahora: new Date() });
    guardarPendiente(db, usuario.id, pendiente("c1"));
    expect(avisoDelDia(ctx)).toBeUndefined();
    expect(avisosPorEnviar(db, "America/Mexico_City")).toHaveLength(0);
  });

  test("cada cuenta ve solo los suyos", () => {
    const { db, usuario, ctx } = preparar();
    guardarPendiente(db, usuario.id, pendiente("c1"));
    expect(resolverPendiente(db, "otra-cuenta", "c1")).toBe(false);
    expect(listarAvisos(ctx).avisos).toHaveLength(1);
  });
});
