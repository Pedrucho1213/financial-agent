import type { CSSProperties } from "react";
import { iconoCategoria, iconoDeNombre } from "../lib/categorias";
import { MARCAS, marcaDe } from "../lib/marcas";
import { TRAZOS } from "../lib/marcas-trazos";
import type { TipoMovimiento } from "../lib/tipos";
import { cn } from "../lib/utils";

// Cuadro redondeado como los íconos de iOS: el radio es el 28% del lado.
const caja = "relative inline-flex shrink-0 items-center justify-center overflow-hidden leading-none";

/** El logo de una marca conocida (clave de MARCAS). */
export function LogoMarca({ clave, tamano = 40, className }: { clave: string; tamano?: number; className?: string }) {
  const m = MARCAS[clave];
  if (!m) return null;
  const estilo: CSSProperties = {
    width: tamano,
    height: tamano,
    borderRadius: tamano * 0.28,
    background: m.fondo,
    color: m.tinta,
    boxShadow: m.borde ? "inset 0 0 0 0.5px var(--separator)" : "inset 0 0 0 0.5px rgb(0 0 0 / 0.08)",
  };
  const trazo = m.trazo ? TRAZOS[m.trazo] : undefined;
  return (
    <span aria-hidden data-marca={clave} className={cn(caja, className)} style={estilo}>
      {trazo ? (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "58%", height: "58%" }}>
          <path d={trazo} />
        </svg>
      ) : m.chispa ? (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "62%", height: "62%" }}>
          {[0, 60, 120, 180, 240, 300].map((g) => (
            <rect key={g} x="10.6" y="2.2" width="2.8" height="7" rx="1.4" transform={`rotate(${g} 12 12)`} />
          ))}
        </svg>
      ) : (
        <>
          {m.franjas ? (
            <>
              <i className="absolute inset-x-0 top-[14%] h-[9%]" style={{ background: m.franjas }} />
              <i className="absolute inset-x-0 bottom-[14%] h-[9%]" style={{ background: m.franjas }} />
            </>
          ) : null}
          <span
            className="relative font-extrabold tracking-[-0.02em] whitespace-nowrap"
            style={{
              fontSize: tamano * (m.escala ?? 0.42),
              ...(m.serif ? { fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic" } : null),
            }}
          >
            {m.texto}
          </span>
        </>
      )}
    </span>
  );
}

/** El icono de una categoría, teñido con su color. */
export function LogoCategoria({
  nombre,
  tipo,
  tamano = 40,
  className,
}: {
  nombre: string | null;
  tipo: TipoMovimiento;
  tamano?: number;
  className?: string;
}) {
  const [Icono, color] = iconoCategoria(nombre, tipo);
  return (
    <span
      aria-hidden
      className={cn(caja, className)}
      style={{ width: tamano, height: tamano, borderRadius: tamano * 0.28, backgroundColor: `color-mix(in srgb, ${color} 16%, var(--card))`, color }}
    >
      <Icono style={{ width: tamano * 0.5, height: tamano * 0.5 }} strokeWidth={2.2} />
    </span>
  );
}

/**
 * El logo de un movimiento, una suscripción o un cobro: la marca si se reconoce en el comercio o la descripción
 * (Netflix, Uber, Oxxo…); si no, el icono de su categoría.
 */
export function LogoMovimiento({
  comercio,
  descripcion,
  categoria,
  tipo,
  tamano = 40,
  className,
}: {
  comercio?: string | null;
  descripcion?: string | null;
  categoria: string | null;
  tipo: TipoMovimiento;
  tamano?: number;
  className?: string;
}) {
  // Transferencias y pagos de tarjeta: su flecha o su tarjeta, aunque digan "Nu" o "BBVA".
  const clave = tipo === "gasto" || tipo === "ingreso" ? marcaDe(comercio, descripcion) : null;
  if (clave) return <LogoMarca clave={clave} tamano={tamano} className={className} />;
  return <LogoCategoria nombre={categoria} tipo={tipo} tamano={tamano} className={className} />;
}

// Un pago fijo sin marca ni categoría: el icono según qué es.
const POR_TIPO: Record<string, string> = { renta: "renta", suscripcion: "suscripciones", prestamo: "comisiones e intereses", ingreso: "sueldo" };

/**
 * El logo de una suscripción, pago fijo o cobro por confirmar: la marca por su nombre (Netflix, Smart Fit…); si no,
 * su categoría, o la que diga su nombre ("Luz", "Agua", "Renta"), o la de su tipo.
 */
export function LogoPago({
  nombre,
  tipo,
  categoria,
  tamano = 40,
  className,
}: {
  nombre: string;
  tipo?: string | null;
  categoria?: string | null;
  tamano?: number;
  className?: string;
}) {
  const clave = marcaDe(nombre);
  if (clave) return <LogoMarca clave={clave} tamano={tamano} className={className} />;
  const conIcono = [categoria, nombre, tipo ? POR_TIPO[tipo] : null].find((n) => iconoDeNombre(n));
  return <LogoCategoria nombre={conIcono ?? categoria ?? null} tipo={tipo === "ingreso" ? "ingreso" : "gasto"} tamano={tamano} className={className} />;
}
