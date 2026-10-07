# Instalación en tu Mac

Todo corre directo en macOS, sin Docker: así la IA usa la GPU de tu chip Apple y no se aparta memoria de más.

## 1. Requisitos

- **Bun**: `curl -fsSL https://bun.sh/install | bash`
- **Ollama 0.19 o más reciente** (trae el motor MLX para chips Apple): [ollama.com/download](https://ollama.com/download)
- **Tailscale** en la Mac y en el iPhone, con la misma cuenta: [tailscale.com/download](https://tailscale.com/download)

## 2. Modelos

Descarga el modelo que ganó la prueba (ver el paso 5):

```bash
ollama pull gemma4:12b-it-qat   # unos 8 GB de memoria mientras se usa
```

El modelo solo ocupa memoria mientras se usa: se libera a los 5 minutos sin dictados. Con Ollama 0.32.5 ese tiempo lo fija el servicio de Ollama (`OLLAMA_KEEP_ALIVE`), porque su API compatible con OpenAI todavía no lee el `IA_MANTENER_CARGADO` que manda el servidor. Por eso el primer dictado después de un rato tarda 15 a 18 segundos mientras el modelo vuelve a cargar; luego responde en 2 a 3. Los registros con monto no esperan tanto: a los 5 segundos el Atajo contesta "Anotado" y la Mac termina sola.

Si prefieres LM Studio u Osaurus en lugar de Ollama, apunta `IA_URL` a su API compatible con OpenAI y pon el nombre del modelo en `IA_MODELO`.

## 3. Configuración

```bash
bun install
cp apps/server/.env.example apps/server/.env
```

Revisa `apps/server/.env`. Por omisión el servidor escucha solo en `127.0.0.1:8787`, guarda la base en `apps/server/datos/finanzas.db` y usa `gemma4:12b-it-qat` sin razonamiento (`IA_RAZONAMIENTO=none`).

## 4. La app y tu cuenta

```bash
bun run web:build                                   # compila la app (PWA) en apps/web/dist
bun run invitar -- --nombre Pedro --url https://finanzas.tu-red.ts.net --atajo
```

`invitar` crea tu cuenta si no existe e imprime un código de 6 caracteres y un enlace; con `--atajo`, también el enlace que instala el Atajo. Abre el enlace en Safari del iPhone: la app entra sola con el código y guarda su propio acceso. El código vence en 24 horas y sirve una sola vez; para otro iPhone o navegador corre el mismo comando, o genera un código desde Ajustes en la app.

El Atajo "Finanzas" se instala con ese enlace o desde la app (Ajustes > Instalar el Atajo en este iPhone): la Mac lo genera con su propio acceso y lo firma. Detalles en [atajo-finanzas.md](atajo-finanzas.md).

Si solo quieres un token para probar con `curl`: `bun run setup -- --nombre Pedro --dispositivo "Pruebas"`.

## 5. Elegir el modelo

```bash
bun run eval -- --modelos gemma4:12b-it-qat@none,otro-modelo@none --repeticiones 3
```

Al final verás algo así por modelo: `gemma4:12b-it-qat@none: 237/237 correctas (100%); estables 79/79; mediana 3.8 s, p90 5.8 s (...)`. Elige el que acierte más con un tiempo aceptable y ponlo en `IA_MODELO`. Para ver solo un grupo: `--grupo registro`, `consulta`, `edicion` o `recurrentes`.

## 6. Arranque automático

```bash
./ops/instalar-servicio.sh
```

Registra el servidor en launchd: arranca al iniciar sesión y se reinicia solo si falla. Sirve la API y la app en el mismo puerto. Los logs quedan en `logs/servidor.log`. Para quitarlo: `./ops/instalar-servicio.sh --quitar`.

La primera vez, macOS pregunta si `bun` puede acceder a la carpeta Documentos (ahí vive el repositorio). Hay que aceptar; mientras la pregunta sigue abierta, el servidor no responde.

Para actualizar a lo último de una rama, con pruebas, compilación de la app y reinicio incluidos:

```bash
./ops/actualizar.sh          # main
./ops/actualizar.sh otra-rama
```

## 7. Acceso desde el iPhone con Tailscale

```bash
brew install tailscale
./ops/instalar-tailscale.sh
```

El script no pide contraseña de administrador: corre `tailscaled` de Homebrew en modo de espacio de usuario como LaunchAgent, te pide iniciar sesión una vez (con la misma cuenta que en el iPhone), nombra la Mac `finanzas` y publica el servidor con `tailscale serve`. Al final muestra una dirección como `https://finanzas.tu-red.ts.net`. Esa dirección solo funciona dentro de tu red de Tailscale; nadie más la ve. Para quitarlo: `./ops/instalar-tailscale.sh --quitar`.

En el iPhone, con Tailscale encendido, abre esa dirección agregando `/salud`: si ves `{"ok":true}`, el iPhone llega a tu Mac. En modo de espacio de usuario la propia Mac no puede abrir esa dirección; se prueba desde el iPhone.

## 8. Que la Mac esté disponible

- Ajustes del Sistema > Batería > Opciones: activa "Evitar el reposo automático con el adaptador de corriente cuando la pantalla esté apagada" y "Activar para acceso a la red".
- Con la tapa cerrada, una MacBook se duerme salvo que tenga monitor externo. Mientras esté dormida, el iPhone guarda tus dictados y los manda después.

## Respaldo

La base es un solo archivo. Mientras llega el respaldo automático (etapa 4), cópialo de vez en cuando:

```bash
sqlite3 apps/server/datos/finanzas.db ".backup '$HOME/Documents/finanzas-respaldo.db'"
```
