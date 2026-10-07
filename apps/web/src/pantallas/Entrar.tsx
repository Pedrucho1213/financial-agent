import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, CircleCheck, ClipboardPaste, Copy, Eye, EyeOff, Share } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import { CasillasCodigo, CodigoGrande } from "../components/CasillasCodigo";
import { PasosNumerados } from "../components/PasosNumerados";
import { Spinner } from "../components/Spinner";
import { Button } from "../components/ui/button";
import { CampoFila } from "../components/ui/input";
import { Fila, Grupo } from "../components/ui/lista";
import { api } from "../lib/api";
import { codigoDeLaDireccion, codigoDeTexto, LARGO_CODIGO, mensajeInvitacion } from "../lib/codigo";
import { useEnLinea } from "../lib/conexion";
import { mensajeEntrar, useEntrarConUsuario } from "../lib/cuenta";
import { enPantallaDeInicio, esIOS } from "../lib/plataforma";
import { guardarToken } from "../lib/sesion";
import type { Invitacion, Registro } from "../lib/tipos";

export function nombreDispositivoPorOmision(ua = navigator.userAgent, toques = navigator.maxTouchPoints) {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && toques > 1)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  return "Navegador";
}

function useInvitacion(codigo: string) {
  return useQuery({
    queryKey: ["invitacion", codigo],
    queryFn: () => api<Invitacion>(`/v1/invitaciones/${encodeURIComponent(codigo)}`, { publica: true }),
    enabled: codigo.length === LARGO_CODIGO,
    retry: false,
    staleTime: 60_000,
    gcTime: 0,
  });
}

export function Entrar() {
  const [codigoInicial] = useState(codigoDeLaDireccion);
  const [enSafari, setEnSafari] = useState(false);
  const [conUsuario, setConUsuario] = useState(false);
  // En iPhone, la app de la pantalla de inicio no comparte datos con Safari: si el código se
  // canjeara aquí, la app instalada quedaría pidiendo uno que ya se gastó. Primero, instalarla.
  if (codigoInicial.length === LARGO_CODIGO && !enSafari && esIOS() && !enPantallaDeInicio()) {
    return <InstalaLaApp codigo={codigoInicial} alUsarEnSafari={() => setEnSafari(true)} />;
  }
  if (conUsuario) return <FormularioUsuario alUsarInvitacion={() => setConUsuario(false)} />;
  return <Formulario codigoInicial={codigoInicial} alUsarUsuario={() => setConUsuario(true)} />;
}

