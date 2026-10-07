import { ChevronRight, Mic, Trash } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "../components/Spinner";
import { Button } from "../components/ui/button";
import { CampoFila } from "../components/ui/input";
import { Fila, FilaBoton, Grupo } from "../components/ui/lista";
import { Segmented } from "../components/ui/segmented";
import { SelectNativo } from "../components/ui/select";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { eliminarConDeshacer, olvidarDeshacer } from "../lib/acciones";
import { mensajeDeError } from "../lib/api";
import { OpcionesCategorias } from "../lib/categorias";
import { useEnLinea } from "../lib/conexion";
import { useCategorias, useGuardarMovimiento } from "../lib/consultas";
import { avisarCambiosSinGuardar, cerrarEditor, useEditor } from "../lib/editor";
import { aFecha, fechaHora, hoyIso, leerMonto } from "../lib/formato";
import type { DatosMovimiento, MovimientoApp, TipoMovimiento } from "../lib/tipos";
import { cn } from "../lib/utils";

type Formulario = {
  tipo: TipoMovimiento;
  monto: string;
  categoriaId: string;
  comercio: string;
  descripcion: string;
  fecha: string;
  cuenta: string;
};

function desde(m: MovimientoApp | null): Formulario {
  if (!m) return { tipo: "gasto", monto: "", categoriaId: "", comercio: "", descripcion: "", fecha: hoyIso(), cuenta: "" };
  return {
    tipo: m.tipo,
    monto: String(Math.abs(m.montoCentavos) / 100),
    categoriaId: m.categoriaId ?? "",
    comercio: m.comercio ?? "",
    descripcion: m.descripcion ?? "",
    fecha: m.fecha,
    cuenta: m.cuenta ?? "",
  };
}

const TIPOS_SEGMENTO: { valor: TipoMovimiento; etiqueta: string }[] = [
  { valor: "gasto", etiqueta: "Gasto" },
  { valor: "ingreso", etiqueta: "Ingreso" },
  { valor: "transferencia", etiqueta: "Traspaso" },
  { valor: "pago_tarjeta", etiqueta: "Pago tarjeta" },
];

export function EditorMovimiento() {
  const { abierto, movimiento, clave } = useEditor();
  return (
    <Sheet open={abierto} onOpenChange={(v) => !v && cerrarEditor()}>
      {abierto ? <Contenido key={clave} movimiento={movimiento} /> : null}
    </Sheet>
  );
}

