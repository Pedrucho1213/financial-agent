import { useMutation } from "@tanstack/react-query";
import { AtSign, Bell, ChevronRight, Copy, Hand, KeyRound, LogOut, RefreshCw, Server, Share, UserPlus, Workflow } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AjustesIa } from "../components/AjustesIa";
import { AjustesNotificaciones, ApplePay } from "../components/AjustesNotificaciones";
import { Apariencia } from "../components/ajustes/Apariencia";
import { FilaDispositivo, HojaDispositivo, ordenarDispositivos, useQuitarDispositivos, yaNoSeUsa } from "../components/ajustes/Dispositivos";
import { HojaCodigo, HojaNombre, HojaQuitarCodigo, HojaUsuario } from "../components/ajustes/HojasCuenta";
import { Punto, resumenSistema, Sistema } from "../components/ajustes/Sistema";
import { CodigoGrande } from "../components/CasillasCodigo";
import { Pantalla } from "../components/Pantalla";
import { PasosDescarga, ReintentarDescarga } from "../components/PasosAtajo";
import { Spinner } from "../components/Spinner";
import { Button } from "../components/ui/button";
import { Confirmar } from "../components/ui/dialog";
import { Fila, FilaBoton, Grupo, IconoAjuste } from "../components/ui/lista";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { buscarActualizacion, useVersionLista, VERSION_APP } from "../lib/actualizacion";
import { api, ErrorApi, mensajeDeError } from "../lib/api";
import { abrirAtajo } from "../lib/atajo";
import { useEnLinea } from "../lib/conexion";
import { useYo } from "../lib/consultas";
import { useEstadoSistema } from "../lib/cuenta";
import { fechaHora } from "../lib/formato";
import { soltarPush } from "../lib/push";
import { hashDe, navegar, volver } from "../lib/ruta";
import { cerrarSesion } from "../lib/sesion";
import type { AtajoPreparado, Dispositivo, InvitacionCreada } from "../lib/tipos";
import { cn } from "../lib/utils";

const letras = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("es", { granularity: "grapheme" }) : null;
const primeraLetra = (texto: string) =>
  (letras ? letras.segment(texto)[Symbol.iterator]().next().value?.segment : Array.from(texto)[0]) ?? "";

function iniciales(nombre: string) {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    // La primera letra completa: un emoji o una letra con acento son varios caracteres.
    .map((p) => primeraLetra(p).toUpperCase())
    .join("");
}

const esIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

function Avatar({ nombre, className }: { nombre: string | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#a5a5ab] to-[#86868b] font-semibold text-white",
        className,
      )}
    >
      {nombre ? iniciales(nombre) : ""}
    </span>
  );
}

/** "Agregar otro dispositivo" e "Invitar a alguien": crean el código y abren la hoja para compartirlo. */
function useInvitar() {
  const [invitacion, setInvitacion] = useState<InvitacionCreada | null>(null);
  const invitar = useMutation({
    mutationFn: (para: "usuario" | "dispositivo") => api<InvitacionCreada>("/v1/invitaciones", { method: "POST", body: { para } }),
    onSuccess: setInvitacion,
    onError: (e) => toast.error(mensajeDeError(e)),
  });
  return { invitar, hoja: <HojaInvitacion invitacion={invitacion} alCerrar={() => setInvitacion(null)} /> };
}

/** Fila de acción en azul, alineada con el texto de las filas con icono. */
function FilaAccion({ titulo, disabled, onClick }: { titulo: string; disabled?: boolean; onClick: () => void }) {
  return (
    <FilaBoton sangria="3.75rem" className="pl-[3.75rem] text-tint" titulo={titulo} disabled={disabled} onClick={onClick} />
  );
}

