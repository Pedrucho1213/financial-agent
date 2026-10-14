import { type ComponentProps, type RefObject, useLayoutEffect, useRef } from "react";
import { cn } from "../lib/utils";

/**
 * Achica la letra de un renglón justo lo necesario para que quepa (un monto de millones, letra grande en el
 * iPhone, pantalla de 320 px), en vez de cortarlo con "…" o encimarlo. El tamaño normal lo da su clase; el
 * elemento debe ir en un renglón (whitespace-nowrap) y sin desbordarse (overflow-hidden).
 */
export function useAjustar(ref: RefObject<HTMLElement | null>, activo = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !activo) return;
    let base = "";
    const ajustar = () => {
      // Medir con su tamaño normal; si se sale, la proporción que falta.
      el.style.fontSize = base;
      if (!el.clientWidth || el.scrollWidth <= el.clientWidth + 0.5) return;
      const estilo = getComputedStyle(el);
      const relleno = Number.parseFloat(estilo.paddingLeft) + Number.parseFloat(estilo.paddingRight);
      const ancho = el.clientWidth - relleno;
      const texto = el.scrollWidth - relleno;
      el.style.fontSize = `${Math.floor(((Number.parseFloat(estilo.fontSize) * ancho) / texto) * 10) / 10}px`;
    };
    base = el.style.fontSize;
    ajustar();
    const tamano = new ResizeObserver(ajustar);
    if (el.parentElement) tamano.observe(el.parentElement);
    // El texto cambia sin React (NumeroAnimado) o con él.
    const texto = new MutationObserver(ajustar);
    texto.observe(el, { characterData: true, childList: true, subtree: true });
    void document.fonts?.ready.then(ajustar);
    return () => {
      tamano.disconnect();
      texto.disconnect();
      el.style.fontSize = base;
    };
  }, [ref, activo]);
}

/** Un renglón (un monto grande) que achica su letra si no cabe. `como`: la etiqueta (p por omisión). */
export function Ajustado({
  como: Etiqueta = "p",
  className,
  ...props
}: ComponentProps<"p"> & { como?: "p" | "div" | "dd" | "span" }) {
  const ref = useRef<HTMLElement>(null);
  useAjustar(ref);
  return <Etiqueta ref={ref as RefObject<never>} className={cn("overflow-hidden whitespace-nowrap", className)} {...props} />;
}
