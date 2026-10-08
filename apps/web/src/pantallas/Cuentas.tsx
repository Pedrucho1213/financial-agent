import { Archive, ArchiveRestore, ArrowLeftRight, Lightbulb, List, Mic, Pencil, Plus, Tag } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Anillos } from "../components/Anillos";
import { HojaCuenta } from "../components/cuentas/HojaCuenta";
import { HojaMover, type InicioMover } from "../components/cuentas/HojaMover";
import { IconoCuenta } from "../components/cuentas/IconoCuenta";
import { Pantalla } from "../components/Pantalla";
import { Button } from "../components/ui/button";
import { FilaBoton, Grupo, TituloSeccion } from "../components/ui/lista";
import { Skeleton } from "../components/ui/skeleton";
import { ErrorApi, mensajeDeError } from "../lib/api";
import { IconoCategoria } from "../lib/categorias";
import { useEnLinea } from "../lib/conexion";
import { abrirDetalle, useYo } from "../lib/consultas";
import { useCuenta, useCuentas, useGuardarCuenta } from "../lib/cuentas";
import { diaCorto, dinero, haceCuanto, hoyIso, pct } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { hashDe, navegar, volver } from "../lib/ruta";
import {
  colorUso,
  diasEntreFechas,
  enCuantosDias,
  lineaCuenta,
  NOMBRE_TIPO,
  proximaFecha,
  repartoDinero,
  separarCuentas,
  usoCredito,
} from "../lib/saldos";
import type { CuentaConMes, Cuentas as CuentasApi, EstadoCuenta, MovimientoApp, TipoCuenta } from "../lib/tipos";
import { cn } from "../lib/utils";
import { tituloDe } from "./Movimientos";

// Colores del reparto: siguen a la cuenta (su lugar en la lista del servidor), no a su tamaño.
const COLORES = ["var(--serie-1)", "var(--serie-5)", "var(--serie-4)", "var(--serie-3)", "var(--serie-6)", "var(--serie-7)"];

const sinServidor = (e: unknown) => e instanceof ErrorApi && e.estado === 404;

