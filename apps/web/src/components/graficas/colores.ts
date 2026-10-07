import { useSyncExternalStore } from "react";

// Las gráficas leen los mismos tokens que el CSS, así siguen el modo claro u oscuro.
const consulta = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");

function suscribir(fn: () => void) {
  consulta?.addEventListener("change", fn);
  return () => consulta?.removeEventListener("change", fn);
}

export function useModoOscuro() {
  return useSyncExternalStore(
    suscribir,
    () => !!consulta?.matches,
    () => false,
  );
}

export type ColoresGrafica = {
  superficie: string;
  tinta: string;
  tinta2: string;
  tenue: string;
  reticula: string;
  eje: string;
  series: string[];
  otros: string;
};

export function leerColores(): ColoresGrafica {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return {
    superficie: v("--chart-surface"),
    tinta: v("--chart-ink"),
    tinta2: v("--chart-ink-2"),
    tenue: v("--chart-muted"),
    reticula: v("--chart-grid"),
    eje: v("--chart-axis"),
    series: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--serie-${i}`)),
    otros: v("--serie-otros"),
  };
}

/** Las 7 categorías más grandes con su color; el resto se junta en "Otras". */
export function agruparCategorias<T extends { nombre: string; centavos: number; categoriaId: string | null }>(
  items: T[],
  maximo = 7,
) {
  const orden = [...items].filter((i) => i.centavos > 0).sort((a, b) => b.centavos - a.centavos);
  if (orden.length <= maximo + 1) return orden.map((i, n) => ({ ...i, slot: n as number | "otros" }));
  const principales = orden.slice(0, maximo).map((i, n) => ({ ...i, slot: n as number | "otros" }));
  const resto = orden.slice(maximo);
  return [
    ...principales,
    {
      nombre: "Otras",
      categoriaId: null,
      centavos: resto.reduce((s, i) => s + i.centavos, 0),
      slot: "otros" as const,
    },
  ];
}

export function colorDeSlot(c: ColoresGrafica, slot: number | "otros") {
  return slot === "otros" ? c.otros : (c.series[slot] ?? c.otros);
}
