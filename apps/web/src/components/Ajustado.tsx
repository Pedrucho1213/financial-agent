import { type ComponentProps, type RefObject, useLayoutEffect, useRef } from "react";
import { cn } from "../lib/utils";

/** Más chica que esto ya no se lee bien en un iPhone: mejor que el monto baje de renglón. */
const MINIMO_PX = 13;

/**
 * Achica la letra de un renglón justo lo necesario para que quepa (un monto de millones, letra grande en el
 * iPhone, pantalla de 320 px), en vez de cortarlo con "…" o encimarlo. El tamaño normal lo da su clase; el
 * elemento debe ir en un renglón (whitespace-nowrap), sin desbordarse (overflow-hidden) y con un ancho que
 * no dependa de su texto (un bloque, o w-full dentro de un flex centrado).
 *
 * Antes (#76-#82) se medía con scrollWidth, que nunca es menor que el ancho: achicaba siempre, y en el
 * iPhone cada medida partía de la anterior hasta dejar el monto invisible. Ahora:
 * - mide el texto de verdad (con decimales) y achica solo si no cabe a su tamaño normal;
 * - calcula desde la proporción ancho/letra, que no cambia al achicar: medir otra vez da lo mismo;
 * - no lee el estilo calculado justo después de cambiarlo (Safari puede darlo viejo): el tamaño normal se
 *   lee cuando no tiene ajuste, y si cambia el ancho o la clase se quita el ajuste y se mide en el siguiente
 *   cuadro;
 * - solo vuelve a medir si cambia el ancho, el texto o la clase, no la altura que deja su propio ajuste;
 * - si ni con MINIMO_PX cabe, deja la letra en el mínimo y el monto baja de renglón.
 */
export function useAjustar(ref: RefObject<HTMLElement | null>, activo = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !activo) return;
    let vivo = true;
    let cuadro = 0;
    let normal = 0;
    let anchoAntes = -1;
    let claseAntes = "";
    let textoAntes: string | null = null;
    const quitar = () => {
      el.style.removeProperty("font-size");
      el.style.removeProperty("white-space");
      el.style.removeProperty("overflow-wrap");
    };
    const ajustar = () => {
      if (!vivo) return;
      // Medidas sin la escala de una animación de entrada (transform), que no cambia el ancho real.
      const rect = el.getBoundingClientRect().width;
      const escala = el.offsetWidth && Math.abs(rect - el.offsetWidth) > 1 ? rect / el.offsetWidth : 1;
      const caja = rect / escala;
      if (!caja) return;
      const clase = `${el.className}|${getComputedStyle(el).fontFamily}`;
      const texto = el.textContent ?? "";
      const anchoCambio = Math.abs(caja - anchoAntes) >= 0.5;
      if (!anchoCambio && clase === claseAntes && texto === textoAntes) return;
      const ajustado = el.style.fontSize !== "";
      // Otro ancho u otra clase pueden cambiar su tamaño normal: quitar el ajuste y medir en el otro cuadro.
      if (ajustado && (anchoCambio || clase !== claseAntes)) {
        anchoAntes = -1;
        quitar();
        cancelAnimationFrame(cuadro);
        cuadro = requestAnimationFrame(ajustar);
        return;
      }
      anchoAntes = caja;
      claseAntes = clase;
      textoAntes = texto;
      const estilo = getComputedStyle(el);
      if (!ajustado) normal = Number.parseFloat(estilo.fontSize);
      const actual = ajustado ? Number.parseFloat(el.style.fontSize) : normal;
      const relleno =
        Number.parseFloat(estilo.paddingLeft) +
        Number.parseFloat(estilo.paddingRight) +
        Number.parseFloat(estilo.borderLeftWidth) +
        Number.parseFloat(estilo.borderRightWidth);
      // El texto en un renglón, con la letra que tiene ahora.
      el.style.removeProperty("white-space");
      el.style.removeProperty("overflow-wrap");
      const rango = document.createRange();
      rango.selectNodeContents(el);
      const medido = rango.getBoundingClientRect().width / escala;
      if (!medido || !actual || !normal) return;
      // Ancho del texto por pixel de letra: igual a cualquier tamaño.
      const porPx = medido / actual;
      // Medio pixel de holgura: con «truncate», un poco de más ya pinta «…».
      const ancho = caja - relleno - 0.5;
      if (porPx * normal <= ancho) {
        quitar();
        return;
      }
      const cabe = Math.floor((ancho / porPx) * 10) / 10;
      const minimo = Math.min(normal, MINIMO_PX);
      el.style.fontSize = `${Math.max(minimo, cabe)}px`;
      if (cabe < minimo) {
        el.style.whiteSpace = "normal";
        el.style.overflowWrap = "anywhere";
      }
    };
    ajustar();
    const tamano = new ResizeObserver(ajustar);
    tamano.observe(el);
    // El texto cambia sin React (NumeroAnimado) o con él; la clase, con el monto (otro tamaño normal).
    const cambio = new MutationObserver(ajustar);
    cambio.observe(el, { characterData: true, childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    // Con la letra ya cargada, otra medida desde cero.
    void document.fonts?.ready.then(() => {
      textoAntes = null;
      ajustar();
    });
    return () => {
      vivo = false;
      cancelAnimationFrame(cuadro);
      tamano.disconnect();
      cambio.disconnect();
      quitar();
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
  return <Etiqueta ref={ref as RefObject<never>} data-ajustado="" className={cn("overflow-hidden whitespace-nowrap", className)} {...props} />;
}
