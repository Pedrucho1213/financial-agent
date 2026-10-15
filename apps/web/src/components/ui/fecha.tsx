import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { aFecha, hoyIso, nombreMes } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { cn } from "../../lib/utils";
import { Fila } from "./lista";

const DIAS_SEMANA = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
const fDiaLargo = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "14 oct 2026" */
export function fechaCorta(iso: string) {
  return aFecha(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
}

/** "2026-10" + n meses */
function sumarMes(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a ?? 1970, (m ?? 1) - 1 + n, 1, 12);
  return hoyIso(d).slice(0, 7);
}

/**
 * Fila de fecha con un calendario que se despliega debajo, dentro de la misma lista (como Calendario de iOS).
 * No usa el <input type="date"> nativo: en una hoja de iOS su globo se movía de arriba abajo sin parar y
 * contaba como teclado abierto (escondía la barra de abajo).
 */
export function CampoFecha({
  id,
  etiqueta,
  valor,
  alCambiar,
  min,
  max,
  texto = fechaCorta,
  vacio = "Sin fecha",
  quitable = false,
}: {
  id: string;
  etiqueta: string;
  /** "AAAA-MM-DD", o "" sin fecha. */
  valor: string;
  alCambiar: (v: string) => void;
  min?: string;
  max?: string;
  /** Lo que dice el botón con la fecha elegida. */
  texto?: (iso: string) => string;
  vacio?: string;
  /** Deja quitar la fecha (cuando es opcional). */
  quitable?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  // Sigue pintado mientras se cierra, para que se pliegue con su contenido.
  const [pintado, setPintado] = useState(false);
  if (abierto && !pintado) setPintado(true);
  const panel = useRef<HTMLDivElement>(null);
  const valorTexto = valor ? texto(valor) : vacio;

  // Al abrirse, que se vea completo dentro de la hoja.
  useEffect(() => {
    if (!abierto) return;
    const t = window.setTimeout(() => panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 320);
    return () => window.clearTimeout(t);
  }, [abierto]);

  return (
    <>
      <Fila>
        <label htmlFor={id} className="shrink-0">
          {etiqueta}
        </label>
        <button
          id={id}
          type="button"
          aria-expanded={abierto}
          aria-controls={`${id}-calendario`}
          aria-label={`${etiqueta}: ${valorTexto}`}
          data-valor-fecha={valor}
          onClick={() => setAbierto((a) => !a)}
          className={cn(
            "ml-auto flex h-[32px] shrink-0 items-center rounded-full bg-fill px-3 text-[16px] whitespace-nowrap tabular transition-colors",
            abierto ? "text-tint" : valor ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {valorTexto}
        </button>
      </Fila>
      <div
        className="grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ gridTemplateRows: abierto ? "1fr" : "0fr" }}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && !abierto) setPintado(false);
        }}
      >
        <div ref={panel} id={`${id}-calendario`} className="min-h-0 overflow-hidden" inert={!abierto}>
          {abierto || pintado ? (
            <Calendario
              valor={valor}
              min={min}
              max={max}
              etiqueta={etiqueta}
              alElegir={(v) => {
                haptico();
                alCambiar(v);
                setAbierto(false);
              }}
              alQuitar={
                quitable && valor
                  ? () => {
                      alCambiar("");
                      setAbierto(false);
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function Calendario({
  valor,
  min,
  max,
  etiqueta,
  alElegir,
  alQuitar,
}: {
  valor: string;
  min?: string;
  max?: string;
  etiqueta: string;
  alElegir: (v: string) => void;
  alQuitar?: () => void;
}) {
  const hoy = hoyIso();
  const [mes, setMes] = useState(() => (valor || (min && min > hoy ? min : hoy)).slice(0, 7));
  const rejilla = useRef<HTMLDivElement>(null);
  const toque = useRef<{ x: number; y: number } | null>(null);

  const puedeAtras = !min || sumarMes(mes, -1) >= min.slice(0, 7);
  const puedeAdelante = !max || sumarMes(mes, 1) <= max.slice(0, 7);

  const irA = (n: number) => {
    if ((n < 0 && !puedeAtras) || (n > 0 && !puedeAdelante)) return;
    mostrar(sumarMes(mes, n));
  };
  const mostrar = (destino: string) => {
    if (destino === mes) return;
    const n = destino > mes ? 1 : -1;
    setMes(destino);
    // El mes nuevo entra desde el lado hacia el que se avanzó.
    rejilla.current?.animate(
      [
        { transform: `translateX(${n > 0 ? 24 : -24}px)`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
  };

  const primero = aFecha(`${mes}-01`);
  const vacios = primero.getDay();
  const diasDelMes = new Date(primero.getFullYear(), primero.getMonth() + 1, 0).getDate();
  const dias = Array.from({ length: diasDelMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);

  return (
    <div
      role="group"
      aria-label={`Calendario de ${etiqueta.toLowerCase()}`}
      data-mes={mes}
      className="relative px-2 pt-1 pb-2 before:absolute before:top-0 before:right-0 before:left-4 before:h-[0.5px] before:bg-separator before:content-['']"
      // Deslizar de lado cambia de mes, como en iOS.
      onTouchStart={(e) => {
        const t = e.touches[0];
        toque.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0];
        const inicio = toque.current;
        toque.current = null;
        if (!t || !inicio) return;
        const dx = t.clientX - inicio.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(t.clientY - inicio.y) * 1.5) irA(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex h-11 items-center gap-1 pl-2">
        {/* «Septiembre 2026» cabe en un renglón aun a 320 px con «Hoy» y las flechas. */}
        <span aria-live="polite" className="min-w-0 flex-1 text-[17px] font-semibold whitespace-nowrap">
          {nombreMes(mes)}
        </span>
        {mes !== hoy.slice(0, 7) && (!min || hoy >= min) && (!max || hoy <= max) ? (
          <button type="button" onClick={() => mostrar(hoy.slice(0, 7))} className="h-9 shrink-0 px-2 text-[15px] text-tint">
            Hoy
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Mes anterior"
          disabled={!puedeAtras}
          onClick={() => irA(-1)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-tint disabled:text-muted-foreground/40"
        >
          <ChevronLeft aria-hidden className="size-[22px]" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          aria-label="Mes siguiente"
          disabled={!puedeAdelante}
          onClick={() => irA(1)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-tint disabled:text-muted-foreground/40"
        >
          <ChevronRight aria-hidden className="size-[22px]" strokeWidth={2.4} />
        </button>
      </div>
      <div aria-hidden className="grid grid-cols-7 pb-1 text-center text-[12px] font-semibold text-muted-foreground">
        {DIAS_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div ref={rejilla} className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: vacios }, (_, i) => (
          <span key={`v${i}`} />
        ))}
        {dias.map((iso) => {
          const elegido = iso === valor;
          const esHoy = iso === hoy;
          const fuera = (min && iso < min) || (max && iso > max);
          return (
            <button
              key={iso}
              type="button"
              data-dia={iso}
              aria-label={fDiaLargo.format(aFecha(iso))}
              aria-pressed={elegido}
              aria-current={esHoy ? "date" : undefined}
              disabled={!!fuera}
              onClick={() => alElegir(iso)}
              className="flex h-10 items-center justify-center disabled:pointer-events-none"
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-[19px] tabular transition-colors",
                  elegido
                    ? "bg-tint font-semibold text-white"
                    : esHoy
                      ? "font-semibold text-tint"
                      : fuera
                        ? "text-muted-foreground/40"
                        : "text-foreground active:bg-fill",
                )}
              >
                {Number(iso.slice(8))}
              </span>
            </button>
          );
        })}
      </div>
      {alQuitar ? (
        <div className="flex justify-center pt-1">
          <button type="button" onClick={alQuitar} className="h-9 px-3 text-[15px] text-destructive">
            Quitar fecha
          </button>
        </div>
      ) : null}
    </div>
  );
}
