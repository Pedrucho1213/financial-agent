import { useEffect, useState } from "react";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { useEnLinea } from "../../lib/conexion";
import { type DatosEditarDeuda, type Direccion, hashDeuda, useEditarDeuda } from "../../lib/deudas";
import { dinero, leerMonto } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { navegar } from "../../lib/ruta";
import type { DeudaPersona } from "../../lib/tipos";
import { useUnaVez } from "../../lib/una-vez";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { CampoFila } from "../ui/input";
import { Fila, Grupo } from "../ui/lista";
import { Segmented } from "../ui/segmented";
import { Sheet, SheetContent } from "../ui/sheet";
import { SENTIDOS } from "./HojaPrestamo";
import { Inicial } from "./Piezas";

const pesos = (centavos: number) => String(Math.round(centavos) / 100);
const aCentavos = (texto: string) => {
  const n = leerMonto(texto);
  return n === null ? null : Math.round(n * 100);
};

/**
 * Corregir lo anotado de una deuda: el nombre, quién le debe a quién, el total o lo que falta, y la nota. No mueve
 * cuentas ni crea abonos. El total y lo que falta van ligados: cambiar uno recalcula el otro con lo ya abonado.
 */
export function HojaEditarDeuda({ deuda, moneda, alCerrar }: { deuda: DeudaPersona | null; moneda: string; alCerrar: () => void }) {
  const editar = useEditarDeuda();
  const enLinea = useEnLinea();
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState<Direccion>("debo");
  const [total, setTotal] = useState("");
  const [falta, setFalta] = useState("");
  const [cambio, setCambio] = useState<"monto" | "pendiente" | null>(null);
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (!deuda) return;
    setNombre(deuda.persona);
    setDireccion(deuda.direccion);
    setTotal(pesos(deuda.prestadoCentavos));
    setFalta(pesos(deuda.pendienteCentavos));
    setCambio(null);
    setNota(deuda.descripcion ?? "");
  }, [deuda]);

  const pagado = deuda?.pagadoCentavos ?? 0;
  const cTotal = aCentavos(total);
  const cFalta = aCentavos(falta);
  const bajoLoPagado = cambio === "monto" && cTotal !== null && cTotal < pagado;

  const datos: DatosEditarDeuda = {};
  if (deuda) {
    if (nombre.trim() && nombre.trim() !== deuda.persona) datos.persona = nombre.trim();
    if (direccion !== deuda.direccion) datos.direccion = direccion;
    if (cambio === "monto" && cTotal !== null && cTotal !== deuda.prestadoCentavos) datos.monto = cTotal / 100;
    if (cambio === "pendiente" && cFalta !== null && cFalta !== deuda.pendienteCentavos) datos.pendiente = cFalta / 100;
    if ((nota.trim() || null) !== (deuda.descripcion ?? null)) datos.descripcion = nota.trim() || null;
  }
  const montoInvalido = (cambio === "monto" && cTotal === null) || (cambio === "pendiente" && cFalta === null) || bajoLoPagado;
  const listo = !!deuda?.id && !!nombre.trim() && Object.keys(datos).length > 0 && !montoInvalido && enLinea && !editar.isPending;

  const unaVez = useUnaVez();
  const enviar = () =>
    unaVez(async () => {
      if (!deuda?.id || !listo) return;
      try {
        const nueva = await editar.mutateAsync({ id: deuda.id, datos });
        haptico();
        toast.success("Deuda corregida");
        alCerrar();
        // Con otro nombre o sentido, el detalle vive en otra dirección.
        if (datos.persona || datos.direccion) navegar(hashDeuda(nueva ?? { persona: datos.persona ?? deuda.persona, direccion }), { reemplazar: true });
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  return (
    <Sheet open={!!deuda} onOpenChange={(v) => !v && alCerrar()}>
      {deuda ? (
        <SheetContent
          titulo="Editar"
          descripcion={deuda.persona}
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {editar.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : "Guardar"}
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
            <div className="flex justify-center pt-2">
              <Inicial nombre={nombre.trim() || deuda.persona} tamano={72} />
            </div>
            <Grupo>
              <Fila>
                <label htmlFor="nombre-deuda" className="shrink-0">
                  Nombre
                </label>
                <CampoFila id="nombre-deuda" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} autoCapitalize="words" enterKeyHint="done" />
              </Fila>
            </Grupo>
            <Segmented<Direccion> etiqueta="Quién debe" valor={direccion} onChange={setDireccion} opciones={SENTIDOS} />

            <Grupo
              pie={
                bajoLoPagado ? (
                  <span className="text-negative">
                    Ya {direccion === "debo" ? "abonaste" : "te pagó"} <span className="whitespace-nowrap">{dinero(pagado, moneda)}</span>: el total no
                    puede ser menor.
                  </span>
                ) : pagado > 0 ? (
                  <>
                    Ya {direccion === "debo" ? "abonaste" : "te pagó"} <span className="whitespace-nowrap">{dinero(pagado, moneda)}</span>. Si cambias uno,
                    el otro se ajusta.
                  </>
                ) : (
                  "Si cambias uno, el otro se ajusta."
                )
              }
            >
              <Fila>
                <label htmlFor="total-deuda" className="shrink-0">
                  {direccion === "debo" ? "Te prestó" : "Le prestaste"}
                </label>
                <CampoFila
                  id="total-deuda"
                  inputMode="decimal"
                  value={total}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.,]/g, "").slice(0, 12);
                    setTotal(v);
                    setCambio("monto");
                    const c = aCentavos(v);
                    if (c !== null) setFalta(pesos(Math.max(0, c - pagado)));
                  }}
                />
              </Fila>
              <Fila>
                <label htmlFor="falta-deuda" className="shrink-0">
                  {direccion === "debo" ? "Te falta pagar" : "Te falta cobrar"}
                </label>
                <CampoFila
                  id="falta-deuda"
                  inputMode="decimal"
                  value={falta}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.,]/g, "").slice(0, 12);
                    setFalta(v);
                    setCambio("pendiente");
                    const c = aCentavos(v);
                    if (c !== null) setTotal(pesos(c + pagado));
                  }}
                />
              </Fila>
            </Grupo>

            <Grupo pie="Esto solo corrige lo anotado: no mueve tus cuentas. Para bajar la deuda con dinero, registra un abono.">
              <Fila>
                <label htmlFor="nota-deuda" className="shrink-0">
                  Nota
                </label>
                <CampoFila id="nota-deuda" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
              </Fila>
            </Grupo>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
