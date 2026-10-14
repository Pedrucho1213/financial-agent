import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Mic, Plus, Trash } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ElegirCuenta } from "../components/cuentas/ElegirCuenta";
import { LogoCategoria, LogoMarca } from "../components/Logo";
import { Spinner } from "../components/Spinner";
import { Button } from "../components/ui/button";
import { Chip, ChipVisual, Chips, TituloChips } from "../components/ui/chip";
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
import { useCuentas, useEtiquetas, useGuardarEtiqueta } from "../lib/cuentas";
import { useUnaVez } from "../lib/una-vez";
import { avisarCambiosSinGuardar, cerrarEditor, useEditor } from "../lib/editor";
import { aFecha, fechaHora, hoyIso, leerMonto } from "../lib/formato";
import { marcaDe } from "../lib/marcas";
import type { Categoria, DatosMovimiento, MovimientoApp, TipoMovimiento } from "../lib/tipos";
import { cn } from "../lib/utils";

type Formulario = {
  tipo: TipoMovimiento;
  monto: string;
  categoriaId: string;
  comercio: string;
  descripcion: string;
  fecha: string;
  cuenta: string;
  destino: string;
  etiquetas: string[];
};

function desde(m: MovimientoApp | null): Formulario {
  if (!m) return { tipo: "gasto", monto: "", categoriaId: "", comercio: "", descripcion: "", fecha: hoyIso(), cuenta: "", destino: "", etiquetas: [] };
  return {
    tipo: m.tipo,
    monto: String(Math.abs(m.montoCentavos) / 100),
    categoriaId: m.categoriaId ?? "",
    comercio: m.comercio ?? "",
    descripcion: m.descripcion ?? "",
    fecha: m.fecha,
    cuenta: m.cuenta ?? "",
    destino: m.cuentaDestino ?? "",
    etiquetas: (m.etiquetas ?? []).map((e) => e.id),
  };
}

const mismas = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// Sin historial del mes, estas van primero (si existen en sus categorías).
const COMUNES = {
  gasto: ["café", "súper", "restaurantes", "transporte", "gasolina", "suscripciones", "farmacia", "entretenimiento", "compras"],
  ingreso: ["sueldo", "freelance"],
};
const CATEGORIAS_A_LA_VISTA = 8;

/** "Hoy, 14 oct", "Ayer, 13 oct", "6 oct" o "6 oct 2025". */
function etiquetaFecha(iso: string) {
  const d = aFecha(iso);
  const corta = d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
  const hoy = new Date();
  if (iso === hoyIso(hoy)) return `Hoy, ${corta}`;
  if (iso === hoyIso(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1))) return `Ayer, ${corta}`;
  return iso.slice(0, 4) === hoyIso(hoy).slice(0, 4) ? corta : `${corta} ${iso.slice(0, 4)}`;
}

