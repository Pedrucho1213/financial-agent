import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "../components/Spinner";
import { Button } from "../components/ui/button";
import { CampoFila } from "../components/ui/input";
import { Fila, Grupo } from "../components/ui/lista";
import { api, ErrorApi } from "../lib/api";
import { useEnLinea } from "../lib/conexion";
import { guardarToken } from "../lib/sesion";
import type { Invitacion, Registro } from "../lib/tipos";
import { cn } from "../lib/utils";

const LARGO = 6;

export function nombreDispositivoPorOmision(ua = navigator.userAgent, toques = navigator.maxTouchPoints) {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && toques > 1)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  return "Navegador";
}

function limpiarCodigo(texto: string) {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, LARGO);
}

function mensajeInvitacion(error: unknown) {
  if (error instanceof ErrorApi) {
    if (error.estado === 404) return "Ese código no existe. Revísalo o pide uno nuevo.";
    if (error.estado === 410) return "Ese código ya se usó o venció. Pide uno nuevo.";
    if (error.estado === 429) return "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
    return error.message;
  }
  return "No pudimos revisar el código. Inténtalo de nuevo.";
}

export function Entrar() {
  const enLinea = useEnLinea();
  const [codigo, setCodigo] = useState(() => limpiarCodigo(new URLSearchParams(window.location.search).get("codigo") ?? ""));
  const [nombre, setNombre] = useState("");
  const [dispositivo, setDispositivo] = useState(() => nombreDispositivoPorOmision());
  const campo = useRef<HTMLInputElement>(null);
  const completo = codigo.length === LARGO;

  const invitacion = useQuery({
    queryKey: ["invitacion", codigo],
    queryFn: () => api<Invitacion>(`/v1/invitaciones/${encodeURIComponent(codigo)}`, { publica: true }),
    enabled: completo,
    retry: false,
    staleTime: 60_000,
    gcTime: 0,
  });

  const registro = useMutation({
    mutationFn: () =>
      api<Registro>("/v1/registro", {
        method: "POST",
        publica: true,
        body: {
          codigo,
          dispositivo: dispositivo.trim() || nombreDispositivoPorOmision(),
          ...(invitacion.data?.para === "usuario" ? { nombre: nombre.trim() } : {}),
        },
      }),
    onSuccess: (r) => {
      window.history.replaceState(null, "", "/#inicio");
      guardarToken(r.token);
    },
  });

  useEffect(() => {
    if (!completo) campo.current?.focus();
  }, [completo]);

  const para = invitacion.data?.para;
  const errorCodigo = invitacion.isError ? mensajeInvitacion(invitacion.error) : null;
  const errorRegistro = registro.isError ? mensajeInvitacion(registro.error) : null;
  const puedeEntrar =
    enLinea && invitacion.isSuccess && dispositivo.trim().length > 0 && (para !== "usuario" || nombre.trim().length > 0);

  const casillas = useMemo(() => Array.from({ length: LARGO }, (_, i) => codigo[i] ?? ""), [codigo]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-safe pt-[calc(env(safe-area-inset-top)+44px)] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeEntrar && !registro.isPending) registro.mutate();
        }}
      >
        <div className="flex flex-col items-center text-center animate-entrar">
          <img src="/apple-touch-icon.png" alt="" className="size-20 rounded-[18px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]" />
          <h1 className="mt-6 text-[28px] leading-tight font-bold tracking-[-0.02em]">Entra a Finanzas</h1>
          <p className="mt-2 max-w-[19rem] text-[17px] leading-snug text-balance text-muted-foreground">
            Escribe el código de invitación de 6 caracteres.
          </p>
        </div>

        <label className="relative mx-auto mt-8 block w-full max-w-[22rem]" htmlFor="codigo">
          <span className="sr-only">Código de invitación</span>
          <div className={cn("grid grid-cols-6 gap-2", errorCodigo && "animate-sacudir")} aria-hidden>
            {casillas.map((c, i) => {
              const activa = i === Math.min(codigo.length, LARGO - 1) && !completo;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex h-14 items-center justify-center rounded-xl bg-card text-[26px] font-semibold tabular transition-[box-shadow] duration-150",
                    activa && "ring-2 ring-primary",
                    errorCodigo && "ring-2 ring-destructive/70",
                  )}
                >
                  {c || (activa ? <span className="h-7 w-0.5 animate-pulse rounded bg-primary" /> : null)}
                </div>
              );
            })}
          </div>
          <input
            ref={campo}
            id="codigo"
            name="codigo"
            value={codigo}
            onChange={(e) => {
              registro.reset();
              setCodigo(limpiarCodigo(e.target.value));
            }}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={LARGO}
            aria-invalid={!!errorCodigo}
            className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
          />
        </label>

        <div className="mt-4 min-h-12 text-center text-[15px]" aria-live="polite">
          {invitacion.isFetching ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Spinner className="size-4" /> Revisando el código
            </span>
          ) : errorCodigo ? (
            <span className="text-negative">{errorCodigo}</span>
          ) : para === "dispositivo" ? (
            <span className="font-medium">
              <CircleCheck className="mr-1.5 inline size-[18px] -translate-y-px text-positive" aria-hidden />
              Agregar este dispositivo a la cuenta de <strong>{invitacion.data?.nombre ?? "tu cuenta"}</strong>
            </span>
          ) : para === "usuario" ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CircleCheck className="size-[18px] text-positive" aria-hidden /> Código válido. Cuéntanos cómo te llamas.
            </span>
          ) : null}
        </div>

        {invitacion.isSuccess ? (
          <div className="space-y-6 animate-entrar">
            <Grupo pie="Así aparecerá este dispositivo en Ajustes. Puedes cambiarlo.">
              {para === "usuario" ? (
                <Fila>
                  <label htmlFor="nombre" className="w-28 shrink-0">
                    Tu nombre
                  </label>
                  <CampoFila
                    id="nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Pedro"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    autoFocus
                  />
                </Fila>
              ) : null}
              <Fila>
                <label htmlFor="dispositivo" className="w-28 shrink-0">
                  Dispositivo
                </label>
                <CampoFila
                  id="dispositivo"
                  value={dispositivo}
                  onChange={(e) => setDispositivo(e.target.value)}
                  autoComplete="off"
                  enterKeyHint="go"
                  maxLength={60}
                />
              </Fila>
            </Grupo>
          </div>
        ) : null}

        <div className="mt-auto pt-8">
          {errorRegistro ? <p className="mb-3 text-center text-[15px] text-negative">{errorRegistro}</p> : null}
          {!enLinea ? (
            <p className="mb-3 text-center text-[15px] text-muted-foreground">Necesitas conexión para entrar.</p>
          ) : null}
          <Button type="submit" size="lg" disabled={!puedeEntrar || registro.isPending}>
            {registro.isPending ? <Spinner className="size-5" etiqueta="Entrando" /> : para === "dispositivo" ? "Agregar dispositivo" : "Continuar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
