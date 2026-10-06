// Prueba de frases reales contra uno o varios modelos.
// Uso: bun run eval -- --modelos gpt-oss:20b@low,qwen3.6:35b-a3b@none [--repeticiones 3] [--grupo dificil] [--frase "texto"]
// "@low" fija cuánto razona el modelo (low, medium, high, none; "no" para no mandarlo).
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { consultarEntrada, hablar } from "../src/ai/asistente";
import { crearModelo, despertarModelo } from "../src/ai/modelo";
import { crearUsuario } from "../src/auth";
import { config } from "../src/config";
import { abrirBaseDatos } from "../src/db/client";
import { sembrarCategorias } from "../src/finanzas/catalogos";
import { crearContexto } from "../src/finanzas/contexto";
import { buscarMovimientos } from "../src/finanzas/movimientos";
import { listarRecurrentes } from "../src/finanzas/recurrentes";
import { esPregunta } from "../src/lib/texto";
import { type Caso, CASOS } from "./frases";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    modelos: { type: "string", default: `${config.ia.modelo}@${config.ia.razonamiento}` },
    repeticiones: { type: "string", default: "1" },
    grupo: { type: "string" },
    frase: { type: "string" },
    "sin-rafaga": { type: "boolean", default: false },
  },
});

const repeticiones = Math.max(1, Number(values.repeticiones) || 1);
const casos = CASOS.filter(
  (c) => (!values.grupo || c.grupo === values.grupo) && (!values.frase || c.frase.includes(values.frase)),
);

const percentil = (lista: number[], p: number) => {
  const orden = [...lista].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor((p / 100) * orden.length))] ?? 0;
};
const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function baseVacia() {
  const db = abrirBaseDatos(":memory:");
  const usuario = crearUsuario(db, "Prueba");
  sembrarCategorias(db, usuario.id);
  return { db, usuarioId: usuario.id, zonaHoraria: config.zonaHoraria, monedaBase: config.moneda };
}

type Resultado = {
  grupo: string;
  frase: string;
  ok: boolean;
  ms: number;
  respuesta: string;
  /** Las herramientas que llamó el modelo, para entender un fallo. */
  herramientas: string[];
  fallo?: string;
};

