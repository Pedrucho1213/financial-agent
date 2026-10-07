// Prepara la base de datos y crea un usuario con el token para su iPhone.
// Uso: bun run setup -- --nombre Pedro --dispositivo "iPhone de Pedro"
// Si la cuenta ya existe (por --usuario, o por --nombre), solo agrega un dispositivo nuevo. Con otras
// cuentas en la base, una nueva se crea solo con --nueva.
import { parseArgs } from "node:util";
import { crearDispositivo } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { buscarCuenta } from "./cuenta";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    usuario: { type: "string" },
    nombre: { type: "string", default: "Yo" },
    nueva: { type: "boolean", default: false },
    dispositivo: { type: "string", default: "iPhone" },
  },
});

const db = abrirBaseDatos(config.baseDatos);
const usuario = buscarCuenta(db, values)!.cuenta;
sembrarCategorias(db, usuario.id);
const token = crearDispositivo(db, usuario.id, values.dispositivo!);

console.log(`
Base de datos: ${config.baseDatos}
Usuario: ${usuario.nombre}
Dispositivo: ${values.dispositivo}

Token (cópialo al Atajo; no se vuelve a mostrar):
${token}
`);
