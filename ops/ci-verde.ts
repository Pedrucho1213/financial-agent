// Dice cómo va la CI de GitHub en un commit, para que el actualizador no instale algo en rojo. El
// repositorio es público, así que no hace falta token (GitHub deja 60 consultas por hora).
// Imprime "verde", "corriendo", "sin-ci" (no hay corridas), "cancelada" o "rojo <nombres>". Si no puede
// saberlo, sale con error.
// Uso: bun ops/ci-verde.ts <dueño/repositorio> <commit>
const [repositorio, commit] = Bun.argv.slice(2);
const respuesta = await fetch(`https://api.github.com/repos/${repositorio}/commits/${commit}/check-runs?per_page=100`, {
  headers: { Accept: "application/vnd.github+json", "User-Agent": "financial-agent-actualizador" },
  signal: AbortSignal.timeout(15_000),
});
if (!respuesta.ok) throw new Error(`GitHub respondió ${respuesta.status}`);
const { check_runs: corridas } = (await respuesta.json()) as {
  check_runs: { name: string; status: string; conclusion: string | null }[];
};
const terminada = (c: (typeof corridas)[number]) => c.status === "completed";
const rojas = corridas.filter((c) => terminada(c) && !["success", "neutral", "skipped", "cancelled"].includes(c.conclusion ?? ""));
if (rojas.length > 0) console.log(`rojo ${rojas.map((c) => c.name).join(", ")}`);
else if (corridas.length === 0) console.log("sin-ci");
else if (!corridas.every(terminada)) console.log("corriendo");
else if (corridas.some((c) => c.conclusion === "cancelled")) console.log("cancelada");
else console.log("verde");
