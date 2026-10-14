import { ChevronDown, Plus, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { Accesos } from "../components/Accesos";
import { construirDestacados } from "../components/Destacados";
import { ContenidoMovimiento } from "../components/FilaMovimiento";
import { agruparCategorias } from "../components/graficas/colores";
import { Campana } from "../components/inicio/Campana";
import { ParaTi } from "../components/inicio/ParaTi";
import { TarjetasInicio, useRitmo } from "../components/inicio/Tarjetas";
import { LogoCategoria, LogoPago } from "../components/Logo";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { SelectNativo } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { mensajeDeError } from "../lib/api";
import { useEnLinea } from "../lib/conexion";
import { abrirDetalle, useMovimientos, useTablero, useYo } from "../lib/consultas";
import { abrirEditor } from "../lib/editor";
import { diaCorto, diasHasta, dinero, dineroCorto, FRECUENCIAS, fechaLarga, hoyIso, mesActual, nombreMes, pct, sumarMeses } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { hashDe, navegar } from "../lib/ruta";
import type { Tablero } from "../lib/tipos";
import { cn } from "../lib/utils";

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

export function Inicio({ params }: { params: URLSearchParams }) {
  const pedido = params.get("mes");
  const mesLocal = mesActual();
  const mes = pedido && MES_VALIDO.test(pedido) && pedido <= mesLocal ? pedido : mesLocal;
  const tablero = useTablero(mes);
  const yo = useYo();
  const hoy = tablero.data?.hoy ?? hoyIso();
  const mesHoy = hoy.slice(0, 7);
  const t = tablero.data?.mes === mes ? tablero.data : undefined;
  const esMesActual = mes === mesHoy;
  const nombre = yo.data?.usuario.nombre.split(" ")[0];

  const meses = useMemo(() => Array.from({ length: 24 }, (_, i) => sumarMeses(mesHoy, -i)), [mesHoy]);
  const etiquetaMes = mes.slice(0, 4) === mesHoy.slice(0, 4) ? nombreMes(mes, false) : nombreMes(mes);

  return (
    <Pantalla
      titulo={nombre ? `Hola, ${nombre}` : "Inicio"}
      tituloCompacto={esMesActual ? "Inicio" : etiquetaMes}
      encima={esMesActual ? fechaLarga(hoy) : `Viendo ${etiquetaMes.toLowerCase()}`}
      alRefrescar={() => tablero.refetch()}
      izquierda={
        <SelectNativo
          aria-label="Cambiar de mes"
          value={mes}
          onChange={(e) => {
            haptico();
            navegar(hashDe("inicio", { mes: e.target.value === mesHoy ? undefined : e.target.value }), { reemplazar: true });
          }}
          opciones={meses.map((m) => (
            <option key={m} value={m}>
              {nombreMes(m)}
            </option>
          ))}
        >
          <span className="flex h-9 items-center gap-0.5 text-[17px] font-semibold text-tint">
            {etiquetaMes}
            <ChevronDown aria-hidden className="size-4" strokeWidth={2.6} />
          </span>
        </SelectNativo>
      }
      derecha={<Campana porRevisar={t?.porRevisar ?? 0} />}
    >
      {t ? (
        <Contenido t={t} esMesActual={esMesActual} />
      ) : tablero.isError ? (
        <div className="mt-6 rounded-[20px] bg-card px-6 py-10 text-center">
          <p className="text-[17px] font-semibold">No pudimos cargar tu resumen</p>
          <p className="mt-1 text-[15px] text-muted-foreground">{mensajeDeError(tablero.error)}</p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => tablero.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <EsqueletoTablero />
      )}
    </Pantalla>
  );
}

function Contenido({ t, esMesActual }: { t: Tablero; esMesActual: boolean }) {
  const ritmo = useRitmo(t, esMesActual);
  const enLinea = useEnLinea();
  const destacados = useMemo(
    () => construirDestacados(t, { esMesActual, acumuladoAnterior: ritmo?.anterior }),
    [t, esMesActual, ritmo?.anterior],
  );

  return (
    <div className="space-y-7 pt-1 pb-4">
      <TarjetasInicio key={`t-${t.mes}`} t={t} esMesActual={esMesActual} ritmo={ritmo} />
      <ParaTi key={`p-${t.mes}`} destacados={destacados} conAvisos={esMesActual} enLinea={enLinea} />
      <Accesos />
      <Recientes t={t} esMesActual={esMesActual} />
      <EnQueSeVa key={`c-${t.mes}`} t={t} />
      <ProximosCobros t={t} />
    </div>
  );
}

const claseLista = "overflow-hidden rounded-[20px] bg-card";
const claseSeparada =
  "relative [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[68px] [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']";
const claseVerMas =
  "relative flex h-[46px] w-full items-center justify-center text-[15px] font-medium text-tint before:absolute before:top-0 before:right-0 before:left-0 before:h-[0.5px] before:bg-separator before:content-[''] active:bg-fill-strong";

function Cabecera({ titulo, liga, alTocar }: { titulo: string; liga?: string; alTocar?: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
      <h2 className="text-[20px] leading-[25px] font-bold tracking-[-0.02em]">{titulo}</h2>
      {liga && alTocar ? (
        <button type="button" className="text-[15px] whitespace-nowrap text-tint active:opacity-50" onClick={alTocar}>
          {liga}
        </button>
      ) : null}
    </div>
  );
}

/** Lo de hoy (o, si hoy no hay nada, lo último del mes), tres a la vez y "Ver más". */
function Recientes({ t, esMesActual }: { t: Tablero; esMesActual: boolean }) {
  // La misma consulta que abre Movimientos para este mes: al ir allá ya está cargada.
  const consulta = useMovimientos({ mes: t.mes });
  const lista = consulta.data?.pages[0]?.movimientos ?? [];
  if (consulta.isPending) return <Skeleton className="h-[230px] rounded-[20px] bg-card" />;
  if (!lista.length) return null;
  const deHoy = esMesActual ? lista.filter((m) => m.fecha === t.hoy) : [];
  const mostrar = (deHoy.length ? deHoy : lista).slice(0, 3);
  const titulo = deHoy.length ? "Hoy" : esMesActual ? "Recientes" : `Últimos de ${nombreMes(t.mes, false).toLowerCase()}`;
  const irAMovimientos = () => navegar(hashDe("movimientos", esMesActual ? {} : { mes: t.mes }));

  return (
    <section aria-label={titulo}>
      <Cabecera titulo={titulo} liga="Ver todos" alTocar={irAMovimientos} />
      <div className={claseLista}>
        {mostrar.map((m) => (
          <button key={m.id} type="button" className={cn(claseSeparada, "fila-presionable block w-full text-left")} onClick={() => abrirDetalle(m)}>
            <ContenidoMovimiento m={m} conHora={!!deHoy.length} />
          </button>
        ))}
        <button type="button" className={claseVerMas} onClick={irAMovimientos}>
          Ver más movimientos
        </button>
      </div>
    </section>
  );
}

const VISIBLES = 3;
const colorDeSlot = (slot: number | "otros") => (slot === "otros" || slot > 6 ? "var(--serie-otros)" : `var(--serie-${slot + 1})`);

/** "En qué se va": una barra con todas las categorías, las tres que más pesan y "Ver las N". */
function EnQueSeVa({ t }: { t: Tablero }) {
  const items = useMemo(() => agruparCategorias(t.porCategoria), [t.porCategoria]);
  const total = items.reduce((s, i) => s + i.centavos, 0);
  const [todas, setTodas] = useState(false);

  if (!items.length) {
    return (
      <section aria-label="En qué se va">
        <Cabecera titulo="En qué se va" />
        <div className="rounded-[20px] bg-card px-6 py-8 text-center">
          <p className="text-[17px] font-semibold">Aún no hay gastos este mes</p>
          <p className="mt-1 text-[15px] text-muted-foreground">Dile a Siri «gasté 85 en café» o agrégalo aquí.</p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => abrirEditor(null)}>
            <Plus /> Agregar gasto
          </Button>
        </div>
      </section>
    );
  }

  const visibles = todas ? items : items.slice(0, VISIBLES);
  return (
    <section aria-label="En qué se va">
      <Cabecera titulo="En qué se va" liga="Análisis" alTocar={() => navegar(hashDe("analisis", { ref: `${t.mes}-01` }))} />
      <div className={claseLista}>
        <div className="px-3.5 pt-3 pb-1">
          <p className="text-[13px] text-muted-foreground tabular">
            {dinero(total, t.moneda)} en {items.length} {items.length === 1 ? "categoría" : "categorías"}
          </p>
          <div aria-hidden className="mt-1.5 mb-1 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {items.map((it, i) => (
              <i key={`${it.nombre}-${i}`} className="block h-full" style={{ flex: `${it.centavos} 0 0`, background: colorDeSlot(it.slot) }} />
            ))}
          </div>
        </div>
        {visibles.map((it, i) => {
          const parte = it.centavos / Math.max(1, total);
          const contenido = (
            <>
              <LogoCategoria nombre={it.nombre} tipo="gasto" tamano={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px]">{it.nombre}</span>
                <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-fill">
                  <i className="block h-full rounded-full" style={{ width: `${Math.max(2, parte * 100)}%`, background: colorDeSlot(it.slot) }} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[17px] tabular">{dineroCorto(Math.round(it.centavos / 100) * 100, t.moneda)}</span>
                <span className="block text-[13px] text-muted-foreground tabular">{pct(parte)}</span>
              </span>
            </>
          );
          const clase = cn(claseSeparada, "flex w-full items-center gap-3 px-4 py-2.5 text-left");
          return it.categoriaId ? (
            <button
              key={`${it.nombre}-${i}`}
              type="button"
              className={cn(clase, "fila-presionable")}
              onClick={() => navegar(hashDe("movimientos", { mes: t.mes, tipo: "gasto", categoria: it.categoriaId! }))}
            >
              {contenido}
            </button>
          ) : (
            <div key={`${it.nombre}-${i}`} className={clase}>
              {contenido}
            </div>
          );
        })}
        {items.length > VISIBLES ? (
          <button
            type="button"
            aria-expanded={todas}
            className={claseVerMas}
            onClick={() => {
              haptico();
              setTodas((v) => !v);
            }}
          >
            {todas ? "Ver menos" : `Ver las ${items.length}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ProximosCobros({ t }: { t: Tablero }) {
  return (
    <section aria-label="Próximos cobros">
      <Cabecera titulo="Próximos cobros" liga="Suscripciones" alTocar={() => navegar(hashDe("suscripciones"))} />
      {t.recurrentesProximos.length ? (
        <div className={claseLista}>
          {t.recurrentesProximos.map((r) => {
            const dias = diasHasta(r.proximoCobro, t.hoy);
            return (
              <button
                key={r.id}
                type="button"
                className={cn(claseSeparada, "fila-presionable flex w-full items-center gap-3 px-4 py-2.5 text-left")}
                onClick={() => navegar(hashDe("suscripciones", { id: r.id }))}
              >
                <LogoPago nombre={r.nombre} tipo={r.tipo} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px]">{r.nombre}</span>
                  <span className="block text-[15px] leading-snug text-muted-foreground text-pretty">
                    {diaCorto(r.proximoCobro)} · {dias <= 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`}
                    {r.frecuencia ? ` · ${FRECUENCIAS[r.frecuencia] ?? r.frecuencia}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[17px] tabular">{dinero(r.montoCentavos, r.moneda)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-[20px] bg-card p-4">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-fill text-muted-foreground">
            <Repeat className="size-[18px]" />
          </span>
          <p className="text-[15px] leading-snug text-muted-foreground">Nada en los próximos 30 días. Dile a la IA «Netflix 299 cada mes» y te aviso aquí.</p>
        </div>
      )}
    </section>
  );
}

function EsqueletoTablero() {
  return (
    <div aria-busy className="space-y-7 pt-1">
      <Skeleton className="h-[178px] rounded-[24px] bg-card" />
      <Skeleton className="h-[110px] rounded-[20px] bg-card" />
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="mx-auto size-14 rounded-[18px] bg-card" />
        ))}
      </div>
      <Skeleton className="h-[230px] rounded-[20px] bg-card" />
    </div>
  );
}
