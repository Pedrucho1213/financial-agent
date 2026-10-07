#!/usr/bin/env bash
# Registra en launchd lo que mantiene el asistente andando, sin contraseña de administrador:
# - el servidor: arranca al iniciar sesión y se reinicia solo si falla;
# - el actualizador: cada 5 minutos instala lo nuevo de main (ops/auto-actualizar.sh);
# - caffeinate -s: la Mac no se duerme mientras está conectada a la corriente.
# Uso: ./ops/instalar-servicio.sh          (instala o actualiza los tres)
#      ./ops/instalar-servicio.sh --quitar (los desinstala)
set -euo pipefail

SERVIDOR_ETIQUETA="mx.financial-agent.servidor"
ACTUALIZADOR_ETIQUETA="mx.financial-agent.actualizador"
DESPIERTA_ETIQUETA="mx.financial-agent.despierta"
AGENTES="$HOME/Library/LaunchAgents"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SERVIDOR="$REPO/apps/server"
LOGS="$REPO/logs"
DOMINIO="gui/$(id -u)"

quitar() {
  launchctl bootout "$DOMINIO/$1" 2>/dev/null || true
  rm -f "$AGENTES/$1.plist"
}

if [[ "${1:-}" == "--quitar" ]]; then
  for etiqueta in "$SERVIDOR_ETIQUETA" "$ACTUALIZADOR_ETIQUETA" "$DESPIERTA_ETIQUETA"; do quitar "$etiqueta"; done
  echo "Servidor, actualizador y caffeinate quitados."
  exit 0
fi

BUN="$(command -v bun || true)"
if [[ -z "$BUN" ]]; then
  echo "No encontré bun. Instálalo con: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
if [[ ! -f "$SERVIDOR/.env" ]]; then
  echo "Falta $SERVIDOR/.env. Cópialo de .env.example y ajústalo." >&2
  exit 1
fi
# launchd arranca con un PATH mínimo: el actualizador necesita bun, git, sqlite3 y curl.
RUTA="$(dirname "$BUN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$LOGS" "$AGENTES"

instalar() {
  local etiqueta="$1" contenido="$2"
  cat >"$AGENTES/$etiqueta.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$etiqueta</string>
$contenido
</dict>
</plist>
PLIST
  launchctl bootout "$DOMINIO/$etiqueta" 2>/dev/null || true
  launchctl bootstrap "$DOMINIO" "$AGENTES/$etiqueta.plist"
}

# ExitTimeOut: al reiniciar, el servidor termina lo que tiene en curso (hasta 40 s) antes de apagarse.
instalar "$SERVIDOR_ETIQUETA" "  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$SERVIDOR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ExitTimeOut</key><integer>45</integer>
  <key>StandardOutPath</key><string>$LOGS/servidor.log</string>
  <key>StandardErrorPath</key><string>$LOGS/servidor.log</string>"

instalar "$ACTUALIZADOR_ETIQUETA" "  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>$REPO/ops/auto-actualizar.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$RUTA</string>
  </dict>
  <key>StartInterval</key><integer>300</integer>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/actualizador.log</string>
  <key>StandardErrorPath</key><string>$LOGS/actualizador.log</string>"

# -s solo vale con corriente: con batería la Mac se duerme como siempre. La pantalla sí se apaga.
instalar "$DESPIERTA_ETIQUETA" "  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>"

echo "Instalados el servidor, el actualizador y caffeinate. Logs en $LOGS/servidor.log y $LOGS/actualizador.log"
sleep 2
curl -fsS "http://127.0.0.1:$(grep -E '^PUERTO=' "$SERVIDOR/.env" | cut -d= -f2 || echo 8787)/salud" && echo " <- el servidor responde"