/** «Buscar actualizaciones» y la versión instalada, para cualquier cuenta. */
function Actualizaciones() {
  const lista = useVersionLista();
  const [estado, setEstado] = useState<"nada" | "buscando" | "actualizando">("nada");

  const alTocar = async () => {
    setEstado("buscando");
    const r = await buscarActualizacion(() => setEstado("actualizando"));
    if (r === "actualizando") return;
    setEstado("nada");
    if (r === "al-dia") toast.success("Ya tienes la versión más reciente.");
    else if (r === "sin-conexion") toast.error("Sin conexión. Inténtalo cuando tengas internet.");
    else toast.error("No pude comprobarlo. Inténtalo en un momento.");
  };

  return (
    <Grupo pie={`Versión ${VERSION_APP.numero} · ${VERSION_APP.commit}`}>
      <FilaBoton
        sangria="3.75rem"
        icono={
          <IconoAjuste color="linear-gradient(180deg,#5ac8fa,#007aff)">
            <RefreshCw />
          </IconoAjuste>
        }
        titulo={estado === "actualizando" ? "Actualizando…" : lista ? "Actualizar ahora" : "Buscar actualizaciones"}
        subtitulo={lista && estado === "nada" ? "Ya se descargó una versión nueva" : undefined}
        valor={estado !== "nada" ? <Spinner etiqueta={estado === "buscando" ? "Buscando" : "Actualizando"} /> : undefined}
        aria-busy={estado !== "nada"}
        disabled={estado !== "nada"}
        onClick={alTocar}
      />
    </Grupo>
  );
}

const atrasAjustes = { etiqueta: "Ajustes", alTocar: () => volver("ajustes") };

/**
 * Ajustes: tu cuenta, cómo se ve la app y tus dispositivos a la vista; lo demás (notificaciones, Atajos,
 * estado de la Mac) abre su propia pantalla, como en Ajustes de iOS.
 */
export function Ajustes() {
  const yo = useYo();
  const enLinea = useEnLinea();
  const estado = useEstadoSistema();
  const { invitar, hoja } = useInvitar();
  const [detalle, setDetalle] = useState<Dispositivo | null>(null);

  const d = yo.data;
  const todos = d?.dispositivos ?? [];
  const enUso = ordenarDispositivos(todos.filter((x) => !yaNoSeUsa(x, todos)));
  const sinUso = todos.length - enUso.length;
  const resumen = resumenSistema(estado.data);
  const uso = estado.data?.uso;

  return (
    <Pantalla titulo="Ajustes" alRefrescar={() => Promise.all([yo.refetch(), estado.refetch()])}>
      <div className="space-y-8 pt-2 pb-4">
        <button
          type="button"
          onClick={() => navegar(hashDe("perfil"))}
          className="fila-presionable flex w-full items-center gap-4 rounded-[20px] bg-card p-4 text-left"
        >
          <Avatar nombre={d?.usuario.nombre} className="size-[60px] text-[24px]" />
          <div className="min-w-0 flex-1">
            {d ? (
              <>
                <h2 className="break-words text-[22px] leading-7 font-semibold tracking-tight text-balance">{d.usuario.nombre}</h2>
                <p className="text-[15px] leading-snug text-muted-foreground text-pretty">Cuenta y código para entrar</p>
              </>
            ) : (
              <>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="mt-2 h-4 w-44" />
              </>
            )}
          </div>
          <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted-foreground/60" />
        </button>

        <Apariencia />

        <Grupo>
          <FilaBoton
            sangria="3.75rem"
            icono={
              <IconoAjuste color="linear-gradient(180deg,#ff6b5f,#ff3b30)">
                <Bell />
              </IconoAjuste>
            }
            titulo="Notificaciones"
            chevron
            onClick={() => navegar(hashDe("notificaciones"))}
          />
          <FilaBoton
            sangria="3.75rem"
            icono={
              <IconoAjuste color="linear-gradient(180deg,#ff5e8a,#5e5ce6)">
                <Workflow />
              </IconoAjuste>
            }
            titulo="Atajos de iPhone"
            subtitulo="Para hablar y para Apple Pay"
            chevron
            onClick={() => navegar(hashDe("atajos"))}
          />
          <FilaBoton
            sangria="3.75rem"
            icono={
              <IconoAjuste color="#8e8e93">
                <Server />
              </IconoAjuste>
            }
            titulo="Sistema"
            subtitulo={uso ? (uso.limite !== null ? `${uso.consultas} de ${uso.limite} consultas de IA hoy` : `${uso.consultas} consultas de IA hoy`) : undefined}
            valor={
              resumen ? (
                <span className="inline-flex items-center gap-1.5">
                  <Punto color={resumen.color} />
                  {resumen.texto}
                </span>
              ) : undefined
            }
            chevron
            onClick={() => navegar(hashDe("sistema"))}
          />
        </Grupo>

        <Grupo
          titulo="Dispositivos"
          pie={sinUso > 0 ? `${sinUso === 1 ? "Uno ya no se usa" : `${sinUso} ya no se usan`}: puedes quitarlos en «Ver todos».` : undefined}
        >
          {d ? (
            enUso.slice(0, 3).map((x) => <FilaDispositivo key={x.id} d={x} alTocar={() => setDetalle(x)} />)
          ) : (
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          )}
          {d && (todos.length > 3 || sinUso > 0) ? (
            <FilaBoton
              sangria="3.75rem"
              className="pl-[3.75rem]"
              titulo="Ver todos"
              valor={<span className="tabular-nums">{todos.length}</span>}
              chevron
              onClick={() => navegar(hashDe("dispositivos"))}
            />
          ) : null}
          <FilaAccion titulo="Agregar otro dispositivo" disabled={!enLinea || invitar.isPending} onClick={() => invitar.mutate("dispositivo")} />
        </Grupo>

        {d?.puedeInvitar !== false ? (
          <Grupo pie="Tendrá su propia cuenta. El código sirve una vez y vence en 24 horas.">
            <FilaBoton
              sangria="3.75rem"
              icono={
                <IconoAjuste color="#34c759">
                  <UserPlus />
                </IconoAjuste>
              }
              titulo="Invitar a alguien"
              chevron
              disabled={!enLinea || invitar.isPending}
              onClick={() => invitar.mutate("usuario")}
            />
          </Grupo>
        ) : null}

        <Actualizaciones />

        {d ? (
          <p className="text-center text-[13px] text-muted-foreground">
            {d.moneda} · {d.zonaHoraria.replace(/_/g, " ")}
          </p>
        ) : null}
      </div>

      {hoja}
      <HojaDispositivo dispositivo={detalle} alCerrar={() => setDetalle(null)} />
    </Pantalla>
  );
}

