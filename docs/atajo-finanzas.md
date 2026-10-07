# El Atajo "Finanzas"

Un solo Atajo para registrar y preguntar. Le dices lo que sea ("gasté 85 en el Oxxo", "¿cuánto llevo en comida?"), te contesta en voz y se cierra. Solo si te pregunta algo (por ejemplo, el monto que faltó) te sigue escuchando. Ya trae adentro la dirección de tu Mac y su propio token: no hay que escribir nada.

## Instalarlo

Con el enlace que imprime `bun run invitar -- --nombre Pedro --url https://TU-MAC --atajo` (`/instalar?codigo=...`), o desde la app en **Ajustes > Instalar el Atajo en este iPhone**:

1. Toca **Instalar el Atajo** y luego **Descargar**.
2. Abre la descarga desde el botón de descargas de Safari o desde **Archivos > Descargas**.
3. Se abre Atajos con "Finanzas": toca **Agregar atajo**.

Si ya tenías el Atajo, al tocar **Agregar atajo** iOS pregunta "¿Quieres reemplazar tu atajo?": toca **Reemplazar**. Safari no le pasa el archivo a Atajos por su cuenta; por eso el paso 2. El Atajo toma el nombre del archivo: si en Descargas ya quedaba un `Finanzas.shortcut` de otra instalación, Safari guarda el nuevo como `Finanzas 2.shortcut`, el Atajo se llama "Finanzas 2" y Siri no lo encuentra con "Finanzas". Borra antes la descarga vieja o renombra el Atajo. El archivo descargado dura 10 minutos en la Mac; si se vence, vuelve a tocar el botón. El código del enlace sirve una vez y, si la Mac no pudo firmar, sigue sirviendo. Cada instalación crea un dispositivo "Atajo Finanzas" con su token, que puedes quitar desde Ajustes; los que se prepararon en la última media hora y nunca se usaron se quitan solos al preparar uno nuevo.

Necesita iCloud Drive encendido para Atajos (Ajustes > tu nombre > iCloud > iCloud Drive), porque ahí guarda los dictados antes de enviarlos. Sin iCloud Drive se detiene en la primera acción con "La ubicación no existe", antes de escuchar nada.

## La primera vez

Al abrirlo por primera vez te saluda por tu nombre y te pregunta si quieres que te cuente cómo funciona; si dices "sí", te explica en voz cómo registrar, preguntar y corregir. Luego guarda `Finanzas-bienvenida.txt` en iCloud Drive > Atajos para no repetirlo, aunque reinstales el Atajo. Para volver a oír la bienvenida, borra ese archivo.

Lee con la voz que tenga el iPhone para español de México. La más natural es la de Siri: Ajustes > Accesibilidad > Contenido leído > Voces > Español (México) > Siri. Sirve en cualquier iPhone con iOS 17 o más reciente, tenga o no Apple Intelligence. El Atajo no fija una voz porque, si no está descargada en ese iPhone, se quedaría callado.

Córrelo una vez a mano desde la app Atajos para contestar los permisos. Aparecen al llegar a cada paso:

| Te pregunta | Contesta |
|---|---|
| Atajos quiere usar el reconocimiento de voz y el micrófono | **Permitir** |
| "Finanzas" quiere acceder a "Finanzas-cola.txt" o guardarlo (o acceder a archivos de iCloud Drive) | **Permitir siempre** |
| Atajos quiere usar tu ubicación | **Permitir al usar la app** |
| "Finanzas" quiere acceder a tu ubicación | **Permitir siempre** |
| "Finanzas" quiere conectarse a "tu-mac....ts.net" | **Permitir siempre** |

El Atajo nunca borra archivos. Desde iOS 17 el sistema pide confirmar cada borrado de un Atajo, aunque la acción diga que no, y no ofrece "Permitir siempre"; por eso la cola es un solo archivo que se reescribe.

Si contestas "Permitir una vez", te lo vuelve a preguntar la próxima vez. Si contestas "No permitir" a la ubicación o a la conexión, el Atajo se detiene con un error en cada uso. Para arreglarlo: en Atajos, mantén presionado Finanzas > Detalles > Privacidad, y en Ajustes > Privacidad y seguridad > Localización > Atajos.

## Para usarlo

- **Siri**: "Oye Siri, Finanzas".
- **Botón de acción** (iPhone 15 Pro en adelante, incluido el 17 Pro Max): Ajustes > Botón de acción > Atajo > Finanzas.
- **Toque atrás** (cualquier iPhone, incluido el 13): Ajustes > Accesibilidad > Tocar > Toque atrás > Doble toque > Finanzas.

Hablas después del sonido y se detiene solo tras una pausa. Te contesta y el Atajo se cierra. Si su respuesta termina en pregunta, te sigue escuchando: contéstale, o di "no", "listo", "gracias", "es todo" o "adiós" para terminar. Si no dices nada, se cierra (y si fue lo primero, te dice "No te escuché"). Son hasta 10 turnos por vez.

