#!/usr/bin/env bash
# Pruebas post integración de toda la tanda sobre main (pedido de Pedro, 08-oct 18:42 y 19:39).
# Correr en la Mac, en un clon de /tmp (nunca el checkout de launchd), con el modelo cargado y sin otra
# medición en curso: pgrep -fl "bun (run )?(eval|qa)" debe salir vacío.
#   bash apps/server/qa/post-integracion.sh <clon> <rama-qa>
# <clon>: clon de main ya instalado; <rama-qa>: de donde se toma apps/server/qa/ (claude/project-thread-dtzcyg).
# No toca la base de Pedro: la batería y los evals usan bases en memoria; las e2e usan una API falsa.
set -uo pipefail
CLON=${1:?clon de main}
RAMA_QA=${2:-claude/project-thread-dtzcyg}
cd "$CLON"
git fetch -q origin "$RAMA_QA"
git checkout -q "origin/$RAMA_QA" -- apps/server/qa
echo "main $(git rev-parse --short HEAD) + qa de $(git rev-parse --short "origin/$RAMA_QA")"
bun install >/dev/null
SALIDA=${SALIDA:-/tmp/fa-qa-post}
mkdir -p "$SALIDA"
paso() { local nombre=$1; shift; echo "== $nombre"; ( "$@" ) >"$SALIDA/${nombre// /_}.txt" 2>&1; echo "   salida: $?"; }

cd apps/server
paso "typecheck" bun run typecheck
paso "test" bun test test/
paso "qa" bun test qa/ --timeout 30000
export IA_MANTENER_CARGADO=${IA_MANTENER_CARGADO:-8760h}
paso "bateria" bun qa/bateria.ts --veces 2 --traza
paso "eval-qa" bun qa/eval-qa.ts
paso "eval" bun eval/run.ts

cd ../web
paso "web typecheck" bun run typecheck
paso "web test" bun run test
paso "web build" bun run build
cp ../server/qa/web-qa28.pw.ts e2e/zz-qa28.spec.ts
cp ../server/qa/web-pr37.pw.ts e2e/zz-qa37.spec.ts
cp ../server/qa/web-pr42.pw.ts e2e/zz-qa42.spec.ts
paso "web e2e" bun run e2e --reporter=line
rm -f e2e/zz-qa28.spec.ts e2e/zz-qa37.spec.ts e2e/zz-qa42.spec.ts

echo "Resumen:"
for f in "$SALIDA"/*.txt; do echo "-- $(basename "$f")"; grep -E "^ *[0-9]+ (pass|fail)$|passed|failed|✓ [0-9]+ +✗|mediana|^[0-9]+/[0-9]+" "$f" | tail -14; done