/** Ajustes › tu cuenta: cómo te saludo, usuario, código para entrar y cerrar sesión. */
export function AjustesPerfil() {
  const yo = useYo();
  const enLinea = useEnLinea();
  const [hoja, setHoja] = useState<"nombre" | "usuario" | "codigo" | "quitarCodigo" | null>(null);
  const [salir, setSalir] = useState(false);
  const d = yo.data;
  // Servidores anteriores a "entrar con usuario y código" no mandan estos campos: sus filas no se muestran.
  const usuario = d?.usuario.usuario;
  const tieneCodigo = d?.usuario.tieneCodigo;

  return (
    <Pantalla titulo="Tu cuenta" atras={atrasAjustes} alRefrescar={() => yo.refetch()}>
      <div className="space-y-8 pt-2 pb-4">
        <div className="flex flex-col items-center text-center">
          <Avatar nombre={d?.usuario.nombre} className="size-[84px] text-[34px]" />
          {d ? (
            <>
              <h2 className="mt-3 max-w-full truncate text-[24px] leading-8 font-semibold tracking-tight">{d.usuario.nombre}</h2>
              {usuario ? <p className="max-w-full truncate text-[15px] text-muted-foreground">{usuario}</p> : null}
            </>
          ) : (
            <Skeleton className="mt-3 h-7 w-36" />
          )}
        </div>

        <Grupo
          pie={
            tieneCodigo !== undefined
              ? "Con tu usuario y tu código puedes entrar desde cualquier iPhone o reinstalar el Atajo sin pedir una invitación."
              : undefined
          }
        >
          <FilaBoton
            sangria="3.75rem"
            icono={
              <IconoAjuste color="#ff9500">
                <Hand />
              </IconoAjuste>
            }
            titulo="Cómo te saludo"
            valor={d ? <span className="block max-w-[38vw] truncate">{d.usuario.nombre}</span> : undefined}
            chevron
            disabled={!d || !enLinea}
            onClick={() => setHoja("nombre")}
          />
          {usuario !== undefined ? (
            <FilaBoton
              sangria="3.75rem"
              icono={
                <IconoAjuste color="#5856d6">
                  <AtSign />
                </IconoAjuste>
              }
              titulo="Usuario"
              valor={<span className="block max-w-[10rem] truncate">{usuario}</span>}
              chevron
              disabled={!enLinea}
              onClick={() => setHoja("usuario")}
            />
          ) : null}
          {tieneCodigo !== undefined ? (
            <>
              <FilaBoton
                sangria="3.75rem"
                icono={
                  <IconoAjuste color="#34c759">
                    <KeyRound />
                  </IconoAjuste>
                }
                titulo={tieneCodigo ? "Cambiar código para entrar" : "Crear código para entrar"}
                chevron
                disabled={!enLinea}
                onClick={() => setHoja("codigo")}
              />
              {tieneCodigo ? (
                <FilaBoton
                  sangria="3.75rem"
                  className="pl-[3.75rem] text-destructive"
                  titulo="Quitar código"
                  disabled={!enLinea}
                  onClick={() => setHoja("quitarCodigo")}
                />
              ) : null}
            </>
          ) : null}
        </Grupo>

        <Grupo>
          <FilaBoton className="justify-center text-destructive" onClick={() => setSalir(true)}>
            <LogOut className="size-[18px]" />
            <span>Cerrar sesión en este dispositivo</span>
          </FilaBoton>
        </Grupo>
      </div>

      <HojaNombre abierta={hoja === "nombre"} actual={d?.usuario.nombre ?? ""} alCerrar={() => setHoja(null)} />
      <HojaUsuario abierta={hoja === "usuario"} actual={usuario ?? ""} tieneCodigo={!!tieneCodigo} alCerrar={() => setHoja(null)} />
      <HojaCodigo
        abierta={hoja === "codigo"}
        cambiar={!!tieneCodigo}
        usuario={usuario ?? ""}
        nombre={d?.usuario.nombre ?? ""}
        alCerrar={() => setHoja(null)}
      />
      <HojaQuitarCodigo abierta={hoja === "quitarCodigo"} alCerrar={() => setHoja(null)} />
      <Confirmar
        abierto={salir}
        onAbiertoChange={setSalir}
        titulo="¿Cerrar sesión?"
        descripcion={
          tieneCodigo
            ? "Para volver a entrar en este dispositivo usa tu usuario y tu código, o una invitación."
            : "Para volver a entrar en este dispositivo necesitarás un código de invitación."
        }
        confirmar="Cerrar sesión"
        onConfirmar={async () => {
          await soltarPush();
          cerrarSesion();
        }}
      />
    </Pantalla>
  );
}

