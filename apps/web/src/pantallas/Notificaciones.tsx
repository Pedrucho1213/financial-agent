import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Check, TriangleAlert, X } from "lucide-react";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import { ICONOS } from "../components/Avisos";
import { ContenidoMovimiento } from "../components/FilaMovimiento";
import { LogoMarca, LogoPago } from "../components/Logo";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { FilaBoton, Grupo, IconoAjuste } from "../components/ui/lista";
import { Skeleton } from "../components/ui/skeleton";
import { api, ErrorApi, mensajeDeError } from "../lib/api";
import { abrirCobros, type Cobro, cobrosParaMostrar, cuandoFue, QUIEN_CONFIRMO, useAccionCobro, useCobros } from "../lib/cobros";
import { useEnLinea } from "../lib/conexion";
import { abrirDetalle, useMovimientos } from "../lib/consultas";
import { dinero, diaCorto, hoyIso } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { marcaDe } from "../lib/marcas";
import { useQuitarAviso } from "../lib/plan";
import { hashDe, navegar, volver } from "../lib/ruta";
import type { Aviso } from "../lib/tipos";
import { useUnaVez } from "../lib/una-vez";
import { cn } from "../lib/utils";

const MAXIMO_REVISAR = 3;
// Los avisos que hablan de un comercio o de un pago llevan su logo (Oxxo, Netflix…); los demás, su icono.
const CON_MARCA = new Set<Aviso["tipo"]>(["hormiga", "suscripcion_olvidada", "suscripcion_duplicada", "cobro_proximo", "gasto_inusual"]);

/** Los avisos de la última semana, leídos incluidos (Inicio solo muestra los nuevos). */
function useTodosLosAvisos() {
  return useQuery({
    queryKey: ["plan", "avisos", "todos"] as const,
    retry: false,
    queryFn: ({ signal }) => api<{ avisos: Aviso[] }>("/v1/avisos?todos=1", { signal }).then((r) => r.avisos),
  });
}

/**
 * #avisos: el centro de notificaciones. Lo que espera respuesta (pagos por confirmar), los avisos de la semana y
 * lo que ya se contestó (para corregirlo). Solo con el módulo de cobros encendido; si no, lo dice y nada más.
 */
