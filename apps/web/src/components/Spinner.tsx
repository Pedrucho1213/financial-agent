import { cn } from "../lib/utils";

/** Indicador de actividad de iOS (8 rayitas). Solo para esperas cortas y el jalar para refrescar. */
export function Spinner({ className, etiqueta = "Cargando" }: { className?: string; etiqueta?: string }) {
  return (
    <span role="status" aria-label={etiqueta} className={cn("relative inline-block size-5 animate-girar", className)}>
      {Array.from({ length: 8 }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute top-0 left-[calc(50%-1.25px)] h-[30%] w-[2.5px] origin-[50%_166%] rounded-full bg-current"
          style={{ transform: `rotate(${i * 45}deg)`, opacity: 0.25 + (i / 8) * 0.75 }}
        />
      ))}
    </span>
  );
}
