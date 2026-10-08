import { ChevronRight, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { mensajeDeError } from "../../lib/api";
import { useEnLinea } from "../../lib/conexion";
import { useGuardarCuenta } from "../../lib/cuentas";
import { dinero } from "../../lib/formato";
import { haptico } from "../../lib/haptico";
import { aTextoPesos, leerCantidad, limpiarPesos, nombreTipo } from "../../lib/saldos";
import type { DatosCuenta, EstadoCuenta, TipoCuenta } from "../../lib/tipos";
import { cn } from "../../lib/utils";
import { Spinner } from "../Spinner";
import { Button } from "../ui/button";
import { CampoFila } from "../ui/input";
import { Fila, Grupo } from "../ui/lista";
import { Segmented } from "../ui/segmented";
import { SelectNativo } from "../ui/select";
import { Sheet, SheetContent } from "../ui/sheet";

const TIPOS: { valor: TipoCuenta; etiqueta: string }[] = [
  { valor: "debito", etiqueta: "Débito" },
  { valor: "credito", etiqueta: "Crédito" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "otra", etiqueta: "Otra" },
];

/** Un monedero o unos vales (creados por voz) ocupan el lugar de "Otra" para no perder su tipo. */
function opcionesTipo(actual: TipoCuenta) {
  return TIPOS.some((t) => t.valor === actual) ? TIPOS : [...TIPOS.slice(0, 3), { valor: actual, etiqueta: nombreTipo(actual) }];
}

type Formulario = { nombre: string; tipo: TipoCuenta; saldo: string; deuda: string; limite: string; corte: string; pago: string };

function desde(c: EstadoCuenta | null, tipo: TipoCuenta = "debito"): Formulario {
  if (!c) return { nombre: "", tipo, saldo: "", deuda: "", limite: "", corte: "", pago: "" };
  return {
    nombre: c.nombre,
    tipo: c.tipo,
    saldo: c.esCredito ? "" : aTextoPesos(c.saldoCentavos),
    deuda: c.esCredito ? aTextoPesos(c.deudaCentavos) : "",
    limite: aTextoPesos(c.limiteCentavos),
    corte: c.diaCorte ? String(c.diaCorte) : "",
    pago: c.diaPago ? String(c.diaPago) : "",
  };
}

const DIAS = Array.from({ length: 31 }, (_, i) => String(i + 1));

/**
 * Agregar una cuenta o tarjeta, o decir cuánto tiene. Lo que se deja vacío no cambia (no se sabe, no es 0).
 * `valor`: la cuenta a editar, "nueva" (opcionalmente con el tipo), o null para cerrar.
 */
export function HojaCuenta({
  valor,
  moneda,
  alCerrar,
  alGuardar,
}: {
  valor: EstadoCuenta | { nueva: TipoCuenta } | null;
  moneda: string;
  alCerrar: () => void;
  alGuardar?: (c: EstadoCuenta) => void;
}) {
  const editando = valor && "id" in valor ? valor : null;
  const tipoNueva = valor && "nueva" in valor ? valor.nueva : undefined;
  const guardar = useGuardarCuenta();
  const enLinea = useEnLinea();
  const [f, setF] = useState<Formulario>(() => desde(editando, tipoNueva));
  const original = desde(editando, tipoNueva);

  useEffect(() => {
    if (valor) setF(desde(editando, tipoNueva));
  }, [valor]);

  const poner = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }));
  const credito = f.tipo === "credito";
  const saldo = leerCantidad(f.saldo);
  const deuda = leerCantidad(f.deuda);
  const limite = leerCantidad(f.limite);
  const disponible = credito && deuda !== null && limite ? limite - deuda : null;
  const limiteInvalido = credito && f.limite.trim() !== "" && !limite;

  const datos = (): DatosCuenta => {
    const d: DatosCuenta = {};
    const nombre = f.nombre.trim();
    if (!editando || nombre !== editando.nombre) d.nombre = nombre;
    if (!editando || f.tipo !== original.tipo) d.tipo = f.tipo;
    if (credito) {
      if (f.deuda !== original.deuda && deuda !== null) d.deuda = deuda;
      if (f.limite !== original.limite) {
        if (limite) d.limite = limite;
        else if (editando && !f.limite.trim()) d.limite = null;
      }
      if (f.corte !== original.corte) d.dia_corte = f.corte ? Number(f.corte) : null;
      if (f.pago !== original.pago) d.dia_pago = f.pago ? Number(f.pago) : null;
    } else if (f.saldo !== original.saldo && saldo !== null) d.saldo = saldo;
    // Al crear, solo lo que tiene valor.
    if (!editando) for (const k of Object.keys(d) as (keyof DatosCuenta)[]) if (d[k] === null) delete d[k];
    return d;
  };

  const listo = f.nombre.trim().length > 0 && !limiteInvalido && enLinea && !guardar.isPending;

  const enviar = async () => {
    if (!listo) return;
    const cuerpo = datos();
    if (editando && Object.keys(cuerpo).length === 0) {
      alCerrar();
      return;
    }
    try {
      const estado = await guardar.mutateAsync({ id: editando?.id, datos: cuerpo });
      haptico();
      toast.success(editando ? "Cuenta actualizada" : `Agregué ${estado.nombre}`);
      alGuardar?.(estado);
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  return (
    <Sheet open={!!valor} onOpenChange={(v) => !v && alCerrar()}>
      {valor ? (
        <SheetContent
          titulo={editando ? editando.nombre : "Nueva cuenta"}
          descripcion={editando ? "Cuánto tienes y sus datos" : "Agrega una cuenta o tarjeta"}
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cancelar
            </Button>
          }
          derecha={
            <Button variant="plain" size="text" className="font-semibold" disabled={!listo} onClick={enviar}>
              {guardar.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : editando ? "Guardar" : "Agregar"}
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
            <Grupo>
              <Fila>
                <label htmlFor="cuenta-nombre" className="shrink-0">
                  Nombre
                </label>
                <CampoFila
                  id="cuenta-nombre"
                  value={f.nombre}
                  maxLength={60}
                  onChange={(e) => poner("nombre", e.target.value)}
                  placeholder="BBVA, Nu, Efectivo…"
                  autoCapitalize="words"
                  autoFocus={!editando}
                />
              </Fila>
            </Grupo>

            <Segmented<TipoCuenta> etiqueta="Tipo de cuenta" valor={f.tipo} onChange={(v) => poner("tipo", v)} opciones={opcionesTipo(original.tipo)} />

            {credito ? (
              <Grupo
                pie={
                  disponible !== null
                    ? disponible >= 0
                      ? `Te quedan ${dinero(Math.round(disponible * 100), moneda)} disponibles.`
                      : `Te pasaste del límite por ${dinero(Math.round(-disponible * 100), moneda)}.`
                    : limiteInvalido
                      ? <span className="text-negative">El límite tiene que ser mayor que cero.</span>
                      : "Lo que debes es lo usado de la tarjeta. Déjalo vacío si no lo sabes."
                }
              >
                <CampoPesos id="cuenta-deuda" etiqueta="Debes" valor={f.deuda} onCambio={(v) => poner("deuda", v)} />
                <CampoPesos id="cuenta-limite" etiqueta="Límite" valor={f.limite} onCambio={(v) => poner("limite", v)} />
                <CampoDia id="cuenta-corte" etiqueta="Día de corte" valor={f.corte} onCambio={(v) => poner("corte", v)} />
                <CampoDia id="cuenta-pago" etiqueta="Día límite de pago" valor={f.pago} onCambio={(v) => poner("pago", v)} />
              </Grupo>
            ) : (
              <Grupo pie={editando?.conocido ? "Desde aquí sumo y resto lo que anotes con esta cuenta." : "Déjalo vacío si no lo sabes: no cuenta como cero."}>
                <CampoPesos id="cuenta-saldo" etiqueta="Tienes" valor={f.saldo} onCambio={(v) => poner("saldo", v)} />
              </Grupo>
            )}

            <p className="flex items-start gap-1.5 px-4 text-[13px] leading-snug text-muted-foreground">
              <Mic className="mt-0.5 size-3.5 shrink-0" />
              {credito ? "También por voz: «la Nu tiene límite de 30 mil y debo 5 mil»." : "También por voz: «tengo 20 mil en BBVA»."}
            </p>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function CampoPesos({ id, etiqueta, valor, onCambio }: { id: string; etiqueta: string; valor: string; onCambio: (v: string) => void }) {
  return (
    <Fila>
      <label htmlFor={id} className="shrink-0">
        {etiqueta}
      </label>
      <span className={cn("ml-auto shrink-0", valor ? "text-foreground" : "text-placeholder")}>$</span>
      <CampoFila
        id={id}
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        placeholder="No lo sé"
        value={valor}
        onChange={(e) => onCambio(limpiarPesos(e.target.value))}
        className="w-auto flex-1 tabular"
      />
    </Fila>
  );
}

function CampoDia({ id, etiqueta, valor, onCambio }: { id: string; etiqueta: string; valor: string; onCambio: (v: string) => void }) {
  return (
    <SelectNativo
      id={id}
      aria-label={etiqueta}
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      opciones={
        <>
          <option value="">Sin decir</option>
          {DIAS.map((d) => (
            <option key={d} value={d}>
              Día {d}
            </option>
          ))}
        </>
      }
    >
      <Fila>
        <span className="shrink-0">{etiqueta}</span>
        <span className={cn("min-w-0 flex-1 truncate text-right", valor ? "text-muted-foreground" : "text-placeholder")}>
          {valor ? `Día ${valor}` : "Sin decir"}
        </span>
        <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted-foreground/60" />
      </Fila>
    </SelectNativo>
  );
}
