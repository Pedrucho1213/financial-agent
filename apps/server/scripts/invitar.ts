// Código de invitación para entrar a la app desde un iPhone o navegador nuevo.
// Uso: bun run invitar -- --nombre Pedro
// Si Pedro ya existe, el código agrega otro dispositivo a su cuenta; si no, crea la cuenta al usarlo.
// Sirve una sola vez y vence en 24 horas (--horas para cambiarlo).
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { crearInvitacion } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { usuarios } from "../src/db/schema";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    nombre: { type: "string" },
    horas: { type: "string", default: "24" },
    url: { type: "string" },
  },
});

const db = abrirBaseDatos(config.baseDatos);
const usuario = values.nombre
  ? db.select().from(usuarios).where(eq(usuarios.nombre, values.nombre)).get()
  : undefined;
const invitacion = crearInvitacion(db, { usuarioId: usuario?.id, horas: Number(values.horas) || 24 });
const vence = new Date(invitacion.expiraEn).toLocaleString("es-MX", { timeZone: config.zonaHoraria });

console.log(`Código: ${invitacion.codigo}`);
console.log(usuario ? `Agrega un dispositivo a la cuenta de ${usuario.nombre}.` : "Crea una cuenta nueva al usarlo.");
console.log(`Vence: ${vence}. Sirve una sola vez.`);
if (values.url) console.log(`Ábrelo en el iPhone: ${values.url.replace(/\/+$/, "")}/?codigo=${invitacion.codigo}`);
