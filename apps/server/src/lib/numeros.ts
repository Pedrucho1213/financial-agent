// Montos dichos en español: "mil doscientos cincuenta", "3 mil", "1.5k", "2,350.75".

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

// Un número seguido de estas palabras no es un monto: "hace dos días", "199 con 90 centavos".
const NO_MONTO = /^(dia|dias|semana|semanas|mes|meses|ano|anos|hora|horas|minutos|centavos|msi|veces)$/;

function plano(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Conserva "1,899" y "47.50"; lo demás que no sea letra o número separa palabras.
    .replace(/(\d)[,](?=\d{3}\b)/g, "$1")
    .replace(/[^a-z0-9ñ. ]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function cifra(token: string): number | undefined {
  const k = token.match(/^(\d+(?:\.\d+)?)k$/);
  if (k) return Number(k[1]) * 1000;
  return /^\d+(?:\.\d+)?$/.test(token) ? Number(token) : undefined;
}

/**
 * Los montos que dice la frase, en orden. Junta palabras ("mil doscientos cincuenta" = 1250)
 * y multiplica por "mil" ("3 mil" = 3000). Un "un" o "una" suelto no cuenta.
 */
export function montosDelTexto(texto: string): number[] {
  const tokens = plano(texto);
  const montos: number[] = [];
  let actual: number | undefined;
  let soloArticulo = false;
  const cerrar = (siguiente?: string) => {
    if (actual !== undefined && !soloArticulo && !(siguiente && NO_MONTO.test(siguiente))) montos.push(actual);
    actual = undefined;
    soloArticulo = false;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const numero = cifra(t);
    if (numero !== undefined) {
      cerrar();
      actual = numero;
      continue;
    }
    if (t === "mil" || t === "millon" || t === "millones") {
      const factor = t === "mil" ? 1000 : 1_000_000;
      // "mil" solo es 1000; "doscientos mil" multiplica todo lo anterior.
      actual = (actual === undefined || soloArticulo ? 1 : actual) * factor;
      soloArticulo = false;
      continue;
    }
    if (t in UNIDADES) {
      const valor = UNIDADES[t]!;
      const articulo = t === "un" || t === "una" || t === "uno";
      if (actual === undefined) {
        actual = valor;
        soloArticulo = articulo;
      } else if (actual % 1000 === 0 || (actual % 100 === 0 && valor < 100) || (actual % 10 === 0 && actual % 100 !== 0 && valor < 10)) {
        // "mil" + "doscientos", "doscientos" + "cincuenta", "cincuenta" + "y" + "cinco".
        actual += valor;
        soloArticulo = false;
      } else {
        cerrar(t);
        actual = valor;
        soloArticulo = articulo;
      }
      continue;
    }
    if (t === "y" && actual !== undefined && actual % 10 === 0 && UNIDADES[tokens[i + 1] ?? ""] !== undefined) continue;
    cerrar(t);
  }
  cerrar();
  return montos;
}

/** Si la frase dice el monto con palabras o con "mil"/"k", que es donde los modelos se equivocan. */
export function montoConPalabras(texto: string): boolean {
  return plano(texto).some((t) => t === "mil" || /^\d+(?:\.\d+)?k$/.test(t) || (t in UNIDADES && !["un", "una", "uno"].includes(t)));
}
