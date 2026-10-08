import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { dinero } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { cn } from "../../lib/utils";

// Barras de Análisis en SVG propio (como Salud): se tocan o se arrastran para elegir una,
// y quien las usa muestra esa en el número grande. La elección se queda hasta tocarla otra vez.

const compacto = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });
/** "$12 mil" en el eje: corto, como se dice. */
export const ejeDinero = (centavos: number) => (centavos === 0 ? "0" : `$${compacto.format(centavos / 100)}`);

/** Un tope "redondo" para el eje (1, 2, 2.5 o 5 por potencia de 10) y sus 2 divisiones. */
export function topeBonito(maximo: number) {
  if (maximo <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(maximo));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= maximo) return m * p;
  return 10 * p;
}

/** Ancho real del elemento (para dibujar sin estirar). */
export function useAncho<T extends Element>(inicial = 320) {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && e.contentRect.width > 0 && setAncho(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho] as const;
}

/**
 * Elegir con el dedo: tocar elige (o suelta la elegida), arrastrar de lado recorre. `indiceEn` dice qué
 * índice queda bajo una x (o null fuera de los datos). Las flechas del teclado también mueven.
 */
function useEleccion({
  total,
  seleccionado,
  alElegir,
  indiceEn,
  valido,
}: {
  total: number;
  seleccionado: number | null;
  alElegir: (i: number | null) => void;
  indiceEn: (x: number) => number | null;
  valido: (i: number) => boolean;
}) {
  const inicio = useRef<{ x: number; i: number | null; arrastro: boolean } | null>(null);
  const ultimo = useRef<number | null>(seleccionado);
  ultimo.current = seleccionado;
  const elegir = (i: number | null) => {
    if (i === ultimo.current) return;
    if (i !== null) haptico();
    ultimo.current = i;
    alElegir(i);
  };
  const xDe = (e: PointerEvent<Element>) => e.clientX - e.currentTarget.getBoundingClientRect().left;
  return {
    onPointerDown: (e: PointerEvent<Element>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      inicio.current = { x: e.clientX, i: seleccionado, arrastro: false };
    },
    onPointerMove: (e: PointerEvent<Element>) => {
      const s = inicio.current;
      if (!s) return;
      if (!s.arrastro && Math.abs(e.clientX - s.x) < 6) return;
      s.arrastro = true;
      const i = indiceEn(xDe(e));
      if (i !== null && valido(i)) elegir(i);
    },
    onPointerUp: (e: PointerEvent<Element>) => {
      const s = inicio.current;
      inicio.current = null;
      if (!s || s.arrastro) return;
      const i = indiceEn(xDe(e));
      // Tocar la elegida (o fuera de los datos) la suelta.
      if (i === null || !valido(i) || i === s.i) elegir(null);
      else elegir(i);
    },
    onPointerCancel: () => {
      inicio.current = null;
    },
    onKeyDown: (e: KeyboardEvent<Element>) => {
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (e.key === "Escape") return elegir(null);
      if (!paso) return;
      e.preventDefault();
      let i = seleccionado ?? (paso > 0 ? -1 : total);
      do i += paso;
      while (i >= 0 && i < total && !valido(i));
      if (i >= 0 && i < total) elegir(i);
    },
  };
}

const ALTO = 150;
const ARRIBA = 10;
const ABAJO = 20;
const EJE = 40;

export type BarraDato = { valor: number; etiqueta: string; larga: string; futuro?: boolean };

