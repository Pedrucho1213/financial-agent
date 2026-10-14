import { CircleAlert, Mic, Pencil, Search, Smartphone, Sparkles, Trash2, Wallet } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import { toast } from "sonner";
import { Ajustado } from "../components/Ajustado";
import { LogoCategoria, LogoMarca, LogoMovimiento } from "../components/Logo";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { Fila, FilaBoton, Grupo } from "../components/ui/lista";
import { Skeleton } from "../components/ui/skeleton";
import { eliminarConDeshacer } from "../lib/acciones";
import { ErrorApi, mensajeDeError } from "../lib/api";
import { preguntarAlChat } from "../lib/chat";
import { useEnLinea } from "../lib/conexion";
import { useMovimiento, useYo } from "../lib/consultas";
import { abrirEditor } from "../lib/editor";
import { dinero, TIPOS } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { leerCalles } from "../lib/mapa";
import { marcaDe } from "../lib/marcas";
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

// En la zona del servidor, como el resto de la app: de viaje, la hora no cambia de día.
// El año solo si no es el de hoy: así en 320 px la hora no baja sola a otro renglón.
const fechaLarga = (zonaHoraria?: string, conAnio = true) =>
  new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(conAnio ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZone: zonaHoraria,
  });

/**
 * Detalle de un registro, como en Wallet. Es a donde lleva tocar una notificación (#movimientos?detalle=<id>).
 * Un dictado que registró varios llega con <id1>,<id2>: primero se ve la lista.
 */
export function DetalleMovimiento({ params }: { params: URLSearchParams }) {
  const ids = (params.get("detalle") ?? "").split(",").filter(Boolean);
  if (ids.length > 1) return <VariosMovimientos ids={ids} editar={params.get("editar") === "1"} />;
  return <UnMovimiento id={ids[0] ?? null} params={params} />;
}

function VariosMovimientos({ ids, editar }: { ids: string[]; editar: boolean }) {
  return (
    <Pantalla titulo={`${ids.length} registros`} atras={{ etiqueta: "Atrás", alTocar: () => volver("movimientos") }}>
      <div className="pt-2 pb-6">
        <Grupo pie="Toca uno para ver su detalle o agregarle información.">
          {ids.map((id) => (
            <FilaDeVarios key={id} id={id} editar={editar} />
          ))}
        </Grupo>
      </div>
    </Pantalla>
  );
}

// Con editar (Apple Pay con varios registros), cada uno abre directo su editor.
function FilaDeVarios({ id, editar }: { id: string; editar: boolean }) {
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
  return (
    <FilaBoton
      sangria="4.25rem"
      icono={<LogoMovimiento comercio={m.comercio} descripcion={m.descripcion} categoria={m.categoria} tipo={m.tipo} />}
      titulo={tituloDe(m)}
      subtitulo={m.categoria?.split(">").pop()?.trim() ?? TIPOS[m.tipo]}
      valor={
        <span className={cn("font-medium tabular", m.tipo === "ingreso" ? "text-positive" : "text-foreground")}>
          {dinero(m.montoCentavos, m.moneda)}
        </span>
      }
      chevron
      onClick={() => navegar(hashDetalle(m.id, { editar }))}
    />
  );
}

const tituloDe = (m: MovimientoApp) =>
  m.comercio ?? m.descripcion ?? m.categoria?.split(">").pop()?.trim() ?? TIPOS[m.tipo] ?? "Movimiento";

function UnMovimiento({ id, params }: { id: string | null; params: URLSearchParams }) {
  const consulta = useMovimiento(id);
  const m = consulta.data;
  const enLinea = useEnLinea();

  // ?editar=1 (notificación de Apple Pay: "agrega más info") abre el editor y se quita de la dirección:
  // recargar o volver no lo abre otra vez, y otra notificación igual sí (la dirección cambia).
  useEffect(() => {
    if (!m || params.get("editar") !== "1") return;
    navegar(hashDetalle(m.id), { reemplazar: true });
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
          <Skeleton className="size-[72px] rounded-[20px]" />
          <Skeleton className="mt-4 h-6 w-40" />
          <Skeleton className="mt-3 h-10 w-48" />
          <Skeleton className="mt-8 h-40 w-full rounded-[20px]" />
        </div>
      )}
    </Pantalla>
  );
}

