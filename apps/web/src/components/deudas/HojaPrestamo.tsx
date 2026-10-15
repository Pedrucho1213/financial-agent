import { Mic, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { useEnLinea } from "../../lib/conexion";
import { useCuentas } from "../../lib/cuentas";
import { type Direccion, mismaPersona, useBorrarPrestamos, useGuardarPrestamo, useRestaurarPrestamos } from "../../lib/deudas";
import { dinero, hoyIso, leerMonto } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { useUnaVez } from "../../lib/una-vez";
import { ElegirCuenta } from "../cuentas/ElegirCuenta";
import { CampoMonto } from "../CampoMonto";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { Chip, Chips } from "../ui/chip";
import { Confirmar } from "../ui/dialog";
import { CampoFecha } from "../ui/fecha";
import { CampoFila } from "../ui/input";
import { Fila, FilaBoton, Grupo } from "../ui/lista";
import { Segmented } from "../ui/segmented";
import { Sheet, SheetContent } from "../ui/sheet";
import { comoSeDice, Inicial } from "./Piezas";

/** Un préstamo ya anotado, para cambiarlo. */
export type PrestamoEditable = {
  id: string;
  persona: string;
  direccion: Direccion;
  montoCentavos: number;
  fecha: string;
  descripcion: string | null;
};

/** Con qué se abre la hoja: un préstamo nuevo (quizá con la persona ya puesta) o uno para editar. */
export type ValorHojaPrestamo = { nuevo: true; persona?: string; direccion?: Direccion } | { prestamo: PrestamoEditable };

const SENTIDOS: { valor: Direccion; etiqueta: string }[] = [
  { valor: "debo", etiqueta: "Yo le debo" },
  { valor: "me_deben", etiqueta: "Me debe" },
];

/**
 * Anotar a mano que alguien te prestó (o que le prestaste), o cambiar uno ya anotado. Si el dinero pasó por una de
 * tus cuentas, se mueve: lo que te prestaron llega a esa cuenta y lo que prestaste sale de ella.
 */
export function HojaPrestamo({
  valor,
  personas,
  moneda,
  alCerrar,
}: {
  valor: ValorHojaPrestamo | null;
  /** Con quién ya tiene deudas, para elegir de un toque. */
  personas: string[];
  moneda: string;
  alCerrar: () => void;
}) {
  const editar = valor && "prestamo" in valor ? valor.prestamo : null;
  const cuentas = useCuentas({ activo: !!valor && !editar });
  const guardar = useGuardarPrestamo();
  const borrar = useBorrarPrestamos();
  const restaurar = useRestaurarPrestamos();
  const enLinea = useEnLinea();
  const [monto, setMonto] = useState("");
  const [direccion, setDireccion] = useState<Direccion>("debo");
  const [persona, setPersona] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [nota, setNota] = useState("");
  const [confirmar, setConfirmar] = useState(false);

  useEffect(() => {
    if (!valor) return;
    if ("prestamo" in valor) {
      const p = valor.prestamo;
      setMonto(String(p.montoCentavos / 100));
      setDireccion(p.direccion);
      setPersona(p.persona);
      setFecha(p.fecha.slice(0, 10));
      setNota(p.descripcion ?? "");
    } else {
      setMonto("");
      setDireccion(valor.direccion ?? "debo");
      setPersona(valor.persona ?? "");
      setFecha(hoyIso());
      setNota("");
    }
    setCuenta("");
  }, [valor]);

  const n = leerMonto(monto);
  const sugeridas = useMemo(() => [...new Set(personas)].slice(0, 8), [personas]);
  const cambio =
    !editar ||
    n !== editar.montoCentavos / 100 ||
    direccion !== editar.direccion ||
    persona.trim() !== editar.persona ||
    fecha !== editar.fecha.slice(0, 10) ||
    (nota.trim() || null) !== editar.descripcion;
  const listo = n !== null && !!persona.trim() && cambio && enLinea && !guardar.isPending;

  const unaVez = useUnaVez();
  const enviar = () =>
    unaVez(async () => {
      if (!listo || n === null) return;
      try {
        await guardar.mutateAsync({
          id: editar?.id,
          datos: {
            persona: persona.trim(),
            direccion,
            monto: n,
            fecha,
            descripcion: nota.trim() || null,
            ...(editar ? {} : { cuenta: cuenta || null }),
          },
        });
        haptico();
        const quien = comoSeDice(persona.trim());
        toast.success(
          editar ? "Préstamo actualizado" : direccion === "debo" ? `Anoté que le debes ${dinero(n * 100, moneda)} a ${quien}` : `Anoté que ${persona.trim()} te debe ${dinero(n * 100, moneda)}`,
          !editar && cuenta ? { description: direccion === "debo" ? `Llegó a ${cuenta}.` : `Salió de ${cuenta}.` } : undefined,
        );
        alCerrar();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  const borrarlo = async () => {
    if (!editar) return;
    try {
      await borrar.mutateAsync([editar.id]);
      haptico();
      toast("Préstamo borrado", { action: { label: "Deshacer", onClick: () => restaurar.mutate([editar.id]) } });
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  return (
    <Sheet open={!!valor} onOpenChange={(v) => !v && alCerrar()}>
      {valor ? (
        <SheetContent
          titulo={editar ? "Editar préstamo" : "Nueva deuda"}
          descripcion={editar ? editar.persona : "Lo que debes o te deben"}
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {guardar.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : editar ? "Guardar" : "Anotar"}
            </Button>
          }
        >
          <form
            className="space-y-6 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <CampoMonto id="monto-prestamo" valor={monto} onCambio={setMonto} moneda={moneda} enfocar={!editar} />
            <Segmented<Direccion> etiqueta="Quién debe" valor={direccion} onChange={setDireccion} opciones={SENTIDOS} />

            <div className="space-y-2">
              <Grupo>
                <Fila>
                  <label htmlFor="persona-prestamo" className="shrink-0">
                    {direccion === "debo" ? "A quién" : "Quién"}
                  </label>
                  <CampoFila
                    id="persona-prestamo"
                    value={persona}
                    maxLength={60}
                    onChange={(e) => setPersona(e.target.value)}
                    placeholder="Nombre"
                    autoCapitalize="words"
                    enterKeyHint="done"
                  />
                </Fila>
              </Grupo>
              {!editar && sugeridas.length ? (
                <Chips aria-label="Personas">
                  {sugeridas.map((p) => (
                    <Chip
                      key={p}
                      activo={mismaPersona(p, persona)}
                      icono={<Inicial nombre={p} tamano={22} />}
                      onClick={() => setPersona(mismaPersona(p, persona) ? "" : p)}
                    >
                      {p}
                    </Chip>
                  ))}
                </Chips>
              ) : null}
            </div>

            {editar ? null : (
              <div className="space-y-1.5">
                <ElegirCuenta
                  id="cuenta-prestamo"
                  etiqueta="Cuenta"
                  titulo={direccion === "debo" ? "Llegó a" : "Salió de"}
                  valor={cuenta}
                  alCambiar={setCuenta}
                  cuentas={cuentas.data?.cuentas ?? []}
                  placeholder="Ninguna"
                />
                <p className="px-4 text-[13px] leading-snug text-pretty text-muted-foreground">
                  {cuenta
                    ? direccion === "debo"
                      ? `Sumo el préstamo a ${cuenta}.`
                      : `Lo resto de ${cuenta}.`
                    : "Si el dinero pasó por una de tus cuentas, elígela y la muevo. Si no, déjalo así."}
                </p>
              </div>
            )}

            <Grupo>
              <CampoFecha id="fecha-prestamo" etiqueta="Fecha" valor={fecha} alCambiar={(v) => v && setFecha(v)} max={hoyIso()} />
              <Fila>
                <label htmlFor="nota-prestamo" className="shrink-0">
                  Nota
                </label>
                <CampoFila id="nota-prestamo" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
              </Fila>
            </Grupo>

            {editar ? (
              <Grupo pie="Se borra este préstamo y sus abonos. Lo que se movió en tus cuentas se queda.">
                <FilaBoton
                  icono={<Trash2 aria-hidden className="size-5 text-destructive" />}
                  sangria="3.4rem"
                  titulo={<span className="text-destructive">Borrar préstamo</span>}
                  disabled={!enLinea || borrar.isPending}
                  onClick={() => setConfirmar(true)}
                />
              </Grupo>
            ) : (
              <p className="flex items-start gap-1.5 px-4 text-[13px] leading-snug text-muted-foreground">
                <Mic className="mt-0.5 size-3.5 shrink-0" />
                También por voz: «le debo 5 mil a mi mamá» o «le presté 800 a Juan desde Revolut».
              </p>
            )}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
          <Confirmar
            abierto={confirmar}
            onAbiertoChange={setConfirmar}
            titulo="¿Borrar este préstamo?"
            descripcion={editar ? `${dinero(editar.montoCentavos, moneda)} de ${editar.persona}. Puedes deshacerlo justo después.` : ""}
            confirmar="Borrar"
            onConfirmar={() => void borrarlo()}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