const TIPOS_SEGMENTO: { valor: TipoMovimiento; etiqueta: string; corta?: string }[] = [
  { valor: "gasto", etiqueta: "Gasto" },
  { valor: "ingreso", etiqueta: "Ingreso" },
  { valor: "transferencia", etiqueta: "Traspaso" },
  { valor: "pago_tarjeta", etiqueta: "Pago tarjeta", corta: "Tarjeta" },
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
  const mueve = !conCategoria;
  // Con un servidor que tiene cuentas y etiquetas: elegir de sus cuentas (las más usadas primero) y sus etiquetas.
  const cuentas = useCuentas();
  const etiquetas = useEtiquetas("todo");
  const listaCuentas = cuentas.data?.cuentas ?? [];
  const categoriasDelTipo = useMemo(
    () => (categorias.data ?? []).filter((c) => conCategoria && c.tipo === f.tipo),
    [categorias.data, conCategoria, f.tipo],
  );
  const marca = marcaDe(f.comercio);

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
      cuenta_destino: mueve ? limpio(f.destino) : null,
    };
    if (f.etiquetas.length) completo.etiquetas = f.etiquetas;
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
    if (mueve && f.destino.trim() !== antes.destino) cambios.cuenta_destino = completo.cuenta_destino;
    if (!mismas(f.etiquetas, antes.etiquetas)) cambios.etiquetas = f.etiquetas;
    return cambios;
  };

  const unaVez = useUnaVez();
  const enviar = () =>
    unaVez(async () => {
      if (!valido || guardar.isPending) return;
      const cuerpo = datos();
      if (editando && Object.keys(cuerpo).length === 0) {
        cerrarEditor();
        return;
      }
      try {
        await guardar.mutateAsync({ id: movimiento?.id, datos: cuerpo });
        olvidarDeshacer(); // este cambio es ahora el último: un Deshacer viejo lo desharía a él
        toast.success(editando ? "Cambios guardados" : "Movimiento agregado");
        cerrarEditor();
      } catch (e) {
        toast.error(mensajeDeError(e));
      }
    });

  return (
    <SheetContent
      // En 320 px «Nuevo» solo, para que no termine en «…» junto a Cancelar y Agregar.
      titulo={
        editando ? (
          "Movimiento"
        ) : (
          <>
            Nuevo<span className="max-[359px]:hidden"> movimiento</span>
          </>
        )
      }
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
          void enviar();
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
                className="col-start-1 row-start-1 w-0 min-w-full bg-transparent p-0 text-center text-[1em] leading-[1.1] font-bold tracking-[inherit] outline-none placeholder:text-placeholder"
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

        {conCategoria ? (
          <ElegirCategoria
            categorias={categoriasDelTipo}
            tipo={f.tipo === "ingreso" ? "ingreso" : "gasto"}
            valor={f.categoriaId}
            alCambiar={(v) => poner("categoriaId", v)}
          />
        ) : null}

        <Grupo>
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
            {marca ? <LogoMarca clave={marca} tamano={22} className="-ml-1" /> : null}
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
          <Fila>
            <label htmlFor="fecha" className="shrink-0">
              Fecha
            </label>
            <div className="relative ml-auto">
              <span className="pointer-events-none flex h-[32px] items-center rounded-full bg-fill px-3 text-[16px] text-foreground tabular">
                {etiquetaFecha(f.fecha)}
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
        </Grupo>

        <ElegirCuenta
          id="cuenta"
          etiqueta={mueve ? "Desde" : "Cuenta"}
          titulo={mueve ? "Desde" : f.tipo === "ingreso" ? "Entró a" : "Pagado con"}
          valor={f.cuenta}
          alCambiar={(v) => poner("cuenta", v)}
          cuentas={listaCuentas}
          placeholder="Efectivo, BBVA, Nu…"
        />
        {mueve ? (
          <ElegirCuenta
            id="destino"
            etiqueta={f.tipo === "pago_tarjeta" ? "Tarjeta" : "Hacia"}
            titulo={f.tipo === "pago_tarjeta" ? "Tarjeta" : "Hacia"}
            valor={f.destino}
            alCambiar={(v) => poner("destino", v)}
            cuentas={listaCuentas}
            placeholder={f.tipo === "pago_tarjeta" ? "Nu, Banamex…" : "Otra cuenta tuya"}
            primeroCredito={f.tipo === "pago_tarjeta"}
          />
        ) : null}

        {etiquetas.data || f.etiquetas.length ? (
          <ElegirEtiquetas
            disponibles={etiquetas.data ?? movimiento?.etiquetas ?? []}
            elegidas={f.etiquetas}
            alCambiar={(ids) => poner("etiquetas", ids)}
          />
        ) : null}

        {conCategoria && !editando ? (
          <p className="-mt-3 px-4 text-[13px] leading-snug text-muted-foreground">
            El logo sale solo cuando reconozco el comercio. Si no, uso el ícono de la categoría.
          </p>
        ) : null}

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

/** Las categorías del tipo en chips: las que más usa (o las comunes) a la vista; "Todas" abre la rueda con todas. */
function ElegirCategoria({
  categorias,
  tipo,
  valor,
  alCambiar,
}: {
  categorias: Categoria[];
  tipo: "gasto" | "ingreso";
  valor: string;
  alCambiar: (id: string) => void;
}) {
  const qc = useQueryClient();
  // Cuántas veces la usó, de los movimientos que la app ya tiene guardados (sin pedir nada más).
  const usos = useMemo(() => {
    const vistos = new Set<string>();
    const cuenta = new Map<string, number>();
    for (const [, datos] of qc.getQueriesData<{ pages?: { movimientos?: MovimientoApp[] }[] }>({ queryKey: ["movimientos"] })) {
      if (!Array.isArray(datos?.pages)) continue;
      for (const m of datos.pages.flatMap((p) => p.movimientos ?? [])) {
        if (!m.categoriaId || vistos.has(m.id)) continue;
        vistos.add(m.id);
        cuenta.set(m.categoriaId, (cuenta.get(m.categoriaId) ?? 0) + 1);
      }
    }
    return cuenta;
  }, [qc]);
  const vista = useMemo(() => {
    const comun = (c: Categoria) => {
      const i = COMUNES[tipo].indexOf(c.nombre.toLowerCase());
      return i < 0 ? COMUNES[tipo].length : i;
    };
    // Una principal con hijas ("Comida") va después de sus hijas: casi siempre se elige la hija.
    const conHijas = (c: Categoria) => Number(!c.padreId && categorias.some((h) => h.padreId === c.id));
    const orden = categorias
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (usos.get(b.c.id) ?? 0) - (usos.get(a.c.id) ?? 0) || conHijas(a.c) - conHijas(b.c) || comun(a.c) - comun(b.c) || a.i - b.i)
      .map(({ c }) => c);
    const primeras = orden.slice(0, CATEGORIAS_A_LA_VISTA);
    const elegida = categorias.find((c) => c.id === valor);
    if (!elegida || primeras.includes(elegida)) return primeras;
    return [elegida, ...primeras.slice(0, CATEGORIAS_A_LA_VISTA - 1)];
  }, [categorias, tipo, usos, valor]);

  return (
    <section>
      <TituloChips>Categoría</TituloChips>
      <Chips>
        {vista.map((c) => (
          <Chip
            key={c.id}
            activo={c.id === valor}
            icono={<LogoCategoria nombre={c.nombreCompleto} tipo={tipo} tamano={22} className="!rounded-full" />}
            onClick={() => alCambiar(c.id === valor ? "" : c.id)}
          >
            {c.nombre}
          </Chip>
        ))}
        <SelectNativo
          aria-label="Categoría"
          className="shrink-0"
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          opciones={
            <>
              <option value="">Sin categoría</option>
              <OpcionesCategorias categorias={categorias} />
            </>
          }
        >
          <ChipVisual className="pr-2">
            Todas
            <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
          </ChipVisual>
        </SelectNativo>
      </Chips>
    </section>
  );
}

