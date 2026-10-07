import { useMutation, useQuery } from "@tanstack/react-query";
import { AudioLines, Check, CircleCheck, Download, Layers } from "lucide-react";
import { useState } from "react";
import { CasillasCodigo } from "../components/CasillasCodigo";
import { PasosDescarga, ReintentarDescarga } from "../components/PasosAtajo";
import { Spinner } from "../components/Spinner";
import { Button } from "../components/ui/button";
import { Fila, Grupo, IconoAjuste } from "../components/ui/lista";
import { api, ErrorApi } from "../lib/api";
import { abrirAtajo } from "../lib/atajo";
import { codigoDeLaDireccion, LARGO_CODIGO, mensajeInvitacion } from "../lib/codigo";
import { useEnLinea } from "../lib/conexion";
import { haptico } from "../lib/haptico";
import type { AtajoCanjeado, Invitacion } from "../lib/tipos";

const PARA_CUENTA = "Este código es para crear una cuenta. Ábrelo en la app.";

const PASOS = [
  {
    color: "#007aff",
    icono: <Download />,
    texto: (
      <>
        Toca <strong className="font-semibold">Instalar</strong> y descarga el Atajo.
      </>
    ),
  },
  {
    color: "linear-gradient(180deg,#ff5e8a,#5e5ce6)",
    icono: <Layers />,
    texto: <>Ábrelo y toca «Agregar atajo».</>,
  },
  {
    color: "linear-gradient(180deg,#5e5ce6,#1c1c1e)",
    icono: <AudioLines />,
    texto: <>Di «Oye Siri, Finanzas»: la primera vez te saludo y te cuento cómo funciono.</>,
  },
];

function estadoDe(error: unknown) {
  return error instanceof ErrorApi ? error.estado : null;
}

function mensajeCanje(error: unknown) {
  const estado = estadoDe(error);
  if (estado === 501) return "Tu Mac no pudo firmar el Atajo. Tu código sigue sirviendo: vuelve a intentarlo.";
  if (estado === 429) return mensajeInvitacion(error);
  return error instanceof Error ? error.message : "No se pudo preparar el Atajo. Inténtalo de nuevo.";
}

/**
 * /instalar?codigo=XXXXXX: instala el Atajo con un código de dispositivo, sin sesión.
 * No toca el token guardado; si hay sesión, igual se muestra esta pantalla.
 */
