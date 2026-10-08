import { type PointerEvent, useRef } from "react";
import type { DiaCalor } from "../../lib/analisis";
import { dinero, mesCorto } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { diaSemana } from "../../lib/periodos";
import { cn } from "../../lib/utils";
import { useAncho } from "./Barras";

// Mapa de calor del gasto por día: un solo color, de claro a fuerte (más gasto, más intenso).

const LETRAS = ["L", "M", "M", "J", "V", "S", "D"];
/** Intensidad de cada nivel, mezclada con el relleno gris del tema. */
const MEZCLA = [0, 26, 48, 72, 100];

export const fondoNivel = (nivel: number) =>
  nivel === 0 ? "var(--fill)" : `color-mix(in srgb, var(--tint) ${MEZCLA[nivel] ?? 100}%, var(--fill))`;

/** Leyenda "Menos ▢▢▢▢▢ Más". */
export function LeyendaCalor() {
  return (
    <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground" aria-hidden>
      Menos
      {[0, 1, 2, 3, 4].map((n) => (
        <span key={n} className="size-2.5 rounded-[3px]" style={{ backgroundColor: fondoNivel(n) }} />
      ))}
      Más
    </div>
  );
}

/** Semana o mes: un calendario (lunes primero) con el número de cada día. */
export function CalendarioCalor({
  dias,
  hoy,
  seleccionado,
  alElegir,
  moneda,
}: {
  dias: DiaCalor[];
  hoy: string;
  seleccionado: string | null;
  alElegir: (fecha: string | null) => void;
  moneda: string;
}) {
  const huecos = dias[0] ? diaSemana(dias[0].fecha) - 1 : 0;
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-center text-[11px] font-semibold text-muted-foreground" aria-hidden>
        {LETRAS.map((l, i) => (
          <span key={`${l}-${i}`}>{l}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5" role="grid" aria-label="Gasto por día">
        {Array.from({ length: huecos }, (_, i) => (
          <span key={`h-${i}`} aria-hidden />
        ))}
        {dias.map((d, i) => {
          const elegido = d.fecha === seleccionado;
          return (
            <button
              key={d.fecha}
              type="button"
              disabled={d.futuro}
              aria-pressed={elegido}
              aria-label={`${Number(d.fecha.slice(8, 10))} de ${mesCorto(d.fecha.slice(0, 7))}: ${d.centavos ? dinero(d.centavos, moneda) : "sin gastos"}`}
              onClick={() => {
                haptico();
                alElegir(elegido ? null : d.fecha);
              }}
              className={cn(
                "flex aspect-square min-h-9 animate-aparecer items-center justify-center rounded-[9px] text-[13px] font-semibold tabular transition-[scale,box-shadow] duration-200 ease-ios active:scale-90 disabled:opacity-35",
                d.nivel >= 3 ? "text-white" : "text-foreground",
                d.fecha === hoy && "ring-2 ring-tint ring-offset-2 ring-offset-card",
                elegido && "scale-[1.08] shadow-[0_4px_12px_rgb(0_0_0/0.18)]",
              )}
              style={{ backgroundColor: d.futuro ? "transparent" : fondoNivel(d.nivel), animationDelay: `${Math.min(i * 10, 300)}ms` }}
            >
              {Number(d.fecha.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 6 meses o un año: columnas de semanas y filas de días (como las contribuciones de GitHub). Se elige deslizando. */
export function RejillaCalor({
  dias,
  seleccionado,
  alElegir,
  moneda,
}: {
  dias: DiaCalor[];
  seleccionado: string | null;
  alElegir: (fecha: string | null) => void;
  moneda: string;
}) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const huecos = dias[0] ? diaSemana(dias[0].fecha) - 1 : 0;
  const columnas = Math.ceil((dias.length + huecos) / 7);
  const espacio = columnas > 30 ? 2 : 3;
  const etiquetas = 14;
  const celda = Math.max(3, Math.floor((ancho - etiquetas - espacio * (columnas - 1)) / columnas));
  const ultimo = useRef<string | null>(null);

  const diaEn = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left - etiquetas) / (celda + espacio));
    const fila = Math.floor((e.clientY - r.top - 16) / (celda + espacio));
    if (col < 0 || fila < 0 || fila > 6) return null;
    const d = dias[col * 7 + fila - huecos];
    return d && !d.futuro ? d : null;
  };
  const elegir = (d: DiaCalor | null, soltar = false) => {
    const f = d?.fecha ?? null;
    if (soltar && f === seleccionado) return alElegir(null);
    if (f === ultimo.current) return;
    ultimo.current = f;
    if (f) {
      haptico();
      alElegir(f);
    }
  };

  // Etiqueta de mes arriba de la semana donde empieza.
  const meses: { col: number; texto: string }[] = [];
  dias.forEach((d, i) => {
    if (d.fecha.endsWith("-01") || i === 0) meses.push({ col: Math.floor((i + huecos) / 7), texto: mesCorto(d.fecha.slice(0, 7)) });
  });

  return (
    <div
      ref={ref}
      className="relative touch-pan-y select-none"
      style={{ height: 16 + 7 * (celda + espacio) }}
      role="img"
      aria-label={`Gasto por día: ${dias.filter((d) => d.centavos > 0).length} días con gastos`}
      onPointerDown={(e) => {
        ultimo.current = null;
        const d = diaEn(e);
        if (d) elegir(d, true);
      }}
      onPointerMove={(e) => e.buttons && elegir(diaEn(e))}
    >
      {meses.map((m, i) => {
        // Si la etiqueta anterior quedó muy cerca, esta no se muestra (no se encimen).
        const previa = meses[i - 1];
        if (previa && (m.col - previa.col) * (celda + espacio) < 26) return null;
        return (
          <span
            key={`${m.texto}-${m.col}`}
            aria-hidden
            className="absolute top-0 text-[10px] font-medium text-muted-foreground"
            style={{ left: etiquetas + m.col * (celda + espacio) }}
          >
            {m.texto}
          </span>
        );
      })}
      {["L", "M", "V"].map((l, i) => (
        <span
          key={l}
          aria-hidden
          className="absolute left-0 text-[9px] leading-none font-medium text-muted-foreground"
          style={{ top: 16 + [0, 2, 4][i]! * (celda + espacio) + (celda - 9) / 2 }}
        >
          {l}
        </span>
      ))}
      {dias.map((d, i) => {
        const pos = i + huecos;
        const elegido = d.fecha === seleccionado;
        return (
          <span
            key={d.fecha}
            data-fecha={d.fecha}
            data-nivel={d.nivel}
            className={cn("absolute rounded-[2px] transition-transform duration-150", elegido && "z-[1] scale-150 ring-2 ring-card")}
            style={{
              left: etiquetas + Math.floor(pos / 7) * (celda + espacio),
              top: 16 + (pos % 7) * (celda + espacio),
              width: celda,
              height: celda,
              backgroundColor: d.futuro ? "transparent" : fondoNivel(d.nivel),
              boxShadow: d.futuro ? "inset 0 0 0 0.5px var(--separator)" : undefined,
            }}
            title={`${d.fecha}: ${dinero(d.centavos, moneda)}`}
          />
        );
      })}
    </div>
  );
}
