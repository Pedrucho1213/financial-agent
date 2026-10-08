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

type Caso = {
  grupo: string;
  frase: string;
  /** Frases dictadas antes, en la misma conversación (arman el estado por voz). */
  previos?: string[];
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
  { grupo: "saldos", frase: "Tengo como 20 en Revolut", verificar: (r) => no(r.pregunta() || cerca(r.saldo("revolut"), 20) || cerca(r.saldo("revolut"), 20000), { s: r.saldo("revolut"), resp: r.respuesta }), nota: "ambiguo: 20 o 20 mil" },
  { grupo: "saldos", frase: "Tengo 20k en revo lut", verificar: (r) => no(cerca(r.saldo("revolut"), 20000), { s: r.saldo("revolut"), cuentas: r.despues.cuentas.map((c) => c.nombre) }), nota: "dictado con espacio y 'k'" },
  { grupo: "saldos", frase: "Mi cuenta de ahorro en Nu tiene 45 mil y la de débito 3 mil", verificar: (r) => no(r.despues.cuentas.length >= 2, r.despues.cuentas.map((c) => c.nombre)) },

  // ── Tarjetas de crédito: límite, usado y disponible ─────────────────────────────────────────
  { grupo: "credito", frase: NU[0]!, verificar: (r) => no(cerca(r.limite("nu"), 30000) && cerca(r.usado("nu"), 12000) && cerca(r.disponible("nu"), 18000), { l: r.limite("nu"), u: r.usado("nu"), d: r.disponible("nu") }) },
  { grupo: "credito", frase: "Oye, te recuerdo que tengo 7000 pesos disponibles en mi tarjeta de crédito", previos: NU, verificar: (r) => no(cerca(r.disponible("nu"), 7000) && cerca(r.limite("nu"), 30000), { d: r.disponible("nu"), l: r.limite("nu") }), nota: "una sola tarjeta: es esa" },
  { grupo: "credito", frase: "Tengo 7000 disponibles en mi tarjeta de crédito", previos: [...NU, "Mi BBVA Azul tiene límite de 20 mil"], verificar: (r) => no(r.pregunta(), r.respuesta), nota: "dos tarjetas: pregunta cuál" },
  { grupo: "credito", frase: "Tengo un límite de 50 mil en la Amex", verificar: (r) => no(cerca(r.limite("amex"), 50000), r.limite("amex")) },
  { grupo: "credito", frase: "Tengo ocupado 8 mil de la BBVA Azul", previos: ["Mi BBVA Azul tiene límite de 20 mil"], verificar: (r) => no(cerca(r.usado("azul"), 8000) && cerca(r.disponible("azul"), 12000), { u: r.usado("azul"), d: r.disponible("azul") }) },
  { grupo: "credito", frase: "Gasté 1,500 en el súper con la Nu", previos: NU, verificar: (r) => no(cerca(r.usado("nu"), 13500) && cerca(r.disponible("nu"), 16500) && r.nuevos("gasto").length === 1, { u: r.usado("nu"), d: r.disponible("nu") }) },
  { grupo: "credito", frase: "Gasté 20 mil en un vuelo con la Nu", previos: NU, verificar: (r) => no(r.pregunta() || r.dice("disponible") || r.dice("limite"), r.respuesta), nota: "excede el disponible (18 mil): avisar, no callar" },

  // ── Gastos que mueven saldo ────────────────────────────────────────────────────────────────
  { grupo: "gastos", frase: "Gasté 300 en tacos con Revolut", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("revolut"), 19700) && cerca(r.saldo("bancomer"), 10000), { rev: r.saldo("revolut"), ban: r.saldo("bancomer") }) },
  { grupo: "gastos", frase: "Pagué 250 de Uber con la tarjeta de Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 9750), r.saldo("bancomer")) },
  { grupo: "gastos", frase: "Gasté 120 en tacos", previos: DOS_CUENTAS, verificar: (r) => no(r.nuevos("gasto").length === 1 && !/-\s?\$|menos \d|negativ/i.test(r.respuesta), { movs: r.nuevos().length, resp: r.respuesta }), nota: "sin método: no inventar uno ni dejar saldos raros" },
  { grupo: "gastos", frase: "Gasté 300 en efectivo en la tiendita", previos: ["Traigo 100 pesos en efectivo"], verificar: (r) => no(r.pregunta() || r.dice("100") || r.dice("negativ"), { s: r.saldo("efectivo"), resp: r.respuesta }), nota: "gasta más de lo que hay: avisar, no quedar en -200 en silencio" },
  { grupo: "gastos", frase: "Gasté 300 en tacos", verificar: (r) => no(r.nuevos("gasto").length === 1 && !/-\s?\$|menos \d|negativ/i.test(r.respuesta), r.respuesta), nota: "sin saldos conocidos no debe hablar de saldo negativo" },
  { grupo: "gastos", frase: "Uber 89 con Revolut, Didi 120 con Bancomer y un Rappi de 250 con Revolut", previos: DOS_CUENTAS, verificar: (r) => no(r.nuevos("gasto").length === 3 && cerca(r.saldo("revolut"), 20000 - 339) && cerca(r.saldo("bancomer"), 9880), { rev: r.saldo("revolut"), ban: r.saldo("bancomer"), n: r.nuevos().length }) },

  // ── Transferencias entre cuentas propias (no son gasto) ─────────────────────────────────────
  { grupo: "transferencias", frase: "Acabo de transferir 5 mil de Bancomer a Revolut", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 5000) && cerca(r.saldo("revolut"), 25000) && r.nuevos("gasto").length === 0 && r.gastoDelMes() === r.gastoDelMes(r.antes), { ban: r.saldo("bancomer"), rev: r.saldo("revolut"), gastos: r.nuevos("gasto").length }) },
  { grupo: "transferencias", frase: "Me pasé 2 mil de Revolut a Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("revolut"), 18000) && cerca(r.saldo("bancomer"), 12000), { rev: r.saldo("revolut"), ban: r.saldo("bancomer") }) },
  { grupo: "transferencias", frase: "Transferí 5 mil a Revolut", previos: DOS_CUENTAS, verificar: (r) => no(r.pregunta() || cerca(r.saldo("bancomer"), 5000), { resp: r.respuesta, ban: r.saldo("bancomer") }), nota: "sin origen: pregunta de dónde (o usa la única otra cuenta)" },
  { grupo: "transferencias", frase: "Le transferí 500 a Juan", previos: DOS_CUENTAS, verificar: (r) => no(!r.existe("juan"), { cuentas: r.cuentasNuevas().map((c) => c.nombre), movs: r.nuevos().map((m) => m.tipo) }), nota: "Juan no es cuenta propia: no crear cuenta 'Juan'" },
  { grupo: "transferencias", frase: "Pasé mil del efectivo a Bancomer", previos: [...DOS_CUENTAS, "Traigo 3 mil en efectivo"], verificar: (r) => no(cerca(r.saldo("efectivo"), 2000) && cerca(r.saldo("bancomer"), 11000) && r.nuevos("gasto").length === 0, { ef: r.saldo("efectivo"), ban: r.saldo("bancomer") }) },
  { grupo: "transferencias", frase: "Saqué 500 del cajero de Bancomer", previos: DOS_CUENTAS, verificar: (r) => no(cerca(r.saldo("bancomer"), 9500) && r.nuevos("gasto").length === 0, { ban: r.saldo("bancomer"), movs: r.nuevos().map((m) => m.tipo) }), nota: "retiro = transferencia a efectivo" },
  { grupo: "transferencias", frase: "Transferí 50 mil de Bancomer a Revolut", previos: DOS_CUENTAS, verificar: (r) => no(r.pregunta() || r.dice("10000") || r.dice("saldo"), r.respuesta), nota: "más de lo que hay (10 mil): avisar" },

  // ── Pagos y abonos a tarjeta (no son gasto) ─────────────────────────────────────────────────
  { grupo: "pagos_tarjeta", frase: "Te aviso que acabo de pagar 3 mil a la Nu desde Bancomer", previos: CUENTAS_Y_NU, verificar: (r) => no(cerca(r.saldo("bancomer"), 7000) && cerca(r.usado("nu"), 9000) && cerca(r.disponible("nu"), 21000) && r.nuevos("gasto").length === 0, { ban: r.saldo("bancomer"), u: r.usado("nu"), d: r.disponible("nu") }) },
  { grupo: "pagos_tarjeta", frase: "Abono de 1500 a la Nu", previos: CUENTAS_Y_NU, verificar: (r) => no((cerca(r.usado("nu"), 10500) && r.nuevos("gasto").length === 0) || r.pregunta(), { u: r.usado("nu"), resp: r.respuesta }), nota: "sin origen: pregunta o usa la cuenta de siempre" },
  { grupo: "pagos_tarjeta", frase: "Pagué la tarjeta", previos: CUENTAS_Y_NU, verificar: (r) => no(r.pregunta() && r.nuevos().length === 0, r.respuesta), nota: "sin monto: pregunta cuánto" },
  { grupo: "pagos_tarjeta", frase: "Pagué el total de la Nu con Revolut", previos: CUENTAS_Y_NU, verificar: (r) => no((cerca(r.usado("nu"), 0) && cerca(r.saldo("revolut"), 8000)) || r.pregunta(), { u: r.usado("nu"), rev: r.saldo("revolut") }) },
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
  { grupo: "ingresos", frase: "Me llegó la quincena", previos: DOS_CUENTAS, verificar: (r) => no(r.pregunta() && r.nuevos().length === 0, r.respuesta) },

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
    const deps = { ...base, modelo };
    let estado: "ok" | "mal" | "pendiente";
    let detalle = "";
    let ms = 0;
    let respuesta = "";
    let herramientas: string[] = [];
    try {
      let conversacionId: string | undefined;
      for (const p of caso.previos ?? []) conversacionId = (await hablar(deps, u.id, { texto: p, clientId: crypto.randomUUID(), conversacionId })).conversacion_id;
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
