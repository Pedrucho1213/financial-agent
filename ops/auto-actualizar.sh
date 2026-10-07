#!/usr/bin/env bash
# Instala solo lo nuevo de main. launchd lo corre cada 5 minutos (ver ops/instalar-servicio.sh).
# Prueba la versión nueva en una copia aparte, espera un rato sin dictados (con un tope, porque el
# servidor se reinicia sin perder nada), respalda la base, instala y, si el servidor no responde,
# regresa a la versión anterior y no vuelve a intentar esa misma versión.
# Uso: ./ops/auto-actualizar.sh        (lo normal, desde launchd)
#      ./ops/auto-actualizar.sh --ya   (no espera el rato sin uso)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SERVIDOR="$REPO/apps/server"
RAMA="main"
ETIQUETA="mx.financial-agent.servidor"
ESTADO="$REPO/logs/actualizador"
RESPALDOS="$SERVIDOR/datos/respaldos"
SIN_USO_S=120            # sin dictados en los últimos 2 minutos...
ESPERA_MAXIMA_S=3600     # ...o, si nunca hay un rato así, después de una hora de espera
RESPALDOS_A_GUARDAR=10
YA=0
[[ "${1:-}" == "--ya" ]] && YA=1

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
leer() { [[ -f "$ESTADO/$1" ]] && cat "$ESTADO/$1" || true; }
# Lo que impide actualizar se anota una vez, no cada 5 minutos.
una_vez() { [[ "$(leer ultimo-aviso)" == "$*" ]] || { log "$*"; echo "$*" >"$ESTADO/ultimo-aviso"; }; }
mkdir -p "$ESTADO"

# Uno a la vez. Un candado de más de una hora es de una corrida que se cortó.
CANDADO="$ESTADO/candado"
if ! mkdir "$CANDADO" 2>/dev/null; then
  if [[ -n "$(find "$CANDADO" -maxdepth 0 -mmin +60 2>/dev/null)" ]]; then rm -rf "$CANDADO"; mkdir "$CANDADO"; else exit 0; fi
fi
PRUEBA=""
limpiar() {
  [[ -n "$PRUEBA" ]] && git -C "$REPO" worktree remove --force "$PRUEBA" >/dev/null 2>&1 || true
  rm -rf "$CANDADO"
}
trap limpiar EXIT

cd "$REPO"
git fetch -q origin "$RAMA" 2>/dev/null || exit 0
ACTUAL="$(git rev-parse HEAD)"
NUEVA="$(git rev-parse "origin/$RAMA")"
[[ "$ACTUAL" == "$NUEVA" ]] && exit 0
[[ "$(leer fallida)" == "$NUEVA" ]] && exit 0

# Solo sobre un checkout limpio de main que nada más avanza (los archivos sin seguimiento no importan).
if [[ "$(git symbolic-ref -q --short HEAD || true)" != "$RAMA" ]]; then una_vez "El checkout no está en $RAMA; no actualizo a ${NUEVA:0:7}."; exit 0; fi
if ! git merge-base --is-ancestor "$ACTUAL" "$NUEVA"; then una_vez "$RAMA local tiene commits que no están en origin; no actualizo a ${NUEVA:0:7}."; exit 0; fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then una_vez "Hay cambios locales sin guardar; no actualizo a ${NUEVA:0:7}."; exit 0; fi

# 1. Prueba la versión nueva en una copia aparte, una sola vez por versión.
if [[ "$(leer probada)" != "$NUEVA" ]]; then
  log "Probando ${NUEVA:0:7} ($(git log -1 --format=%s "$NUEVA"))."
  PRUEBA="$(mktemp -d "${TMPDIR:-/tmp}/fa-actualizar.XXXXXX")"
  git worktree add -q --detach "$PRUEBA" "$NUEVA"
  if ! (cd "$PRUEBA" && bun install --frozen-lockfile && bun run typecheck && bun run test) >"$ESTADO/prueba.log" 2>&1; then
    echo "$NUEVA" >"$ESTADO/fallida"
    log "Las pruebas de ${NUEVA:0:7} fallan (detalle en $ESTADO/prueba.log); sigo con ${ACTUAL:0:7}."
    exit 1
  fi
  echo "$NUEVA" >"$ESTADO/probada"
  date +%s >"$ESTADO/esperando-desde"
fi

# 2. Un rato sin dictados ni nada a medias, salvo que ya se haya esperado mucho.
BASE_DATOS="$(grep -E '^BASE_DATOS=' "$SERVIDOR/.env" 2>/dev/null | cut -d= -f2- || true)"
BASE_DATOS="${BASE_DATOS:-./datos/finanzas.db}"
[[ "$BASE_DATOS" == /* ]] || BASE_DATOS="$SERVIDOR/${BASE_DATOS#./}"
if [[ "$YA" == 0 && -f "$BASE_DATOS" ]]; then
  SEGUNDOS="$(sqlite3 -readonly "$BASE_DATOS" "select coalesce(cast((julianday('now') - julianday(max(ultimo_uso))) * 86400 as integer), 999999) from dispositivos")"
  A_MEDIAS="$(sqlite3 -readonly "$BASE_DATOS" "select count(*) from entradas where estado = 'procesando' and creado_en > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes')")"
  DESDE="$(leer esperando-desde)"
  [[ -n "$DESDE" ]] || { DESDE="$(date +%s)"; echo "$DESDE" >"$ESTADO/esperando-desde"; }
  ESPERANDO=$(($(date +%s) - DESDE))
  if [[ ("$SEGUNDOS" -lt "$SIN_USO_S" || "$A_MEDIAS" -gt 0) && "$ESPERANDO" -lt "$ESPERA_MAXIMA_S" ]]; then exit 0; fi
fi

# 3. Respaldo de la base antes de instalar (y de cualquier migración que traiga).
if [[ -f "$BASE_DATOS" ]]; then
  mkdir -p "$RESPALDOS"
  RESPALDO="$RESPALDOS/antes-$(date +%Y%m%d-%H%M%S)-${NUEVA:0:7}.db"
  sqlite3 -readonly "$BASE_DATOS" ".backup '$RESPALDO'"
  ls -1t "$RESPALDOS"/antes-*.db 2>/dev/null | tail -n +$((RESPALDOS_A_GUARDAR + 1)) | while read -r viejo; do rm -f "$viejo"; done
  log "Base respaldada en $RESPALDO."
fi

# 4. Instala y revisa que el servidor conteste; si no, regresa a la versión anterior.
PUERTO="$(grep -E '^PUERTO=' "$SERVIDOR/.env" 2>/dev/null | cut -d= -f2 || true)"
responde() {
  for _ in {1..20}; do curl -fsS "http://127.0.0.1:${PUERTO:-8787}/salud" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}
log "Instalando ${NUEVA:0:7} sobre ${ACTUAL:0:7}."
if "$REPO/ops/actualizar.sh" "$RAMA" >"$ESTADO/instalacion.log" 2>&1 && responde; then
  log "Listo: ${NUEVA:0:7} instalada y respondiendo."
  exit 0
fi
echo "$NUEVA" >"$ESTADO/fallida"
log "${NUEVA:0:7} no quedó bien (detalle en $ESTADO/instalacion.log); regreso a ${ACTUAL:0:7}."
git reset -q --hard "$ACTUAL"
bun install --frozen-lockfile >/dev/null 2>&1 || true
bun run web:build >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
if responde; then log "De vuelta en ${ACTUAL:0:7}."; else log "El servidor tampoco responde con ${ACTUAL:0:7}; revisa logs/servidor.log."; fi
exit 1
