// Web Push sin dependencias: cifrado del mensaje (RFC 8291, aes128gcm) y firma VAPID (RFC 8292).
// Es lo que hace llegar una notificación a la app instalada en la pantalla de inicio del iPhone
// (iOS 16.4+), que el servicio de Apple reenvía también al Apple Watch.
import { createCipheriv, createECDH, createHash, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from "node:crypto";

/** Lo que el navegador entrega al suscribirse (PushSubscription.toJSON()). */
export type Suscripcion = { endpoint: string; p256dh: string; auth: string };

/** Llaves VAPID del servidor, en base64url: la pública sin comprimir (65 bytes) y la privada (32 bytes). */
export type ClavesVapid = { publica: string; privada: string };

const b64 = (datos: Uint8Array) => Buffer.from(datos).toString("base64url");
const deB64 = (texto: string) => new Uint8Array(Buffer.from(texto, "base64url"));

export function generarClavesVapid(): ClavesVapid {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const publica = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return { publica: b64(publica), privada: jwk.d! };
}

// Cada mensaje cabe en un solo registro: 4096 bytes es lo que piden los servicios de push.
const TAMANO_REGISTRO = 4096;
/** Lo más que puede medir el texto de un mensaje (el registro menos la cabecera, el relleno y la etiqueta). */
export const MAX_MENSAJE = 3800;

/**
 * Cifra `mensaje` para esa suscripción (RFC 8291). `efimera` y `sal` solo se pasan en pruebas, para
 * reproducir el ejemplo del RFC; en uso normal cambian en cada mensaje.
 */
export function cifrar(
  suscripcion: Pick<Suscripcion, "p256dh" | "auth">,
  mensaje: Uint8Array,
  pruebas: { efimera?: Uint8Array; sal?: Uint8Array } = {},
): Uint8Array {
  if (mensaje.length > MAX_MENSAJE) throw new Error(`El mensaje mide ${mensaje.length} bytes; el máximo es ${MAX_MENSAJE}.`);
  const receptor = deB64(suscripcion.p256dh);
  const secreto = deB64(suscripcion.auth);
  if (receptor.length !== 65 || receptor[0] !== 4) throw new Error("La llave p256dh de la suscripción no es válida.");
  if (secreto.length < 16) throw new Error("El secreto auth de la suscripción no es válido.");

  const ecdh = createECDH("prime256v1");
  if (pruebas.efimera) ecdh.setPrivateKey(pruebas.efimera);
  else ecdh.generateKeys();
  const emisor = ecdh.getPublicKey();
  const compartido = ecdh.computeSecret(receptor);
  const sal = pruebas.sal ?? randomBytes(16);

  const info = (texto: string, ...extra: Uint8Array[]) => Buffer.concat([Buffer.from(texto), Buffer.from([0]), ...extra]);
  const ikm = Buffer.from(hkdfSync("sha256", compartido, secreto, info("WebPush: info", receptor, emisor), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, sal, info("Content-Encoding: aes128gcm"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, sal, info("Content-Encoding: nonce"), 12));

  const cifrador = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marca el último (y único) registro.
  const cifrado = Buffer.concat([cifrador.update(Buffer.concat([mensaje, Buffer.from([2])])), cifrador.final(), cifrador.getAuthTag()]);

  const cabecera = Buffer.alloc(16 + 4 + 1);
  Buffer.from(sal).copy(cabecera, 0);
  cabecera.writeUInt32BE(TAMANO_REGISTRO, 16);
  cabecera.writeUInt8(emisor.length, 20);
  return new Uint8Array(Buffer.concat([cabecera, emisor, cifrado]));
}

/**
 * El JWT de VAPID para el servicio de push de `endpoint`. `contacto` es un mailto: o https: con el que el
 * servicio puede avisar de un problema; Apple lo exige.
 */
export function firmaVapid(endpoint: string, claves: ClavesVapid, contacto: string, ahora = Date.now()): string {
  const publica = deB64(claves.publica);
  const llave = createPrivateKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", d: claves.privada, x: b64(publica.slice(1, 33)), y: b64(publica.slice(33, 65)) },
  });
  const cabecera = b64(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // Apple rechaza firmas que duren más de un día; una hora basta para un envío.
  const datos = { aud: new URL(endpoint).origin, exp: Math.floor(ahora / 1000) + 3600, sub: contacto };
  const cuerpo = b64(Buffer.from(JSON.stringify(datos)));
  const firma = sign("sha256", Buffer.from(`${cabecera}.${cuerpo}`), { key: llave, dsaEncoding: "ieee-p1363" });
  return `${cabecera}.${cuerpo}.${b64(firma)}`;
}

/**
 * Servicios de push a los que la Mac acepta mandar: así una suscripción no puede hacer que el servidor
 * le pegue a otra dirección (su propia red, por ejemplo).
 */
const SERVICIOS_PUSH = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function endpointValido(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.port && SERVICIOS_PUSH.some((s) => s.test(url.hostname));
}

export type OpcionesEnvio = {
  /** Cuánto guarda el servicio el mensaje si el iPhone está apagado (segundos). */
  ttl?: number;
  urgencia?: "very-low" | "low" | "normal" | "high";
  /** Un mensaje nuevo con el mismo tema reemplaza al que no se ha entregado. */
  tema?: string;
  /** Para pruebas: otro fetch. */
  fetch?: typeof fetch;
};

/**
 * El encabezado Topic que sale de una etiqueta. Apple contestó 400 BadWebPushTopic a "listo-version", que el
 * RFC 8030 permite; 32 caracteres hexadecimales caben en cualquier lectura de la regla. La misma etiqueta da el
 * mismo tema, así que un mensaje nuevo sigue reemplazando al anterior.
 */
export const temaPush = (etiqueta: string) => createHash("sha256").update(etiqueta).digest("hex").slice(0, 32);

export type ResultadoEnvio = {
  ok: boolean;
  estado: number;
  /** La suscripción ya no existe (el usuario quitó el permiso o borró la app): hay que olvidarla. */
  vencida: boolean;
  detalle?: string;
};

/** Manda un mensaje cifrado a una suscripción. No lanza: un error de red vuelve como estado 0. */
export async function enviarPush(
  suscripcion: Suscripcion,
  mensaje: string,
  claves: ClavesVapid,
  contacto: string,
  opciones: OpcionesEnvio = {},
): Promise<ResultadoEnvio> {
  if (!endpointValido(suscripcion.endpoint)) return { ok: false, estado: 0, vencida: true, detalle: "Servicio de push no permitido." };
  let cuerpo: Uint8Array;
  try {
    cuerpo = cifrar(suscripcion, new TextEncoder().encode(mensaje));
  } catch (error) {
    // Un mensaje que no se pudo cifrar no dice nada de la suscripción: no se borra.
    return { ok: false, estado: 0, vencida: false, detalle: (error as Error).message };
  }
  const encabezados: Record<string, string> = {
    Authorization: `vapid t=${firmaVapid(suscripcion.endpoint, claves, contacto)}, k=${claves.publica}`,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opciones.ttl ?? 24 * 3600),
    Urgency: opciones.urgencia ?? "normal",
  };
  if (opciones.tema) encabezados.Topic = temaPush(opciones.tema);
  try {
    const res = await (opciones.fetch ?? fetch)(suscripcion.endpoint, {
      method: "POST",
      headers: encabezados,
      body: cuerpo as Uint8Array<ArrayBuffer>,
      // Un servicio de push no redirige: seguirlo mandaría el mensaje a otra dirección.
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const detalle = res.ok ? undefined : (await res.text().catch(() => "")).slice(0, 300) || res.statusText;
    return { ok: res.ok, estado: res.status, vencida: res.status === 404 || res.status === 410, detalle };
  } catch (error) {
    return { ok: false, estado: 0, vencida: false, detalle: (error as Error).message };
  }
}
