# API

Todo va por la misma API: el Atajo, la app (PWA) y el chat. Las rutas bajo `/v1` piden `Authorization: Bearer <token>`, salvo las marcadas como públicas. Los montos de la app viajan en centavos (`...Centavos`, enteros) y en pesos solo al crear o editar (`monto`). Las fechas son `YYYY-MM-DD` en la zona horaria del servidor. Un cuerpo de más de 16 KB recibe 413. Las rutas públicas con código cuentan los códigos equivocados por IP (la de `X-Forwarded-For` que agrega Tailscale): 20 en 10 minutos dan 429 a esa IP, y 200 en total a todos.

## Registro y dispositivos

Cada iPhone o navegador es un dispositivo con su propio token. Se entra con un código de invitación de 6 caracteres que dura 24 horas y sirve una sola vez.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /v1/invitaciones/:codigo` (pública) | | `{ para: "usuario" \| "dispositivo", nombre? }` (nombre del usuario si es para otro dispositivo). 404 si no existe, 410 si ya se usó o venció |
| `POST /v1/registro` (pública) | `{ codigo, nombre?, dispositivo }` (nombre obligatorio si la invitación es para un usuario nuevo) | 201 `{ token, usuario: { id, nombre }, dispositivo: { id, nombre } }`. 400, 404, 410 o 429 con `{ error }` |
| `GET /v1/yo` | | `{ usuario: { id, nombre }, dispositivo: { id, nombre }, dispositivos: [{ id, nombre, creadoEn, ultimoUso, actual }], moneda, zonaHoraria, hoy }` |
| `POST /v1/invitaciones` | `{ para: "usuario" \| "dispositivo" }` | 201 `{ codigo, para, expiraEn }`. 429 después de 5 códigos de cuenta nueva o 20 de dispositivo en 24 horas |
| `DELETE /v1/dispositivos/:id` | | `{ ok: true }` |

Para el primer usuario: `bun run invitar -- --nombre Pedro` crea la cuenta (si no existe) e imprime un código para entrar a ella.

## Hablar (Atajo y chat)

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /v1/hablar` | `{ texto, client_id, conversacion_id?, lat?, lon?, lugar?, capturado_en?, equipo?, espera_ms? }` (`equipo`: el modelo del dispositivo, "iPhone" o "Apple Watch"; también se reconoce el reloj por el User-Agent) | 200 `{ respuesta, conversacion_id, acciones, duplicado? }`; 202 con `pendiente: true` (y `esperar: true` si era pregunta) cuando la IA tarda más que la espera |
| `GET /v1/entradas/:client_id?esperar_ms=` | | `{ estado: "procesando" \| "listo" \| "error", respuesta?, ... }` |
| `POST /v1/despertar` | | `{ ok: true }`; precarga el modelo |
| `POST /v1/hablar` con `origen: "apple_pay"` | `{ origen, client_id, monto?, comercio?, nombre?, tarjeta?, lat?, lon?, capturado_en? }` (lo que da la Cartera; `monto` como texto, "$85.00") | 202 `{ pendiente: true, ... }`: se registra en segundo plano como "Pagué 85 pesos en ... (Apple Pay)" con `origen: "apple_pay"`. Sin ningún dato es la prueba del Atajo corrido a mano: 200 `{ prueba: true, respuesta }` y una notificación de prueba. Va por `/v1/hablar` para que la cola del Atajo "Finanzas" también lo reenvíe |

Quién no manda `espera_ms` es el Atajo. Para él:

- **Respuesta rápida**: si la cuenta tiene notificaciones activas, un registro con monto (no una pregunta, una orden sin monto ni un borrado o cambio, y no desde el Apple Watch, donde la notificación no llega sin el iPhone cerca) no espera a la IA: contesta 202 `{ respuesta: "Anotado.", pendiente: true }` y lo anotado llega por notificación.
- **Aviso del día**: la primera respuesta que oye lleva al final el aviso más importante pendiente ("Por cierto: ..."), una sola vez. No va detrás de una pregunta, de una espera ni de un `dato`.
- **Pregunta por notificación**: si la IA terminó en segundo plano con una pregunta, la notificación la dice y el siguiente dictado sin `conversacion_id` en los 10 minutos siguientes sigue esa conversación.

Todo dictado que se termina sin que nadie lo espere (el iPhone ya no esperó y nadie consulta `/v1/entradas` en ese momento) llega como notificación a quien las tenga activas: lo que se anotó (al tocarla abre `/#movimientos?detalle=<id>[,<id>...]`, con `&editar=1` si fue un pago con Apple Pay), la pregunta que quedó o que no se pudo procesar.

## Notificaciones

