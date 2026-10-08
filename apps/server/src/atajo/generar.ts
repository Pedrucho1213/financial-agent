// Genera el Atajo "Finanzas" (.shortcut) con la dirección del servidor y el token adentro,
// para que nadie tenga que armarlo a mano. Los identificadores y claves de cada acción vienen de
// las definiciones de Atajos (WFActions.plist, vía ScPL), del compilador Cherri y de shortcuts-js.
// El archivo sale sin firmar: iOS solo importa Atajos firmados, así que la Mac lo firma con `shortcuts sign`.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aPlistXml, type ValorPlist } from "./plist";

export type OpcionesAtajo = {
  servidor: string;
  token: string;
  /** Para saludar por su nombre la primera vez. */
  nombre?: string;
};

/** La Mac no pudo firmar el Atajo: no es macOS, falta `shortcuts` o la firma falló. */
export class ErrorFirma extends Error {
  override name = "ErrorFirma";
}

/**
 * La cola sin conexión: un solo archivo de texto en iCloud Drive/Shortcuts con un dictado (JSON) por línea.
 * Se sobrescribe en vez de borrar archivos: desde iOS 17, cada borrado de un Atajo pide confirmación.
 * Va en la raíz, como la bienvenida, porque se lee antes de guardar nada y una subcarpeta podría no existir.
 */
export const ARCHIVO_COLA = "/Finanzas-cola.txt";
/**
 * La cola del Atajo de Apple Pay, aparte: la automatización corre sola y podría escribir mientras el Atajo
 * "Finanzas" reescribe la suya, y ese pago se perdería. Cada Atajo solo reescribe su propia cola.
 */
export const ARCHIVO_COLA_APPLE_PAY = "/Finanzas-applepay-cola.txt";
/**
 * Lo que termina la conversación: una frase hecha solo de despedidas ("listo", "no, gracias", "ya es todo",
 * "adiós"), sin distinguir mayúsculas. "Ok" o "está bien" no: si el asistente preguntó algo, son un sí.
 */
export const PALABRAS_PARA_TERMINAR =
  "^[\\s¡!¿?.,]*((no|nada|nada más|listo|ya|ya está|es todo|eso es todo|eso fue todo|gracias|muchas gracias|" +
  "adi[oó]s|bye|salir|termina|terminar|termin[eé]|cancela|cancelar)[\\s¡!¿?.,]*)+$";
/** Tope de vueltas por si el asistente pregunta una y otra vez. */
export const TURNOS = 10;
export const IDIOMA = "es-MX";
/**
 * Si existe, ya se dio la bienvenida (en iCloud Drive, así no se repite al reinstalar). Va en la raíz de la
 * carpeta de Atajos y no en /Finanzas: es lo primero que corre y esa subcarpeta aún no existe la primera vez.
 */
export const ARCHIVO_BIENVENIDA = "/Finanzas-bienvenida.txt";
/** Un "sí" a "¿quieres que te cuente cómo funciono?". */
export const QUIERE_EXPLICACION =
  "^\\W*(s[ií]|claro|va|dale|ok|okay|por favor|cu[eé]ntame|expl[ií]ca|[aá]ndale|sale|bueno|me gustar[ií]a|quiero)";

/** Lo que dice la primera vez: un saludo, la pregunta y, si quiere, cómo usarlo. */
export function guionBienvenida(nombre?: string) {
  const primero = nombre?.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, "");
  return {
    saludo:
      `¡Hola${primero ? `, ${primero}` : ""}! Qué gusto saludarte. Soy tu asistente de finanzas: ` +
      "tú me cuentas lo que gastas y yo llevo las cuentas por ti. ¿Quieres que te cuente cómo funciono?",
    explicacion: [
      "Es muy fácil. Cuando gastes algo, dímelo como se lo contarías a un amigo. " +
        "Por ejemplo: gasté 85 pesos en un café, o pagué la renta por transferencia. " +
        "Te contesto y listo; solo si te pregunto algo, te sigo escuchando.",
      "También puedes preguntarme cosas como: ¿cuánto llevo gastado este mes?, o ¿cuánto gasté en Uber la semana pasada? " +
        "Yo hago las cuentas.",
      "Si me equivoco, corrígeme: no eran 85, eran 95. Si no tienes internet, guardo lo que me digas y lo mando después.",
      "Tus gráficas y tus movimientos están en la app Finanzas de tu pantalla de inicio.",
    ],
    sinExplicacion: "Va.",
    cierre: "Cuando quieras, dime tu primer gasto o hazme una pregunta.",
  };
}
/** Cuánto espera la respuesta de una pregunta que la Mac sigue pensando. */
export const ESPERA_RESPUESTA_MS = 45_000;

