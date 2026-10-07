import { MapPin, X } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import type { Lugar } from "../components/MapaLugares";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { Fila, FilaBoton, Grupo, TituloSeccion } from "../components/ui/lista";
import { Segmented } from "../components/ui/segmented";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { mensajeDeError } from "../lib/api";
import { type GastoConLugar, useGastosConLugar, useYo } from "../lib/consultas";
import { dinero, hoyIso, pct, rangoDelMes, sumarMeses } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { guardarCalles, leerCalles } from "../lib/mapa";
import { hashDe, navegar, volver } from "../lib/ruta";

const MapaLugares = lazy(() => import("../components/MapaLugares").then((m) => ({ default: m.MapaLugares })));

type Periodo = "mes" | "3m" | "anio";
const PERIODOS: { valor: Periodo; etiqueta: string }[] = [
  { valor: "mes", etiqueta: "Este mes" },
  { valor: "3m", etiqueta: "3 meses" },
  { valor: "anio", etiqueta: "12 meses" },
];

function rango(periodo: Periodo, hoy: string) {
  const mes = hoy.slice(0, 7);
  const atras = periodo === "mes" ? 0 : periodo === "3m" ? 2 : 11;
  return { desde: rangoDelMes(sumarMeses(mes, -atras)).desde, hasta: rangoDelMes(mes).hasta };
}

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/** Junta los gastos del mismo lugar: mismo nombre y a menos de ~100 m. Promedia la posición. */
export function agruparLugares(gastos: GastoConLugar[], moneda: string): (Lugar & { busqueda: string })[] {
  const grupos = new Map<string, Lugar & { busqueda: string; sumaLat: number; sumaLon: number }>();
  for (const g of gastos) {
    if (g.moneda !== moneda) continue;
    const nombre = g.comercio ?? g.lugar ?? g.descripcion ?? "Sin nombre";
    const clave = `${normalizar(nombre)}|${g.lat.toFixed(3)}|${g.lon.toFixed(3)}`;
    const e = grupos.get(clave) ?? {
      clave,
      nombre,
      busqueda: g.comercio ?? g.descripcion ?? "",
      lat: 0,
      lon: 0,
      sumaLat: 0,
      sumaLon: 0,
      centavos: 0,
      cantidad: 0,
    };
    e.centavos += g.centavos;
    e.cantidad += 1;
    e.sumaLat += g.lat;
    e.sumaLon += g.lon;
    e.lat = e.sumaLat / e.cantidad;
    e.lon = e.sumaLon / e.cantidad;
    grupos.set(clave, e);
  }
  return [...grupos.values()]
    .map(({ sumaLat: _a, sumaLon: _b, ...l }) => l)
    .sort((a, b) => b.centavos - a.centavos);
}

