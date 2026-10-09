import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { hablar } from "../src/ai/asistente";
import { olvidar, recordar } from "../src/finanzas/memorias";
import { AHORA, llamada, preparar, texto } from "./ayuda";

type Parte = { type: string; text?: string };
type Mensaje = { role: string; content: string | Parte[] };
const contenido = (m: Mensaje) => (typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join(""));

// Ollama reutiliza lo ya procesado mientras la petición empiece igual. En una conversación, el turno
// siguiente debe empezar con lo mismo que el anterior: instrucciones, herramientas, datos y lo dicho.
describe("conversación que reutiliza lo ya procesado", () => {
  function montar(respuestas: unknown[]) {
    const { db, usuario, ctx } = preparar();
    recordar(ctx, "Paga el Oxxo en efectivo");
    const modelo = new MockLanguageModelV4({ doGenerate: respuestas as never });
    const deps = { db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" };
    const decir = (frase: string, conversacionId?: string) =>
      hablar(deps, usuario.id, { texto: frase, clientId: crypto.randomUUID(), conversacionId, capturadoEn: AHORA.toISOString() });
    const prompt = (n: number) => modelo.doGenerateCalls[n]!.prompt as Mensaje[];
    return { ctx, decir, prompt };
  }

  test("el segundo turno empieza igual que el primero y no repite los datos si no cambiaron", async () => {
    const { decir, prompt } = montar([texto("¿De cuánto fue?"), llamada("registrar_movimientos", { movimientos: [{ tipo: "gasto", monto: 85, comercio: "Oxxo" }] })]);
    const primera = await decir("Compré algo en el Oxxo");
    await decir("85", primera.conversacion_id);
    const [uno, dos] = [prompt(0), prompt(1)];
    // Todo lo del primer turno es el inicio del segundo.
    expect(dos.slice(0, uno.length)).toEqual(uno);
    const datos = dos.filter((m) => m.role === "system" && contenido(m).includes("Paga el Oxxo en efectivo"));
    expect(datos).toHaveLength(1);
    expect(contenido(dos.at(-1)!)).toBe("85");
  });

  test("si los datos cambian a media conversación, solo van los nuevos, antes del dictado nuevo", async () => {
    const { ctx, decir, prompt } = montar([texto("¿De cuánto fue?"), texto("¿Algo más?"), texto("Va.")]);
    const primera = await decir("Compré algo en el Oxxo");
    recordar(ctx, "Su quincena llega los días 15 y 30");
    await decir("Nada, olvídalo", primera.conversacion_id);
    const sistemas = (n: number) => prompt(n).filter((m) => m.role === "system").map(contenido).slice(1);
    // Los datos viejos (sin la quincena) ya no van: solo los vigentes, justo antes del dictado.
    expect(sistemas(1)).toHaveLength(1);
    expect(sistemas(1)[0]).toContain("Su quincena llega los días 15 y 30");
    expect(prompt(1).at(-2)?.role).toBe("system");
    // El tercer turno, sin cambios, empieza igual que el segundo.
    await decir("Gracias", primera.conversacion_id);
    expect(prompt(2).slice(0, prompt(1).length)).toEqual(prompt(1));
    expect(sistemas(2)).toHaveLength(1);
  });

  test("lo olvidado ya no llega al modelo en el turno siguiente", async () => {
    const { ctx, decir, prompt } = montar([texto("¿De cuánto fue?"), texto("Listo.")]);
    const primera = await decir("Compré algo en el Oxxo");
    olvidar(ctx, "Oxxo");
    await decir("Olvídalo", primera.conversacion_id);
    expect(JSON.stringify(prompt(0))).toContain("Paga el Oxxo en efectivo");
    expect(JSON.stringify(prompt(1))).not.toContain("Paga el Oxxo en efectivo");
  });
});
