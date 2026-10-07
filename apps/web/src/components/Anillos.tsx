import { cn } from "../lib/utils";

export type Anillo = {
  /** 0 a n: 1 = completo. Más de 1 da otra vuelta (como Actividad). */
  progreso: number;
  color: string;
  etiqueta: string;
};

/**
 * Anillos concéntricos de avance, como Actividad del Apple Watch. El primero es el de afuera.
 * Pasado el 100 %, el anillo sigue dando vuelta con su punta sombreada.
 */
export function Anillos({
  anillos,
  tamano = 168,
  grosor = 18,
  separacion = 4,
  className,
}: {
  anillos: Anillo[];
  tamano?: number;
  grosor?: number;
  separacion?: number;
  className?: string;
}) {
  const centro = tamano / 2;
  return (
    <svg
      viewBox={`0 0 ${tamano} ${tamano}`}
      width={tamano}
      height={tamano}
      role="img"
      aria-label={anillos.map((a) => `${a.etiqueta}: ${Math.round(a.progreso * 100)}%`).join(", ")}
      className={cn("shrink-0 -rotate-90", className)}
    >
      {anillos.map((a, i) => {
        const r = centro - grosor / 2 - i * (grosor + separacion);
        if (r <= grosor / 2) return null;
        const p = Math.max(0, a.progreso);
        const vueltas = Math.min(p, 2); // dos vueltas bastan para leerlo
        const circ = 2 * Math.PI * r;
        const largo = Math.min(vueltas, 1) * circ;
        const extra = Math.max(0, vueltas - 1) * circ;
        return (
          <g key={a.etiqueta}>
            <circle cx={centro} cy={centro} r={r} fill="none" stroke={a.color} strokeOpacity={0.2} strokeWidth={grosor} />
            {p > 0 ? (
              <circle
                cx={centro}
                cy={centro}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={grosor}
                strokeLinecap="round"
                strokeDasharray={`${largo} ${circ}`}
                className="animate-anillo"
                style={{ ["--largo" as string]: `${largo}`, ["--circ" as string]: `${circ}`, animationDelay: `${i * 90}ms` }}
              />
            ) : null}
            {extra > 0 ? (
              // La segunda vuelta, con una sombra en la punta para que se note que pasó del 100 %.
              <circle
                cx={centro}
                cy={centro}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={grosor}
                strokeLinecap="round"
                strokeDasharray={`${extra} ${circ}`}
                style={{ filter: `drop-shadow(0 0 ${grosor / 5}px rgb(0 0 0 / 0.45))` }}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
