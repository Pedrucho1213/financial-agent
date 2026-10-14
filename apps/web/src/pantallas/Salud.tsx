import { AlertTriangle, CalendarDays, Coins, CreditCard, Flame, Info, Lightbulb, PiggyBank, Receipt, Repeat, Scale, ShoppingBag, ShoppingCart, Sparkles, Store, UtensilsCrossed } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Medidor } from "../components/salud/Medidor";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { Grupo, TituloSeccion } from "../components/ui/lista";
import { Skeleton } from "../components/ui/skeleton";
import { useYo } from "../lib/consultas";
import { ErrorApi, mensajeDeError } from "../lib/api";
import { dineroCorto } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { volver } from "../lib/ruta";
import { colorDeNivel, type ComparacionSalud, type CuriosidadSalud, nivelDePuntos, type PilarSalud, type SaludFinanciera, saludParaMostrar, useSalud } from "../lib/salud";
import { cn } from "../lib/utils";

// #salud: la salud financiera. Arriba el medidor con el nivel y por qué; luego lo que lo explica (los cinco
// pilares), qué hacer (consejos con cuánto ahorra), cómo se compara con México y datos curiosos. Todo lo calcula
// el servidor.

const ICONO_PILAR: Record<PilarSalud["clave"], typeof Scale> = {
  margen: Scale,
  colchon: PiggyBank,
  deuda: CreditCard,
  gustos: ShoppingBag,
  compromisos: Receipt,
};

const ICONO_CURIOSIDAD: Record<CuriosidadSalud["clave"], { icono: typeof Scale; color: string }> = {
  favorito: { icono: Store, color: "var(--serie-1)" },
  comer_fuera_dias: { icono: UtensilsCrossed, color: "var(--serie-2)" },
  dia_fuerte: { icono: CalendarDays, color: "var(--serie-4)" },
  salario_minimo: { icono: Coins, color: "var(--serie-5)" },
  mas_grande: { icono: ShoppingCart, color: "var(--serie-7)" },
  fijos_al_anio: { icono: Repeat, color: "var(--serie-6)" },
  hormiga: { icono: Sparkles, color: "var(--serie-3)" },
  racha: { icono: Flame, color: "var(--serie-2)" },
};

export function Salud() {
  const salud = useSalud();
  const datos = saludParaMostrar(salud);
  const moneda = useYo().data?.moneda ?? "MXN";
  return (
    <Pantalla titulo="Salud financiera" atras={{ etiqueta: "Inicio", alTocar: () => volver("inicio") }} alRefrescar={() => salud.refetch()}>
      {datos ? (
        <Contenido s={datos} moneda={moneda} />
      ) : salud.isError ? (
        <div className="mt-3 rounded-[20px] bg-card px-6 py-10 text-center">
          <p className="text-[17px] font-semibold">No pudimos cargar tu salud financiera</p>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {salud.error instanceof ErrorApi && salud.error.estado === 404 ? "Esta sección todavía no está abierta para tu cuenta." : mensajeDeError(salud.error)}
          </p>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => void salud.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <div className="space-y-3 pt-3" aria-busy>
          <Skeleton className="h-[260px] rounded-[20px]" />
          <Skeleton className="h-[220px] rounded-[20px]" />
        </div>
      )}
    </Pantalla>
  );
}