/** Ajustes › Dispositivos: los que usas y, aparte, los que ya no (instalaciones viejas), para quitarlos de una vez. */
export function AjustesDispositivos() {
  const yo = useYo();
  const enLinea = useEnLinea();
  const { invitar, hoja } = useInvitar();
  const quitar = useQuitarDispositivos();
  const [detalle, setDetalle] = useState<Dispositivo | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const todos = yo.data?.dispositivos ?? [];
  const ordenados = ordenarDispositivos(todos);
  const enUso = ordenados.filter((x) => !yaNoSeUsa(x, todos));
  const viejos = ordenados.filter((x) => yaNoSeUsa(x, todos));

  return (
    <Pantalla titulo="Dispositivos" atras={atrasAjustes} alRefrescar={() => yo.refetch()}>
      <div className="space-y-8 pt-2 pb-4">
        <Grupo titulo="En uso" pie="Toca uno para ver cuándo se usó, dónde estaba o quitarlo.">
          {yo.data ? (
            enUso.map((x) => <FilaDispositivo key={x.id} d={x} alTocar={() => setDetalle(x)} />)
          ) : (
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          )}
          <FilaAccion titulo="Agregar otro dispositivo" disabled={!enLinea || invitar.isPending} onClick={() => invitar.mutate("dispositivo")} />
        </Grupo>

        {viejos.length ? (
          <Grupo
            titulo="Ya no se usan"
            pie="Instalaciones viejas: no se han usado desde que instalaste otra igual, o en más de un mes. Siguen teniendo acceso hasta que las quites."
          >
            {viejos.map((x) => (
              <FilaDispositivo key={x.id} d={x} alTocar={() => setDetalle(x)} />
            ))}
            <FilaBoton
              className="justify-center text-destructive"
              disabled={!enLinea || quitar.isPending}
              onClick={() => setConfirmar(true)}
            >
              {quitar.isPending ? <Spinner className="size-4" /> : null}
              {viejos.length === 1 ? "Quitarlo" : `Quitar los ${viejos.length}`}
            </FilaBoton>
          </Grupo>
        ) : null}
      </div>

      {hoja}
      <HojaDispositivo dispositivo={detalle} alCerrar={() => setDetalle(null)} />
      <Confirmar
        abierto={confirmar}
        onAbiertoChange={setConfirmar}
        titulo={viejos.length === 1 ? "¿Quitar 1 dispositivo?" : `¿Quitar ${viejos.length} dispositivos?`}
        descripcion="Dejarán de tener acceso. Si alguno sigue en uso, tendrá que volver a entrar con un código."
        confirmar="Quitar"
        onConfirmar={() => quitar.mutate(viejos.map((x) => x.id))}
      />
    </Pantalla>
  );
}

