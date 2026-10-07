import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Globe, Laptop, LogOut, Share, Smartphone, Tablet, UserPlus, Workflow } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AjustesNotificaciones } from "../components/AjustesNotificaciones";
import { CodigoGrande } from "../components/CasillasCodigo";
import { Pantalla } from "../components/Pantalla";
import { PasosDescarga, ReintentarDescarga } from "../components/PasosAtajo";
import { Spinner } from "../components/Spinner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Confirmar } from "../components/ui/dialog";
import { Fila, FilaBoton, Grupo, IconoAjuste } from "../components/ui/lista";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { api, ErrorApi, mensajeDeError } from "../lib/api";
import { abrirAtajo } from "../lib/atajo";
import { useEnLinea } from "../lib/conexion";
import { claves, useYo } from "../lib/consultas";
import { fechaHora, haceCuanto } from "../lib/formato";
import { cerrarSesion } from "../lib/sesion";
import type { AtajoPreparado, Dispositivo, InvitacionCreada } from "../lib/tipos";

function iconoDispositivo(nombre: string) {
  const n = nombre.toLowerCase();
  if (/ipad|tablet/.test(n)) return Tablet;
  if (/mac|laptop|pc|windows/.test(n)) return Laptop;
  if (/navegador|chrome|safari|web/.test(n)) return Globe;
  if (/atajo/.test(n)) return Workflow;
  return Smartphone;
}

function iniciales(nombre: string) {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
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

  return (
    <Pantalla titulo="Ajustes" alRefrescar={() => yo.refetch()}>
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

        <AjustesNotificaciones />

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
        descripcion="Para volver a entrar en este dispositivo necesitarás un código de invitación."
        confirmar="Cerrar sesión"
        onConfirmar={cerrarSesion}
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
