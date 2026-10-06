// Prueba de 30 frases contra uno o varios modelos reales.
// Uso: bun run eval -- --modelos gpt-oss:20b,qwen3.6:35b-a3b [--grupo registro] [--frase "texto"]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { hablar } from "../src/ai/asistente";
import { crearModelo, despertarModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { crearContexto } from "../src/finanzas/contexto";
import { buscarMovimientos } from "../src/finanzas/movimientos";
import { listarRecurrentes } from "../src/finanzas/recurrentes";
import { CASOS } from "./frases";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    modelos: { type: "string", default: config.ia.modelo },
    grupo: { type: "string" },
    frase: { type: "string" },
  },
});

const casos = CASOS.filter(
  (c) => (!values.grupo || c.grupo === values.grupo) && (!values.frase || c.frase.includes(values.frase)),
);

const percentil = (lista: number[], p: number) => {
  const orden = [...lista].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor((p / 100) * orden.length))] ?? 0;
};

const resumenes: string[] = [];
for (const nombreModelo of values.modelos!.split(",").map((m) => m.trim())) {
  console.log(`\n=== ${nombreModelo} ===`);
  process.stdout.write("Cargando el modelo... ");
  const cargado = await despertarModelo(config.ia, nombreModelo);
  console.log(cargado ? "listo" : "no se pudo precargar (sigo de todos modos)");

  const modelo = crearModelo(config.ia, nombreModelo);
  const resultados: { grupo: string; frase: string; ok: boolean; ms: number; respuesta: string; fallo?: string }[] = [];
  for (const caso of casos) {
    const db = abrirBaseDatos(":memory:");
    const usuario = crearUsuario(db, "Prueba");
    sembrarCategorias(db, usuario.id);
    const base = { db, usuarioId: usuario.id, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
    const ctx = crearContexto({ ...base, entradaId: "previa" });
    caso.preparar?.(ctx);

    const inicio = performance.now();
    let estado: true | string;
    let respuesta = "";
    try {
      const r = await hablar({ ...base, modelo }, usuario.id, { texto: caso.frase, clientId: crypto.randomUUID() });
      respuesta = r.respuesta;
      estado = caso.verificar({
        ...r,
        ctx,
        movimientos: buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos,
        recurrentes: listarRecurrentes(ctx).recurrentes,
      });
    } catch (error) {
      estado = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    const ms = Math.round(performance.now() - inicio);
    resultados.push({ grupo: caso.grupo, frase: caso.frase, ok: estado === true, ms, respuesta, fallo: estado === true ? undefined : estado });
    console.log(`${estado === true ? "✓" : "✗"} ${String(ms).padStart(6)} ms  ${caso.frase}`);
    if (estado !== true) console.log(`           ${String(estado).slice(0, 300)}\n           respuesta: ${respuesta}`);
  }

  const tiempos = resultados.map((r) => r.ms);
  const aciertos = resultados.filter((r) => r.ok).length;
  const porGrupo = [...new Set(resultados.map((r) => r.grupo))]
    .map((g) => {
      const del = resultados.filter((r) => r.grupo === g);
      return `${g} ${del.filter((r) => r.ok).length}/${del.length}`;
    })
    .join(", ");
  const resumen = `${nombreModelo}: ${aciertos}/${resultados.length} correctas (${porGrupo}); mediana ${percentil(tiempos, 50)} ms, p90 ${percentil(tiempos, 90)} ms`;
  resumenes.push(resumen);

  mkdirSync("eval/resultados", { recursive: true });
  const archivo = `eval/resultados/${nombreModelo.replace(/[^a-z0-9.-]/gi, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(archivo, JSON.stringify({ modelo: nombreModelo, resumen, resultados }, null, 2));
}

console.log(`\nResumen\n${resumenes.join("\n")}`);