function Contenido({ movimiento }: { movimiento: MovimientoApp | null }) {
  const enLinea = useEnLinea();
  const original = useMemo(() => desde(movimiento), [movimiento]);
  const [f, setF] = useState<Formulario>(original);
  const categorias = useCategorias();
  const guardar = useGuardarMovimiento();
  const campoMonto = useRef<HTMLInputElement>(null);
  const editando = !!movimiento;

  const poner = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }));
  const conCategoria = f.tipo === "gasto" || f.tipo === "ingreso";
  const categoriasDelTipo = useMemo(
    () => (categorias.data ?? []).filter((c) => conCategoria && c.tipo === f.tipo),
    [categorias.data, conCategoria, f.tipo],
  );
  const categoriaActual = categorias.data?.find((c) => c.id === f.categoriaId);

  // Al cambiar de tipo, una categoría del otro tipo ya no aplica.
  useEffect(() => {
    if (!f.categoriaId || !categorias.data) return;
    if (!categoriasDelTipo.some((c) => c.id === f.categoriaId)) setF((x) => ({ ...x, categoriaId: "" }));
  }, [categoriasDelTipo, f.categoriaId, categorias.data]);

  useEffect(() => {
    if (editando) return;
    // Enfocar el monto después de que la hoja termina de subir.
    const id = window.setTimeout(() => campoMonto.current?.focus(), 420);
    return () => window.clearTimeout(id);
  }, [editando]);

  const sinGuardar = JSON.stringify(f) !== JSON.stringify(original);
  useEffect(() => avisarCambiosSinGuardar(sinGuardar), [sinGuardar]);
  useEffect(() => () => avisarCambiosSinGuardar(false), []);

  const monto = leerMonto(f.monto);
  const valido = monto !== null && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha);

  const datos = (): DatosMovimiento => {
    const limpio = (s: string) => s.trim() || null;
    const completo: Required<Pick<DatosMovimiento, "tipo" | "monto" | "fecha">> & DatosMovimiento = {
      tipo: f.tipo,
      monto: monto ?? 0,
      fecha: f.fecha,
      categoria_id: conCategoria ? f.categoriaId || null : null,
      comercio: limpio(f.comercio),
      descripcion: limpio(f.descripcion),
      cuenta: limpio(f.cuenta),
    };
    if (!editando) {
      // Al crear, solo lo que tiene valor.
      return Object.fromEntries(Object.entries(completo).filter(([, v]) => v !== null && v !== "")) as DatosMovimiento;
    }
    // Al editar, solo lo que cambió.
    const antes = original;
    const cambios: DatosMovimiento = {};
    if (f.tipo !== antes.tipo) cambios.tipo = f.tipo;
    if (monto !== leerMonto(antes.monto)) cambios.monto = completo.monto;
    if (f.fecha !== antes.fecha) cambios.fecha = f.fecha;
    if ((completo.categoria_id ?? "") !== antes.categoriaId) cambios.categoria_id = completo.categoria_id;
    if (f.comercio.trim() !== antes.comercio) cambios.comercio = completo.comercio;
    if (f.descripcion.trim() !== antes.descripcion) cambios.descripcion = completo.descripcion;
    if (f.cuenta.trim() !== antes.cuenta) cambios.cuenta = completo.cuenta;
    return cambios;
  };

  const enviar = () => {
    if (!valido || guardar.isPending) return;
    const cuerpo = datos();
    if (editando && Object.keys(cuerpo).length === 0) {
      cerrarEditor();
      return;
    }
    guardar.mutate(
      { id: movimiento?.id, datos: cuerpo },
      {
        onSuccess: () => {
          olvidarDeshacer(); // este cambio es ahora el último: un Deshacer viejo lo desharía a él
          toast.success(editando ? "Cambios guardados" : "Movimiento agregado");
          cerrarEditor();
        },
        onError: (e) => toast.error(mensajeDeError(e)),
      },
    );
  };

  return (
    <SheetContent
      titulo={editando ? "Movimiento" : "Nuevo movimiento"}
      descripcion={editando ? "Edita el movimiento" : "Agrega un movimiento"}
      izquierda={
        <Button variant="plain" size="text" onClick={cerrarEditor}>
          Cancelar
        </Button>
      }
      derecha={
        <Button
          variant="plain"
          size="text"
          className="font-semibold"
          disabled={!valido || !enLinea || guardar.isPending}
          onClick={enviar}
        >
          {guardar.isPending ? <Spinner className="size-5" etiqueta="Guardando" /> : editando ? "Guardar" : "Agregar"}
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
        className="space-y-6 pb-2"
      >
        <div className="flex flex-col items-center pt-3 pb-1">
          <label htmlFor="monto" className="sr-only">
            Monto
          </label>
          <div
            className={cn(
              "flex max-w-full items-start justify-center font-bold tracking-[-0.03em] tabular transition-[font-size] duration-200 ease-ios",
              f.monto.length > 9 ? "text-[44px]" : f.monto.length > 7 ? "text-[52px]" : "text-[60px]",
              f.tipo === "ingreso" && "text-positive",
            )}
          >
            <span className={cn("mt-[0.14em] mr-0.5 text-[0.52em] leading-none", !f.monto && "text-placeholder")}>$</span>
            {/* El ancho lo da una copia invisible del texto, así el campo mide justo lo que se escribe. */}
            <span className="inline-grid">
              <span aria-hidden className="invisible col-start-1 row-start-1 leading-[1.1] whitespace-pre">
                {f.monto || "0"}
              </span>
              <input
                ref={campoMonto}
                id="monto"
                name="monto"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                placeholder="0"
                size={1}
                value={f.monto}
                onChange={(e) => poner("monto", e.target.value.replace(/[^\d.,]/g, "").slice(0, 12))}
                className="col-start-1 row-start-1 w-full min-w-0 bg-transparent p-0 text-center text-[1em] leading-[1.1] font-bold tracking-[inherit] outline-none placeholder:text-placeholder"
              />
            </span>
          </div>
          <span className="text-[13px] font-medium text-muted-foreground">{movimiento?.moneda ?? "MXN"}</span>
        </div>

        <Segmented<TipoMovimiento>
          etiqueta="Tipo de movimiento"
          valor={f.tipo}
          onChange={(v) => poner("tipo", v)}
          opciones={TIPOS_SEGMENTO}
        />

        <Grupo>
          {conCategoria ? (
            <SelectNativo
              aria-label="Categoría"
              value={f.categoriaId}
              onChange={(e) => poner("categoriaId", e.target.value)}
              opciones={
                <>
                  <option value="">Sin categoría</option>
                  <OpcionesCategorias categorias={categoriasDelTipo} />
                </>
              }
            >
              <Fila>
                <span className="shrink-0">Categoría</span>
                <span className={cn("min-w-0 flex-1 truncate text-right", categoriaActual ? "text-muted-foreground" : "text-placeholder")}>
                  {categoriaActual?.nombreCompleto.replace(" > ", " › ") ?? "Elegir"}
                </span>
                <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted-foreground/60" />
              </Fila>
            </SelectNativo>
          ) : null}
          <Fila>
            <label htmlFor="comercio" className="shrink-0">
              Comercio
            </label>
            <CampoFila
              id="comercio"
              value={f.comercio}
              onChange={(e) => poner("comercio", e.target.value)}
              placeholder="Opcional"
              autoCapitalize="words"
              enterKeyHint="next"
            />
          </Fila>
          <Fila>
            <label htmlFor="descripcion" className="shrink-0">
              Nota
            </label>
            <CampoFila
              id="descripcion"
              value={f.descripcion}
              onChange={(e) => poner("descripcion", e.target.value)}
              placeholder="Opcional"
              enterKeyHint="next"
            />
          </Fila>
        </Grupo>

        <Grupo>
          <Fila>
            <label htmlFor="fecha" className="shrink-0">
              Fecha
            </label>
            <div className="relative ml-auto">
              <span className="pointer-events-none flex h-[34px] items-center rounded-lg bg-fill px-3 text-[17px] text-foreground tabular">
                {aFecha(f.fecha).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }).replace(".", "")}
              </span>
              <input
                id="fecha"
                type="date"
                required
                value={f.fecha}
                max="2099-12-31"
                onChange={(e) => e.target.value && poner("fecha", e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </div>
          </Fila>
          <Fila>
            <label htmlFor="cuenta" className="shrink-0">
              Cuenta
            </label>
            <CampoFila
              id="cuenta"
              value={f.cuenta}
              onChange={(e) => poner("cuenta", e.target.value)}
              placeholder="Efectivo, BBVA, Nu…"
              enterKeyHint="done"
            />
          </Fila>
        </Grupo>

        {movimiento?.textoOriginal ? (
          <Grupo
            titulo="Lo que dijiste"
            pie={movimiento.ocurridoEn ? `Registrado ${fechaHora(movimiento.ocurridoEn)}` : undefined}
          >
            <div className="flex gap-3 px-4 py-3">
              <Mic aria-hidden className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
              <p data-seleccionable className="text-[17px] leading-snug">
                «{movimiento.textoOriginal}»
              </p>
            </div>
          </Grupo>
        ) : null}

        {movimiento ? (
          <Grupo>
            <FilaBoton
              className="justify-center text-destructive"
              disabled={!enLinea}
              onClick={() => void eliminarConDeshacer(movimiento, cerrarEditor)}
            >
              <Trash className="size-[18px]" />
              <span>Eliminar movimiento</span>
            </FilaBoton>
          </Grupo>
        ) : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </SheetContent>
  );
}
