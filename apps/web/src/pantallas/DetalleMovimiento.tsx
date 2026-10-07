import { CircleAlert, Mic, Pencil, Search, Smartphone, Sparkles, Trash2, Wallet } from "lucide-react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { Fila, FilaBoton, Grupo } from "../components/ui/lista";
import { Skeleton } from "../components/ui/skeleton";
import { eliminarConDeshacer } from "../lib/acciones";
import { ErrorApi, mensajeDeError } from "../lib/api";
import { iconoCategoria } from "../lib/categorias";
import { preguntarAlChat } from "../lib/chat";
import { useEnLinea } from "../lib/conexion";
import { useMovimiento } from "../lib/consultas";
import { abrirEditor } from "../lib/editor";
import { dinero, TIPOS } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { leerCalles } from "../lib/mapa";
import { hashDe, hashDetalle, navegar, volver } from "../lib/ruta";
import type { MovimientoApp } from "../lib/tipos";
import { cn } from "../lib/utils";

const MapaLugares = lazy(() => import("../components/MapaLugares").then((m) => ({ default: m.MapaLugares })));

const ORIGENES: Record<MovimientoApp["origen"], { texto: string; Icono: typeof Mic }> = {
  voz: { texto: "Por voz", Icono: Mic },
  app: { texto: "En la app", Icono: Smartphone },
  apple_pay: { texto: "Apple Pay", Icono: Wallet },
  importacion: { texto: "Importado", Icono: Smartphone },
};

