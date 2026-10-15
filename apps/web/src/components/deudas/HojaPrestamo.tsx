import { Mic } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { useEnLinea } from "../../lib/conexion";
import { useCuentas } from "../../lib/cuentas";
import { type DatosNuevaDeuda, type Direccion, mismaPersona, useAgregarDeuda } from "../../lib/deudas";
import { dinero, hoyIso, leerMonto } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { useUnaVez } from "../../lib/una-vez";
import { ElegirCuenta } from "../cuentas/ElegirCuenta";
import { CampoMonto } from "../CampoMonto";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { Chip, Chips } from "../ui/chip";
import { CampoFecha } from "../ui/fecha";
import { CampoFila } from "../ui/input";
import { Fila, Grupo } from "../ui/lista";
import { Segmented } from "../ui/segmented";
import { Sheet, SheetContent } from "../ui/sheet";
import { comoSeDice, Inicial } from "./Piezas";

/** Con qué se abre la hoja; la persona viene puesta desde su detalle («Me prestó más»). */
export type ValorHojaPrestamo = { persona?: string; direccion?: Direccion };

export const SENTIDOS: { valor: Direccion; etiqueta: string }[] = [
  { valor: "debo", etiqueta: "Yo le debo" },
  { valor: "me_deben", etiqueta: "Me debe" },
];

/**
 * Anotar a mano que alguien te prestó (o que le prestaste). Si ya hay deuda con esa persona, se suma. Si el dinero
 * pasó por una de tus cuentas, se mueve: lo que te prestaron llega a esa cuenta y lo que prestaste sale de ella.
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
  const cuentas = useCuentas({ activo: !!valor });
  const agregar = useAgregarDeuda();
  const enLinea = useEnLinea();
  const [monto, setMonto] = useState("");
  const [direccion, setDireccion] = useState<Direccion>("debo");
  const [persona, setPersona] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (!valor) return;
    setMonto("");
    setDireccion(valor.direccion ?? "debo");
    setPersona(valor.persona ?? "");
    setCuenta("");
    setFecha(hoyIso());
    setNota("");
  }, [valor]);

  const lista = cuentas.data?.cuentas ?? [];
  const n = leerMonto(monto);
  const sugeridas = useMemo(() => [...new Set(personas)].slice(0, 8), [personas]);
  const conPersona = !!valor?.persona;
  // Desde Cuentas solo se anota lo que debes, como una tarjeta: sin elegir el sentido.
  const conSentido = !!valor?.direccion;
  const listo = n !== null && !!persona.trim() && enLinea && !agregar.isPending;

  const unaVez = useUnaVez();
  const enviar = () =>
    unaVez(async () => {
      if (!listo || n === null) return;
      const datos: DatosNuevaDeuda = { persona: persona.trim(), direccion, monto: n, fecha };
      const elegida = lista.find((c) => c.nombre === cuenta);
      if (elegida) datos.cuenta_id = elegida.id;
      if (nota.trim()) datos.descripcion = nota.trim();
      try {
        await agregar.mutateAsync(datos);
        haptico();
        toast.success(
          direccion === "debo" ? `Anoté que le debes ${dinero(n * 100, moneda)} a ${comoSeDice(persona.trim())}` : `Anoté que ${persona.trim()} te debe ${dinero(n * 100, moneda)}`,
          elegida ? { description: direccion === "debo" ? `Llegó a ${elegida.nombre}.` : `Salió de ${elegida.nombre}.` } : undefined,
        );
        alCerrar();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  return (
    <Sheet open={!!valor} onOpenChange={(v) => !v && alCerrar()}>
      {valor ? (
        <SheetContent
          titulo={conPersona ? (direccion === "debo" ? "Me prestó más" : "Le presté más") : "Nueva deuda"}
          descripcion={conPersona ? persona : direccion === "debo" ? "A una persona, banco o tienda" : "Lo que te deben"}
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {agregar.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : "Anotar"}
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
            <CampoMonto id="monto-prestamo" valor={monto} onCambio={setMonto} moneda={moneda} enfocar />
            {conPersona ? null : (
              <>
                {conSentido ? null : (
                  <Segmented<Direccion> etiqueta="Quién debe" valor={direccion} onChange={setDireccion} opciones={SENTIDOS} />
                )}
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
                        placeholder={direccion === "debo" ? "Persona o banco" : "Nombre"}
                        autoCapitalize="words"
                        enterKeyHint="done"
                      />
                    </Fila>
                  </Grupo>
                  {sugeridas.length ? (
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
              </>
            )}

            <div className="space-y-1.5">
              <ElegirCuenta
                id="cuenta-prestamo"
                etiqueta="Cuenta"
                titulo={direccion === "debo" ? "Llegó a" : "Salió de"}
                valor={cuenta}
                alCambiar={setCuenta}
                cuentas={lista}
                placeholder="Ninguna"
              />
              <p className="px-4 text-[13px] leading-snug text-pretty text-muted-foreground">
                {cuenta
                  ? direccion === "debo"
                    ? `Lo sumo a ${cuenta}. No cuenta como ingreso.`
                    : `Lo resto de ${cuenta}. No cuenta como gasto.`
                  : "Si el dinero pasó por una de tus cuentas, elígela y la muevo. Si no, déjalo así."}
              </p>
            </div>

            <Grupo>
              <CampoFecha id="fecha-prestamo" etiqueta="Fecha" valor={fecha} alCambiar={(v) => v && setFecha(v)} max={hoyIso()} />
              <Fila>
                <label htmlFor="nota-prestamo" className="shrink-0">
                  Nota
                </label>
                <CampoFila id="nota-prestamo" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
              </Fila>
            </Grupo>

            <p className="flex items-start gap-1.5 px-4 text-[13px] leading-snug text-muted-foreground">
              <Mic className="mt-0.5 size-3.5 shrink-0" />
              {direccion === "debo"
                ? "También por voz: «le debo 5 mil a mi mamá» o «me prestó 3 mil Juan a Revolut»."
                : "También por voz: «le presté 800 a Juan desde Revolut»."}
            </p>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
