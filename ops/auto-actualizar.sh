#!/usr/bin/env bash
# Instala solo lo nuevo de main. launchd lo corre cada 5 minutos (ver ops/instalar-servicio.sh).
# Espera a que la CI de GitHub esté en verde, prueba la versión nueva en una copia aparte, espera un rato
# sin dictados (con un tope, porque el servidor se reinicia sin perder nada) e instala; el servidor respalda
# la base antes de migrar. Si la versión nueva no queda bien, regresa a la anterior y no vuelve a intentar
# esa misma versión. Lo que pudo ser la red (git, dependencias, GitHub) se reintenta en la siguiente vuelta.
# Uso: ./ops/auto-actualizar.sh        (lo normal, desde launchd)
#      ./ops/auto-actualizar.sh --ya   (no espera el rato sin uso)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SERVIDOR="$REPO/apps/server"
RAMA="main"
ETIQUETA="mx.financial-agent.servidor"
DOMINIO="gui/$(id -u)"
ESTADO="$REPO/logs/actualizador"
SIN_USO_S=120            # sin dictados en los últimos 2 minutos...
ESPERA_MAXIMA_S=3600     # ...o, si nunca hay un rato así, después de una hora de espera
SIN_CI_S=900             # una versión sin CI (o con la CI cancelada) después de 15 minutos se prueba solo aquí
YA=0
[[ "${1:-}" == "--ya" ]] && YA=1

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
leer() { [[ -f "$ESTADO/$1" ]] && cat "$ESTADO/$1" || true; }
# Lo que impide actualizar se anota una vez, no cada 5 minutos.
una_vez() { [[ "$(leer ultimo-aviso)" == "$*" ]] || { log "$*"; echo "$*" >"$ESTADO/ultimo-aviso"; }; }
# Un valor del .env del servidor, sin comillas.
del_env() { grep -E "^$1=" "$SERVIDOR/.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d "\"'\r" || true; }
mkdir -p "$ESTADO"

# Uno a la vez. Un candado de más de una hora es de una corrida que se cortó.
CANDADO="$ESTADO/candado"
if ! mkdir "$CANDADO" 2>/dev/null; then
  if [[ -n "$(find "$CANDADO" -maxdepth 0 -mmin +60 2>/dev/null)" ]]; then rm -rf "$CANDADO"; mkdir "$CANDADO"; else exit 0; fi
fi
PRUEBA=""
limpiar() {
  if [[ -n "$PRUEBA" ]]; then
    git -C "$REPO" worktree remove --force "$PRUEBA" >/dev/null 2>&1 || true
    rm -rf "$PRUEBA"
    git -C "$REPO" worktree prune >/dev/null 2>&1 || true
  fi
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
checkout_limpio() {
  if [[ "$(git symbolic-ref -q --short HEAD || true)" != "$RAMA" ]]; then una_vez "El checkout no está en $RAMA; no actualizo a ${NUEVA:0:7}."; return 1; fi
  if [[ "$(git rev-parse HEAD)" != "$ACTUAL" ]]; then una_vez "El checkout cambió mientras esperaba; lo reviso en la siguiente vuelta."; return 1; fi
  if ! git merge-base --is-ancestor "$ACTUAL" "$NUEVA"; then una_vez "$RAMA local tiene commits que no están en origin; no actualizo a ${NUEVA:0:7}."; return 1; fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then una_vez "Hay cambios locales sin guardar; no actualizo a ${NUEVA:0:7}."; return 1; fi
  return 0
}
checkout_limpio || exit 0

if [[ "$(leer probada)" != "$NUEVA" ]]; then
  # 1. La CI de GitHub (tipos, pruebas y la app en un navegador) en verde. Si no se puede saber, sigue.
  REPO_GH="$(git remote get-url origin | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')"
  CI="$(bun "$REPO/ops/ci-verde.ts" "$REPO_GH" "$NUEVA" 2>/dev/null || echo "sin respuesta de GitHub")"
  case "$CI" in
    verde) ;;
    corriendo) exit 0 ;;
    sin-ci | cancelada) [[ $(($(date +%s) - $(git log -1 --format=%ct "$NUEVA"))) -ge "$SIN_CI_S" ]] || exit 0 ;;
    rojo*) una_vez "La CI de ${NUEVA:0:7} está en rojo (${CI#rojo }); no la instalo."; exit 0 ;;
    *) una_vez "No pude ver la CI de ${NUEVA:0:7} ($CI); la pruebo solo aquí." ;;
  esac

  # 2. Prueba la versión nueva en una copia aparte, una sola vez por versión.
  log "Probando ${NUEVA:0:7} ($(git log -1 --format=%s "$NUEVA"))."
  PRUEBA="$(mktemp -d "${TMPDIR:-/tmp}/fa-actualizar.XXXXXX")"
  if ! { git worktree add -q --detach "$PRUEBA" "$NUEVA" && (cd "$PRUEBA" && bun install --frozen-lockfile); } >"$ESTADO/prueba.log" 2>&1; then
    una_vez "No pude preparar la copia para probar ${NUEVA:0:7} (¿sin red?, detalle en $ESTADO/prueba.log); lo intento en cada vuelta."
    exit 1
  fi
  if ! (cd "$PRUEBA" && bun run typecheck && bun run test) >>"$ESTADO/prueba.log" 2>&1; then
    echo "$NUEVA" >"$ESTADO/fallida"
    log "Las pruebas de ${NUEVA:0:7} fallan (detalle en $ESTADO/prueba.log); sigo con ${ACTUAL:0:7}."
    exit 1
  fi
  echo "$NUEVA" >"$ESTADO/probada"
  date +%s >"$ESTADO/esperando-desde"
