# API

Todo va por la misma API: el Atajo, la app (PWA) y el chat. Las rutas bajo `/v1` piden `Authorization: Bearer <token>`, salvo las marcadas como públicas. Los montos de la app viajan en centavos (`...Centavos`, enteros) y en pesos solo al crear o editar (`monto`). Las fechas son `YYYY-MM-DD` en la zona horaria del servidor.

## Registro y dispositivos

Cada iPhone o navegador es un dispositivo con su propio token. Se entra con un código de invitación de 6 caracteres que dura 24 horas y sirve una sola vez.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /v1/invitaciones/:codigo` (pública) | | `{ para: "usuario" \| "dispositivo", nombre? }` (nombre del usuario si es para otro dispositivo). 404 si no existe, 410 si ya se usó o venció |
| `POST /v1/registro` (pública) | `{ codigo, nombre?, dispositivo }` (nombre obligatorio si la invitación es para un usuario nuevo) | 201 `{ token, usuario: { id, nombre }, dispositivo: { id, nombre } }`. 400, 404, 410 o 429 con `{ error }` |
| `GET /v1/yo` | | `{ usuario: { id, nombre }, dispositivo: { id, nombre }, dispositivos: [{ id, nombre, creadoEn, ultimoUso, actual }], moneda, zonaHoraria, hoy }` |
| `POST /v1/invitaciones` | `{ para: "usuario" \| "dispositivo" }` | 201 `{ codigo, para, expiraEn }` |
| `DELETE /v1/dispositivos/:id` | | `{ ok: true }` |

Para el primer usuario: `bun run invitar -- --nombre Pedro` imprime un código.

## Hablar (Atajo y chat)

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /v1/hablar` | `{ texto, client_id, conversacion_id?, lat?, lon?, lugar?, capturado_en?, espera_ms? }` | 200 `{ respuesta, conversacion_id, acciones, duplicado? }`; 202 con `pendiente: true` (y `esperar: true` si era pregunta) cuando la IA tarda más que la espera |
| `GET /v1/entradas/:client_id?esperar_ms=` | | `{ estado: "procesando" \| "listo" \| "error", respuesta?, ... }` |
| `POST /v1/despertar` | | `{ ok: true }`; precarga el modelo |

## Movimientos y tablero

`MovimientoApp`:

```ts
{
  id: string; fecha: string; ocurridoEn: string;
  tipo: "gasto" | "ingreso" | "transferencia" | "pago_tarjeta";
  montoCentavos: number; monto: string; moneda: string;
  categoriaId: string | null; categoria: string | null; // "Comida > Café"
  comercio: string | null; descripcion: string | null; cuenta: string | null;
  lugar: string | null; lat: number | null; lon: number | null;
  origen: "voz" | "app" | "apple_pay" | "importacion";
  textoOriginal: string | null; revisar: boolean;
}
```

| Método y ruta | Cuerpo o parámetros | Respuesta |
|---|---|---|
| `GET /v1/categorias` | | `{ categorias: [{ id, nombre, nombreCompleto, padreId, tipo, naturaleza }] }` |
| `GET /v1/movimientos` | `?desde&hasta` o `?periodo=este_mes`, `tipo`, `categoria_id` (incluye hijas), `texto`, `revisar=1`, `limite` (hasta 500, 100 por omisión), `offset` | `{ total, movimientos: MovimientoApp[] }`, del más reciente al más antiguo |
| `POST /v1/movimientos` | `{ tipo, monto, moneda?, categoria_id?, comercio?, descripcion?, cuenta?, fecha? }` | 201 `MovimientoApp` (origen `app`) |
| `PATCH /v1/movimientos/:id` | los mismos campos, todos opcionales | `MovimientoApp` |
| `DELETE /v1/movimientos/:id` | | `{ ok: true }` |
| `POST /v1/deshacer` | | `{ deshecho, mensaje? }`; revierte el último cambio |
| `GET /v1/tablero?mes=YYYY-MM` | mes actual por omisión | ver abajo |
| `GET /v1/recurrentes` | | `{ recurrentes: [...], total_mensual_gastos }` |

`GET /v1/tablero`:

```ts
{
  mes: "2026-10"; hoy: "2026-10-06"; moneda: "MXN";
  totales: {
    gastadoCentavos: number; ingresadoCentavos: number; balanceCentavos: number;
    gastadoHoyCentavos: number; cantidadGastos: number;
    gastadoMesAnteriorCentavos: number;
    gastadoMesAnteriorMismaFechaCentavos: number; // del 1 al mismo día del mes anterior
  };
  porCategoria: { categoriaId: string | null; nombre: string; centavos: number; cantidad: number }[]; // gastos del mes, categoría principal
  porMes: { mes: string; gastadoCentavos: number; ingresadoCentavos: number }[]; // 6 meses, el último es el pedido
  porDiaSemana: { dia: number; centavos: number }[]; // 1 = lunes ... 7 = domingo, gastos del mes
  mayores: MovimientoApp[]; // 5 gastos más grandes del mes
  frecuentes: { nombre: string; cantidad: number; centavos: number }[]; // comercios más repetidos del mes
  recurrentesProximos: { id: string; nombre: string; montoCentavos: number; moneda: string; proximoCobro: string; frecuencia: string }[]; // 30 días
  porRevisar: number;
}
```

Solo los movimientos en la moneda base entran en las sumas.

## El Atajo

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /v1/atajo` | `{ servidor }` (la dirección con la que el iPhone llega a la Mac, por ejemplo `location.origin`) | 201 `{ url, expiraEn }`. Crea un dispositivo "Atajo" con su propio token y prepara el Atajo firmado. 501 si la Mac no puede firmar |
| `GET /atajo/:id.shortcut` (pública, una sola vez, 10 minutos) | | El archivo `Finanzas.shortcut` firmado |
