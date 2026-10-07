import { useEffect, useState } from "react";

/**
 * Alto del teclado en iOS (la vista visible se encoge, la página no).
 * Lo deja en la variable CSS --teclado para mover la barra de escribir.
 */
export function useTeclado() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () => {
      const alto = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--teclado", `${alto}px`);
      setAbierto(alto > 120);
    };
    medir();
    vv.addEventListener("resize", medir);
    vv.addEventListener("scroll", medir);
    return () => {
      vv.removeEventListener("resize", medir);
      vv.removeEventListener("scroll", medir);
      document.documentElement.style.setProperty("--teclado", "0px");
    };
  }, []);
  return abierto;
}
