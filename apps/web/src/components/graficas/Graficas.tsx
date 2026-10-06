import { BarChart, type BarSeriesOption, PieChart, type PieSeriesOption } from "echarts/charts";
import { GridComponent, type GridComponentOption } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef } from "react";
import { mesCorto, nombreMes } from "../../lib/formato";
import { cn } from "../../lib/utils";
import { colorDeSlot, leerColores, useModoOscuro } from "./colores";

// Solo lo que se usa: dona, barras y ejes, con el renderizador SVG. Sin tooltip:
// al tocar, el valor se muestra en la tarjeta (como en Salud), que además pesa menos.
echarts.use([PieChart, BarChart, GridComponent, SVGRenderer]);

// "50 mil" en los ejes: corto y como se dice en México.
const compacto = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

type Opcion = echarts.ComposeOption<PieSeriesOption | BarSeriesOption | GridComponentOption>;

function Grafica({
  opcion,
  alClic,
  etiqueta,
  className,
  resaltado,
  columnas = false,
}: {
  opcion: Opcion;
  alClic?: (indice: number) => void;
  etiqueta: string;
  className?: string;
  /** Índice del dato resaltado (dona). */
  resaltado?: number | null;
  /** "columna": tocar en cualquier parte de la columna de un mes (barras). */
  columnas?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const grafica = useRef<echarts.ECharts | null>(null);
  const clic = useRef(alClic);
  clic.current = alClic;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const g = echarts.init(el, null, { renderer: "svg" });
    grafica.current = g;
    if (columnas) {
      g.getZr().on("click", (e) => {
        if (!g.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
        const punto = g.convertFromPixel({ xAxisIndex: 0 }, e.offsetX);
        const i = Array.isArray(punto) ? punto[0] : punto;
        if (typeof i === "number" && Number.isFinite(i)) clic.current?.(Math.round(i));
      });
    } else {
      g.on("click", (p) => {
        if (typeof p.dataIndex === "number") clic.current?.(p.dataIndex);
      });
    }
    const ro = new ResizeObserver(() => g.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      g.dispose();
      grafica.current = null;
    };
  }, [columnas]);

  useEffect(() => {
    grafica.current?.setOption(opcion, { lazyUpdate: true });
  }, [opcion]);

  useEffect(() => {
    const g = grafica.current;
    if (!g || resaltado === undefined) return;
    g.dispatchAction({ type: "downplay", seriesIndex: 0 });
    if (resaltado !== null) g.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex: resaltado });
  }, [resaltado, opcion]);

  return <div ref={ref} role="img" aria-label={etiqueta} data-grafica className={cn("w-full", className)} />;
}

export type ItemDona = { nombre: string; centavos: number; slot: number | "otros" };

export function DonaCategorias({
  items,
  moneda,
  alElegir,
  seleccionado,
  className,
}: {
  items: ItemDona[];
  moneda: string;
  alElegir?: (indice: number) => void;
  seleccionado?: number | null;
  className?: string;
}) {
  const oscuro = useModoOscuro();
  const opcion = useMemo<Opcion>(() => {
    const c = leerColores();
    return {
      animationDuration: 800,
      animationEasing: "cubicOut",
      series: [
        {
          type: "pie",
          radius: ["68%", "94%"],
          center: ["50%", "50%"],
          padAngle: 1.5,
          minAngle: 4,
          selectedMode: false,
          itemStyle: { borderRadius: 5, borderColor: c.superficie, borderWidth: 1 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 5, focus: "self", blurScope: "series", label: { show: false } },
          blur: { itemStyle: { opacity: 0.35 } },
          data: items.map((i) => ({ name: i.nombre, value: i.centavos, itemStyle: { color: colorDeSlot(c, i.slot) } })),
        },
      ],
    };
    // `oscuro` cambia los colores que se leen del CSS.
  }, [items, moneda, oscuro]);
  return (
    <Grafica
      opcion={opcion}
      alClic={alElegir}
      resaltado={seleccionado ?? null}
      etiqueta="Gastos por categoría"
      className={className}
    />
  );
}

export function BarrasMeses({
  meses,
  seleccionado,
  alElegir,
  moneda,
  className,
}: {
  meses: { mes: string; gastadoCentavos: number; ingresadoCentavos: number }[];
  seleccionado: number;
  alElegir: (indice: number) => void;
  moneda: string;
  className?: string;
}) {
  const oscuro = useModoOscuro();
  const opcion = useMemo<Opcion>(() => {
    const c = leerColores();
    const barra = { barMaxWidth: 14, barGap: "20%", barCategoryGap: "38%" } as const;
    const atenuar = (i: number) => (i === seleccionado ? 1 : 0.32);
    return {
      animationDuration: 700,
      animationDurationUpdate: 250,
      animationEasing: "cubicOut",
      animationDelay: (i: number) => i * 40,
      grid: { left: 0, right: 4, top: 10, bottom: 0, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      xAxis: {
        type: "category",
        data: meses.map((m) => mesCorto(m.mes)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: c.eje } },
        axisLabel: {
          fontSize: 12,
          margin: 10,
          color: (_v?: string | number, i?: number) => (i === seleccionado ? c.tinta : c.tenue),
          fontWeight: 500,
        },
      },
      yAxis: {
        type: "value",
        splitNumber: 3,
        axisLabel: {
          color: c.tenue,
          fontSize: 11,
          formatter: (v: number) => (v === 0 ? "0" : compacto.format(v / 100)),
        },
        splitLine: { lineStyle: { color: c.reticula, width: 1 } },
      },
      series: [
        {
          name: "Gastado",
          type: "bar",
          ...barra,
          itemStyle: { color: c.series[0], borderRadius: [4, 4, 0, 0] },
          data: meses.map((m, i) => ({ value: m.gastadoCentavos, itemStyle: { opacity: atenuar(i) } })),
        },
        {
          name: "Ingresado",
          type: "bar",
          ...barra,
          itemStyle: { color: c.series[4], borderRadius: [4, 4, 0, 0] },
          data: meses.map((m, i) => ({ value: m.ingresadoCentavos, itemStyle: { opacity: atenuar(i) } })),
        },
      ],
    };
    // `oscuro` cambia los colores que se leen del CSS.
  }, [meses, moneda, oscuro, seleccionado]);
  return (
    <Grafica
      opcion={opcion}
      alClic={alElegir}
      columnas
      etiqueta={`Gastado e ingresado en los últimos 6 meses, ${nombreMes(meses[seleccionado]?.mes ?? "")} seleccionado`}
      className={className}
    />
  );
}
