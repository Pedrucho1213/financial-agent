import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Copy,
  Eye,
  EyeOff,
  GitCommitHorizontal,
  Globe,
  Hand,
  Inbox,
  KeyRound,
  Laptop,
  LogOut,
  Server,
  Share,
  Smartphone,
  Sparkles,
  Tablet,
  UserPlus,
  Workflow,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { AjustesIa } from "../components/AjustesIa";
import { AjustesNotificaciones } from "../components/AjustesNotificaciones";
import { CodigoGrande } from "../components/CasillasCodigo";
import { Pantalla } from "../components/Pantalla";
import { PasosDescarga, ReintentarDescarga } from "../components/PasosAtajo";
import { Spinner } from "../components/Spinner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Confirmar } from "../components/ui/dialog";
import { CampoFila } from "../components/ui/input";
import { Fila, FilaBoton, Grupo, IconoAjuste } from "../components/ui/lista";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { api, ErrorApi, mensajeDeError } from "../lib/api";
import { abrirAtajo } from "../lib/atajo";
import { useEnLinea } from "../lib/conexion";
import { claves, useYo } from "../lib/consultas";
import {
  CODIGO_MAX,
  CODIGO_MIN,
  esDelCodigoActual,
  NOMBRE_MAX,
  normalizarUsuario,
  problemaCodigo,
  problemaNombre,
  problemaUsuario,
  USUARIO_MAX,
  useCambiarCuenta,
  useEstadoSistema,
  useGuardarCodigo,
  useQuitarCodigo,
} from "../lib/cuenta";
import { fechaHora, haceCuanto } from "../lib/formato";
import { soltarPush } from "../lib/push";
import { cerrarSesion } from "../lib/sesion";
import type { AtajoPreparado, Dispositivo, InvitacionCreada } from "../lib/tipos";
import { CampoSecreto } from "./Entrar";

function iconoDispositivo(nombre: string) {
  const n = nombre.toLowerCase();
  if (/ipad|tablet/.test(n)) return Tablet;
  if (/mac|laptop|pc|windows/.test(n)) return Laptop;
  if (/navegador|chrome|safari|web/.test(n)) return Globe;
  if (/atajo/.test(n)) return Workflow;
  return Smartphone;
}

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

