# API

Todo va por la misma API: el Atajo, la app (PWA) y el chat. Las rutas bajo `/v1` piden `Authorization: Bearer <token>`, salvo las marcadas como públicas. Los montos de la app viajan en centavos (`...Centavos`, enteros) y en pesos solo al crear o editar (`monto`). Las fechas son `YYYY-MM-DD` en la zona horaria del servidor. Un cuerpo de más de 16 KB recibe 413. Las rutas públicas con código cuentan los códigos equivocados por IP (la de `X-Forwarded-For` que agrega Tailscale): 20 en 10 minutos dan 429 a esa IP, y 200 en total a todos.

## Registro y dispositivos

Cada iPhone o navegador es un dispositivo con su propio token. Se entra de dos formas:

- Con un **código de invitación** de 6 caracteres que dura 24 horas y sirve una sola vez. Es la única forma de crear una cuenta.
- Con **usuario y código personal**, que no vencen. Cada cuenta tiene un usuario (por ejemplo `pedro`, sacado de su nombre al crearla) y, si lo pone en Ajustes, un código de 8 a 64 caracteres que no distingue mayúsculas ni espacios de más. El código se guarda con argon2id y no se puede volver a leer. Además del límite por IP, 10 fallos en 15 minutos con un mismo usuario lo frenan (429), vengan de donde vengan; un usuario que no existe recibe el mismo 401 que un código equivocado.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /v1/invitaciones/:codigo` (pública) | | `{ para: "usuario" \| "dispositivo", nombre? }` (nombre del usuario si es para otro dispositivo). 404 si no existe, 410 si ya se usó o venció |
| `POST /v1/registro` (pública) | `{ codigo, nombre?, dispositivo }` (nombre obligatorio si la invitación es para un usuario nuevo) | 201 `{ token, usuario: { id, nombre }, dispositivo: { id, nombre } }`. 400, 404, 410 o 429 con `{ error }` |
| `POST /v1/entrar` (pública) | `{ usuario, codigo, dispositivo }` | 201 `{ token, usuario: { id, nombre }, dispositivo: { id, nombre } }`, igual que `/v1/registro`. 400 si falta algo, 401 `{ error: "Usuario o código incorrectos." }`, 429 |
| `GET /v1/yo` | | `{ usuario: { id, nombre, usuario, tieneCodigo }, dispositivo: { id, nombre }, dispositivos: [{ id, nombre, creadoEn, ultimoUso, actual }], moneda, zonaHoraria, hoy }` |
| `PATCH /v1/yo` | `{ nombre?, usuario? }`. `nombre`: de 1 a 40 caracteres, con el que lo saludan la voz, la IA y la app. `usuario`: de 3 a 24 caracteres (letras, números, punto, guion o guion bajo; empieza con letra o número); se guarda sin acentos y en minúsculas | `{ usuario: { id, nombre, usuario, tieneCodigo } }`. 400 si no es válido, 409 si otra cuenta ya usa ese usuario |
| `PUT /v1/yo/codigo` | `{ codigo }` (de 8 a 64 caracteres) | `{ ok: true }`. 400 si es corto o muy fácil de adivinar (todos iguales, 12345678, 87654321, 12121212, "contraseña"...), 429 después de 10 cambios en una hora |
| `DELETE /v1/yo/codigo` | | `{ ok: true }`; desde ahí solo se entra con un código de invitación |
| `POST /v1/invitaciones` | `{ para: "usuario" \| "dispositivo" }` | 201 `{ codigo, para, expiraEn }`. 429 después de 5 códigos de cuenta nueva o 20 de dispositivo en 24 horas |
| `DELETE /v1/dispositivos/:id` | | `{ ok: true }` |

Para el primer usuario: `bun run invitar -- --nombre Pedro` crea la cuenta (si no existe) e imprime un código para entrar a ella.

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
| `PATCH /v1/movimientos/:id` | los mismos campos, todos opcionales; `null` (o `""`) en `comercio`, `descripcion`, `cuenta` o `categoria_id` borra ese dato | `MovimientoApp` |
| `DELETE /v1/movimientos/:id` | | `{ ok: true }` |
| `POST /v1/deshacer` | | `{ deshecho, mensaje? }`; revierte el último cambio |
| `GET /v1/tablero?mes=YYYY-MM` | mes actual por omisión | ver abajo |
| `GET /v1/recurrentes` | | `{ recurrentes: [...], total_mensual_gastos, total_mensual_otras_monedas? }`; el total solo suma la moneda base |
| `GET /v1/resumen` | `?periodo=este_mes`, `tipo=gasto\|ingreso` (gasto por omisión), `agrupar=categoria\|subcategoria\|comercio\|dia\|ninguno` | `{ tipo, desde, hasta, total, cantidad, grupos?, otras_monedas? }` con montos en texto |

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
  recurrentesProximos: { id: string; nombre: string; tipo: string; montoCentavos: number; moneda: string; proximoCobro: string; frecuencia: string }[]; // 30 días
  porRevisar: number;
}
```

Solo los movimientos en la moneda base entran en las sumas.

## El Atajo

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /v1/atajo` | `{ servidor }` (la dirección con la que el iPhone llega a la Mac, por ejemplo `location.origin`; tiene que ser este mismo servidor) | 201 `{ url, expiraEn, nombre }`. Crea un dispositivo "Atajo Finanzas" con su propio token (y quita los anteriores que nunca se usaron) y prepara el Atajo firmado. 501 si la Mac no puede firmar |
| `POST /v1/atajo/entrar` (pública) | `{ usuario, codigo, servidor }` | 201 `{ url, expiraEn, nombre }`, igual que `POST /v1/atajo/canjear` pero con usuario y código personal. 400 si falta algo o `servidor` no es este, 401, 429; 501 si la Mac no puede firmar (no queda ningún token) |
| `POST /v1/atajo/canjear` (pública) | `{ codigo, servidor }` con un código de dispositivo de una cuenta | 201 `{ url, expiraEn, nombre }`, igual que `POST /v1/atajo` pero sin token: es el enlace `/instalar?codigo=...`. 400 si el código es de cuenta nueva o `servidor` no es este servidor, 404, 410, 429; 501 si la Mac no puede firmar (el código sigue sirviendo) |
| `GET /atajo/:id.shortcut` (pública, vale 10 minutos y 5 descargas) | | El archivo `Finanzas.shortcut` firmado; el id es aleatorio y solo lo conoce quien pidió el Atajo. 410 después. El enlace sobrevive a un reinicio del servidor: se guarda en la base cifrado con una clave que sale del id, del que solo queda el hash. Un `HEAD` no gasta descargas |
