// Encuentra la cuenta a la que va un script (invitar, setup). El nombre de saludo se puede cambiar en la
// app, así que --usuario es lo seguro; --nombre también acepta el usuario sacado del nombre ("Pedro" →
// "pedro"). Solo crea una cuenta si no hay ninguna o si se pide con --nueva, para no hacer otra vacía
// por un nombre que ya cambió.
import { eq, sql } from "drizzle-orm";
import { crearUsuario, normalizarUsuario, validarNombre } from "../src/auth";
import type { Db } from "../src/db/client";
import { usuarios } from "../src/db/schema";
import { sembrarCategorias } from "../src/finanzas/catalogos";

export function buscarCuenta(db: Db, opciones: { usuario?: string; nombre?: string; nueva?: boolean }) {
  const salir = (mensaje: string): never => {
    console.error(mensaje);
    process.exit(1);
  };
  if (opciones.usuario) {
    const cuenta = db.select().from(usuarios).where(eq(usuarios.usuario, normalizarUsuario(opciones.usuario))).get();
    return cuenta ? { cuenta, nueva: false } : salir(`No hay ninguna cuenta con el usuario "${opciones.usuario}".`);
  }
  const nombre = opciones.nombre?.trim();
  if (!nombre) return undefined;
  const porNombre = db.select().from(usuarios).where(eq(usuarios.nombre, nombre)).all();
  if (porNombre.length > 1) salir(`Hay ${porNombre.length} cuentas que se llaman "${nombre}". Usa --usuario para elegir una.`);
  const cuenta = porNombre[0] ?? db.select().from(usuarios).where(eq(usuarios.usuario, normalizarUsuario(nombre))).get();
  if (cuenta) return { cuenta, nueva: false };
  const hay = db.select({ n: sql<number>`count(*)` }).from(usuarios).get()!.n > 0;
  if (hay && !opciones.nueva) {
    salir(`No hay ninguna cuenta que se llame "${nombre}". Si ya existe con otro nombre, usa --usuario; para crear otra, agrega --nueva.`);
  }
  let valido = nombre;
  try {
    valido = validarNombre(nombre);
  } catch (error) {
    salir((error as Error).message);
  }
  const nueva = crearUsuario(db, valido);
  sembrarCategorias(db, nueva.id);
  return { cuenta: nueva, nueva: true };
}
