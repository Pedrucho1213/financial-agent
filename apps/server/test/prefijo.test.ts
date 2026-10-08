import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { hablar } from "../src/ai/asistente";
import { recordar } from "../src/finanzas/memorias";
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

  test("si los datos cambian a media conversación, los nuevos van antes del dictado nuevo", async () => {
    const { ctx, decir, prompt } = montar([texto("¿De cuánto fue?"), texto("¿Algo más?")]);
    const primera = await decir("Compré algo en el Oxxo");
    recordar(ctx, "Su quincena llega los días 15 y 30");
    await decir("Nada, olvídalo", primera.conversacion_id);
    const dos = prompt(1);
    expect(dos.slice(0, prompt(0).length)).toEqual(prompt(0));
    const sistemas = dos.filter((m) => m.role === "system").map(contenido);
    expect(sistemas.at(-1)).toContain("Su quincena llega los días 15 y 30");
    expect(dos.at(-2)?.role).toBe("system");
  });
});
