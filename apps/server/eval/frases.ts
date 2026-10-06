// 30 frases reales para elegir el modelo. Cada caso arranca con una base vacía,
// opcionalmente con datos previos, y revisa lo que quedó guardado o lo que respondió.
import type { Respuesta } from "../src/ai/asistente";
import type { Contexto } from "../src/finanzas/contexto";
import { buscarMovimientos, crearMovimiento } from "../src/finanzas/movimientos";
import { crearRecurrente, listarRecurrentes } from "../src/finanzas/recurrentes";
import { resolverFecha } from "../src/lib/fechas";

type Mov = ReturnType<typeof buscarMovimientos>["movimientos"][number];

export type Resultado = Respuesta & { movimientos: Mov[]; recurrentes: ReturnType<typeof listarRecurrentes>["recurrentes"]; ctx: Contexto };

export type Caso = {
  grupo: "registro" | "consulta" | "edicion" | "recurrentes";
  frase: string;
  preparar?: (ctx: Contexto) => void;
  /** Devuelve true si pasó, o el motivo del fallo. */
  verificar: (r: Resultado) => true | string;
};

const enCategoria = (m: Mov | undefined, nombre: string) => !!m?.categoria?.split(" > ").includes(nombre);
const unoSolo = (r: Resultado) => (r.movimientos.length === 1 ? r.movimientos[0]! : undefined);
const dice = (r: Resultado, ...textos: string[]) => {
  const plano = r.respuesta.replace(/[,\s]/g, "");
  return textos.every((t) => plano.includes(t.replace(/[,\s]/g, "")));
};
const motivo = (ok: boolean, detalle: unknown) => (ok ? true : JSON.stringify(detalle));

// Datos previos que usan varias consultas. "previa" simula una entrada anterior.
const previa = (ctx: Contexto) => ({ ...ctx, entradaId: "previa", textoOriginal: undefined });
const gastosDeEjemplo = (ctx: Contexto) => {
  const c = previa(ctx);
  crearMovimiento(c, { tipo: "gasto", monto: 60, categoria: "Café", comercio: "Starbucks", fecha: "ayer" });
  crearMovimiento(c, { tipo: "gasto", monto: 45, categoria: "Café", comercio: "Oxxo", fecha: "ayer" });
  crearMovimiento(c, { tipo: "gasto", monto: 30, categoria: "Café", comercio: "Cielito" });
  crearMovimiento(c, { tipo: "gasto", monto: 1850, categoria: "Súper", comercio: "Walmart" });
  crearMovimiento(c, { tipo: "gasto", monto: 230, categoria: "Taxi y apps", comercio: "Uber", fecha: "ayer" });
  crearMovimiento(c, { tipo: "ingreso", monto: 12000, categoria: "Sueldo" });
};