export function Ajustes() {
  const yo = useYo();
  const enLinea = useEnLinea();
  const qc = useQueryClient();
  const [invitacion, setInvitacion] = useState<InvitacionCreada | null>(null);
  const [quitar, setQuitar] = useState<Dispositivo | null>(null);
  const [salir, setSalir] = useState(false);
  const [atajoListo, setAtajoListo] = useState<AtajoPreparado | null>(null);
  const [hoja, setHoja] = useState<"nombre" | "usuario" | "codigo" | "quitarCodigo" | null>(null);
  const estado = useEstadoSistema();

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

  const invitar = useMutation({
    mutationFn: (para: "usuario" | "dispositivo") => api<InvitacionCreada>("/v1/invitaciones", { method: "POST", body: { para } }),
    onSuccess: setInvitacion,
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const revocar = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/v1/dispositivos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Dispositivo quitado");
      void qc.invalidateQueries({ queryKey: claves.yo });
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const d = yo.data;
  // Servidores anteriores a "entrar con usuario y código" no mandan estos campos: sus filas no se muestran.
  const usuario = d?.usuario.usuario;
  const tieneCodigo = d?.usuario.tieneCodigo;

  return (
    <Pantalla titulo="Ajustes" alRefrescar={() => Promise.all([yo.refetch(), estado.refetch()])}>
      <div className="space-y-8 pt-2 pb-4">
        <section className="flex items-center gap-4 rounded-[20px] bg-card p-4">
          <span
            aria-hidden
            className="flex size-[60px] shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#a5a5ab] to-[#86868b] text-[24px] font-semibold text-white"
          >
            {d ? iniciales(d.usuario.nombre) : ""}
          </span>
          <div className="min-w-0">
            {d ? (
              <>
                <h2 className="truncate text-[22px] leading-7 font-semibold tracking-tight">{d.usuario.nombre}</h2>
                <p className="truncate text-[15px] text-muted-foreground">Este dispositivo: {d.dispositivo.nombre}</p>
              </>
            ) : (
              <>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="mt-2 h-4 w-44" />
              </>
            )}
          </div>
        </section>

        <Grupo
          titulo="Cuenta"
          pie={
            tieneCodigo !== undefined
              ? "Con tu usuario y tu código puedes entrar desde cualquier iPhone o reinstalar el Atajo sin pedir una invitación."
              : undefined
          }
        >
          {/* Sin valor a la derecha: el nombre ya está en la tarjeta de arriba. */}
          <FilaBoton
            sangria="3.75rem"
            icono={
              <IconoAjuste color="#ff9500">
                <Hand />
              </IconoAjuste>
            }
            titulo="Cómo te saludo"
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

        <Grupo
          titulo="Atajo de iPhone"
          pie={
            <>
              Safari lo descarga; ábrelo desde Descargas y toca «Agregar atajo».
              <br />
              Luego asígnalo al botón de acción o a Toque atrás (Accesibilidad › Tocar).
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

        <Grupo titulo="Invitaciones" pie="El código sirve una vez y vence en 24 horas.">
          <FilaBoton
            sangria="3.75rem"
            icono={
              <IconoAjuste color="#007aff">
                <Smartphone />
              </IconoAjuste>
            }
            titulo="Agregar otro dispositivo"
            chevron
            disabled={!enLinea || invitar.isPending}
            onClick={() => invitar.mutate("dispositivo")}
          />
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

        <Grupo titulo="Dispositivos" pie="Quitar un dispositivo le cierra la sesión al instante.">
          {d ? (
            d.dispositivos.map((x) => {
              const Icono = iconoDispositivo(x.nombre);
              return (
                <Fila key={x.id} sangria="3.75rem" className="min-h-[60px]">
                  <IconoAjuste color="#8e8e93">
                    <Icono />
                  </IconoAjuste>
                  <div className="min-w-0 flex-1 py-2">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{x.nombre}</span>
                      {x.actual ? <Badge variant="default">Este dispositivo</Badge> : null}
                    </div>
                    <div className="truncate text-[13px] text-muted-foreground">
                      {x.ultimoUso ? `Último uso ${haceCuanto(x.ultimoUso)}` : "Sin usar todavía"}
                    </div>
                  </div>
                  {!x.actual ? (
                    <Button
                      variant="destructive-plain"
                      size="sm"
                      className="-mr-2 px-2"
                      aria-label={`Quitar ${x.nombre}`}
                      disabled={!enLinea || revocar.isPending}
                      onClick={() => setQuitar(x)}
                    >
                      Quitar
                    </Button>
                  ) : null}
                </Fila>
              );
            })
          ) : (
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          )}
        </Grupo>

        <AjustesNotificaciones />

        <Sistema estado={estado} />

        {/* Desarrollo: solo la cuenta dueña (la única a la que le llega `servidor`). */}
        <AjustesIa habilitado={!!estado.data?.servidor} />

        <Grupo>
          <FilaBoton className="justify-center text-destructive" onClick={() => setSalir(true)}>
            <LogOut className="size-[18px]" />
            <span>Cerrar sesión en este dispositivo</span>
          </FilaBoton>
        </Grupo>

        {d ? (
          <p className="text-center text-[13px] text-muted-foreground">
            {d.moneda} · {d.zonaHoraria.replace(/_/g, " ")}
          </p>
        ) : null}
      </div>

      <HojaInvitacion invitacion={invitacion} alCerrar={() => setInvitacion(null)} />
      <HojaAtajo atajo={atajoListo} alCerrar={() => setAtajoListo(null)} />
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
        abierto={!!quitar}
        onAbiertoChange={(v) => !v && setQuitar(null)}
        titulo={`¿Quitar «${quitar?.nombre ?? ""}»?`}
        descripcion="Ese dispositivo dejará de tener acceso. Para volver a entrar necesitará un código nuevo."
        confirmar="Quitar"
        onConfirmar={() => quitar && revocar.mutate(quitar.id)}
      />
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

function Punto({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

/** Estado de la Mac: servidor, IA y dictados en cola. Un servidor viejo responde 404 y solo se avisa. */
function Sistema({ estado }: { estado: ReturnType<typeof useEstadoSistema> }) {
  const e = estado.data;
  const ia = e
    ? e.ia.cargada
      ? { color: "#34c759", texto: "Lista" }
      : e.ia.disponible
        ? { color: "#ffcc00", texto: "Se carga al hablar" }
        : { color: "#ff3b30", texto: "No disponible" }
    : null;

  return (
    <Grupo titulo="Sistema" aria-label="Sistema">
      {e === null ? (
        <Fila>
          <p className="py-3 text-[15px] text-muted-foreground">Actualiza el servidor para ver su estado.</p>
        </Fila>
      ) : e && ia ? (
        <>
          <Fila
            sangria="3.75rem"
            icono={
              <IconoAjuste color="#8e8e93">
                <Server />
              </IconoAjuste>
            }
            titulo="Servidor"
            subtitulo={e.servidor ? `Encendido desde ${haceCuanto(e.servidor.arrancadoEn)}` : undefined}
            valor={
              <span className="inline-flex">
                <Punto color="#34c759" />
                <span className="sr-only">En línea</span>
              </span>
            }
          />
          {/* La versión solo le llega al dueño de la instalación. */}
          {e.servidor ? (
            <Fila
              sangria="3.75rem"
              icono={
                <IconoAjuste color="#636366">
                  <GitCommitHorizontal />
                </IconoAjuste>
              }
              titulo="Versión"
              subtitulo={e.servidor.commitEn ? `Desplegada ${haceCuanto(e.servidor.commitEn)}` : undefined}
              valor={<span className="font-mono text-[15px]">{e.servidor.commit?.slice(0, 7) ?? "Sin dato"}</span>}
            />
          ) : null}
          <Fila
            sangria="3.75rem"
            icono={
              <IconoAjuste color="linear-gradient(180deg,#5e5ce6,#1c1c1e)">
                <Sparkles />
              </IconoAjuste>
            }
            titulo="IA"
            subtitulo={e.ia.modelo}
            valor={
              <span className="inline-flex items-center gap-1.5">
                <Punto color={ia.color} />
                {ia.texto}
              </span>
            }
          />
          {/* Con algo en cola, el detalle va abajo: a la derecha no cabe junto al título. */}
          <Fila
            sangria="3.75rem"
            icono={
              <IconoAjuste color="#007aff">
                <Inbox />
              </IconoAjuste>
            }
            titulo="Dictados"
            subtitulo={
              e.cola.pendientes > 0 || e.cola.conError > 0 ? (
                <>
                  {e.cola.pendientes > 0 ? `${e.cola.pendientes} en proceso` : null}
                  {e.cola.pendientes > 0 && e.cola.conError > 0 ? " · " : null}
                  {e.cola.conError > 0 ? <span className="text-negative">{e.cola.conError} con error</span> : null}
                </>
              ) : undefined
            }
            valor={e.cola.pendientes === 0 && e.cola.conError === 0 ? "Nada pendiente" : undefined}
          />
        </>
      ) : estado.isError ? (
        <Fila>
          <p className="py-3 text-[15px] text-muted-foreground">{mensajeDeError(estado.error)}</p>
        </Fila>
      ) : (
        <div className="space-y-3 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      )}
    </Grupo>
  );
}

/** Hoja con Cancelar / Guardar; Intro en el teclado también guarda. */
function HojaFormulario({
  titulo,
  descripcion,
  puedeGuardar,
  guardando,
  alGuardar,
  alCerrar,
  children,
}: {
  titulo: string;
  descripcion: string;
  puedeGuardar: boolean;
  guardando: boolean;
  alGuardar: () => void;
  alCerrar: () => void;
  children: ReactNode;
}) {
  const enLinea = useEnLinea();
  const listo = puedeGuardar && enLinea && !guardando;
  return (
    <SheetContent
      titulo={titulo}
      descripcion={descripcion}
      izquierda={
        <Button variant="plain" size="text" onClick={alCerrar}>
          Cancelar
        </Button>
      }
      derecha={
        <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={alGuardar}>
          {guardando ? <Spinner className="size-5" etiqueta="Guardando" /> : "Guardar"}
        </Button>
      }
    >
      <form
        className="space-y-6 pt-2 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (listo) alGuardar();
        }}
      >
        {children}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </SheetContent>
  );
}

/** Pie de un grupo: el error (en rojo) arriba de la explicación de siempre. */
function PieConError({ error, children }: { error: string | null; children?: ReactNode }) {
  return (
    <>
      {error ? (
        <span role="alert" className="block text-negative">
          {error}
        </span>
      ) : null}
      {children}
    </>
  );
}

/** "Código actual": lo piden cambiar el usuario y cambiar o quitar el código (con solo el token no basta). */
function GrupoCodigoActual({
  valor,
  alCambiar,
  error,
  pie,
  enfocar,
}: {
  valor: string;
  alCambiar: (v: string) => void;
  error: string | null;
  pie: ReactNode;
  enfocar?: boolean;
}) {
  return (
    <Grupo pie={<PieConError error={error}>{pie}</PieConError>}>
      <Fila>
        <label htmlFor="codigo-actual" className="w-32 shrink-0">
          Código actual
        </label>
        <CampoSecreto
          id="codigo-actual"
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          aria-invalid={!!error}
          autoComplete="current-password"
          placeholder="Requerido"
          enterKeyHint="next"
          maxLength={256}
          autoFocus={enfocar}
        />
      </Fila>
    </Grupo>
  );
}

function HojaNombre({ abierta, actual, alCerrar }: { abierta: boolean; actual: string; alCerrar: () => void }) {
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && alCerrar()}>
      {abierta ? <EditarNombre actual={actual} alCerrar={alCerrar} /> : null}
    </Sheet>
  );
}

function EditarNombre({ actual, alCerrar }: { actual: string; alCerrar: () => void }) {
  const [nombre, setNombre] = useState(actual);
  const cambiar = useCambiarCuenta();
  const limpio = nombre.trim().replace(/\s+/g, " ");
  const problema = nombre !== actual ? problemaNombre(nombre) : null;
  // El del servidor manda sobre la pista local.
  const error = cambiar.isError ? mensajeDeError(cambiar.error) : problema;
  const guardar = () =>
    cambiar.mutate(
      { nombre: limpio },
      {
        onSuccess: () => {
          toast.success("Nombre guardado");
          alCerrar();
        },
      },
    );

  return (
    <HojaFormulario
      titulo="Cómo te saludo"
      descripcion="Cambia el nombre con el que te saludo"
      puedeGuardar={!problemaNombre(nombre) && limpio !== actual}
      guardando={cambiar.isPending}
      alGuardar={guardar}
      alCerrar={alCerrar}
    >
      <Grupo
        pie={
          <PieConError error={error}>
            Así te llamo cuando hablas conmigo por voz y en la app. Letras, espacios, punto, apóstrofo o guion.
          </PieConError>
        }
      >
        <Fila>
          <label htmlFor="nombre-saludo" className="shrink-0">
            Nombre
          </label>
          <CampoFila
            id="nombre-saludo"
            value={nombre}
            onChange={(e) => {
              cambiar.reset();
              setNombre(e.target.value);
            }}
            aria-invalid={!!error}
            placeholder="Pedro"
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="done"
            maxLength={NOMBRE_MAX}
            autoFocus
          />
        </Fila>
      </Grupo>
    </HojaFormulario>
  );
}

function HojaUsuario({
  abierta,
  actual,
  tieneCodigo,
  alCerrar,
}: {
  abierta: boolean;
  actual: string;
  tieneCodigo: boolean;
  alCerrar: () => void;
}) {
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && alCerrar()}>
      {abierta ? <EditarUsuario actual={actual} tieneCodigo={tieneCodigo} alCerrar={alCerrar} /> : null}
    </Sheet>
  );
}

function EditarUsuario({ actual, tieneCodigo, alCerrar }: { actual: string; tieneCodigo: boolean; alCerrar: () => void }) {
  const [texto, setTexto] = useState(actual);
  const [codigoActual, setCodigoActual] = useState("");
  const cambiar = useCambiarCuenta();
  const usuario = normalizarUsuario(texto);
  const problema = usuario ? problemaUsuario(usuario) : null;
  // Con código, cambiar el usuario pide el código actual (el usuario es la mitad de lo que se necesita para entrar).
  const pideActual = tieneCodigo && !!usuario && usuario !== actual;
  const delActual = cambiar.isError && esDelCodigoActual(cambiar.error);
  // El del servidor (409: ya es de alguien; 400: no es válido) manda sobre la pista local.
  const error = cambiar.isError && !delActual ? mensajeDeError(cambiar.error) : problema;
  const guardar = () =>
    cambiar.mutate(
      { usuario, ...(pideActual ? { actual: codigoActual } : {}) },
      {
        onSuccess: () => {
          toast.success("Usuario guardado");
          alCerrar();
        },
      },
    );

  return (
    <HojaFormulario
      titulo="Usuario"
      descripcion="Cambia tu usuario para entrar"
      puedeGuardar={!!usuario && !problema && usuario !== actual && (!pideActual || codigoActual.trim().length > 0)}
      guardando={cambiar.isPending}
      alGuardar={guardar}
      alCerrar={alCerrar}
    >
      <Grupo
        pie={
          <PieConError error={error}>
            {!error && usuario && usuario !== texto.trim() ? <span className="block">Quedará como «{usuario}».</span> : null}
            De 3 a {USUARIO_MAX} caracteres: letras, números, punto, guion o guion bajo. Es con lo que entras en otro iPhone.
          </PieConError>
        }
      >
        <Fila>
          <label htmlFor="usuario-cuenta" className="shrink-0">
            Usuario
          </label>
          <CampoFila
            id="usuario-cuenta"
            value={texto}
            onChange={(e) => {
              cambiar.reset();
              setTexto(e.target.value);
            }}
            aria-invalid={!!error}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint={pideActual ? "next" : "done"}
            maxLength={64}
            autoFocus
          />
        </Fila>
      </Grupo>
      {pideActual ? (
        <GrupoCodigoActual
          valor={codigoActual}
          alCambiar={(v) => {
            cambiar.reset();
            setCodigoActual(v);
          }}
          error={delActual ? mensajeDeError(cambiar.error) : null}
          pie="Para cambiar tu usuario escribe tu código para entrar."
        />
      ) : null}
    </HojaFormulario>
  );
}

function HojaCodigo({
  abierta,
  cambiar,
  usuario,
  nombre,
  alCerrar,
}: {
  abierta: boolean;
  cambiar: boolean;
  usuario: string;
  nombre: string;
  alCerrar: () => void;
}) {
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && alCerrar()}>
      {abierta ? <EditarCodigo cambiar={cambiar} usuario={usuario} nombre={nombre} alCerrar={alCerrar} /> : null}
    </Sheet>
  );
}

/**
 * Crear o cambiar el código. Cambiarlo pide el actual y puede cerrar la sesión en los demás dispositivos.
 * Después de guardarlo no se vuelve a mostrar: el servidor solo guarda su huella.
 */
function EditarCodigo({
  cambiar,
  usuario,
  nombre,
  alCerrar,
}: {
  cambiar: boolean;
  usuario: string;
  nombre: string;
  alCerrar: () => void;
}) {
  const [codigoActual, setCodigoActual] = useState("");
  const [codigo, setCodigo] = useState("");
  const [otraVez, setOtraVez] = useState("");
  const [ver, setVer] = useState(false);
  const [cerrarOtros, setCerrarOtros] = useState(false);
  const guardarCodigo = useGuardarCodigo();
  const problema = problemaCodigo(codigo, { usuario, nombre });
  // Se avisa cuando la confirmación ya no puede coincidir, no a la mitad de escribirla.
  const noCoinciden = otraVez.length > 0 && otraVez !== codigo && (otraVez.length >= codigo.length || !codigo.startsWith(otraVez));
  const delActual = guardarCodigo.isError && esDelCodigoActual(guardarCodigo.error);
  const error =
    guardarCodigo.isError && !delActual
      ? mensajeDeError(guardarCodigo.error)
      : (problema ?? (noCoinciden ? "Los códigos no coinciden." : null));
  const cambio = (fn: (v: string) => void) => (v: string) => {
    guardarCodigo.reset();
    fn(v);
  };
  const guardar = () =>
    guardarCodigo.mutate(
      { codigo, ...(cambiar ? { actual: codigoActual, cerrarOtros } : {}) },
      {
        onSuccess: (r) => {
          const n = r.cerrados ?? 0;
          const titulo = cambiar ? "Código cambiado" : "Código creado";
          toast.success(n > 0 ? `${titulo}. Cerraste la sesión en ${n} ${n === 1 ? "dispositivo" : "dispositivos"}.` : titulo);
          alCerrar();
        },
      },
    );
  const campo = {
    type: ver ? "text" : "password",
    autoComplete: "new-password",
    autoCapitalize: "none",
    autoCorrect: "off",
    spellCheck: false,
    maxLength: CODIGO_MAX,
  } as const;

  return (
    <HojaFormulario
      titulo={cambiar ? "Cambiar código" : "Crear código"}
      descripcion="Código para entrar con tu usuario"
      puedeGuardar={
        codigo.trim().length >= CODIGO_MIN && !problema && codigo === otraVez && (!cambiar || codigoActual.trim().length > 0)
      }
      guardando={guardarCodigo.isPending}
      alGuardar={guardar}
      alCerrar={alCerrar}
    >
      <p className="px-4 text-center text-[15px] leading-snug text-balance text-muted-foreground">
        Con tu usuario <strong className="font-semibold text-foreground">{usuario}</strong> y este código puedes entrar desde
        cualquier iPhone o reinstalar el Atajo sin pedir una invitación.
      </p>
      {/* Para que el llavero de iOS guarde el código junto al usuario. */}
      <input type="text" name="username" autoComplete="username" value={usuario} readOnly tabIndex={-1} aria-hidden className="sr-only" />
      {cambiar ? (
        <GrupoCodigoActual
          valor={codigoActual}
          alCambiar={cambio(setCodigoActual)}
          error={delActual ? mensajeDeError(guardarCodigo.error) : null}
          pie="El que usas hoy para entrar."
          enfocar
        />
      ) : null}
      <Grupo
        pie={
          <PieConError error={error}>
            Mínimo {CODIGO_MIN} caracteres, sin tu usuario ni tu nombre; mejor una frase que solo tú sepas. Después de
            guardarlo no se vuelve a mostrar.
          </PieConError>
        }
      >
        <Fila>
          <label htmlFor="codigo-nuevo" className="w-24 shrink-0">
            {cambiar ? "Nuevo" : "Código"}
          </label>
          <CampoFila
            id="codigo-nuevo"
            value={codigo}
            onChange={(e) => cambio(setCodigo)(e.target.value)}
            aria-invalid={!!problema}
            enterKeyHint="next"
            autoFocus={!cambiar}
            {...campo}
          />
          <Button
            variant="plain"
            size="icon-sm"
            className="-mr-2"
            aria-label={ver ? "Ocultar código" : "Mostrar código"}
            onClick={() => setVer((v) => !v)}
          >
            {ver ? <EyeOff /> : <Eye />}
          </Button>
        </Fila>
        <Fila>
          <label htmlFor="codigo-confirmar" className="w-24 shrink-0">
            Confirmar
          </label>
          <CampoFila
            id="codigo-confirmar"
            value={otraVez}
            onChange={(e) => cambio(setOtraVez)(e.target.value)}
            aria-invalid={noCoinciden}
            placeholder="Otra vez"
            enterKeyHint="done"
            className="mr-9"
            {...campo}
          />
        </Fila>
      </Grupo>
      {cambiar ? (
        <Grupo pie="Si alguien más pudo usar tu cuenta. Este dispositivo sigue con la sesión abierta.">
          <Fila>
            <label htmlFor="cerrar-otros" className="min-w-0 flex-1 py-2.5 leading-snug">
              Cerrar sesión en los demás dispositivos
            </label>
            <Switch id="cerrar-otros" checked={cerrarOtros} onCheckedChange={setCerrarOtros} />
          </Fila>
        </Grupo>
      ) : null}
    </HojaFormulario>
  );
}

function HojaQuitarCodigo({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && alCerrar()}>
      {abierta ? <QuitarCodigo alCerrar={alCerrar} /> : null}
    </Sheet>
  );
}

