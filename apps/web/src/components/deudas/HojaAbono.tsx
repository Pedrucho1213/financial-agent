import { Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { useEnLinea } from "../../lib/conexion";
import { useCuentas } from "../../lib/cuentas";
import { type DatosAbono, useAbonar } from "../../lib/deudas";
import { dinero, leerMonto } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import type { DeudaPersona } from "../../lib/tipos";
import { useUnaVez } from "../../lib/una-vez";
import { ElegirCuenta } from "../cuentas/ElegirCuenta";
import { CampoMonto } from "../CampoMonto";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { Chip, Chips } from "../ui/chip";
import { Sheet, SheetContent } from "../ui/sheet";
import { comoSeDice } from "./Piezas";

/**
 * Registrar un abono a una deuda (o que te pagaron algo de lo que te deben). Con la cuenta, el dinero sale de ella (o
 * llega a ella); sin cuenta, solo baja la deuda.
 */
export function HojaAbono({ deuda, moneda, alCerrar }: { deuda: DeudaPersona | null; moneda: string; alCerrar: () => void }) {
  const cuentas = useCuentas({ activo: !!deuda });
  const abonar = useAbonar();
  const enLinea = useEnLinea();
  const [monto, setMonto] = useState("");
  const [cuenta, setCuenta] = useState("");

  useEffect(() => {
    if (!deuda) return;
    setMonto("");
    setCuenta("");
  }, [deuda]);

  const meDebe = deuda?.direccion === "me_deben";
  const falta = deuda?.pendienteCentavos ?? 0;
  const n = leerMonto(monto);
  const centavos = n === null ? null : Math.round(n * 100);
  const demasiado = centavos !== null && centavos > falta;
  const listo = centavos !== null && !demasiado && enLinea && !abonar.isPending;
  const queda = centavos === null ? null : falta - centavos;

  const unaVez = useUnaVez();
  const enviar = () =>
    unaVez(async () => {
      if (!deuda?.id || !listo || n === null) return;
      const datos: DatosAbono = { monto: n };
      const elegida = (cuentas.data?.cuentas ?? []).find((c) => c.nombre === cuenta);
      if (elegida) datos.cuenta_id = elegida.id;
      try {
        await abonar.mutateAsync({ id: deuda.id, datos });
        haptico();
        toast.success(
          queda !== null && queda <= 0 ? (meDebe ? `${deuda.persona} ya te pagó todo` : `Saldaste lo de ${comoSeDice(deuda.persona)}`) : meDebe ? "Pago anotado" : "Abono anotado",
          { description: queda !== null && queda > 0 ? `${meDebe ? "Te debe" : "Le debes"} ${dinero(queda, moneda)}.` : undefined },
        );
        alCerrar();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  const poner = (c: number) => setMonto(String(Math.round(c) / 100));

  return (
    <Sheet open={!!deuda} onOpenChange={(v) => !v && alCerrar()}>
      {deuda ? (
        <SheetContent
          // Corto: a 320 px, entre «Cancelar» y «Anotar», un título largo se corta.
          titulo={meDebe ? "Pago" : "Abono"}
          descripcion={meDebe ? `Lo que te pagó ${deuda.persona}` : `A ${comoSeDice(deuda.persona)}`}
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {abonar.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : "Anotar"}
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
            <div>
              <CampoMonto id="monto-abono" valor={monto} onCambio={setMonto} moneda={moneda} enfocar />
              <p data-testid="queda" className={"mt-1 text-center text-[15px] " + (demasiado ? "text-negative" : "text-muted-foreground")}>
                {demasiado ? (
                  <>
                    Es más de lo que falta: <span className="whitespace-nowrap tabular">{dinero(falta, moneda)}</span>
                  </>
                ) : queda === null ? (
                  <>
                    {meDebe ? "Te debe" : "Le debes"} <span className="whitespace-nowrap tabular">{dinero(falta, moneda)}</span>
                  </>
                ) : queda <= 0 ? (
                  "Con esto queda saldada"
                ) : (
                  <>
                    Quedará en <span className="whitespace-nowrap tabular">{dinero(queda, moneda)}</span>
                  </>
                )}
              </p>
            </div>

            <Chips aria-label="Montos rápidos" className="justify-center">
              <Chip activo={centavos === falta} onClick={() => poner(falta)}>
                Todo <span className="tabular">{dinero(falta, moneda)}</span>
              </Chip>
              {falta >= 2_00 ? (
                <Chip activo={centavos === Math.round(falta / 2)} onClick={() => poner(falta / 2)}>
                  La mitad
                </Chip>
              ) : null}
            </Chips>

            <ElegirCuenta
              id="cuenta-abono"
              etiqueta="Cuenta"
              titulo={meDebe ? "Llegó a" : "Pagado desde"}
              valor={cuenta}
              alCambiar={setCuenta}
              cuentas={cuentas.data?.cuentas ?? []}
              placeholder="Ninguna"
            />

            <p className="flex items-start gap-1.5 px-4 text-[13px] leading-snug text-muted-foreground">
              <Mic className="mt-0.5 size-3.5 shrink-0" />
              {meDebe
                ? `También por voz: «${deuda.persona} me depositó 500».`
                : `También por voz: «le transferí 2 mil a ${comoSeDice(deuda.persona)} desde Revolut».`}
            </p>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