export const CASOS: Caso[] = [
  // Registro
  {
    grupo: "registro",
    frase: "Gasté 85 pesos en un café",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$85" && m.tipo === "gasto" && enCategoria(m, "Café"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Me pagaron la quincena, 12 mil",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$12,000" && m.tipo === "ingreso" && enCategoria(m, "Sueldo"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Acabo de pagar 500 con la BBVA en el súper",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$500" && enCategoria(m, "Súper") && m.cuenta === "BBVA", r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Café 60 y gasolina 800",
    verificar: (r) => {
      const cafe = r.movimientos.find((m) => m.monto === "$60");
      const gas = r.movimientos.find((m) => m.monto === "$800");
      return motivo(r.movimientos.length === 2 && enCategoria(cafe, "Café") && enCategoria(gas, "Gasolina"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Ayer gasté 230 en Uber",
    verificar: (r) => {
      const m = unoSolo(r);
      const ayer = resolverFecha("ayer", r.ctx.hoy);
      return motivo(m?.monto === "$230" && m.fecha === ayer && enCategoria(m, "Taxi y apps"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Compré unos tenis de 1,899 en Liverpool",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$1,899" && m.comercio === "Liverpool" && enCategoria(m, "Ropa y calzado"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Pedí comida por Rappi, 345",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$345" && enCategoria(m, "Delivery"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Le pagué la renta al casero, 9500",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$9,500" && enCategoria(m, "Renta"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Netflix me cobró 219",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$219" && enCategoria(m, "Suscripciones"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Dos mil quinientos de luz",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$2,500" && enCategoria(m, "Luz"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "En el Oxxo gasté 47.50",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$47.50" && m.comercio?.toLowerCase() === "oxxo", r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Me transfirieron 1,500 de un trabajo freelance",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$1,500" && m.tipo === "ingreso" && enCategoria(m, "Freelance"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Pagué 20 dólares de una app",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "20 USD", r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "El viernes fui al cine y gasté 320",
    verificar: (r) => {
      const m = unoSolo(r);
      const viernes = resolverFecha("viernes", r.ctx.hoy);
      return motivo(m?.monto === "$320" && m.fecha === viernes && enCategoria(m, "Cine"), r.movimientos);
    },
  },
  {
    grupo: "registro",
    frase: "Pagué 150 de estacionamiento en efectivo",
    verificar: (r) => {
      const m = unoSolo(r);
      return motivo(m?.monto === "$150" && m.cuenta === "Efectivo" && enCategoria(m, "Estacionamiento"), r.movimientos);
    },
  },

  // Consultas: la respuesta debe traer la cifra correcta.
  {
    grupo: "consulta",
    frase: "¿Cuánto gasté ayer en café?",
    preparar: gastosDeEjemplo,
    verificar: (r) => motivo(dice(r, "105"), r.respuesta),
  },
  {
    grupo: "consulta",
    frase: "¿Cuánto llevo gastado este mes?",
    preparar: gastosDeEjemplo,
    verificar: (r) => {
      // Si "ayer" cae en el mes anterior, el total del mes cambia.
      const mismoMes = resolverFecha("ayer", r.ctx.hoy)!.slice(0, 7) === r.ctx.hoy.slice(0, 7);
      return motivo(dice(r, mismoMes ? "2,215" : "1,880"), r.respuesta);
    },
  },
  {
    grupo: "consulta",
    frase: "¿En qué categoría gasté más este mes?",
    preparar: gastosDeEjemplo,
    verificar: (r) => motivo(/comida|s[uú]per/i.test(r.respuesta), r.respuesta),
  },
  {
    grupo: "consulta",
    frase: "¿Cuánto me han pagado este mes?",
    preparar: gastosDeEjemplo,
    verificar: (r) => motivo(dice(r, "12,000"), r.respuesta),
  },
  {
    grupo: "consulta",
    frase: "¿Cuáles fueron mis últimos tres gastos?",
    preparar: gastosDeEjemplo,
    verificar: (r) => motivo(dice(r, "30") && dice(r, "1,850"), r.respuesta),
  },

  // Edición, borrado y deshacer
  {
    grupo: "edicion",
    frase: "El café de hoy fueron 95, no 85",
    preparar: (ctx) => {
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 85, categoria: "Café" });
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 800, categoria: "Gasolina" });
    },
    verificar: (r) => {
      const cafe = r.movimientos.filter((m) => enCategoria(m, "Café"));
      return motivo(cafe.length === 1 && cafe[0]?.monto === "$95" && r.movimientos.length === 2, r.movimientos);
    },
  },
  {
    grupo: "edicion",
    frase: "Borra el último gasto",
    preparar: (ctx) => {
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 800, categoria: "Gasolina", fecha: "ayer" });
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 85, categoria: "Café" });
    },
    verificar: (r) => motivo(r.movimientos.length === 1 && r.movimientos[0]?.monto === "$800", r.movimientos),
  },
  {
    grupo: "edicion",
    frase: "Cambia lo de Liverpool a la categoría Regalos",
    preparar: (ctx) => {
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 1899, categoria: "Ropa y calzado", comercio: "Liverpool" });
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 85, categoria: "Café" });
    },
    verificar: (r) => {
      const m = r.movimientos.find((x) => x.comercio === "Liverpool");
      return motivo(enCategoria(m, "Regalos") && r.movimientos.length === 2, r.movimientos);
    },
  },
  {
    grupo: "edicion",
    frase: "Deshaz eso",
    preparar: (ctx) => {
      crearMovimiento({ ...ctx, entradaId: "antigua" }, { tipo: "gasto", monto: 500, categoria: "Súper", fecha: "ayer" });
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 85, categoria: "Café" });
    },
    verificar: (r) => motivo(r.movimientos.length === 1 && r.movimientos[0]?.monto === "$500", r.movimientos),
  },
  {
    grupo: "edicion",
    frase: "El Uber de ayer lo pagué con la Nu",
    preparar: gastosDeEjemplo,
    verificar: (r) => {
      const m = r.movimientos.find((x) => x.comercio === "Uber");
      return motivo(m?.cuenta === "Nu" && r.movimientos.length === 6, r.movimientos);
    },
  },
  {
    grupo: "edicion",
    frase: "Elimina el gasto de gasolina de 800",
    preparar: (ctx) => {
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 800, categoria: "Gasolina", fecha: "ayer" });
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 600, categoria: "Gasolina", fecha: "antier" });
      crearMovimiento(previa(ctx), { tipo: "gasto", monto: 85, categoria: "Café" });
    },
    verificar: (r) =>
      motivo(r.movimientos.length === 2 && !r.movimientos.some((m) => m.monto === "$800"), r.movimientos),
  },

  // Recurrentes
  {
    grupo: "recurrentes",
    frase: "Recuerda que cada día 15 me cobran 199 de Spotify",
    verificar: (r) => {
      const s = r.recurrentes[0];
      return motivo(
        r.recurrentes.length === 1 && s?.monto === "$199" && s.frecuencia === "mensual" && s.proximo_cobro.endsWith("-15"),
        r.recurrentes,
      );
    },
  },
  {
    grupo: "recurrentes",
    frase: "Pago 9,500 de renta cada primero de mes",
    verificar: (r) => {
      const s = r.recurrentes[0];
      return motivo(
        r.recurrentes.length === 1 && s?.monto === "$9,500" && s.tipo === "renta" && s.proximo_cobro.endsWith("-01"),
        r.recurrentes,
      );
    },
  },
  {
    grupo: "recurrentes",
    frase: "¿Qué suscripciones me cobran en los próximos 10 días?",
    preparar: (ctx) => {
      const c = previa(ctx);
      const dia = (n: number) => Number(resolverFecha(undefined, ctx.hoy)!.slice(8)) + n;
      // Una vence pronto y otra no; si el mes se acaba, se ajusta al día válido.
      crearRecurrente(c, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: Math.min(dia(3), 28) });
      crearRecurrente(c, { nombre: "Gimnasio", tipo: "suscripcion", monto: 650, frecuencia: "mensual", dia: Math.max(dia(-5), 1) });
    },
    verificar: (r) => {
      const esperadas = listarRecurrentes(r.ctx, { dias: 10 }).recurrentes.map((x) => x.nombre);
      const ok = esperadas.every((n) => r.respuesta.includes(n)) &&
        ["Netflix", "Gimnasio"].filter((n) => !esperadas.includes(n)).every((n) => !r.respuesta.includes(n));
      return motivo(ok, { esperadas, respuesta: r.respuesta });
    },
  },
  {
    grupo: "recurrentes",
    frase: "¿Cuánto pago al mes de suscripciones?",
    preparar: (ctx) => {
      const c = previa(ctx);
      crearRecurrente(c, { nombre: "Netflix", tipo: "suscripcion", monto: 219, frecuencia: "mensual", dia: 5 });
      crearRecurrente(c, { nombre: "Spotify", tipo: "suscripcion", monto: 199, frecuencia: "mensual", dia: 15 });
      crearRecurrente(c, { nombre: "iCloud", tipo: "suscripcion", monto: 49, frecuencia: "mensual", dia: 20 });
    },
    verificar: (r) => motivo(dice(r, "467"), r.respuesta),
  },
];
