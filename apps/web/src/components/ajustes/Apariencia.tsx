import { Check } from "lucide-react";
import { haptico } from "../../lib/haptico";
import { guardarTema, type Tema, useTema } from "../../lib/tema";
import { cn } from "../../lib/utils";
import { Grupo } from "../ui/lista";

const OPCIONES: { valor: Tema; etiqueta: string }[] = [
  { valor: "auto", etiqueta: "Automático" },
  { valor: "claro", etiqueta: "Claro" },
  { valor: "oscuro", etiqueta: "Oscuro" },
];

// Colores fijos de cada modo: la miniatura se ve igual aunque la app esté en el otro.
const MODOS = {
  claro: { fondo: "#f2f2f7", tarjeta: "#ffffff", linea: "#d1d1d6", acento: "#007aff" },
  oscuro: { fondo: "#000000", tarjeta: "#1c1c1e", linea: "#3a3a3c", acento: "#0a84ff" },
};

function Pantallita({ modo }: { modo: keyof typeof MODOS }) {
  const c = MODOS[modo];
  return (
    <div className="flex h-full w-full flex-col gap-1 p-1.5" style={{ background: c.fondo }}>
      <div className="h-1.5 w-3/5 rounded-full" style={{ background: c.linea }} />
      <div className="flex flex-col gap-1 rounded-[5px] p-1" style={{ background: c.tarjeta }}>
        <div className="h-1 w-4/5 rounded-full" style={{ background: c.linea }} />
        <div className="h-1 w-3/5 rounded-full" style={{ background: c.linea }} />
      </div>
      <div className="flex flex-col gap-1 rounded-[5px] p-1" style={{ background: c.tarjeta }}>
        <div className="h-1 w-2/3 rounded-full" style={{ background: c.acento }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: c.linea }} />
      </div>
    </div>
  );
}

/** Miniatura de un iPhone con la app en ese modo; Automático va mitad y mitad. */
function Miniatura({ tema }: { tema: Tema }) {
  return (
    <div className="relative h-[92px] w-[52px] overflow-hidden rounded-[11px] shadow-[0_0_0_0.5px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.12)]">
      {tema === "auto" ? (
        <>
          <div className="absolute inset-0">
            <Pantallita modo="claro" />
          </div>
          <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
            <Pantallita modo="oscuro" />
          </div>
        </>
      ) : (
        <Pantallita modo={tema} />
      )}
    </div>
  );
}

/** Ajustes › Apariencia: como Pantalla y brillo de iOS. Se recuerda en este dispositivo. */
export function Apariencia() {
  const tema = useTema();
  return (
    <Grupo titulo="Apariencia">
      <div role="radiogroup" aria-label="Apariencia" className="grid grid-cols-3 px-2 pt-4 pb-3">
        {OPCIONES.map((o) => {
          const elegido = o.valor === tema;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={elegido}
              onClick={() => {
                if (elegido) return;
                haptico();
                guardarTema(o.valor);
              }}
              className="flex flex-col items-center gap-2 rounded-xl py-1 active:opacity-60"
            >
              <Miniatura tema={o.valor} />
              <span className="text-[15px]">{o.etiqueta}</span>
              <span
                aria-hidden
                className={cn(
                  "flex size-[22px] items-center justify-center rounded-full transition-colors duration-200",
                  elegido ? "bg-tint text-white" : "border-[1.5px] border-fill-strong",
                )}
              >
                {elegido ? <Check className="size-3.5" strokeWidth={3.5} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </Grupo>
  );
}
