import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Globe, Laptop, MapPin, Smartphone, Tablet, Workflow } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { api, mensajeDeError } from "../../lib/api";
import { useEnLinea } from "../../lib/conexion";
import { claves } from "../../lib/consultas";
import { fechaHora, haceCuanto } from "../../lib/formato";
import { leerCalles } from "../../lib/mapa";
import type { Dispositivo } from "../../lib/tipos";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Confirmar } from "../ui/dialog";
import { Fila, FilaBoton, Grupo, IconoAjuste } from "../ui/lista";
import { Sheet, SheetContent } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";

const MapaLugares = lazy(() => import("../MapaLugares").then((m) => ({ default: m.MapaLugares })));

type Tipo = "atajo" | "applePay" | "tablet" | "compu" | "navegador" | "telefono";

// El nombre lo pone quien entra (o el servidor, para los Atajos): de ahí sale qué es.
export function tipoDispositivo(nombre: string): Tipo {
  const n = nombre.toLowerCase();
  if (/apple pay/.test(n)) return "applePay";
  if (/atajo/.test(n)) return "atajo";
  if (/ipad|tablet/.test(n)) return "tablet";
  if (/mac|laptop|pc|windows/.test(n)) return "compu";
  if (/navegador|chrome|safari|web/.test(n)) return "navegador";
  return "telefono";
}

const TIPOS: Record<Tipo, { icono: typeof Smartphone; color: string; descripcion: string }> = {
  atajo: { icono: Workflow, color: "linear-gradient(180deg,#ff5e8a,#5e5ce6)", descripcion: "Atajo para hablar" },
  applePay: { icono: CreditCard, color: "linear-gradient(180deg,#3a3a3c,#1c1c1e)", descripcion: "Atajo de Apple Pay" },
  tablet: { icono: Tablet, color: "#5856d6", descripcion: "App en el iPad" },
  compu: { icono: Laptop, color: "#636366", descripcion: "App en la computadora" },
  navegador: { icono: Globe, color: "#30b0c7", descripcion: "App en el navegador" },
  telefono: { icono: Smartphone, color: "#007aff", descripcion: "App en el teléfono" },
};

const DIA = 86_400_000;
const momento = (iso: string | null) => (iso ? Date.parse(iso) : 0);

/**
 * Ya no se usa: no se ha usado desde que se instaló otro del mismo tipo (y ese sí se usó), o lleva un mes
 * sin usarse. Reinstalar el Atajo o la app deja la instalación vieja con su acceso; esto las encuentra.
 */
export function yaNoSeUsa(d: Dispositivo, todos: Dispositivo[], ahora = Date.now()) {
  if (d.actual) return false;
  const ultimo = momento(d.ultimoUso) || momento(d.creadoEn);
  if (ahora - ultimo > 30 * DIA) return true;
  const tipo = tipoDispositivo(d.nombre);
  return todos.some(
    (o) => o.id !== d.id && tipoDispositivo(o.nombre) === tipo && momento(o.creadoEn) >= ultimo && (o.actual || o.ultimoUso !== null),
  );
}

/** Este primero; luego el que se usó más recientemente. */
export function ordenarDispositivos(lista: Dispositivo[]) {
  return [...lista].sort(
    (a, b) => Number(b.actual) - Number(a.actual) || momento(b.ultimoUso) - momento(a.ultimoUso) || momento(b.creadoEn) - momento(a.creadoEn),
  );
}

function IconoDispositivo({ nombre }: { nombre: string }) {
  const t = TIPOS[tipoDispositivo(nombre)];
  return (
    <IconoAjuste color={t.color}>
      <t.icono />
    </IconoAjuste>
  );
}

export function FilaDispositivo({ d, alTocar }: { d: Dispositivo; alTocar: () => void }) {
  const lugar = d.ubicacion?.lugar;
  return (
    <FilaBoton
      sangria="3.75rem"
      icono={<IconoDispositivo nombre={d.nombre} />}
      titulo={
        <span className="flex items-center gap-2">
          <span className="truncate">{d.nombre}</span>
          {d.actual ? <Badge variant="default">Este</Badge> : null}
        </span>
      }
      subtitulo={
        <>
          {d.actual ? "En uso ahora" : d.ultimoUso ? `Usado ${haceCuanto(d.ultimoUso)}` : "Sin usar todavía"}
          {lugar ? ` · ${lugar}` : null}
        </>
      }
      chevron
      onClick={alTocar}
    />
  );
}

/** Quita uno o varios dispositivos; sus tokens dejan de servir de inmediato. */
export function useQuitarDispositivos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      // Uno por uno: si alguno falla, los anteriores ya quedaron quitados y se dice cuántos.
      let quitados = 0;
      try {
        for (const id of ids) {
          await api<{ ok: true }>(`/v1/dispositivos/${encodeURIComponent(id)}`, { method: "DELETE" });
          quitados++;
        }
      } finally {
        void qc.invalidateQueries({ queryKey: claves.yo });
      }
      return quitados;
    },
    onSuccess: (n) => toast.success(n === 1 ? "Dispositivo quitado" : `${n} dispositivos quitados`),
    onError: (e) => toast.error(mensajeDeError(e)),
  });
}