/** Chips para poner o quitar etiquetas; "Nueva" abre un campo, crea la etiqueta y la deja puesta. */
function ElegirEtiquetas({
  disponibles,
  elegidas,
  alCambiar,
}: {
  disponibles: { id: string; nombre: string }[];
  elegidas: string[];
  alCambiar: (ids: string[]) => void;
}) {
  const crear = useGuardarEtiqueta();
  const enLinea = useEnLinea();
  const [nueva, setNueva] = useState("");
  const [escribiendo, setEscribiendo] = useState(false);
  const agregar = async () => {
    const nombre = nueva.trim().replace(/^#+/, "");
    if (!nombre || crear.isPending) return;
    const existente = disponibles.find((e) => e.nombre.toLowerCase() === nombre.toLowerCase());
    if (existente) {
      if (!elegidas.includes(existente.id)) alCambiar([...elegidas, existente.id]);
      setNueva("");
      setEscribiendo(false);
      return;
    }
    try {
      const e = await crear.mutateAsync({ datos: { nombre } });
      if (e?.id) alCambiar([...elegidas, e.id]);
      setNueva("");
      setEscribiendo(false);
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };
  return (
    <section className="space-y-2">
      <TituloChips>Etiquetas</TituloChips>
      <Chips>
        {disponibles.map((e) => {
          const puesta = elegidas.includes(e.id);
          return (
            <Chip key={e.id} activo={puesta} onClick={() => alCambiar(puesta ? elegidas.filter((x) => x !== e.id) : [...elegidas, e.id])}>
              #{e.nombre}
            </Chip>
          );
        })}
        {escribiendo ? null : (
          <Chip className="text-tint" onClick={() => setEscribiendo(true)}>
            <Plus aria-hidden className="-ml-1 size-4" />
            Nueva
          </Chip>
        )}
      </Chips>
      {escribiendo ? (
        <Grupo>
          <Fila>
            <label htmlFor="etiqueta-nueva" className="sr-only">
              Nueva etiqueta
            </label>
            <span aria-hidden className="text-muted-foreground">
              #
            </span>
            <CampoFila
              id="etiqueta-nueva"
              value={nueva}
              maxLength={40}
              autoFocus
              onChange={(e) => setNueva(e.target.value)}
              onBlur={() => !nueva.trim() && setEscribiendo(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void agregar();
                }
              }}
              placeholder="Nueva etiqueta"
              autoCapitalize="none"
              enterKeyHint="done"
              className="-ml-2 text-left"
            />
            {nueva.trim() ? (
              <Button variant="plain" size="text" className="shrink-0" disabled={!enLinea || crear.isPending} onClick={() => void agregar()}>
                Agregar
              </Button>
            ) : null}
          </Fila>
        </Grupo>
      ) : null}
    </section>
  );
}
