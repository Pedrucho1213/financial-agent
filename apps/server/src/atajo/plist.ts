// Property list XML de Apple, el formato de un archivo .shortcut antes de firmarlo.
// Sin dependencias: diccionarios, listas, texto, enteros, reales, booleanos y datos binarios.

/** Fuerza `<real>` para un número sin decimales (1 se escribiría como `<integer>`). */
export class Real {
  constructor(readonly valor: number) {}
}

export const real = (valor: number) => new Real(valor);

export type ValorPlist =
  | string
  | number
  | bigint
  | boolean
  | Uint8Array
  | Real
  | ValorPlist[]
  | { [clave: string]: ValorPlist | undefined };

// XML 1.0 no admite estos caracteres ni escapados; un plist con ellos no se puede abrir.
const PROHIBIDOS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const ENTIDADES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;", "\r": "&#13;" };

/** Escapa texto para un nodo XML. Falla si trae caracteres que XML no permite. */
export function escaparXml(texto: string): string {
  const malo = PROHIBIDOS.exec(texto);
  if (malo) {
    const codigo = malo[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
    throw new Error(`El texto tiene un carácter que no cabe en un plist (U+${codigo}).`);
  }
  return texto.replace(/[&<>"'\r]/g, (c) => ENTIDADES[c]!);
}

function numero(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Número inválido para un plist: ${n}.`);
  return Number.isSafeInteger(n) ? `<integer>${n}</integer>` : `<real>${n}</real>`;
}

function escribir(valor: ValorPlist, sangria: string, lineas: string[]): void {
  if (typeof valor === "string") {
    lineas.push(valor === "" ? `${sangria}<string></string>` : `${sangria}<string>${escaparXml(valor)}</string>`);
  } else if (typeof valor === "number") {
    lineas.push(sangria + numero(valor));
  } else if (typeof valor === "bigint") {
    lineas.push(`${sangria}<integer>${valor}</integer>`);
  } else if (typeof valor === "boolean") {
    lineas.push(`${sangria}<${valor}/>`);
  } else if (valor instanceof Real) {
    if (!Number.isFinite(valor.valor)) throw new Error(`Número inválido para un plist: ${valor.valor}.`);
    lineas.push(`${sangria}<real>${valor.valor}</real>`);
  } else if (valor instanceof Uint8Array) {
    lineas.push(`${sangria}<data>${Buffer.from(valor).toString("base64")}</data>`);
  } else if (Array.isArray(valor)) {
    if (valor.length === 0) return void lineas.push(`${sangria}<array/>`);
    lineas.push(`${sangria}<array>`);
    for (const elemento of valor) escribir(elemento, sangria + "\t", lineas);
    lineas.push(`${sangria}</array>`);
  } else if (valor !== null && typeof valor === "object") {
    // Como lo escribe Apple: claves en orden y sin las que no tienen valor.
    const claves = Object.keys(valor)
      .filter((clave) => valor[clave] !== undefined)
      .sort();
    if (claves.length === 0) return void lineas.push(`${sangria}<dict/>`);
    lineas.push(`${sangria}<dict>`);
    for (const clave of claves) {
      lineas.push(`${sangria}\t<key>${escaparXml(clave)}</key>`);
      escribir(valor[clave]!, sangria + "\t", lineas);
    }
    lineas.push(`${sangria}</dict>`);
  } else {
    throw new Error(`Valor que no cabe en un plist: ${String(valor)}.`);
  }
}

/** Serializa `raiz` como plist XML (UTF-8, con la declaración y el DOCTYPE de Apple). */
export function aPlistXml(raiz: ValorPlist): string {
  const lineas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
  ];
  escribir(raiz, "", lineas);
  lineas.push("</plist>", "");
  return lineas.join("\n");
}
