import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import { useModoOscuro } from "./graficas/colores";

export type Lugar = {
  clave: string;
  nombre: string;
  lat: number;
  lon: number;
  centavos: number;
  cantidad: number;
};

// Mosaicos de CARTO (claro y oscuro): limpios, sin anuncios y legibles como Mapas de Apple.
// Pedirlos le dice a CARTO qué zona estás viendo (no tus gastos), así que solo se usan si el
// usuario enciende "Mostrar calles". Sin ellos, el mapa es un fondo propio con los nombres.
const MOSAICOS = {
  claro: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  oscuro: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const CREDITOS = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Mapa con un círculo por lugar, del tamaño de lo gastado ahí. Tocar un círculo lo elige.
 * Con `interactivo={false}` es una vista fija (detalle de un movimiento).
 */
export function MapaLugares({
  lugares,
  seleccionado,
  alElegir,
  interactivo = true,
  conCalles = false,
  className,
}: {
  lugares: Lugar[];
  seleccionado?: string | null;
  alElegir?: (clave: string | null) => void;
  interactivo?: boolean;
  /** Fondo con calles de CARTO. Sin esto no se pide nada a internet. */
  conCalles?: boolean;
  className?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.TileLayer | null>(null);
  const circulos = useRef(new Map<string, L.CircleMarker>());
  const elegir = useRef(alElegir);
  elegir.current = alElegir;
  const oscuro = useModoOscuro();

  // Crear el mapa una vez.
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const m = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      dragging: interactivo,
      touchZoom: interactivo,
      scrollWheelZoom: interactivo,
      doubleClickZoom: interactivo,
      boxZoom: false,
      keyboard: interactivo,
      tapHold: false,
    });
    m.attributionControl.setPrefix(false);
    m.on("click", () => elegir.current?.(null));
    mapa.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      m.remove();
      mapa.current = null;
      capa.current = null;
      circulos.current.clear();
    };
  }, [interactivo]);

  // Mosaicos claros u oscuros, solo con calles.
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    capa.current?.remove();
    capa.current = null;
    if (!conCalles) return;
    capa.current = L.tileLayer(oscuro ? MOSAICOS.oscuro : MOSAICOS.claro, {
      attribution: CREDITOS,
      subdomains: "abcd",
      maxZoom: 19,
      detectRetina: false,
    }).addTo(m);
  }, [oscuro, conCalles]);

  // Círculos y encuadre cuando cambian los lugares.
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    for (const c of circulos.current.values()) c.remove();
    circulos.current.clear();
    if (!lugares.length) {
      m.setView([19.4326, -99.1332], 11); // CDMX, mientras no haya datos
      return;
    }
    const maximo = Math.max(...lugares.map((l) => l.centavos));
    for (const l of lugares) {
      const radio = 7 + Math.sqrt(l.centavos / Math.max(1, maximo)) * 17;
      const c = L.circleMarker([l.lat, l.lon], {
        radius: radio,
        className: "fa-lugar",
        weight: 2,
        bubblingMouseEvents: false,
        interactive: interactivo,
      }).addTo(m);
      c.on("click", () => elegir.current?.(l.clave));
      // Sin calles, el nombre al lado del círculo es lo que da contexto.
      if (!conCalles) {
        c.bindTooltip(l.nombre, { permanent: true, direction: "right", offset: [radio, 0], className: "fa-etiqueta" });
      }
      circulos.current.set(l.clave, c);
    }
    const limites = L.latLngBounds(lugares.map((l) => [l.lat, l.lon] as [number, number]));
    if (lugares.length === 1) m.setView(limites.getCenter(), 15);
    // Sin calles, los nombres van a la derecha de cada círculo: se deja lugar para ellos.
    else m.fitBounds(limites, { paddingTopLeft: [36, 36], paddingBottomRight: [conCalles ? 36 : 120, 36], maxZoom: 16 });
  }, [lugares, interactivo, conCalles]);

  // Resalta el elegido y lo lleva arriba del centro, donde no lo tapa la tarjeta de abajo.
  useEffect(() => {
    const m = mapa.current;
    for (const [clave, c] of circulos.current) {
      const el = c.getElement();
      el?.classList.toggle("fa-lugar-elegido", clave === seleccionado);
      if (clave === seleccionado && m) {
        c.bringToFront();
        const punto = m.latLngToContainerPoint(c.getLatLng());
        const tamano = m.getSize();
        m.panBy([punto.x - tamano.x / 2, punto.y - tamano.y * 0.38], { animate: true });
      }
    }
  }, [seleccionado, lugares]);

  return <div ref={caja} role="img" aria-label="Mapa de dónde gastas" className={cn("fa-mapa z-0 w-full", !conCalles && "fa-mapa-propio", className)} />;
}
