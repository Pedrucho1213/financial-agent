import { ChevronRight } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Sección de lista agrupada (como Ajustes de iOS). */
export function Grupo({
  titulo,
  pie,
  accion,
  className,
  children,
  ...props
}: Omit<ComponentProps<"section">, "title"> & { titulo?: ReactNode; pie?: ReactNode; accion?: ReactNode }) {
  return (
    <section className={cn("min-w-0", className)} {...props}>
      {titulo ? (
        <div className="flex items-end justify-between gap-3 px-4 pb-1.5">
          <h2 className="text-[13px] text-muted-foreground">{titulo}</h2>
          {accion}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl bg-card">{children}</div>
      {pie ? <div className="px-4 pt-1.5 text-[13px] leading-snug text-muted-foreground">{pie}</div> : null}
    </section>
  );
}

/** Encabezado grande de sección (como Salud o Wallet). */
export function TituloSeccion({ children, accion, className }: { children: ReactNode; accion?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-1 pb-2", className)}>
      <h2 className="text-[22px] leading-7 font-bold tracking-tight">{children}</h2>
      {accion}
    </div>
  );
}

const claseFila =
  "relative flex min-h-11 w-full min-w-0 items-center gap-3 px-4 text-left text-[17px] [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[var(--sangria,1rem)] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']";

type PropsFila = {
  icono?: ReactNode;
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  valor?: ReactNode;
  chevron?: boolean;
  /** Dónde empieza el separador: debajo del texto, no del icono. */
  sangria?: string;
  className?: string;
};

function ContenidoFila({ icono, titulo, subtitulo, valor, chevron }: Omit<PropsFila, "className" | "sangria">) {
  return (
    <>
      {icono}
      <div className="min-w-0 flex-1 py-2.5">
        <div className="truncate">{titulo}</div>
        {subtitulo ? <div className="truncate text-[15px] text-muted-foreground">{subtitulo}</div> : null}
      </div>
      {valor !== undefined ? <div className="shrink-0 text-right text-muted-foreground">{valor}</div> : null}
      {chevron ? <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted-foreground/60" /> : null}
    </>
  );
}

export function Fila({ className, sangria, children, ...props }: PropsFila & { children?: ReactNode }) {
  return (
    <div className={cn(claseFila, className)} style={sangria ? ({ "--sangria": sangria } as CSSProperties) : undefined}>
      {children ?? <ContenidoFila {...props} />}
    </div>
  );
}

export function FilaBoton({
  className,
  sangria,
  icono,
  titulo,
  subtitulo,
  valor,
  chevron,
  children,
  ...props
}: PropsFila & Omit<ComponentProps<"button">, "title"> & { children?: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(claseFila, "fila-presionable disabled:opacity-50", className)}
      style={sangria ? ({ "--sangria": sangria } as CSSProperties) : undefined}
      {...props}
    >
      {children ?? <ContenidoFila icono={icono} titulo={titulo} subtitulo={subtitulo} valor={valor} chevron={chevron} />}
    </button>
  );
}

/** Cuadrito de color con icono blanco, como los de Ajustes. */
export function IconoAjuste({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] text-white [&_svg]:size-[18px]"
      style={{ background: color }}
    >
      {children}
    </span>
  );
}