// Atajos de iOS 26 (versión de un archivo exportado real); pide al menos iOS 16 para abrirse.
const VERSION_CLIENTE = "4033.0.4.3";
const VERSION_MINIMA = 900;
const ICONO = { WFWorkflowIconGlyphNumber: 59395, WFWorkflowIconStartColor: 4292093695 }; // signo de pesos, verde
const TIPOS_DE_ENTRADA = [
  "WFAppContentItem", "WFAppStoreAppContentItem", "WFArticleContentItem", "WFContactContentItem",
  "WFDateContentItem", "WFEmailAddressContentItem", "WFFolderContentItem", "WFGenericFileContentItem",
  "WFImageContentItem", "WFiTunesProductContentItem", "WFLocationContentItem", "WFDCMapsLinkContentItem",
  "WFAVAssetContentItem", "WFPDFContentItem", "WFPhoneNumberContentItem", "WFRichTextContentItem",
  "WFSafariWebPageContentItem", "WFStringContentItem", "WFDictionaryContentItem", "WFNumberContentItem",
  "WFURLContentItem",
];

// Condiciones de "Si" (WFCondition).
const TIENE_VALOR = 100;
const SIN_VALOR = 101;
// Modo de las acciones que abren y cierran un bloque (WFControlFlowMode).
const ABRE = 0;
const INTERMEDIO = 1; // "De lo contrario"
const CIERRA = 2;

// Así marca Atajos dónde va una variable dentro de un texto.
const MARCA = "￼";

/** Salida de una acción (variable mágica) o variable con nombre. */
type Salida = { uuid: string; nombre: string };
type Variable = { variable: string };
/** La entrada del Atajo (lo que le pasa una automatización), o una propiedad suya ("Amount"). */
type EntradaAtajo = { entrada: string | null };
type Ref = Salida | Variable | EntradaAtajo;
type Parte = string | Ref;
type Parametros = Record<string, ValorPlist | undefined>;
export type Accion = { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: Parametros };

const variable = (nombre: string): Variable => ({ variable: nombre });

function valorDe(ref: Ref): ValorPlist {
  if ("entrada" in ref) {
    return ref.entrada
      ? {
          Type: "ExtensionInput",
          Aggrandizements: [{ Type: "WFPropertyVariableAggrandizement", PropertyName: ref.entrada, PropertyUserInfo: 0 }],
        }
      : { Type: "ExtensionInput" };
  }
  return "variable" in ref
    ? { Type: "Variable", VariableName: ref.variable }
    : { OutputName: ref.nombre, OutputUUID: ref.uuid, Type: "ActionOutput" };
}

/** Una variable sola como valor de un parámetro (la entrada de una acción). */
const adjunto = (ref: Ref) => ({ Value: valorDe(ref), WFSerializationType: "WFTextTokenAttachment" });

/** Texto con variables intercaladas; cada una ocupa un U+FFFC en su posición (en unidades UTF-16). */
function textoConVariables(...partes: Parte[]) {
  let cadena = "";
  const adjuntos: Record<string, ValorPlist> = {};
  for (const parte of partes) {
    if (typeof parte === "string") {
      if (parte.includes(MARCA)) throw new Error("El texto no puede llevar el carácter U+FFFC.");
      cadena += parte;
    } else {
      adjuntos[`{${cadena.length}, 1}`] = valorDe(parte);
      cadena += MARCA;
    }
  }
  const conVariables = Object.keys(adjuntos).length > 0;
  return {
    Value: { attachmentsByRange: conVariables ? adjuntos : undefined, string: cadena },
    WFSerializationType: "WFTextTokenString",
  };
}

/** Parámetro de texto: cadena simple si no lleva variables. */
function texto(...partes: Parte[]): ValorPlist {
  return partes.every((p) => typeof p === "string") ? partes.join("") : textoConVariables(...partes);
}

/** Campos de un diccionario (acción Diccionario o encabezados HTTP), todos de tipo texto. */
function diccionario(campos: [string, Parte][]) {
  return {
    Value: {
      WFDictionaryFieldValueItems: campos.map(([clave, valor]) => ({
        WFItemType: 0,
        WFKey: textoConVariables(clave),
        WFValue: textoConVariables(valor),
      })),
    },
    WFSerializationType: "WFDictionaryFieldValue",
  };
}

class Constructor {
  readonly acciones: Accion[] = [];
  private cuenta = 0;
  private readonly nombres = new Set<string>();

  // UUID estable (mismo Atajo, mismos UUID) con forma de UUID v5 en mayúsculas, como los exporta iOS.
  private uuid(): string {
    const h = createHash("sha1").update(`finanzas-atajo:${this.cuenta++}`).digest("hex");
    const variante = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
  }

  accion(id: string, parametros: Parametros = {}): void {
    this.acciones.push({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: parametros });
  }

  /** Acción cuya salida se usa después; el nombre es como aparece en el editor de Atajos. */
  conSalida(id: string, nombre: string, parametros: Parametros = {}): Salida {
    if (this.nombres.has(nombre)) throw new Error(`Nombre de salida repetido: ${nombre}`);
    this.nombres.add(nombre);
    const uuid = this.uuid();
    this.accion(id, { ...parametros, CustomOutputName: nombre, UUID: uuid });
    return { uuid, nombre };
  }

