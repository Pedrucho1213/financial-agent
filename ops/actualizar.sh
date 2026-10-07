#!/usr/bin/env bash
# Trae lo último, instala dependencias, compila la app y reinicia el servidor.
# Uso: ./ops/actualizar.sh [rama]   (main por omisión)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RAMA="${1:-main}"
ETIQUETA="mx.financial-agent.servidor"
cd "$REPO"

git fetch origin "$RAMA"
git checkout "$RAMA"
git pull --ff-only origin "$RAMA"
bun install
bun run test
bun run web:build

if launchctl print "gui/$(id -u)/$ETIQUETA" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$ETIQUETA"
  sleep 2
  PUERTO="$(grep -E '^PUERTO=' apps/server/.env 2>/dev/null | cut -d= -f2)"
  curl -fsS "http://127.0.0.1:${PUERTO:-8787}/salud" && echo " <- el servidor responde con la versión nueva"
else
  echo "El servicio no está instalado; corre ./ops/instalar-servicio.sh"
fi