export function Notificaciones() {
  const q = useCobros();
  const cobros = cobrosParaMostrar(q);
  const avisos = useTodosLosAvisos();
  const quitar = useQuitarAviso();
  const qc = useQueryClient();
  const accion = useAccionCobro();
  const enLinea = useEnLinea();
  const unaVez = useUnaVez();
  const revisar = useMovimientos({ mes: "todo", revisar: true });
  const hoy = hoyIso();
  const apagado = q.error instanceof ErrorApi && q.error.estado === 404;

  const refrescar = () => Promise.all([q.refetch(), avisos.refetch(), revisar.refetch()]);

  const pagado = (c: Cobro) =>
    unaVez(async () => {
      try {
        await accion.mutateAsync({ tipo: "confirmar", id: c.id });
        haptico();
        toast.success(`${c.nombre}: pagado ${dinero(c.montoCentavos, c.moneda)}`, {
          action: { label: "Deshacer", onClick: () => accion.mutate({ tipo: "deshacer", id: c.id }) },
        });
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  const abrirAviso = (a: Aviso) => {
    haptico();
    if (!a.leidoEn) {
      // Leído desde ya, aquí y en Inicio. (La promesa, no un callback de mutate: la pantalla se va al navegar.)
      qc.setQueryData<Aviso[]>(["plan", "avisos", "todos"], (l) => l?.map((x) => (x.id === a.id ? { ...x, leidoEn: new Date().toISOString() } : x)));
      void quitar
        .mutateAsync({ id: a.id, accion: "leido" })
        .catch(() => {})
        .finally(() => void qc.invalidateQueries({ queryKey: ["plan", "avisos"] }));
    }
    if (a.enlace?.startsWith("#")) navegar(a.enlace);
  };

  const porConfirmar = cobros?.porConfirmar ?? [];
  const recientes = cobros?.recientes ?? [];
  const listaAvisos = avisos.data ?? [];
  const porRevisar = revisar.data?.pages.flatMap((p) => p.movimientos) ?? [];
  const totalRevisar = revisar.data?.pages[0]?.total ?? 0;
  const nada = cobros && !porConfirmar.length && !recientes.length && !listaAvisos.length && !totalRevisar;

  return (
    <Pantalla titulo="Notificaciones" atras={{ etiqueta: "Inicio", alTocar: () => volver("inicio") }} alRefrescar={refrescar}>
      {apagado ? (
        <Vacio titulo="Todavía no está abierto para tu cuenta" texto="Los avisos nuevos te siguen apareciendo en Inicio." />
      ) : !cobros ? (
        q.isError ? (
          <div className="mt-3 rounded-[20px] bg-card px-6 py-10 text-center">
            <p className="text-[17px] font-semibold">No pudimos cargar tus notificaciones</p>
            <p className="mt-1 text-[15px] text-muted-foreground">{mensajeDeError(q.error)}</p>
            <Button variant="tinted" size="sm" className="mt-4" onClick={() => void q.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <div aria-busy className="space-y-3 pt-2">
            <Skeleton className="h-16 rounded-[20px]" />
            <Skeleton className="h-32 rounded-[20px]" />
          </div>
        )
      ) : (
        <div className="space-y-8 pt-2 pb-4">
          {nada ? <Vacio titulo="Estás al día" texto="Cuando toque un pago fijo o encuentre algo en tus gastos, aparece aquí." /> : null}

          {porConfirmar.length ? (
            <Grupo
              titulo="Por confirmar"
              accion={
                porConfirmar.length > 1 ? (
                  <Button variant="plain" size="text" className="h-auto text-[15px]" onClick={() => abrirCobros(porConfirmar.map((c) => c.id))}>
                    Contestar todos
                  </Button>
                ) : undefined
              }
              pie="En su fecha te pregunto si ya se pagaron. Si lo anotas por voz o con Apple Pay, se confirma solo."
            >
              {porConfirmar.map((c) => (
                // En pantallas angostas (≤360 px) la pregunta usa todo el ancho y "Se pagó" baja junto a los
                // detalles, en chico. Toda la fila abre el cobro, menos "Se pagó", que va encima.
                <div
                  key={c.id}
                  data-cobro={c.id}
                  className={cn(claseFila, "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2.5 max-[360px]:gap-x-2.5")}
                  style={sangria("4.25rem")}
                >
                  <LogoPago nombre={c.nombre} tipo={c.tipo} className="col-start-1 row-start-1 row-end-3" />
                  <button
                    type="button"
                    className="col-start-2 row-start-1 min-w-0 self-end text-left after:absolute after:inset-0 after:content-[''] active:opacity-60 max-[360px]:col-end-4"
                    onClick={() => abrirCobros([c.id])}
                  >
                    <span className="line-clamp-2 text-[17px] leading-[22px] max-[360px]:text-[16px] max-[360px]:leading-[21px]">¿Ya se pagó {c.nombre}?</span>
                  </button>
                  <span className="col-start-2 row-start-2 min-w-0 self-start text-[15px] leading-5 text-muted-foreground max-[360px]:self-center max-[360px]:text-[14px] max-[360px]:leading-[19px]">
                    <span className="tabular">{dinero(c.montoCentavos, c.moneda)}</span> · {cuandoFue(c.fecha, hoy, { corto: true })}
                    {c.pospuesto ? " · te pregunto mañana" : c.estado === "sin_confirmar" ? " · sin contestar" : ""}
                    {c.cuenta ? ` · ${c.cuenta}` : ""}
                  </span>
                  <Button
                    variant="tinted"
                    size="sm"
                    className="relative z-[1] col-start-3 row-start-1 row-end-3 max-[360px]:row-start-2 max-[360px]:h-[30px] max-[360px]:px-3 max-[360px]:text-[14px]"
                    aria-label={`${c.nombre} se pagó`}
                    disabled={!enLinea}
                    onClick={() => void pagado(c)}
                  >
                    Se pagó
                  </Button>
                </div>
              ))}
            </Grupo>
          ) : null}

          {porRevisar.length ? (
            <Grupo
              titulo="Por revisar"
              accion={
                totalRevisar > MAXIMO_REVISAR ? (
                  <Button variant="plain" size="text" className="h-auto text-[15px]" onClick={() => navegar(hashDe("movimientos", { revisar: "1", mes: "todo" }))}>
                    Ver los {totalRevisar}
                  </Button>
                ) : undefined
              }
              pie="Les falta algo o no estoy seguro de la categoría. Tócalos para corregirlos."
            >
              {porRevisar.slice(0, MAXIMO_REVISAR).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-revisar={m.id}
                  className={cn(claseFila, "fila-presionable block px-0 pr-0 pl-0 text-left")}
                  style={sangria("4.25rem")}
                  onClick={() => abrirDetalle(m)}
                >
                  <ContenidoMovimiento m={m} />
                </button>
              ))}
            </Grupo>
          ) : null}

          {listaAvisos.length ? (
            <Grupo titulo="Avisos de la semana">
              {listaAvisos.map((a) => {
                const [Icono, color] = ICONOS[a.tipo] ?? [TriangleAlert, "var(--tint)"];
                const marca = CON_MARCA.has(a.tipo) ? marcaDe(a.titulo) : null;
                return (
                  <FilaBoton
                    key={a.id}
                    sangria="4.25rem"
                    data-aviso={a.id}
                    data-leido={a.leidoEn ? "1" : undefined}
                    className="items-start"
                    icono={
                      marca ? (
                        <LogoMarca clave={marca} className="mt-2.5" />
                      ) : (
                        <span
                          aria-hidden
                          className="mt-2.5 flex size-10 shrink-0 items-center justify-center rounded-[11px]"
                          style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, var(--card))`, color }}
                        >
                          <Icono className="size-5" strokeWidth={2.2} />
                        </span>
                      )
                    }
                    titulo={
                      <span className={cn("flex items-start gap-1.5 text-[16px] leading-[21px]", a.leidoEn ? "font-normal" : "font-semibold")}>
                        {!a.leidoEn ? <span aria-label="Nuevo" className="mt-[7px] size-2 shrink-0 rounded-full bg-tint" /> : null}
                        <span className="line-clamp-2 whitespace-normal">{a.titulo}</span>
                      </span>
                    }
                    subtitulo={
                      <span className="line-clamp-2 text-[14px] leading-[19px] whitespace-normal">
                        {/* En pantallas angostas la fecha va aquí, para que el título no se corte. */}
                        <span className="min-[361px]:hidden">{diaCorto(a.fecha)} · </span>
                        {a.texto}
                      </span>
                    }
                    valor={<span className="pt-2.5 text-[13px] max-[360px]:hidden">{diaCorto(a.fecha)}</span>}
                    chevron={!!a.enlace}
                    onClick={() => abrirAviso(a)}
                  />
                );
              })}
            </Grupo>
          ) : null}

          {recientes.length ? (
            <Grupo titulo="Anteriores" pie="Toca uno para corregirlo.">
              {recientes.map((c) => (
                <FilaBoton
                  key={c.id}
                  sangria="4.25rem"
                  data-cobro={c.id}
                  icono={<LogoConEstado c={c} />}
                  titulo={c.nombre}
                  subtitulo={resumen(c, hoy)}
                  valor={
                    c.estado === "pagado" ? (
                      <span className="font-medium text-foreground tabular">{dinero(c.montoRealCentavos ?? c.montoCentavos, c.moneda)}</span>
                    ) : undefined
                  }
                  chevron
                  onClick={() => abrirCobros([c.id])}
                />
              ))}
            </Grupo>
          ) : null}

          <Grupo>
            <FilaBoton
              sangria="3.6rem"
              icono={
                <IconoAjuste color="var(--destructive)">
                  <Bell />
                </IconoAjuste>
              }
              titulo={<span className="block py-0.5 leading-[22px] whitespace-normal">Qué te aviso y a qué hora</span>}
              chevron
              onClick={() => navegar(hashDe("notificaciones"))}
            />
          </Grupo>
        </div>
      )}
    </Pantalla>
  );
}

function resumen(c: Cobro, hoy: string) {
  const cuando = cuandoFue(c.fecha, hoy, { corto: true });
  // Pagado ya lo dicen la palomita y el monto.
  if (c.estado === "pagado") return `${cuando[0]!.toUpperCase()}${cuando.slice(1)}${c.confirmadoPor ? ` · ${QUIEN_CONFIRMO[c.confirmadoPor]}` : ""}`;
  if (c.estado === "saltado") return `No se pagó · ${cuando}`;
  return `Sin contestar · ${cuando}`;
}

/** El logo del pago con una marca chica: palomita si se pagó, tache si no. */
function LogoConEstado({ c }: { c: Cobro }) {
  const pagado = c.estado === "pagado";
  return (
    <span className="relative shrink-0">
      <LogoPago nombre={c.nombre} tipo={c.tipo} />
      <span
        aria-hidden
        className={cn(
          "absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full text-white shadow-[0_0_0_2px_var(--card)]",
          pagado ? "bg-[var(--positive)]" : "bg-[var(--gray-icon)]",
        )}
      >
        {pagado ? <Check className="size-3" strokeWidth={3.2} /> : <X className="size-3" strokeWidth={3.2} />}
      </span>
    </span>
  );
}

const claseFila =
  "relative flex min-h-11 w-full min-w-0 items-center gap-3 pr-3 pl-4 [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[var(--sangria,1rem)] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']";
const sangria = (s: string) => ({ "--sangria": s }) as CSSProperties;

function Vacio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="mt-3 flex flex-col items-center rounded-[20px] bg-card px-6 py-10 text-center">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-fill text-muted-foreground">
        <BellOff className="size-6" />
      </span>
      <p className="mt-3 text-[17px] font-semibold">{titulo}</p>
      <p className="mt-1 text-[15px] leading-snug text-balance text-muted-foreground">{texto}</p>
    </div>
  );
}
