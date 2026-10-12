import { useSyncExternalStore } from "react";

// Modo de voz del chat: dictar con el reconocimiento de voz del navegador y leer en voz alta lo que
// contesta la IA (como Siri: si se lo dijiste, te contesta hablando). Las dos APIs son del navegador:
// en iPhone las da Safari, sin mandar audio a nuestro servidor.

// Web Speech API: solo existe en algunos navegadores (Safari y Chrome la tienen con prefijo).
type ResultadoVoz = { isFinal: boolean; 0: { transcript: string } };
type EventoVoz = { results: ArrayLike<ResultadoVoz> };
export type Reconocedor = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: EventoVoz) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type ConstructorReconocedor = new () => Reconocedor;

export function reconocedorDisponible(): ConstructorReconocedor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: ConstructorReconocedor; webkitSpeechRecognition?: ConstructorReconocedor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Une lo que ya estaba escrito con lo dictado, sin espacios de más. Lo que empieza con lo dictado va con mayúscula. */
export function unirDictado(base: string, dicho: string) {
  const a = base.trimEnd();
  const b = dicho.trim();
  if (!a) return b.replace(/^([¿¡"«]*)(\p{Ll})/u, (_, signos: string, letra: string) => signos + letra.toUpperCase());
  return b ? `${a} ${b}` : a;
}

/** Lo que dice cada error del reconocimiento; null si no hay que decir nada. */
export function mensajeErrorDictado(error: string): string | null {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permite el micrófono y el reconocimiento de voz para Finanzas en Ajustes del iPhone.";
    case "audio-capture":
      return "No encontré un micrófono. Revisa que ninguna otra app lo esté usando.";
    case "network":
      return "El dictado necesita internet. Escríbelo mientras vuelve.";
    case "language-not-supported":
      return "Este dispositivo no dicta en español.";
    default:
      return null; // aborted, no-speech: se maneja al terminar
  }
}

// ---- Leer en voz alta ----

const CLAVE_LEER = "fa_voz_leer";

export function lecturaDisponible() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function leerPreferencia() {
  try {
    return localStorage.getItem(CLAVE_LEER) !== "0";
  } catch {
    return true;
  }
}

type EstadoVoz = { leerEnVoz: boolean; leyendo: string | null };
let estado: EstadoVoz = { leerEnVoz: leerPreferencia(), leyendo: null };
const oyentes = new Set<() => void>();

function emitir(cambios: Partial<EstadoVoz>) {
  estado = { ...estado, ...cambios };
  for (const o of oyentes) o();
}

export function useVoz() {
  return useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    () => estado,
  );
}

export function cambiarLeerEnVoz(leer: boolean) {
  try {
    localStorage.setItem(CLAVE_LEER, leer ? "1" : "0");
  } catch {
    // nada
  }
  if (!leer) callar();
  emitir({ leerEnVoz: leer });
}

/**
 * La voz en español que suena más natural: primero la de México, luego Latinoamérica y España;
 * entre ellas, las mejoradas (Premium, Enhanced, Siri) y las del propio equipo.
 */
export function elegirVoz(voces: readonly Pick<SpeechSynthesisVoice, "lang" | "name" | "localService">[]) {
  const puntos = (v: (typeof voces)[number]) => {
    const lang = v.lang.replace("_", "-").toLowerCase();
    if (!lang.startsWith("es")) return -1;
    let p = lang === "es-mx" ? 40 : lang === "es-us" || lang === "es-419" ? 30 : lang === "es-es" ? 10 : 20;
    if (/premium|enhanced|mejorad|siri|neural|natural/i.test(v.name)) p += 8;
    // Las voces de juguete de Apple (Eloquence) también vienen en español.
    if (/\b(eddy|flo|grandma|grandpa|abuel[ao]|reed|rocko|sandy|shelley|compact)\b/i.test(v.name)) p -= 30;
    else if (/paulina|m[oó]nica|juan/i.test(v.name)) p += 4;
    if (v.localService) p += 2;
    return p;
  };
  let mejor: (typeof voces)[number] | undefined;
  let max = -1;
  for (const v of voces) {
    const p = puntos(v);
    if (p > max) {
      max = p;
      mejor = v;
    }
  }
  return max >= 0 ? mejor : undefined;
}

/** Quita lo que no se lee bien en voz alta (asteriscos, viñetas, abreviaturas). */
export function textoParaLeer(texto: string) {
  return texto
    .replace(/[*_#`~>]+/g, "")
    .replace(/^\s*[-•·]\s+/gm, "")
    .replace(/\bMSI\b/g, "meses sin intereses")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.(\s*\.)+/g, ".")
    .replace(/([?!:;,])\./g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

let vozElegida: SpeechSynthesisVoice | undefined;
function voz() {
  if (!vozElegida) vozElegida = elegirVoz(window.speechSynthesis.getVoices()) as SpeechSynthesisVoice | undefined;
  return vozElegida;
}
if (lecturaDisponible()) {
  // En Safari y Chrome la lista llega después de cargar la página.
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    vozElegida = undefined;
  });
}

let desbloqueada = false;
/**
 * iOS solo deja hablar a una página si la primera vez fue al tocar algo. Se llama al tocar el micrófono:
 * la respuesta llega después, fuera del toque, y así ya se puede leer.
 */
export function desbloquearLectura() {
  if (desbloqueada || !lecturaDisponible()) return;
  desbloqueada = true;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    // nada
  }
}

let turno = 0;
/** Lee `texto` en voz alta y marca `id` como lo que se está leyendo. `alTerminar` solo si se leyó completo. */
export function leer(id: string, texto: string, alTerminar?: () => void) {
  if (!lecturaDisponible()) return;
  const limpio = textoParaLeer(texto);
  if (!limpio) return;
  const s = window.speechSynthesis;
  const mio = ++turno;
  s.cancel();
  const u = new SpeechSynthesisUtterance(limpio);
  const v = voz();
  if (v) u.voice = v;
  u.lang = v?.lang ?? "es-MX";
  u.rate = 1.05;
  const fin = (completo: boolean) => {
    if (mio !== turno) return;
    turno++;
    emitir({ leyendo: null });
    if (completo) alTerminar?.();
  };
  u.onend = () => fin(true);
  u.onerror = () => fin(false);
  emitir({ leyendo: id });
  s.speak(u);
}

export function callar() {
  if (!lecturaDisponible()) return;
  turno++;
  window.speechSynthesis.cancel();
  if (estado.leyendo) emitir({ leyendo: null });
}

// Al salir de la app (otra app, bloqueo) iOS corta la voz a medias: se calla del todo.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") callar();
  });
}
