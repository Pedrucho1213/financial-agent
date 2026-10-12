import { Archive, ArchiveRestore, List, Mic, Pause, Play, Plus, Repeat, Trash, XCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { CampoMonto } from "../components/CampoMonto";
import { Pantalla } from "../components/Pantalla";
import { Spinner } from "../components/Spinner";
import { Button } from "../components/ui/button";
import { Fila, FilaBoton, Grupo } from "../components/ui/lista";
import { SelectNativo } from "../components/ui/select";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { ErrorApi, mensajeDeError } from "../lib/api";
import { useEnLinea } from "../lib/conexion";
import { useYo } from "../lib/consultas";
import { useCuentas } from "../lib/cuentas";
import { diasHasta, dinero, FRECUENCIAS, hoyIso, leerMonto } from "../lib/formato";
import { haptico } from "../lib/haptico";
import { useBorrarRecurrente, useGuardarRecurrente, useRecurrentes } from "../lib/recurrentes";
import { hashDe, navegar, volver } from "../lib/ruta";
import type { DatosRecurrente, EstadoRecurrente, Frecuencia, Recurrente, TipoRecurrente } from "../lib/tipos";
import { useUnaVez } from "../lib/una-vez";
import { cn } from "../lib/utils";

const TIPOS: Record<TipoRecurrente, string> = {
  suscripcion: "Suscripción",
  servicio: "Servicio",
  renta: "Renta",
  prestamo: "Préstamo",
  ingreso: "Ingreso",
  otro: "Otro",
};
const DIAS_SEMANA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SECCIONES: { estado: EstadoRecurrente; titulo: string }[] = [
  { estado: "activa", titulo: "Activas" },
  { estado: "pausada", titulo: "Pausadas" },
  { estado: "cancelada", titulo: "Canceladas" },
];

/** "día 8", "días 8 y 23", "los lunes", "8 de marzo". */
function cuandoSeCobra(r: Pick<Recurrente, "frecuencia" | "dia" | "mes">) {
  switch (r.frecuencia) {
    case "semanal":
      return `los ${DIAS_SEMANA[r.dia] ?? r.dia}`;
    case "quincenal":
      return `días ${r.dia} y ${Math.min(r.dia + 15, 31)}`;
    case "anual":
      return r.mes ? `${r.dia} de ${MESES[r.mes]}` : `día ${r.dia}`;
    default:
      return `día ${r.dia}`;
  }
}

function proximo(r: Recurrente, hoy: string) {
  if (!r.proximoCobro) return null;
  const dias = diasHasta(r.proximoCobro, hoy);
  return dias <= 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`;
}

/** #suscripciones: suscripciones y pagos fijos para editarlos, pausarlos, cancelarlos o archivarlos. #suscripciones?id= abre uno. */
export function Suscripciones({ params }: { params: URLSearchParams }) {
  const yo = useYo();
  const hoy = yo.data?.hoy ?? hoyIso();
  const lista = useRecurrentes();
  const enLinea = useEnLinea();
  const verArchivadas = params.get("archivadas") === "1";
  const [hoja, setHoja] = useState<Recurrente | "nueva" | null>(null);

  const todas = lista.data?.recurrentes ?? [];
  const moneda = lista.data?.moneda ?? yo.data?.moneda ?? "MXN";
  const archivadas = todas.filter((r) => r.estado === "archivada");
  const activas = todas.filter((r) => r.estado === "activa");
  // Un servidor viejo contesta 404 o la lista de la IA (sin mensualCentavos).
  const sinServidor =
    (lista.error instanceof ErrorApi && lista.error.estado === 404) || (!!lista.data && typeof lista.data.mensualCentavos !== "number");

  // Un enlace (desde Inicio) abre esa directamente.
  const pedida = params.get("id");
  useEffect(() => {
    if (!pedida || !lista.data) return;
    const r = lista.data.recurrentes.find((x) => x.id === pedida);
    if (r) setHoja(r);
  }, [pedida, lista.data]);

  const cerrar = () => {
    setHoja(null);
    if (pedida) navegar(hashDe("suscripciones", { archivadas: verArchivadas ? "1" : undefined }), { reemplazar: true });
  };
  // La hoja abierta sigue a los datos: tras pausar o editar muestra lo nuevo.
  const abierta = hoja && hoja !== "nueva" ? (todas.find((r) => r.id === hoja.id) ?? hoja) : hoja;

  return (
    <Pantalla titulo="Suscripciones" atras={{ etiqueta: "Atrás", alTocar: () => volver("inicio") }} alRefrescar={() => lista.refetch()}>
      {sinServidor ? (
        <Caja titulo="Aún no está en tu servidor" texto="Las suscripciones llegan con la próxima actualización de la Mac." />
      ) : lista.isPending ? (
        <div aria-busy className="space-y-6 pt-2">
          <Skeleton className="h-[96px] w-full rounded-[20px] bg-card" />
          <Skeleton className="h-[220px] w-full rounded-[20px] bg-card" />
        </div>
      ) : lista.isError && !lista.data ? (
        <Caja titulo="No pudimos cargar tus suscripciones" texto={mensajeDeError(lista.error)}>
          <Button variant="tinted" size="sm" className="mt-4" onClick={() => lista.refetch()}>
            Reintentar
          </Button>
        </Caja>
      ) : (
        <div className="space-y-8 pt-2 pb-4">
          <div className="rounded-[20px] bg-card p-4" data-resumen-suscripciones>
            <p className="text-[13px] text-muted-foreground">Se van al mes</p>
            <p className="mt-0.5 text-[34px] leading-10 font-bold tracking-tight tabular">{dinero(lista.data!.mensualCentavos, moneda)}</p>
            <p className="mt-1 text-[15px] text-muted-foreground">
              {resumen(activas.filter((r) => r.tipo !== "ingreso").length, todas.filter((r) => r.estado === "pausada").length)}
              {lista.data!.mensualCentavos ? ` · ${dinero(lista.data!.mensualCentavos * 12, moneda)} al año` : ""}
            </p>
          </div>

          {SECCIONES.map(({ estado, titulo }) => {
            const filas = todas.filter((r) => r.estado === estado);
            if (estado !== "activa" && !filas.length) return null;
            return (
              <Grupo
                key={estado}
                titulo={titulo}
                data-seccion={estado}
                pie={
                  estado === "activa" ? (
                    <span className="flex items-start gap-1.5">
                      <Mic className="mt-0.5 size-3.5 shrink-0" />
                      {filas.length
                        ? "Por voz también: «pausa Spotify», «cancelé Netflix» o «Spotify subió a 129»."
                        : "Dile al Atajo «Netflix 219 cada mes» o agrégala aquí."}
                    </span>
                  ) : estado === "pausada" ? (
                    "No se cobran ni te aviso de ellas hasta que las reanudes."
                  ) : undefined
                }
              >
                {filas.map((r) => (
                  <FilaRecurrente key={r.id} r={r} hoy={hoy} alTocar={() => setHoja(r)} />
                ))}
                {estado === "activa" ? (
                  <FilaBoton
                    sangria="4rem"
                    icono={
                      <span className="flex size-9 items-center justify-center">
                        <Plus className="size-5 text-tint" strokeWidth={2.5} />
                      </span>
                    }
                    titulo={<span className="text-tint">Nueva suscripción</span>}
                    disabled={!enLinea}
                    onClick={() => setHoja("nueva")}
                  />
                ) : null}
              </Grupo>
            );
          })}

          {archivadas.length ? (
            verArchivadas ? (
              <Grupo
                titulo="Archivadas"
                data-seccion="archivada"
                accion={
                  <Button variant="plain" size="text" className="text-[13px]" onClick={() => navegar(hashDe("suscripciones"), { reemplazar: true })}>
                    Ocultar
                  </Button>
                }
              >
                {archivadas.map((r) => (
                  <FilaRecurrente key={r.id} r={r} hoy={hoy} alTocar={() => setHoja(r)} />
                ))}
              </Grupo>
            ) : (
              <Grupo>
                <FilaBoton
                  icono={<Archive className="size-[18px] text-muted-foreground" />}
                  titulo="Archivadas"
                  valor={<span className="tabular">{archivadas.length}</span>}
                  chevron
                  onClick={() => navegar(hashDe("suscripciones", { archivadas: "1" }), { reemplazar: true })}
                />
              </Grupo>
            )
          ) : null}
        </div>
      )}
      <HojaRecurrente valor={abierta} moneda={moneda} alCerrar={cerrar} />
    </Pantalla>
  );
}

function resumen(activas: number, pausadas: number) {
  const a = `${activas} ${activas === 1 ? "activa" : "activas"}`;
  return pausadas ? `${a} · ${pausadas} ${pausadas === 1 ? "pausada" : "pausadas"}` : a;
}

function FilaRecurrente({ r, hoy, alTocar }: { r: Recurrente; hoy: string; alTocar: () => void }) {
  const activa = r.estado === "activa";
  const cuando = proximo(r, hoy);
  const ingreso = r.tipo === "ingreso";
  return (
    <FilaBoton
      sangria="4rem"
      data-recurrente={r.nombre}
      icono={
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold",
            activa ? (ingreso ? "bg-positive/15 text-positive" : "bg-tint/15 text-tint") : "bg-fill text-muted-foreground",
          )}
        >
          {r.nombre.trim().charAt(0).toUpperCase() || <Repeat className="size-[18px]" />}
        </span>
      }
      titulo={<span className={cn(!activa && "text-muted-foreground")}>{r.nombre}</span>}
      subtitulo={[FRECUENCIAS[r.frecuencia] ?? r.frecuencia, cuandoSeCobra(r), r.cuenta].filter(Boolean).join(" · ")}
      valor={
        <span className="block text-right tabular">
          <span className={cn("block font-medium", activa ? (ingreso ? "text-positive" : "text-foreground") : "text-muted-foreground line-through decoration-1")}>
            {ingreso ? "+" : ""}
            {dinero(r.montoCentavos, r.moneda)}
          </span>
          {cuando ? <span className="block text-[13px]">{cuando}</span> : null}
        </span>
      }
      chevron
      onClick={alTocar}
    />
  );
}

function Caja({ titulo, texto, children }: { titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="mt-6 rounded-[20px] bg-card px-6 py-10 text-center">
      <p className="text-[17px] font-semibold">{titulo}</p>
      <p className="mt-1 text-[15px] text-balance text-muted-foreground">{texto}</p>
      {children}
    </div>
  );
}

const MENSAJE_ESTADO: Record<EstadoRecurrente, (n: string) => string> = {
  activa: (n) => `${n} está activa otra vez`,
  pausada: (n) => `Pausé ${n}`,
  cancelada: (n) => `Cancelé ${n}`,
  archivada: (n) => `Archivé ${n}`,
};

function HojaRecurrente({ valor, moneda, alCerrar }: { valor: Recurrente | "nueva" | null; moneda: string; alCerrar: () => void }) {
  const editando = valor && valor !== "nueva" ? valor : null;
  const guardar = useGuardarRecurrente();
  const borrar = useBorrarRecurrente();
  const enLinea = useEnLinea();
  const cuentas = useCuentas({ activo: !!valor });
  const [monto, setMonto] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoRecurrente>("suscripcion");
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("mensual");
  const [dia, setDia] = useState(1);
  const [mes, setMes] = useState(1);
  const [cuentaId, setCuentaId] = useState("");

  // Solo al abrir otra (o una nueva): pausar no debe borrar lo que se está escribiendo.
  const clave = valor === "nueva" ? "nueva" : (valor?.id ?? null);
  useEffect(() => {
    if (!valor) return;
    const hoy = new Date();
    setMonto(editando ? String(editando.montoCentavos / 100) : "");
    setNombre(editando?.nombre ?? "");
    setTipo(editando?.tipo ?? "suscripcion");
    setFrecuencia(editando?.frecuencia ?? "mensual");
    setDia(editando?.dia ?? hoy.getDate());
    setMes(editando?.mes ?? hoy.getMonth() + 1);
    setCuentaId(editando?.cuentaId ?? "");
  }, [clave]);

  const maxDia = frecuencia === "semanal" ? 7 : frecuencia === "quincenal" ? 15 : 31;
  const diaValido = Math.min(dia, maxDia);
  const nMonto = leerMonto(monto);
  const listo = nombre.trim().length > 0 && nMonto !== null && nMonto > 0 && enLinea && !guardar.isPending;
  const listaCuentas = (cuentas.data?.cuentas ?? []).filter((c) => !c.archivada || c.id === cuentaId);

  const unaVez = useUnaVez();
  const enviar = () =>
    unaVez(async () => {
      if (!listo || nMonto === null) return;
      const completo: DatosRecurrente = {
        nombre: nombre.trim(),
        tipo,
        monto: nMonto,
        frecuencia,
        dia: diaValido,
        mes: frecuencia === "anual" ? mes : null,
        cuenta_id: cuentaId || null,
      };
      let datos = completo;
      if (editando) {
        // Solo lo que cambió.
        datos = {};
        if (completo.nombre !== editando.nombre) datos.nombre = completo.nombre;
        if (tipo !== editando.tipo) datos.tipo = tipo;
        if (Math.round(nMonto * 100) !== editando.montoCentavos) datos.monto = nMonto;
        if (frecuencia !== editando.frecuencia) datos.frecuencia = frecuencia;
        if (diaValido !== editando.dia || frecuencia !== editando.frecuencia) datos.dia = diaValido;
        if (frecuencia === "anual" && (mes !== editando.mes || frecuencia !== editando.frecuencia)) datos.mes = mes;
        if ((cuentaId || null) !== editando.cuentaId) datos.cuenta_id = cuentaId || null;
        if (!Object.keys(datos).length) {
          alCerrar();
          return;
        }
      }
      try {
        const r = await guardar.mutateAsync({ id: editando?.id, datos });
        haptico();
        toast.success(editando ? "Cambios guardados" : `Agregué ${r?.nombre ?? nombre.trim()}`);
        alCerrar();
      } catch (error) {
        toast.error(mensajeDeError(error));
      }
    });

  const cambiarEstado = async (estado: EstadoRecurrente) => {
    if (!editando) return;
    const anterior = editando.estado;
    try {
      await guardar.mutateAsync({ id: editando.id, datos: { estado } });
      haptico();
      toast.success(MENSAJE_ESTADO[estado](editando.nombre), {
        action: { label: "Deshacer", onClick: () => guardar.mutate({ id: editando.id, datos: { estado: anterior } }) },
      });
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  const eliminar = async () => {
    if (!editando) return;
    if (!window.confirm(`¿Eliminar ${editando.nombre}? Desaparece de la lista; los cobros que ya anotaste se quedan.`)) return;
    try {
      await borrar.mutateAsync(editando.id);
      haptico();
      toast.success(`Eliminé ${editando.nombre}`);
      alCerrar();
    } catch (error) {
      toast.error(mensajeDeError(error));
    }
  };

  const ocupado = !enLinea || guardar.isPending || borrar.isPending;
  const cancelar = editando?.tipo === "suscripcion" ? "Cancelar suscripción" : "Ya no lo pago";
  const acciones: { estado: EstadoRecurrente; titulo: string; icono: ReactNode; destructiva?: boolean }[] = !editando
    ? []
    : editando.estado === "activa"
      ? [
          { estado: "pausada", titulo: "Pausar", icono: <Pause className="size-[18px]" /> },
          { estado: "cancelada", titulo: cancelar, icono: <XCircle className="size-[18px]" />, destructiva: true },
          { estado: "archivada", titulo: "Archivar", icono: <Archive className="size-[18px]" /> },
        ]
      : editando.estado === "pausada"
        ? [
            { estado: "activa", titulo: "Reanudar", icono: <Play className="size-[18px]" /> },
            { estado: "cancelada", titulo: cancelar, icono: <XCircle className="size-[18px]" />, destructiva: true },
            { estado: "archivada", titulo: "Archivar", icono: <Archive className="size-[18px]" /> },
          ]
        : editando.estado === "cancelada"
          ? [
              { estado: "activa", titulo: "Volver a activar", icono: <Play className="size-[18px]" /> },
              { estado: "archivada", titulo: "Archivar", icono: <Archive className="size-[18px]" /> },
            ]
          : [
              { estado: "activa", titulo: "Volver a activar", icono: <Play className="size-[18px]" /> },
              { estado: "cancelada", titulo: "Sacar del archivo", icono: <ArchiveRestore className="size-[18px]" /> },
            ];

  return (
    <Sheet open={!!valor} onOpenChange={(v) => !v && alCerrar()}>
      {valor ? (
        <SheetContent
          titulo={editando ? editando.nombre : "Nueva suscripción"}
          descripcion={editando ? `Edita ${editando.nombre}` : "Agrega una suscripción o pago fijo"}
          izquierda={
            <Button variant="plain" size="text" onClick={alCerrar}>
              Cerrar
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
            {editando && editando.estado !== "activa" ? (
              <p className="text-center text-[15px] text-muted-foreground" data-estado={editando.estado}>
                {editando.estado === "pausada" ? "Pausada" : editando.estado === "cancelada" ? "Cancelada" : "Archivada"}: no se cobra ni te aviso de ella.
              </p>
            ) : null}

            <CampoMonto id="monto-recurrente" valor={monto} onCambio={setMonto} moneda={editando?.moneda ?? moneda} enfocar={!editando} />

            <Grupo>
              <Fila>
                <label htmlFor="nombre-recurrente" className="shrink-0">
                  Nombre
                </label>
                <input
                  id="nombre-recurrente"
                  placeholder="Netflix, renta, gimnasio…"
                  value={nombre}
                  maxLength={80}
                  onChange={(e) => setNombre(e.target.value)}
                  className="h-11 w-full min-w-0 bg-transparent text-right text-[17px] outline-none placeholder:text-placeholder"
                />
              </Fila>
              <FilaSelect
                id="tipo-recurrente"
                etiqueta="Tipo"
                valor={tipo}
                texto={TIPOS[tipo]}
                alCambiar={(v) => setTipo(v as TipoRecurrente)}
                opciones={Object.entries(TIPOS).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              />
              <FilaSelect
                id="cuenta-recurrente"
                etiqueta="Se paga con"
                valor={cuentaId}
                texto={(cuentaId && (listaCuentas.find((c) => c.id === cuentaId)?.nombre ?? editando?.cuenta)) || "Sin indicar"}
                alCambiar={setCuentaId}
                opciones={
                  <>
                    <option value="">Sin indicar</option>
                    {listaCuentas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </>
                }
              />
            </Grupo>

            <Grupo
              titulo="Cobro"
              pie={editando?.proximoCobro ? `Próximo cobro: ${proximo(editando, hoyIso())}.` : undefined}
            >
              <FilaSelect
                id="frecuencia-recurrente"
                etiqueta="Cada cuánto"
                valor={frecuencia}
                texto={FRECUENCIAS[frecuencia] ?? frecuencia}
                alCambiar={(v) => setFrecuencia(v as Frecuencia)}
                opciones={Object.entries(FRECUENCIAS).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              />
              <FilaSelect
                id="dia-recurrente"
                etiqueta={frecuencia === "semanal" ? "Qué día" : "Día"}
                valor={String(diaValido)}
                texto={frecuencia === "semanal" ? capital(DIAS_SEMANA[diaValido] ?? "") : frecuencia === "quincenal" ? `${diaValido} y ${Math.min(diaValido + 15, 31)}` : diaValido}
                alCambiar={(v) => setDia(Number(v))}
                opciones={Array.from({ length: maxDia }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {frecuencia === "semanal" ? capital(DIAS_SEMANA[d] ?? "") : frecuencia === "quincenal" ? `${d} y ${Math.min(d + 15, 31)}` : d}
                  </option>
                ))}
              />
              {frecuencia === "anual" ? (
                <FilaSelect
                  id="mes-recurrente"
                  etiqueta="Mes"
                  valor={String(mes)}
                  texto={capital(MESES[mes] ?? "")}
                  alCambiar={(v) => setMes(Number(v))}
                  opciones={MESES.slice(1).map((m, i) => (
                    <option key={m} value={i + 1}>
                      {capital(m)}
                    </option>
                  ))}
                />
              ) : null}
            </Grupo>

            {editando ? (
              <Grupo>
                {acciones.map((a) => (
                  <FilaBoton
                    key={a.estado}
                    data-accion={a.estado}
                    icono={<span className={a.destructiva ? "text-destructive" : "text-tint"}>{a.icono}</span>}
                    titulo={<span className={a.destructiva ? "text-destructive" : "text-tint"}>{a.titulo}</span>}
                    disabled={ocupado}
                    onClick={() => void cambiarEstado(a.estado)}
                  />
                ))}
                <FilaBoton
                  icono={<List className="size-[18px] text-tint" />}
                  titulo="Ver lo que ya pagué"
                  chevron
                  onClick={() => {
                    alCerrar();
                    navegar(hashDe("movimientos", { q: editando.nombre, mes: "todo" }));
                  }}
                />
              </Grupo>
            ) : null}
            {editando ? (
              <Grupo>
                <FilaBoton className="justify-center text-destructive" disabled={ocupado} onClick={() => void eliminar()}>
                  <Trash className="size-[18px]" />
                  <span>Eliminar</span>
                </FilaBoton>
              </Grupo>
            ) : null}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function FilaSelect({
  id,
  etiqueta,
  valor,
  texto,
  alCambiar,
  opciones,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  texto: ReactNode;
  alCambiar: (v: string) => void;
  opciones: ReactNode;
}) {
  return (
    <Fila>
      <label htmlFor={id} className="shrink-0">
        {etiqueta}
      </label>
      <SelectNativo id={id} value={valor} onChange={(e) => alCambiar(e.target.value)} className="min-w-0 flex-1" opciones={opciones}>
        <span className="block truncate text-right text-[17px] text-muted-foreground">{texto}</span>
      </SelectNativo>
    </Fila>
  );
}
