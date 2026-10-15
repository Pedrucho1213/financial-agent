import { dinero, dineroCorto, pct } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { hashDeuda } from "../../lib/deudas";
import { navegar } from "../../lib/ruta";
import type { DeudaPersona } from "../../lib/tipos";
import { cn } from "../../lib/utils";
import { Ajustado } from "../Ajustado";

// Colores de iOS para las iniciales; cada persona siempre sale del mismo.
const COLORES_INICIAL = ["#5ac8fa", "#ff9f0a", "#af52de", "#34c759", "#ff2d55", "#5856d6", "#ff9500", "#30b0c7"];

export function colorPersona(nombre: string) {
  const n = [...nombre].reduce((a, c) => a + c.charCodeAt(0), 0);
  return COLORES_INICIAL[n % COLORES_INICIAL.length]!;
}

/** La inicial de la persona en un círculo de color, como en Contactos. */
export function Inicial({ nombre, tamano = 40, className }: { nombre: string; tamano?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ background: colorPersona(nombre), width: tamano, height: tamano, fontSize: Math.round(tamano * 0.42) }}
    >
      {nombre.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Color de lo pagado: verde lo que te devuelven, el de las metas lo que abonas. */
export const colorDeuda = (d: Pick<DeudaPersona, "direccion">) => (d.direccion === "me_deben" ? "var(--positive)" : "var(--anillo-meta)");

export const pagadoDe = (d: DeudaPersona) => (d.prestadoCentavos > 0 ? Math.min(1, d.pagadoCentavos / d.prestadoCentavos) : 0);

// "Mamá" se dice «a mi mamá»; un nombre, tal cual.
const PARENTESCOS = new Set(["Mamá", "Papá", "Abuela", "Abuelo", "Esposa", "Esposo", "Hermano", "Hermana", "Tío", "Tía", "Primo", "Prima", "Suegro", "Suegra"]);
export const comoSeDice = (persona: string) => (PARENTESCOS.has(persona) ? `mi ${persona.toLowerCase()}` : persona);

/** «Le debes» / «Te debe» / «Saldada». */
export const sentidoDe = (d: DeudaPersona) => (d.pendienteCentavos <= 0 ? "Saldada" : d.direccion === "me_deben" ? "Te debe" : "Le debes");

const fCorto = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

/**
 * Una deuda como tarjeta chica, igual que las de crédito: con quién, cuánto falta y cuánto va pagado. Dos por
 * renglón, también a 320 px.
 */
export function TarjetaDeuda({ d, moneda }: { d: DeudaPersona; moneda: string }) {
  const color = colorPersona(d.persona);
  const pagado = pagadoDe(d);
  const saldada = d.pendienteCentavos <= 0;
  return (
    <button
      type="button"
      data-deuda={d.persona}
      onClick={() => {
        haptico();
        navegar(hashDeuda(d));
      }}
      aria-label={`${d.persona}, ${sentidoDe(d).toLowerCase()} ${dinero(d.pendienteCentavos, moneda)}`}
      className="presionable relative flex min-h-[116px] min-w-0 flex-col overflow-hidden rounded-[18px] p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
      // Un toque del color de la persona arriba, como las tarjetas de su banco, sin perder lo legible del fondo.
      style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${color} 24%, var(--card)), var(--card) 62%)` }}
    >
      <span className="flex items-center justify-between gap-1.5">
        <Inicial nombre={d.persona} tamano={26} />
        {pagado > 0 && !saldada ? (
          <span className="shrink-0 text-[13px] font-semibold text-muted-foreground tabular" aria-label={`${pct(pagado)} pagado`}>
            {pct(pagado)}
          </span>
        ) : null}
      </span>
      <span className="mt-1.5 text-[15px] leading-5 font-semibold break-words">{d.persona}</span>
      <span className="mt-auto pt-2 text-[11px] leading-4 font-bold tracking-[0.04em] text-muted-foreground uppercase">{sentidoDe(d)}</span>
      <Ajustado
        como="span"
        className={cn(
          "block truncate text-[22px] leading-7 font-bold tracking-[-0.02em] tabular",
          d.direccion === "me_deben" && !saldada && "text-positive",
        )}
      >
        {dinero(saldada ? d.prestadoCentavos : d.pendienteCentavos, moneda)}
      </Ajustado>
      <span aria-hidden className="mt-1.5 block h-1 overflow-hidden rounded-full bg-fill">
        <i
          className="block h-full origin-left animate-crecer-x rounded-full"
          style={{ width: `${Math.max(pagado > 0 ? 3 : 0, pagado * 100)}%`, background: colorDeuda(d) }}
        />
      </span>
      <span className="mt-1.5 block text-[12px] leading-4 font-medium break-words text-muted-foreground">
        {d.pagadoCentavos > 0 && !saldada ? (
          <>
            {d.direccion === "me_deben" ? "Te ha pagado" : "Abonaste"} <span className="whitespace-nowrap">{dineroCorto(d.pagadoCentavos, moneda)}</span>
          </>
        ) : (
          `Desde el ${fCorto.format(new Date(d.desde)).replace(".", "")}`
        )}
      </span>
    </button>
  );
}

const ALTO_SALDO = 72;

/**
 * Lo que falta de una deuda con el tiempo: sube con cada préstamo y baja con cada abono, en escalones, hasta hoy.
 * Sin ejes: la fecha de la primera y "Hoy" abajo, como las gráficas chicas de Wallet.
 */
export function SaldoDeuda({ movimientos, color }: { movimientos: DeudaPersona["movimientos"]; color: string }) {
  const orden = [...movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const inicio = Date.parse(orden[0]?.fecha ?? "") || Date.now();
  const fin = Math.max(Date.now(), inicio + 86_400_000);
  let saldo = 0;
  const puntos = orden.map((m) => {
    saldo += m.tipo === "prestamo" ? m.montoCentavos : -m.montoCentavos;
    return { t: Date.parse(m.fecha), saldo: Math.max(0, saldo) };
  });
  const maximo = Math.max(1, ...puntos.map((p) => p.saldo));
  const x = (t: number) => ((t - inicio) / (fin - inicio)) * 100;
  const y = (v: number) => 4 + (1 - v / maximo) * (ALTO_SALDO - 8);
  let d = "";
  puntos.forEach((p, i) => {
    d += i === 0 ? `M${x(p.t).toFixed(2)},${y(p.saldo).toFixed(1)}` : ` H${x(p.t).toFixed(2)} V${y(p.saldo).toFixed(1)}`;
  });
  d += ` H100`;
  const area = `${d} V${ALTO_SALDO} H${x(puntos[0]?.t ?? inicio).toFixed(2)} Z`;
  return (
    <div>
      <svg viewBox={`0 0 100 ${ALTO_SALDO}`} preserveAspectRatio="none" role="img" aria-label="Lo que falta de la deuda con el tiempo" className="block w-full" style={{ height: ALTO_SALDO }}>
        <path d={area} fill={color} opacity={0.15} />
        <path d={d} fill="none" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[12px] text-muted-foreground">
        <span>{fCorto.format(new Date(inicio)).replace(".", "")}</span>
        <span>Hoy</span>
      </div>
    </div>
  );
}
