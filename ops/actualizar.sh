#!/usr/bin/env bash
# Trae lo último, instala dependencias, compila la app y reinicia el servidor.
# Uso: ./ops/actualizar.sh [rama] [commit]   (main por omisión; con un commit, avanza solo hasta ese commit)
# Si algo falla, sale con 10 (git), 11 (dependencias), 12 (pruebas), 13 (compilar la app) o 14 (el servidor
# no respondió con la versión nueva). Con YA_PROBADA=1 no corre las pruebas (el actualizador ya las corrió).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RAMA="${1:-main}"
COMMIT="${2:-}"
ETIQUETA="mx.financial-agent.servidor"
cd "$REPO"

paso() { local salida="$1"; shift; "$@" || { echo "Falló: $*" >&2; exit "$salida"; }; }

paso 10 git checkout "$RAMA"
if [[ -n "$COMMIT" ]]; then
  paso 10 git merge --ff-only "$COMMIT"
else
  paso 10 git fetch origin "$RAMA"
  paso 10 git pull --ff-only origin "$RAMA"
fi
paso 11 bun install --frozen-lockfile
[[ "${YA_PROBADA:-}" == 1 ]] || paso 12 bun run test
paso 13 bun run web:build

pid() { launchctl print "gui/$(id -u)/$ETIQUETA" 2>/dev/null | awk '$1 == "pid" { print $3 }'; }
if launchctl print "gui/$(id -u)/$ETIQUETA" >/dev/null 2>&1; then
  ANTES="$(pid)"
  launchctl kickstart -k "gui/$(id -u)/$ETIQUETA"
  PUERTO="$(grep -E '^PUERTO=' apps/server/.env 2>/dev/null | cut -d= -f2 | tr -d "\"' \r" || true)"
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
  exit 14
else
  echo "El servicio no está instalado; corre ./ops/instalar-servicio.sh"
fi
