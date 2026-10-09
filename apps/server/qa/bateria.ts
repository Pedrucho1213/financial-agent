// Batería amplia de QA para la tanda de cuentas, tarjetas, tags y feedback (2026-10-08). Corre contra el
// modelo real (Ollama), así que solo en la Mac. Desde apps/server:
//   bun qa/bateria.ts [--grupo saldos] [--frase "texto"] [--modelo gemma4:12b-it-qat@none] [--traza] [--veces 2]
// Cada caso arranca con una base vacía en memoria; no toca la base de Pedro.
// Un caso queda "pendiente" (no falla) si lo que verifica todavía no existe en el servidor (saldos, tags).
import { parseArgs } from "node:util";
import { wrapLanguageModel } from "ai";
import { hablar } from "../src/ai/asistente";
import { crearModelo, despertarModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { type Contexto, crearContexto } from "../src/finanzas/contexto";
import { crearMovimiento } from "../src/finanzas/movimientos";
import { normalizar } from "../src/lib/texto";
import { cuentaPorNombre, type Foto, fotografiar, type Mov } from "./bateria-datos";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    modelo: { type: "string", default: `${config.ia.modelo}@${config.ia.razonamiento}` },
    grupo: { type: "string" },
    frase: { type: "string" },
    traza: { type: "boolean", default: false },
    veces: { type: "string", default: "1" },
    // Razonamiento en saldos, tarjetas y correcciones (#44, IA_RAZONAMIENTO_DIFICIL). Por omisión, el de config.
    dificil: { type: "string" },
  },
});

class Pendiente extends Error {}

/** Lo que cada caso puede revisar después de la frase final. */
class Revision {
  constructor(
    readonly antes: Foto,
    readonly despues: Foto,
    readonly respuesta: string,
    readonly herramientas: string[],
  ) {}
  /** Movimientos que creó la frase final, opcionalmente de un tipo. */
  nuevos(tipo?: Mov["tipo"]) {
    const previos = new Set(this.antes.movs.map((m) => m.id));
    return this.despues.movs.filter((m) => !previos.has(m.id) && (!tipo || m.tipo === tipo));
  }
  /** Movimientos que la frase final borró. */
  borrados() {
    const ahora = new Set(this.despues.movs.map((m) => m.id));
    return this.antes.movs.filter((m) => !ahora.has(m.id));
  }
  /** Movimientos que la frase final cambió (mismo id, otros datos). */
  cambiados() {
    const antes = new Map(this.antes.movs.map((m) => [m.id, JSON.stringify({ ...m, actualizadoEn: null })]));
    return this.despues.movs.filter((m) => antes.has(m.id) && antes.get(m.id) !== JSON.stringify({ ...m, actualizadoEn: null }));
  }
  /** Gasto total del mes (pesos MXN); las transferencias y pagos de tarjeta no cuentan. */
  gastoDelMes(f: Foto = this.despues) {
    const mes = new Date().toISOString().slice(0, 7);
    return f.movs.filter((m) => m.tipo === "gasto" && m.fecha.startsWith(mes) && m.moneda === "MXN").reduce((s, m) => s + m.montoCentavos, 0) / 100;
  }
  private credito(nombre: string, campo: "saldo" | "limite" | "usado" | "disponible") {
    if (!this.despues.credito) throw new Pendiente(`el servidor todavía no expone ${campo}`);
    const c = cuentaPorNombre(this.despues, nombre);
    if (!c) return undefined;
    return (this.despues.credito.get(c.id) ?? this.despues.credito.get(c.nombre))?.[campo];
  }
  saldo = (nombre: string) => this.credito(nombre, "saldo");
  limite = (nombre: string) => this.credito(nombre, "limite");
  usado = (nombre: string) => this.credito(nombre, "usado");
  disponible = (nombre: string) => this.credito(nombre, "disponible");
  existe = (nombre: string) => cuentaPorNombre(this.despues, nombre) !== undefined;
  /** Cuentas cuyo nombre contiene `nombre`, de crédito o no ("Revolut" débito y "Revolut crédito" a la vez). */
  cuentasCon(nombre: string, credito: boolean) {
    const b = normalizar(nombre);
    return this.despues.cuentas.filter((c) => normalizar(c.nombre).includes(b) && (c.tipo === "credito") === credito);
  }
  /** Saldo, límite, usado o disponible de una cuenta concreta. */
  de(c: { id: string; nombre: string } | undefined, campo: "saldo" | "limite" | "usado" | "disponible") {
    if (!this.despues.credito) throw new Pendiente(`el servidor todavía no expone ${campo}`);
    return c ? (this.despues.credito.get(c.id) ?? this.despues.credito.get(c.nombre))?.[campo] : undefined;
  }
  cuentasNuevas() {
    const previas = new Set(this.antes.cuentas.map((c) => c.id));
    return this.despues.cuentas.filter((c) => !previas.has(c.id));
  }
  /** Tags del movimiento (sin "#", normalizados). */
  tagsDe(m: Mov) {
    if (!this.despues.tags) throw new Pendiente("el servidor todavía no tiene tags");
    return this.despues.tags.get(m.id) ?? [];
  }
  /** La cuenta del movimiento por nombre. */
  cuentaDe(m: Mov | undefined) {
    return m ? this.despues.cuentas.find((c) => c.id === m.cuentaId)?.nombre : undefined;
  }
  destinoDe(m: Mov | undefined) {
    return m ? this.despues.cuentas.find((c) => c.id === m.cuentaDestinoId)?.nombre : undefined;
  }
  pregunta = () => this.respuesta.includes("?");
  /** La respuesta menciona todos los textos (sin acentos; "20,000", "20000" y "20 mil" cuentan igual). */
  dice(...textos: string[]) {
    const r = plano(this.respuesta);
    return textos.every((t) => r.includes(plano(t)));
  }
  usoHerramienta = (nombre: string) => this.herramientas.some((h) => h.startsWith(nombre));
}

const plano = (s: string) =>
  normalizar(s)
    .replace(/(\d+(?:\.\d+)?) ?mil\b/g, (_, n) => String(Math.round(Number(n) * 1000)))
    .replace(/[,\s$]/g, "")
    .replace(/pesos?/g, "");

/** Renta 12,500 con BBVA, Uber 300 y Walmart 900 con Nu, hoy. */
const MES_TIPICO = (ctx: Contexto) => {
  crearMovimiento(ctx, { tipo: "gasto", monto: 12500, categoria: "Renta", descripcion: "Renta", cuenta: "BBVA" } as never);
  crearMovimiento(ctx, { tipo: "gasto", monto: 300, categoria: "Taxi y apps", comercio: "Uber", cuenta: "Nu" } as never);
  crearMovimiento(ctx, { tipo: "gasto", monto: 900, categoria: "Súper", comercio: "Walmart", cuenta: "Nu" } as never);
};
// Con 5 o más gastos (MINIMO_GASTOS del #39) para que analizar haga el análisis completo: total 14,175.
const MES_COMPLETO = (ctx: Contexto) => {
  MES_TIPICO(ctx);
  crearMovimiento(ctx, { tipo: "gasto", monto: 150, categoria: "Súper", comercio: "Oxxo", cuenta: "Nu" } as never);
  crearMovimiento(ctx, { tipo: "gasto", monto: 85, categoria: "Café", comercio: "Starbucks", cuenta: "Nu" } as never);
  crearMovimiento(ctx, { tipo: "gasto", monto: 240, categoria: "Entretenimiento", comercio: "Cinépolis", cuenta: "Nu" } as never);
};

