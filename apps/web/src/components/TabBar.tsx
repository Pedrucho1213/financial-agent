import { House, type LucideIcon, MessageCircle, ReceiptText, Settings } from "lucide-react";
import { hashDe, navegar, type Pestana } from "../lib/ruta";
import { cn } from "../lib/utils";

const PESTANAS: { id: Pestana; etiqueta: string; Icono: LucideIcon }[] = [
  { id: "inicio", etiqueta: "Inicio", Icono: House },
  { id: "movimientos", etiqueta: "Movimientos", Icono: ReceiptText },
  { id: "chat", etiqueta: "Chat", Icono: MessageCircle },
  { id: "ajustes", etiqueta: "Ajustes", Icono: Settings },
];

/** Barra de pestañas translúcida de iOS. Tocar la pestaña activa sube hasta arriba. */
export function TabBar({ actual, oculta }: { actual: Pestana; oculta?: boolean }) {
  return (
    <nav
      aria-label="Secciones"
      className={cn(
        "material hairline-t fixed inset-x-0 bottom-0 z-30 pb-safe transition-transform duration-300 ease-ios",
        oculta && "translate-y-full",
      )}
    >
      <ul className="mx-auto grid h-[49px] max-w-xl grid-cols-4">
        {PESTANAS.map(({ id, etiqueta, Icono }) => {
          const activa = id === actual;
          return (
            <li key={id} className="min-w-0">
              <a
                href={`#${id}`}
                aria-current={activa ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (activa) window.scrollTo({ top: 0, behavior: "smooth" });
                  else navegar(hashDe(id));
                }}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-[3px] pt-1 transition-colors active:opacity-60",
                  activa ? "text-tint" : "text-gray-icon",
                )}
              >
                <Icono className="size-[25px]" strokeWidth={activa ? 2.3 : 1.8} />
                <span className="text-[10px] leading-none font-medium tracking-[0.01em]">{etiqueta}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
