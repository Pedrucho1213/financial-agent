import { useEffect, useId, useMemo, useRef, useState } from "react";
import { haptico } from "../lib/haptico";
import { cn } from "../lib/utils";

const ALTO = 92;
const ARRIBA = 8;

/** Suma acumulada: [10, 0, 5] -> [10, 10, 15]. */
export function acumular(dias: number[]) {
  let s = 0;
  return dias.map((d) => (s += d));
}

/**
 * Gasto acumulado del mes (línea azul con relleno) contra el mes anterior (punteada),
 * como Tarjeta de Apple o Bolsa. Al pasar el dedo de lado se elige un día; quien la usa
 * muestra ese día en el número grande. Con el dedo quieto en vertical, la página se desplaza.
 */
export function Ritmo({
  actual,
  anterior,
  diasMes,
  hasta,
  seleccionado,
  alElegir,
  className,
}: {
  /** Acumulado del mes (índice 0 = día 1); puede ser más corto que el mes. */
  actual: number[];
  /** Acumulado del mes anterior, completo. */
  anterior: number[];
  diasMes: number;
  /** Último día con datos (hoy en el mes actual). */
  hasta: number;
  seleccionado: number | null;
  alElegir: (dia: number | null) => void;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const ultimoDia = useRef<number | null>(null);
  // Se dibuja al ancho real (sin estirar), así los trazos y el punto no se deforman.
  const [ancho, setAncho] = useState(320);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && e.contentRect.width > 0 && setAncho(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { x, y, lineaActual, area, lineaAnterior } = useMemo(() => {
    const maximo = Math.max(1, ...actual.slice(0, hasta), ...anterior);
    const x = (dia: number) => (diasMes <= 1 ? 0 : ((dia - 1) / (diasMes - 1)) * ancho);
    const y = (v: number) => ARRIBA + (1 - v / maximo) * (ALTO - ARRIBA - 2);
    const trazo = (valores: number[], n: number) =>
      valores
        .slice(0, n)
        .map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`)
        .join(" ");
    const lineaActual = trazo(actual, hasta);
    const area = hasta > 0 ? `${lineaActual} L${x(hasta).toFixed(1)},${ALTO} L0,${ALTO} Z` : "";
    // El mes anterior se dibuja sobre los mismos días; si era más corto, termina antes.
    const lineaAnterior = trazo(anterior, Math.min(anterior.length, diasMes));
    return { x, y, lineaActual, area, lineaAnterior };
  }, [actual, anterior, diasMes, hasta, ancho]);

  const elegirDesde = (clientX: number) => {
    const el = svg.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fraccion = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const dia = Math.min(hasta, Math.max(1, Math.round(fraccion * (diasMes - 1)) + 1));
    if (dia !== ultimoDia.current) {
      if (ultimoDia.current !== null) haptico();
      ultimoDia.current = dia;
      alElegir(dia);
    }
  };
  const soltar = () => {
    ultimoDia.current = null;
    alElegir(null);
  };

  const marca = seleccionado ?? hasta;
  const valorMarca = actual[marca - 1] ?? 0;

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${ancho} ${ALTO}`}
      role="img"
      aria-label="Ritmo de gasto del mes contra el mes anterior"
      className={cn("block w-full touch-pan-y overflow-visible select-none", className)}
      style={{ height: ALTO }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        elegirDesde(e.clientX);
      }}
      onPointerMove={(e) => elegirDesde(e.clientX)}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      onPointerLeave={(e) => e.pointerType === "mouse" && soltar()}
    >
      <defs>
        <linearGradient id={`relleno-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--tint)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--tint)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={0} x2={ancho} y1={ALTO - 0.5} y2={ALTO - 0.5} stroke="var(--chart-grid)" />
      {lineaAnterior ? (
        <path
          d={lineaAnterior}
          fill="none"
          stroke="var(--chart-muted)"
          strokeWidth={1.5}
          strokeDasharray="3 4"
          strokeLinecap="round"
          strokeLinejoin="round"
         
          opacity={0.75}
        />
      ) : null}
      {area ? <path d={area} fill={`url(#relleno-${id})`} className="animate-aparecer" /> : null}
      {lineaActual ? (
        <path
          d={lineaActual}
          fill="none"
          stroke="var(--tint)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
         
          pathLength={1}
          strokeDasharray="1 1"
          className="animate-trazo"
        />
      ) : null}
      {seleccionado !== null ? (
        <line
          x1={x(seleccionado)}
          x2={x(seleccionado)}
          y1={0}
          y2={ALTO}
          stroke="var(--chart-axis)"
          strokeWidth={1}
         
        />
      ) : null}
      {hasta > 0 ? (
        <g transform={`translate(${x(marca).toFixed(1)} ${y(valorMarca).toFixed(1)})`}>
          {seleccionado === null ? (
            <circle r={5} fill="var(--tint)" className="origin-center animate-latido [transform-box:fill-box]" />
          ) : null}
          <circle r={5.5} fill="var(--tint)" stroke="var(--card)" strokeWidth={2.5} />
        </g>
      ) : null}
    </svg>
  );
}
