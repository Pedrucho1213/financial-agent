#!/usr/bin/env bash
# Conecta la Mac a tu red de Tailscale sin contraseña de administrador y publica el servidor
# en https://finanzas.<tu-red>.ts.net, visible solo para tus dispositivos.
# Usa el tailscaled de Homebrew en modo de espacio de usuario, como LaunchAgent.
# Uso: ./ops/instalar-tailscale.sh          (instala, inicia sesión y publica)
#      ./ops/instalar-tailscale.sh --quitar (lo desinstala)
set -euo pipefail

ETIQUETA="mx.financial-agent.tailscaled"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
ESTADO="$HOME/Library/Application Support/financial-agent/tailscale"
SOCKET="$ESTADO/tailscaled.sock"
LOGS="$HOME/Library/Logs/financial-agent"
DOMINIO="gui/$(id -u)"
PUERTO="${PUERTO:-8787}"
ts() { tailscale --socket="$SOCKET" "$@"; }

if [[ "${1:-}" == "--quitar" ]]; then
  ts serve reset 2>/dev/null || true
  launchctl bootout "$DOMINIO/$ETIQUETA" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Tailscale quitado. Su estado sigue en $ESTADO por si lo vuelves a instalar."
  exit 0
fi

TAILSCALED="$(command -v tailscaled || true)"
if [[ -z "$TAILSCALED" ]] || ! command -v tailscale >/dev/null; then
  echo "Falta Tailscale. Instálalo con: brew install tailscale" >&2
  exit 1
fi

mkdir -p "$ESTADO" "$LOGS" "$(dirname "$PLIST")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETA</string>
  <key>ProgramArguments</key>
  <array>
    <string>$TAILSCALED</string>
    <string>--tun=userspace-networking</string>
    <string>--statedir=$ESTADO</string>
    <string>--socket=$SOCKET</string>
    <string>--port=0</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/tailscaled.log</string>
  <key>StandardErrorPath</key><string>$LOGS/tailscaled.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMINIO/$ETIQUETA" 2>/dev/null || true
launchctl bootstrap "$DOMINIO" "$PLIST"
for _ in {1..20}; do [[ -S "$SOCKET" ]] && break; sleep 0.5; done

if ! ts status >/dev/null 2>&1; then
  echo "Abre el enlace que aparece abajo e inicia sesión (el mismo usuario que en tu iPhone)."
  ts up --hostname=finanzas
fi
ts serve --bg "$PUERTO"
ts serve status
echo "Listo. Abre la dirección https://... de arriba en Safari del iPhone (con Tailscale encendido)."
