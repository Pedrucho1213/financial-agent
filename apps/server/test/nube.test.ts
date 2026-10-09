import { afterEach, describe, expect, test } from "bun:test";
import { generateText } from "ai";
import { crearModelo, estadoModelo, modeloLocal, promptParaClaude } from "../src/ai/modelo";
import { INSTRUCCIONES_CLAUDE } from "../src/ai/instrucciones";
import { type Config, modelosIa } from "../src/config";

const ia: Config["ia"] = {
  url: "http://127.0.0.1:11434/v1",
  modelo: "claude-haiku-5-5",
  apiKey: "ollama",
  claveNube: "clave-de-prueba",
  modeloDificil: "claude-sonnet-5-5",
  respaldo: "gemma4:12b-it-qat",
  ollamaUrl: "http://127.0.0.1:11434",
  mantenerCargado: "5m",
  razonamiento: "none",
  razonamientoDificil: "low",
  paralelo: 1,
  interruptor: true,
};

type Pedido = { url: string; cuerpo: Record<string, unknown> };
const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Contesta como Anthropic (o falla con `fallaNube`) y como Ollama, y guarda lo que se pidió. */
function simular(fallaNube?: number): Pedido[] {
  const pedidos: Pedido[] = [];
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    const cuerpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    pedidos.push({ url, cuerpo });
    if (url.includes("anthropic.com")) {
      if (fallaNube) return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "x" } }), { status: fallaNube });
      return Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: cuerpo.model,
        content: [{ type: "text", text: "nube" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 2 },
      });
    }
    return Response.json({
      id: "c1",
      object: "chat.completion",
      created: 0,
      model: cuerpo.model,
      choices: [{ index: 0, message: { role: "assistant", content: "local" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }) as typeof fetch;
  return pedidos;
}

describe("Claude como IA", () => {
  test("un dictado normal va a Haiku sin razonar, sin temperatura y con caché", async () => {
    const pedidos = simular();
    const r = await generateText({ model: crearModelo(ia), prompt: "gasté 200 en el súper", temperature: 0.2, maxRetries: 0 });
    expect(r.text).toBe("nube");
    expect(pedidos).toHaveLength(1);
    const { cuerpo } = pedidos[0]!;
    expect(cuerpo.model).toBe("claude-haiku-5-5");
    expect(cuerpo.thinking).toEqual({ type: "disabled" });
    expect(cuerpo.temperature).toBeUndefined();
    expect(cuerpo.cache_control).toEqual({ type: "ephemeral" });
  });

  test("lo que asistente.ts manda a razonar va a Sonnet con esfuerzo bajo", async () => {
    const pedidos = simular();
    await generateText({
      model: crearModelo(ia),
      prompt: "en Revolut crédito tengo 5 mil disponibles",
      providerOptions: { local: { reasoningEffort: "low" } },
      maxRetries: 0,
    });
    const { cuerpo } = pedidos[0]!;
    expect(cuerpo.model).toBe("claude-sonnet-5-5");
    expect(cuerpo.thinking).toEqual({ type: "adaptive" });
    expect((cuerpo.output_config as { effort?: string } | undefined)?.effort).toBe("low");
  });

  test("un dictado difícil va a Sonnet desde el primer paso, con espacio para pensar", async () => {
    const pedidos = simular();
    await generateText({
      model: crearModelo(ia),
      prompt: "en la Nu tengo 33,600 disponibles",
      providerOptions: { nube: { dificil: true } },
      maxOutputTokens: 600,
      maxRetries: 0,
    });
    const { cuerpo } = pedidos[0]!;
    expect(cuerpo.model).toBe("claude-sonnet-5-5");
    expect(cuerpo.thinking).toEqual({ type: "adaptive" });
    expect(cuerpo.max_tokens).toBe(4000);
  });

  test("si la nube falla, contesta el modelo de la Mac", async () => {
    const pedidos = simular(529);
    const r = await generateText({ model: crearModelo(ia), prompt: "gasté 200 en el súper", maxRetries: 0 });
    expect(r.text).toBe("local");
    expect(pedidos.map((p) => p.url.includes("anthropic.com"))).toEqual([true, false]);
    expect(pedidos[1]!.cuerpo.model).toBe("gemma4:12b-it-qat");
  });

  test("sin respaldo, el error llega como antes", async () => {
    simular(529);
    const sinRespaldo = { ...ia, respaldo: "no" };
    await expect(generateText({ model: crearModelo(sinRespaldo), prompt: "hola", maxRetries: 0 })).rejects.toThrow();
  });

  test("con Claude, el modelo de Ollama que se controla es el respaldo", () => {
    expect(modeloLocal(ia)).toBe("gemma4:12b-it-qat");
    expect(modeloLocal({ ...ia, respaldo: "no" })).toBeUndefined();
    expect(modeloLocal({ ...ia, modelo: "gemma4:12b-it-qat" })).toBe("gemma4:12b-it-qat");
  });

  test("Ajustes dice si Claude contesta sin cargar nada", async () => {
    const pedidos = simular();
    const estado = await estadoModelo(ia);
    expect(estado).toEqual({ modelo: "claude-haiku-5-5", disponible: true, cargada: true });
    expect(pedidos[0]!.url).toBe("https://api.anthropic.com/v1/models/claude-haiku-5-5");
  });
});

describe("promptParaClaude", () => {
  test("los datos y el resumen a media conversación pasan como texto del usuario", () => {
    const prompt = promptParaClaude([
      { role: "system", content: "instrucciones" },
      { role: "system", content: "datos viejos" },
      { role: "user", content: [{ type: "text", text: "gasté 100" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "pienso" },
          { type: "text", text: "Listo" },
        ],
      },
      { role: "system", content: "datos nuevos" },
      { role: "system", content: "resumen" },
      { role: "user", content: [{ type: "text", text: "no, fueron 120" }] },
    ]);
    expect(prompt.map((m) => m.role)).toEqual(["system", "system", "user", "assistant", "user", "user", "user"]);
    expect(prompt[4]).toEqual({ role: "user", content: [{ type: "text", text: "<sistema>\ndatos nuevos\n</sistema>" }] });
    // Lo propio de Claude va pegado a las instrucciones, no a los datos.
    expect(prompt[0]).toEqual({ role: "system", content: `instrucciones\n\n${INSTRUCCIONES_CLAUDE}` });
    expect(prompt[1]).toEqual({ role: "system", content: "datos viejos" });
    // Lo que razonó en un turno anterior no se reenvía.
    expect(prompt[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "Listo" }] });
  });

  test("una conversación que empieza con la IA empieza con el usuario", () => {
    const prompt = promptParaClaude([
      { role: "system", content: "instrucciones" },
      { role: "assistant", content: [{ type: "text", text: "¿Con qué tarjeta fue?" }] },
      { role: "user", content: [{ type: "text", text: "con la Nu" }] },
    ]);
    expect(prompt.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  test("los ids de herramientas que dio Ollama se vuelven válidos para Claude", () => {
    const prompt = promptParaClaude([
      { role: "user", content: [{ type: "text", text: "gasté 100" }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "call:1.a", toolName: "registrar", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call:1.a", toolName: "registrar", output: { type: "json", value: {} } }] },
      { role: "user", content: [{ type: "text", text: "gracias" }] },
    ]);
    expect((prompt[1]!.content as { toolCallId: string }[])[0]!.toolCallId).toBe("call_1_a");
    expect((prompt[2]!.content as { toolCallId: string }[])[0]!.toolCallId).toBe("call_1_a");
  });
});

describe("modelosIa", () => {
  test("sin clave, todo sigue con el modelo de Ollama", () => {
    expect(modelosIa({ IA_MODELO: "gemma4:12b-it-qat" })).toMatchObject({ modelo: "gemma4:12b-it-qat", claveNube: undefined });
  });

  test("con la clave en el .env, contesta Claude y gemma queda de respaldo", () => {
    expect(modelosIa({ IA_MODELO: "gemma4:12b-it-qat", ANTHROPIC_API_KEY: "k" })).toEqual({
      modelo: "claude-haiku-5-5",
      claveNube: "k",
      modeloDificil: "claude-sonnet-5-5",
      respaldo: "gemma4:12b-it-qat",
    });
  });

  test("IA_NUBE=0 apaga la nube aunque esté la clave", () => {
    expect(modelosIa({ IA_MODELO: "gemma4:12b-it-qat", ANTHROPIC_API_KEY: "k", IA_NUBE: "0" }).modelo).toBe("gemma4:12b-it-qat");
  });

  test("IA_MODELO=claude-... se respeta, con gemma de respaldo", () => {
    expect(modelosIa({ IA_MODELO: "claude-sonnet-5-5", ANTHROPIC_API_KEY: "k" })).toMatchObject({ modelo: "claude-sonnet-5-5", respaldo: "gemma4:12b-it-qat" });
  });
});
