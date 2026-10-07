import { useEffect, useMemo, useRef } from "react";
import { LARGO_CODIGO, limpiarCodigo } from "../lib/codigo";
import { cn } from "../lib/utils";

/**
 * Seis casillas sobre un campo transparente, como los códigos de verificación de iOS.
 * El campo real ocupa todo el ancho: tocar cualquier casilla abre el teclado.
 */
export function CasillasCodigo({
  codigo,
  alCambiar,
  error,
  className,
}: {
  codigo: string;
  alCambiar: (codigo: string) => void;
  error?: boolean;
  className?: string;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const completo = codigo.length === LARGO_CODIGO;
  const casillas = useMemo(() => Array.from({ length: LARGO_CODIGO }, (_, i) => codigo[i] ?? ""), [codigo]);

  useEffect(() => {
    if (!completo) campo.current?.focus();
  }, [completo]);

  return (
    <label className={cn("relative mx-auto block w-full max-w-[22rem]", className)} htmlFor="codigo">
      <span className="sr-only">Código de invitación</span>
      <div className={cn("grid grid-cols-6 gap-2", error && "animate-sacudir")} aria-hidden>
        {casillas.map((c, i) => {
          const activa = i === Math.min(codigo.length, LARGO_CODIGO - 1) && !completo;
          return (
            <div
              key={i}
              className={cn(
                "flex h-14 items-center justify-center rounded-xl bg-card text-[26px] font-semibold tabular transition-[box-shadow] duration-150",
                activa && "ring-2 ring-primary",
                error && "ring-2 ring-destructive/70",
              )}
            >
              {c || (activa ? <span className="h-7 w-0.5 animate-pulse rounded bg-primary" /> : null)}
            </div>
          );
        })}
      </div>
      <input
        ref={campo}
        id="codigo"
        name="codigo"
        value={codigo}
        onChange={(e) => alCambiar(limpiarCodigo(e.target.value))}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        maxLength={LARGO_CODIGO}
        aria-invalid={!!error}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
      />
    </label>
  );
}

/** El código en grande, de solo lectura, para leerlo, dictarlo o copiarlo. */
export function CodigoGrande({ codigo, className }: { codigo: string; className?: string }) {
  return (
    <div className={className}>
      <div aria-hidden className="grid grid-cols-6 gap-1.5">
        {codigo.split("").map((c, i) => (
          <span key={i} className="flex h-[58px] w-[46px] items-center justify-center rounded-xl bg-card text-[30px] font-bold tabular">
            {c}
          </span>
        ))}
      </div>
      <p data-codigo={codigo} className="sr-only">
        {codigo}
      </p>
    </div>
  );
}
