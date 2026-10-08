import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CreditCard, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ErrorApi, mensajeDeError } from "../lib/api";
import { abrirAtajo } from "../lib/atajo";
import { useEnLinea } from "../lib/conexion";
import {
  activarPush,
  desactivarPush,
  type EstadoPushServidor,
  motivoSinPush,
  pedirPermiso,
  permiso,
  sincronizarPush,
} from "../lib/push";
import type { AtajoPreparado } from "../lib/tipos";
import { ReintentarDescarga } from "./PasosAtajo";
import { PasosNumerados } from "./PasosNumerados";
import { Spinner } from "./Spinner";
import { Button } from "./ui/button";
import { Fila, FilaBoton, Grupo, IconoAjuste } from "./ui/lista";
import { Sheet, SheetContent } from "./ui/sheet";
import { Switch } from "./ui/switch";

const CLAVE = ["push"] as const;

/** Ajustes › Notificaciones (activar y probar) y el Atajo de Apple Pay. */
export function AjustesNotificaciones() {
  return (
    <>
      <Notificaciones />
      <ApplePay />
    </>
  );
}

function Notificaciones() {
  const enLinea = useEnLinea();
  const qc = useQueryClient();
  const motivo = motivoSinPush();
  const estado = useQuery({
    queryKey: CLAVE,
    queryFn: async () => sincronizarPush(await api<EstadoPushServidor>("/v1/push")),
    enabled: enLinea,
  });
  const [bloqueadas, setBloqueadas] = useState(() => !motivo && permiso() === "denied");
  const activas = !!estado.data?.activo && !motivo && permiso() === "granted";

  const cambiar = useMutation({
    mutationFn: (pedido: Promise<NotificationPermission> | null) => (pedido ? activarPush(pedido) : desactivarPush().then(() => null)),
    onSuccess: (r, pedido) => {
      if (r) qc.setQueryData(CLAVE, r);
      else void qc.invalidateQueries({ queryKey: CLAVE });
      if (pedido) toast.success("Notificaciones activadas");
    },
    onError: (e) => {
      setBloqueadas(permiso() === "denied");
      toast.error(mensajeDeError(e));
    },
  });
  const probar = useMutation({
    mutationFn: () => api<{ enviadas: number }>("/v1/push/prueba", { method: "POST" }),
    onSuccess: () => toast.success("Te mandé una notificación de prueba"),
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const subtitulo =
    motivo === "instalar"
      ? "Abre Finanzas desde tu pantalla de inicio para activarlas."
      : motivo === "navegador"
        ? "Este navegador no las recibe."
        : bloqueadas
          ? "Bloqueadas: actívalas en Ajustes › Notificaciones › Finanzas."
          : estado.data?.ultimoError
            ? "La última no llegó. Desactívalas y vuelve a activarlas."
            : undefined;

  return (
    <Grupo
      titulo="Notificaciones"
      pie={
        <>
          Al registrar con el Atajo, solo dice «Anotado» o «Listo» y termina; aquí te llega qué anotó y, al tocarla, el detalle. Si corriges o borras algo, te dice en voz qué cambió.
          Las preguntas te las sigue contestando en voz. También te avisa en la mañana si encuentra algo en tus gastos.
        </>
      }
    >
      <Fila
        sangria="3.75rem"
        icono={
          <IconoAjuste color="linear-gradient(180deg,#ff6b5f,#ff3b30)">
            <Bell />
          </IconoAjuste>
        }
        titulo="Notificaciones"
        subtitulo={subtitulo}
        valor={
          cambiar.isPending || estado.isLoading ? (
            <Spinner className="size-4" />
          ) : (
            <Switch
              aria-label="Notificaciones"
              checked={activas}
              disabled={!!motivo || !enLinea}
              // El permiso se pide aquí mismo, en el toque.
              onCheckedChange={(v) => cambiar.mutate(v ? pedirPermiso() : null)}
            />
          )
        }
      />
      {activas ? (
        <FilaBoton
          sangria="3.75rem"
          icono={
            <IconoAjuste color="linear-gradient(180deg,#5ac8fa,#007aff)">
              <Send />
            </IconoAjuste>
          }
          titulo="Enviar una de prueba"
          valor={probar.isPending ? <Spinner className="size-4" /> : undefined}
          disabled={!enLinea || probar.isPending}
          onClick={() => probar.mutate()}
        />
      ) : null}
    </Grupo>
  );
}

const PASOS_APPLE_PAY = [
  <>
    Descárgalo, ábrelo desde Descargas y toca <strong className="font-semibold">«Agregar atajo»</strong>.
  </>,
  <>
    Córrelo una vez en Atajos y toca <strong className="font-semibold">«Permitir siempre»</strong> en lo que pregunte.
  </>,
  <>
    En Atajos › Automatización toca <strong className="font-semibold">+</strong> ›{" "}
    <strong className="font-semibold">Cartera</strong> (o Transacción), elige tus tarjetas y{" "}
    <strong className="font-semibold">«Ejecutar de inmediato»</strong>.
  </>,
  <>
    Toca <strong className="font-semibold">Siguiente</strong> y elige{" "}
    <strong className="font-semibold">«Finanzas Apple Pay»</strong>.
  </>,
];

function ApplePay() {
  const enLinea = useEnLinea();
  const [listo, setListo] = useState<AtajoPreparado | null>(null);
  const preparar = useMutation({
    mutationFn: () =>
      api<AtajoPreparado>("/v1/atajo", { method: "POST", body: { servidor: window.location.origin, tipo: "apple_pay" } }),
    onSuccess: (r) => {
      abrirAtajo(r.url);
      setListo(r);
    },
    onError: (e) =>
      toast.error(e instanceof ErrorApi && e.estado === 501 ? "Tu Mac no puede firmar el Atajo." : mensajeDeError(e)),
  });

  return (
    <>
      <Grupo
        titulo="Apple Pay"
        pie="Cada pago con Apple Pay se anota solo y te llega una notificación para agregar detalles. No dice nada ni te interrumpe."
      >
        <FilaBoton
          sangria="3.75rem"
          icono={
            <IconoAjuste color="linear-gradient(180deg,#3a3a3c,#1c1c1e)">
              <CreditCard />
            </IconoAjuste>
          }
          titulo="Anotar mis pagos con Apple Pay"
          valor={preparar.isPending ? <Spinner className="size-4" /> : undefined}
          chevron={!preparar.isPending}
          disabled={!enLinea || preparar.isPending}
          onClick={() => preparar.mutate()}
        />
      </Grupo>
      <Sheet open={!!listo} onOpenChange={(v) => !v && setListo(null)}>
        {listo ? (
          <SheetContent
            titulo="Pagos con Apple Pay"
            descripcion="Pasos para anotar tus pagos con Apple Pay"
            derecha={
              <Button variant="plain" size="text" className="font-semibold" onClick={() => setListo(null)}>
                Listo
              </Button>
            }
          >
            <p className="px-4 pt-2 text-center text-[15px] leading-snug text-balance text-muted-foreground">
              Se hace una sola vez:
            </p>
            <PasosNumerados
              className="mt-5"
              pasos={PASOS_APPLE_PAY}
              etiqueta="Pasos para Apple Pay"
              pie="Al correrlo a mano te dice si quedó listo y te llega una notificación de prueba."
            />
            <div className="mt-5 flex justify-center">
              <ReintentarDescarga atajo={listo} mensajeVencido="El enlace ya venció. Vuelve a tocar «Anotar mis pagos con Apple Pay»." />
            </div>
          </SheetContent>
        ) : null}
      </Sheet>
    </>
  );
}
