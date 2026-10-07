// Dinero y fechas en español de México.

const formatosDinero = new Map<string, Intl.NumberFormat>();

function formatoDinero(moneda: string, compacto: boolean) {
  const clave = `${moneda}:${compacto}`;
  let f = formatosDinero.get(clave);
  if (!f) {
    f = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: moneda,
      ...(compacto ? { notation: "compact", maximumFractionDigits: 1 } : {}),
    });
    formatosDinero.set(clave, f);
  }
  return f;
}

export function dinero(centavos: number, moneda = "MXN", opciones: { signo?: boolean; compacto?: boolean } = {}) {
  const texto = formatoDinero(moneda, !!opciones.compacto).format(Math.abs(centavos) / 100);
  if (opciones.signo && centavos !== 0) return `${centavos < 0 ? "−" : "+"}${texto}`;
  return centavos < 0 ? `−${texto}` : texto;
}

/** Sin decimales cuando son ,00; útil en tarjetas grandes. */
export function dineroCorto(centavos: number, moneda = "MXN") {
  const f = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: moneda,
    minimumFractionDigits: centavos % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const texto = f.format(Math.abs(centavos) / 100);
  return centavos < 0 ? `−${texto}` : texto;
}

const porcentaje = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });
export function pct(valor: number) {
  return porcentaje.format(valor);
}

/** "2026-10-06" -> Date local a mediodía (evita saltos por zona horaria). */
export function aFecha(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}

export function hoyIso(fecha = new Date()) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${a}-${m}-${d}`;
}

export function mesActual(fecha = new Date()) {
  return hoyIso(fecha).slice(0, 7);
}

export function sumarMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const f = new Date(a ?? 1970, (m ?? 1) - 1 + n, 1, 12);
  return hoyIso(f).slice(0, 7);
}

export function rangoDelMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(a ?? 1970, m ?? 1, 0, 12).getDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

function capitalizar(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const fMes = new Intl.DateTimeFormat("es-MX", { month: "long" });
const fMesAnio = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });
const fMesCorto = new Intl.DateTimeFormat("es-MX", { month: "short" });

/** "Octubre 2026" */
export function nombreMes(mes: string, conAnio = true) {
  const f = aFecha(`${mes}-01`);
  if (!conAnio) return capitalizar(fMes.format(f));
  return capitalizar(fMesAnio.format(f).replace(" de ", " "));
}

/** "oct" */
export function mesCorto(mes: string) {
  return fMesCorto.format(aFecha(`${mes}-01`)).replace(".", "");
}

const fDiaLargo = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" });
const fDiaLargoAnio = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fDiaCorto = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

/** "Hoy", "Ayer" o "Lunes 5 de octubre". */
export function nombreDia(iso: string, hoy = hoyIso()) {
  if (iso === hoy) return "Hoy";
  const ayer = aFecha(hoy);
  ayer.setDate(ayer.getDate() - 1);
  if (iso === hoyIso(ayer)) return "Ayer";
  const f = aFecha(iso);
  const mismoAnio = iso.slice(0, 4) === hoy.slice(0, 4);
  return capitalizar((mismoAnio ? fDiaLargo : fDiaLargoAnio).format(f).replace(",", ""));
}

/** "5 oct" */
export function diaCorto(iso: string) {
  return fDiaCorto.format(aFecha(iso)).replace(".", "");
}

/** Día del mes de una fecha ISO: "6 de septiembre" para el mismo día del mes anterior. */
export function diaDeMes(iso: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long" }).format(aFecha(iso));
}

const fFechaHora = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
export function fechaHora(iso: string) {
  return fFechaHora.format(new Date(iso));
}

const relativo = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
export function haceCuanto(iso: string | null, ahora = Date.now()) {
  if (!iso) return "nunca";
  const seg = Math.round((new Date(iso).getTime() - ahora) / 1000);
  const abs = Math.abs(seg);
  if (abs < 60) return "justo ahora";
  if (abs < 3600) return relativo.format(Math.round(seg / 60), "minute");
  if (abs < 86400) return relativo.format(Math.round(seg / 3600), "hour");
  if (abs < 86400 * 30) return relativo.format(Math.round(seg / 86400), "day");
  if (abs < 86400 * 365) return relativo.format(Math.round(seg / (86400 * 30)), "month");
  return relativo.format(Math.round(seg / (86400 * 365)), "year");
}

export function diasHasta(iso: string, hoy = hoyIso()) {
  return Math.round((aFecha(iso).getTime() - aFecha(hoy).getTime()) / 86400000);
}

export const FRECUENCIAS: Record<string, string> = {
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
  anual: "Anual",
};

export const TIPOS: Record<string, string> = {
  gasto: "Gasto",
  ingreso: "Ingreso",
  transferencia: "Traspaso",
  pago_tarjeta: "Pago de tarjeta",
};
