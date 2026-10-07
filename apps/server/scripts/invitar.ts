// Código de invitación para entrar a la app desde un iPhone o navegador nuevo.
// Uso: bun run invitar -- --usuario pedro [--url https://finanzas.tu-red.ts.net] [--atajo]
// Con --usuario (o --nombre) el código entra a la cuenta de esa persona, así la app no pregunta el
// nombre. Para crear la cuenta de alguien más: --nombre Ana --nueva. Sin ninguno de los dos, quien lo
// use escribe su nombre y se crea su cuenta.
// Con --atajo saca otro código para el enlace que instala el Atajo directo (/instalar?codigo=...).
// Cada código sirve una sola vez y vence en 24 horas (--horas para cambiarlo).
import { parseArgs } from "node:util";
import { crearInvitacion } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { buscarCuenta } from "./cuenta";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    usuario: { type: "string" },
    nombre: { type: "string" },
    nueva: { type: "boolean", default: false },
    horas: { type: "string", default: "24" },
    url: { type: "string" },
    atajo: { type: "boolean", default: false },
  },
});

if (values.atajo && !values.usuario && !values.nombre?.trim()) {
  console.error("Para el enlace del Atajo hace falta --usuario o --nombre: el Atajo entra a la cuenta de esa persona.");
  process.exit(1);
}
const db = abrirBaseDatos(config.baseDatos);
const encontrada = buscarCuenta(db, values);
const usuario = encontrada?.cuenta;
const nuevo = !!encontrada?.nueva;
const invitacion = crearInvitacion(db, { usuarioId: usuario?.id, horas: Number(values.horas) || 24 });
const vence = new Date(invitacion.expiraEn).toLocaleString("es-MX", { timeZone: config.zonaHoraria });

console.log(`Código: ${invitacion.codigo}`);
if (!usuario) console.log("Crea una cuenta nueva al usarlo.");
else console.log(nuevo ? `Creé la cuenta de ${usuario.nombre}; el código entra a ella.` : `Agrega un dispositivo a la cuenta de ${usuario.nombre}.`);
console.log(`Vence el ${vence} y sirve una sola vez.`);
const base = values.url?.replace(/\/+$/, "");
if (base) console.log(`Ábrelo en el iPhone: ${base}/?codigo=${invitacion.codigo}`);
if (values.atajo) {
  const atajo = crearInvitacion(db, { usuarioId: usuario!.id, horas: Number(values.horas) || 24 });
  console.log(`Código del Atajo: ${atajo.codigo}`);
  if (base) console.log(`Instala el Atajo: ${base}/instalar?codigo=${atajo.codigo}`);
}
