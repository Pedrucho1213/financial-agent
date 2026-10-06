import { crearUsuario } from "../src/auth";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { crearContexto } from "../src/finanzas/contexto";

// Miércoles 7 de octubre de 2026, 10:00 en Ciudad de México.
export const AHORA = new Date("2026-10-07T16:00:00Z");

export function preparar(opciones: { ahora?: Date; entradaId?: string } = {}) {
  const db = abrirBaseDatos(":memory:");
  const usuario = crearUsuario(db, "Pedro");
  sembrarCategorias(db, usuario.id);
  const ctx = crearContexto({
    db,
    usuarioId: usuario.id,
    zonaHoraria: "America/Mexico_City",
    monedaBase: "MXN",
    ahora: opciones.ahora ?? AHORA,
    entradaId: opciones.entradaId,
  });
  return { db, usuario, ctx };
}