/** Ajustes › Notificaciones. */
export function AjustesAvisos() {
  return (
    <Pantalla titulo="Notificaciones" atras={atrasAjustes}>
      <div className="space-y-8 pt-2 pb-4">
        <AjustesNotificaciones />
      </div>
    </Pantalla>
  );
}

/** Ajustes › Atajos de iPhone: el de hablar y el de Apple Pay. */
export function AjustesAtajos() {
  const enLinea = useEnLinea();
  const [atajoListo, setAtajoListo] = useState<AtajoPreparado | null>(null);
  const atajo = useMutation({
    mutationFn: () => api<AtajoPreparado>("/v1/atajo", { method: "POST", body: { servidor: window.location.origin } }),
    onSuccess: (r) => {
      abrirAtajo(r.url);
      setAtajoListo(r);
    },
    onError: (e) =>
      toast.error(
        e instanceof ErrorApi && e.estado === 501
          ? "Tu Mac no puede firmar el Atajo. Sigue la guía para armarlo a mano."
          : mensajeDeError(e),
      ),
  });

  return (
    <Pantalla titulo="Atajos de iPhone" atras={atrasAjustes}>
      <div className="space-y-8 pt-2 pb-4">
        <Grupo
          titulo="Para hablar"
          pie={
            <>
              Asígnalo al botón de acción o a Toque atrás (Accesibilidad › Tocar) y dicta lo que gastas o pregunta lo que quieras.
              {!esIOS ? (
                <>
                  <br />
                  Abre esta página desde tu iPhone para instalarlo.
                </>
              ) : null}
            </>
          }
        >
          <FilaBoton
            sangria="3.75rem"
            icono={
              <IconoAjuste color="linear-gradient(180deg,#ff5e8a,#5e5ce6)">
                <Workflow />
              </IconoAjuste>
            }
            titulo="Instalar el Atajo en este iPhone"
            valor={atajo.isPending ? <Spinner className="size-4" /> : undefined}
            chevron={!atajo.isPending}
            disabled={!enLinea || atajo.isPending}
            onClick={() => atajo.mutate()}
          />
        </Grupo>
        <ApplePay />
      </div>
      <HojaAtajo atajo={atajoListo} alCerrar={() => setAtajoListo(null)} />
    </Pantalla>
  );
}