type Caso = {
  grupo: string;
  frase: string;
  /** Frases dictadas antes, en la misma conversación (arman el estado por voz). */
  previos?: string[];
  /** Cada frase en su propia conversación, como el Atajo pasada la media hora: lo anterior solo llega en el resumen (#44). */
  separados?: boolean;
  /** Estado armado directo en la base, para no depender del modelo en la preparación. */
  preparar?: (ctx: Contexto) => void;
  verificar: (r: Revision) => true | string | false;
  nota?: string;
};

const no = (cond: boolean, detalle: unknown): true | string => (cond ? true : JSON.stringify(detalle).slice(0, 500));
const cerca = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.01;
const gasto = (ctx: Contexto, monto: number, categoria: string, extra: Record<string, unknown> = {}) =>
  crearMovimiento({ ...ctx, entradaId: "previa", textoOriginal: undefined }, { tipo: "gasto", monto, categoria, ...extra } as never);

const DOS_CUENTAS = ["Tengo 20 mil pesos en mi cuenta de Revolut y 10 mil en Bancomer"];
const NU = ["Mi tarjeta de crédito Nu tiene un límite de 30 mil y llevo usados 12 mil"];
const CUENTAS_Y_NU = [...DOS_CUENTAS, ...NU];

const REVOLUT_PEDRO = "En Revolut tengo 19,291 pesos";
const INVEX_DIJO = "Te aviso que en mi tarjeta de crédito Invex tengo un total de 37,581. 21 pesos";
const INVEX_CORRIGE = "Ese registro que acabas de hacer no es algo que debo si no es lo que tengo actualmente disponible";
const INVEX_LIMITE = "Mi límite de crédito de Invex es de 57,400 MXN";
const INVEX_DISPONIBLE = "Corrige mi saldo disponible de Invex a 37,581.12 MXN";
const NU_PEDRO = "En mi tarjeta de crédito Nu tengo un crédito disponible de 33600 MXN";
// El dictado real de las 00:44Z: "Nu" se oyó "no", con Invex (límite 57,400, debe 19,818.88) como única tarjeta.
const NU_OIDA_NO = "En mi tarjeta no de crédito tengo un límite disponible de 33,600 pesos";
const INVEX_ESTADO = "Mi tarjeta de crédito Invex tiene un límite de 57,400 y debo 19,818.88";
const INVEX_INTACTA = (r: Revision) => cerca(r.limite("invex"), 57400) && cerca(r.usado("invex"), 19818.88);
// Revolut de crédito además de la de débito, y Mercado Pago (01:23–01:25Z, frases exactas de la base).
const REVOLUT_LIMITE = "Tengo un límite de 34,000 pesos mexicanos en mi tarjeta de crédito de Revolut";
const REVOLUT_LIMITE_2 = "El límite disponible de mi tarjeta de crédito Revolut de 34,000 pesos";
const REVOLUT_DISPONIBLE = "En mi tarjeta de crédito Revolut tengo un saldo disponible de 6701.05 pesos";
const MP_LIMITE = "En mi tarjeta de Mercado pago de crédito tengo un límite total de 33,200 pesos";
const MP_CORTADA = "Mi límite total es de 33,200 pesos en mi tarjeta de crédito Mercado pago y tengo un disponible";
const MP_DISPONIBLE = "En mi tarjeta de crédito de Mercado pago me queda disponible 3607 pesos";
const DEBITO_REVOLUT_INTACTA = (r: Revision) => r.cuentasCon("revolut", false).length === 1 && cerca(r.de(r.cuentasCon("revolut", false)[0], "saldo"), 19291);
const SIN_EFECTIVO = (r: Revision) => !r.existe("efectivo") || r.saldo("efectivo") == null;
// Ningún saldo de los ejemplos de las instrucciones (Revolut 20 mil, Bancomer 10 mil, Efectivo 5 mil, Nu 7 mil) sin decirlo.
const SIN_EJEMPLOS = (r: Revision) => SIN_EFECTIVO(r) && !r.existe("bancomer") && !r.existe("nu") && !cerca(r.saldo("revolut"), 20000);
const CASOS: Caso[] = [
  // ── Saldos de cuentas por voz ──────────────────────────────────────────────────────────────
  { grupo: "saldos", frase: DOS_CUENTAS[0]!, verificar: (r) => no(cerca(r.saldo("revolut"), 20000) && cerca(r.saldo("bancomer"), 10000) && r.nuevos().length === 0, { rev: r.saldo("revolut"), ban: r.saldo("bancomer"), movs: r.nuevos().length, resp: r.respuesta }) },
  { grupo: "saldos", frase: "Te aviso que tengo veinte mil quinientos pesos en Revolut", verificar: (r) => no(cerca(r.saldo("revolut"), 20500), r.saldo("revolut")) },
  { grupo: "saldos", frase: "En Bancomer tengo mil 500", verificar: (r) => no(cerca(r.saldo("bancomer"), 1500), r.saldo("bancomer")) },
  { grupo: "saldos", frase: "Tengo 12,350.50 en mi cuenta de nómina de BBVA", verificar: (r) => no(cerca(r.saldo("bbva"), 12350.5), r.saldo("bbva")) },
  { grupo: "saldos", frase: "Traigo 800 pesos en efectivo", verificar: (r) => no(cerca(r.saldo("efectivo"), 800) && r.nuevos().length === 0, { s: r.saldo("efectivo"), movs: r.nuevos() }) },
  { grupo: "saldos", frase: "Tengo 20 mil en Revolut, no, perdón, 25 mil", verificar: (r) => no(cerca(r.saldo("revolut"), 25000), r.saldo("revolut")), nota: "se corrige al dictar" },
  { grupo: "saldos", frase: "Ahora tengo 18 mil en Revolut", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("revolut"), 18000) && cerca(r.saldo("bancomer"), 10000), { rev: r.saldo("revolut"), ban: r.saldo("bancomer") }), nota: "actualizar = fijar, no sumar" },
  { grupo: "saldos", frase: "Tengo 5 mil", verificar: (r) => no(r.pregunta() && r.cuentasNuevas().length === 0, { resp: r.respuesta, nuevas: r.cuentasNuevas().map((c) => c.nombre) }), nota: "sin cuenta: pregunta dónde" },
  { grupo: "saldos", frase: "Tengo 300 dólares en Wise", verificar: (r) => no(r.existe("wise") && (cerca(r.saldo("wise"), 300) || r.pregunta()) && /d[oó]lar|usd/i.test(r.respuesta), { wise: r.saldo("wise"), resp: r.respuesta }), nota: "moneda USD: no convertir a pesos en silencio" },
  { grupo: "saldos", frase: "En BBVA tengo 4 mil", previos: ["Tengo 10 mil en Bancomer"], verificar: (r) => no(r.cuentasNuevas().length === 0 || r.pregunta(), { nuevas: r.cuentasNuevas().map((c) => c.nombre), resp: r.respuesta }), nota: "BBVA y Bancomer son el mismo banco: no crear otra sin preguntar" },
  { grupo: "saldos", frase: "Tengo 300 dólares en Wise y 10 mil en Bancomer", verificar: (r) => no(cerca(r.saldo("bancomer"), 10000) && r.existe("wise") && (r.pregunta() || cerca(r.saldo("wise"), 300)) && /d[oó]lar|usd/i.test(r.respuesta), { ban: r.saldo("bancomer"), wise: r.saldo("wise"), resp: r.respuesta }), nota: "PR #41: guarda los pesos y solo pregunta por los dólares" },
  { grupo: "saldos", frase: "Tengo 1,500 dólares en Wise y 10,000 pesos en Bancomer", verificar: (r) => no(cerca(r.saldo("bancomer"), 10000) && r.existe("wise") && r.saldo("wise") == null && r.dice("1500") && r.pregunta(), { ban: r.saldo("bancomer"), wise: r.saldo("wise"), resp: r.respuesta }), nota: "PR #41: comas de miles; pregunta por 1,500, no por 1" },
  { grupo: "saldos", frase: "Tengo 2,000 USD en Wise", verificar: (r) => no(r.existe("wise") && r.existe("wise") && r.saldo("wise") == null && r.dice("2000") && r.pregunta(), { wise: r.saldo("wise"), resp: r.respuesta }), nota: "PR #41: USD con coma de miles" },
  { grupo: "saldos", frase: "Tengo como 20 en Revolut", verificar: (r) => no(r.pregunta() || cerca(r.saldo("revolut"), 20) || cerca(r.saldo("revolut"), 20000), { s: r.saldo("revolut"), resp: r.respuesta }), nota: "ambiguo: 20 o 20 mil" },
  { grupo: "saldos", frase: "Tengo 20k en revo lut", verificar: (r) => no(cerca(r.saldo("revolut"), 20000), { s: r.saldo("revolut"), cuentas: r.despues.cuentas.map((c) => c.nombre) }), nota: "dictado con espacio y 'k'" },
  { grupo: "saldos", frase: "Mi cuenta de ahorro en Nu tiene 45 mil y la de débito 3 mil", verificar: (r) => no(r.despues.cuentas.length >= 2, r.despues.cuentas.map((c) => c.nombre)) },

  // ── Tarjetas de crédito: límite, usado y disponible ─────────────────────────────────────────
  { grupo: "credito", frase: NU[0]!, verificar: (r) => no(cerca(r.limite("nu"), 30000) && cerca(r.usado("nu"), 12000) && cerca(r.disponible("nu"), 18000), { l: r.limite("nu"), u: r.usado("nu"), d: r.disponible("nu") }) },
  { grupo: "credito", frase: "Oye, te recuerdo que tengo 7000 pesos disponibles en mi tarjeta de crédito", previos: NU, verificar: (r) => no(cerca(r.disponible("nu"), 7000) && cerca(r.limite("nu"), 30000), { d: r.disponible("nu"), l: r.limite("nu") }), nota: "una sola tarjeta: es esa" },
  { grupo: "credito", frase: "Tengo 7000 disponibles en mi tarjeta de crédito", previos: [...NU, "Mi BBVA Azul tiene límite de 20 mil"], verificar: (r) => no(r.pregunta() && !cerca(r.disponible("azul"), 7000) && !cerca(r.disponible("nu"), 7000) && cerca(r.disponible("nu"), 18000) && r.nuevos().length === 0, { resp: r.respuesta, azul: r.disponible("azul"), nu: r.disponible("nu"), movs: r.nuevos().length }), nota: "dos tarjetas: pregunta cuál y no toca ninguna (QA-096)" },
  { grupo: "credito", frase: "Tengo un límite de 50 mil en la Amex", verificar: (r) => no(cerca(r.limite("amex"), 50000), r.limite("amex")) },
  { grupo: "credito", frase: "Tengo ocupado 8 mil de la BBVA Azul", previos: ["Mi BBVA Azul tiene límite de 20 mil"], verificar: (r) => no(cerca(r.usado("azul"), 8000) && cerca(r.disponible("azul"), 12000), { u: r.usado("azul"), d: r.disponible("azul") }) },
  { grupo: "credito", frase: "Gasté 1,500 en el súper con la Nu", previos: NU, verificar: (r) => no(cerca(r.usado("nu"), 13500) && cerca(r.disponible("nu"), 16500) && r.nuevos("gasto").length === 1, { u: r.usado("nu"), d: r.disponible("nu") }) },
  { grupo: "credito", frase: "Gasté 20 mil en un vuelo con la Nu", previos: NU, verificar: (r) => no(r.pregunta() || r.dice("disponible") || r.dice("limite"), r.respuesta), nota: "excede el disponible (18 mil): avisar, no callar" },

  // ── Gastos que mueven saldo ────────────────────────────────────────────────────────────────
  { grupo: "gastos", frase: "Gasté 300 en tacos con Revolut", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("revolut"), 19700) && cerca(r.saldo("bancomer"), 10000), { rev: r.saldo("revolut"), ban: r.saldo("bancomer") }) },
  { grupo: "gastos", frase: "Pagué 250 de Uber con la tarjeta de Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 9750), r.saldo("bancomer")) },
  { grupo: "gastos", frase: "Gasté 120 en tacos", previos: DOS_CUENTAS, verificar: (r) => no(r.nuevos("gasto").length === 1 && !/-\s?\$|menos \d|negativ/i.test(r.respuesta), { movs: r.nuevos().length, resp: r.respuesta }), nota: "sin método: no inventar uno ni dejar saldos raros" },
  { grupo: "gastos", frase: "Gasté 300 en efectivo en la tiendita", previos: ["Traigo 100 pesos en efectivo"], verificar: (r) => no(r.pregunta() || r.dice("100") || r.dice("negativ") || /menos \$?\s?200|-\s?\$\s?200/i.test(r.respuesta), { s: r.saldo("efectivo"), resp: r.respuesta }), nota: "gasta más de lo que hay: avisar, no quedar en -200 en silencio" },
  { grupo: "gastos", frase: "Gasté 300 en tacos", verificar: (r) => no(r.nuevos("gasto").length === 1 && !/-\s?\$|menos \d|negativ/i.test(r.respuesta), r.respuesta), nota: "sin saldos conocidos no debe hablar de saldo negativo" },
  { grupo: "gastos", frase: "Uber 89 con Revolut, Didi 120 con Bancomer y un Rappi de 250 con Revolut", previos: DOS_CUENTAS, verificar: (r) => no(r.nuevos("gasto").length === 3 && cerca(r.saldo("revolut"), 20000 - 339) && cerca(r.saldo("bancomer"), 9880), { rev: r.saldo("revolut"), ban: r.saldo("bancomer"), n: r.nuevos().length }) },

  // ── Transferencias entre cuentas propias (no son gasto) ─────────────────────────────────────
  { grupo: "transferencias", frase: "Acabo de transferir 5 mil de Bancomer a Revolut", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 5000) && cerca(r.saldo("revolut"), 25000) && r.nuevos("gasto").length === 0 && r.gastoDelMes() === r.gastoDelMes(r.antes), { ban: r.saldo("bancomer"), rev: r.saldo("revolut"), gastos: r.nuevos("gasto").length }) },
  { grupo: "transferencias", frase: "Me pasé 2 mil de Revolut a Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("revolut"), 18000) && cerca(r.saldo("bancomer"), 12000), { rev: r.saldo("revolut"), ban: r.saldo("bancomer") }) },
  { grupo: "transferencias", frase: "Transferí 5 mil a Revolut", previos: DOS_CUENTAS, verificar: (r) => no(r.pregunta() || cerca(r.saldo("bancomer"), 5000), { resp: r.respuesta, ban: r.saldo("bancomer") }), nota: "sin origen: pregunta de dónde (o usa la única otra cuenta)" },
  { grupo: "transferencias", frase: "Le transferí 500 a Juan", previos: DOS_CUENTAS, verificar: (r) => no(!r.existe("juan"), { cuentas: r.cuentasNuevas().map((c) => c.nombre), movs: r.nuevos().map((m) => m.tipo) }), nota: "Juan no es cuenta propia: no crear cuenta 'Juan'" },
  { grupo: "transferencias", frase: "Pasé mil del efectivo a Bancomer", previos: [...DOS_CUENTAS, "Traigo 3 mil en efectivo"], verificar: (r) => no(cerca(r.saldo("efectivo"), 2000) && cerca(r.saldo("bancomer"), 11000) && r.nuevos("gasto").length === 0, { ef: r.saldo("efectivo"), ban: r.saldo("bancomer") }) },
  { grupo: "transferencias", frase: "Saqué 500 del cajero de Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 9500) && r.nuevos("gasto").length === 0, { ban: r.saldo("bancomer"), movs: r.nuevos().map((m) => m.tipo) }), nota: "retiro = transferencia a efectivo" },
  { grupo: "transferencias", frase: "Transferí 50 mil de Bancomer a Revolut", previos: DOS_CUENTAS, verificar: (r) => no(r.pregunta() || r.dice("10000") || r.dice("saldo") || /mas de lo que (tenias|tienes|habia|hay)|no alcanza|no te alcanza/.test(normalizar(r.respuesta)), r.respuesta), nota: "más de lo que hay (10 mil): avisar" },

  // ── Pagos y abonos a tarjeta (no son gasto) ─────────────────────────────────────────────────
  { grupo: "pagos_tarjeta", frase: "Te aviso que acabo de pagar 3 mil a la Nu desde Bancomer", previos: CUENTAS_Y_NU, verificar: (r) => no(cerca(r.saldo("bancomer"), 7000) && cerca(r.usado("nu"), 9000) && cerca(r.disponible("nu"), 21000) && r.nuevos("gasto").length === 0, { ban: r.saldo("bancomer"), u: r.usado("nu"), d: r.disponible("nu") }) },
  { grupo: "pagos_tarjeta", frase: "Abono de 1500 a la Nu", previos: CUENTAS_Y_NU, verificar: (r) => no((cerca(r.usado("nu"), 10500) && r.nuevos("gasto").length === 0) || r.pregunta(), { u: r.usado("nu"), resp: r.respuesta }), nota: "sin origen: pregunta o usa la cuenta de siempre" },
  { grupo: "pagos_tarjeta", frase: "Pagué la tarjeta", previos: CUENTAS_Y_NU, verificar: (r) => no(r.pregunta() && r.nuevos().length === 0, r.respuesta), nota: "sin monto: pregunta cuánto" },
  { grupo: "pagos_tarjeta", frase: "Pagué el total de la Nu con Revolut", previos: CUENTAS_Y_NU, verificar: (r) => no((cerca(r.usado("nu"), 0) && cerca(r.saldo("revolut"), 8000)) || r.pregunta(), { u: r.usado("nu"), rev: r.saldo("revolut") }) },
  { grupo: "pagos_tarjeta", frase: "Pagué la tarjeta de crédito, 5 mil", previos: NU, verificar: (r) => no(r.nuevos("pago_tarjeta").length === 1 && cerca(r.usado("nu"), 7000), { u: r.usado("nu"), resp: r.respuesta }), nota: "una sola tarjeta: es esa, sin preguntar" },
  { grupo: "pagos_tarjeta", frase: "Ya pagué la Nu", previos: CUENTAS_Y_NU, verificar: (r) => no(r.pregunta() || r.dice("12000"), r.respuesta), nota: "¿cuánto? o confirma el total de 12 mil" },

  // ── Meses sin intereses ─────────────────────────────────────────────────────────────────────
  { grupo: "msi", frase: "Acabo de comprar una tele de 12 mil a 12 meses sin intereses con la Nu", previos: NU, verificar: (r) => no(cerca(r.usado("nu"), 24000) && cerca(r.disponible("nu"), 6000), { u: r.usado("nu"), d: r.disponible("nu") }), nota: "la compra a MSI aparta el total del disponible" },
  { grupo: "msi", frase: "Compré unos tenis de 2,400 a 6 MSI con la Nu", previos: NU, verificar: (r) => no(r.dice("400") || r.dice("6"), r.respuesta), nota: "dice la mensualidad" },
  { grupo: "msi", frase: "Compré un celular a meses", verificar: (r) => no(r.pregunta(), r.respuesta), nota: "sin monto ni plazo: pregunta" },
  { grupo: "msi", frase: "¿Cuánto me falta de pagar de la tele?", previos: [...NU, "Compré una tele de 12 mil a 12 meses sin intereses con la Nu"], verificar: (r) => no(/\d/.test(r.respuesta) && r.nuevos().length === 0, r.respuesta) },

  // ── Préstamos y adelantos ───────────────────────────────────────────────────────────────────
  { grupo: "prestamos", frase: "Le presté 500 a Juan de mi efectivo", previos: ["Traigo 2 mil en efectivo"], verificar: (r) => no(cerca(r.saldo("efectivo"), 1500) && r.nuevos("gasto").length === 0, { ef: r.saldo("efectivo"), movs: r.nuevos().map((m) => m.tipo) }) },
  { grupo: "prestamos", frase: "Juan me pagó 200 en efectivo", previos: ["Traigo 2 mil en efectivo", "Le presté 500 a Juan de mi efectivo"], verificar: (r) => no(cerca(r.saldo("efectivo"), 1700) && r.dice("300"), { ef: r.saldo("efectivo"), resp: r.respuesta }), nota: "dice cuánto falta (300)" },
  { grupo: "prestamos", frase: "Mi hermano me prestó 2 mil y me los depositó a Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 12000) && r.nuevos("ingreso").every((m) => !/sueldo/i.test(m.descripcion ?? "")), { ban: r.saldo("bancomer"), movs: r.nuevos().map((m) => m.tipo) }), nota: "deuda, no sueldo" },
  { grupo: "prestamos", frase: "Me adelantaron 3 mil de la quincena a Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 13000), r.saldo("bancomer")) },

  // ── Ingresos ───────────────────────────────────────────────────────────────────────────────
  { grupo: "ingresos", frase: "Me llegó la quincena de 15 mil a Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 25000) && r.nuevos("ingreso").length === 1, { ban: r.saldo("bancomer"), n: r.nuevos("ingreso").length }) },
  { grupo: "ingresos", frase: "Me depositaron 2,500 de un freelance en Revolut", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("revolut"), 22500), r.saldo("revolut")) },
  { grupo: "ingresos", frase: "Me llegó la quincena", previos: DOS_CUENTAS, verificar: (r) => no(r.pregunta() && r.nuevos().length === 0 && cerca(r.saldo("bancomer"), 10000) && cerca(r.saldo("revolut"), 20000), { resp: r.respuesta, movs: r.nuevos().length, ban: r.saldo("bancomer"), rev: r.saldo("revolut") }), nota: "sin monto: pregunta y no guarda nada (QA-097)" },

  // ── Tags ───────────────────────────────────────────────────────────────────────────────────
  { grupo: "tags", frase: "Gasté 500 en la cena, ponle la etiqueta viaje Oaxaca", verificar: (r) => no(r.nuevos("gasto").length === 1 && r.tagsDe(r.nuevos("gasto")[0]!).some((t) => t.includes("oaxaca")), r.nuevos().map((m) => r.tagsDe(m))) },
  { grupo: "tags", frase: "Etiqueta los últimos 3 gastos como trabajo", preparar: (c) => { gasto(c, 60, "Café"); gasto(c, 230, "Taxi y apps"); gasto(c, 150, "Comida"); gasto(c, 900, "Súper"); }, verificar: (r) => no(r.despues.movs.filter((m) => r.tagsDe(m).includes("trabajo")).length === 3, r.despues.movs.map((m) => r.tagsDe(m))) },
  { grupo: "tags", frase: "¿Cuánto llevo gastado en el viaje a Oaxaca?", previos: ["Gasté 500 en la cena, ponle la etiqueta viaje Oaxaca", "Gasté 300 en el hotel con la etiqueta viaje Oaxaca"], verificar: (r) => no(r.dice("800"), r.respuesta) },
  { grupo: "tags", frase: "Quítale la etiqueta de trabajo al café", previos: ["Gasté 60 en café, es de trabajo"], verificar: (r) => no(r.despues.movs.every((m) => !r.tagsDe(m).includes("trabajo")), r.despues.movs.map((m) => r.tagsDe(m))) },

  // ── Consultas de saldo y crédito ────────────────────────────────────────────────────────────
  { grupo: "consultas", frase: "¿Cuánto tengo en Revolut?", previos: DOS_CUENTAS, verificar: (r) => no(r.dice("20000") && r.nuevos().length === 0, r.respuesta) },
  { grupo: "consultas", frase: "¿Cuánto dinero tengo en total?", previos: DOS_CUENTAS, verificar: (r) => no(r.dice("30000"), r.respuesta) },
  { grupo: "consultas", frase: "¿Cuánto puedo usar de mi Nu?", previos: NU, verificar: (r) => no(r.dice("18000"), r.respuesta) },
  { grupo: "consultas", frase: "¿Cuánto debo de tarjetas?", previos: [...NU, "Tengo ocupado 8 mil de la BBVA Azul"], verificar: (r) => no(r.dice("20000") || (r.dice("12000") && r.dice("8000")), r.respuesta) },
  { grupo: "consultas", frase: "¿Cuánto tengo en Santander?", previos: DOS_CUENTAS, verificar: (r) => no(!/\$?\d/.test(r.respuesta.replace(/20,?000|10,?000/g, "")) && r.cuentasNuevas().length === 0, r.respuesta), nota: "cuenta que no existe: no inventar saldo ni crearla" },
  { grupo: "consultas", frase: "¿Cuánto tengo?", verificar: (r) => no(!/\$\s?0\b|0 pesos/.test(r.respuesta) || r.pregunta(), r.respuesta), nota: "sin cuentas: no decir 'tienes 0'" },

  // ── Correcciones y borrados (deben dar feedback real, no "Anotado") ─────────────────────────
  { grupo: "feedback", frase: "Borra el último gasto", previos: ["Gasté 300 en tacos"], verificar: (r) => no(r.borrados().length === 1 && r.dice("tacos") && !/^anotado/i.test(r.respuesta), r.respuesta) },
  { grupo: "feedback", frase: "El de los tacos fueron 350, no 300", previos: ["Gasté 300 en tacos"], verificar: (r) => no(r.cambiados().length === 1 && r.dice("350") && r.nuevos().length === 0, { cambio: r.cambiados().length, resp: r.respuesta }) },
  { grupo: "feedback", frase: "Ese gasto fue con Revolut, no con Bancomer", previos: [...DOS_CUENTAS, "Gasté 300 en tacos con Bancomer"], verificar: (r) => no(cerca(r.saldo("revolut"), 19700) && cerca(r.saldo("bancomer"), 10000), { rev: r.saldo("revolut"), ban: r.saldo("bancomer") }), nota: "mover el gasto de cuenta corrige los dos saldos" },
  { grupo: "feedback", frase: "Borra la transferencia", previos: [...DOS_CUENTAS, "Transferí 5 mil de Bancomer a Revolut"], verificar: (r) => no(cerca(r.saldo("bancomer"), 10000) && cerca(r.saldo("revolut"), 20000), { ban: r.saldo("bancomer"), rev: r.saldo("revolut") }), nota: "borrar regresa los dos saldos" },
  { grupo: "feedback", frase: "Deshaz eso", previos: [...CUENTAS_Y_NU, "Pagué 3 mil a la Nu desde Bancomer"], verificar: (r) => no(cerca(r.saldo("bancomer"), 10000) && cerca(r.usado("nu"), 12000), { ban: r.saldo("bancomer"), u: r.usado("nu") }) },

  // ── Análisis por voz (PR #39: herramienta analizar y respuestas de consulta armadas en código) ──
  { grupo: "analisis", frase: "¿Cómo voy?", preparar: MES_COMPLETO, verificar: (r) => no((r.usoHerramienta("analizar") || r.usoHerramienta("consultar_gastos")) && /\d/.test(r.respuesta) && r.nuevos().length === 0, { h: r.herramientas, resp: r.respuesta }) },
  { grupo: "analisis", frase: "¿Cómo voy?", previos: DOS_CUENTAS, preparar: MES_COMPLETO, verificar: (r) => no(!r.herramientas.every((h) => h.startsWith("consultar_cuentas")) && (r.dice("14175") || /14 mil|14,1/.test(r.respuesta)) && r.nuevos().length === 0, { h: r.herramientas, resp: r.respuesta }), nota: "PR #41/#39: con cuentas registradas «¿cómo voy?» habla de gastos, no de saldos" },
  { grupo: "analisis", frase: "¿Cómo voy?", preparar: MES_TIPICO, verificar: (r) => no((r.dice("13700") || r.dice("13,700") || /13 mil/.test(r.respuesta)) && r.nuevos().length === 0, { h: r.herramientas, resp: r.respuesta }), nota: "QA-090: con pocos gastos igual dice cuánto lleva" },
  { grupo: "analisis", frase: "¿En qué puedo ahorrar?", preparar: MES_COMPLETO, verificar: (r) => no(r.usoHerramienta("analizar") && r.nuevos().length === 0, { h: r.herramientas, resp: r.respuesta }) },
  { grupo: "analisis", frase: "¿Cómo voy a cerrar el mes?", preparar: MES_COMPLETO, verificar: (r) => no(r.usoHerramienta("analizar") && /\d/.test(r.respuesta), { h: r.herramientas, resp: r.respuesta }) },
  { grupo: "analisis", frase: "¿Cómo voy con mi presupuesto de comida?", previos: ["Pon un presupuesto de comida de 3000 al mes"], preparar: MES_TIPICO, verificar: (r) => no(r.usoHerramienta("consultar_planes"), r.herramientas), nota: "presupuesto: consultar_planes, no analizar" },
  { grupo: "analisis", frase: "¿Cuánto gasté con la Nu?", preparar: MES_TIPICO, verificar: (r) => no(!r.dice("13700") && !r.dice("13,700"), r.respuesta), nota: "QA-085: no dar el total de todas las cuentas" },
  { grupo: "analisis", frase: "¿Cuánto gasté este mes sin contar la renta?", preparar: MES_TIPICO, verificar: (r) => no(r.dice("1200") && !r.dice("13700"), r.respuesta), nota: "QA-085 / QA-091: la renta es un gasto del mes, no un recurrente" },
  { grupo: "analisis", frase: "¿En qué gasté menos este mes?", preparar: MES_TIPICO, verificar: (r) => no(!/gastaste mas en (vivienda|renta)/.test(normalizar(r.respuesta)), r.respuesta), nota: "QA-085: no contestar al revés" },
  { grupo: "analisis", frase: "¿Cuánto gasté en Uber este mes?", preparar: MES_TIPICO, verificar: (r) => no(r.dice("300") && !r.dice("13700"), r.respuesta) },

  // ── Regresiones de lo que ya funciona ──────────────────────────────────────────────────────
  { grupo: "regresion", frase: "Gasté 120 en tacos", verificar: (r) => no(r.nuevos("gasto").length === 1 && r.nuevos("gasto")[0]!.montoCentavos === 12000, r.nuevos()) },
  { grupo: "regresion", frase: "Gasté 450 en la farmacia, no, perdón, fueron 540", verificar: (r) => no(r.nuevos("gasto").length === 1 && r.nuevos("gasto")[0]!.montoCentavos === 54000, r.nuevos()) },
  { grupo: "regresion", frase: "Gasté 120 en tacos", previos: ["Gasté 120 en tacos"], verificar: (r) => no(r.despues.movs.length === 1 && r.pregunta(), { n: r.despues.movs.length, resp: r.respuesta }) },
  { grupo: "regresion", frase: "Oye, cuánto llevo gastado este mes", preparar: (c) => { gasto(c, 60, "Café"); gasto(c, 1850, "Súper"); }, verificar: (r) => no(r.dice("1910") && r.nuevos().length === 0, r.respuesta) },
  { grupo: "regresion", frase: "Cancelé Netflix", previos: ["Netflix me cobra 219 cada mes el día 12"], verificar: (r) => no(r.nuevos().length === 0 && !r.pregunta(), r.respuesta) },
  { grupo: "regresion", frase: "Spotify me cobra 10 dólares cada mes, el día 5", verificar: (r) => no(r.nuevos().length === 0, r.nuevos()) },
  { grupo: "regresion", frase: "Uber 89, Didi 120 y un Rappi de 250", verificar: (r) => no(r.nuevos("gasto").length === 3, r.nuevos()) },
  { grupo: "regresion", frase: "Registra que gasté 0 pesos en nada", verificar: (r) => no(r.nuevos().length === 0, r.nuevos()) },
  { grupo: "regresion", frase: "El súper de hoy fue con la tarjeta de crédito Nu", preparar: (c) => { gasto(c, 1850, "Súper", { comercio: "Walmart" }); }, verificar: (r) => no(r.nuevos().length === 0 && /nu/i.test(r.cuentaDe(r.despues.movs[0]) ?? ""), { cuenta: r.cuentaDe(r.despues.movs[0]), resp: r.respuesta }) },
  { grupo: "regresion", frase: "Pon un presupuesto de comida de 3 mil al mes", verificar: (r) => no(r.nuevos().length === 0 && !r.pregunta(), r.respuesta) },
  { grupo: "regresion", frase: "¿Cuánto puedo gastar hoy?", verificar: (r) => no(r.nuevos().length === 0, r.respuesta) },
  // ── Secuencias reales de Pedro (2026-10-09, PR #44). Quedan en la batería para siempre ─────────────────
  // Invex: "tengo un total de" quedó como deuda; al corregir en otro dictado inventó Revolut 20 mil, Invex límite
  // 30 mil y Efectivo 5 mil. Luego quería decir el límite (57,400) y que sacara la deuda sola, y corregir el disponible.
  { grupo: "pedro", frase: INVEX_DIJO, previos: [REVOLUT_PEDRO], verificar: (r) => no(cerca(r.disponible("invex"), 37581.21) && !(r.usado("invex") ?? 0) && cerca(r.saldo("revolut"), 19291) && r.nuevos().length === 0, { d: r.disponible("invex"), u: r.usado("invex"), rev: r.saldo("revolut"), movs: r.nuevos().length }), nota: "'tengo un total de' en crédito es disponible, no deuda" },
  { grupo: "pedro", frase: INVEX_CORRIGE, previos: [REVOLUT_PEDRO, INVEX_DIJO], verificar: (r) => no(cerca(r.disponible("invex"), 37581.21) && !(r.usado("invex") ?? 0) && !cerca(r.limite("invex"), 30000) && cerca(r.saldo("revolut"), 19291) && SIN_EJEMPLOS(r) && r.nuevos().length === 0, { d: r.disponible("invex"), u: r.usado("invex"), l: r.limite("invex"), rev: r.saldo("revolut"), cuentas: r.despues.cuentas.map((c) => c.nombre), ef: r.existe("efectivo") ? r.saldo("efectivo") : "no existe" }), nota: "misma conversación: corrige con su cifra y no inventa" },
  { grupo: "pedro", separados: true, frase: INVEX_CORRIGE, previos: [REVOLUT_PEDRO, INVEX_DIJO], verificar: (r) => no(((cerca(r.disponible("invex"), 37581.21) && !(r.usado("invex") ?? 0)) || r.pregunta()) && !cerca(r.limite("invex"), 30000) && cerca(r.saldo("revolut"), 19291) && SIN_EJEMPLOS(r) && r.nuevos().length === 0, { d: r.disponible("invex"), u: r.usado("invex"), l: r.limite("invex"), rev: r.saldo("revolut"), cuentas: r.despues.cuentas.map((c) => c.nombre), resp: r.respuesta }), nota: "otra conversación (resumen): corrige o pregunta, nunca inventa" },
  { grupo: "pedro", frase: INVEX_LIMITE, previos: [REVOLUT_PEDRO, INVEX_DIJO, INVEX_CORRIGE], verificar: (r) => no(cerca(r.limite("invex"), 57400) && cerca(r.disponible("invex"), 37581.21) && cerca(r.usado("invex"), 19818.79) && cerca(r.saldo("revolut"), 19291), { l: r.limite("invex"), d: r.disponible("invex"), u: r.usado("invex") }), nota: "límite − disponible = deuda, sin que lo diga" },
  { grupo: "pedro", separados: true, frase: INVEX_LIMITE, previos: [REVOLUT_PEDRO, "En mi tarjeta de crédito Invex tengo disponibles 37,581.21 pesos"], verificar: (r) => no(cerca(r.limite("invex"), 57400) && cerca(r.disponible("invex"), 37581.21) && cerca(r.usado("invex"), 19818.79), { l: r.limite("invex"), d: r.disponible("invex"), u: r.usado("invex") }), nota: "días después: el disponible ya guardado se conserva" },
  { grupo: "pedro", frase: INVEX_DISPONIBLE, previos: [REVOLUT_PEDRO, INVEX_DIJO, INVEX_CORRIGE, INVEX_LIMITE], verificar: (r) => no(cerca(r.limite("invex"), 57400) && cerca(r.disponible("invex"), 37581.12) && cerca(r.usado("invex"), 19818.88) && cerca(r.saldo("revolut"), 19291) && r.nuevos().length === 0, { l: r.limite("invex"), d: r.disponible("invex"), u: r.usado("invex") }), nota: "corrige el disponible y la deuda se recalcula" },
  { grupo: "pedro", frase: "Mi límite de crédito de Invex es de 57,400", previos: [REVOLUT_PEDRO, "Tengo 37,581.12 disponibles en mi tarjeta de crédito Invex"], verificar: (r) => no(cerca(r.limite("invex"), 57400) && cerca(r.disponible("invex"), 37581.12) && cerca(r.usado("invex"), 19818.88), { l: r.limite("invex"), d: r.disponible("invex"), u: r.usado("invex") }), nota: "lo que Pedro esperaba: debo 19,818.88" },
  // Nu: "tengo un crédito disponible de 33600 mxn" hizo otra cosa.
  { grupo: "pedro", frase: NU_PEDRO, previos: [REVOLUT_PEDRO], verificar: (r) => no(cerca(r.disponible("nu"), 33600) && !(r.usado("nu") ?? 0) && !cerca(r.saldo("nu") ?? 0, 33600) && cerca(r.saldo("revolut"), 19291) && r.nuevos().length === 0 && r.cuentasNuevas().every((c) => /nu/i.test(c.nombre)), { d: r.disponible("nu"), u: r.usado("nu"), s: r.saldo("nu"), nuevas: r.cuentasNuevas().map((c) => c.nombre), movs: r.nuevos().map((m) => m.tipo) }), nota: "crea la tarjeta Nu con 33,600 disponibles y nada más" },
  { grupo: "pedro", frase: "En mi tarjeta de crédito Nu tengo 33,600 pesos disponibles", previos: [REVOLUT_PEDRO, INVEX_DIJO], verificar: (r) => no(cerca(r.disponible("nu"), 33600) && cerca(r.disponible("invex"), 37581.21) && cerca(r.saldo("revolut"), 19291) && r.nuevos().length === 0, { nu: r.disponible("nu"), invex: r.disponible("invex"), rev: r.saldo("revolut") }), nota: "con Invex ya guardada no la toca" },
  { grupo: "pedro", frase: "En la Nu tengo 33,600 disponibles", previos: [REVOLUT_PEDRO, "Tengo una tarjeta de crédito Nu con límite de 40 mil"], verificar: (r) => no(cerca(r.disponible("nu"), 33600) && cerca(r.limite("nu"), 40000) && cerca(r.usado("nu"), 6400) && r.nuevos().length === 0, { d: r.disponible("nu"), l: r.limite("nu"), u: r.usado("nu") }), nota: "con límite conocido: debe 6,400" },
  { grupo: "pedro", frase: "En la Nu tengo 33,600 disponibles", previos: [REVOLUT_PEDRO, "Tengo una tarjeta de crédito Nu con límite de 30 mil"], verificar: (r) => no((r.pregunta() || cerca(r.limite("nu"), 33600) || (r.limite("nu") ?? 0) >= 33600) && !((r.usado("nu") ?? 0) < 0) && r.nuevos().length === 0, { d: r.disponible("nu"), l: r.limite("nu"), u: r.usado("nu"), resp: r.respuesta }), nota: "disponible mayor que el límite: no deja deuda negativa; pregunta o ajusta" },

  { grupo: "pedro", frase: NU_OIDA_NO, previos: [REVOLUT_PEDRO, INVEX_ESTADO], verificar: (r) => no(INVEX_INTACTA(r) && (r.pregunta() || cerca(r.disponible("nu"), 33600)) && r.nuevos().length === 0, { l: r.limite("invex"), u: r.usado("invex"), nu: r.existe("nu") ? r.disponible("nu") : "no existe", resp: r.respuesta }), nota: "dictado real: 'Nu' oída 'no'; no toca Invex, pregunta cuál" },
  { grupo: "pedro", frase: "Es la Nu", previos: [REVOLUT_PEDRO, INVEX_ESTADO, NU_OIDA_NO], verificar: (r) => no(INVEX_INTACTA(r) && cerca(r.disponible("nu"), 33600) && !(r.usado("nu") ?? 0) && r.nuevos().length === 0, { l: r.limite("invex"), u: r.usado("invex"), nu: r.disponible("nu"), resp: r.respuesta }), nota: "contesta cuál: crea la Nu con 33,600 disponibles" },
  // Con una sola tarjeta, "mi tarjeta de crédito ahora/solo/todavía…" es esa: no preguntar de más (QA-100).
  ...["En mi tarjeta de crédito ahora tengo 7 mil disponibles", "En mi tarjeta de crédito solo tengo 7 mil disponibles", "En mi tarjeta de crédito todavía tengo 7 mil disponibles"].map((frase): Caso => ({ grupo: "pedro", frase, previos: NU, verificar: (r) => no(cerca(r.disponible("nu"), 7000) && cerca(r.limite("nu"), 30000) && r.cuentasNuevas().length === 0, { d: r.disponible("nu"), nuevas: r.cuentasNuevas().map((c) => c.nombre), resp: r.respuesta }), nota: "una sola tarjeta: es esa, sin preguntar ni crear otra" })),
  // Revolut de crédito: no es la cuenta de débito (19,291 se queda).
  { grupo: "pedro", frase: REVOLUT_LIMITE, previos: [REVOLUT_PEDRO], verificar: (r) => { const t = r.cuentasCon("revolut", true); return no(t.length === 1 && cerca(r.de(t[0], "limite"), 34000) && DEBITO_REVOLUT_INTACTA(r), { tarjetas: t.map((c) => c.nombre), l: r.de(t[0], "limite"), cuentas: r.despues.cuentas.map((c) => `${c.nombre}:${c.tipo}`) }); }, nota: "crea la tarjeta Revolut aparte de la de débito" },
  { grupo: "pedro", frase: REVOLUT_DISPONIBLE, previos: [REVOLUT_PEDRO, REVOLUT_LIMITE, REVOLUT_LIMITE_2], verificar: (r) => { const t = r.cuentasCon("revolut", true); return no(t.length === 1 && cerca(r.de(t[0], "limite"), 34000) && cerca(r.de(t[0], "disponible"), 6701.05) && cerca(r.de(t[0], "usado"), 27298.95) && DEBITO_REVOLUT_INTACTA(r) && r.nuevos().length === 0, { tarjetas: t.map((c) => c.nombre), l: r.de(t[0], "limite"), d: r.de(t[0], "disponible"), u: r.de(t[0], "usado"), cuentas: r.despues.cuentas.map((c) => `${c.nombre}:${c.tipo}`) }); }, nota: "límite 34,000 y disponible 6,701.05: debe 27,298.95" },
  // Mercado Pago: el nombre sin "de crédito"; una frase cortada no guarda disponible = límite.
  { grupo: "pedro", frase: MP_LIMITE, previos: [REVOLUT_PEDRO], verificar: (r) => { const t = r.cuentasCon("mercado", true); return no(t.length === 1 && normalizar(t[0]!.nombre) === "mercado pago" && cerca(r.de(t[0], "limite"), 33200), { tarjetas: r.despues.cuentas.map((c) => `${c.nombre}:${c.tipo}`), l: r.de(t[0], "limite") }); }, nota: "se llama Mercado Pago" },
  { grupo: "pedro", frase: MP_CORTADA, previos: [REVOLUT_PEDRO, MP_LIMITE], verificar: (r) => { const t = r.cuentasCon("mercado", true); return no(t.length === 1 && cerca(r.de(t[0], "limite"), 33200) && !cerca(r.de(t[0], "disponible"), 33200) && !(r.de(t[0], "usado") ?? 0), { l: r.de(t[0], "limite"), d: r.de(t[0], "disponible"), u: r.de(t[0], "usado"), resp: r.respuesta }); }, nota: "frase cortada: no inventa el disponible (pregunta cuánto)" },
  { grupo: "pedro", frase: MP_DISPONIBLE, previos: [REVOLUT_PEDRO, MP_LIMITE, MP_CORTADA], verificar: (r) => { const t = r.cuentasCon("mercado", true); return no(t.length === 1 && cerca(r.de(t[0], "limite"), 33200) && cerca(r.de(t[0], "disponible"), 3607) && cerca(r.de(t[0], "usado"), 29593) && DEBITO_REVOLUT_INTACTA(r), { l: r.de(t[0], "limite"), d: r.de(t[0], "disponible"), u: r.de(t[0], "usado"), tarjetas: t.map((c) => c.nombre) }); }, nota: "disponible 3,607: debe 29,593" },
  { grupo: "pedro", separados: true, frase: MP_DISPONIBLE, previos: [REVOLUT_PEDRO, MP_LIMITE], verificar: (r) => { const t = r.cuentasCon("mercado", true); return no(t.length === 1 && cerca(r.de(t[0], "disponible"), 3607) && cerca(r.de(t[0], "usado"), 29593), { d: r.de(t[0], "disponible"), u: r.de(t[0], "usado"), tarjetas: t.map((c) => c.nombre) }); }, nota: "otro día: encuentra Mercado Pago y calcula la deuda" },
];

// ── Corredor ─────────────────────────────────────────────────────────────────────────────────
const [nombre, razonamiento] = values.modelo!.split("@") as [string, string | undefined];
const ia = { ...config.ia, razonamiento: razonamiento ?? config.ia.razonamiento };
await despertarModelo(ia, nombre);
let trazando = false;
let paso = 0;
let llamadas = 0;
const corto = (v: unknown) => JSON.stringify(v ?? null).replace(/\s+/g, " ").slice(0, 200);
const modelo = wrapLanguageModel({
  model: crearModelo(ia, nombre) as Parameters<typeof wrapLanguageModel>[0]["model"],
  middleware: {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const t0 = performance.now();
      const r = await doGenerate();
      if (trazando) {
        llamadas++;
        if (values.traza) {
          const hizo = r.content
            .map((c: any) => (c.type === "tool-call" ? `${c.toolName}(${corto(c.input)})` : c.type === "text" ? `texto ${corto(c.text)}` : c.type))
            .join(" + ");
          console.log(`           paso ${++paso}: ${Math.round(performance.now() - t0)} ms → ${hizo || "nada"}`);
        }
      }
      return r;
    },
  },
});

const casos = CASOS.filter((c) => (!values.grupo || c.grupo === values.grupo) && (!values.frase || c.frase.includes(values.frase)));
const veces = Math.max(1, Number(values.veces));
const porGrupo = new Map<string, { ok: number; mal: number; pendiente: number }>();
const tiempos: number[] = [];
for (let vuelta = 1; vuelta <= veces; vuelta++) {
  for (const caso of casos) {
    const db = abrirBaseDatos(":memory:");
    const u = crearUsuario(db, "QA");
    sembrarCategorias(db, u.id);
    const base = { db, usuarioId: u.id, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
    caso.preparar?.(crearContexto({ ...base, entradaId: "previa" }));
    const deps = { ...base, modelo, razonamientoDificil: values.dificil ?? (config.ia as { razonamientoDificil?: string }).razonamientoDificil };
    let estado: "ok" | "mal" | "pendiente";
    let detalle = "";
    let ms = 0;
    let respuesta = "";
    let herramientas: string[] = [];
    try {
      let conversacionId: string | undefined;
      for (const p of caso.previos ?? []) {
        const r = await hablar(deps, u.id, { texto: p, clientId: crypto.randomUUID(), conversacionId: caso.separados ? undefined : conversacionId });
        conversacionId = caso.separados ? undefined : r.conversacion_id;
      }
      const antes = await fotografiar(db, u.id, base);
      trazando = true;
      paso = 0;
      llamadas = 0;
      const t0 = performance.now();
      const r = await hablar(deps, u.id, { texto: caso.frase, clientId: crypto.randomUUID(), conversacionId }).finally(() => (trazando = false));
      ms = Math.round(performance.now() - t0);
      respuesta = r.respuesta;
      herramientas = r.acciones.map((a) => `${a.herramienta} ${JSON.stringify(a.argumentos)}`.slice(0, 300));
      const v = caso.verificar(new Revision(antes, await fotografiar(db, u.id, base), respuesta, herramientas));
      estado = v === true ? "ok" : "mal";
      detalle = v === true ? "" : String(v);
    } catch (e) {
      estado = e instanceof Pendiente ? "pendiente" : "mal";
      detalle = e instanceof Error ? e.message : String(e);
    }
    const g = porGrupo.get(caso.grupo) ?? { ok: 0, mal: 0, pendiente: 0 };
    g[estado]++;
    porGrupo.set(caso.grupo, g);
    if (estado !== "pendiente") tiempos.push(ms);
    const marca = { ok: "✓", mal: "✗", pendiente: "·" }[estado];
    console.log(`${marca} ${String(ms).padStart(6)} ms ${String(llamadas).padStart(1)}ll [${caso.grupo}] ${caso.frase}${caso.nota ? `  (${caso.nota})` : ""}`);
    if (estado !== "ok") console.log(`           ${detalle}\n           respuesta: ${respuesta}\n           herramientas: ${herramientas.join(" | ") || "ninguna"}`);
  }
}
tiempos.sort((a, b) => a - b);
const pct = (p: number) => ((tiempos[Math.min(tiempos.length - 1, Math.floor(tiempos.length * p))] ?? 0) / 1000).toFixed(1);
console.log(`\n${values.modelo} · ${casos.length} casos × ${veces}: mediana ${pct(0.5)} s, p90 ${pct(0.9)} s`);
for (const [grupo, g] of porGrupo) console.log(`  ${grupo.padEnd(15)} ✓ ${g.ok}  ✗ ${g.mal}  · ${g.pendiente}`);