/** Quitar el código también pide el actual: con solo el token no se le quita a nadie. */
function QuitarCodigo({ alCerrar }: { alCerrar: () => void }) {
  const enLinea = useEnLinea();
  const [codigoActual, setCodigoActual] = useState("");
  const quitar = useQuitarCodigo();
  const listo = enLinea && codigoActual.trim().length > 0 && !quitar.isPending;
  const enviar = () =>
    quitar.mutate(codigoActual, {
      onSuccess: () => {
        toast.success("Código quitado");
        alCerrar();
      },
    });

  return (
    <SheetContent
      titulo="Quitar código"
      descripcion="Quita tu código para entrar"
      izquierda={
        <Button variant="plain" size="text" onClick={alCerrar}>
          Cancelar
        </Button>
      }
    >
      <form
        className="space-y-6 pt-2 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (listo) enviar();
        }}
      >
        <p className="px-4 text-center text-[15px] leading-snug text-balance text-muted-foreground">
          Ya no podrás entrar con tu usuario y código. Para entrar en otro iPhone necesitarás una invitación.
        </p>
        <GrupoCodigoActual
          valor={codigoActual}
          alCambiar={(v) => {
            quitar.reset();
            setCodigoActual(v);
          }}
          error={quitar.isError ? mensajeDeError(quitar.error) : null}
          pie="Escríbelo para confirmar."
          enfocar
        />
        <Button type="submit" variant="destructive" size="lg" disabled={!listo}>
          {quitar.isPending ? <Spinner className="size-5" etiqueta="Quitando" /> : "Quitar código"}
        </Button>
      </form>
    </SheetContent>
  );
}