Web Push a la app instalada en la pantalla de inicio (iOS 16.4 o más reciente; también llegan al Apple Watch). El servidor cifra cada mensaje (RFC 8291) y lo firma con sus llaves VAPID, que crea la primera vez y guarda en la base (tabla `configuracion`). Solo manda a servicios de push de Apple, Google, Mozilla y Microsoft.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /v1/push` | | `{ clave, activo, endpoint, otros, ultimoError }`: la llave pública VAPID (base64url) para `pushManager.subscribe`, si este dispositivo está suscrito y cuántos otros de la cuenta lo están |
| `POST /v1/push/suscripcion` | `{ endpoint, keys: { p256dh, auth }, origen? }` (`PushSubscription.toJSON()` y `location.origin`, que se le da a Apple como contacto si es este servidor por https; `PUSH_CONTACTO` lo reemplaza) | 201 con el estado. Una suscripción por dispositivo; 400 si el servicio no está permitido |
| `DELETE /v1/push/suscripcion` | | `{ ok: true }` |
| `POST /v1/push/prueba` | | `{ enviadas }`; 502 si no llegó a ningún dispositivo |

El mensaje que recibe el service worker (`public/sw-push.js`) es `{ titulo, cuerpo, url, etiqueta? }`. Una suscripción que el servicio da por vencida (404 o 410) se borra; la de un dispositivo revocado ya no recibe.

## Avisos del día

Los avisos del revisor nocturno (ver "Avisos (revisor nocturno)") se entregan de dos formas, cada uno una sola vez: el Atajo dice el más importante de ayer u hoy al final de su primera respuesta (`dicho_en`), y entre las 9:00 y las 21:00 locales sale por notificación el más importante de los no enviados con cuántos más hay (`enviado_en`); al tocarla abre su `enlace`. Lo que ya se dijo, se leyó o se descartó no sale por notificación.

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
| `POST /v1/atajo` | `{ servidor, tipo? }` (la dirección con la que el iPhone llega a la Mac, por ejemplo `location.origin`; tiene que ser este mismo servidor. `tipo`: `"finanzas"` por omisión o `"apple_pay"`) | 201 `{ url, expiraEn, nombre, tipo }`. Crea un dispositivo "Atajo Finanzas" (o "Atajo Apple Pay") con su propio token (y quita los anteriores del mismo tipo que nunca se usaron) y prepara el Atajo firmado. 501 si la Mac no puede firmar |
| `GET /v1/atajo/bienvenida` | | `{ saludo, explicacion, sinExplicacion, cierre }` con el nombre que tenga la cuenta: el Atajo lo pide la primera vez, así cambiar el nombre no obliga a reinstalarlo |
| `POST /v1/atajo/canjear` (pública) | `{ codigo, servidor }` con un código de dispositivo de una cuenta | 201 `{ url, expiraEn, nombre }`, igual que `POST /v1/atajo` pero sin token: es el enlace `/instalar?codigo=...`. 400 si el código es de cuenta nueva o `servidor` no es este servidor, 404, 410, 429; 501 si la Mac no puede firmar (el código sigue sirviendo) |
| `GET /atajo/:id.shortcut` (pública, vale 10 minutos y 5 descargas) | | El archivo `Finanzas.shortcut` (o `Finanzas Apple Pay.shortcut`, con el enlace `/atajo/:id.applepay.shortcut`) firmado; el id es aleatorio y solo lo conoce quien pidió el Atajo. 410 después. El enlace sobrevive a un reinicio del servidor: se guarda en la base cifrado con una clave que sale del id, del que solo queda el hash. Un `HEAD` no gasta descargas |

## Presupuestos, metas, préstamos y meses sin intereses

Montos en centavos. Todo se puede hacer también por voz (`/v1/hablar`), y lo que se hace por voz se puede deshacer.

| Método y ruta | Cuerpo o parámetros | Respuesta |
|---|---|---|
| `GET /v1/presupuestos?mes=YYYY-MM` | mes actual por omisión | `{ mes, hoy, diasDelMes, diaDelMes, presupuestos: Presupuesto[], total: { limiteCentavos, gastadoCentavos } }`; el general va primero y luego del más apretado al más holgado |
| `PUT /v1/presupuestos` | `{ categoria_id, limite }` (`categoria_id` null u omitido = presupuesto general del mes) | `Presupuesto`; crea o cambia, uno por categoría |
| `DELETE /v1/presupuestos/:id` | | `{ ok: true }` |
| `GET /v1/metas` | | `{ metas: Meta[] }` |
| `POST /v1/metas` | `{ nombre, objetivo, ahorrado?, fecha_limite? }` (AAAA-MM-DD; una fecha pasada se mueve al año siguiente) | 201 `Meta` |
| `PATCH /v1/metas/:id` | `{ nombre?, objetivo?, fecha_limite? }` (`null` quita la fecha) | `Meta` |
| `POST /v1/metas/:id/aportes` | `{ monto }` (negativo = retiro; no puede quedar debajo de cero) | `Meta` |
| `DELETE /v1/metas/:id` | | `{ ok: true }` |
| `GET /v1/prestamos?todos=1` | sin `todos`, solo los pendientes | `{ prestamos: Prestamo[], meDebenCentavos, deboCentavos }` |
| `GET /v1/msi?todas=1` | sin `todas`, solo las que tienen cargos por venir | `{ compras: CompraMsi[], mensualCentavos }` |
| `GET /v1/disponible` | | ver abajo ("¿cuánto puedo gastar hoy?") |

```ts
type Presupuesto = {
  id: string;
  categoriaId: string | null; // null = general (todo lo que se gasta en el mes)
  categoria: string; // "General", "Comida" o "Comida > Café"; una principal incluye sus subcategorías
  limiteCentavos: number; gastadoCentavos: number; restanteCentavos: number; // restante puede ser negativo
  porcentaje: number; // entero, puede pasar de 100
  proyeccionCentavos: number; // al ritmo actual, cuánto habrá gastado al cerrar el mes
  estado: "bien" | "cerca" | "excedido"; // cerca desde 80%, excedido arriba de 100%
};
type Meta = {
  id: string; nombre: string; objetivoCentavos: number; ahorradoCentavos: number;
  porcentaje: number; // 0 a 100
  fechaLimite: string | null;
  mensualSugeridoCentavos: number | null; // cuánto apartar al mes para llegar a tiempo
  completada: boolean;
};
type Prestamo = {
  id: string; persona: string; direccion: "me_deben" | "debo";
  montoCentavos: number; pagadoCentavos: number; pendienteCentavos: number;
  descripcion: string | null; creadoEn: string; saldadoEn: string | null;
};
type CompraMsi = {
  id: string; descripcion: string; totalCentavos: number; meses: number; mensualidadCentavos: number;
  primerCargo: string; pagadas: number; restanteCentavos: number; proximoCargo: string | null; cuenta: string | null;
};
```

Cada mensualidad de una compra a meses queda como un gasto (`origen: "importacion"`, descripción "Pantalla (3 de 12 MSI)") el día que toca: la primera al registrar la compra y las demás con el revisor diario. Así el mes muestra lo que de verdad sale de la cartera y no el total de la compra.

`GET /v1/disponible`:

```ts
{
  hoy: string; diasRestantes: number; // del mes, hoy incluido
  porDiaCentavos: number; // lo que toca por día, en pesos enteros
  disponibleHoyCentavos: number; // porDia menos lo gastado hoy (puede ser negativo)
  libreMesCentavos: number; // ingresos - gastado - comprometido
  base: "ingresos" | "presupuestos" | null; // null: no hay ingresos ni presupuestos para calcularlo
  ingresosCentavos: number; // lo registrado este mes o lo esperado de los ingresos fijos, lo que sea mayor
  gastadoCentavos: number; gastadoHoyCentavos: number;
  comprometidoCentavos: number; // pagos fijos y mensualidades que faltan este mes (0 si la base son presupuestos por categoría)
}
```

## Avisos (revisor nocturno)

Una vez al día, desde las 3:00 hora local y cuando nadie ha dictado en los últimos 10 minutos (o en cuanto la Mac despierta, si estaba dormida), el servidor revisa las finanzas de cada usuario y guarda avisos: gastos hormiga, suscripciones olvidadas o repetidas, cobros y mensualidades de hoy a pasado mañana, presupuestos rebasados o en riesgo, gastos fuera de lo normal, metas por vencer y préstamos viejos. Es solo SQL y reglas: no usa el modelo de IA. El mismo hallazgo no se guarda dos veces.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /v1/avisos?todos=1` | sin `todos`, solo los no leídos | `{ avisos: Aviso[] }` de los últimos 7 días, vigentes y sin descartar |
| `POST /v1/avisos/:id/leido` | | `Aviso` |
| `POST /v1/avisos/:id/descartar` | | `{ ok: true }` |
| `POST /v1/avisos/revisar` | | `{ nuevos, mensualidades }`; corre el revisor ya para este usuario |

