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
bun install --frozen-lockfile
bun run test
bun run web:build

pid() { launchctl print "gui/$(id -u)/$ETIQUETA" 2>/dev/null | awk '$1 == "pid" { print $3 }'; }
if launchctl print "gui/$(id -u)/$ETIQUETA" >/dev/null 2>&1; then
  ANTES="$(pid)"
  launchctl kickstart -k "gui/$(id -u)/$ETIQUETA"
  PUERTO="$(grep -E '^PUERTO=' apps/server/.env 2>/dev/null | cut -d= -f2 || true)"
  # El servidor viejo termina lo que tiene en curso antes de apagarse: puede tardar unos segundos.
  for _ in {1..60}; do
    AHORA="$(pid)"
    if [[ -n "$AHORA" && "$AHORA" != "$ANTES" ]] && curl -fsS "http://127.0.0.1:${PUERTO:-8787}/salud" >/dev/null 2>&1; then
      echo "El servidor responde con la versión nueva."
      exit 0
    fi
    sleep 1
  done
  echo "El servidor no respondió en 60 segundos; revisa logs/servidor.log." >&2
  exit 1
else
  echo "El servicio no está instalado; corre ./ops/instalar-servicio.sh"
fi
