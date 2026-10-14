import { Banknote, ChevronDown, CreditCard, Landmark, type LucideIcon, Ticket, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { marcaDe } from "../../lib/marcas";
import { nombreTipo } from "../../lib/saldos";
import type { CuentaConMes, TipoCuenta } from "../../lib/tipos";
import { cn } from "../../lib/utils";
import { LogoMarca } from "../Logo";
import { Chip, ChipVisual, Chips, TituloChips } from "../ui/chip";
import { CampoFila } from "../ui/input";
import { Fila, Grupo } from "../ui/lista";
import { SelectNativo } from "../ui/select";

// Un valor que ninguna cuenta puede tener: la opción para escribir una que no está en la lista.
const OTRA = "\u0000otra";
// Cuántas cuentas van a la vista; las demás, en "Otra…".
const A_LA_VISTA = 5;

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

const ICONOS: Record<TipoCuenta, [LucideIcon, string]> = {
  efectivo: [Banknote, "#34c759"],
  debito: [Landmark, "#007aff"],
  credito: [CreditCard, "#ff9500"],
  transferencia: [Landmark, "#007aff"],
  vales: [Ticket, "#34c759"],
  monedero: [Wallet, "#af52de"],
  otra: [Wallet, "#8e8e93"],
};

/** El logo del banco en chico (22 px, redondo); si no lo reconoce, el icono de su tipo. */
function LogoCuentaChico({ tipo, nombre, institucion }: { tipo?: TipoCuenta; nombre: string; institucion?: string | null }) {
  const marca = tipo === "efectivo" ? null : marcaDe(nombre, institucion);
  if (marca) return <LogoMarca clave={marca} tamano={22} className="!rounded-full" />;
  const [Icono, color] = ICONOS[tipo ?? "otra"] ?? ICONOS.otra;
  return (
    <span
      aria-hidden
      className="flex size-[22px] shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, var(--card))`, color }}
    >
      <Icono className="size-3" strokeWidth={2.4} />
    </span>
  );
}

/**
 * Las cuentas del editor en chips: las más usadas a la vista, con el logo de su banco; un toque la elige y otro la
 * quita. "Otra…" abre la rueda del iPhone con todas, y ahí "Otra…" deja escribir un nombre nuevo (el servidor crea
 * la cuenta). Sin cuentas (o con un servidor viejo) es un campo de texto.
 */
export function ElegirCuenta({
  id,
  etiqueta,
  titulo,
  valor,
  alCambiar,
  cuentas,
  placeholder,
  primeroCredito = false,
}: {
  id: string;
  /** Cómo se llama el campo para lectores de pantalla y pruebas ("Cuenta", "Desde", "Hacia", "Tarjeta"). */
  etiqueta: string;
  /** El título que se ve sobre los chips ("Pagado con"). */
  titulo: string;
  valor: string;
  alCambiar: (v: string) => void;
  cuentas: CuentaConMes[];
  placeholder: string;
  primeroCredito?: boolean;
}) {
  const lista = useMemo(() => cuentasParaElegir(cuentas, primeroCredito), [cuentas, primeroCredito]);
  // Mientras escribe otra: la que tenía antes, para volver a ella si sale sin escribir nada.
  const [escribiendo, setEscribiendo] = useState<{ antes: string } | null>(null);
  const elegida = lista.find((c) => c.nombre === valor);

  // A la vista: las más usadas y, si no está entre ellas, la elegida (o el nombre suelto que trae el movimiento).
  const vista = useMemo(() => {
    const primeras = lista.slice(0, A_LA_VISTA);
    if (!valor || primeras.some((c) => c.nombre === valor)) return primeras;
    return [elegida ?? null, ...primeras.slice(0, A_LA_VISTA - 1)];
  }, [lista, valor, elegida]);
  // Dos cuentas a la vista con el mismo banco: llevan su tipo para distinguirlas.
  const nombreChip = (c: CuentaConMes) =>
    vista.filter((o) => o && sinAcentos(o.nombre.split(" ")[0] ?? "") === sinAcentos(c.nombre.split(" ")[0] ?? "")).length > 1
      ? etiquetaDe(c)
      : c.nombre;

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
      <Grupo titulo={<span className="uppercase">{titulo}</span>}>
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
      </Grupo>
    );
  }

  return (
    <section>
      <TituloChips>{titulo}</TituloChips>
      <Chips>
        {vista.map((c) =>
          c ? (
            <Chip
              key={c.id}
              activo={c.nombre === valor}
              icono={<LogoCuentaChico tipo={c.tipo} nombre={c.nombre} institucion={c.institucion} />}
              onClick={() => alCambiar(c.nombre === valor ? "" : c.nombre)}
            >
              {nombreChip(c)}
            </Chip>
          ) : (
            <Chip key="suelta" activo icono={<LogoCuentaChico nombre={valor} />} onClick={() => alCambiar("")}>
              {valor}
            </Chip>
          ),
        )}
        <SelectNativo
          id={id}
          aria-label={etiqueta}
          className="shrink-0"
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
          <ChipVisual className={cn(lista.length > A_LA_VISTA ? "pr-2" : undefined)}>
            Otra…
            {lista.length > A_LA_VISTA ? <ChevronDown aria-hidden className="size-4 text-muted-foreground" /> : null}
          </ChipVisual>
        </SelectNativo>
      </Chips>
    </section>
  );
}