Los montos te los dice en pesos ("50 pesos"): el servidor cambia "$50" antes de mandarlo, porque la voz del iPhone lee el signo "$" como dólares.

No hace falta decirlo todo; la IA usa lo que ya sabe de ti:

- **Monto de siempre**: "ya pagué Netflix" o "me cayó la quincena" sin decir cuánto se anota con el monto de siempre y te dice "como siempre". Cuenta como de siempre un pago fijo que diste de alta, o el mismo monto dos veces seguidas en la quincena, la renta o una suscripción (tres veces en lo demás). Si solo lo pagaste una vez, te pregunta "¿fue de 3,500 pesos, como la vez pasada?" y con un "sí" lo anota.
- **Cuenta de siempre**: si en un lugar las últimas veces pagaste con la misma tarjeta, la pone sola y te dice con cuál.
- **Lo que le pides recordar**: "recuerda que el Oxxo lo pago en efectivo" lo toma en cuenta en cada dictado; "olvida lo del Oxxo" lo borra.
- **Avisos**: si mañana se cobra un pago fijo, te lo dice una vez al terminar lo que le pediste ("Ojo: mañana se cobra Netflix de 219 pesos").

Quien decide si sigue escuchando es el servidor: manda `seguir: true` solo cuando la respuesta pregunta algo (lleva "?", al final o en medio). Las instrucciones de la IA le piden no cerrar con ofrecimientos como "¿algo más?".

## Sin conexión

Cada dictado se agrega primero como una línea de `iCloud Drive/Shortcuts/Finanzas-cola.txt` y solo después se envía. Si el iPhone o la Mac no tienen conexión, el envío falla y el Atajo se detiene con un aviso de error, pero el dictado ya quedó guardado. En el primer turno se guarda incluso antes de pedir la ubicación.

La próxima vez que uses el Atajo con conexión, después de contestarte manda los que quedaron en la cola y la reescribe solo con los que el servidor no recibió. El `client_id` de cada línea evita que se registre dos veces.

Un dictado sale de la cola cuando el servidor lo recibió, aunque no lo haya podido leer. Se queda si el servidor pide reintentar (la IA no respondió o el mensaje se sigue procesando) o si lo que contestó no es del servidor (por ejemplo, la Mac encendida pero sin el servidor corriendo).

Las versiones anteriores del Atajo guardaban en `Finanzas/pendientes/`; si quedó algo ahí, ya no se usa y se puede borrar desde Archivos.

El iPhone espera a la IA como máximo 5 segundos al registrar algo con monto, y 30 al preguntar, dar una orden sin monto ("gasté en el súper") o borrar o cambiar algo ("borra el café de 85"), porque ahí la respuesta puede ser una pregunta. Si la Mac tarda más, contesta "Anotado" y lo termina sola; en las preguntas el Atajo espera la respuesta hasta 45 segundos más.

Para dictar sin internet el iPhone necesita el dictado en el dispositivo para Español (México); si no lo tiene, el dictado mismo falla y no se guarda nada.

## Armarlo a mano

Solo si no puedes instalarlo desde la app. Son las mismas acciones que trae el Atajo instalado, en este orden, menos la bienvenida. Los nombres están como aparecen en iOS en español, con el nombre en inglés entre paréntesis. `TU-MAC` es la dirección de tu Mac (paso 7 de [instalacion.md](instalacion.md)) y `TOKEN` es tu token `fa_...`.

