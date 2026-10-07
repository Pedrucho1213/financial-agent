import { api, ErrorApi } from "./api";
import { enPantallaDeInicio, esIOS } from "./plataforma";

// Notificaciones push. En el iPhone solo funcionan con la app agregada a la pantalla de inicio (iOS 16.4+)
// y el permiso se pide al tocar un botón; nunca solo.

export type EstadoPushServidor = { clave: string; activo: boolean; endpoint: string | null; otros: number; ultimoError: string | null };

/** Por qué este dispositivo no puede recibirlas, o null si sí puede. */
export function motivoSinPush(): "instalar" | "navegador" | null {
  const soporta = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // Safari en el iPhone no las da en una pestaña: hay que abrir la app desde la pantalla de inicio.
  if (esIOS() && !enPantallaDeInicio()) return "instalar";
  return soporta ? null : "navegador";
}

export function permiso(): NotificationPermission {
  return "Notification" in window ? Notification.permission : "denied";
}

async function registro(): Promise<ServiceWorkerRegistration> {
  const r = await navigator.serviceWorker.getRegistration();
  if (r) return navigator.serviceWorker.ready;
  throw new Error("La app todavía se está instalando. Ciérrala, vuelve a abrirla e inténtalo de nuevo.");
}

function bytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const texto = atob(b64);
  const salida = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) salida[i] = texto.charCodeAt(i);
  return salida;
}

/** El Atajo corre en el iPhone: sus notificaciones son las que permiten que conteste corto. */
const enIphone = () => /iPhone|iPod/i.test(navigator.userAgent);

const iguales = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Cuánto se espera a que iOS conteste al suscribir antes de rendirse. */
const LIMITE_SUSCRIBIR_MS = 15_000;

/** A veces iOS nunca contesta al suscribir: sin límite, el interruptor giraría para siempre. */
function conLimite<T>(promesa: Promise<T>): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, falla) => {
    reloj = setTimeout(() => falla(new Error("No se pudieron activar, inténtalo de nuevo.")), LIMITE_SUSCRIBIR_MS);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

const suscribir = (r: ServiceWorkerRegistration, clave: string) =>
  conLimite(r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(clave) }));

/** La suscripción de este navegador, si ya existe. */
export async function suscripcionActual(): Promise<PushSubscription | null> {
  if (motivoSinPush()) return null;
  const r = await navigator.serviceWorker.getRegistration();
  return (await r?.pushManager.getSubscription()) ?? null;
}

/** Pide el permiso. Hay que llamarlo directo en el toque, sin esperar nada antes: iOS lo exige. */
export function pedirPermiso(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}

/** Con el permiso pedido en el toque, suscribe este dispositivo. Si la llave del servidor cambió, la rehace. */
export async function activarPush(permisoPedido: Promise<NotificationPermission>): Promise<EstadoPushServidor> {
  const decision = await permisoPedido;
  if (decision !== "granted") {
    throw new Error(
      decision === "denied"
        ? "Las notificaciones están bloqueadas. Actívalas en Ajustes › Notificaciones › Finanzas."
        : "No diste permiso para las notificaciones.",
    );
  }
  const [{ clave }, r] = await Promise.all([api<EstadoPushServidor>("/v1/push"), conLimite(registro())]);
  let sub = await r.pushManager.getSubscription();
  const llave = sub?.options.applicationServerKey;
  if (sub && llave && !iguales(new Uint8Array(llave), bytes(clave))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await suscribir(r, clave);
  try {
    return await mandar(sub);
  } catch (error) {
    // Quedó de otra cuenta que usó este navegador: se pide una suscripción nueva.
    if (!(error instanceof ErrorApi) || error.estado !== 409) throw error;
    await sub.unsubscribe();
    return mandar(await suscribir(r, clave));
  }
}

function mandar(sub: PushSubscription): Promise<EstadoPushServidor> {
  const datos = sub.toJSON();
  return api<EstadoPushServidor>("/v1/push/suscripcion", {
    method: "POST",
    body: { endpoint: datos.endpoint, keys: datos.keys, origen: window.location.origin, en_iphone: enIphone() },
  });
}

export async function desactivarPush(): Promise<void> {
  await api("/v1/push/suscripcion", { method: "DELETE" });
  await (await suscripcionActual())?.unsubscribe();
}

/**
 * Si el permiso sigue dado pero el servidor no tiene esta suscripción (otra base, la borró un 410),
 * la vuelve a mandar sin preguntar nada.
 */
export async function sincronizarPush(servidor: EstadoPushServidor): Promise<EstadoPushServidor> {
  if (servidor.activo || permiso() !== "granted") return servidor;
  const sub = await suscripcionActual();
  if (!sub) return servidor;
  return mandar(sub);
}

/**
 * Al cerrar sesión, este dispositivo deja de recibir las notificaciones de la cuenta. Si la Mac no
 * contesta pronto, la sesión se cierra igual y al menos el navegador ya no tiene la suscripción.
 */
export async function soltarPush(): Promise<void> {
  await Promise.race([
    api("/v1/push/suscripcion", { method: "DELETE" }).catch(() => {}),
    new Promise((listo) => setTimeout(listo, 3000)),
  ]);
  await (await suscripcionActual().catch(() => null))?.unsubscribe().catch(() => false);
}
