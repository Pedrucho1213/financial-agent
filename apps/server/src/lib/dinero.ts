export function aCentavos(monto: number): number {
  return Math.round(monto * 100);
}

const formatos = new Map<string, Intl.NumberFormat>();

/** 125050 -> "$1,250.50"; 8500 -> "$85". Otras monedas llevan su código: "20 USD". */
export function formatearMonto(centavos: number, moneda = "MXN"): string {
  const pesos = centavos / 100;
  const clave = Number.isInteger(pesos) ? "entero" : "decimal";
  let formato = formatos.get(clave);
  if (!formato) {
    formato = new Intl.NumberFormat("es-MX", {
      minimumFractionDigits: clave === "entero" ? 0 : 2,
      maximumFractionDigits: 2,
    });
    formatos.set(clave, formato);
  }
  const numero = formato.format(pesos);
  return moneda === "MXN" ? `$${numero}` : `${numero} ${moneda}`;
}
