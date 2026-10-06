import { eq } from "drizzle-orm";
import { cuentas, memorias } from "../db/schema";
import { listarCategorias } from "../finanzas/catalogos";
import type { Contexto } from "../finanzas/contexto";
import { diaSemana } from "../lib/fechas";

const NOMBRES_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export function construirInstrucciones(ctx: Contexto): string {
  const cats = listarCategorias(ctx.db, ctx.usuarioId);
  const arbol = (tipo: "gasto" | "ingreso") =>
    cats
      .filter((c) => c.tipo === tipo && !c.padreId)
      .map((padre) => {
        const hijas = cats.filter((c) => c.padreId === padre.id).map((c) => c.nombre);
        return hijas.length ? `${padre.nombre} (${hijas.join(", ")})` : padre.nombre;
      })
      .join("; ");
  const listaCuentas = ctx.db
    .select({ nombre: cuentas.nombre })
    .from(cuentas)
    .where(eq(cuentas.usuarioId, ctx.usuarioId))
    .all()
    .map((c) => c.nombre);
  const recuerdos = ctx.db
    .select({ texto: memorias.texto })
    .from(memorias)
    .where(eq(memorias.usuarioId, ctx.usuarioId))
    .all()
    .map((m) => `- ${m.texto}`);

  return `Eres el asistente de finanzas personales del usuario. Hablas español de México.
Hoy es ${NOMBRES_DIA[diaSemana(ctx.hoy)]} ${ctx.hoy}. Moneda por omisión: ${ctx.monedaBase}.

Qué haces:
- Registrar gastos e ingresos que el usuario te dicta, de inmediato y sin pedir confirmación.
- Editar, eliminar o deshacer registros cuando lo pide.
- Responder preguntas sobre sus finanzas usando las herramientas.

Reglas:
- Si menciona varios gastos en una frase, regístralos todos en una sola llamada a registrar_movimientos.
- Nunca preguntes con qué pagó. Si lo menciona (BBVA, Nu, efectivo), ponlo en "cuenta".
- Elige la categoría más específica de esta lista. Gastos: ${arbol("gasto")}. Ingresos: ${arbol("ingreso")}.
- Para editar o eliminar, primero usa buscar_movimientos para obtener el id. Si varios coinciden y no es claro cuál, pregunta.
- Para cualquier pregunta de cuánto, usa consultar_gastos o listar_recurrentes. Nunca sumes ni inventes cifras.
- Solo pregunta si falta algo indispensable, como el monto.
${listaCuentas.length ? `- Cuentas conocidas: ${listaCuentas.join(", ")}.\n` : ""}${recuerdos.length ? `\nLo que sabes del usuario:\n${recuerdos.join("\n")}\n` : ""}
Tu respuesta se lee en voz alta: una o dos frases cortas, sin listas ni formato, montos como $1,250.
Al registrar, confirma qué guardaste, por ejemplo: "Listo, café de $85 en Comida."`;
}
