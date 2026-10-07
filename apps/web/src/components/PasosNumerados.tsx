import type { ReactNode } from "react";
import { Grupo } from "./ui/lista";

/** Pasos numerados en una lista agrupada, como las guías de iOS. */
export function PasosNumerados({
  pasos,
  etiqueta,
  pie,
  className,
}: {
  pasos: ReactNode[];
  etiqueta: string;
  pie?: ReactNode;
  className?: string;
}) {
  return (
    <Grupo className={className} pie={pie}>
      <ol aria-label={etiqueta}>
        {pasos.map((texto, i) => (
          <li
            key={i}
            className="relative flex min-h-[56px] items-center gap-3 px-4 [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-14 [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']"
          >
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-primary-foreground tabular"
            >
              {i + 1}
            </span>
            <p className="min-w-0 flex-1 py-3 text-[16px] leading-snug">{texto}</p>
          </li>
        ))}
      </ol>
    </Grupo>
  );
}
