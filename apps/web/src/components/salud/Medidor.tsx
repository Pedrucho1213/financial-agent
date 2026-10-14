import { colorDeNivel, NIVELES, type NivelSalud, puntoDelArco, tramoDelArco } from "../../lib/salud";
import { cn } from "../../lib/utils";

/**
 * Medidor de salud financiera: un semicírculo con los cinco niveles de color y una aguja en la calificación.
 * El tramo del nivel actual va lleno y los demás tenues. Sin calificación (falta el ingreso) no hay aguja.
 * `compacto`: solo el arco, para la tarjeta de Inicio.
 */
export function Medidor({
  puntaje,
  nivel,
  compacto = false,
  className,
}: {
  puntaje: number | null;
  nivel: NivelSalud | null;
  compacto?: boolean;
  className?: string;
}) {
  const ancho = compacto ? 52 : 240;
  const grosor = compacto ? 6 : 16;
  const r = ancho / 2 - grosor / 2 - (compacto ? 0 : 4);
  const cx = ancho / 2;
  const cy = compacto ? ancho / 2 + 6 : ancho / 2 + 2;
  const alto = compacto ? ancho : cy + (compacto ? 0 : 12);
  // Una separación pequeña entre tramos, como los anillos de Actividad.
  const hueco = compacto ? 2.5 : 1.2;
  const aguja = puntaje !== null ? puntoDelArco(puntaje, cx, cy, r - grosor / 2 - (compacto ? 3 : 10)) : null;
  const titulo = NIVELES.find((n) => n.clave === nivel)?.titulo;

  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      width={ancho}
      height={alto}
      role="img"
      aria-label={titulo ? `Salud financiera: ${titulo}${puntaje !== null ? `, ${puntaje} de 100` : ""}` : "Salud financiera sin calificar"}
      className={cn("shrink-0 overflow-visible", className)}
    >
      {NIVELES.map((n, i) => {
        const actual = n.clave === nivel;
        return (
          <path
            key={n.clave}
            d={tramoDelArco(n.desde + (i ? hueco : 0), n.hasta - (i < NIVELES.length - 1 ? hueco : 0), cx, cy, r)}
            fill="none"
            stroke={n.color}
            strokeWidth={grosor}
            strokeLinecap={i === 0 || i === NIVELES.length - 1 ? "round" : "butt"}
            opacity={nivel === null ? 0.28 : actual ? 1 : 0.28}
            data-nivel={n.clave}
            data-actual={actual || undefined}
          />
        );
      })}
      {aguja ? (
        <g data-testid="aguja" className="animate-aparecer">
          <line x1={cx} y1={cy} x2={aguja.x} y2={aguja.y} stroke="var(--foreground)" strokeWidth={compacto ? 2 : 3.5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={compacto ? 3 : 7} fill="var(--foreground)" />
          {compacto ? null : <circle cx={cx} cy={cy} r={3} fill={colorDeNivel(nivel)} />}
        </g>
      ) : null}
    </svg>
  );
}