1. **Comentario** (Comment), opcional.
2. **Texto** (Text) vacío. **Establecer variable** (Set Variable) `Conversación`.
3. **Repetir** (Repeat) 10 veces, y dentro:
    1. **Dictar texto** (Dictate Text): idioma Español (México), dejar de escuchar "Después de una pausa".
    2. **Coincidir texto** (Match Text) `\S` en el texto dictado.
    3. **Si** (If) las coincidencias no tienen ningún valor:
        1. **Si** `Ubicación` no tiene ningún valor: **Leer texto** (Speak Text) "No te escuché.", idioma Español (México). Fin del Si.
        2. **Detener este atajo** (Stop This Shortcut).
    4. **De lo contrario** (Otherwise):
        1. **Coincidir texto** con el patrón `PALABRAS_PARA_TERMINAR` de `apps/server/src/atajo/generar.ts` en el texto dictado, sin distinguir mayúsculas. **Si** las coincidencias tienen algún valor: **Detener este atajo**. Fin del Si.
        2. **Fecha** (Date): fecha actual. **Formatear fecha** (Format Date): ISO 8601, con hora. Llámalo `Capturado`.
        3. **Reemplazar texto** (Replace Text): `[^0-9A-Za-z]` por nada en `Capturado`, con expresión regular.
        4. **Número aleatorio** (Random Number) entre 100000 y 999999.
        5. **Texto**: `texto reemplazado`-`Número aleatorio`. **Establecer variable** `ClientID`.
        6. **Obtener archivo** (Get File) `/Finanzas-cola.txt`, sin mostrar el selector y con "Error si no se encuentra" apagado. **Obtener texto de la entrada** (Get Text from Input). Llámalo `Pendientes anteriores`.
        7. **Si** `Ubicación` no tiene ningún valor (solo pasa en el primer turno):
            1. **Diccionario** (Dictionary) con claves de texto `texto` (el texto dictado), `client_id` (`ClientID`), `conversacion_id` (`Conversación`) y `capturado_en` (`Capturado`).
            2. **Reemplazar texto** `[\r\n]+` por un espacio en el Diccionario, con expresión regular: queda el JSON en una línea.
            3. **Texto**: `Pendientes anteriores`, un salto de línea y ese JSON. **Establecer nombre** (Set Name): `Finanzas-cola.txt`. **Guardar archivo** (Save File): sin preguntar dónde, ruta `/Finanzas-cola.txt`, reemplazar si existe.
            4. **Obtener ubicación actual** (Get Current Location). **Establecer variable** `Ubicación`.
            5. **Obtener detalles de ubicaciones** (Get Details of Locations) Latitud de `Ubicación`, **Establecer variable** `Latitud`; lo mismo con Longitud (`Longitud`) y Nombre (`Lugar`).
        8. Fin del Si.
        9. **Diccionario** con las claves del paso 7.1 más `lat` (`Latitud`), `lon` (`Longitud`) y `lugar` (`Lugar`). **Reemplazar texto** como en 7.2; llámalo `JSON`. Guárdalo en la cola como en 7.3.
        10. **Establecer nombre** `dictado.json` a `JSON`. **Obtener contenido de URL** (Get Contents of URL): `https://TU-MAC/v1/hablar`, método POST, encabezados `Authorization` = `Bearer TOKEN` y `Content-Type` = `application/json`, cuerpo **Archivo** = ese archivo. Llámalo `Contestación`.
        11. **Obtener valor del diccionario** (Get Dictionary Value) `conversacion_id` de `Contestación`. **Si** tiene algún valor: **Establecer variable** `Conversación`. Fin del Si.
        12. **Texto** "No entendí lo que contestó el servidor." **Establecer variable** `Respuesta`. **Obtener valor del diccionario** `respuesta` de `Contestación`. **Si** tiene algún valor: **Establecer variable** `Respuesta`. Fin del Si.
        13. **Obtener valor del diccionario** `seguir` de `Contestación`. **Establecer variable** `Seguir`.
        14. **Obtener valor del diccionario** `esperar` de `Contestación`. **Si** tiene algún valor:
            1. **Obtener contenido de URL**: `https://TU-MAC/v1/entradas/ClientID?esperar_ms=45000`, método GET, encabezado `Authorization` = `Bearer TOKEN`.
            2. **Obtener valor del diccionario** `respuesta`. **Si** tiene algún valor: **Establecer variable** `Respuesta`. Fin del Si.
            3. **Obtener valor del diccionario** `seguir`. **Establecer variable** `Seguir`.
        15. Fin del Si.
        16. **Leer texto** `Respuesta`, idioma Español (México).
        17. **Obtener valor del diccionario** `reintentar` de `Contestación`. **Si** no tiene ningún valor, y dentro **Obtener valor del diccionario**: todas las claves de `Contestación`. **Si** tiene algún valor:
            1. **Texto** vacío. **Establecer variable** `Quedan`.
            2. **Dividir texto** (Split Text) `Pendientes anteriores` por saltos de línea.
            3. **Repetir con cada** (Repeat with Each) elemento:
                1. **Establecer variable** `Línea` con el elemento repetido.
                2. **Coincidir texto** `\S` en `Línea`. **Si** tiene algún valor:
                    1. **Establecer nombre** `dictado.json` a `Línea`. **Obtener contenido de URL**: POST a `https://TU-MAC/v1/hablar`, mismos encabezados, cuerpo **Archivo** = ese archivo.
                    2. Los mismos dos **Si** de este paso sobre esa contestación, vacíos, y en los dos **De lo contrario**: **Agregar a variable** (Add to Variable) `Quedan` con `Línea`.
                3. Fin del Si.
            4. Fin del Repetir.
            5. **Combinar texto** (Combine Text) `Quedan` con saltos de línea. **Texto**: ese resultado y un salto de línea. **Establecer nombre** y **Guardar archivo** como en 7.3.
        18. Fin de los dos Si.
        19. **Si** `Seguir` no tiene ningún valor: **Detener este atajo**. Fin del Si.
    5. Fin del Si.
4. Fin del Repetir.

## Más adelante

- En el iPhone 17 Pro Max se puede agregar la acción **Usar modelo** (Apple Intelligence, en el dispositivo) para entender el dictado sin conexión. En el iPhone 13 no existe, así que es opcional.
- Si el primer dictado después de un rato se siente lento (15 a 18 s), es el modelo cargándose. El Atajo no lo despierta al abrirse a propósito: en Atajos una petición que falla detiene todo, y sin conexión o con la Mac dormida se perdería el dictado antes de escucharlo. Para que tarde menos, se puede subir `OLLAMA_KEEP_ALIVE` en el servicio de Ollama a costa de más memoria ocupada.
