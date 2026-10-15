import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Contenido de una fila con el monto arriba a la derecha y el subtítulo a todo lo ancho abajo, como en Wallet.
 * Con montos grandes en pantallas de 320 px el título y el subtítulo no se quedan en una columna angosta.
 * El orden en el DOM (título, subtítulo, monto) es el que leen VoiceOver y las pruebas.
 */
export function ContenidoConMonto({
  icono,
  titulo,
  subtitulo,
  valor,
  chevron,
}: {
  icono: ReactNode;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  valor?: ReactNode;
  chevron?: boolean;
}) {
  return (
    <>
      {icono}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-2.5">
        <div className="col-start-1 row-start-1 break-words hyphens-auto">{titulo}</div>
        {subtitulo ? <div className="col-span-2 col-start-1 row-start-2 break-words text-[15px] leading-snug text-muted-foreground text-pretty">{subtitulo}</div> : null}
        {valor !== undefined ? <div className="col-start-2 row-start-1 text-right">{valor}</div> : null}
      </div>
      {chevron ? <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted-foreground/60" /> : null}
    </>
  );
}