function Formulario({ codigoInicial, alUsarUsuario }: { codigoInicial: string; alUsarUsuario: () => void }) {
  const enLinea = useEnLinea();
  const [codigo, setCodigo] = useState(codigoInicial);
  const [nombre, setNombre] = useState("");
  const [dispositivo, setDispositivo] = useState(() => nombreDispositivoPorOmision());
  const completo = codigo.length === LARGO_CODIGO;

  const invitacion = useInvitacion(codigo);
  const puedePegar = enPantallaDeInicio() && typeof navigator.clipboard?.readText === "function";

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

  const para = invitacion.data?.para;
  const errorCodigo = invitacion.isError ? mensajeInvitacion(invitacion.error) : null;
  const errorRegistro = registro.isError ? mensajeInvitacion(registro.error) : null;
  const puedeEntrar =
    enLinea && invitacion.isSuccess && dispositivo.trim().length > 0 && (para !== "usuario" || nombre.trim().length > 0);

  // En la app de la pantalla de inicio, el código llega copiado desde Safari.
  const pegar = async () => {
    try {
      const pegado = codigoDeTexto(await navigator.clipboard.readText());
      if (!pegado) {
        toast.error("Lo que copiaste no tiene un código de 6 caracteres.");
        return;
      }
      registro.reset();
      setCodigo(pegado);
    } catch {
      toast.error("No se pudo pegar. Escribe el código.");
    }
  };

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

        <CasillasCodigo
          className="mt-8"
          codigo={codigo}
          error={!!errorCodigo}
          alCambiar={(c) => {
            registro.reset();
            setCodigo(c);
          }}
        />

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
          {puedePegar && (!completo || errorCodigo) && !invitacion.isFetching ? (
            <div className={errorCodigo ? "mt-3" : undefined}>
              <Button variant="tinted" size="sm" onClick={pegar}>
                <ClipboardPaste /> Pegar código
              </Button>
            </div>
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
          <Button variant="plain" size="text" className="mt-2 w-full text-[15px]" onClick={alUsarUsuario}>
            Entrar con usuario y código
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Campo para el código de entrar, con Mostrar/Ocultar, dentro de una fila de lista. */
export function CampoSecreto(props: Omit<ComponentProps<typeof CampoFila>, "type">) {
  const [ver, setVer] = useState(false);
  return (
    <>
      <CampoFila type={ver ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} {...props} />
      <Button
        variant="plain"
        size="icon-sm"
        className="-mr-2"
        aria-label={ver ? "Ocultar código" : "Mostrar código"}
        onClick={() => setVer((v) => !v)}
      >
        {ver ? <EyeOff /> : <Eye />}
      </Button>
    </>
  );
}

/** Entrar sin invitación: con el usuario y el código que se crean en Ajustes. */
function FormularioUsuario({ alUsarInvitacion }: { alUsarInvitacion: () => void }) {
  const enLinea = useEnLinea();
  const [usuario, setUsuario] = useState("");
  const [codigo, setCodigo] = useState("");
  const [dispositivo, setDispositivo] = useState(() => nombreDispositivoPorOmision());
  const entrar = useEntrarConUsuario();
  const puedeEntrar = enLinea && usuario.trim().length > 0 && codigo.length > 0 && dispositivo.trim().length > 0;

  const enviar = () =>
    entrar.mutate(
      { usuario, codigo, dispositivo: dispositivo.trim() || nombreDispositivoPorOmision() },
      {
        onSuccess: (r) => {
          window.history.replaceState(null, "", "/#inicio");
          guardarToken(r.token);
        },
      },
    );

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-safe pt-[calc(env(safe-area-inset-top)+44px)] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeEntrar && !entrar.isPending) enviar();
        }}
      >
        <div className="flex flex-col items-center text-center animate-entrar">
          <img src="/apple-touch-icon.png" alt="" className="size-20 rounded-[18px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]" />
          <h1 className="mt-6 text-[28px] leading-tight font-bold tracking-[-0.02em]">Entra a Finanzas</h1>
          <p className="mt-2 max-w-[19rem] text-[17px] leading-snug text-balance text-muted-foreground">
            Con tu usuario y tu código para entrar.
          </p>
        </div>

        <Grupo className="mt-8 animate-entrar" pie="El código se crea en Ajustes, en un dispositivo donde ya entraste.">
          <Fila>
            <label htmlFor="usuario" className="w-28 shrink-0">
              Usuario
            </label>
            <CampoFila
              id="usuario"
              value={usuario}
              onChange={(e) => {
                entrar.reset();
                setUsuario(e.target.value);
              }}
              placeholder="pedro"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              autoFocus
            />
          </Fila>
          <Fila>
            <label htmlFor="codigo-entrar" className="w-28 shrink-0">
              Código
            </label>
            <CampoSecreto
              id="codigo-entrar"
              value={codigo}
              onChange={(e) => {
                entrar.reset();
                setCodigo(e.target.value);
              }}
              placeholder="Requerido"
              autoComplete="current-password"
              enterKeyHint="next"
            />
          </Fila>
        </Grupo>

        <Grupo className="mt-6" pie="Así aparecerá este dispositivo en Ajustes. Puedes cambiarlo.">
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

        <div className="mt-auto pt-8">
          {entrar.isError ? (
            <p role="alert" className="mb-3 text-center text-[15px] text-negative">
              {mensajeEntrar(entrar.error)}
            </p>
          ) : null}
          {!enLinea ? (
            <p className="mb-3 text-center text-[15px] text-muted-foreground">Necesitas conexión para entrar.</p>
          ) : null}
          <Button type="submit" size="lg" disabled={!puedeEntrar || entrar.isPending}>
            {entrar.isPending ? <Spinner className="size-5" etiqueta="Entrando" /> : "Entrar"}
          </Button>
          <Button variant="plain" size="text" className="mt-2 w-full text-[15px]" onClick={alUsarInvitacion}>
            Usar un código de invitación
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Abierta desde un enlace con ?codigo= en Safari de iPhone: primero se instala la app en la
 * pantalla de inicio y el código se pega ahí. "Usar en Safari" lo canjea aquí mismo.
 */
function InstalaLaApp({ codigo, alUsarEnSafari }: { codigo: string; alUsarEnSafari: () => void }) {
  const invitacion = useInvitacion(codigo);
  const [copiado, setCopiado] = useState(false);
  const aparato = /iPad/i.test(navigator.userAgent) || !/iPhone|iPod/i.test(navigator.userAgent) ? "iPad" : "iPhone";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      toast.success("Código copiado");
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error("No se pudo copiar. Anota el código.");
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-safe pt-[calc(env(safe-area-inset-top)+44px)] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-center text-center animate-entrar">
        <img src="/apple-touch-icon.png" alt="" className="size-20 rounded-[18px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]" />
        <h1 className="mt-6 text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance">Instala Finanzas en tu {aparato}</h1>
        <p className="mt-2 max-w-[20rem] text-[17px] leading-snug text-balance text-muted-foreground">
          Se abre como app desde tu pantalla de inicio. Ahí vas a usar este código:
        </p>
      </div>

      <div className="mt-6 flex flex-col items-center">
        <CodigoGrande codigo={codigo} />
        <div className="mt-3 min-h-6 text-center text-[15px]" aria-live="polite">
          {invitacion.isFetching ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Spinner className="size-4" /> Revisando el código
            </span>
          ) : invitacion.isError ? (
            <span className="text-negative">{mensajeInvitacion(invitacion.error)}</span>
          ) : invitacion.data?.para === "dispositivo" ? (
            <span className="text-muted-foreground">
              Para la cuenta de <strong className="font-semibold text-foreground">{invitacion.data.nombre ?? "tu cuenta"}</strong>
            </span>
          ) : invitacion.isSuccess ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CircleCheck className="size-[18px] text-positive" aria-hidden /> Código válido
            </span>
          ) : null}
        </div>
        <Button variant="tinted" size="sm" className="mt-2" onClick={copiar}>
          {copiado ? <Check /> : <Copy />}
          {copiado ? "Copiado" : "Copiar código"}
        </Button>
      </div>

      <PasosNumerados
        className="mt-6"
        etiqueta="Pasos para instalarla"
        pasos={[
          <>
            Toca Compartir <Share aria-label="(el cuadro con la flecha)" className="mb-1 inline size-[18px] text-tint" />.
          </>,
          <>
            Elige <strong className="font-semibold">«Agregar a inicio»</strong>.
          </>,
          <>Abre Finanzas desde tu pantalla de inicio y pega el código.</>,
        ]}
      />

      <div className="mt-auto pt-8">
        <Button variant="gray" size="lg" onClick={alUsarEnSafari}>
          Usar en Safari
        </Button>
      </div>
    </div>
  );
}
