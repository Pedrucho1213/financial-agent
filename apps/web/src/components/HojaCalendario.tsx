import { aFecha, mesCorto } from "../lib/formato";

/** La hojita de calendario de un cobro: mes en rojo y el día. */
export function HojaCalendario({ fecha }: { fecha: string }) {
  const f = aFecha(fecha);
  return (
    <span aria-hidden className="flex size-9 shrink-0 flex-col overflow-hidden rounded-[8px] bg-elevated text-center ring-[0.5px] ring-separator">
      <span className="bg-[#ff3b30] text-[8px] leading-[11px] font-bold text-white uppercase">{mesCorto(fecha.slice(0, 7))}</span>
      <span className="flex-1 text-[16px] leading-[24px] font-semibold tabular">{f.getDate()}</span>
    </span>
  );
}