fi

# 3. Un rato sin dictados ni nada a medias, salvo que ya se haya esperado mucho.
BASE_DATOS="$(del_env BASE_DATOS)"
BASE_DATOS="${BASE_DATOS:-./datos/finanzas.db}"
[[ "$BASE_DATOS" == /* ]] || BASE_DATOS="$SERVIDOR/${BASE_DATOS#./}"
if [[ ! -f "$BASE_DATOS" ]]; then
  una_vez "No encontré la base en $BASE_DATOS; instalo ${NUEVA:0:7} sin revisar si está en uso."
elif [[ "$YA" == 0 ]]; then
  SEGUNDOS="$(sqlite3 -readonly "$BASE_DATOS" "select coalesce(cast((julianday('now') - julianday(max(ultimo_uso))) * 86400 as integer), 999999) from dispositivos")"
  A_MEDIAS="$(sqlite3 -readonly "$BASE_DATOS" "select count(*) from entradas where estado = 'procesando' and creado_en > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes')")"
  DESDE="$(leer esperando-desde)"
  [[ -n "$DESDE" ]] || { DESDE="$(date +%s)"; echo "$DESDE" >"$ESTADO/esperando-desde"; }
  ESPERANDO=$(($(date +%s) - DESDE))
  if [[ ("$SEGUNDOS" -lt "$SIN_USO_S" || "$A_MEDIAS" -gt 0) && "$ESPERANDO" -lt "$ESPERA_MAXIMA_S" ]]; then exit 0; fi
fi

# 4. Instala, revisando otra vez que nadie haya tocado el checkout mientras se esperaba.
checkout_limpio || exit 0
PUERTO="$(del_env PUERTO | tr -d ' ')"
responde() {
  for _ in {1..20}; do curl -fsS "http://127.0.0.1:${PUERTO:-8787}/salud" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}
migraciones() { sqlite3 -readonly "$BASE_DATOS" "select count(*) from __drizzle_migrations" 2>/dev/null || echo 0; }
MIGRACIONES="$(migraciones)"
touch "$ESTADO/instalando"
log "Instalando ${NUEVA:0:7} sobre ${ACTUAL:0:7}."
FASE=0
YA_PROBADA=1 "$REPO/ops/actualizar.sh" "$RAMA" "$NUEVA" >"$ESTADO/instalacion.log" 2>&1 || FASE=$?
if [[ "$FASE" == 0 ]] && ! responde; then FASE=14; fi
if [[ "$FASE" == 0 ]]; then
  rm -f "$ESTADO/ultimo-aviso"
  log "Listo: ${NUEVA:0:7} instalada y respondiendo."
  exit 0
fi

case "$FASE" in
  10) log "No pude traer ${NUEVA:0:7} con git (detalle en $ESTADO/instalacion.log); lo intento en la siguiente vuelta." ;;
  11) log "No pude instalar las dependencias de ${NUEVA:0:7} (¿sin red?, detalle en $ESTADO/instalacion.log); regreso a ${ACTUAL:0:7} y lo intento en la siguiente vuelta." ;;
  12 | 13) echo "$NUEVA" >"$ESTADO/fallida"; log "Las pruebas o la app de ${NUEVA:0:7} fallan (detalle en $ESTADO/instalacion.log); regreso a ${ACTUAL:0:7} y no vuelvo a intentar esa versión." ;;
  *) echo "$NUEVA" >"$ESTADO/fallida"; log "El servidor no respondió con ${NUEVA:0:7} (detalle en $ESTADO/instalacion.log y logs/servidor.log); regreso a ${ACTUAL:0:7} y no vuelvo a intentar esa versión." ;;
esac

# 5. De vuelta a la versión anterior. --keep no pisa nada que alguien haya cambiado a mano mientras tanto.
if [[ "$(git rev-parse HEAD)" != "$ACTUAL" ]]; then
  if ! git reset -q --keep "$ACTUAL"; then
    log "No pude regresar a ${ACTUAL:0:7} sin pisar cambios locales; lo dejo como está (revisa git status)."
    exit 1
  fi
  bun install --frozen-lockfile >/dev/null 2>&1 || true
  bun run web:build >/dev/null 2>&1 || true
fi
# Si falló antes de reiniciar, el servidor sigue con la versión anterior.
case "$FASE" in 10 | 11 | 12 | 13) exit 1 ;; esac

pid() { launchctl print "$DOMINIO/$ETIQUETA" 2>/dev/null | awk '$1 == "pid" { print $3 }'; }
reiniciar() {
  local antes ahora
  antes="$(pid)"
  launchctl kickstart -k "$DOMINIO/$ETIQUETA" 2>/dev/null || true
  for _ in {1..60}; do
    ahora="$(pid)"
    if [[ -n "$ahora" && "$ahora" != "$antes" ]] && curl -fsS "http://127.0.0.1:${PUERTO:-8787}/salud" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
# La base solo se regresa si la versión nueva la migró y la anterior ya no arranca con ella. La que dejó la
# versión nueva no se borra: queda aparte, junto a los respaldos.
regresar_base() {
  local carpeta respaldo aparte archivo
  carpeta="$(dirname "$BASE_DATOS")/respaldos"
  respaldo="$(find "$carpeta" -maxdepth 1 -name 'antes-migrar-*.db' -newer "$ESTADO/instalando" 2>/dev/null | sort | head -n 1)"
  if [[ -z "$respaldo" ]]; then log "No encontré el respaldo que el servidor hace antes de migrar."; return 1; fi
  aparte="$carpeta/despues-de-${NUEVA:0:7}-$(date +%Y%m%d-%H%M%S)"
  launchctl bootout "$DOMINIO/$ETIQUETA" 2>/dev/null || true
  for _ in {1..50}; do launchctl print "$DOMINIO/$ETIQUETA" >/dev/null 2>&1 || break; sleep 1; done
  mkdir -p "$aparte"
  for archivo in "$BASE_DATOS" "$BASE_DATOS-wal" "$BASE_DATOS-shm"; do
    if [[ -f "$archivo" ]]; then mv "$archivo" "$aparte/"; fi
  done
  cp "$respaldo" "$BASE_DATOS"
  launchctl bootstrap "$DOMINIO" "$HOME/Library/LaunchAgents/$ETIQUETA.plist" || { log "No pude volver a cargar el servidor en launchd."; return 1; }
  log "Regresé la base a $respaldo; la que dejó ${NUEVA:0:7} quedó en $aparte."
}
if reiniciar; then
  log "De vuelta en ${ACTUAL:0:7}."
elif [[ -f "$BASE_DATOS" && "$(migraciones)" != "$MIGRACIONES" ]] && regresar_base && responde; then
  log "De vuelta en ${ACTUAL:0:7}, con la base de antes de migrar."
else
  log "El servidor tampoco responde con ${ACTUAL:0:7}; revisa logs/servidor.log."
fi
exit 1