export function Mapa() {
  const yo = useYo();
  const moneda = yo.data?.moneda ?? "MXN";
  const hoy = yo.data?.hoy ?? hoyIso();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const { desde, hasta } = rango(periodo, hoy);
  const gastos = useGastosConLugar(desde, hasta);
  const lugares = useMemo(() => agruparLugares(gastos.data ?? [], moneda), [gastos.data, moneda]);
  const [sel, setSel] = useState<string | null>(null);
  const [conCalles, setConCalles] = useState(leerCalles);
  const elegido = lugares.find((l) => l.clave === sel);
  const total = lugares.reduce((s, l) => s + l.centavos, 0);

  const verMovimientos = (l: (typeof lugares)[number]) =>
    navegar(hashDe("movimientos", { q: l.busqueda || undefined, mes: periodo === "mes" ? undefined : "todo" }));

  return (
    <Pantalla titulo="Dónde gastas" atras={{ etiqueta: "Atrás", alTocar: () => volver("movimientos") }}>
      <div className="space-y-6 pt-2 pb-4">
        <Segmented<Periodo>
          opciones={PERIODOS}
          valor={periodo}
          onChange={(p) => {
            setSel(null);
            setPeriodo(p);
          }}
          etiqueta="Periodo"
        />

        <div className="relative overflow-hidden rounded-[20px] bg-card">
          <Suspense fallback={<Skeleton className="h-[360px] w-full rounded-none" />}>
            <MapaLugares
              lugares={lugares}
              seleccionado={sel}
              alElegir={(c) => {
                if (c) haptico();
                setSel(c);
              }}
              conCalles={conCalles}
              className="h-[360px]"
            />
          </Suspense>
          {gastos.isPending ? (
            <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
              <span className="vidrio rounded-full px-3.5 py-1.5 text-[13px] font-semibold">Buscando lugares…</span>
            </div>
          ) : !lugares.length && !gastos.isError ? (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[500]">
              <div className="vidrio rounded-2xl px-4 py-3 text-[15px] leading-snug">
                <p className="font-semibold">Aún no hay gastos con ubicación</p>
                <p className="mt-0.5 text-muted-foreground">
                  Cuando dictas con el Atajo, guarda dónde estabas. Aparecerán aquí.
                </p>
              </div>
            </div>
          ) : null}
          {elegido ? (
            <div className="absolute inset-x-3 bottom-3 z-[500] animate-entrar">
              <div className="vidrio flex items-center gap-3 rounded-2xl py-2.5 pr-2 pl-3.5">
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint text-white">
                  <MapPin className="size-[18px]" />
                </span>
                <button type="button" className="min-w-0 flex-1 text-left active:opacity-60" onClick={() => verMovimientos(elegido)}>
                  <span className="block truncate text-[17px] font-semibold">{elegido.nombre}</span>
                  <span className="block truncate text-[13px] text-muted-foreground tabular">
                    {dinero(elegido.centavos, moneda)} · {elegido.cantidad} {elegido.cantidad === 1 ? "vez" : "veces"} · Ver
                  </span>
                </button>
                <Button variant="plain" size="icon" aria-label="Cerrar" onClick={() => setSel(null)}>
                  <X className="size-5 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <Grupo pie="Las calles se piden a CARTO, que así ve qué zona del mapa miras; en el detalle de un gasto, esa zona es donde pagaste. Apagado, nada sale de tu iPhone.">
          <Fila>
            <label htmlFor="mostrar-calles" className="min-w-0 flex-1 py-2.5">
              Mostrar calles
            </label>
            <Switch
              id="mostrar-calles"
              checked={conCalles}
              onCheckedChange={(v) => {
                haptico();
                setConCalles(v);
                guardarCalles(v);
              }}
            />
          </Fila>
        </Grupo>

        {gastos.isError && !gastos.data ? (
          <div className="rounded-[20px] bg-card px-6 py-8 text-center">
            <p className="text-[17px] font-semibold">No pudimos cargar el mapa</p>
            <p className="mt-1 text-[15px] text-muted-foreground">{mensajeDeError(gastos.error)}</p>
            <Button variant="tinted" size="sm" className="mt-4" onClick={() => gastos.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : lugares.length ? (
          <section>
            <TituloSeccion>Lugares</TituloSeccion>
            <Grupo>
              {lugares.slice(0, 15).map((l, i) => (
                <FilaBoton
                  key={l.clave}
                  sangria="4rem"
                  className={l.clave === sel ? "bg-fill" : undefined}
                  icono={
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint/15 text-[15px] font-semibold text-tint tabular"
                    >
                      {i + 1}
                    </span>
                  }
                  titulo={l.nombre}
                  subtitulo={`${l.cantidad} ${l.cantidad === 1 ? "vez" : "veces"} · ${pct(l.centavos / Math.max(1, total))}`}
                  valor={<span className="font-medium text-foreground tabular">{dinero(l.centavos, moneda)}</span>}
                  onClick={() => {
                    haptico();
                    setSel(l.clave);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              ))}
            </Grupo>
          </section>
        ) : null}
      </div>
    </Pantalla>
  );
}