/** Gasto por día, semana o mes, con la línea punteada del promedio. */
export function BarrasPeriodo({
  datos,
  promedio,
  seleccionado,
  alElegir,
  moneda,
  etiquetaPromedio = "prom.",
  className,
}: {
  datos: BarraDato[];
  promedio: number;
  seleccionado: number | null;
  alElegir: (i: number | null) => void;
  moneda: string;
  etiquetaPromedio?: string;
  className?: string;
}) {
  const [ref, ancho] = useAncho<SVGSVGElement>();
  const util = Math.max(1, ancho - EJE);
  const paso = util / Math.max(1, datos.length);
  const grueso = Math.max(2, Math.min(18, paso * 0.62));
  const tope = topeBonito(Math.max(promedio, ...datos.map((d) => d.valor)));
  const y = (v: number) => ARRIBA + (1 - v / tope) * (ALTO - ARRIBA - ABAJO);
  const base = ALTO - ABAJO;
  const x = (i: number) => i * paso + paso / 2;
  const eleccion = useEleccion({
    total: datos.length,
    seleccionado,
    alElegir,
    indiceEn: (px) => (px < 0 || px > util ? null : Math.min(datos.length - 1, Math.floor(px / paso))),
    valido: (i) => !datos[i]?.futuro,
  });
  const resumen = datos
    .filter((d) => !d.futuro && d.valor > 0)
    .map((d) => `${d.larga}: ${dinero(d.valor, moneda)}`)
    .join("; ");

  return (
    <div className={cn("relative", className)}>
      <svg
        ref={ref}
        viewBox={`0 0 ${ancho} ${ALTO}`}
        role="img"
        tabIndex={0}
        aria-label={`Gasto por ${datos.length > 12 ? "día o semana" : "periodo"}. Toca o desliza para ver cada uno. ${resumen}`}
        data-grafica="barras"
        className="block w-full touch-pan-y overflow-visible select-none focus-visible:rounded-lg"
        style={{ height: ALTO }}
        {...eleccion}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={0} x2={util} y1={y(tope * f)} y2={y(tope * f)} stroke={f === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} />
            <text x={util + 6} y={y(tope * f) + 4} fontSize={11} fill="var(--chart-muted)" className="tabular">
              {ejeDinero(tope * f)}
            </text>
          </g>
        ))}
        {datos.map((d, i) =>
          d.futuro || d.valor <= 0 ? null : (
            <rect
              // La clave con el número de datos reinicia la animación al cambiar de periodo.
              key={`${datos.length}-${i}`}
              x={x(i) - grueso / 2}
              y={y(d.valor)}
              width={grueso}
              height={Math.max(1.5, base - y(d.valor))}
              rx={Math.min(4, grueso / 2)}
              fill="var(--tint)"
              opacity={seleccionado === null || seleccionado === i ? 1 : 0.32}
              className="fa-barra animate-crecer transition-opacity duration-200"
              style={{ animationDelay: `${Math.min(i * 14, 360)}ms` }}
              data-indice={i}
            />
          ),
        )}
        {promedio > 0 ? (
          <g>
            <line x1={0} x2={util} y1={y(promedio)} y2={y(promedio)} stroke="var(--orange)" strokeWidth={1.5} strokeDasharray="4 4" />
            {/* Con un halo del color de la tarjeta, para leerse aunque pase sobre una barra. */}
            <text
              x={4}
              y={y(promedio) - 5}
              fontSize={11}
              fontWeight={600}
              fill="var(--chart-ink-2)"
              stroke="var(--card)"
              strokeWidth={4}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {etiquetaPromedio}
            </text>
          </g>
        ) : null}
        {seleccionado !== null ? (
          <line x1={x(seleccionado)} x2={x(seleccionado)} y1={0} y2={base} stroke="var(--chart-axis)" strokeWidth={1} />
        ) : null}
        {datos.map((d, i) =>
          d.etiqueta ? (
            <text
              key={`e-${i}`}
              x={x(i)}
              y={ALTO - 4}
              fontSize={11}
              fontWeight={seleccionado === i ? 700 : 500}
              textAnchor="middle"
              fill={seleccionado === i ? "var(--chart-ink)" : "var(--chart-muted)"}
            >
              {d.etiqueta}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/** Lo que quedó cada mes (entró menos salió): arriba en verde, abajo en rojo, con su signo. */
export function BarrasFlujo({
  datos,
  seleccionado,
  alElegir,
  moneda,
  className,
}: {
  datos: { neto: number; etiqueta: string; larga: string }[];
  seleccionado: number | null;
  alElegir: (i: number | null) => void;
  moneda: string;
  className?: string;
}) {
  const [ref, ancho] = useAncho<SVGSVGElement>();
  const alto = 132;
  const util = Math.max(1, ancho - EJE);
  const paso = util / Math.max(1, datos.length);
  const grueso = Math.max(4, Math.min(22, paso * 0.56));
  const arriba = topeBonito(Math.max(0, ...datos.map((d) => d.neto)));
  const abajo = topeBonito(Math.max(0, ...datos.map((d) => -d.neto)));
  const hayNegativos = datos.some((d) => d.neto < 0);
  const hayPositivos = datos.some((d) => d.neto > 0);
  const total = (hayPositivos ? arriba : 0) + (hayNegativos ? abajo : 0) || 1;
  const area = alto - 30;
  const cero = 6 + (hayPositivos ? (arriba / total) * area : 0);
  const escala = area / total;
  const x = (i: number) => i * paso + paso / 2;
  const eleccion = useEleccion({
    total: datos.length,
    seleccionado,
    alElegir,
    indiceEn: (px) => (px < 0 || px > util ? null : Math.min(datos.length - 1, Math.floor(px / paso))),
    valido: () => true,
  });

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      tabIndex={0}
      aria-label={`Lo que te quedó cada mes: ${datos.map((d) => `${d.larga} ${dinero(d.neto, moneda, { signo: true })}`).join("; ")}`}
      data-grafica="flujo"
      className={cn("block w-full touch-pan-y overflow-visible select-none", className)}
      style={{ height: alto }}
      {...eleccion}
    >
      {hayPositivos ? (
        <text x={util + 6} y={cero - arriba * escala + 4} fontSize={11} fill="var(--chart-muted)">
          +{ejeDinero(arriba)}
        </text>
      ) : null}
      {hayNegativos ? (
        <text x={util + 6} y={cero + abajo * escala + 4} fontSize={11} fill="var(--chart-muted)">
          −{ejeDinero(abajo)}
        </text>
      ) : null}
      {datos.map((d, i) => {
        const h = Math.max(1.5, Math.abs(d.neto) * escala);
        const positivo = d.neto >= 0;
        return (
          <rect
            key={`${datos.length}-${i}`}
            x={x(i) - grueso / 2}
            y={positivo ? cero - h : cero}
            width={grueso}
            height={h}
            rx={Math.min(4, grueso / 2)}
            fill={positivo ? "var(--positive)" : "var(--negative)"}
            opacity={seleccionado === null || seleccionado === i ? 1 : 0.32}
            className={cn(positivo ? "fa-barra" : "fa-barra-abajo", "animate-crecer transition-opacity duration-200")}
            style={{ animationDelay: `${i * 40}ms` }}
          />
        );
      })}
      <line x1={0} x2={util} y1={cero} y2={cero} stroke="var(--chart-axis)" />
      {datos.map((d, i) => (
        <text
          key={`e-${i}`}
          x={x(i)}
          y={alto - 4}
          fontSize={11}
          fontWeight={seleccionado === i ? 700 : 500}
          textAnchor="middle"
          fill={seleccionado === i ? "var(--chart-ink)" : "var(--chart-muted)"}
        >
          {d.etiqueta}
        </text>
      ))}
    </svg>
  );
}
