# Instalación en tu Mac

Todo corre directo en macOS, sin Docker: así la IA usa la GPU de tu chip Apple y no se aparta memoria de más.

## 1. Requisitos

- **Bun**: `curl -fsSL https://bun.sh/install | bash`
- **Ollama 0.19 o más reciente** (trae el motor MLX para chips Apple): [ollama.com/download](https://ollama.com/download)
- **Tailscale** en la Mac y en el iPhone, con la misma cuenta: [tailscale.com/download](https://tailscale.com/download)

## 2. Modelos

Descarga los candidatos de la prueba de 30 frases:

```bash
ollama pull gpt-oss:20b               # unos 14 GB, el más ligero
ollama pull qwen3.6:35b-a3b-nvfp4     # unos 24 GB, versión MLX
```

El modelo solo ocupa memoria mientras se usa; se libera según `IA_MANTENER_CARGADO` (10 minutos por omisión).

Si prefieres LM Studio u Osaurus en lugar de Ollama, apunta `IA_URL` a su API compatible con OpenAI y pon el nombre del modelo en `IA_MODELO`.

## 3. Configuración

```bash
bun install
cp apps/server/.env.example apps/server/.env
```

Revisa `apps/server/.env`. Por omisión el servidor escucha solo en `127.0.0.1:8787`, guarda la base en `apps/server/datos/finanzas.db` y usa `gpt-oss:20b`.

## 4. Tu usuario y el token del iPhone

```bash
bun run setup -- --nombre Pedro --dispositivo "iPhone 17 Pro Max"
```

Imprime un token que empieza con `fa_`. Cópialo: va en el Atajo y no se vuelve a mostrar. Para otro dispositivo, corre el mismo comando con otro `--dispositivo`.

## 5. Elegir el modelo

```bash
bun run eval -- --modelos gpt-oss:20b,qwen3.6:35b-a3b-nvfp4
```

Al final verás algo así por modelo: `gpt-oss:20b: 27/30 correctas (...); mediana 2100 ms, p90 3900 ms`. Elige el que acierte más con un tiempo aceptable y ponlo en `IA_MODELO`. Para ver solo un grupo: `--grupo registro`, `consulta`, `edicion` o `recurrentes`.

## 6. Arranque automático

```bash
./ops/instalar-servicio.sh
```

Registra el servidor en launchd: arranca al iniciar sesión y se reinicia solo si falla. Los logs quedan en `logs/servidor.log`. Para quitarlo: `./ops/instalar-servicio.sh --quitar`.

## 7. Acceso desde el iPhone con Tailscale

```bash
tailscale serve --bg 8787
tailscale serve status
```

`serve status` muestra una dirección como `https://macbook-pro-de-pedro.tu-red.ts.net`. Ábrela en Safari del iPhone agregando `/salud`: si ves `{"ok":true}`, el iPhone llega a tu Mac. Esa dirección solo funciona dentro de tu red de Tailscale; nadie más la ve.

## 8. Que la Mac esté disponible

- Ajustes del Sistema > Batería > Opciones: activa "Evitar el reposo automático con el adaptador de corriente cuando la pantalla esté apagada" y "Activar para acceso a la red".
- Con la tapa cerrada, una MacBook se duerme salvo que tenga monitor externo. Mientras esté dormida, el iPhone guarda tus dictados y los manda después.

## Respaldo

La base es un solo archivo. Mientras llega el respaldo automático (etapa 4), cópialo de vez en cuando:

```bash
sqlite3 apps/server/datos/finanzas.db ".backup '$HOME/Documents/finanzas-respaldo.db'"
```
