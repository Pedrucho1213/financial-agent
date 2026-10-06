import { afterAll, expect, test } from "bun:test";
import { hablar } from "../src/ai/asistente";
import { crearModelo } from "../src/ai/modelo";
import { config } from "../src/config";
import { crearContexto } from "../src/finanzas/contexto";
import { buscarMovimientos } from "../src/finanzas/movimientos";
import { preparar } from "./ayuda";

// Servidor falso con el formato de /v1/chat/completions que exponen Ollama, LM Studio y Osaurus.
const peticiones: { tools?: unknown[]; messages: { role: string }[]; reasoning_effort?: string }[] = [];
const servidor = Bun.serve({
  port: 0,
  async fetch(req) {
    const cuerpo = (await req.json()) as (typeof peticiones)[number];
    peticiones.push(cuerpo);
    const yaHayResultado = cuerpo.messages.some((m) => m.role === "tool");
    const message = yaHayResultado
      ? { role: "assistant", content: "Listo, café de $85." }
      : {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "llamada_1",
              type: "function",
              function: {
                name: "registrar_movimientos",
                arguments: JSON.stringify({ movimientos: [{ tipo: "gasto", monto: 85, categoria: "Café" }] }),
              },
            },
          ],
        };
    return Response.json({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: "falso",
      choices: [{ index: 0, message, finish_reason: yaHayResultado ? "stop" : "tool_calls" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  },
});
afterAll(() => servidor.stop());

test("funciona con una API compatible con OpenAI", async () => {
  const { db, usuario } = preparar();
  const modelo = crearModelo({ ...config.ia, url: `http://localhost:${servidor.port}/v1` }, "falso");
  const deps = { db, modelo, zonaHoraria: "America/Mexico_City", monedaBase: "MXN" };
  const r = await hablar(deps, usuario.id, { texto: "gasté 85 en café", clientId: "dictado-proveedor" });

  // Solo registró: la confirmación se arma con lo guardado, sin otra vuelta del modelo.
  expect(r.respuesta).toBe("Listo, café de $85.");
  expect(peticiones).toHaveLength(1);
  expect(peticiones[0]?.tools).toHaveLength(8);
  expect(peticiones[0]?.reasoning_effort).toBe(config.ia.razonamiento);
  const ctx = crearContexto({ ...deps, usuarioId: usuario.id });
  expect(buscarMovimientos(ctx, { periodo: "todo" }).movimientos[0]).toMatchObject({ monto: "$85", categoria: "Comida > Café" });
});