```ts
type Aviso = {
  id: string;
  tipo: "hormiga" | "suscripcion_olvidada" | "suscripcion_duplicada" | "cobro_proximo" | "presupuesto" | "meta" | "msi" | "prestamo" | "gasto_inusual";
  titulo: string; // corto, para el título de una notificación
  texto: string; // una o dos frases con montos "$85"; para voz, pasarlo por montosParaVoz
  // Los de cobros dicen el día exacto ("El viernes 9 se cobra Netflix…"); al leerlos ese día o la víspera ya llegan como "Hoy…" o "Mañana…".
  fecha: string; vence: string | null; // después de vence ya no aplica
  prioridad: 1 | 2 | 3; // 1 alta
  enlace: string | null; // pantalla de la app: "#movimientos?texto=Starbucks", "#presupuestos", "#metas", "#inicio", "#ajustes"
  creadoEn: string; enviadoEn: string | null; dichoEn: string | null; leidoEn: string | null;
};
```

En el servidor (`src/finanzas/avisos.ts`): `avisosPorEnviar(db, zonaHoraria)` da los avisos de todos los usuarios de las últimas 24 horas que nadie ha visto, enviado, oído ni descartado, y `marcarEnviados(db, ids)` los da por enviados; `avisoDelDia(ctx)` da el aviso más importante de ayer u hoy que todavía no se dijo, con `marcar()` para darlo por dicho. Un cobro del que la voz ya avisó al registrar algo ("Ojo: mañana se cobra Netflix") queda como dicho y no se repite.

Al registrar un gasto que cruza el 80% o el 100% de un presupuesto, `/v1/hablar` lo agrega a la respuesta ("Vas en 82% de tu presupuesto de Comida.") y lo repite aparte en `dato`.
