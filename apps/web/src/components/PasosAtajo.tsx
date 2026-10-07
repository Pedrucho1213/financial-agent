import { useEffect, useState } from "react";
import { abrirAtajo } from "../lib/atajo";
import type { AtajoPreparado } from "../lib/tipos";
import { Button } from "./ui/button";
import { PasosNumerados } from "./PasosNumerados";

// Lo que sí funciona en iOS: Safari descarga el archivo y desde Descargas se abre en Atajos.
const PASOS = [
  <>
    Toca <strong className="font-semibold">«Descargar»</strong>.
  </>,
  <>Abre la descarga: el botón de descargas de Safari o Archivos › Descargas.</>,
  <>
    En Atajos toca <strong className="font-semibold">«Agregar atajo»</strong>.
  </>,
];

// Desde iOS 17 el sistema pregunta cada vez que un Atajo borra un archivo (el Atajo borra cada dictado
// ya enviado), aunque la acción diga que no confirme. Solo este ajuste lo quita.
const PIE = (
  <>
    Para que no te pida confirmar cada vez que borra un dictado ya enviado: Ajustes › Apps › Atajos › Avanzado ›{" "}
    <strong className="font-semibold">«Permitir eliminar sin confirmación»</strong>.
  </>
);

/** Los 3 pasos que siguen a "Instalar el Atajo". */
export function PasosDescarga({ className }: { className?: string }) {
  return <PasosNumerados pasos={PASOS} etiqueta="Pasos para terminar" pie={PIE} className={className} />;
}

/** "¿No se descargó?": vuelve a abrir el mismo archivo mientras no venza. */
export function ReintentarDescarga({ atajo, mensajeVencido }: { atajo: AtajoPreparado; mensajeVencido: string }) {
  const [vencido, setVencido] = useState(false);

  useEffect(() => {
    setVencido(false);
    const ms = Date.parse(atajo.expiraEn) - Date.now();
    if (!(ms > 0)) return setVencido(true);
    const id = window.setTimeout(() => setVencido(true), Math.min(ms, 2 ** 31 - 1));
    return () => window.clearTimeout(id);
  }, [atajo]);

  if (vencido) return <p className="text-center text-[15px] text-balance text-muted-foreground">{mensajeVencido}</p>;
  return (
    <Button
      variant="plain"
      size="text"
      className="text-[15px]"
      onClick={() => {
        if (Date.parse(atajo.expiraEn) <= Date.now()) return setVencido(true);
        abrirAtajo(atajo.url);
      }}
    >
      ¿No se descargó? Toca aquí
    </Button>
  );
}
