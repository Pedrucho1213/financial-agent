import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import { type CSSProperties, type ReactNode, useMemo, useRef, useState } from "react";
import { useGastoPorDia } from "../../lib/consultas";
import { useCuentas } from "../../lib/cuentas";
import { aFecha, diaDeMes, dinero, hoyIso, mesCorto, nombreMes, pct, sumarMeses } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { hashDe, navegar } from "../../lib/ruta";
import { NIVELES, type NivelSalud, saludParaMostrar, type SaludFinanciera, useSalud } from "../../lib/salud";
import { creditoTotal, faltan, sinDeudaConocida } from "../../lib/saldos";
import type { Tablero } from "../../lib/tipos";
import { cn } from "../../lib/utils";
import { Ajustado } from "../Ajustado";
import { NumeroAnimado } from "../NumeroAnimado";
import { acumular, Ritmo } from "../Ritmo";
import { Skeleton } from "../ui/skeleton";

export type DatosRitmo = { actual: number[]; anterior: number[]; diasMes: number; hasta: number };

/** Acumulado por día del mes y del anterior, en la moneda base. `undefined` mientras carga; `null` si no se pudo. */
export function useRitmo(t: Tablero, esMesActual: boolean): DatosRitmo | null | undefined {
  const anteriorMes = sumarMeses(t.mes, -1);
  const actual = useGastoPorDia(t.mes);
  const anterior = useGastoPorDia(anteriorMes);
  const fallo = (actual.isError && !actual.data) || (anterior.isError && !anterior.data);
  return useMemo(() => {
    if (fallo) return null;
    if (!actual.data || !anterior.data || actual.data.mes !== t.mes) return undefined;
    const diasMes = actual.data.dias;
    const cero = (n: number) => Array.from({ length: n }, () => 0);
    return {
      actual: acumular(actual.data.porMoneda[t.moneda] ?? cero(diasMes)),
      anterior: acumular(anterior.data.porMoneda[t.moneda] ?? cero(anterior.data.dias)),
      diasMes,
      hasta: esMesActual ? Math.min(diasMes, Number(t.hoy.slice(8, 10))) : diasMes,
    };
  }, [fallo, actual.data, anterior.data, t.mes, t.moneda, t.hoy, esMesActual]);
}

/**
 * Las tarjetas grandes de Inicio, que se deslizan de lado: lo gastado (con el ritmo del mes), lo que tienes y la
 * salud financiera. Las dos últimas solo en el mes actual y si hay datos.
 */
export function TarjetasInicio({ t, esMesActual, ritmo }: { t: Tablero; esMesActual: boolean; ritmo: DatosRitmo | null | undefined }) {
  const cuentas = useCuentas({ activo: esMesActual });
  const salud = saludParaMostrar(useSalud(esMesActual));
  const saldos = esMesActual && t.cuentas && (t.cuentas.cuentasConSaldo || t.cuentas.tarjetasConDeuda) ? t.cuentas : null;

  const hojas: { id: string; nombre: string; nodo: ReactNode }[] = [
    { id: "gastado", nombre: "Gastado", nodo: <HojaGastado t={t} esMesActual={esMesActual} ritmo={ritmo} /> },
  ];
  if (saldos) {
    const lista = cuentas.data?.cuentas ?? [];
    hojas.push({
      id: "tienes",
      nombre: "Lo que tienes",
      nodo: (
        <HojaTienes
          neto={saldos.netoCentavos}
          dinero_={saldos.dineroCentavos}
          deuda={saldos.deudaCentavos}
          moneda={t.moneda}
          uso={creditoTotal(lista)?.uso ?? null}
          noSuman={[...saldos.sinSaldo, ...sinDeudaConocida(lista).map((c) => c.nombre)]}
        />
      ),
    });
  } else if (esMesActual && t.cuentas) {
    hojas.push({ id: "tienes", nombre: "Lo que tienes", nodo: <HojaTienesVacia balance={t.totales.balanceCentavos} moneda={t.moneda} /> });
  } else if (!esMesActual) {
    // Un mes que ya pasó: cómo cerró (como el «Balance» que había en Inicio antes del rediseño).
    hojas.push({ id: "balance", nombre: "Balance del mes", nodo: <HojaTienesVacia balance={t.totales.balanceCentavos} moneda={t.moneda} mes={t.mes} /> });
  }
  if (esMesActual && salud) hojas.push({ id: "salud", nombre: "Salud financiera", nodo: <HojaSalud s={salud} /> });

  return <Carrusel hojas={hojas} />;
}

