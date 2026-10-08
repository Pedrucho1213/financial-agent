import { ChevronRight, Mic } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { useEnLinea } from "../../lib/conexion";
import { useCuentas, useMoverDinero } from "../../lib/cuentas";
import { aFecha, dinero, hoyIso, leerMonto } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { describirCuentas } from "../../lib/saldos";
import type { DatosMover, EstadoCuenta } from "../../lib/tipos";
import { cn } from "../../lib/utils";
import { CampoMonto } from "../CampoMonto";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { CampoFila } from "../ui/input";
import { Fila, Grupo } from "../ui/lista";
import { Segmented } from "../ui/segmented";
import { SelectNativo } from "../ui/select";
import { Sheet, SheetContent } from "../ui/sheet";

export type TipoMover = DatosMover["tipo"];
export type InicioMover = { tipo?: TipoMover; desde?: string; hacia?: string };

const TIPOS: { valor: TipoMover; etiqueta: string }[] = [
  { valor: "transferencia", etiqueta: "Transferir" },
  { valor: "pago_tarjeta", etiqueta: "Pagar tarjeta" },
  { valor: "retiro", etiqueta: "Retirar" },
];

/**
 * Mover dinero entre sus cuentas: transferencias, pagos (o abonos) a una tarjeta y retiros de cajero.
 * No es gasto ni ingreso: solo cambia de lugar. `valor` trae con qué empezar; null cierra.
 */
