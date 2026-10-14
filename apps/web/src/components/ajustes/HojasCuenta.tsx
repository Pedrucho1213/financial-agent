import { Eye, EyeOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { useEnLinea } from "../../lib/conexion";
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
  useGuardarCodigo,
  useQuitarCodigo,
} from "../../lib/cuenta";
import { CampoSecreto } from "../../pantallas/Entrar";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { CampoFila } from "../ui/input";
import { Fila, Grupo } from "../ui/lista";
import { Sheet, SheetContent } from "../ui/sheet";
import { Switch } from "../ui/switch";

// Hojas de Ajustes › tu cuenta: cómo te saludo, usuario y código para entrar.

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

export function HojaNombre({ abierta, actual, alCerrar }: { abierta: boolean; actual: string; alCerrar: () => void }) {
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

export function HojaUsuario({
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

export function HojaCodigo({
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

export function HojaQuitarCodigo({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
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