  private bloque(id: string, apertura: Parametros, cuerpo: () => void, otro?: () => void): void {
    const grupo = this.uuid();
    this.accion(id, { ...apertura, GroupingIdentifier: grupo, WFControlFlowMode: ABRE });
    cuerpo();
    if (otro) {
      this.accion(id, { GroupingIdentifier: grupo, WFControlFlowMode: INTERMEDIO });
      otro();
    }
    this.accion(id, { GroupingIdentifier: grupo, WFControlFlowMode: CIERRA, UUID: this.uuid() });
  }

  /** Si ... (De lo contrario ...) Fin del Si. */
  si(ref: Ref, condicion: typeof TIENE_VALOR | typeof SIN_VALOR, entonces: () => void, deLoContrario?: () => void): void {
    const apertura = { WFCondition: condicion, WFInput: { Type: "Variable", Variable: adjunto(ref) } };
    this.bloque("conditional", apertura, entonces, deLoContrario);
  }

  private repeticiones = 0;

  repetir(veces: number, cuerpo: () => void): void {
    this.repeticiones++;
    this.bloque("repeat.count", { WFRepeatCount: veces }, cuerpo);
    this.repeticiones--;
  }

  /**
   * Repetir con cada elemento. Atajos nombra el elemento actual según cuántos Repetir lo encierran:
   * "Repeat Item" en el primero, "Repeat Item 2" dentro de otro (así lo guarda iOS 27 al elegirlo a mano).
   */
  repetirConCada(lista: Ref, cuerpo: (elemento: Variable) => void): void {
    this.repeticiones++;
    const elemento = variable(this.repeticiones === 1 ? "Repeat Item" : `Repeat Item ${this.repeticiones}`);
    this.bloque("repeat.each", { WFInput: adjunto(lista) }, () => cuerpo(elemento));
    this.repeticiones--;
  }

  establecer(nombre: string, valor: Ref): Variable {
    this.accion("setvariable", { WFVariableName: nombre, WFInput: adjunto(valor) });
    return variable(nombre);
  }

  texto(nombre: string, ...partes: Parte[]): Salida {
    return this.conSalida("gettext", nombre, { WFTextActionText: texto(...partes) });
  }

  valor(nombre: string, de: Ref, clave: string): Salida {
    return this.conSalida("getvalueforkey", nombre, {
      WFInput: adjunto(de),
      WFGetDictionaryValueType: "Value",
      WFDictionaryKey: clave,
    });
  }
}