function Detalle({ m, enLinea }: { m: MovimientoApp; enLinea: boolean }) {
  const titulo = tituloDe(m);
  const signo = m.tipo === "ingreso" ? "+" : m.tipo === "gasto" ? "−" : "";
  const origen = ORIGENES[m.origen];
  const conLugar = m.lat !== null && m.lon !== null;
  // Transferencias y pagos de tarjeta: dinero que cambia de lugar, sin categoría.
  const mueve = m.tipo === "transferencia" || m.tipo === "pago_tarjeta";
  const zonaHoraria = useYo().data?.zonaHoraria;
  const anio = (d: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: zonaHoraria }).format(d);
  const cuando = new Date(m.ocurridoEn);
  const fecha = fechaLarga(zonaHoraria, anio(cuando) !== anio(new Date())).format(cuando);

  return (
    <div className="space-y-6 pt-4 pb-6">
      <header className="flex flex-col items-center text-center animate-entrar">
        <LogoMovimiento comercio={m.comercio} descripcion={m.descripcion} categoria={m.categoria} tipo={m.tipo} tamano={72} />
        <h1 className="mt-3 line-clamp-2 max-w-full px-4 text-[22px] leading-7 font-semibold text-balance break-words">{titulo}</h1>
        <Ajustado
          className={cn(
            "mt-1 max-w-full px-4 text-[44px] leading-[1.15] font-bold tracking-[-0.025em] tabular",
            m.tipo === "ingreso" && "text-positive",
          )}
        >
          {signo}
          {dinero(m.montoCentavos, m.moneda)}
        </Ajustado>
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
        {mueve ? null : (
          <FilaTexto
            titulo="Categoría"
            icono={m.categoria ? <LogoCategoria nombre={m.categoria} tipo={m.tipo} tamano={22} /> : undefined}
            texto={m.categoria?.replace(" > ", " › ") ?? "Sin categoría"}
          />
        )}
        {m.cuenta ? (
          <FilaTexto titulo={mueve ? "Desde" : m.tipo === "ingreso" ? "Llegó a" : "Pagado con"} icono={<LogoCuenta nombre={m.cuenta} />} texto={m.cuenta} />
        ) : null}
        {m.cuentaDestino ? (
          <FilaTexto titulo={m.tipo === "pago_tarjeta" ? "Tarjeta" : "Hacia"} icono={<LogoCuenta nombre={m.cuentaDestino} />} texto={m.cuentaDestino} />
        ) : null}
        {m.etiquetas?.length ? <FilaTexto titulo="Etiquetas" texto={m.etiquetas.map((e) => `#${e.nombre}`).join(" ")} /> : null}
        {m.descripcion && m.comercio ? <FilaTexto titulo="Nota" texto={m.descripcion} /> : null}
        {m.lugar ? <FilaTexto titulo="Lugar" texto={m.lugar} /> : null}
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
          titulo={<span className="text-tint">Preguntarle a la IA</span>}
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

/**
 * Un dato que puede ser largo (cuenta, nota, lugar, etiquetas). Si cabe va a la derecha como los demás; si no,
 * baja a su propio renglón debajo de la etiqueta, para que la etiqueta nunca se aplaste (a 320 px caben ~28 letras).
 */
function FilaTexto({ titulo, texto, icono }: { titulo: string; texto: string; icono?: ReactNode }) {
  if (titulo.length + texto.length + (icono ? 4 : 0) <= 28)
    return <Fila titulo={titulo} valor={icono ? <ConIcono icono={icono}>{texto}</ConIcono> : texto} />;
  return (
    <Fila>
      <div className="min-w-0 flex-1 py-2.5">
        <div className="text-[15px] text-muted-foreground">{titulo}</div>
        <div data-seleccionable className="flex items-start gap-1.5 break-words text-pretty">
          {icono ? <span className="mt-0.5 shrink-0">{icono}</span> : null}
          <span className="min-w-0">{texto}</span>
        </div>
      </div>
    </Fila>
  );
}

/** Un valor de la lista con su logo chico a la izquierda (la categoría, el banco). */
function ConIcono({ icono, children }: { icono: ReactNode; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center justify-end gap-1.5">
      {icono}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** El logo del banco de una cuenta, si se reconoce por su nombre. */
function LogoCuenta({ nombre }: { nombre: string }) {
  const clave = marcaDe(nombre);
  return clave ? <LogoMarca clave={clave} tamano={22} /> : null;
}
