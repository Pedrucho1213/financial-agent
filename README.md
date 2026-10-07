# Asistente financiero por voz

Le hablas a tu iPhone ("gasté 85 en café", "¿cómo voy este mes?") y una IA que corre en tu Mac registra, corrige y responde sobre tus finanzas. Todo se guarda en una base de datos local.

El plan completo está en el documento de investigación del proyecto. Ya están el servidor con la IA y sus herramientas (etapa 0), el Atajo "Finanzas" para dictar (etapa 1) y la app para ver y editar tus finanzas desde el iPhone (etapa 2, una PWA).

## Qué hay

```
apps/server/          Servidor (Bun + Hono + SQLite con Drizzle + AI SDK)
  src/ai/             Asistente: instrucciones, herramientas y conexión al modelo
  src/finanzas/       Registrar, buscar, editar, eliminar, deshacer, resumir, recurrentes
  src/db/             Esquema de la base y migraciones (drizzle/)
  src/atajo/          Genera y firma el Atajo "Finanzas" para cada iPhone
  eval/               Prueba de frases reales para elegir el modelo
  test/               Pruebas automáticas (sin IA real)
apps/web/             App para el iPhone (PWA: React + Vite), la sirve el mismo servidor
ops/                  Arranque automático en macOS (launchd), Tailscale y actualizar
docs/                 Instalación, API y el Atajo de iPhone
```

## Empezar en tu Mac

```bash
bun install
cp apps/server/.env.example apps/server/.env
ollama pull gemma4:12b-it-qat
bun run web:build
bun run invitar -- --nombre Pedro       # código para entrar desde el iPhone
bun run dev
```

Para probar la API con `curl`, saca un token con `bun run setup -- --nombre Pedro --dispositivo "Pruebas"`:

```bash
curl -s localhost:8787/v1/hablar \
  -H "Authorization: Bearer <tu token>" -H "content-type: application/json" \
  -d '{"texto":"gasté 85 en café","client_id":"prueba-0001"}'
```

Los pasos completos (modelo, Tailscale, arranque automático) están en [docs/instalacion.md](docs/instalacion.md) y el Atajo en [docs/atajo-finanzas.md](docs/atajo-finanzas.md).

## Elegir el modelo

```bash
bun run eval -- --modelos gemma4:12b-it-qat@none,otro-modelo@none --repeticiones 3
```

Corre 79 frases reales contra cada modelo: registros normales y difíciles (modismos, números en palabras, varias cosas en una frase, otras monedas, fechas), charla que no debe registrar nada, consultas, correcciones, conversaciones de varios pasos y recurrentes. Al final manda una ráfaga de 5 dictados a la vez para revisar la cola. Muestra aciertos, cuántas frases pasan en todas las repeticiones, tiempos (mediana, p90, máximo), qué porcentaje de registros alcanza a contestarse antes de que el iPhone deje de esperar y cuánta memoria ocupa el modelo. Lo que va después de `@` es cuánto razona el modelo (`low`, `medium`, `high` o `none`). Los resultados quedan en `apps/server/eval/resultados/`.

Con esta prueba se eligió `gemma4:12b-it-qat` con razonamiento `none`: en una M3 Max acertó las 237 respuestas (79 frases × 3), con mediana de 3.8 s y 7.7 GB de memoria. `gemma4:26b-a4b` fue casi el doble de rápido (2.1 s) pero ocupa unos 21 GB; gpt-oss:20b acertó 78%.

## API

| Ruta | Para qué |
| --- | --- |
| `GET /salud` | Saber si el servidor está vivo (sin token) |
| `POST /v1/hablar` | Registrar o preguntar: `{texto, client_id, conversacion_id?, lat?, lon?, lugar?, capturado_en?, espera_ms?}` |
| `GET /v1/entradas/:client_id?esperar_ms=` | Estado de un dictado y su respuesta cuando termina |
| `POST /v1/despertar` | Cargar el modelo mientras dictas |
| `GET /v1/tablero?mes=2026-10` | Todo lo de la pantalla de inicio de la app |
| `GET /v1/movimientos?periodo=este_mes` | Lista de movimientos, con filtros |

La lista completa (registro con código, editar, deshacer, recurrentes, instalar el Atajo) está en [docs/api.md](docs/api.md). Las rutas `/v1` piden `Authorization: Bearer <token>`, salvo las de entrar con un código. `client_id` lo genera el iPhone: si el mismo dictado llega dos veces, se responde lo mismo sin registrar nada de nuevo. Si la IA no responde, la API devuelve 503 y el Atajo deja el dictado en su cola.

La IA corre en una sola Mac, así que los dictados se procesan de uno en uno y en orden de llegada. Si la IA tarda más de `ESPERA_REGISTRO_MS` (5 s) en un registro o `ESPERA_PREGUNTA_MS` (30 s) en una pregunta, `/v1/hablar` responde 202 con `pendiente: true` y la Mac lo termina sola. Si falla en segundo plano, lo reintenta a los 30 s, 2 min y 10 min, y al reiniciarse retoma lo que quedó a medias.

## Pruebas

```bash
bun run test        # no necesitan Ollama
bun run typecheck   # servidor y app
bun run --cwd apps/web e2e   # la app en un navegador, con la API simulada
```

Las tres corren solas en GitHub en cada PR y en cada cambio a `main` (`.github/workflows/ci.yml`). Para recorrer la app contra un servidor de verdad: `API_REAL=http://127.0.0.1:8787 INVITACION=<código> bun run --cwd apps/web e2e servidor-real`.