async function correrCaso(modelo: ReturnType<typeof crearModelo>, caso: Caso): Promise<Resultado> {
  const base = baseVacia();
  const ctx = crearContexto({ ...base, entradaId: "previa" });
  caso.preparar?.(ctx);
  const deps = { ...base, modelo };
  let respuesta = "";
  let herramientas: string[] = [];
  let estado: true | string;
  let ms = 0;
  try {
    // Lo dicho antes en la conversación; solo se mide el tiempo de la última frase.
    let conversacionId: string | undefined;
    for (const previo of caso.previos ?? []) {
      conversacionId = (await hablar(deps, base.usuarioId, { texto: previo, clientId: crypto.randomUUID(), conversacionId }))
        .conversacion_id;
    }
    const inicio = performance.now();
    const r = await hablar(deps, base.usuarioId, { texto: caso.frase, clientId: crypto.randomUUID(), conversacionId });
    ms = Math.round(performance.now() - inicio);
    respuesta = r.respuesta;
    herramientas = r.acciones.map((a) => `${a.herramienta} ${JSON.stringify(a.argumentos ?? null).slice(0, 300)}`);
    estado = caso.verificar({
      ...r,
      ctx,
      movimientos: buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos,
      recurrentes: listarRecurrentes(ctx).recurrentes,
    });
  } catch (error) {
    estado = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  return {
    grupo: caso.grupo,
    frase: caso.frase,
    ok: estado === true,
    ms,
    respuesta,
    herramientas,
    fallo: estado === true ? undefined : estado,
  };
}

/**
 * Cinco dictados que llegan juntos (la cola del iPhone al recuperar señal), uno repetido,
 * con la espera real del iPhone. Revisa que todo quede guardado una sola vez.
 */
async function rafaga(modelo: ReturnType<typeof crearModelo>) {
  const base = baseVacia();
  // Reintentos cortos para no esperar los 30 s reales si algo falla en segundo plano.
  const deps = { ...base, modelo, reintentosMs: [1000, 3000] };
  const dictados = [
    { texto: "Café 45", monto: "$45" },
    { texto: "Gasolina 700", monto: "$700" },
    { texto: "Uber 120", monto: "$120" },
    { texto: "Súper 1,300", monto: "$1,300" },
    { texto: "Farmacia 260", monto: "$260" },
  ].map((d) => ({ ...d, clientId: crypto.randomUUID() }));
  const inicio = performance.now();
  const envios = [...dictados, dictados[0]!].map((d) =>
    hablar(deps, base.usuarioId, { texto: d.texto, clientId: d.clientId }, { esperaMs: config.espera.registroMs }),
  );
  // Un fallo dentro de la espera (503 en la app) también cuenta como no respondido.
  const respuestas = await Promise.allSettled(envios);
  const pendientes = respuestas.slice(0, 5).filter((r) => r.status === "rejected" || r.value.pendiente).length;
  // Espera a que la Mac termine lo pendiente, reintentos incluidos (hasta 2 minutos).
  const limite = Date.now() + 120_000;
  const finales = [];
  for (const d of dictados) {
    let estado = await consultarEntrada(base.db, base.usuarioId, d.clientId, 120_000);
    while (estado?.estado !== "listo" && Date.now() < limite) {
      await Bun.sleep(500);
      estado = await consultarEntrada(base.db, base.usuarioId, d.clientId, 10_000);
    }
    finales.push({ ...d, estado });
  }
  const total = Math.round(performance.now() - inicio);
  for (const r of respuestas) if (r.status === "rejected") console.log(`           error dentro de la espera: ${r.reason}`);
  const ctx = crearContexto({ ...base });
  const guardados = buscarMovimientos(ctx, { periodo: "todo", limite: 50 }).movimientos.map((m) => m.monto).sort();
  const esperados = dictados.map((d) => d.monto).sort();
  const ok = JSON.stringify(guardados) === JSON.stringify(esperados);
  if (!ok) {
    for (const f of finales) {
      const herramientas = (f.estado?.acciones ?? []).map((a) => a.herramienta).join(", ") || "ninguna";
      console.log(`           ${f.texto}: ${f.estado?.estado} · "${f.estado?.respuesta ?? ""}" · herramientas: ${herramientas}`);
    }
  }
  return { ok, pendientes, total, guardados };
}

/** Memoria que ocupa el modelo cargado en Ollama, en GB. */
async function memoriaGb(nombre: string): Promise<number | undefined> {
  try {
    const r = await fetch(`${config.ia.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(5000) });
    const { models } = (await r.json()) as { models: { name: string; model: string; size: number }[] };
    const m = models.find((x) => x.name === nombre || x.model === nombre);
    return m ? Math.round((m.size / 1e9) * 10) / 10 : undefined;
  } catch {
    return undefined;
  }
}

const resumenes: string[] = [];
for (const entrada of values.modelos!.split(",").map((m) => m.trim()).filter(Boolean)) {
  const [nombreModelo, razonamiento] = entrada.split("@") as [string, string | undefined];
  const ia = { ...config.ia, razonamiento: razonamiento ?? config.ia.razonamiento };
  console.log(`\n=== ${nombreModelo} (razonamiento: ${ia.razonamiento || "no se manda"}) ===`);
  process.stdout.write("Cargando el modelo... ");
  const carga = performance.now();
  const cargado = await despertarModelo(ia, nombreModelo);
  console.log(cargado ? `listo en ${segundos(performance.now() - carga)}` : "no se pudo precargar (sigo de todos modos)");

  const modelo = crearModelo(ia, nombreModelo);
  const resultados: (Resultado & { repeticion: number })[] = [];
  for (let repeticion = 1; repeticion <= repeticiones; repeticion++) {
    if (repeticiones > 1) console.log(`-- repetición ${repeticion} de ${repeticiones}`);
    for (const caso of casos) {
      const r = await correrCaso(modelo, caso);
      resultados.push({ ...r, repeticion });
      console.log(`${r.ok ? "✓" : "✗"} ${String(r.ms).padStart(6)} ms  [${r.grupo}] ${r.frase}`);
      if (!r.ok) {
        console.log(`           ${String(r.fallo).slice(0, 300)}\n           respuesta: ${r.respuesta}`);
        console.log(`           herramientas: ${r.herramientas.length ? r.herramientas.join(" | ") : "ninguna"}`);
      }
    }
  }

  const memoria = await memoriaGb(nombreModelo);
  const prueba = values["sin-rafaga"] ? undefined : await rafaga(modelo);
  if (prueba) {
    console.log(
      `${prueba.ok ? "✓" : "✗"} ráfaga de 5 dictados + 1 repetido: ${5 - prueba.pendientes}/5 respondidos dentro de ${segundos(config.espera.registroMs)}, todo guardado en ${segundos(prueba.total)}${prueba.ok ? "" : `; quedó ${JSON.stringify(prueba.guardados)}`}`,
    );
  }

  const tiempos = resultados.filter((r) => r.ms > 0).map((r) => r.ms);
  const aciertos = resultados.filter((r) => r.ok).length;
  const porGrupo = [...new Set(resultados.map((r) => r.grupo))]
    .map((g) => {
      const del = resultados.filter((r) => r.grupo === g);
      return `${g} ${del.filter((r) => r.ok).length}/${del.length}`;
    })
    .join(", ");
  // Una frase es estable si pasó en todas las repeticiones.
  const estables = casos.filter((c) => resultados.filter((r) => r.frase === c.frase).every((r) => r.ok)).length;
  // Cuántos registros alcanzan a contestarse antes de que el iPhone deje de esperar.
  const registros = resultados.filter((r) => r.ms > 0 && !esPregunta(r.frase));
  const rapidos = registros.filter((r) => r.ms <= config.espera.registroMs).length;
  const resumen = [
    `${entrada}: ${aciertos}/${resultados.length} correctas (${Math.round((aciertos / resultados.length) * 100)}%)`,
    `estables ${estables}/${casos.length}`,
    `mediana ${segundos(percentil(tiempos, 50))}, p90 ${segundos(percentil(tiempos, 90))}, máx ${segundos(Math.max(0, ...tiempos))}`,
    `registros en menos de ${segundos(config.espera.registroMs)}: ${registros.length ? Math.round((rapidos / registros.length) * 100) : 0}%`,
    memoria !== undefined ? `memoria ${memoria} GB` : undefined,
    prueba ? `ráfaga ${prueba.ok ? "bien" : "MAL"}` : undefined,
    `\n    por grupo: ${porGrupo}`,
  ]
    .filter(Boolean)
    .join("; ");
  resumenes.push(resumen);

  mkdirSync("eval/resultados", { recursive: true });
  const archivo = `eval/resultados/${entrada.replace(/[^a-z0-9.@-]/gi, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(archivo, JSON.stringify({ modelo: nombreModelo, razonamiento: ia.razonamiento, resumen, memoria, rafaga: prueba, resultados }, null, 2));
}

console.log(`\nResumen\n${resumenes.join("\n")}`);