/** Ajustes › Sistema: la Mac, la IA, las consultas y (solo la cuenta dueña) el interruptor de la IA. */
export function AjustesSistema() {
  const estado = useEstadoSistema();
  return (
    <Pantalla titulo="Sistema" atras={atrasAjustes} alRefrescar={() => estado.refetch()}>
      <div className="space-y-8 pt-2 pb-4">
        <Sistema estado={estado} />
        {/* Desarrollo: solo la cuenta dueña (la única a la que le llega `servidor`). */}
        <AjustesIa habilitado={!!estado.data?.servidor} />
      </div>
    </Pantalla>
  );
}

/** Lo que falta después de tocar "Instalar el Atajo": descargar, abrir y agregar. */
function HojaAtajo({ atajo, alCerrar }: { atajo: AtajoPreparado | null; alCerrar: () => void }) {
  return (
    <Sheet open={!!atajo} onOpenChange={(v) => !v && alCerrar()}>
      {atajo ? (
        <SheetContent
          titulo="Instalar el Atajo"
          descripcion="Pasos para terminar de instalar el Atajo"
          derecha={
            <Button variant="plain" size="text" className="font-semibold" onClick={alCerrar}>
              Listo
            </Button>
          }
        >
          <p className="px-4 pt-2 text-center text-[15px] leading-snug text-balance text-muted-foreground">
            Ya casi está. Sigue estos 3 pasos:
          </p>
          <PasosDescarga className="mt-5" />
          <div className="mt-5 flex justify-center">
            <ReintentarDescarga atajo={atajo} mensajeVencido="El enlace ya venció. Vuelve a tocar «Instalar el Atajo»." />
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function HojaInvitacion({ invitacion, alCerrar }: { invitacion: InvitacionCreada | null; alCerrar: () => void }) {
  const enlace = invitacion ? `${window.location.origin}/?codigo=${invitacion.codigo}` : "";
  const puedeCompartir = typeof navigator.share === "function";
  const paraDispositivo = invitacion?.para === "dispositivo";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(enlace);
      toast.success("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar. Mantén presionado el enlace para copiarlo.");
    }
  };

  const compartir = async () => {
    if (!invitacion) return;
    if (!puedeCompartir) return copiar();
    try {
      await navigator.share({
        title: "Finanzas",
        text: paraDispositivo
          ? `Código para agregar un dispositivo a Finanzas: ${invitacion.codigo}`
          : `Te invito a Finanzas. Tu código es ${invitacion.codigo}`,
        url: enlace,
      });
    } catch {
      // Cancelado: no pasa nada.
    }
  };

  return (
    <Sheet open={!!invitacion} onOpenChange={(v) => !v && alCerrar()}>
      {invitacion ? (
        <SheetContent
          titulo={paraDispositivo ? "Agregar dispositivo" : "Invitar a alguien"}
          descripcion="Código de invitación"
          derecha={
            <Button variant="plain" size="text" className="font-semibold" onClick={alCerrar}>
              Listo
            </Button>
          }
        >
          <div className="flex flex-col items-center pt-4 pb-2 text-center">
            <p className="max-w-[19rem] text-[15px] leading-snug text-balance text-muted-foreground">
              {paraDispositivo
                ? "En el otro dispositivo abre el enlace o escribe este código."
                : "Comparte el enlace. La otra persona tendrá su propia cuenta."}
            </p>
            <CodigoGrande codigo={invitacion.codigo} className="mt-6" />
            <p className="mt-4 text-[13px] text-muted-foreground">Vence {fechaHora(invitacion.expiraEn)}</p>
          </div>
          <Grupo className="mt-4">
            <Fila>
              <span data-seleccionable className="min-w-0 flex-1 truncate py-3 text-[15px] text-muted-foreground">
                {enlace}
              </span>
              <Button variant="plain" size="icon-sm" aria-label="Copiar enlace" onClick={copiar}>
                <Copy />
              </Button>
            </Fila>
          </Grupo>
          <Button size="lg" className="mt-6" onClick={compartir}>
            {puedeCompartir ? <Share /> : <Copy />}
            {puedeCompartir ? "Compartir" : "Copiar enlace"}
          </Button>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