function Carrusel({ hojas }: { hojas: { id: string; nombre: string; nodo: ReactNode }[] }) {
  const carril = useRef<HTMLDivElement>(null);
  const [pagina, setPagina] = useState(0);
  const irA = (i: number) => {
    const el = carril.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };
  return (
    <section aria-label="Resumen" aria-roledescription="carrusel">
      <div
        ref={carril}
        data-sin-jalar
        className="carrusel -mx-4 scroll-px-4 gap-2.5 px-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          const primero = el.children[0] as HTMLElement | undefined;
          if (!primero) return;
          const n = Math.min(hojas.length - 1, Math.max(0, Math.round(el.scrollLeft / (primero.offsetWidth + 10))));
          if (n !== pagina) {
            haptico();
            setPagina(n);
          }
        }}
      >
        {hojas.map((h, i) => (
          <div
            key={h.id}
            role="group"
            aria-roledescription="tarjeta"
            aria-label={`${i + 1} de ${hojas.length}: ${h.nombre}`}
            className={cn("flex shrink-0", hojas.length > 1 ? "w-[calc(100%-14px)]" : "w-full")}
          >
            {h.nodo}
          </div>
        ))}
      </div>
      {hojas.length > 1 ? (
        <div className="mt-2.5 flex justify-center gap-1.5" role="tablist" aria-label="Tarjetas">
          {hojas.map((h, i) => (
            <button
              key={h.id}
              type="button"
              role="tab"
              aria-selected={i === pagina}
              aria-label={`Ver ${h.nombre}`}
              onClick={() => irA(i)}
              className="relative flex h-2 items-center after:absolute after:-inset-2 after:content-['']"
            >
              <span
                className={cn(
                  "block h-[7px] rounded-full transition-[width,background-color] duration-300 ease-ios",
                  i === pagina ? "w-[18px] bg-foreground/80" : "w-[7px] bg-foreground/20",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Una tarjeta de color con texto blanco. Toda la tarjeta es un botón que lleva a su pantalla (va debajo del
 * contenido); lo que se toca por sí solo, como la gráfica de ritmo, lleva `pointer-events-auto`.
 */
function Hoja({
  nombre,
  fondo,
  alTocar,
  etiqueta,
  children,
}: {
  nombre: string;
  fondo: string;
  alTocar: () => void;
  etiqueta: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={nombre}
      className="presionable relative flex min-h-[178px] w-full min-w-0 flex-col overflow-hidden rounded-[24px] text-white select-none [container-type:inline-size]"
      style={{ background: fondo }}
    >
      <button
        type="button"
        aria-label={etiqueta}
        className="absolute inset-0 cursor-pointer rounded-[24px]"
        onClick={() => {
          haptico();
          alTocar();
        }}
      />
      <div className="pointer-events-none relative flex flex-1 flex-col px-[18px] pt-4 pb-3.5">{children}</div>
    </section>
  );
}

const claseEtiqueta = "text-[12px] leading-4 font-bold tracking-[0.04em] uppercase opacity-[0.86]";
const claseGrande = "mt-0.5 block truncate text-[36px] leading-[42px] font-bold tracking-[-0.03em] tabular [@container(max-width:300px)]:text-[30px] [@container(max-width:300px)]:leading-9";
const clasePie = "mt-auto flex items-end justify-between gap-2 pt-2.5 text-[13px] leading-[18px] font-semibold";

// La gráfica de ritmo sobre azul: líneas blancas, sin el gris de la tarjeta.
const ritmoBlanco = {
  "--tint": "#ffffff",
  "--card": "#1f6fe8",
  "--chart-muted": "rgb(255 255 255 / 0.7)",
  "--chart-grid": "rgb(255 255 255 / 0.18)",
  "--chart-axis": "rgb(255 255 255 / 0.45)",
} as CSSProperties;

function HojaGastado({ t, esMesActual, ritmo }: { t: Tablero; esMesActual: boolean; ritmo: DatosRitmo | null | undefined }) {
  const { totales, moneda } = t;
  const fmt = (n: number) => dinero(n, moneda);
  const nombre = nombreMes(t.mes, false).toLowerCase();
  const anteriorNombre = nombreMes(sumarMeses(t.mes, -1), false).toLowerCase();
  const [dia, setDia] = useState<number | null>(null);
  const valorDia = dia !== null && ritmo ? (ritmo.actual[dia - 1] ?? 0) : null;
  const anteriorDia = dia !== null && ritmo ? ritmo.anterior[Math.min(dia, ritmo.anterior.length) - 1] : undefined;

  return (
    <Hoja
      nombre="Gastado"
      fondo="linear-gradient(150deg, #2a8bff, #0055d4 70%, #0047b3)"
      etiqueta={`Gastado en ${nombre}: ${fmt(totales.gastadoCentavos)}. Ver análisis`}
      alTocar={() => navegar(hashDe("analisis", esMesActual ? {} : { ref: `${t.mes}-01` }))}
    >
      <h2 className={claseEtiqueta}>{dia !== null ? `Gastado al ${dia} de ${nombre}` : `Gastado en ${nombre}`}</h2>
      <NumeroAnimado
        valor={valorDia ?? totales.gastadoCentavos}
        formato={fmt}
        duracion={dia !== null ? 0 : 700}
        className={claseGrande}
        ajustar
      />
      {dia !== null ? (
        <p className="flex items-center gap-1.5 text-[14px] font-medium opacity-90 tabular">
          <span aria-hidden className="w-3.5 border-t-[2px] border-dashed border-white/70" />
          {anteriorDia !== undefined ? `${fmt(anteriorDia)} al ${dia} de ${anteriorNombre}` : `Sin datos de ${anteriorNombre}`}
        </p>
      ) : (
        <Comparacion t={t} esMesActual={esMesActual} />
      )}

      {ritmo === null ? null : (
        // La gráfica no abre Análisis: al pasar el dedo elige un día.
        <div className="pointer-events-auto mt-2" style={ritmoBlanco}>
          {ritmo ? (
            <Ritmo
              actual={ritmo.actual}
              anterior={ritmo.anterior}
              diasMes={ritmo.diasMes}
              hasta={ritmo.hasta}
              seleccionado={dia}
              alElegir={setDia}
              alto={52}
            />
          ) : (
            <Skeleton className="h-[52px] w-full rounded-lg bg-white/15" />
          )}
          <div className="mt-1 flex justify-between text-[11px] font-medium opacity-75 tabular">
            <span>1 {mesCorto(t.mes)}</span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="w-3 border-t-[2px] border-dashed border-white/70" /> {anteriorNombre}
            </span>
            <span>
              {ritmo?.diasMes ?? diasDelMes(t.mes)} {mesCorto(t.mes)}
            </span>
          </div>
        </div>
      )}

      <div className={clasePie}>
        <span className="min-w-0 break-words opacity-[0.92]">
          {esMesActual ? "Hoy" : "Por día"}{" "}
          <b className="whitespace-nowrap tabular">{fmt(esMesActual ? totales.gastadoHoyCentavos : Math.round(totales.gastadoCentavos / diasDelMes(t.mes)))}</b>
        </span>
        <span className="min-w-0 break-words text-right opacity-[0.92]">
          Entró <b className="whitespace-nowrap tabular">{dinero(totales.ingresadoCentavos, moneda)}</b>
        </span>
      </div>
    </Hoja>
  );
}

function HojaTienes({
  neto,
  dinero_,
  deuda,
  moneda,
  uso,
  noSuman,
}: {
  neto: number;
  dinero_: number;
  deuda: number;
  moneda: string;
  uso: number | null;
  noSuman: string[];
}) {
  const total = Math.max(1, dinero_ + deuda);
  return (
    <Hoja
      nombre="Lo que tienes"
      fondo="linear-gradient(150deg, #3a3a3e, #1c1c1e 75%)"
      etiqueta={`Lo que tienes: ${dinero(neto, moneda)}${noSuman.length ? `, ${faltan(noSuman)}` : ""}. Ver cuentas`}
      alTocar={() => navegar(hashDe("cuentas"))}
    >
      <h2 className={claseEtiqueta}>Lo que tienes</h2>
      <NumeroAnimado valor={neto} formato={(n) => dinero(n, moneda)} className={claseGrande} ajustar />
      <p className="text-[14px] leading-5 font-medium opacity-90">
        {deuda > 0 ? (
          <>
            <span className="tabular">{dinero(dinero_, moneda)}</span> en cuentas menos <span className="tabular">{dinero(deuda, moneda)}</span> que debes
          </>
        ) : (
          "Sin deudas en tus tarjetas"
        )}
      </p>
      {deuda > 0 || dinero_ > 0 ? (
        <div aria-hidden className="mt-3.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/20">
          <i className="block h-full rounded-full bg-[#30d158]" style={{ width: `${(Math.max(0, dinero_) / total) * 100}%` }} />
          <i className="block h-full rounded-full bg-[#ff6961]" style={{ width: `${(deuda / total) * 100}%` }} />
        </div>
      ) : null}
      <div className={clasePie}>
        <span className="min-w-0 break-words opacity-[0.92]">{uso !== null ? <>Crédito usado <b className="whitespace-nowrap tabular">{pct(uso)}</b></> : "Cuentas y tarjetas"}</span>
        <span className="flex min-w-0 items-end text-right opacity-[0.92]">
          {noSuman.length ? <span data-testid="faltan" className="min-w-0 break-words">{faltan(noSuman).replace(/^f/, "F")}</span> : "Ver"}
          <ChevronRight aria-hidden className="size-4 shrink-0" strokeWidth={2.6} />
        </span>
      </div>
    </Hoja>
  );
}

/** Con cuentas pero sin saldos dichos: el balance del mes y la invitación a decir cuánto tiene. */
/** Balance del mes: lo que entró menos lo gastado. Sin `mes` es el de hoy y pide los saldos; con `mes`, uno pasado. */
function HojaTienesVacia({ balance, moneda, mes }: { balance: number; moneda: string; mes?: string }) {
  return (
    <Hoja
      nombre="Balance"
      fondo="linear-gradient(150deg, #3a3a3e, #1c1c1e 75%)"
      etiqueta={mes ? `Balance de ${nombreMes(mes, false).toLowerCase()}. Ver análisis` : "¿Cuánto tienes? Ver cuentas"}
      alTocar={() => navegar(mes ? hashDe("analisis", { ref: `${mes}-01` }) : hashDe("cuentas"))}
    >
      <h2 className={claseEtiqueta}>{mes ? `Balance de ${nombreMes(mes, false).toLowerCase()}` : "Balance del mes"}</h2>
      <Ajustado como="span" className={claseGrande}>{dinero(balance, moneda, { signo: true })}</Ajustado>
      <p className="text-[14px] leading-5 font-medium opacity-90">Lo que entró menos lo que gastaste</p>
      <div className={clasePie}>
        <span className="min-w-0 break-words opacity-[0.92]">{mes ? "Ver el mes completo" : "¿Cuánto tienes?"}</span>
        <span className="flex items-center opacity-[0.92]">
          {mes ? "Análisis" : "Dímelo"} <ChevronRight aria-hidden className="size-4" strokeWidth={2.6} />
        </span>
      </div>
    </Hoja>
  );
}

// Fondo por nivel, del rojo de Sobregirado al azul de Optimizando.
const FONDO_SALUD: Record<NivelSalud, string> = {
  sobregirado: "linear-gradient(150deg, #ff7a45, #e8432f 70%, #cf2f2a)",
  en_riesgo: "linear-gradient(150deg, #ffad33, #f08a00 70%, #d97400)",
  vamos_bien: "linear-gradient(150deg, #e2b100, #c99400 70%, #b07f00)",
  excelente: "linear-gradient(150deg, #3fcf6a, #23a84b 70%, #1a8f3e)",
  optimizando: "linear-gradient(150deg, #2fc4e8, #0a9fe0 70%, #087fb8)",
};

function HojaSalud({ s }: { s: SaludFinanciera }) {
  const nivel = s.nivelSinAlertas ?? s.nivel;
  const titulo = NIVELES.find((n) => n.clave === nivel)?.titulo ?? s.titulo;
  return (
    <Hoja
      nombre="Salud financiera"
      fondo={nivel ? FONDO_SALUD[nivel] : "linear-gradient(150deg, #8e8e93, #636366)"}
      etiqueta={`Salud financiera: ${titulo}${s.puntaje !== null ? `, ${s.puntaje} de 100` : ""}. Ver más`}
      alTocar={() => navegar(hashDe("salud"))}
    >
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          <h2 className={claseEtiqueta}>Salud financiera</h2>
          <p className="mt-0.5 break-words hyphens-auto text-[30px] leading-9 font-bold tracking-[-0.02em] [@container(max-width:300px)]:text-[24px] [@container(max-width:300px)]:leading-8">{nivel ? titulo : "Sin calificar"}</p>
          <p className="text-[14px] font-medium opacity-90 tabular">
            {s.puntaje !== null ? `${s.puntaje} de 100` : s.ingresos.mensualCentavos === null ? "Dime tu ingreso" : "Me faltan datos"}
          </p>
        </div>
        <MedidorBlanco puntaje={s.puntaje} />
      </div>
      {s.alertas[0] ? <p className="mt-2 text-[14px] leading-5 font-medium opacity-90 text-pretty">{s.alertas[0]}</p> : null}
      <div className={clasePie}>
        {/* El consejo completo no cabe sin «…» (y estirarlo alargaba todas las tarjetas): aquí solo cuántos hay. */}
        <span className="min-w-0 break-words opacity-[0.92]">
          {s.consejos.length ? `${s.consejos.length} ${s.consejos.length === 1 ? "consejo" : "consejos"} para mejorar` : "Cómo vas este mes"}
        </span>
        <span className="flex shrink-0 items-center opacity-[0.92]">
          Ver <ChevronRight aria-hidden className="size-4" strokeWidth={2.6} />
        </span>
      </div>
    </Hoja>
  );
}

/** Semicírculo de cinco tramos en blanco, con aguja. */
function MedidorBlanco({ puntaje }: { puntaje: number | null }) {
  const r = 44;
  const cx = 60;
  const cy = 56;
  const punto = (a: number) => [cx + r * Math.cos(Math.PI * (1 - a)), cy - r * Math.sin(Math.PI * (1 - a))] as const;
  const arco = (a0: number, a1: number) => {
    const [x0, y0] = punto(a0);
    const [x1, y1] = punto(a1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const a = Math.PI * (1 - (puntaje ?? 0) / 100);
  return (
    <svg viewBox="0 0 120 66" aria-hidden className="mt-1.5 h-[51px] w-[92px] shrink-0 [@container(max-width:300px)]:h-10 [@container(max-width:300px)]:w-[72px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={arco(i / 5 + 0.012, (i + 1) / 5 - 0.012)}
          stroke={`rgb(255 255 255 / ${0.35 + i * 0.12})`}
          strokeWidth={9}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {puntaje !== null ? (
        <>
          <line x1={cx} y1={cy} x2={cx + (r - 14) * Math.cos(a)} y2={cy - (r - 14) * Math.sin(a)} stroke="#fff" strokeWidth={3.5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={5} fill="#fff" />
        </>
      ) : null}
    </svg>
  );
}

function Comparacion({ t, esMesActual }: { t: Tablero; esMesActual: boolean }) {
  const actual = t.totales.gastadoCentavos;
  const base = esMesActual ? t.totales.gastadoMesAnteriorMismaFechaCentavos : t.totales.gastadoMesAnteriorCentavos;
  const anterior = sumarMeses(t.mes, -1);
  const referencia = esMesActual ? `al ${diaMismoMesAnterior(t.hoy)}` : `en ${nombreMes(anterior, false).toLowerCase()}`;
  if (base <= 0) return <p className="text-[14px] font-medium opacity-90">Sin gastos {referencia} para comparar</p>;
  const cambio = (actual - base) / base;
  const igual = Math.abs(cambio) < 0.005;
  const mas = cambio > 0;
  const Icono = igual ? Minus : mas ? ArrowUpRight : ArrowDownRight;
  const corta = referencia.replace(/ de (\p{L}{3})\p{L}*/u, " $1");
  return (
    <p className="flex items-center gap-1 text-[14px] font-medium opacity-[0.92]">
      <Icono className="size-[15px] shrink-0" strokeWidth={2.6} aria-hidden />
      {/* En 320 px el mes va corto («al 6 sep») para que la frase se lea completa. */}
      {(corta === referencia ? [referencia] : [referencia, corta]).map((r, i, todas) => (
        <span key={r} className={cn("min-w-0 truncate", todas.length > 1 && (i ? "min-[360px]:hidden" : "max-[359px]:hidden"))}>
          {igual ? `Igual que ${r}` : `${pct(Math.abs(cambio))} ${mas ? "más" : "menos"} que ${r}`}
        </span>
      ))}
    </p>
  );
}

export function diasDelMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(a ?? 1970, m ?? 1, 0).getDate();
}

/** "6 de septiembre" a partir de hoy = 2026-10-06 (o el último día si el mes anterior es más corto). */
function diaMismoMesAnterior(hoy: string) {
  const f = aFecha(hoy);
  const dia = f.getDate();
  const previo = new Date(f.getFullYear(), f.getMonth() - 1, 1, 12);
  const ultimo = new Date(previo.getFullYear(), previo.getMonth() + 1, 0).getDate();
  previo.setDate(Math.min(dia, ultimo));
  return diaDeMes(hoyIso(previo));
}

