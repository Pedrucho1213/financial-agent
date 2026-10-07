import { useEffect, useRef } from "react";

/**
 * Número que cuenta hasta su valor cuando cambia, sin re-renderizar React en cada cuadro.
 * `formato` convierte el número (en centavos, por ejemplo) a texto.
 */
export function NumeroAnimado({
  valor,
  formato,
  duracion = 700,
  className,
}: {
  valor: number;
  formato: (n: number) => string;
  duracion?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const anterior = useRef(0);
  const fmt = useRef(formato);
  fmt.current = formato;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const desde = anterior.current;
    const hasta = valor;
    anterior.current = valor;
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducido || desde === hasta) {
      el.textContent = fmt.current(hasta);
      return;
    }
    let cuadro = 0;
    const inicio = performance.now();
    const paso = (t: number) => {
      const p = Math.min(1, (t - inicio) / duracion);
      const suave = 1 - (1 - p) ** 3;
      el.textContent = fmt.current(Math.round(desde + (hasta - desde) * suave));
      if (p < 1) cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);
    return () => {
      cancelAnimationFrame(cuadro);
      el.textContent = fmt.current(hasta);
    };
  }, [valor, duracion]);

  return (
    <span ref={ref} className={className} aria-label={formato(valor)}>
      {formato(0)}
    </span>
  );
}
