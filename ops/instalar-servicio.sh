#!/usr/bin/env bash
# Registra el servidor en launchd para que arranque al iniciar sesión y se reinicie solo si falla.
# Uso: ./ops/instalar-servicio.sh          (instala o actualiza)
#      ./ops/instalar-servicio.sh --quitar (lo desinstala)
set -euo pipefail

ETIQUETA="mx.financial-agent.servidor"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SERVIDOR="$REPO/apps/server"
LOGS="$REPO/logs"
DOMINIO="gui/$(id -u)"

if [[ "${1:-}" == "--quitar" ]]; then
  launchctl bootout "$DOMINIO/$ETIQUETA" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Servicio quitado."
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

mkdir -p "$LOGS" "$(dirname "$PLIST")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETA</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$SERVIDOR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/servidor.log</string>
  <key>StandardErrorPath</key><string>$LOGS/servidor.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMINIO/$ETIQUETA" 2>/dev/null || true
launchctl bootstrap "$DOMINIO" "$PLIST"
echo "Servicio instalado. Logs en $LOGS/servidor.log"
sleep 2
curl -fsS "http://127.0.0.1:$(grep -E '^PUERTO=' "$SERVIDOR/.env" | cut -d= -f2 || echo 8787)/salud" && echo " <- el servidor responde"
