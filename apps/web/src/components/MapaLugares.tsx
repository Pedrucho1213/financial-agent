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
  /** Color del círculo (el de la marca o la categoría) y del número. Sin esto, el tinte de la app. */
  fondo?: string;
  tinta?: string;
  /** Lugar en la lista, dentro del círculo. */
  numero?: number;
};

// Mosaicos de OpenStreetMap: gratis y sin llave (desde sep-2026 CARTO pide una y sin ella pinta
// «API KEY REQUIRED» encima). Pedirlos le dice a OpenStreetMap qué zona estás viendo (no tus gastos).
// Salen por omisión y el usuario los puede apagar con "Mostrar calles"; sin ellos, el mapa es un fondo
// propio con los nombres.
const MOSAICOS = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const CREDITOS = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// Colores más tranquilos, como Mapas de Apple; en oscuro se invierten conservando el tono (agua azul).
const FILTRO = {
  claro: "saturate(0.7) brightness(1.03)",
  oscuro: "invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.88) saturate(0.5)",
};

/**
 * Mapa con un círculo por lugar, del tamaño de lo gastado ahí y del color de su marca, con su número de la
 * lista. Tocar un círculo lo elige.
 * Con `interactivo={false}` es una vista fija (detalle de un movimiento).
 */
export function MapaLugares({
  lugares,
  seleccionado,
  alElegir,
  interactivo = true,
  conCalles = false,
  etiqueta = "Mapa de dónde gastas",
  className,
}: {
  lugares: Lugar[];
  seleccionado?: string | null;
  alElegir?: (clave: string | null) => void;
  interactivo?: boolean;
  /** Fondo con calles de OpenStreetMap. Sin esto no se pide nada a internet. */
  conCalles?: boolean;
  etiqueta?: string;
  className?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.TileLayer | null>(null);
  const circulos = useRef(new Map<string, L.Marker>());
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
    capa.current = L.tileLayer(MOSAICOS, {
      attribution: CREDITOS,
      maxZoom: 19,
      // Sus reglas piden mosaicos normales (retina serían 4 veces más) y saber desde qué sitio se piden: la
      // app no manda «Referer» a nadie, así que aquí va solo el dominio, nunca la dirección con el hash.
      detectRetina: false,
      referrerPolicy: "origin",
    }).addTo(m);
    const panel = m.getPane("tilePane");
    if (panel) panel.style.filter = oscuro ? FILTRO.oscuro : FILTRO.claro;
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
      const proporcion = Math.sqrt(l.centavos / Math.max(1, maximo));
      // Con número el círculo no baja de 11 px de radio, para que se lea.
      const radio = l.numero ? 11 + proporcion * 13 : 7 + proporcion * 17;
      const lado = Math.round(radio * 2);
      // Todo va como texto, no como HTML: el comercio puede venir de Apple Pay o del dictado.
      const cont = document.createElement("span");
      cont.className = "fa-lugar-cont";
      const circulo = document.createElement("span");
      circulo.className = "fa-lugar tabular";
      circulo.style.width = circulo.style.height = `${lado}px`;
      if (l.fondo) circulo.style.setProperty("--fondo", l.fondo);
      if (l.tinta) circulo.style.setProperty("--tinta", l.tinta);
      if (l.numero) circulo.textContent = String(l.numero);
      cont.append(circulo);
      // Sin calles, el nombre al lado del círculo es lo que da contexto.
      if (!conCalles) {
        const nombreLugar = document.createElement("span");
        nombreLugar.className = "fa-etiqueta";
        nombreLugar.textContent = l.nombre;
        cont.append(nombreLugar);
      }
      const c = L.marker([l.lat, l.lon], {
        icon: L.divIcon({ html: cont, className: "fa-lugar-icono", iconSize: [lado, lado], iconAnchor: [lado / 2, lado / 2] }),
        title: l.nombre,
        keyboard: interactivo,
        interactive: interactivo,
      }).addTo(m);
      c.on("click", () => elegir.current?.(l.clave));
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
    m?.getContainer().classList.toggle("fa-con-elegido", !!seleccionado && circulos.current.has(seleccionado));
    for (const [clave, c] of circulos.current) {
      c.getElement()?.querySelector(".fa-lugar")?.classList.toggle("fa-lugar-elegido", clave === seleccionado);
      c.setZIndexOffset(clave === seleccionado ? 1000 : 0);
      if (clave === seleccionado && m) {
        const punto = m.latLngToContainerPoint(c.getLatLng());
        const tamano = m.getSize();
        m.panBy([punto.x - tamano.x / 2, punto.y - tamano.y * 0.38], { animate: true });
      }
    }
  }, [seleccionado, lugares]);

  return <div ref={caja} role="img" aria-label={etiqueta} className={cn("fa-mapa z-0 w-full", !conCalles && "fa-mapa-propio", className)} />;
}