export function Instalar() {
  const enLinea = useEnLinea();
  const [codigoInicial] = useState(codigoDeLaDireccion);
  const [codigo, setCodigo] = useState(codigoInicial);
  const completo = codigo.length === LARGO_CODIGO;

  const invitacion = useQuery({
    queryKey: ["invitacion", codigo],
    queryFn: () => api<Invitacion>(`/v1/invitaciones/${encodeURIComponent(codigo)}`, { publica: true }),
    enabled: completo,
    retry: false,
    staleTime: 60_000,
    gcTime: 0,
  });

  const canjear = useMutation({
    mutationFn: () =>
      api<AtajoCanjeado>("/v1/atajo/canjear", {
        method: "POST",
        publica: true,
        body: { codigo, servidor: window.location.origin },
      }),
    onSuccess: (r) => {
      haptico();
      abrirAtajo(r.url);
    },
  });
  const listo = canjear.data;

  const para = invitacion.data?.para;
  const estadoRevision = invitacion.isError ? estadoDe(invitacion.error) : null;
  const estadoCanje = canjear.isError ? estadoDe(canjear.error) : null;
  // 400, 404 y 410 al canjear: el código no sirve para esto. Lo demás (501, red) se puede reintentar.
  const canjeSinCodigo = estadoCanje === 400 || estadoCanje === 404 || estadoCanje === 410;
  const esDeCuenta = para === "usuario" || estadoCanje === 400;
  const codigoMuerto = estadoRevision === 404 || estadoRevision === 410 || (canjeSinCodigo && !esDeCuenta);

  const errorCodigo = invitacion.isError
    ? mensajeInvitacion(invitacion.error)
    : esDeCuenta
      ? PARA_CUENTA
      : canjeSinCodigo
        ? mensajeInvitacion(canjear.error)
        : null;
  const errorCanje = canjear.isError && !canjeSinCodigo ? mensajeCanje(canjear.error) : null;
  const reintentar = canjear.isError && !canjeSinCodigo && estadoCanje !== 429;

  // Sin código completo en la dirección, o con uno que ya no sirve: se escribe a mano, como en Entrar.
  const desdeEnlace = codigoInicial.length === LARGO_CODIGO;
  const conCasillas = !listo && (!desdeEnlace || codigoMuerto || codigo !== codigoInicial);
  const nombre = listo?.nombre ?? (para === "dispositivo" ? invitacion.data?.nombre : undefined);
  const puedeInstalar = enLinea && para === "dispositivo" && !canjeSinCodigo && !canjear.isPending;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-safe pt-[calc(env(safe-area-inset-top)+44px)] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeInstalar && !listo) canjear.mutate();
        }}
      >
        <div className="flex flex-col items-center text-center animate-entrar">
          <div className="relative">
            <img src="/apple-touch-icon.png" alt="" className="size-20 rounded-[18px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]" />
            {listo ? (
              <span
                aria-hidden
                className="absolute -right-2 -bottom-2 flex size-8 items-center justify-center rounded-full bg-positive text-white ring-4 ring-background animate-escalar"
              >
                <Check className="size-[18px]" strokeWidth={3.2} />
              </span>
            ) : null}
          </div>
          <h1 className="mt-6 text-[28px] leading-tight font-bold tracking-[-0.02em]">Tu Atajo Finanzas</h1>
          <p
            aria-live="polite"
            className={
              listo
                ? "mt-2 max-w-[19rem] text-[17px] leading-snug font-semibold text-balance"
                : "mt-2 max-w-[19rem] text-[17px] leading-snug text-balance text-muted-foreground"
            }
          >
            {listo
              ? "Ya casi está. Sigue estos 3 pasos:"
              : nombre
                ? `Hola, ${nombre}. Así vas a hablar con tus finanzas.`
                : "Así vas a hablar con tus finanzas."}
          </p>
        </div>

        {conCasillas ? (
          <CasillasCodigo
            className="mt-8"
            codigo={codigo}
            error={!!errorCodigo && !invitacion.isFetching}
            alCambiar={(c) => {
              canjear.reset();
              setCodigo(c);
            }}
          />
        ) : null}

        {listo ? (
          <PasosDescarga className="mt-8 animate-entrar" />
        ) : (
          <>
            <div className="mt-4 min-h-6 text-center text-[15px]" aria-live="polite">
              {invitacion.isFetching ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Spinner className="size-4" /> Revisando el código
                </span>
              ) : errorCodigo ? (
                <span className="text-negative">{errorCodigo}</span>
              ) : conCasillas && para === "dispositivo" ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <CircleCheck className="size-[18px] text-positive" aria-hidden /> Código válido
                </span>
              ) : null}
            </div>

            <Grupo className="mt-4" aria-label="Cómo funciona">
              {PASOS.map((p, i) => (
                <Fila key={i} sangria="3.75rem" className="min-h-[60px]">
                  <IconoAjuste color={p.color}>{p.icono}</IconoAjuste>
                  <p className="min-w-0 flex-1 py-3 text-[16px] leading-snug">{p.texto}</p>
                </Fila>
              ))}
            </Grupo>
          </>
        )}

        <div className="mt-auto pt-8">
          {listo ? (
            <div className="flex flex-col items-center gap-3 animate-entrar">
              <ReintentarDescarga atajo={listo} mensajeVencido="El enlace ya venció. Pide otro código o instala el Atajo desde Ajustes en la app." />
              <Button asChild variant="tinted" size="lg">
                <a href="/">Abrir la app Finanzas</a>
              </Button>
            </div>
          ) : esDeCuenta ? (
            <Button asChild size="lg">
              <a href={`/?codigo=${encodeURIComponent(codigo)}`}>Abrir en la app</a>
            </Button>
          ) : (
            <>
              {errorCanje ? <p className="mb-3 text-center text-[15px] text-balance text-negative">{errorCanje}</p> : null}
              {!enLinea ? (
                <p className="mb-3 text-center text-[15px] text-muted-foreground">Necesitas conexión para instalarlo.</p>
              ) : null}
              <Button type="submit" size="lg" disabled={!puedeInstalar}>
                {canjear.isPending ? (
                  <Spinner className="size-5" etiqueta="Preparando el Atajo" />
                ) : reintentar ? (
                  "Reintentar"
                ) : (
                  "Instalar el Atajo"
                )}
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