/** #cuentas: cuánto tiene en cada cuenta, cuánto debe en cada tarjeta y lo que suma todo. */
export function Cuentas({ params }: { params: URLSearchParams }) {
  const yo = useYo();
  const moneda = yo.data?.moneda ?? "MXN";
  const hoy = yo.data?.hoy ?? hoyIso();
  const conArchivadas = params.get("archivadas") === "1";
  const cuentas = useCuentas({ archivadas: conArchivadas });
  const enLinea = useEnLinea();
  const [hojaCuenta, setHojaCuenta] = useState<{ nueva: TipoCuenta } | null>(null);
  const [hojaMover, setHojaMover] = useState<InicioMover | null>(null);

  const datos = cuentas.data;
  const { dinero: deDinero, tarjetas, archivadas } = separarCuentas(datos?.cuentas ?? []);
  const vacio = !!datos && deDinero.length + tarjetas.length === 0;

  return (
    <Pantalla
      titulo="Cuentas y tarjetas"
      tituloCompacto="Cuentas"
      atras={{ etiqueta: "Inicio", alTocar: () => volver("inicio") }}
      derecha={
        datos && !vacio ? (
          <Button variant="gray" size="icon-sm" aria-label="Mover dinero" disabled={!enLinea} onClick={() => setHojaMover({})}>
            <ArrowLeftRight strokeWidth={2.25} />
          </Button>
        ) : null
      }
      alRefrescar={() => cuentas.refetch()}
    >
      {sinServidor(cuentas.error) ? (
        <Aviso titulo="Aún no está en tu servidor" texto="Las cuentas y tarjetas llegan con la próxima actualización de la Mac." />
      ) : cuentas.isPending ? (
        <Esqueleto />
      ) : cuentas.isError && !datos ? (
        <Aviso titulo="No pudimos cargar tus cuentas" texto={mensajeDeError(cuentas.error)}>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => cuentas.refetch()}>
            Reintentar
          </Button>
        </Aviso>
      ) : vacio ? (
        <Aviso
          titulo="Todavía no tienes cuentas"
          texto="Dime cuánto tienes y en dónde, y dejo de adivinar tu balance: «tengo 20 mil en BBVA y debo 3 mil en la Nu»."
        >
          <Button variant="tinted" size="sm" className="mt-4" disabled={!enLinea} onClick={() => setHojaCuenta({ nueva: "debito" })}>
            Agregar cuenta
          </Button>
        </Aviso>
      ) : datos ? (
        <div className="space-y-8 pt-2 pb-4">
          <Resumen datos={datos} moneda={moneda} />
          {datos.observacion ? (
            <p data-testid="observacion" className="flex items-start gap-3 rounded-[20px] bg-card p-4 text-[15px] leading-snug">
              <Lightbulb aria-hidden className="mt-0.5 size-[18px] shrink-0 text-orange" />
              {datos.observacion}
            </p>
          ) : null}

          {deDinero.length ? (
            <section>
              <TituloSeccion>Cuentas</TituloSeccion>
              <Grupo>
                {deDinero.map((c) => (
                  <FilaCuenta key={c.id} c={c} moneda={moneda} hoy={hoy} />
                ))}
              </Grupo>
            </section>
          ) : null}

          {tarjetas.length ? (
            <section>
              <TituloSeccion>Tarjetas de crédito</TituloSeccion>
              <Grupo>
                {tarjetas.map((c) => (
                  <FilaCuenta key={c.id} c={c} moneda={moneda} hoy={hoy} />
                ))}
              </Grupo>
            </section>
          ) : null}

          <Grupo
            pie={
              <span className="flex items-start gap-1.5">
                <Mic className="mt-0.5 size-3.5 shrink-0" /> También por voz: «pasé 2 mil de BBVA a Nu», «pagué la Nu», «saqué 500 del cajero».
              </span>
            }
          >
            <FilaBoton
              sangria="4rem"
              icono={<IconoAccion><Plus className="size-5" strokeWidth={2.5} /></IconoAccion>}
              titulo={<span className="text-tint">Agregar cuenta o tarjeta</span>}
              disabled={!enLinea}
              onClick={() => setHojaCuenta({ nueva: "debito" })}
            />
            <FilaBoton
              sangria="4rem"
              icono={<IconoAccion><ArrowLeftRight className="size-[18px]" strokeWidth={2.4} /></IconoAccion>}
              titulo={<span className="text-tint">Mover dinero</span>}
              disabled={!enLinea}
              onClick={() => setHojaMover({})}
            />
            <FilaBoton
              sangria="4rem"
              icono={<IconoAccion><Tag className="size-[18px]" strokeWidth={2.4} /></IconoAccion>}
              titulo="Etiquetas"
              chevron
              onClick={() => navegar(hashDe("etiquetas"))}
            />
          </Grupo>

          {conArchivadas ? (
            archivadas.length ? (
              <section>
                <TituloSeccion>Archivadas</TituloSeccion>
                <Grupo pie="No se suman ni aparecen al elegir una cuenta. Sus movimientos se quedan.">
                  {archivadas.map((c) => (
                    <FilaCuenta key={c.id} c={c} moneda={moneda} hoy={hoy} />
                  ))}
                </Grupo>
              </section>
            ) : (
              <p className="px-4 text-center text-[15px] text-muted-foreground">No tienes cuentas archivadas.</p>
            )
          ) : (
            <div className="flex justify-center">
              <Button variant="plain" size="text" onClick={() => navegar(hashDe("cuentas", { archivadas: "1" }), { reemplazar: true })}>
                Ver archivadas
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <HojaCuenta valor={hojaCuenta} moneda={moneda} alCerrar={() => setHojaCuenta(null)} />
      <HojaMover valor={hojaMover} moneda={moneda} alCerrar={() => setHojaMover(null)} />
    </Pantalla>
  );
}

function IconoAccion({ children }: { children: ReactNode }) {
  return <span className="flex size-9 shrink-0 items-center justify-center text-tint">{children}</span>;
}

/** Lo que suma todo: lo que tiene menos lo que debe, dónde está su dinero y cuánto crédito usa. */
function Resumen({ datos, moneda }: { datos: CuentasApi; moneda: string }) {
  const t = datos.totales;
  const conocido = t.cuentasConSaldo > 0 || t.tarjetasConDeuda > 0;
  const colores = new Map(datos.cuentas.filter((c) => !c.esCredito).map((c, i) => [c.id, COLORES[i % COLORES.length]!]));
  const porciones = repartoDinero(datos.cuentas);
  const usado = t.limiteCreditoCentavos > 0 ? Math.max(0, t.limiteCreditoCentavos - t.disponibleCreditoCentavos) / t.limiteCreditoCentavos : null;

  return (
    <section aria-label="Lo que tienes" className="rounded-[20px] bg-card p-4">
      <h2 className="text-[15px] font-medium text-muted-foreground">Lo que tienes</h2>
      {conocido ? (
        <p
          data-testid="neto"
          className={cn("mt-0.5 truncate text-[40px] leading-[1.15] font-bold tracking-[-0.025em] tabular max-[379px]:text-[32px]", t.netoCentavos < 0 && "text-negative")}
        >
          {dinero(t.netoCentavos, moneda)}
        </p>
      ) : (
        <p className="mt-1 text-[22px] leading-7 font-bold tracking-tight">Todavía no sé cuánto tienes</p>
      )}
      <p className="mt-1 text-[15px] text-muted-foreground">
        {conocido ? (
          <>
            <span className="whitespace-nowrap">{dinero(t.dineroCentavos, moneda)} en cuentas</span>
            {t.deudaCentavos > 0 ? (
              <>
                {" "}menos <span className="whitespace-nowrap">{dinero(t.deudaCentavos, moneda)} que debes</span>
              </>
            ) : null}
          </>
        ) : (
          "Toca una cuenta para decirme su saldo, o díselo al Atajo."
        )}
      </p>

      {porciones.length > 1 ? (
        <div className="mt-4 pt-3 hairline-t">
          <p className="text-[13px] font-medium text-muted-foreground">Dónde está tu dinero</p>
          <div className="mt-2 flex h-3 origin-left animate-crecer-x gap-[2px] overflow-hidden rounded-full" role="img" aria-label={porciones.map((p) => `${p.nombre}: ${pct(p.parte)}`).join(", ")}>
            {porciones.map((p) => (
              <span
                key={p.id}
                data-porcion={p.nombre}
                className="h-full"
                style={{ flexGrow: p.parte, flexBasis: 0, background: colores.get(p.id) ?? "var(--serie-otros)" }}
              />
            ))}
          </div>
          <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {porciones.map((p) => (
              <li key={p.id} className="flex min-w-0 items-center gap-1.5 text-[13px]">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: colores.get(p.id) ?? "var(--serie-otros)" }} />
                <span className="min-w-0 truncate">{p.nombre}</span>
                <span className="ml-auto shrink-0 text-muted-foreground tabular">{pct(p.parte)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {usado !== null ? (
        <div className="mt-4 pt-3 hairline-t" data-testid="credito-total">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-medium text-muted-foreground">Crédito usado</span>
            <span className="font-semibold tabular" style={{ color: colorUso(usado) }}>
              {pct(usado)}
            </span>
          </div>
          <BarraUso uso={usado} className="mt-1.5" />
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Te quedan <span className="whitespace-nowrap tabular">{dinero(t.disponibleCreditoCentavos, moneda)}</span> de{" "}
            <span className="whitespace-nowrap tabular">{dinero(t.limiteCreditoCentavos, moneda)}</span>
          </p>
        </div>
      ) : null}

      {t.sinSaldo.length ? (
        <p className="mt-3 pt-3 text-[13px] leading-snug text-muted-foreground hairline-t" data-testid="sin-saldo">
          No sé cuánto hay en {enLista(t.sinSaldo)}: no {t.sinSaldo.length === 1 ? "entra" : "entran"} en la suma.
        </p>
      ) : null}
    </section>
  );
}

function enLista(nombres: string[]) {
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

export function BarraUso({ uso, className }: { uso: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-fill", className)}>
      <div
        className="h-full origin-left animate-crecer-x rounded-full"
        style={{ width: `${Math.min(100, Math.max(uso > 0 ? 3 : 0, uso * 100))}%`, background: colorUso(uso) }}
      />
    </div>
  );
}

function FilaCuenta({ c, moneda, hoy }: { c: CuentaConMes; moneda: string; hoy: string }) {
  const uso = c.esCredito ? usoCredito(c) : null;
  const pago = c.esCredito && c.diaPago && c.deudaCentavos !== null && c.deudaCentavos > 0 ? proximaFecha(c.diaPago, hoy) : null;
  let valor: ReactNode = null;
  if (c.esCredito && c.deudaCentavos !== null) {
    valor = (
      <span className="block text-right">
        <span className="block font-medium text-foreground tabular">{dinero(Math.max(0, c.deudaCentavos), moneda)}</span>
        <span className="block text-[13px]">{c.deudaCentavos > 0 ? "debes" : "sin deuda"}</span>
      </span>
    );
  } else if (!c.esCredito && c.saldoCentavos !== null) {
    valor = <span className={cn("font-medium tabular", c.saldoCentavos < 0 ? "text-negative" : "text-foreground")}>{dinero(c.saldoCentavos, moneda)}</span>;
  }
  return (
    <FilaBoton
      sangria="4rem"
      data-cuenta={c.nombre}
      onClick={() => navegar(hashDe("cuenta", { id: c.id }))}
      aria-label={`${c.nombre}, ${lineaCuenta(c, moneda)}`}
    >
      <IconoCuenta tipo={c.tipo} />
      <div className="min-w-0 flex-1 py-2.5">
        <div className="truncate">{c.nombre}</div>
        <div className={cn("text-[15px] leading-snug", c.conocido ? "text-muted-foreground" : "text-placeholder")}>{lineaCuenta(c, moneda)}</div>
        {uso !== null ? <BarraUso uso={uso} className="mt-1.5 max-w-[14rem]" /> : null}
        {pago ? (
          <div className={cn("mt-1 text-[13px]", diasEntreFechas(hoy, pago) > 3 ? "text-muted-foreground" : "font-medium text-orange")}>
            Pagar {enCuantosDias(pago, hoy)}
          </div>
        ) : null}
      </div>
      {valor ? <div className="shrink-0 text-muted-foreground">{valor}</div> : null}
    </FilaBoton>
  );
}

function Aviso({ titulo, texto, children }: { titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="mt-6 rounded-[20px] bg-card px-6 py-10 text-center">
      <p className="text-[17px] font-semibold">{titulo}</p>
      <p className="mt-1 text-[15px] text-balance text-muted-foreground">{texto}</p>
      {children}
    </div>
  );
}

function Esqueleto() {
  return (
    <div aria-busy className="space-y-8 pt-2">
      <Skeleton className="h-[190px] w-full rounded-[20px] bg-card" />
      <Skeleton className="h-[140px] w-full rounded-[20px] bg-card" />
    </div>
  );
}

// ------------------------------------------------------------------ Una cuenta

/** #cuenta?id=: el saldo, el uso de la tarjeta, sus fechas y lo último que se movió en ella. */
export function Cuenta({ params }: { params: URLSearchParams }) {
  const id = params.get("id");
  const yo = useYo();
  const moneda = yo.data?.moneda ?? "MXN";
  const hoy = yo.data?.hoy ?? hoyIso();
  const consulta = useCuenta(id);
  const lista = useCuentas();
  const guardar = useGuardarCuenta();
  const enLinea = useEnLinea();
  const [hojaCuenta, setHojaCuenta] = useState<EstadoCuenta | null>(null);
  const [hojaMover, setHojaMover] = useState<InicioMover | null>(null);

  const c = consulta.data?.cuenta;
  const mes = lista.data?.cuentas.find((x) => x.id === id)?.mes;

  const archivar = async (archivada: boolean) => {
    if (!c) return;
    try {
      await guardar.mutateAsync({ id: c.id, datos: { archivada } });
      haptico();
      if (archivada) {
        toast.success(`Archivé ${c.nombre}`, {
          description: "Ya no se suma ni aparece al elegir cuenta.",
          action: { label: "Deshacer", onClick: () => guardar.mutate({ id: c.id, datos: { archivada: false } }) },
        });
        volver("inicio");
      } else toast.success(`${c.nombre} vuelve a tus cuentas`);
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  return (
    <Pantalla
      titulo={c?.nombre ?? "Cuenta"}
      encima={c ? `${NOMBRE_TIPO[c.tipo]}${c.institucion && c.institucion !== c.nombre ? ` · ${c.institucion}` : ""}${c.archivada ? " · archivada" : ""}` : undefined}
      atras={{ etiqueta: "Cuentas", alTocar: () => volver("inicio") }}
      derecha={
        c ? (
          <Button variant="gray" size="icon-sm" aria-label="Editar cuenta" disabled={!enLinea} onClick={() => setHojaCuenta(c)}>
            <Pencil strokeWidth={2.25} />
          </Button>
        ) : null
      }
      alRefrescar={() => Promise.all([consulta.refetch(), lista.refetch()])}
    >
      {!id || (consulta.error instanceof ErrorApi && (consulta.error.estado === 404 || consulta.error.estado === 400)) ? (
        <Aviso titulo="No encontré esa cuenta" texto="Pudo haberse borrado o el enlace es de otra cuenta.">
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => navegar(hashDe("cuentas"), { reemplazar: true })}>
            Ver mis cuentas
          </Button>
        </Aviso>
      ) : consulta.isPending ? (
        <Esqueleto />
      ) : consulta.isError && !c ? (
        <Aviso titulo="No pudimos cargar la cuenta" texto={mensajeDeError(consulta.error)}>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => consulta.refetch()}>
            Reintentar
          </Button>
        </Aviso>
      ) : c ? (
        <div className="space-y-8 pt-2 pb-4">
          {c.esCredito ? <HeroTarjeta c={c} moneda={moneda} hoy={hoy} alDecir={() => setHojaCuenta(c)} /> : <HeroCuenta c={c} moneda={moneda} mes={mes} alDecir={() => setHojaCuenta(c)} />}

          <Grupo>
            {c.esCredito ? (
              <FilaBoton
                sangria="4rem"
                icono={<IconoAccion><ArrowLeftRight className="size-[18px]" strokeWidth={2.4} /></IconoAccion>}
                titulo={<span className="text-tint">Pagar o abonar</span>}
                disabled={!enLinea || c.archivada}
                onClick={() => setHojaMover({ tipo: "pago_tarjeta", hacia: c.id })}
              />
            ) : (
              <FilaBoton
                sangria="4rem"
                icono={<IconoAccion><ArrowLeftRight className="size-[18px]" strokeWidth={2.4} /></IconoAccion>}
                titulo={<span className="text-tint">Mover dinero</span>}
                disabled={!enLinea || c.archivada}
                onClick={() => setHojaMover({ tipo: "transferencia", desde: c.id })}
              />
            )}
            <FilaBoton
              sangria="4rem"
              icono={<IconoAccion><List className="size-[18px]" strokeWidth={2.4} /></IconoAccion>}
              titulo="Movimientos"
              valor={consulta.data?.totalMovimientos ? <span className="tabular">{consulta.data.totalMovimientos}</span> : undefined}
              chevron
              onClick={() => navegar(hashDe("movimientos", { cuenta: c.id, mes: "todo" }))}
            />
          </Grupo>

          <Recientes movimientos={consulta.data?.movimientos ?? []} cuentaId={c.id} moneda={moneda} />

          <Grupo pie={c.archivada ? undefined : "Archivarla la quita de la suma y de las listas. Sus movimientos se quedan."}>
            <FilaBoton
              className="justify-center"
              disabled={!enLinea || guardar.isPending}
              onClick={() => void archivar(!c.archivada)}
            >
              {c.archivada ? <ArchiveRestore className="size-[18px] text-tint" /> : <Archive className="size-[18px] text-destructive" />}
              <span className={c.archivada ? "text-tint" : "text-destructive"}>{c.archivada ? "Volver a mostrar" : "Archivar cuenta"}</span>
            </FilaBoton>
          </Grupo>
        </div>
      ) : null}

      <HojaCuenta valor={hojaCuenta} moneda={moneda} alCerrar={() => setHojaCuenta(null)} />
      <HojaMover valor={hojaMover} moneda={moneda} alCerrar={() => setHojaMover(null)} />
    </Pantalla>
  );
}

function HeroCuenta({
  c,
  moneda,
  mes,
  alDecir,
}: {
  c: EstadoCuenta;
  moneda: string;
  mes?: { entradaCentavos: number; salidaCentavos: number };
  alDecir: () => void;
}) {
  return (
    <section aria-label="Saldo" className="rounded-[20px] bg-card p-4">
      <h2 className="text-[15px] font-medium text-muted-foreground">Tienes</h2>
      {c.saldoCentavos !== null ? (
        <>
          <p
            data-testid="saldo"
            className={cn("mt-0.5 truncate text-[40px] leading-[1.15] font-bold tracking-[-0.025em] tabular max-[379px]:text-[32px]", c.saldoCentavos < 0 && "text-negative")}
          >
            {dinero(c.saldoCentavos, moneda)}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {c.saldoEn ? `Me lo dijiste ${haceCuanto(c.saldoEn)}; desde ahí sumo y resto lo que anotas con ${c.nombre}.` : null}
            {c.saldoCentavos < 0 ? " Quedó en negativo: seguro cambió, dime cuánto hay." : null}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-[22px] leading-7 font-bold tracking-tight">No sé cuánto hay</p>
          <Button variant="tinted" size="sm" className="mt-3" onClick={alDecir}>
            Decir cuánto hay
          </Button>
        </>
      )}
      {mes && (mes.entradaCentavos || mes.salidaCentavos) ? (
        <div className="mt-3 grid grid-cols-2 gap-3 pt-3 hairline-t">
          <Dato etiqueta="Entró este mes" valor={`+${dinero(mes.entradaCentavos, moneda)}`} className="text-positive" />
          <Dato etiqueta="Salió este mes" valor={`−${dinero(mes.salidaCentavos, moneda)}`} />
        </div>
      ) : null}
    </section>
  );
}

function HeroTarjeta({ c, moneda, hoy, alDecir }: { c: EstadoCuenta; moneda: string; hoy: string; alDecir: () => void }) {
  const uso = usoCredito(c);
  const corte = c.diaCorte ? proximaFecha(c.diaCorte, hoy) : null;
  const pago = c.diaPago ? proximaFecha(c.diaPago, hoy) : null;
  const debe = c.deudaCentavos !== null && c.deudaCentavos > 0;
  return (
    <section aria-label="Tarjeta" className="rounded-[20px] bg-card p-4">
      <div className="flex items-center gap-4">
        {uso !== null ? (
          <div className="relative shrink-0">
            <Anillos tamano={104} grosor={12} className="max-[379px]:size-[84px]" anillos={[{ progreso: uso, color: colorUso(uso), etiqueta: "Crédito usado" }]} />
            <span className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
              <span className="text-[20px] font-bold tabular max-[379px]:text-[17px]" data-testid="uso">
                {pct(uso)}
              </span>
              <span className="text-[11px] text-muted-foreground">usado</span>
            </span>
          </div>
        ) : null}
        <dl className="min-w-0 flex-1 space-y-2">
          <div>
            <dt className="text-[13px] font-medium text-muted-foreground">{c.deudaCentavos !== null && c.deudaCentavos < 0 ? "A tu favor" : "Debes"}</dt>
            <dd data-testid="deuda" className="truncate text-[28px] leading-8 font-bold tracking-[-0.02em] tabular max-[379px]:text-[22px] max-[379px]:leading-7">
              {c.deudaCentavos === null ? <span className="text-[20px] text-muted-foreground">No sé</span> : dinero(Math.abs(c.deudaCentavos), moneda)}
            </dd>
          </div>
          {c.disponibleCentavos !== null ? (
            <div>
              <dt className="text-[13px] font-medium text-muted-foreground">{c.disponibleCentavos >= 0 ? "Disponible" : "Te pasaste del límite"}</dt>
              <dd data-testid="disponible" className={cn("text-[17px] font-semibold tabular", c.disponibleCentavos < 0 && "text-negative")}>
                {dinero(Math.abs(c.disponibleCentavos), moneda)}
                {c.limiteCentavos !== null ? <span className="font-normal text-muted-foreground"> de {dinero(c.limiteCentavos, moneda)}</span> : null}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      {!c.conocido ? (
        <Button variant="tinted" size="sm" className="mt-3" onClick={alDecir}>
          Decir cuánto debo
        </Button>
      ) : null}
      {corte || pago ? (
        <div className="mt-3 grid grid-cols-2 gap-3 pt-3 hairline-t">
          {corte ? <Dato etiqueta="Corte" valor={diaCorto(corte)} nota={enCuantosDias(corte, hoy)} /> : <span />}
          {pago ? (
            <Dato
              etiqueta="Pago"
              valor={diaCorto(pago)}
              nota={enCuantosDias(pago, hoy)}
              className={debe && diasEntreFechas(hoy, pago) <= 3 ? "text-orange" : undefined}
            />
          ) : null}
        </div>
      ) : c.conocido ? (
        <p className="mt-3 pt-3 text-[13px] text-muted-foreground hairline-t">Dime su día de corte y de pago y te aviso antes de que venza.</p>
      ) : null}
    </section>
  );
}

function Dato({ etiqueta, valor, nota, className }: { etiqueta: string; valor: string; nota?: string; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted-foreground">{etiqueta}</div>
      <div className={cn("text-[15px] font-semibold tabular", className)}>{valor}</div>
      {nota ? <div className={cn("text-[13px] text-muted-foreground", className)}>{nota}</div> : null}
    </div>
  );
}

/** Lo último que salió o llegó a esta cuenta. En una transferencia, el signo depende de qué lado es. */
function Recientes({ movimientos, cuentaId, moneda }: { movimientos: MovimientoApp[]; cuentaId: string; moneda: string }) {
  if (!movimientos.length) return null;
  return (
    <Grupo titulo="Recientes" aria-label="Recientes">
      {movimientos.slice(0, 8).map((m) => {
        const llega = m.cuentaDestinoId === cuentaId;
        const entra = m.tipo === "ingreso" || llega;
        const mover = m.tipo === "transferencia" || m.tipo === "pago_tarjeta";
        const direccion = mover ? (llega ? `desde ${m.cuenta ?? "otra cuenta"}` : `a ${m.cuentaDestino ?? "otra cuenta"}`) : (m.categoria?.split(">").pop()?.trim() ?? "Sin categoría");
        return (
          <FilaBoton
            key={m.id}
            sangria="4rem"
            icono={<IconoCategoria nombre={m.categoria} tipo={m.tipo} />}
            titulo={tituloDe(m)}
            subtitulo={`${diaCorto(m.fecha)} · ${direccion}`}
            valor={
              <span className={cn("tabular", entra ? "text-positive" : "text-foreground")}>
                {entra ? "+" : "−"}
                {dinero(Math.abs(m.montoCentavos), m.moneda || moneda)}
              </span>
            }
            onClick={() => abrirDetalle(m)}
          />
        );
      })}
    </Grupo>
  );
}
