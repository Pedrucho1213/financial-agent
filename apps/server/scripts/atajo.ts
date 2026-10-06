// Genera el Atajo "Finanzas" para probarlo a mano en la Mac.
// Uso: bun scripts/atajo.ts --servidor https://mi-mac.tu-red.ts.net --token fa_... --salida Finanzas.shortcut [--firmar]
//      bun scripts/atajo.ts --servidor ... --token ... --json   (imprime el plist como JSON)
// Sin --firmar escribe el plist XML; iOS solo importa el archivo firmado (--firmar, solo en macOS).
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { construirAtajo, ErrorFirma, firmarAtajo, generarAtajo } from "../src/atajo/generar";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    servidor: { type: "string" },
    token: { type: "string" },
    salida: { type: "string" },
    firmar: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

function salir(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

if (!values.servidor || !values.token) {
  salir("Uso: bun scripts/atajo.ts --servidor URL --token TOKEN --salida archivo.shortcut [--firmar] [--json]");
}
if (!values.salida && !values.json) salir("Falta --salida (o --json para solo verlo).");

const opciones = { servidor: values.servidor, token: values.token };
try {
  if (values.json) console.log(JSON.stringify(construirAtajo(opciones), null, 2));
  if (values.salida) {
    const xml = generarAtajo(opciones);
    const contenido = values.firmar ? await firmarAtajo(xml) : xml;
    await writeFile(values.salida, contenido);
    console.error(values.firmar ? `Atajo firmado en ${values.salida}` : `Atajo sin firmar en ${values.salida} (agrega --firmar en la Mac)`);
  }
} catch (error) {
  if (error instanceof ErrorFirma) salir(`No se pudo firmar: ${error.message}`);
  salir((error as Error).message);
}
