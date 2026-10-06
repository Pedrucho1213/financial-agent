# Asistente financiero por voz

Le hablas a tu iPhone ("gasté 85 en café", "¿cómo voy este mes?") y una IA que corre en tu Mac registra, corrige y responde sobre tus finanzas. Todo se guarda en una base de datos local.

El plan completo está en el documento de investigación del proyecto. Este repositorio va por la **etapa 0**: el servidor, la base de datos, la IA con sus herramientas y la prueba para elegir el modelo.

## Qué hay

```
apps/server/          Servidor (Bun + Hono + SQLite con Drizzle + AI SDK)
  src/ai/             Asistente: instrucciones, herramientas y conexión al modelo
  src/finanzas/       Registrar, buscar, editar, eliminar, deshacer, resumir, recurrentes
  src/db/             Esquema de la base y migraciones (drizzle/)
  eval/               Prueba de 30 frases para elegir el modelo
  test/               Pruebas automáticas (sin IA real)
ops/                  Arranque automático en macOS (launchd)
docs/                 Instalación y el Atajo de iPhone
```

## Empezar en tu Mac

```bash
bun install
cp apps/server/.env.example apps/server/.env
ollama pull gpt-oss:20b
bun run setup -- --nombre Pedro --dispositivo "iPhone"   # imprime el token del iPhone
bun run dev
```

Prueba que responde:

```bash
curl -s localhost:8787/v1/hablar \
  -H "Authorization: Bearer <tu token>" -H "content-type: application/json" \
  -d '{"texto":"gasté 85 en café","client_id":"prueba-0001"}'
```

Los pasos completos (modelo, Tailscale, arranque automático) están en [docs/instalacion.md](docs/instalacion.md) y el Atajo en [docs/atajo-finanzas.md](docs/atajo-finanzas.md).

## Elegir el modelo

```bash
bun run eval -- --modelos gpt-oss:20b,qwen3.6:35b-a3b-nvfp4
```

Corre 30 frases reales (registrar, consultar, editar, recurrentes) contra cada modelo y muestra aciertos y tiempos. Los resultados quedan en `apps/server/eval/resultados/`.

## API

| Ruta | Para qué |
| --- | --- |
| `GET /salud` | Saber si el servidor está vivo (sin token) |
| `POST /v1/hablar` | Registrar o preguntar: `{texto, client_id, conversacion_id?, lat?, lon?, lugar?, capturado_en?}` |
| `POST /v1/despertar` | Cargar el modelo mientras dictas |
| `GET /v1/movimientos?periodo=este_mes` | Lista de movimientos |
| `GET /v1/resumen?periodo=este_mes` | Totales por categoría |

Todas las rutas `/v1` piden `Authorization: Bearer <token>`. `client_id` lo genera el iPhone: si el mismo dictado llega dos veces, se responde lo mismo sin registrar nada de nuevo. Si la IA no responde, la API devuelve 503 y el Atajo deja el dictado en su cola.

## Pruebas

```bash
bun run test        # 33 pruebas, no necesitan Ollama
bun run typecheck
```
