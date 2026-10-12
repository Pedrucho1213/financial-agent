import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { nombreTipo } from "../../lib/saldos";
import type { CuentaConMes } from "../../lib/tipos";
import { cn } from "../../lib/utils";
import { CampoFila } from "../ui/input";
import { Fila } from "../ui/lista";
import { SelectNativo } from "../ui/select";

// Un valor que ninguna cuenta puede tener: la opción para escribir una que no está en la lista.
const OTRA = "\u0000otra";

const sinAcentos = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/**
 * Sus cuentas activas, las más usadas primero (a empate, como las manda el servidor).
 * `primeroCredito`: para el pago de tarjeta, las tarjetas de crédito van antes que todo.
 */
export function cuentasParaElegir(cuentas: CuentaConMes[], primeroCredito = false): CuentaConMes[] {
  return cuentas
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.archivada)
    .sort(
      (a, b) =>
        (primeroCredito ? Number(b.c.esCredito) - Number(a.c.esCredito) : 0) || (b.c.usos ?? 0) - (a.c.usos ?? 0) || a.i - b.i,
    )
    .map(({ c }) => c);
}

/** "Revolut · Débito", para no confundir dos cuentas del mismo banco; si el nombre ya lo dice, solo el nombre. */
function etiquetaDe(c: CuentaConMes) {
  if (c.tipo !== "credito" && c.tipo !== "debito") return c.nombre;
  const tipo = nombreTipo(c.tipo);
  return sinAcentos(c.nombre).includes(sinAcentos(tipo)) ? c.nombre : `${c.nombre} · ${tipo}`;
}

/**
 * La fila de cuenta del editor: se elige de sus cuentas en la rueda del iPhone. "Otra…" deja escribir
 * un nombre nuevo (el servidor crea la cuenta). Sin cuentas (o con un servidor viejo) es un campo de texto.
 */
export function FilaCuenta({
  id,
  etiqueta,
  valor,
  alCambiar,
  cuentas,
  placeholder,
  primeroCredito = false,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  cuentas: CuentaConMes[];
  placeholder: string;
  primeroCredito?: boolean;
}) {
  const lista = useMemo(() => cuentasParaElegir(cuentas, primeroCredito), [cuentas, primeroCredito]);
  // Mientras escribe otra: la que tenía antes, para volver a ella si sale sin escribir nada.
  const [escribiendo, setEscribiendo] = useState<{ antes: string } | null>(null);

  if (!lista.length || escribiendo) {
    // Al salir del campo: si escribió una que ya tiene (o nada), vuelve a la lista.
    const alSalir = () => {
      if (!lista.length) return;
      const texto = sinAcentos(valor);
      const existente = lista.find((c) => sinAcentos(c.nombre) === texto);
      if (existente && existente.nombre !== valor) alCambiar(existente.nombre);
      if (!texto) alCambiar(escribiendo?.antes ?? "");
      if (!texto || existente) setEscribiendo(null);
    };
    return (
      <Fila>
        <label htmlFor={id} className="shrink-0">
          {etiqueta}
        </label>
        <CampoFila
          id={id}
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          onBlur={alSalir}
          placeholder={placeholder}
          autoCapitalize="words"
          autoFocus={!!escribiendo}
          enterKeyHint="done"
        />
      </Fila>
    );
  }

  const elegida = lista.find((c) => c.nombre === valor);
  return (
    <SelectNativo
      id={id}
      value={valor}
      onChange={(e) => (e.target.value === OTRA ? (setEscribiendo({ antes: valor }), alCambiar("")) : alCambiar(e.target.value))}
      opciones={
        <>
          <option value="">Ninguna</option>
          {lista.map((c) => (
            <option key={c.id} value={c.nombre}>
              {etiquetaDe(c)}
            </option>
          ))}
          {/* La que tiene el movimiento aunque ya no esté en la lista (archivada, o un nombre suelto). */}
          {valor && !elegida ? <option value={valor}>{valor}</option> : null}
          <option value={OTRA}>Otra…</option>
        </>
      }
    >
      <Fila>
        <label htmlFor={id} className="shrink-0">
          {etiqueta}
        </label>
        <span className={cn("min-w-0 flex-1 truncate text-right", valor ? "text-muted-foreground" : "text-placeholder")}>
          {elegida ? etiquetaDe(elegida) : valor || "Elegir"}
        </span>
        <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-muted-foreground/60" />
      </Fila>
    </SelectNativo>
  );
}