function normalizarServidor(servidor: string): string {
  let url: URL;
  try {
    url = new URL(servidor.trim());
  } catch {
    throw new Error(`La dirección del servidor no es válida: ${servidor}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("La dirección del servidor debe empezar con https://.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("La dirección del servidor no debe llevar usuario, consulta ni fragmento.");
  }
  return (url.origin + url.pathname).replace(/\/+$/, "");
}

/** El Atajo como objeto (lo mismo que va en el plist). */
export function construirAtajo(opciones: OpcionesAtajo): Record<string, ValorPlist> {
  const base = normalizarServidor(opciones.servidor);
  const token = opciones.token.trim();
  if (!/^[\x21-\x7E]+$/.test(token)) throw new Error("El token no es válido.");

  const a = new Constructor();
  const conversacion = variable("Conversación");
  const ubicacion = variable("Ubicación");
  const clientId = variable("ClientID");
  const respuesta = variable("Respuesta");
  const quedan = variable("Quedan");

  const encabezados = (conCuerpo: boolean) =>
    diccionario([
      ["Authorization", `Bearer ${token}`],
      ...(conCuerpo ? ([["Content-Type", "application/json"]] as [string, Parte][]) : []),
    ]);
  /** El cuerpo de una petición: el JSON como archivo, igual que si se hubiera leído de la cola. */
  const comoArchivo = (nombre: string, json: Ref) =>
    a.conSalida("setitemname", nombre, { WFInput: adjunto(json), WFName: "dictado.json" });
  const enviar = (nombre: string, archivo: Ref) =>
    a.conSalida("downloadurl", nombre, {
      WFURL: `${base}/v1/hablar`,
      WFHTTPMethod: "POST",
      Advanced: true,
      ShowHeaders: true,
      WFHTTPHeaders: encabezados(true),
      WFHTTPBodyType: "File",
      WFRequestVariable: adjunto(archivo),
    });
  /** Sobrescribe la cola con este texto (si no existe, la crea). */
  const guardarCola = (contenido: Ref, sufijo: string) => {
    const archivo = a.conSalida("setitemname", `Archivo de la cola${sufijo}`, {
      WFInput: adjunto(contenido),
      WFName: ARCHIVO_COLA.split("/").at(-1)!,
    });
    a.accion("documentpicker.save", {
      WFInput: adjunto(archivo),
      WFAskWhereToSave: false,
      WFFileDestinationPath: ARCHIVO_COLA,
      WFSaveFileOverwrite: true,
    });
  };
  const decir = (...partes: Parte[]) =>
    a.accion("speaktext", { WFText: texto(...partes), WFSpeakTextLanguage: IDIOMA, WFSpeakTextWait: true });
  /**
   * El servidor contestó con JSON y no pidió reintentar (409 en proceso, 503 sin IA): ese dictado ya quedó.
   * Una página de error que no es JSON (un 502 del proxy con la Mac sin servidor) no tiene claves: sigue en la cola.
   */
  const siYaQuedo = (contestacion: Salida, sufijo: string, entonces: () => void, siNo?: () => void) =>
    a.si(
      a.valor(`reintentar${sufijo}`, contestacion, "reintentar"),
      SIN_VALOR,
      () => {
        const claves = a.conSalida("getvalueforkey", `Claves${sufijo}`, {
          WFInput: adjunto(contestacion),
          WFGetDictionaryValueType: "All Keys",
        });
        a.si(claves, TIENE_VALOR, entonces, siNo);
      },
      siNo,
    );

  // Un turno con algo dicho: terminar, o guardar, enviar y contestar.
  const turno = (dictado: Salida) => {
    const terminar = a.conSalida("text.match", "Palabra para terminar", {
      WFMatchTextPattern: PALABRAS_PARA_TERMINAR,
      text: texto(dictado),
      WFMatchTextCaseSensitive: false,
    });
    a.si(terminar, TIENE_VALOR, () => a.accion("exit"));

    // client_id: la hora ISO sin signos (sirve en el nombre del archivo y en la URL) y un número al azar.
    const fecha = a.conSalida("date", "Fecha", { WFDateActionMode: "Current Date" });
    const capturado = a.conSalida("format.date", "Capturado", {
      WFDate: texto(fecha),
      WFDateFormatStyle: "ISO 8601",
      WFISO8601IncludeTime: true,
    });
    const sello = a.conSalida("text.replace", "Sello", {
      WFInput: texto(capturado),
      WFReplaceTextFind: "[^0-9A-Za-z]",
      WFReplaceTextReplace: "",
      WFReplaceTextRegularExpression: true,
    });
    const azar = a.conSalida("number.random", "Número aleatorio", {
      WFRandomNumberMinimum: 100000,
      WFRandomNumberMaximum: 999999,
    });
    a.establecer("ClientID", a.texto("Folio", sello, "-", azar));

    // Lo que quedó en la cola de antes (vacío si no existe).
    const archivoCola = a.conSalida("documentpicker.open", "Cola guardada", {
      WFShowFilePicker: false,
      WFGetFilePath: ARCHIVO_COLA,
      WFFileErrorIfNotFound: false,
    });
    const colaPrevia = a.conSalida("detect.text", "Pendientes anteriores", { WFInput: adjunto(archivoCola) });

    // La petición se agrega como una línea más de la cola, y esa línea es lo que se envía.
    const guardar = (campos: [string, Parte][], sufijo: string) => {
      const peticion = a.conSalida("dictionary", `Petición${sufijo}`, { WFItems: diccionario(campos) });
      // Un dictado por línea: si Atajos escribiera el JSON en varias, fuera de las comillas un salto es solo espacio.
      const json = a.conSalida("text.replace", `JSON${sufijo}`, {
        WFInput: texto(peticion),
        WFReplaceTextFind: "[\\r\\n]+",
        WFReplaceTextReplace: " ",
        WFReplaceTextRegularExpression: true,
      });
      guardarCola(a.texto(`Cola con el dictado${sufijo}`, colaPrevia, "\n", json), ` con el dictado${sufijo}`);
      return json;
    };
    const basicos: [string, Parte][] = [
      ["texto", dictado],
      ["client_id", clientId],
      ["conversacion_id", conversacion],
      ["capturado_en", capturado],
    ];

    // Primer turno: el dictado queda guardado antes de pedir la ubicación, que puede necesitar internet.
    a.si(ubicacion, SIN_VALOR, () => {
      guardar(basicos, " sin ubicación");
      a.establecer("Ubicación", a.conSalida("getcurrentlocation", "Ubicación actual"));
      const detalle = (nombre: string, propiedad: string) =>
        a.conSalida("properties.locations", nombre, { WFInput: adjunto(ubicacion), WFContentItemPropertyName: propiedad });
      a.establecer("Latitud", detalle("Latitud actual", "Latitude"));
      a.establecer("Longitud", detalle("Longitud actual", "Longitude"));
      a.establecer("Lugar", detalle("Nombre del lugar", "Name"));
    });

    const json = guardar(
      [...basicos, ["lat", variable("Latitud")], ["lon", variable("Longitud")], ["lugar", variable("Lugar")]],
      "",
    );
    // Sin conexión, esta acción detiene el Atajo con un error; el dictado ya quedó en la cola.
    const contestacion = enviar("Contestación", comoArchivo("Dictado para enviar", json));

    const nuevaConversacion = a.valor("conversacion_id", contestacion, "conversacion_id");
    a.si(nuevaConversacion, TIENE_VALOR, () => a.establecer("Conversación", nuevaConversacion));

    a.establecer("Respuesta", a.texto("Sin respuesta", "No entendí lo que contestó el servidor."));
    const dicha = a.valor("respuesta", contestacion, "respuesta");
    a.si(dicha, TIENE_VALOR, () => a.establecer("Respuesta", dicha));
    // Una pregunta que la Mac sigue pensando: se espera su respuesta un poco más.
    // El servidor pide seguir escuchando solo cuando la respuesta le pregunta algo a la persona.
    a.establecer("Seguir", a.valor("seguir", contestacion, "seguir"));
    const esperar = a.valor("esperar", contestacion, "esperar");
    a.si(esperar, TIENE_VALOR, () => {
      const entrada = a.conSalida("downloadurl", "Estado del dictado", {
        WFURL: texto(`${base}/v1/entradas/`, clientId, `?esperar_ms=${ESPERA_RESPUESTA_MS}`),
        WFHTTPMethod: "GET",
        Advanced: true,
        ShowHeaders: true,
        WFHTTPHeaders: encabezados(false),
      });
      const final = a.valor("respuesta final", entrada, "respuesta");
      a.si(final, TIENE_VALOR, () => a.establecer("Respuesta", final));
      a.establecer("Seguir", a.valor("seguir final", entrada, "seguir"));
    });
    decir(respuesta);

    // Si el servidor ya tiene este dictado, se reenvían los que quedaron de antes y la cola se reescribe
    // solo con los que el servidor todavía no recibió. Si no, la cola se queda como está, con este incluido.
    siYaQuedo(contestacion, " al reenviar", () => {
      a.establecer("Quedan", a.texto("Ninguno pendiente", ""));
      const lineas = a.conSalida("text.split", "Líneas de la cola", { text: texto(colaPrevia), WFTextSeparator: "New Lines" });
      a.repetirConCada(lineas, (elemento) => {
        const linea = a.establecer("Línea", elemento);
        const conDatos = a.conSalida("text.match", "Línea con datos", { WFMatchTextPattern: "\\S", text: texto(linea) });
        a.si(conDatos, TIENE_VALOR, () => {
          const contestacionPendiente = enviar("Contestación del pendiente", comoArchivo("Pendiente para enviar", linea));
          const quedarse = () => a.accion("appendvariable", { WFVariableName: "Quedan", WFInput: adjunto(linea) });
          siYaQuedo(contestacionPendiente, " del pendiente", () => {}, quedarse);
        });
      });
      const restantes = a.conSalida("text.combine", "Pendientes que quedan", {
        text: adjunto(quedan),
        WFTextSeparator: "New Lines",
      });
      guardarCola(a.texto("Cola sin lo enviado", restantes, "\n"), " sin lo enviado");
    });

    a.si(variable("Seguir"), SIN_VALOR, () => a.accion("exit"));
  };

  a.accion("comment", {
    WFCommentActionText:
      "Finanzas: dictas un gasto o una pregunta y la Mac contesta en voz. Lo preparó la app con tu servidor y tu token; " +
      "para cambiarlos, vuelve a instalarlo desde Ajustes en la app. Cada dictado se guarda en iCloud Drive/Shortcuts/Finanzas-cola.txt " +
      "antes de enviarse y sale de ahí cuando el servidor lo recibe. Contesta y termina; solo sigue escuchando si te pregunta algo.",
  });
  a.establecer("Conversación", a.texto("Sin conversación", ""));

  // La primera vez se presenta y, si le dicen que sí, explica cómo usarlo. El saludo lo da el servidor con el
  // nombre que tenga la cuenta (se puede cambiar en Ajustes sin reinstalar). Si no contesta JSON (un token
  // revocado), usa el nombre con que se instaló. Sin internet el Atajo se detiene antes de marcar la
  // bienvenida, así que la vuelve a intentar la próxima vez.
  const guion = guionBienvenida(opciones.nombre);
  const bienvenidaPrevia = a.conSalida("documentpicker.open", "Bienvenida previa", {
    WFShowFilePicker: false,
    WFGetFilePath: ARCHIVO_BIENVENIDA,
    WFFileErrorIfNotFound: false,
  });
  a.si(bienvenidaPrevia, SIN_VALOR, () => {
    const delServidor = a.conSalida("downloadurl", "Bienvenida del servidor", {
      WFURL: `${base}/v1/atajo/bienvenida`,
      WFHTTPMethod: "GET",
      Advanced: true,
      ShowHeaders: true,
      WFHTTPHeaders: encabezados(false),
    });
    a.establecer("Saludo", a.texto("Saludo de siempre", guion.saludo));
    const saludo = a.valor("saludo", delServidor, "saludo");
    a.si(saludo, TIENE_VALOR, () => a.establecer("Saludo", saludo));
    decir(variable("Saludo"));
    const contesta = a.conSalida("dictatetext", "Respuesta a la bienvenida", {
      WFSpeechLanguage: IDIOMA,
      WFDictateTextStopListening: "After Pause",
    });
    // Se marca antes de explicar: si lo cierra a la mitad, no vuelve a empezar desde el saludo.
    const marca = a.conSalida("setitemname", "Archivo de bienvenida", {
      WFInput: adjunto(a.texto("Bienvenida", "Ya te saludé. Borra este archivo para escuchar la bienvenida otra vez.")),
      WFName: ARCHIVO_BIENVENIDA.slice(1),
    });
    a.accion("documentpicker.save", {
      WFInput: adjunto(marca),
      WFAskWhereToSave: false,
      WFFileDestinationPath: ARCHIVO_BIENVENIDA,
      WFSaveFileOverwrite: true,
    });
    const quiere = a.conSalida("text.match", "Quiere la explicación", {
      WFMatchTextPattern: QUIERE_EXPLICACION,
      text: texto(contesta),
      WFMatchTextCaseSensitive: false,
    });
    a.si(
      quiere,
      TIENE_VALOR,
      () => {
        for (const parte of guion.explicacion) decir(parte);
      },
      () => decir(guion.sinExplicacion),
    );
    decir(guion.cierre);
  });

  a.repetir(TURNOS, () => {
    const dictado = a.conSalida("dictatetext", "Dictado", {
      WFSpeechLanguage: IDIOMA,
      WFDictateTextStopListening: "After Pause",
    });
    // Un dictado vacío (silencio o tocar el botón de parar) termina. Si ni siquiera hubo un primer turno, lo dice.
    const palabras = a.conSalida("text.match", "Palabras dichas", { WFMatchTextPattern: "\\S", text: texto(dictado) });
    a.si(
      palabras,
      SIN_VALOR,
      () => {
        a.si(ubicacion, SIN_VALOR, () => decir("No te escuché."));
        a.accion("exit");
      },
      () => turno(dictado),
    );
  });

  return {
    WFQuickActionSurfaces: [],
    WFWorkflowActions: a.acciones,
    WFWorkflowClientVersion: VERSION_CLIENTE,
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowIcon: ICONO,
    WFWorkflowImportQuestions: [],
    WFWorkflowInputContentItemClasses: TIPOS_DE_ENTRADA,
    WFWorkflowMinimumClientVersion: VERSION_MINIMA,
    WFWorkflowMinimumClientVersionString: String(VERSION_MINIMA),
    WFWorkflowName: "Finanzas",
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowTypes: ["WFWorkflowTypeShowInSearch"],
  };
}

export const NOMBRE_ATAJO_APPLE_PAY = "Finanzas Apple Pay";
/**
 * Propiedades de la transacción que la automatización "Transacción" (o "Cartera") le pasa al Atajo.
 * Los nombres son los que muestra Atajos en inglés; la IA del servidor recibe lo que llegue y lo demás lo ignora.
 */
export const PROPIEDADES_TRANSACCION = { monto: "Amount", comercio: "Merchant", nombre: "Name", tarjeta: "Card or Pass" } as const;

/**
 * El Atajo "Finanzas Apple Pay": lo corre la automatización de la Cartera al pagar con Apple Pay. Manda el
 * pago al servidor sin decir nada; lo anotado llega por notificación. El pago queda primero en su propia cola
 * (ARCHIVO_COLA_APPLE_PAY); si no hay internet, se reenvía la próxima vez que pagues con Apple Pay.
 * Corrido a mano (sin pago) es una prueba: da los permisos de red y ubicación y dice si todo está listo.
 */
export function construirAtajoApplePay(opciones: Omit<OpcionesAtajo, "nombre">): Record<string, ValorPlist> {
  const base = normalizarServidor(opciones.servidor);
  const token = opciones.token.trim();
  if (!/^[\x21-\x7E]+$/.test(token)) throw new Error("El token no es válido.");
  const a = new Constructor();
  const pago = (propiedad: keyof typeof PROPIEDADES_TRANSACCION): EntradaAtajo => ({ entrada: PROPIEDADES_TRANSACCION[propiedad] });

  a.accion("comment", {
    WFCommentActionText:
      "Finanzas Apple Pay: lo corre la automatización de la Cartera al pagar con Apple Pay y anota el pago sin decir nada; " +
      "te llega una notificación para agregar detalles. Si no hay internet, el pago queda en iCloud Drive/Shortcuts/Finanzas-applepay-cola.txt " +
      "y se manda la próxima vez que pagues con Apple Pay. Córrelo una vez a mano para darle permisos.",
  });

  const fecha = a.conSalida("date", "Fecha", { WFDateActionMode: "Current Date" });
  const capturado = a.conSalida("format.date", "Capturado", { WFDate: texto(fecha), WFDateFormatStyle: "ISO 8601", WFISO8601IncludeTime: true });
  const sello = a.conSalida("text.replace", "Sello", {
    WFInput: texto(capturado),
    WFReplaceTextFind: "[^0-9A-Za-z]",
    WFReplaceTextReplace: "",
    WFReplaceTextRegularExpression: true,
  });
  const azar = a.conSalida("number.random", "Número aleatorio", { WFRandomNumberMinimum: 100000, WFRandomNumberMaximum: 999999 });
  const folio = a.texto("Folio", "applepay-", sello, "-", azar);

  // La transacción completa como texto y su tipo: si la Cartera cambia el nombre de una propiedad, el servidor
  // todavía saca el monto de aquí y la Mac registra qué llegó.
  const transaccion = a.texto("Transacción como texto", { entrada: null });
  const tipo = a.conSalida("getitemtype", "Tipo de la entrada", { WFInput: adjunto({ entrada: null }) });

  const basicos: [string, Parte][] = [
    ["origen", "apple_pay"],
    ["client_id", folio],
    ["capturado_en", capturado],
    ["monto", pago("monto")],
    ["comercio", pago("comercio")],
    ["nombre", pago("nombre")],
    ["tarjeta", pago("tarjeta")],
    ["entrada", transaccion],
    ["tipo", tipo],
  ];
  const comoLinea = (nombre: string, campos: [string, Parte][]) =>
    a.conSalida("text.replace", `JSON${nombre}`, {
      WFInput: texto(a.conSalida("dictionary", `Petición${nombre}`, { WFItems: diccionario(campos) })),
      WFReplaceTextFind: "[\\r\\n]+",
      WFReplaceTextReplace: " ",
      WFReplaceTextRegularExpression: true,
    });

  const nombreCola = ARCHIVO_COLA_APPLE_PAY.split("/").at(-1)!;
  const guardarCola = (contenido: Ref, sufijo: string) => {
    const archivo = a.conSalida("setitemname", `Archivo de la cola${sufijo}`, { WFInput: adjunto(contenido), WFName: nombreCola });
    a.accion("documentpicker.save", {
      WFInput: adjunto(archivo),
      WFAskWhereToSave: false,
      WFFileDestinationPath: ARCHIVO_COLA_APPLE_PAY,
      WFSaveFileOverwrite: true,
    });
  };
  const enviar = (nombre: string, archivo: Ref) =>
    a.conSalida("downloadurl", nombre, {
      WFURL: `${base}/v1/hablar`,
      WFHTTPMethod: "POST",
      Advanced: true,
      ShowHeaders: true,
      WFHTTPHeaders: diccionario([
        ["Authorization", `Bearer ${token}`],
        ["Content-Type", "application/json"],
      ]),
      WFHTTPBodyType: "File",
      WFRequestVariable: adjunto(archivo),
    });
  /** El servidor contestó JSON sin pedir reintentar: ese pago ya quedó (igual que en el Atajo "Finanzas"). */
  const siYaQuedo = (contestacion: Salida, sufijo: string, entonces: () => void, siNo?: () => void) =>
    a.si(
      a.valor(`reintentar${sufijo}`, contestacion, "reintentar"),
      SIN_VALOR,
      () => {
        const claves = a.conSalida("getvalueforkey", `Claves${sufijo}`, {
          WFInput: adjunto(contestacion),
          WFGetDictionaryValueType: "All Keys",
        });
        a.si(claves, TIENE_VALOR, entonces, siNo);
      },
      siNo,
    );

  // Lo que quedó de pagos anteriores sin internet (vacío si no existe).
  const archivoCola = a.conSalida("documentpicker.open", "Cola guardada", {
    WFShowFilePicker: false,
    WFGetFilePath: ARCHIVO_COLA_APPLE_PAY,
    WFFileErrorIfNotFound: false,
  });
  const colaPrevia = a.conSalida("detect.text", "Pendientes anteriores", { WFInput: adjunto(archivoCola) });

  // Solo un pago de verdad va a la cola; la prueba a mano no trae nada de la Cartera.
  const delPago = a.texto("Datos del pago", pago("monto"), transaccion);
  const conPago = a.conSalida("text.match", "Trae el pago", { WFMatchTextPattern: "\\S", text: texto(delPago) });
  a.si(conPago, TIENE_VALOR, () => {
    const linea = comoLinea(" para la cola", basicos);
    guardarCola(a.texto("Cola con el pago", colaPrevia, "\n", linea), " con el pago");
  });

  // Dónde pagaste, para el mapa de gastos. Va después de guardar: puede necesitar internet.
  const ubicacion = a.conSalida("getcurrentlocation", "Ubicación actual");
  const detalle = (nombre: string, propiedad: string) =>
    a.conSalida("properties.locations", nombre, { WFInput: adjunto(ubicacion), WFContentItemPropertyName: propiedad });
  const latitud = detalle("Latitud actual", "Latitude");
  const longitud = detalle("Longitud actual", "Longitude");

  const json = comoLinea("", [...basicos, ["lat", latitud], ["lon", longitud]]);
  const archivo = a.conSalida("setitemname", "Pago para enviar", { WFInput: adjunto(json), WFName: "pago.json" });
  // Sin conexión, esta acción detiene el Atajo con un error; el pago ya quedó en la cola.
  const contestacion = enviar("Contestación", archivo);

  // Con red: se reenvían los pagos que quedaron de antes y la cola se queda solo con los que no llegaron.
  siYaQuedo(contestacion, " al reenviar", () => {
    const quedan = variable("Quedan");
    a.establecer("Quedan", a.texto("Ninguno pendiente", ""));
    const lineas = a.conSalida("text.split", "Líneas de la cola", { text: texto(colaPrevia), WFTextSeparator: "New Lines" });
    a.repetirConCada(lineas, (elemento) => {
      const linea = a.establecer("Línea", elemento);
      const conDatos = a.conSalida("text.match", "Línea con datos", { WFMatchTextPattern: "\\S", text: texto(linea) });
      a.si(conDatos, TIENE_VALOR, () => {
        const pendiente = a.conSalida("setitemname", "Pendiente para enviar", { WFInput: adjunto(linea), WFName: "pago.json" });
        const contestacionPendiente = enviar("Contestación del pendiente", pendiente);
        const quedarse = () => a.accion("appendvariable", { WFVariableName: "Quedan", WFInput: adjunto(linea) });
        siYaQuedo(contestacionPendiente, " del pendiente", () => {}, quedarse);
      });
    });
    const restantes = a.conSalida("text.combine", "Pendientes que quedan", { text: adjunto(quedan), WFTextSeparator: "New Lines" });
    guardarCola(a.texto("Cola sin lo enviado", restantes, "\n"), " sin lo enviado");
  });
  // Corrido a mano: dice si quedó listo.
  a.si(conPago, SIN_VALOR, () => {
    const respuesta = a.valor("respuesta", contestacion, "respuesta");
    a.accion("speaktext", { WFText: texto(respuesta), WFSpeakTextLanguage: IDIOMA, WFSpeakTextWait: true });
  });

  return {
    WFQuickActionSurfaces: [],
    WFWorkflowActions: a.acciones,
    WFWorkflowClientVersion: VERSION_CLIENTE,
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowIcon: { WFWorkflowIconGlyphNumber: 59395, WFWorkflowIconStartColor: 255 }, // signo de pesos, negro
    WFWorkflowImportQuestions: [],
    // La transacción de la Cartera es su propio tipo de entrada (WorkflowKit, iOS 27).
    WFWorkflowInputContentItemClasses: [...TIPOS_DE_ENTRADA, "WFWalletTransactionContentItem"],
    WFWorkflowMinimumClientVersion: VERSION_MINIMA,
    WFWorkflowMinimumClientVersionString: String(VERSION_MINIMA),
    WFWorkflowName: NOMBRE_ATAJO_APPLE_PAY,
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowTypes: [],
  };
}

export function generarAtajoApplePay(opciones: Omit<OpcionesAtajo, "nombre">): string {
  return aPlistXml(construirAtajoApplePay(opciones));
}

/** El plist XML del Atajo "Finanzas", listo para firmar. */
export function generarAtajo(opciones: OpcionesAtajo): string {
  return aPlistXml(construirAtajo(opciones));
}

export type OpcionesFirma = {
  /** Cuánto esperar a `shortcuts sign` (60 s por omisión). */
  tiempoMs?: number;
  /** Para pruebas: otro ejecutable en lugar de `shortcuts` y otra plataforma. */
  comando?: string;
  plataforma?: string;
};

/**
 * Firma el Atajo con `shortcuts sign --mode anyone` (solo en macOS) y devuelve el archivo firmado.
 * Los archivos temporales se borran siempre.
 */
export async function firmarAtajo(xml: string, opciones: OpcionesFirma = {}): Promise<Uint8Array> {
  const plataforma = opciones.plataforma ?? process.platform;
  if (plataforma !== "darwin") {
    throw new ErrorFirma(`Solo una Mac puede firmar Atajos y este equipo es ${plataforma}.`);
  }
  const comando = opciones.comando ?? Bun.which("shortcuts");
  if (!comando) throw new ErrorFirma("No encontré el comando `shortcuts` (viene con macOS 12 o posterior).");

  const carpeta = await mkdtemp(join(tmpdir(), "finanzas-atajo-"));
  try {
    const entrada = join(carpeta, "Finanzas sin firmar.shortcut");
    const salida = join(carpeta, "Finanzas.shortcut");
    await writeFile(entrada, xml);

    let proceso: ReturnType<typeof Bun.spawn>;
    try {
      proceso = Bun.spawn([comando, "sign", "--mode", "anyone", "--input", entrada, "--output", salida], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      throw new ErrorFirma(`No se pudo ejecutar \`shortcuts sign\`: ${(error as Error).message}`);
    }
    let vencido = false;
    const reloj = setTimeout(() => {
      vencido = true;
      proceso.kill();
    }, opciones.tiempoMs ?? 60_000);
    const [codigo, salidaTexto, errores] = await Promise.all([
      proceso.exited,
      new Response(proceso.stdout as ReadableStream).text(),
      new Response(proceso.stderr as ReadableStream).text(),
    ]).finally(() => clearTimeout(reloj));
    const detalle = (errores.trim() || salidaTexto.trim() || "sin detalle").slice(0, 2000);

    if (vencido) throw new ErrorFirma(`\`shortcuts sign\` tardó demasiado y se detuvo: ${detalle}`);
    if (codigo !== 0) throw new ErrorFirma(`\`shortcuts sign\` falló (código ${codigo}): ${detalle}`);
    const firmado = await readFile(salida).catch(() => {
      throw new ErrorFirma(`\`shortcuts sign\` no dejó el archivo firmado: ${detalle}`);
    });
    // Un Atajo firmado es un Apple Encrypted Archive: empieza con "AEA1".
    if (firmado.subarray(0, 4).toString("latin1") !== "AEA1") {
      throw new ErrorFirma(`\`shortcuts sign\` no produjo un Atajo firmado: ${detalle}`);
    }
    return new Uint8Array(firmado);
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}
