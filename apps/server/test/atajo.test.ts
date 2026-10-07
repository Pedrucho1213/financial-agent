import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHIVO_BIENVENIDA,
  ARCHIVO_COLA,
  ARCHIVO_COLA_APPLE_PAY,
  construirAtajo,
  ErrorFirma,
  firmarAtajo,
  generarAtajo,
  generarAtajoApplePay,
  guionBienvenida,
  NOMBRE_ATAJO_APPLE_PAY,
  PROPIEDADES_TRANSACCION,
  PALABRAS_PARA_TERMINAR,
  QUIERE_EXPLICACION,
} from "../src/atajo/generar";
import { aPlistXml, escaparXml, real } from "../src/atajo/plist";

// Pruebas del Atajo generado: XML válido, referencias y bloques bien formados, y el comportamiento sin conexión.

type Valor = string | number | boolean | Uint8Array | Valor[] | { [clave: string]: Valor };
type Dict = { [clave: string]: Valor };
type Accion = { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: Dict };

/** Lector mínimo de plist XML: falla con cualquier cosa que no sea un plist bien formado. */
function leerPlist(xml: string): Valor {
  let i = 0;
  const entidad = (texto: string) =>
    texto.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e]!;
    });
  const espacios = () => {
    while (/\s/.test(xml[i] ?? "")) i++;
  };
  const etiqueta = () => {
    espacios();
    const m = /^<(\/?)([a-z]+)( version="1\.0")?\s*(\/?)>/.exec(xml.slice(i));
    if (!m) throw new Error(`Se esperaba una etiqueta en ${i}: ${xml.slice(i, i + 40)}`);
    i += m[0].length;
    return { cierra: m[1] === "/", nombre: m[2]!, vacia: m[4] === "/" };
  };
  const contenido = (nombre: string) => {
    const fin = xml.indexOf(`</${nombre}>`, i);
    if (fin < 0) throw new Error(`Falta </${nombre}>`);
    const texto = xml.slice(i, fin);
    if (/[<>]/.test(texto) || /&(?!(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.test(texto)) {
      throw new Error(`Texto mal escapado en <${nombre}>: ${texto.slice(0, 40)}`);
    }
    i = fin + nombre.length + 3;
    return entidad(texto);
  };
  const valor = (): Valor => {
    const { cierra, nombre, vacia } = etiqueta();
    if (cierra) throw new Error(`Cierre inesperado </${nombre}>`);
    switch (nombre) {
      case "true":
      case "false":
        if (!vacia) throw new Error(`<${nombre}> debe ser vacía`);
        return nombre === "true";
      case "string":
        return vacia ? "" : contenido("string");
      case "integer": {
        const t = contenido("integer");
        if (!/^-?\d+$/.test(t)) throw new Error(`Entero inválido: ${t}`);
        return Number(t);
      }
      case "real": {
        const n = Number(contenido("real"));
        if (!Number.isFinite(n)) throw new Error("Real inválido");
        return n;
      }
      case "data":
        return new Uint8Array(Buffer.from(contenido("data"), "base64"));
      case "array": {
        const lista: Valor[] = [];
        if (vacia) return lista;
        for (;;) {
          espacios();
          if (xml.startsWith("</array>", i)) return (i += 8), lista;
          lista.push(valor());
        }
      }
      case "dict": {
        const dict: Dict = {};
        if (vacia) return dict;
        for (;;) {
          espacios();
          if (xml.startsWith("</dict>", i)) return (i += 7), dict;
          const clave = etiqueta();
          if (clave.nombre !== "key" || clave.cierra) throw new Error("Se esperaba <key>");
          const k = contenido("key");
          if (k in dict) throw new Error(`Clave repetida: ${k}`);
          dict[k] = valor();
        }
      }
      default:
        throw new Error(`Etiqueta desconocida <${nombre}>`);
    }
  };
  const encabezado = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n';
  if (!xml.startsWith(encabezado)) throw new Error("Falta la declaración XML o el DOCTYPE");
  i = encabezado.length;
  const plist = etiqueta();
  if (plist.nombre !== "plist") throw new Error("Falta <plist>");
  const raiz = valor();
  const cierre = etiqueta();
  if (!cierre.cierra || cierre.nombre !== "plist") throw new Error("Falta </plist>");
  espacios();
  if (i !== xml.length) throw new Error("Sobra contenido después de </plist>");
  return raiz;
}

/** Todos los valores anidados de un parámetro, con su clave. */
function* recorrer(valor: Valor, clave = ""): Generator<[string, Valor]> {
  yield [clave, valor];
  if (Array.isArray(valor)) for (const v of valor) yield* recorrer(v, clave);
  else if (valor && typeof valor === "object" && !(valor instanceof Uint8Array)) {
    for (const [k, v] of Object.entries(valor)) yield* recorrer(v, k);
  }
}

const SERVIDOR = "https://macbook-de-pedro.tu-red.ts.net";
const TOKEN = "fa_prueba123";
const atajo = leerPlist(generarAtajo({ servidor: SERVIDOR, token: TOKEN, nombre: "Pedro Ramírez" })) as Dict;
const acciones = atajo.WFWorkflowActions as unknown as Accion[];
const id = (a: Accion) => a.WFWorkflowActionIdentifier.replace("is.workflow.actions.", "");
const indice = (identificador: string) => acciones.findIndex((a) => id(a) === identificador);
const parametros = (a: Accion) => a.WFWorkflowActionParameters;

// Acciones verificadas en las definiciones de Atajos (WFActions.plist vía ScPL) y en Cherri.
const PERMITIDAS = new Set([
  "comment", "gettext", "setvariable", "repeat.count", "repeat.each", "conditional", "exit",
  "dictatetext", "text.match", "text.replace", "date", "format.date", "number.random",
  "dictionary", "setitemname", "documentpicker.save", "documentpicker.open", "detect.text", "text.split",
  "text.combine", "appendvariable", "getcurrentlocation", "properties.locations", "downloadurl", "getvalueforkey",
  "speaktext",
]);
const BLOQUES = new Set(["conditional", "repeat.count", "repeat.each"]);

describe("plist", () => {
  test("escapa XML y escribe cada tipo", () => {
    const xml = aPlistXml({
      texto: `a&b<c>"d"'e'`,
      vacio: "",
      entero: 42,
      negativo: -7,
      real: 1.5,
      realForzado: real(2),
      si: true,
      no: false,
      datos: new Uint8Array([0, 1, 254, 255]),
      lista: [1, "dos", []],
      dict: {},
      sinValor: undefined,
    });
    expect(xml).toContain("<string>a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;</string>");
    expect(xml).toContain("<real>2</real>");
    expect(xml).toContain("<data>AAH+/w==</data>");
    expect(xml).not.toContain("sinValor");
    const leido = leerPlist(xml) as Dict;
    expect(leido.texto).toBe(`a&b<c>"d"'e'`);
    expect(leido.vacio).toBe("");
    expect(leido.entero).toBe(42);
    expect(leido.negativo).toBe(-7);
    expect(leido.real).toBe(1.5);
    expect(leido.si).toBe(true);
    expect(leido.no).toBe(false);
    expect(leido.datos).toEqual(new Uint8Array([0, 1, 254, 255]));
    expect(leido.lista).toEqual([1, "dos", []]);
    expect(leido.dict).toEqual({});
  });

  test("ordena las claves como Apple y conserva texto no ASCII", () => {
    const xml = aPlistXml({ b: 1, a: "¿Cuánto llevo? ￼ 😀" });
    expect(xml.indexOf("<key>a</key>")).toBeLessThan(xml.indexOf("<key>b</key>"));
    expect((leerPlist(xml) as Dict).a).toBe("¿Cuánto llevo? ￼ 😀");
  });

  test("rechaza lo que XML no permite", () => {
    expect(() => escaparXml("hola\u0000")).toThrow("U+0000");
    expect(() => escaparXml("\uD800")).toThrow();
    expect(() => aPlistXml({ n: Number.NaN })).toThrow();
    expect(escaparXml("línea\r\nnueva")).toBe("línea&#13;\nnueva");
  });
});

describe("generarAtajo", () => {
  test("es un plist de Atajo con los metadatos de uno exportado", () => {
    expect(atajo.WFWorkflowName).toBe("Finanzas");
    expect(Number.parseFloat(atajo.WFWorkflowClientVersion as string)).toBeGreaterThan(2700);
    expect(atajo.WFWorkflowMinimumClientVersion).toBe(900);
    expect(atajo.WFWorkflowMinimumClientVersionString).toBe("900");
    expect(atajo.WFWorkflowImportQuestions).toEqual([]);
    expect(atajo.WFWorkflowHasOutputFallback).toBe(false);
    expect(atajo.WFWorkflowIcon).toEqual({ WFWorkflowIconGlyphNumber: 59395, WFWorkflowIconStartColor: 4292093695 });
    expect(acciones.length).toBeGreaterThan(50);
  });

  test("solo usa acciones conocidas", () => {
    for (const a of acciones) {
      expect(a.WFWorkflowActionIdentifier.startsWith("is.workflow.actions.")).toBe(true);
      expect(PERMITIDAS.has(id(a))).toBe(true);
    }
  });

  test("cada OutputUUID apunta a una acción anterior con ese UUID y el mismo nombre", () => {
    const vistos = new Map<string, string>();
    let referencias = 0;
    for (const a of acciones) {
      const p = parametros(a);
      for (const [, v] of recorrer(p)) {
        if (v && typeof v === "object" && !Array.isArray(v) && (v as Dict).Type === "ActionOutput") {
          const ref = v as Dict;
          referencias++;
          expect(vistos.has(ref.OutputUUID as string)).toBe(true);
          expect(vistos.get(ref.OutputUUID as string)).toBe(ref.OutputName as string);
        }
      }
      if (typeof p.UUID === "string") {
        expect(vistos.has(p.UUID)).toBe(false);
        vistos.set(p.UUID, (p.CustomOutputName as string) ?? "");
      }
    }
    expect(referencias).toBeGreaterThan(30);
  });

  test("cada bloque Repetir/Si abre y cierra con el mismo GroupingIdentifier", () => {
    const pila: { identificador: string; grupo: string }[] = [];
    const usados = new Set<string>();
    for (const a of acciones) {
      const p = parametros(a);
      if (!BLOQUES.has(id(a))) {
        expect(p.GroupingIdentifier).toBeUndefined();
        continue;
      }
      const grupo = p.GroupingIdentifier as string;
      expect(typeof grupo).toBe("string");
      if (p.WFControlFlowMode === 0) {
        expect(usados.has(grupo)).toBe(false);
        usados.add(grupo);
        pila.push({ identificador: id(a), grupo });
      } else {
        expect(pila.at(-1)).toEqual({ identificador: id(a), grupo });
        expect(id(a)).toBe(p.WFControlFlowMode === 1 ? "conditional" : id(a));
        expect([1, 2]).toContain(p.WFControlFlowMode as number);
        if (p.WFControlFlowMode === 2) pila.pop();
      }
    }
    expect(pila).toEqual([]);
  });

  test("las condiciones de Si usan 'tiene algún valor' o 'no tiene ningún valor' sobre una variable", () => {
    const aperturas = acciones.filter((a) => id(a) === "conditional" && parametros(a).WFControlFlowMode === 0);
    expect(aperturas.length).toBeGreaterThan(10);
    for (const a of aperturas) {
      const p = parametros(a);
      expect([100, 101]).toContain(p.WFCondition as number);
      expect((p.WFInput as Dict).Type).toBe("Variable");
      expect(((p.WFInput as Dict).Variable as Dict).WFSerializationType).toBe("WFTextTokenAttachment");
    }
  });

  test("las variables intercaladas en un texto caen sobre un U+FFFC", () => {
    let textos = 0;
    for (const a of acciones) {
      for (const [, v] of recorrer(parametros(a))) {
        if (!v || typeof v !== "object" || (v as Dict).WFSerializationType !== "WFTextTokenString") continue;
        const { string: cadena, attachmentsByRange: adjuntos = {} } = (v as Dict).Value as Dict;
        const posiciones = Object.keys(adjuntos as Dict).map((rango) => Number(/^\{(\d+), 1\}$/.exec(rango)![1]));
        const marcas = [...(cadena as string)].flatMap((c, k, todos) =>
          c === "￼" ? [todos.slice(0, k).join("").length] : [],
        );
        expect(posiciones.sort((x, y) => x - y)).toEqual(marcas);
        textos++;
      }
    }
    expect(textos).toBeGreaterThan(20);
  });

  test("el elemento de Repetir con cada lleva el número de su anidamiento", () => {
    // La cola se recorre dentro de "Repetir 10 veces": el elemento es "Repeat Item 2".
    const abre = acciones.findIndex((a) => id(a) === "repeat.each" && parametros(a).WFControlFlowMode === 0);
    expect(abre).toBeGreaterThan(indice("repeat.count"));
    const linea = acciones.find((a) => id(a) === "setvariable" && parametros(a).WFVariableName === "Línea")!;
    expect(parametros(linea).WFInput).toEqual({
      Value: { Type: "Variable", VariableName: "Repeat Item 2" },
      WFSerializationType: "WFTextTokenAttachment",
    });
    expect(JSON.stringify(acciones)).not.toContain('"VariableName":"Repeat Item"');
  });

  test("las variables con nombre que se leen se establecen en algún lado", () => {
    const establecidas = new Set(acciones.filter((a) => id(a) === "setvariable").map((a) => parametros(a).WFVariableName));
    const leidas = new Set<string>();
    for (const a of acciones) {
      for (const [, v] of recorrer(parametros(a))) {
        if (v && typeof v === "object" && (v as Dict).Type === "Variable" && typeof (v as Dict).VariableName === "string") {
          leidas.add((v as Dict).VariableName as string);
        }
      }
    }
    for (const nombre of leidas) if (/^Repeat Item( \d+)?$/.test(nombre)) leidas.delete(nombre); // las pone Repetir con cada
    leidas.delete("Quedan"); // la llena "Agregar a variable"
    for (const nombre of leidas) expect(establecidas.has(nombre)).toBe(true);
  });

  test("la dirección y el token van adentro y escapados", () => {
    const token = `fa_&<>"'x`;
    const xml = generarAtajo({ servidor: "https://ejemplo.ts.net/", token });
    expect(xml).toContain("<string>https://ejemplo.ts.net/v1/hablar</string>");
    expect(xml).toContain("<string>Bearer fa_&amp;&lt;&gt;&quot;&apos;x</string>");
    expect(xml).not.toContain(token);
    const leido = leerPlist(xml) as Dict;
    const textos = [...recorrer(leido)].map(([, v]) => v).filter((v) => typeof v === "string");
    expect(textos.filter((t) => t === `Bearer ${token}`)).toHaveLength(4); // hablar, entradas, reenvío y bienvenida
    expect(textos.filter((t) => t === "https://ejemplo.ts.net/v1/hablar")).toHaveLength(2);
    expect(textos).toContain("https://ejemplo.ts.net/v1/entradas/￼?esperar_ms=45000");
  });

  test("rechaza datos que romperían el Atajo", () => {
    expect(() => generarAtajo({ servidor: "no es una url", token: TOKEN })).toThrow();
    expect(() => generarAtajo({ servidor: "ftp://ejemplo.ts.net", token: TOKEN })).toThrow();
    expect(() => generarAtajo({ servidor: SERVIDOR, token: "con espacio" })).toThrow();
    expect(() => generarAtajo({ servidor: SERVIDOR, token: "" })).toThrow();
  });

  test("da el mismo archivo con los mismos datos", () => {
    expect(generarAtajo({ servidor: SERVIDOR, token: TOKEN })).toBe(generarAtajo({ servidor: SERVIDOR, token: TOKEN }));
  });
});

describe("comportamiento", () => {
  const destino = (a: Accion) => {
    const d = parametros(a).WFFileDestinationPath;
    return typeof d === "string" ? d : (((d as Dict).Value as Dict).string as string);
  };
  // Los de la cola; el otro guardado es la marca de la bienvenida.
  const guardados = acciones.flatMap((a, k) => (id(a) === "documentpicker.save" && destino(a) === ARCHIVO_COLA ? [k] : []));
  /** La acción cuya salida va en este adjunto (una variable sola como entrada). */
  const fuente = (adjunto: Dict) => acciones.find((a) => parametros(a).UUID === (adjunto.Value as Dict).OutputUUID)!;
  /** Los Si y Repetir abiertos justo antes de la acción k, del más externo al más interno. */
  const abiertosEn = (k: number) => {
    const abiertos: Accion[] = [];
    for (const a of acciones.slice(0, k)) {
      const p = parametros(a);
      if (!BLOQUES.has(id(a))) continue;
      if (p.WFControlFlowMode === 0) abiertos.push(a);
      if (p.WFControlFlowMode === 2) abiertos.pop();
    }
    return abiertos;
  };
  /** Si la acción k está en la rama "De lo contrario" del Si que la encierra más de cerca. */
  const enDeLoContrario = (k: number, si: Accion) => {
    const grupo = parametros(si).GroupingIdentifier;
    return acciones.slice(acciones.indexOf(si), k).some((a) => parametros(a).GroupingIdentifier === grupo && parametros(a).WFControlFlowMode === 1);
  };

  test("nada que use la red corre antes de guardar el dictado", () => {
    const primerGuardado = guardados[0]!;
    const turnos = indice("repeat.count");
    expect(primerGuardado).toBeGreaterThan(turnos);
    // La única red antes de los turnos es el saludo de la bienvenida (ver "bienvenida").
    for (const red of ["downloadurl", "getcurrentlocation", "properties.locations"]) {
      expect(acciones.findIndex((a, k) => k > turnos && id(a) === red)).toBeGreaterThan(primerGuardado);
    }
    // Y cada envío a /v1/hablar manda un archivo.
    const envios = acciones.filter((x) => id(x) === "downloadurl" && parametros(x).WFHTTPMethod === "POST");
    expect(envios).toHaveLength(2); // el dictado y los pendientes de antes
    for (const a of envios) {
      const p = parametros(a);
      expect(p.WFHTTPBodyType).toBe("File");
      expect(p.Advanced).toBe(true);
      expect(id(fuente(p.WFRequestVariable as Dict))).toBe("setitemname");
      const encabezados = ((p.WFHTTPHeaders as Dict).Value as Dict).WFDictionaryFieldValueItems as Dict[];
      const pares = encabezados.map((e) => [((e.WFKey as Dict).Value as Dict).string, ((e.WFValue as Dict).Value as Dict).string]);
      expect(pares).toEqual([
        ["Authorization", `Bearer ${TOKEN}`],
        ["Content-Type", "application/json"],
      ]);
    }
  });

  test("nunca borra archivos: la cola es un solo archivo que se sobrescribe", () => {
    // Desde iOS 17 cada borrado pide confirmación; por eso no hay ninguno.
    expect(acciones.some((a) => id(a).startsWith("file."))).toBe(false);
    // Antes de enviar (sin ubicación y con ubicación) y al quitar lo que ya llegó.
    expect(guardados).toHaveLength(3);
    for (const k of guardados) {
      const p = parametros(acciones[k]!);
      expect(p).toMatchObject({ WFAskWhereToSave: false, WFSaveFileOverwrite: true, WFFileDestinationPath: ARCHIVO_COLA });
      const archivo = fuente(p.WFInput as Dict);
      expect(id(archivo)).toBe("setitemname");
      expect(parametros(archivo).WFName).toBe("Finanzas-cola.txt");
    }
  });

  test("la cola se lee sin selector antes de guardar y el dictado se agrega al final", () => {
    const leer = acciones.findIndex((a) => id(a) === "documentpicker.open" && parametros(a).WFGetFilePath === ARCHIVO_COLA);
    expect(leer).toBeGreaterThan(indice("dictatetext"));
    expect(leer).toBeLessThan(guardados[0]!);
    expect(parametros(acciones[leer]!)).toMatchObject({ WFShowFilePicker: false, WFFileErrorIfNotFound: false });
    const comoTexto = acciones[leer + 1]!;
    expect(id(comoTexto)).toBe("detect.text");
    for (const k of guardados.slice(0, 2)) {
      const contenido = fuente(parametros(fuente(parametros(acciones[k]!).WFInput as Dict)).WFInput as Dict);
      const texto = (parametros(contenido).WFTextActionText as Dict).Value as Dict;
      expect(texto.string).toBe("￼\n￼");
      const [previa, json] = Object.values(texto.attachmentsByRange as Dict) as Dict[];
      expect(previa!.OutputUUID).toBe(parametros(comoTexto).UUID);
      expect(json!.OutputName).toStartWith("JSON");
    }
  });

  test("la petición lleva los campos de la API", () => {
    const peticion = acciones.find((a) => id(a) === "dictionary" && parametros(a).CustomOutputName === "Petición")!;
    const campos = (((parametros(peticion).WFItems as Dict).Value as Dict).WFDictionaryFieldValueItems as Dict[]).map(
      (c) => ((c.WFKey as Dict).Value as Dict).string,
    );
    expect(campos.sort()).toEqual(["capturado_en", "client_id", "conversacion_id", "lat", "lon", "lugar", "texto"]);
  });

  test("la cola solo se reescribe si el servidor contestó JSON sin pedir reintentar", () => {
    const limpiar = guardados[2]!;
    expect(limpiar).toBeGreaterThan(indice("speaktext"));
    const [claves, reintentar] = abiertosEn(limpiar).slice(-2).reverse().map((a) => parametros(a));
    expect(claves!.WFCondition).toBe(100);
    expect(parametros(fuente((claves!.WFInput as Dict).Variable as Dict)).WFGetDictionaryValueType).toBe("All Keys");
    expect(reintentar!.WFCondition).toBe(101);
    expect(parametros(fuente((reintentar!.WFInput as Dict).Variable as Dict)).WFDictionaryKey).toBe("reintentar");
    // Un pendiente que el servidor no recibió vuelve a la cola: está en el "De lo contrario" de esas dos condiciones.
    const quedarse = acciones.flatMap((a, k) => (id(a) === "appendvariable" ? [k] : []));
    expect(quedarse).toHaveLength(2);
    for (const k of quedarse) {
      expect(parametros(acciones[k]!).WFVariableName).toBe("Quedan");
      expect(enDeLoContrario(k, abiertosEn(k).at(-1)!)).toBe(true);
    }
  });

  test("contesta y termina; solo sigue escuchando si el servidor manda seguir", () => {
    const seguir = acciones.filter((a) => id(a) === "getvalueforkey" && /^seguir/.test(parametros(a).CustomOutputName as string));
    expect(seguir.map((a) => parametros(a).WFDictionaryKey)).toEqual(["seguir", "seguir"]);
    // Al final de cada vuelta: Si "Seguir" no tiene valor, Salir.
    const fin = acciones.findLastIndex((a) => id(a) === "exit");
    const si = acciones[fin - 1]!;
    expect(id(si)).toBe("conditional");
    expect(parametros(si).WFCondition).toBe(101);
    expect(((parametros(si).WFInput as Dict).Variable as Dict).Value).toEqual({ Type: "Variable", VariableName: "Seguir" });
    expect(fin).toBeGreaterThan(guardados[2]!);
  });

  test("el silencio termina sin enviar nada", () => {
    const dictado = acciones.find((a) => id(a) === "dictatetext" && parametros(a).CustomOutputName === "Dictado")!;
    const palabras = acciones.findIndex((a) => parametros(a).CustomOutputName === "Palabras dichas");
    expect(acciones.indexOf(dictado)).toBe(palabras - 1);
    const si = acciones[palabras + 1]!;
    expect(parametros(si).WFCondition).toBe(101);
    const grupo = parametros(si).GroupingIdentifier;
    const deLoContrario = acciones.findIndex((a) => parametros(a).GroupingIdentifier === grupo && parametros(a).WFControlFlowMode === 1);
    const rama = acciones.slice(palabras + 2, deLoContrario);
    expect(rama.at(-1) && id(rama.at(-1)!)).toBe("exit");
    expect(rama.some((a) => ["downloadurl", "documentpicker.save"].includes(id(a)))).toBe(false);
  });

  test("dictado en español de México y respuesta en voz", () => {
    expect(parametros(acciones[indice("dictatetext")]!)).toMatchObject({
      WFSpeechLanguage: "es-MX",
      WFDictateTextStopListening: "After Pause",
    });
    for (const a of acciones.filter((x) => id(x) === "speaktext")) {
      expect(parametros(a)).toMatchObject({ WFSpeakTextLanguage: "es-MX", WFSpeakTextWait: true });
    }
    const repetir = acciones[indice("repeat.count")]!;
    expect(parametros(repetir).WFRepeatCount).toBe(10);
  });

  test("las palabras para terminar", () => {
    const patron = new RegExp(PALABRAS_PARA_TERMINAR, "i");
    for (const dicho of [
      "no", "Nada", "listo", "Listo.", "¡Listo!", "ya", "Es todo.", "gracias", " Gracias. ", "No, gracias.",
      "Ya es todo", "Eso es todo, gracias", "Nada más", "Adiós", "adios", "Terminé", "cancelar",
    ]) {
      expect(patron.test(dicho)).toBe(true);
    }
    for (const dicho of ["no sé cuánto gasté", "gasté 50 en tacos", "ya pagué la luz", "listo el súper 800", "Ok", "está bien", "sí"]) {
      expect(patron.test(dicho)).toBe(false);
    }
    const coincidir = acciones.find((a) => parametros(a).WFMatchTextPattern === PALABRAS_PARA_TERMINAR)!;
    expect(parametros(coincidir).WFMatchTextCaseSensitive).toBe(false);
  });
});

describe("bienvenida", () => {
  const leer = acciones.findIndex((a) => id(a) === "documentpicker.open" && parametros(a).WFGetFilePath === ARCHIVO_BIENVENIDA);
  const loop = indice("repeat.count");

  test("la primera vez pide el saludo al servidor, pregunta y después marca que ya saludó", () => {
    expect(leer).toBeGreaterThan(-1);
    expect(leer).toBeLessThan(loop);
    expect(parametros(acciones[leer]!)).toMatchObject({ WFShowFilePicker: false, WFFileErrorIfNotFound: false });
    const tramo = acciones.slice(leer, loop);
    // El nombre lo da el servidor (se puede cambiar sin reinstalar); el de la instalación queda de respaldo.
    const pedir = tramo.findIndex((a) => id(a) === "downloadurl");
    expect(parametros(tramo[pedir]!)).toMatchObject({ WFHTTPMethod: "GET", WFURL: `${SERVIDOR}/v1/atajo/bienvenida` });
    const respaldo = tramo.find((a) => parametros(a).CustomOutputName === "Saludo de siempre")!;
    expect(parametros(respaldo).WFTextActionText).toStartWith("¡Hola, Pedro! ");
    const dichos = tramo.filter((a) => id(a) === "speaktext").map((a) => parametros(a).WFText);
    const saludo = ((dichos[0] as Dict).Value as Dict).attachmentsByRange as Dict;
    expect(Object.values(saludo)).toEqual([{ Type: "Variable", VariableName: "Saludo" }]);
    // Sin red el Atajo se detiene al pedir el saludo: la marca va después, para intentarlo otra vez.
    expect(tramo.findIndex((a) => id(a) === "documentpicker.save")).toBeGreaterThan(pedir);
    expect(dichos).toContain(guionBienvenida().cierre);
    expect(dichos).toHaveLength(guionBienvenida().explicacion.length + 3);
    const marca = tramo.find((a) => id(a) === "documentpicker.save")!;
    expect(parametros(marca)).toMatchObject({ WFFileDestinationPath: ARCHIVO_BIENVENIDA, WFAskWhereToSave: false, WFSaveFileOverwrite: true });
    expect(tramo.some((a) => id(a) === "getcurrentlocation")).toBe(false);
    // Todo va dentro del Si "no existe la marca".
    const si = parametros(acciones[leer + 1]!);
    expect(si.WFCondition).toBe(101);
  });

  test("entiende un sí y no confunde un no ni un gasto", () => {
    const patron = new RegExp(QUIERE_EXPLICACION, "i");
    for (const dicho of ["Sí", "si", "¡Sí, cuéntame!", "Claro", "dale", "Va", "Ok", "Por favor", "Explícame", "Me gustaría"]) {
      expect(patron.test(dicho)).toBe(true);
    }
    for (const dicho of ["No", "no gracias", "empecemos", "gasté 50 en tacos", "", "ya"]) {
      expect(patron.test(dicho)).toBe(false);
    }
  });

  test("sin nombre saluda igual y solo usa el primer nombre", () => {
    expect(guionBienvenida().saludo).toStartWith("¡Hola! ");
    expect(guionBienvenida("  ana maría ").saludo).toStartWith("¡Hola, ana! ");
  });
});

describe("validación externa", () => {
  test("plistlib de Python lo abre", async () => {
    const python = Bun.which("python3");
    if (!python) return console.warn("Sin python3: se omite la validación con plistlib.");
    const carpeta = await mkdtemp(join(tmpdir(), "atajo-prueba-"));
    try {
      const archivo = join(carpeta, "Finanzas.shortcut");
      await writeFile(archivo, generarAtajo({ servidor: SERVIDOR, token: `fa_&<>"'x` }));
      const proceso = Bun.spawnSync([
        python,
        "-I",
        "-c",
        'import plistlib,sys; d=plistlib.load(open(sys.argv[1],"rb")); print(len(d["WFWorkflowActions"]))',
        archivo,
      ]);
      expect(proceso.stderr.toString()).toBe("");
      expect(proceso.exitCode).toBe(0);
      expect(Number(proceso.stdout.toString().trim())).toBe(acciones.length);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });
});

describe("firmarAtajo", () => {
  test.skipIf(process.platform === "darwin")("fuera de macOS falla con ErrorFirma", async () => {
    const xml = generarAtajo({ servidor: SERVIDOR, token: TOKEN });
    await expect(firmarAtajo(xml)).rejects.toBeInstanceOf(ErrorFirma);
    await expect(firmarAtajo(xml)).rejects.toThrow("Mac");
  });

  // Un `shortcuts` falso (script de sh) para probar la llamada, los errores y la limpieza sin una Mac.
  async function conComandoFalso(script: string, prueba: (comando: string, registro: string) => Promise<void>) {
    const carpeta = await mkdtemp(join(tmpdir(), "atajo-firma-"));
    try {
      const comando = join(carpeta, "shortcuts");
      const registro = join(carpeta, "registro.txt");
      await writeFile(comando, `#!/bin/sh\nprintf '%s\\n' "$@" > '${registro}'\n${script}\n`, { mode: 0o755 });
      await prueba(comando, registro);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }
  const sh = Bun.which("sh");
  const xml = generarAtajo({ servidor: SERVIDOR, token: TOKEN });

  test.skipIf(!sh)("llama a shortcuts sign --mode anyone, devuelve lo firmado y borra los temporales", async () => {
    await conComandoFalso(`cat "$5" > /dev/null && printf 'AEA1firmado' > "$7"`, async (comando, registro) => {
      const firmado = await firmarAtajo(xml, { comando, plataforma: "darwin" });
      expect(new TextDecoder().decode(firmado)).toBe("AEA1firmado");
      const args = (await Bun.file(registro).text()).trim().split("\n");
      expect(args.slice(0, 4)).toEqual(["sign", "--mode", "anyone", "--input"]);
      expect(args[5]).toBe("--output");
      expect(await Bun.file(args[4]!).exists()).toBe(false);
      expect(await Bun.file(args[6]!).exists()).toBe(false);
    });
  });

  test.skipIf(!sh)("si la firma falla, ErrorFirma trae lo que dijo shortcuts y no deja temporales", async () => {
    await conComandoFalso(`echo "No hay cuenta de iCloud" >&2; exit 3`, async (comando, registro) => {
      const intento = firmarAtajo(xml, { comando, plataforma: "darwin" });
      await expect(intento).rejects.toBeInstanceOf(ErrorFirma);
      await expect(intento).rejects.toThrow("No hay cuenta de iCloud");
      const args = (await Bun.file(registro).text()).trim().split("\n");
      expect(await Bun.file(args[4]!).exists()).toBe(false);
    });
    await conComandoFalso(`printf 'no firmado' > "$7"`, async (comando) => {
      await expect(firmarAtajo(xml, { comando, plataforma: "darwin" })).rejects.toThrow("no produjo un Atajo firmado");
    });
    await conComandoFalso(`exec sleep 5`, async (comando) => {
      await expect(firmarAtajo(xml, { comando, plataforma: "darwin", tiempoMs: 100 })).rejects.toThrow("tardó demasiado");
    });
    await expect(firmarAtajo(xml, { comando: "/no/existe/shortcuts", plataforma: "darwin" })).rejects.toBeInstanceOf(ErrorFirma);
  });

  test("construirAtajo y generarAtajo describen lo mismo", () => {
    const objeto = JSON.parse(JSON.stringify(construirAtajo({ servidor: SERVIDOR, token: TOKEN })));
    expect(leerPlist(generarAtajo({ servidor: SERVIDOR, token: TOKEN }))).toEqual(objeto);
  });
});

describe("Atajo de Apple Pay", () => {
  const ap = leerPlist(generarAtajoApplePay({ servidor: SERVIDOR, token: TOKEN })) as Dict;
  const pasos = ap.WFWorkflowActions as unknown as Accion[];
  const donde = (identificador: string) => pasos.findIndex((a) => id(a) === identificador);

  test("es otro Atajo, con su nombre, que recibe la entrada de la automatización", () => {
    expect(ap.WFWorkflowName).toBe(NOMBRE_ATAJO_APPLE_PAY);
    expect(ap.WFWorkflowHasShortcutInputVariables).toBe(true);
    for (const a of pasos) expect(PERMITIDAS.has(id(a))).toBe(true);
    const propiedades = new Set<string>();
    for (const a of pasos) {
      for (const [, v] of recorrer(parametros(a))) {
        if (v && typeof v === "object" && (v as Dict).Type === "ExtensionInput") {
          const [agr] = (v as Dict).Aggrandizements as Dict[];
          expect(agr!.Type).toBe("WFPropertyVariableAggrandizement");
          propiedades.add(agr!.PropertyName as string);
        }
      }
    }
    expect([...propiedades].sort()).toEqual(Object.values(PROPIEDADES_TRANSACCION).sort());
  });

  test("referencias y bloques bien formados", () => {
    const vistos = new Map<string, string>();
    const pila: string[] = [];
    for (const a of pasos) {
      const p = parametros(a);
      for (const [, v] of recorrer(p)) {
        if (v && typeof v === "object" && !Array.isArray(v) && (v as Dict).Type === "ActionOutput") {
          expect(vistos.get((v as Dict).OutputUUID as string)).toBe((v as Dict).OutputName as string);
        }
      }
      if (typeof p.UUID === "string") vistos.set(p.UUID, (p.CustomOutputName as string) ?? "");
      if (BLOQUES.has(id(a))) {
        if (p.WFControlFlowMode === 0) pila.push(p.GroupingIdentifier as string);
        if (p.WFControlFlowMode === 2) expect(pila.pop()).toBe(p.GroupingIdentifier as string);
      }
    }
    expect(pila).toEqual([]);
  });

  test("guarda el pago en la cola antes de usar la red y lo manda a /v1/hablar como apple_pay", () => {
    const guardar = donde("documentpicker.save");
    expect(parametros(pasos[guardar]!)).toMatchObject({ WFFileDestinationPath: ARCHIVO_COLA_APPLE_PAY, WFSaveFileOverwrite: true });
    // Nunca toca la cola del Atajo "Finanzas": la automatización corre sola y podría pisarla.
    expect(JSON.stringify(pasos)).not.toContain(ARCHIVO_COLA);
    for (const red of ["downloadurl", "getcurrentlocation"]) expect(donde(red)).toBeGreaterThan(guardar);
    expect(pasos.some((a) => id(a).startsWith("file."))).toBe(false);
    const envio = pasos[donde("downloadurl")]!;
    expect(parametros(envio)).toMatchObject({ WFURL: `${SERVIDOR}/v1/hablar`, WFHTTPMethod: "POST", WFHTTPBodyType: "File" });
    const peticion = pasos.find((a) => parametros(a).CustomOutputName === "Petición")!;
    const campos = (((parametros(peticion).WFItems as Dict).Value as Dict).WFDictionaryFieldValueItems as Dict[]).map((c) => [
      ((c.WFKey as Dict).Value as Dict).string,
      ((c.WFValue as Dict).Value as Dict).string,
    ]);
    expect(Object.fromEntries(campos).origen).toBe("apple_pay");
    expect(campos.map(([k]) => k).sort()).toEqual(["capturado_en", "client_id", "comercio", "lat", "lon", "monto", "nombre", "origen", "tarjeta"]);
  });

  test("con red reenvía los pagos que quedaron y reescribe su cola solo con los que no llegaron", () => {
    const guardados = pasos.flatMap((a, i) => (id(a) === "documentpicker.save" ? [i] : []));
    expect(guardados).toHaveLength(2);
    const envios = pasos.flatMap((a, i) => (id(a) === "downloadurl" ? [i] : []));
    expect(envios).toHaveLength(2);
    // El pago nuevo se guarda antes de enviarlo; la cola se reescribe después de reenviar lo pendiente.
    expect(guardados[0]!).toBeLessThan(envios[0]!);
    expect(guardados[1]!).toBeGreaterThan(envios[1]!);
    expect(ap.WFWorkflowInputContentItemClasses).toContain("WFWalletTransactionContentItem");
  });

  test("al pagar no habla ni escucha; corrido a mano dice si quedó listo", () => {
    expect(donde("dictatetext")).toBe(-1);
    const habla = donde("speaktext");
    const si = pasos.slice(0, habla).findLast((a) => id(a) === "conditional" && parametros(a).WFControlFlowMode === 0)!;
    expect(parametros(si).WFCondition).toBe(101); // "Trae monto" no tiene valor
    expect(habla).toBeGreaterThan(donde("downloadurl"));
  });
});