/** Detalle de un dispositivo: qué es, cuándo se usó, dónde estaba y quitarlo. */
export function HojaDispositivo({ dispositivo, alCerrar }: { dispositivo: Dispositivo | null; alCerrar: () => void }) {
  return (
    <Sheet open={!!dispositivo} onOpenChange={(v) => !v && alCerrar()}>
      {dispositivo ? <DetalleDispositivo d={dispositivo} alCerrar={alCerrar} /> : null}
    </Sheet>
  );
}

function DetalleDispositivo({ d, alCerrar }: { d: Dispositivo; alCerrar: () => void }) {
  const enLinea = useEnLinea();
  const quitar = useQuitarDispositivos();
  const [confirmar, setConfirmar] = useState(false);
  const tipo = tipoDispositivo(d.nombre);
  const t = TIPOS[tipo];
  const u = d.ubicacion;
  const esAtajo = tipo === "atajo" || tipo === "applePay";
  const enMapas = u ? `https://maps.apple.com/?ll=${u.lat},${u.lon}&q=${encodeURIComponent(u.lugar ?? d.nombre)}` : "";

  return (
    <SheetContent
      titulo={d.nombre}
      descripcion={t.descripcion}
      derecha={
        <Button variant="plain" size="text" className="font-semibold" onClick={alCerrar}>
          Listo
        </Button>
      }
    >
      <div className="flex flex-col items-center pt-2 pb-1 text-center">
        <span
          aria-hidden
          className="flex size-[60px] items-center justify-center rounded-[14px] text-white [&_svg]:size-8"
          style={{ background: t.color }}
        >
          <t.icono />
        </span>
        <p className="mt-2 text-[15px] text-muted-foreground">{t.descripcion}</p>
        {d.actual ? (
          <Badge variant="default" className="mt-2">
            Este dispositivo
          </Badge>
        ) : null}
      </div>

      <div className="mt-5 space-y-6">
        {u ? (
          <Grupo
            titulo="Última ubicación"
            pie={`Donde estaba ${esAtajo ? "al usar el Atajo" : "la última vez"}, ${haceCuanto(u.en)}.`}
          >
            <Suspense fallback={<Skeleton className="h-[180px] w-full rounded-none" />}>
              <MapaLugares
                interactivo={false}
                conCalles={leerCalles()}
                etiqueta={`Mapa de dónde estaba ${d.nombre}`}
                lugares={[{ clave: d.id, nombre: u.lugar?.split(",")[0] ?? "Aquí", lat: u.lat, lon: u.lon, centavos: 1, cantidad: 1 }]}
                className="h-[180px]"
              />
            </Suspense>
            <a href={enMapas} target="_blank" rel="noreferrer" className="fila-presionable relative flex min-h-11 items-center gap-3 px-4 text-[17px] text-tint">
              <MapPin className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{u.lugar ?? "Abrir en Mapas"}</span>
              {u.lugar ? <span className="shrink-0 text-[15px] text-muted-foreground">Mapas</span> : null}
            </a>
          </Grupo>
        ) : (
          <Grupo
            titulo="Última ubicación"
            pie={
              esAtajo
                ? "Aparece aquí la próxima vez que lo uses: es la que el Atajo ya manda con cada dictado o pago."
                : "La app no pide tu ubicación; solo los Atajos la mandan al dictar o pagar."
            }
          >
            <Fila titulo="Sin ubicación" valor={<MapPin className="size-5 text-muted-foreground/60" aria-hidden />} />
          </Grupo>
        )}

        <Grupo>
          <Fila titulo="Último uso" valor={d.actual ? "Ahora" : d.ultimoUso ? haceCuanto(d.ultimoUso) : "Nunca"} />
          <Fila titulo="Agregado" valor={fechaHora(d.creadoEn)} />
        </Grupo>

        {!d.actual ? (
          <Grupo pie="Deja de tener acceso al instante. Para volver a entrar necesitará un código nuevo.">
            <FilaBoton className="justify-center text-destructive" disabled={!enLinea || quitar.isPending} onClick={() => setConfirmar(true)}>
              Quitar este dispositivo
            </FilaBoton>
          </Grupo>
        ) : null}
      </div>

      <Confirmar
        abierto={confirmar}
        onAbiertoChange={setConfirmar}
        titulo={`¿Quitar «${d.nombre}»?`}
        descripcion="Ese dispositivo dejará de tener acceso. Para volver a entrar necesitará un código nuevo."
        confirmar="Quitar"
        onConfirmar={() => quitar.mutate([d.id], { onSuccess: alCerrar })}
      />
    </SheetContent>
  );
}