export function HojaMover({ valor, moneda, alCerrar }: { valor: InicioMover | null; moneda: string; alCerrar: () => void }) {
  const cuentas = useCuentas({ activo: !!valor });
  const mover = useMoverDinero();
  const enLinea = useEnLinea();
  const [tipo, setTipo] = useState<TipoMover>("transferencia");
  const [monto, setMonto] = useState("");
  const [desde, setDesde] = useState("");
  const [hacia, setHacia] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (!valor) return;
    setTipo(valor.tipo ?? "transferencia");
    setDesde(valor.desde ?? "");
    setHacia(valor.hacia ?? "");
    setMonto("");
    setFecha(hoyIso());
    setNota("");
  }, [valor]);

  const lista = useMemo(() => (cuentas.data?.cuentas ?? []).filter((c) => !c.archivada), [cuentas.data]);
  const tarjetas = useMemo(() => lista.filter((c) => c.esCredito), [lista]);
  const origenes = tipo === "retiro" ? lista.filter((c) => c.tipo !== "efectivo") : lista;
  const destinos = tipo === "pago_tarjeta" ? tarjetas : lista;

  // Una tarjeta elegida como destino en "Transferir" es un pago; el servidor lo anota así.
  useEffect(() => {
    if (tipo === "pago_tarjeta" && hacia && !tarjetas.some((t) => t.id === hacia)) setHacia("");
    if (tipo === "pago_tarjeta" && !hacia && tarjetas.length === 1) setHacia(tarjetas[0]!.id);
  }, [tipo, hacia, tarjetas]);

  const n = leerMonto(monto);
  const faltaDesde = tipo !== "pago_tarjeta" && !desde;
  const faltaHacia = tipo !== "retiro" && !hacia;
  const misma = !!desde && desde === hacia && tipo !== "retiro";
  const listo = n !== null && !faltaDesde && !faltaHacia && !misma && enLinea && !mover.isPending;

  const enviar = async () => {
    if (!listo || n === null) return;
    const datos: DatosMover = { tipo, monto: n, fecha };
    if (desde) datos.desde_id = desde;
    if (hacia && tipo !== "retiro") datos.hacia_id = hacia;
    if (nota.trim()) datos.descripcion = nota.trim();
    try {
      const r = await mover.mutateAsync(datos);
      haptico();
      const como = describirCuentas(r.cuentas, moneda);
      toast.success(
        tipo === "pago_tarjeta" ? "Pago anotado" : tipo === "retiro" ? "Retiro anotado" : "Transferencia anotada",
        como ? { description: como } : undefined,
      );
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  const sinCuentas = cuentas.isSuccess && lista.length === 0;

  return (
    <Sheet open={!!valor} onOpenChange={(v) => !v && alCerrar()}>
      {valor ? (
        <SheetContent
          titulo="Mover dinero"
          descripcion="Transferencias, pagos de tarjeta y retiros"
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {mover.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : "Listo"}
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
            <CampoMonto id="monto-mover" valor={monto} onCambio={setMonto} moneda={moneda} enfocar />
            <Segmented<TipoMover> etiqueta="Qué hiciste" valor={tipo} onChange={setTipo} opciones={TIPOS} />

            {sinCuentas ? (
              <p className="px-4 text-center text-[15px] text-muted-foreground">Primero agrega tus cuentas para elegir de dónde a dónde.</p>
            ) : (
              <Grupo
                pie={
                  misma ? (
                    <span className="text-negative">Elige dos cuentas distintas.</span>
                  ) : tipo === "pago_tarjeta" && !tarjetas.length ? (
                    "Todavía no tienes tarjetas de crédito."
                  ) : tipo === "retiro" ? (
                    "Lo que retires pasa a tu efectivo."
                  ) : tipo === "pago_tarjeta" ? (
                    "Baja lo que debes en la tarjeta. No cuenta como gasto."
                  ) : (
                    "No cuenta como gasto ni ingreso: el dinero solo cambia de lugar."
                  )
                }
              >
                <Elegir
                  id="mover-desde"
                  etiqueta={tipo === "retiro" ? "De" : "Desde"}
                  valor={desde}
                  onCambio={setDesde}
                  cuentas={origenes}
                  vacio={tipo === "pago_tarjeta" ? "No decir" : "Elegir"}
                  moneda={moneda}
                />
                {tipo === "retiro" ? null : (
                  <Elegir
                    id="mover-hacia"
                    etiqueta={tipo === "pago_tarjeta" ? "Tarjeta" : "Hacia"}
                    valor={hacia}
                    onCambio={setHacia}
                    cuentas={destinos}
                    vacio="Elegir"
                    moneda={moneda}
                  />
                )}
              </Grupo>
            )}

            <Grupo>
              <Fila>
                <label htmlFor="mover-fecha" className="shrink-0">
                  Fecha
                </label>
                <div className="relative ml-auto">
                  <span className="pointer-events-none flex h-[34px] items-center rounded-lg bg-fill px-3 text-[17px] text-foreground tabular">
                    {aFecha(fecha).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }).replace(".", "")}
                  </span>
                  <input
                    id="mover-fecha"
                    type="date"
                    required
                    value={fecha}
                    max="2099-12-31"
                    onChange={(e) => e.target.value && setFecha(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </Fila>
              <Fila>
                <label htmlFor="mover-nota" className="shrink-0">
                  Nota
                </label>
                <CampoFila id="mover-nota" value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
              </Fila>
            </Grupo>

            <p className="flex items-start gap-1.5 px-4 text-[13px] leading-snug text-muted-foreground">
              <Mic className="mt-0.5 size-3.5 shrink-0" />
              También por voz: «pasé 2 mil de BBVA a Nu» o «le pagué 3 mil a la Nu».
            </p>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function Elegir({
  id,
  etiqueta,
  valor,
  onCambio,
  cuentas,
  vacio,
  moneda,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  cuentas: EstadoCuenta[];
  vacio: string;
  moneda: string;
}) {
  const elegida = cuentas.find((c) => c.id === valor);
  const cuanto = (c: EstadoCuenta) =>
    c.esCredito
      ? c.deudaCentavos !== null && c.deudaCentavos > 0
        ? ` (debes ${dinero(c.deudaCentavos, moneda)})`
        : ""
      : c.saldoCentavos !== null
        ? ` (${dinero(c.saldoCentavos, moneda)})`
        : "";
  return (
    <SelectNativo
      id={id}
      aria-label={etiqueta}
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      opciones={
        <>
          <option value="">{vacio}</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {cuanto(c)}
            </option>
          ))}
        </>
      }
    >
      <Fila>
        <span className="shrink-0">{etiqueta}</span>
        <span className={cn("min-w-0 flex-1 truncate text-right", elegida ? "text-muted-foreground" : "text-placeholder")}>
          {elegida?.nombre ?? vacio}
        </span>
        <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted-foreground/60" />
      </Fila>
    </SelectNativo>
  );
}