function Contenido({ s, moneda }: { s: SaludFinanciera; moneda: string }) {
  const color = colorDeNivel(s.nivel);
  const rubros = s.rubros.filter((r) => r.tuProporcion > 0 || r.mexicoProporcion >= 0.05);
  return (
    <div className="space-y-8 pt-3 pb-6">
      <section aria-label="Tu nivel" className="rounded-[20px] bg-card px-4 pt-5 pb-4 text-center">
        <Medidor puntaje={s.puntaje} nivel={s.nivelSinAlertas ?? s.nivel} className="mx-auto" />
        <p data-testid="titulo-salud" className="-mt-1 text-[28px] leading-tight font-bold tracking-[-0.02em]" style={{ color: s.nivel ? color : undefined }}>
          {s.titulo}
        </p>
        {/* Con alertas, el resumen ya dice dónde estaría sin ellas. */}
        {s.puntaje !== null && !s.alertas.length ? <p className="text-[15px] text-muted-foreground tabular">{s.puntaje} de 100</p> : null}
        <p data-testid="resumen-salud" className="mx-auto mt-2 max-w-[34ch] text-[15px] leading-snug text-pretty">
          {s.resumen}
        </p>

        {s.alertas.length ? (
          <ul className="mt-4 space-y-2 text-left">
            {s.alertas.map((a) => (
              <li key={a} data-alerta className="flex items-start gap-2.5 rounded-[14px] bg-negative/10 px-3 py-2.5 text-[15px] leading-snug">
                <AlertTriangle aria-hidden className="mt-0.5 size-[18px] shrink-0 text-negative" strokeWidth={2.2} />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {s.faltan.length ? (
          <ul className="mt-3 space-y-2 text-left">
            {s.faltan.map((f) => (
              <li key={f} data-falta className="flex items-start gap-2.5 rounded-[14px] bg-fill px-3 py-2.5 text-[15px] leading-snug">
                <Info aria-hidden className="mt-0.5 size-[18px] shrink-0 text-tint" strokeWidth={2.2} />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-label="Qué lo explica">
        <TituloSeccion>Qué lo explica</TituloSeccion>
        <div className="overflow-hidden rounded-[20px] bg-card">
          <ul>
            {s.pilares.map((p) => (
              <FilaPilar key={p.clave} p={p} />
            ))}
          </ul>
        </div>
      </section>

      {s.consejos.length ? (
        <section aria-label="Qué hacer">
          <TituloSeccion>Qué hacer</TituloSeccion>
          <div className="overflow-hidden rounded-[20px] bg-card">
            <ul>
              {s.consejos.map((c, i) => (
                <li key={i} data-consejo className={cn("relative flex gap-3 px-4 py-3", separador)}>
                  <span aria-hidden className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-positive/15 text-positive">
                    <Lightbulb className="size-[17px]" strokeWidth={2.3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-snug text-pretty">{c.texto}</p>
                    {c.ahorroMensualCentavos ? (
                      <p className="mt-0.5 text-[13px] font-semibold text-positive tabular">Ahorras unos {dineroCorto(c.ahorroMensualCentavos, moneda)} al mes</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {s.mexico.length ? (
        <section aria-label="Tú y México">
          <TituloSeccion>Tú y México</TituloSeccion>
          <div className="carrusel -mx-4 scroll-px-4 gap-3 px-4 pb-1">
            {s.mexico.map((c) => (
              <TarjetaMexico key={c.clave} c={c} />
            ))}
          </div>
        </section>
      ) : null}

      {s.curiosidades?.length ? (
        <section aria-label="Datos curiosos">
          <TituloSeccion>Datos curiosos</TituloSeccion>
          <div className="overflow-hidden rounded-[20px] bg-card">
            <ul>
              {s.curiosidades.map((c) => {
                const { icono: Icono, color } = ICONO_CURIOSIDAD[c.clave] ?? { icono: Sparkles, color: "var(--serie-1)" };
                return (
                  <li key={c.clave} data-curiosidad={c.clave} className={cn("relative flex gap-3 px-4 py-3", separador)}>
                    <span
                      aria-hidden
                      className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px]"
                      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
                    >
                      <Icono className="size-[17px]" strokeWidth={2.3} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[17px] leading-tight font-semibold tabular">{c.dato}</p>
                      <p className="mt-0.5 text-[15px] leading-snug text-pretty text-muted-foreground">{c.texto}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {rubros.length ? (
        <Grupo
          aria-label="En qué se te va"
          titulo="En qué se te va, contra un hogar en México"
          pie={s.base.pocosDatos ? `Con ${s.base.dias} ${s.base.dias === 1 ? "día" : "días"} de registros: se irá afinando.` : undefined}
        >
          <ul className="space-y-3 px-4 py-3.5">
            {rubros.map((r) => (
              <li key={r.clave} data-rubro={r.clave}>
                <div className="flex items-baseline justify-between gap-3 text-[15px]">
                  <span className="truncate">{r.nombre}</span>
                  <span className="shrink-0 text-[13px] text-muted-foreground tabular">
                    Tú {Math.round(r.tuProporcion * 100)}% · México {Math.round(r.mexicoProporcion * 100)}%
                  </span>
                </div>
                <div className="mt-1.5 space-y-1" aria-hidden>
                  <div className="h-2 overflow-hidden rounded-full bg-fill">
                    <div className="h-full origin-left animate-crecer-x rounded-full bg-tint" style={{ width: `${Math.min(100, r.tuProporcion * 100)}%` }} />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-fill">
                    <div className="h-full rounded-full bg-[var(--gray-icon)]/60" style={{ width: `${Math.min(100, r.mexicoProporcion * 100)}%` }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Grupo>
      ) : null}

      <footer className="space-y-1 px-4 text-center text-[12px] leading-snug text-muted-foreground">
        <p>
          Con datos de{" "}
          {s.fuentes.map((f, i) => (
            <span key={f.url}>
              {i ? ", " : ""}
              <a href={f.url} target="_blank" rel="noreferrer" className="underline decoration-from-font underline-offset-2">
                {f.nombre}
              </a>
            </span>
          ))}
          .
        </p>
        <p>Es una guía con tus registros, no asesoría financiera.</p>
      </footer>
    </div>
  );
}

const separador =
  "[&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-14 [&:not(:first-child)]:before:h-[0.5px] [&:not(:first-child)]:before:bg-separator [&:not(:first-child)]:before:content-['']";

/** Un pilar: su número, una barrita de 0 a 100 del color de su nivel y, al tocarlo, cómo subirlo. */
function FilaPilar({ p }: { p: PilarSalud }) {
  const [abierto, setAbierto] = useState(false);
  const Icono = ICONO_PILAR[p.clave];
  const color = p.puntos !== null ? colorDeNivel(nivelDePuntos(p.puntos)) : "var(--gray-icon)";
  return (
    <li data-pilar={p.clave} className={cn("relative", separador)}>
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => {
          haptico();
          setAbierto((a) => !a);
        }}
        className="fila-presionable flex w-full gap-3 px-4 py-3 text-left"
      >
        <span aria-hidden className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px]" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
          <Icono className="size-[17px]" strokeWidth={2.3} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[17px] font-semibold">{p.nombre}</span>
            <span className="shrink-0 text-[15px] text-muted-foreground tabular">{p.valor ?? "Sin datos"}</span>
          </span>
          <span
            className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-fill"
            role="meter"
            aria-label={`${p.nombre}: ${p.puntos ?? "sin calificar"}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={p.puntos ?? undefined}
          >
            {p.puntos !== null ? <span className="block h-full origin-left animate-crecer-x rounded-full" style={{ width: `${Math.max(4, p.puntos)}%`, background: color }} /> : null}
          </span>
          <span className="mt-1.5 block text-[15px] leading-snug text-muted-foreground text-pretty">{p.frase}</span>
          {abierto ? <span className="mt-1 block text-[15px] leading-snug text-pretty text-tint">{p.consejo}</span> : null}
        </span>
      </button>
    </li>
  );
}

const ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Una tarjeta de "Tú y México": tu número, el de México y la frase. La de ingreso trae la barra de deciles. */
function TarjetaMexico({ c }: { c: ComparacionSalud }) {
  let extra: ReactNode = null;
  if (c.clave === "ingreso" && c.decil) {
    extra = (
      <div className="mt-3" aria-hidden>
        <div className="flex gap-[3px]">
          {ROMANOS.map((r, i) => (
            <span key={r} className={cn("h-2 flex-1 rounded-full", i + 1 === c.decil ? "bg-tint" : i + 1 < c.decil! ? "bg-tint/35" : "bg-fill")} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>I</span>
          <span>V</span>
          <span>X</span>
        </div>
      </div>
    );
  }
  return (
    <article data-mexico={c.clave} className="flex w-[78%] max-w-[300px] shrink-0 snap-start flex-col rounded-[20px] bg-card p-4">
      <h3 className="text-[13px] font-semibold text-muted-foreground uppercase">{c.titulo}</h3>
      <p className="mt-1 text-[24px] leading-tight font-bold tracking-[-0.01em] tabular">{c.tu}</p>
      <p className="text-[13px] text-muted-foreground">{c.mexico}</p>
      {extra}
      <p className="mt-3 text-[15px] leading-snug text-pretty">{c.frase}</p>
    </article>
  );
}