const fFechaLarga = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Detalle de un registro, como en Wallet. Es a donde lleva tocar una notificación (#movimientos?detalle=<id>).
 * Un dictado que registró varios llega con <id1>,<id2>: primero se ve la lista.
 */
export function DetalleMovimiento({ params }: { params: URLSearchParams }) {
  const ids = (params.get("detalle") ?? "").split(",").filter(Boolean);
  if (ids.length > 1) return <VariosMovimientos ids={ids} />;
  return <UnMovimiento id={ids[0] ?? null} params={params} />;
}

function VariosMovimientos({ ids }: { ids: string[] }) {
  return (
    <Pantalla titulo={`${ids.length} registros`} atras={{ etiqueta: "Atrás", alTocar: () => volver("movimientos") }}>
      <div className="pt-2 pb-6">
        <Grupo pie="Toca uno para ver su detalle o agregarle información.">
          {ids.map((id) => (
            <FilaDeVarios key={id} id={id} />
          ))}
        </Grupo>
      </div>
    </Pantalla>
  );
}

function FilaDeVarios({ id }: { id: string }) {
  const { data: m, isError } = useMovimiento(id);
  if (!m) {
    return isError ? (
      <Fila sangria="4rem" titulo={<span className="text-muted-foreground">Ya no existe</span>} />
    ) : (
      <div className="flex h-[60px] items-center px-4">
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }
  const [Icono, color] = iconoCategoria(m.categoria, m.tipo);
  return (
    <FilaBoton
      sangria="4rem"
      icono={
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${color}26`, color }}>
          <Icono className="size-[18px]" />
        </span>
      }
      titulo={tituloDe(m)}
      subtitulo={m.categoria?.split(">").pop()?.trim() ?? TIPOS[m.tipo]}
      valor={
        <span className={cn("font-medium tabular", m.tipo === "ingreso" ? "text-positive" : "text-foreground")}>
          {dinero(m.montoCentavos, m.moneda)}
        </span>
      }
      chevron
      onClick={() => navegar(hashDetalle(m.id))}
    />
  );
}

const tituloDe = (m: MovimientoApp) =>
  m.comercio ?? m.descripcion ?? m.categoria?.split(">").pop()?.trim() ?? TIPOS[m.tipo] ?? "Movimiento";

function UnMovimiento({ id, params }: { id: string | null; params: URLSearchParams }) {
  const consulta = useMovimiento(id);
  const m = consulta.data;
  const enLinea = useEnLinea();

  // ?editar=1 (notificación de Apple Pay: "agrega más info") abre el editor una sola vez.
  const editarAbierto = useRef(false);
  useEffect(() => {
    if (!m || params.get("editar") !== "1" || editarAbierto.current) return;
    editarAbierto.current = true;
    abrirEditor(m);
  }, [m, params]);

  const noExiste = consulta.error instanceof ErrorApi && consulta.error.estado === 404;

  return (
    <Pantalla titulo="" tituloCompacto="Movimiento" barraFija atras={{ etiqueta: "Atrás", alTocar: () => volver("movimientos") }}>
      {!id || noExiste ? (
        <div className="mt-10 rounded-[20px] bg-card px-6 py-10 text-center">
          <p className="text-[17px] font-semibold">Este movimiento ya no existe</p>
          <p className="mt-1 text-[15px] text-muted-foreground">Quizá lo borraste o se deshizo.</p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => navegar(hashDe("movimientos"), { reemplazar: true })}>
            Ver movimientos
          </Button>
        </div>
      ) : m ? (
        <Detalle m={m} enLinea={enLinea} />
      ) : consulta.isError ? (
        <div className="mt-10 rounded-[20px] bg-card px-6 py-10 text-center">
          <p className="text-[17px] font-semibold">No pudimos cargarlo</p>
          <p className="mt-1 text-[15px] text-muted-foreground">{mensajeDeError(consulta.error)}</p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => consulta.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <div aria-busy className="flex flex-col items-center pt-8">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="mt-4 h-6 w-40" />
          <Skeleton className="mt-3 h-10 w-48" />
          <Skeleton className="mt-8 h-40 w-full rounded-[20px]" />
        </div>
      )}
    </Pantalla>
  );
}

function Detalle({ m, enLinea }: { m: MovimientoApp; enLinea: boolean }) {
  const [Icono, color] = iconoCategoria(m.categoria, m.tipo);
  const titulo = tituloDe(m);
  const signo = m.tipo === "ingreso" ? "+" : m.tipo === "gasto" ? "−" : "";
  const origen = ORIGENES[m.origen];
  const conLugar = m.lat !== null && m.lon !== null;
  const fecha = fFechaLarga.format(new Date(m.ocurridoEn));

  return (
    <div className="space-y-6 pt-4 pb-6">
      <header className="flex flex-col items-center text-center animate-entrar">
        <span
          aria-hidden
          className="flex size-16 items-center justify-center rounded-full"
          style={{ backgroundColor: `${color}26`, color }}
        >
          <Icono className="size-8" strokeWidth={2} />
        </span>
        <h1 className="mt-3 max-w-full truncate px-4 text-[22px] leading-7 font-semibold">{titulo}</h1>
        <p
          className={cn(
            "mt-1 text-[44px] leading-[1.15] font-bold tracking-[-0.025em] tabular",
            m.tipo === "ingreso" && "text-positive",
          )}
        >
          {signo}
          {dinero(m.montoCentavos, m.moneda)}
        </p>
        <p className="mt-1 text-[15px] text-muted-foreground first-letter:uppercase">{fecha}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          <span className="flex items-center gap-1 rounded-full bg-fill px-2.5 py-1 text-[13px] font-semibold text-muted-foreground">
            <origen.Icono className="size-3.5" strokeWidth={2.5} /> {origen.texto}
          </span>
          {m.revisar ? (
            <span className="flex items-center gap-1 rounded-full bg-warning px-2.5 py-1 text-[13px] font-semibold text-warning-foreground">
              <CircleAlert className="size-3.5" strokeWidth={2.5} /> Por revisar
            </span>
          ) : null}
        </div>
      </header>

      {m.textoOriginal ? (
        <section aria-label="Lo que dijiste" className="rounded-[20px] bg-card p-4">
          <h2 className="text-[13px] font-semibold text-muted-foreground">Lo que dijiste</h2>
          <p data-seleccionable className="mt-1 text-[17px] leading-snug">
            «{m.textoOriginal}»
          </p>
        </section>
      ) : null}

      <Grupo>
        <Fila titulo="Tipo" valor={TIPOS[m.tipo] ?? m.tipo} />
        <Fila titulo="Categoría" valor={m.categoria?.replace(" > ", " › ") ?? "Sin categoría"} />
        {m.cuenta ? <Fila titulo="Pagado con" valor={m.cuenta} /> : null}
        {m.descripcion && m.comercio ? <Fila titulo="Nota" valor={m.descripcion} /> : null}
        {m.lugar ? <Fila titulo="Lugar" valor={m.lugar} /> : null}
        {m.moneda !== "MXN" ? <Fila titulo="Moneda" valor={m.moneda} /> : null}
      </Grupo>

      {conLugar ? (
        <div className="overflow-hidden rounded-[20px] bg-card">
          <Suspense fallback={<Skeleton className="h-[180px] w-full rounded-none" />}>
            <MapaLugares
              interactivo={false}
              conCalles={leerCalles()}
              lugares={[
                {
                  clave: m.id,
                  nombre: m.lugar ?? titulo,
                  lat: m.lat ?? 0,
                  lon: m.lon ?? 0,
                  centavos: m.montoCentavos,
                  cantidad: 1,
                },
              ]}
              className="h-[180px]"
            />
          </Suspense>
        </div>
      ) : null}

      <Grupo>
        <FilaBoton
          sangria="3.4rem"
          icono={<Pencil aria-hidden className="size-5 text-tint" />}
          titulo={<span className="text-tint">Editar</span>}
          disabled={!enLinea}
          onClick={() => abrirEditor(m)}
        />
        {m.comercio ? (
          <FilaBoton
            sangria="3.4rem"
            icono={<Search aria-hidden className="size-5 text-tint" />}
            titulo={<span className="text-tint">Ver todo en {m.comercio}</span>}
            onClick={() => navegar(hashDe("movimientos", { q: m.comercio, mes: "todo" }))}
          />
        ) : null}
        <FilaBoton
          sangria="3.4rem"
          icono={<Sparkles aria-hidden className="size-5 text-tint" />}
          titulo={<span className="text-tint">Preguntar al chat</span>}
          disabled={!enLinea}
          onClick={() => {
            haptico();
            const que = `${titulo} por ${dinero(m.montoCentavos, m.moneda)} el ${m.fecha}`;
            if (!preguntarAlChat(`Sobre el movimiento de ${que}: ¿es normal para mí y cómo se compara con otros meses?`)) {
              toast("Espera a que termine la respuesta anterior.");
            }
            navegar(hashDe("chat"));
          }}
        />
      </Grupo>

      <Grupo>
        <FilaBoton
          sangria="3.4rem"
          icono={<Trash2 aria-hidden className="size-5 text-destructive" />}
          titulo={<span className="text-destructive">Eliminar</span>}
          disabled={!enLinea}
          onClick={() => {
            haptico();
            void eliminarConDeshacer(m, () => volver("movimientos"));
          }}
        />
      </Grupo>
    </div>
  );
}
