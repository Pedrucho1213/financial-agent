// Prepara la base de datos y crea un usuario con el token para su iPhone.
// Uso: bun run setup -- --nombre Pedro --dispositivo "iPhone de Pedro"
// Si el usuario ya existe, solo agrega un dispositivo nuevo.
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { crearDispositivo, crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { usuarios } from "../src/db/schema";
import { sembrarCategorias } from "../src/finanzas/catalogos";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    nombre: { type: "string", default: "Yo" },
    dispositivo: { type: "string", default: "iPhone" },
  },
});

const db = abrirBaseDatos(config.baseDatos);
const usuario =
  db.select().from(usuarios).where(eq(usuarios.nombre, values.nombre!)).get() ?? crearUsuario(db, values.nombre!);
sembrarCategorias(db, usuario.id);
const token = crearDispositivo(db, usuario.id, values.dispositivo!);

console.log(`
Base de datos: ${config.baseDatos}
Usuario: ${usuario.nombre}
Dispositivo: ${values.dispositivo}

Token (cópialo al Atajo; no se vuelve a mostrar):
${token}
`);
