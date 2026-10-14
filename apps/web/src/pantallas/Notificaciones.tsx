import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, CircleCheck, CircleSlash, Settings, TriangleAlert } from "lucide-react";
import { ICONOS } from "../components/Avisos";
import { HojaCalendario } from "../components/HojaCalendario";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { FilaBoton, Grupo } from "../components/ui/lista";
import { Skeleton } from "../components/ui/skeleton";
import { api, ErrorApi, mensajeDeError } from "../lib/api";
import { abrirCobros, type Cobro, cobrosParaMostrar, cuandoFue, QUIEN_CONFIRMO, useCobros } from "../lib/cobros";
import { dinero, diaCorto, hoyIso } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { useQuitarAviso } from "../lib/plan";
import { hashDe, navegar, volver } from "../lib/ruta";
import type { Aviso } from "../lib/tipos";
import { cn } from "../lib/utils";

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
  const hoy = hoyIso();
  const apagado = q.error instanceof ErrorApi && q.error.estado === 404;

  const refrescar = () => Promise.all([q.refetch(), avisos.refetch()]);

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
  const nada = cobros && !porConfirmar.length && !recientes.length && !listaAvisos.length;

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
                <FilaBoton
                  key={c.id}
                  sangria="4rem"
                  data-cobro={c.id}
                  icono={<HojaCalendario fecha={c.fecha} />}
                  titulo={`¿Ya se pagó ${c.nombre}?`}
                  subtitulo={`${dinero(c.montoCentavos, c.moneda)} · ${cuandoFue(c.fecha, hoy, { corto: true })}${c.pospuesto ? " · te pregunto mañana" : c.estado === "sin_confirmar" ? " · sin contestar" : ""}`}
                  chevron
                  onClick={() => abrirCobros([c.id])}
                />
              ))}
            </Grupo>
          ) : null}

          {listaAvisos.length ? (
            <Grupo titulo="Avisos de la semana">
              {listaAvisos.map((a) => {
                const [Icono, color] = ICONOS[a.tipo] ?? [TriangleAlert, "var(--tint)"];
                return (
                  <FilaBoton
                    key={a.id}
                    sangria="3.75rem"
                    data-aviso={a.id}
                    data-leido={a.leidoEn ? "1" : undefined}
                    className="items-start"
                    icono={
                      <span
                        aria-hidden
                        className="mt-2.5 flex size-[30px] shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
                      >
                        <Icono className="size-[17px]" strokeWidth={2.2} />
                      </span>
                    }
                    titulo={
                      <span className={cn("flex items-center gap-1.5 text-[15px] leading-5", a.leidoEn ? "font-normal" : "font-semibold")}>
                        {!a.leidoEn ? <span aria-label="Nuevo" className="size-2 shrink-0 rounded-full bg-tint" /> : null}
                        <span className="truncate">{a.titulo}</span>
                      </span>
                    }
                    subtitulo={<span className="line-clamp-2 whitespace-normal">{a.texto}</span>}
                    valor={<span className="pt-2.5 text-[13px]">{diaCorto(a.fecha)}</span>}
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
                  sangria="3.75rem"
                  data-cobro={c.id}
                  icono={<IconoEstado c={c} />}
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
              sangria="3.25rem"
              icono={<Settings className="size-[20px] text-tint" />}
              titulo="Qué te aviso y a qué hora"
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

function IconoEstado({ c }: { c: Cobro }) {
  const pagado = c.estado === "pagado";
  const color = pagado ? "var(--positive)" : "var(--gray-icon)";
  return (
    <span
      aria-hidden
      className="flex size-[30px] shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      {pagado ? <CircleCheck className="size-[18px]" /> : <CircleSlash className="size-[18px]" />}
    </span>
  );
}

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
