import { House, type LucideIcon, MessageCircle, Plus, ReceiptText, Settings } from "lucide-react";
import { haptico } from "../lib/haptico";
import { hashDe, navegar, type Pestana } from "../lib/ruta";
import { cn } from "../lib/utils";

const PESTANAS: { id: Pestana; etiqueta: string; Icono: LucideIcon }[] = [
  { id: "inicio", etiqueta: "Inicio", Icono: House },
  { id: "movimientos", etiqueta: "Movimientos", Icono: ReceiptText },
  { id: "chat", etiqueta: "Chat", Icono: MessageCircle },
  { id: "ajustes", etiqueta: "Ajustes", Icono: Settings },
];

/**
 * Barra de pestañas flotante de iOS 26+, en vidrio teñido. La lente de la pestaña activa
 * se desliza (y se estira un poco) al cambiar. Tocar la pestaña activa sube hasta arriba.
 * A la derecha, el botón "+" de agregar, como el botón aparte de Música o Fotos.
 */
export function TabBar({
  actual,
  oculta,
  conBoton,
  alAgregar,
  agregarDeshabilitado,
}: {
  actual: Pestana;
  oculta?: boolean;
  conBoton?: boolean;
  alAgregar?: () => void;
  agregarDeshabilitado?: boolean;
}) {
  const indice = Math.max(0, PESTANAS.findIndex((p) => p.id === actual));
  return (
    <nav
      aria-label="Secciones"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30 px-safe pb-[max(calc(env(safe-area-inset-bottom)-12px),12px)] transition-[translate,opacity] duration-300 ease-ios",
        oculta && "translate-y-[140%] opacity-0",
      )}
    >
      <div className="mx-auto flex max-w-xl items-center">
        <ul className="vidrio pointer-events-auto relative grid h-[62px] min-w-0 flex-1 grid-cols-4 rounded-full p-1">
          <li
            aria-hidden
            className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/4)] transition-transform duration-[460ms] ease-ios"
            style={{ transform: `translateX(${indice * 100}%)` }}
          >
            <span key={indice} className="block size-full animate-lente rounded-full bg-[var(--lente)]" />
          </li>
          {PESTANAS.map(({ id, etiqueta, Icono }) => {
            const activa = id === actual;
            return (
              <li key={id} className="relative min-w-0">
                <a
                  href={`#${id}`}
                  aria-current={activa ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    if (activa) window.scrollTo({ top: 0, behavior: "smooth" });
                    else {
                      haptico();
                      navegar(hashDe(id));
                    }
                  }}
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-[3px] rounded-full transition-[color,scale] duration-200 ease-ios active:scale-90",
                    activa ? "text-tint" : "text-foreground/80",
                  )}
                >
                  <Icono
                    key={activa ? "activa" : "inactiva"}
                    className={cn("size-[23px]", activa && "animate-rebote")}
                    strokeWidth={activa ? 2.3 : 1.8}
                  />
                  <span className={cn("max-w-full truncate px-0.5 text-[10px] leading-none tracking-[0.01em]", activa ? "font-semibold" : "font-medium")}>
                    {etiqueta}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <div
          className={cn(
            "flex shrink-0 justify-end overflow-visible transition-[width,opacity] duration-300 ease-ios",
            conBoton ? "w-[72px] opacity-100" : "w-0 opacity-0",
          )}
        >
          <button
            type="button"
            aria-label="Agregar movimiento"
            aria-hidden={!conBoton}
            tabIndex={conBoton ? 0 : -1}
            disabled={agregarDeshabilitado}
            onClick={() => {
              haptico();
              alAgregar?.();
            }}
            className={cn(
              "vidrio flex size-[62px] shrink-0 items-center justify-center rounded-full text-tint transition-[scale,opacity] duration-300 ease-ios active:scale-90 disabled:opacity-40",
              conBoton ? "pointer-events-auto scale-100" : "pointer-events-none scale-50",
            )}
          >
            <Plus className="size-7" strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </nav>
  );
}
