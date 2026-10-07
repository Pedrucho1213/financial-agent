# El Atajo "Finanzas"

Un solo Atajo para registrar y preguntar. Le dices lo que sea ("gasté 85 en el Oxxo", "¿cuánto llevo en comida?"), te contesta en voz y sigue escuchando hasta que digas "listo". Ya trae adentro la dirección de tu Mac y su propio token: no hay que escribir nada.

## Instalarlo

Con el enlace que imprime `bun run invitar -- --nombre Pedro --url https://TU-MAC --atajo` (`/instalar?codigo=...`), o desde la app en **Ajustes > Instalar el Atajo en este iPhone**:

1. Toca **Instalar el Atajo** y luego **Descargar**.
2. Abre la descarga desde el botón de descargas de Safari o desde **Archivos > Descargas**.
3. Se abre Atajos con "Finanzas": toca **Agregar atajo**.

Safari no le pasa el archivo a Atajos por su cuenta; por eso el paso 2. El Atajo toma el nombre del archivo: si en Descargas ya quedaba un `Finanzas.shortcut` de otra instalación, Safari guarda el nuevo como `Finanzas 2.shortcut`, el Atajo se llama "Finanzas 2" y Siri no lo encuentra con "Finanzas". Borra antes la descarga vieja o renombra el Atajo. El archivo descargado dura 10 minutos en la Mac; si se vence, vuelve a tocar el botón. El código del enlace sirve una vez y, si la Mac no pudo firmar, sigue sirviendo. Cada instalación crea un dispositivo "Atajo Finanzas" con su token, que puedes quitar desde Ajustes; los que se prepararon en la última media hora y nunca se usaron se quitan solos al preparar uno nuevo.

Necesita iCloud Drive encendido para Atajos (Ajustes > tu nombre > iCloud > iCloud Drive), porque ahí guarda los dictados antes de enviarlos. Sin iCloud Drive se detiene en la primera acción con "La ubicación no existe", antes de escuchar nada.

## La primera vez

Al abrirlo por primera vez te saluda por tu nombre y te pregunta si quieres que te cuente cómo funciona; si dices "sí", te explica en voz cómo registrar, preguntar y corregir. Luego guarda `Finanzas-bienvenida.txt` en iCloud Drive > Atajos para no repetirlo, aunque reinstales el Atajo. Para volver a oír la bienvenida, borra ese archivo.

Lee con la voz que tenga el iPhone para español de México. La más natural es la de Siri: Ajustes > Accesibilidad > Contenido leído > Voces > Español (México) > Siri. Sirve en cualquier iPhone con iOS 17 o más reciente, tenga o no Apple Intelligence. El Atajo no fija una voz porque, si no está descargada en ese iPhone, se quedaría callado.

Córrelo una vez a mano desde la app Atajos para contestar los permisos. Aparecen al llegar a cada paso:

| Te pregunta | Contesta |
|---|---|
| Atajos quiere usar el reconocimiento de voz y el micrófono | **Permitir** |
| "Finanzas" quiere guardar en la carpeta "pendientes" (o acceder a archivos de iCloud Drive) | **Permitir siempre** |
| Atajos quiere usar tu ubicación | **Permitir al usar la app** |
| "Finanzas" quiere acceder a tu ubicación | **Permitir siempre** |
| "Finanzas" quiere conectarse a "tu-mac....ts.net" | **Permitir siempre** |
| ¿Permitir que "Finanzas" elimine 1 archivo? | **Eliminar** (ver abajo para que no vuelva a salir) |

El de eliminar no trae "Permitir siempre": desde iOS 17 el sistema pregunta cada vez que un Atajo borra un archivo, aunque la acción tenga "Confirmar antes de eliminar" apagado. El Atajo borra cada dictado en cuanto el servidor lo recibe, así que saldría en cada uso. Para quitarlo de una vez: **Ajustes > Apps > Atajos > Avanzado > Permitir eliminar sin confirmación**. La pantalla de instalación lo recuerda debajo de los pasos.

Si contestas "Permitir una vez", te lo vuelve a preguntar la próxima vez. Si contestas "No permitir" a la ubicación o a la conexión, el Atajo se detiene con un error en cada uso. Para arreglarlo: en Atajos, mantén presionado Finanzas > Detalles > Privacidad, y en Ajustes > Privacidad y seguridad > Localización > Atajos.

## Para usarlo

- **Siri**: "Oye Siri, Finanzas".
- **Botón de acción** (iPhone 15 Pro en adelante, incluido el 17 Pro Max): Ajustes > Botón de acción > Atajo > Finanzas.
- **Toque atrás** (cualquier iPhone, incluido el 13): Ajustes > Accesibilidad > Tocar > Toque atrás > Doble toque > Finanzas.

Hablas después del sonido y se detiene solo tras una pausa. Para terminar di "listo", "es todo", "gracias", "ya", "no" o "nada". Si no oye nada te dice "No te escuché" y escucha otra vez; a la segunda se cierra. Son hasta 10 turnos por vez.

## Sin conexión

Cada dictado se guarda primero como archivo en `iCloud Drive/Shortcuts/Finanzas/pendientes/` y solo después se envía. Si el iPhone o la Mac no tienen conexión, el envío falla y el Atajo se detiene con un aviso de error, pero el dictado ya quedó guardado. En el primer turno se guarda incluso antes de pedir la ubicación.

La próxima vez que uses el Atajo con conexión, después de contestarte manda los que quedaron pendientes. El `client_id` de cada archivo evita que se registre dos veces.

Un archivo se borra cuando el servidor lo recibió, aunque no lo haya podido leer. Se queda en la cola si el servidor pide reintentar (la IA no respondió o el mensaje se sigue procesando) o si lo que contestó no es del servidor (por ejemplo, la Mac encendida pero sin el servidor corriendo).

El iPhone espera a la IA como máximo 5 segundos al registrar y 30 al preguntar. Si la Mac tarda más, contesta "Anotado" y lo termina sola; en las preguntas el Atajo espera la respuesta hasta 45 segundos más.

Para dictar sin internet el iPhone necesita el dictado en el dispositivo para Español (México); si no lo tiene, el dictado mismo falla y no se guarda nada.

## Armarlo a mano

Solo si no puedes instalarlo desde la app. Son las mismas acciones que trae el Atajo instalado, en este orden. Los nombres están como aparecen en iOS en español, con el nombre en inglés entre paréntesis. `TU-MAC` es la dirección de Tailscale de tu Mac (paso 7 de [instalacion.md](instalacion.md)) y `TOKEN` es tu token `fa_...`.

1. **Comentario** (Comment), opcional.
2. **Texto** (Text) vacío. **Establecer variable** (Set Variable) `Conversación`.
3. **Repetir** (Repeat) 10 veces, y dentro:
    1. **Dictar texto** (Dictate Text): idioma Español (México), dejar de escuchar "Después de una pausa".
    2. **Coincidir texto** (Match Text) `\S` en el texto dictado.
    3. **Si** (If) las coincidencias no tienen ningún valor:
        1. **Si** `Silencio` tiene algún valor: **Detener este atajo** (Stop This Shortcut). Fin del Si.
        2. **Texto** `sí`. **Establecer variable** `Silencio`.
        3. **Leer texto** (Speak Text) "No te escuché. ¿Me lo repites?", idioma Español (México).
    4. **De lo contrario** (Otherwise):
        1. **Coincidir texto** `^\s*¡?\s*(no|nada|listo|ya|es todo|gracias)\s*[.!]?\s*$` en el texto dictado, sin distinguir mayúsculas.
        2. **Si** las coincidencias tienen algún valor: **Detener este atajo**. Fin del Si.
        3. **Fecha** (Date): fecha actual. **Formatear fecha** (Format Date): ISO 8601, con hora. Llámalo `Capturado`.
        4. **Reemplazar texto** (Replace Text): `[^0-9A-Za-z]` por nada en `Capturado`, con expresión regular.
        5. **Número aleatorio** (Random Number) entre 100000 y 999999.
        6. **Texto**: `texto reemplazado`-`Número aleatorio`. **Establecer variable** `ClientID`.
        7. **Si** `Ubicación` no tiene ningún valor (solo pasa en el primer turno):
            1. **Diccionario** (Dictionary) con claves de texto `texto` (el texto dictado), `client_id` (`ClientID`), `conversacion_id` (`Conversación`) y `capturado_en` (`Capturado`).
            2. **Texto** con el Diccionario adentro (así queda en JSON). **Establecer nombre** (Set Name): `ClientID`.json.
            3. **Guardar archivo** (Save File): sin preguntar dónde, ruta `/Finanzas/pendientes/ClientID.json`, reemplazar si existe.
            4. **Obtener ubicación actual** (Get Current Location). **Establecer variable** `Ubicación`.
            5. **Obtener detalles de ubicaciones** (Get Details of Locations) Latitud de `Ubicación`, **Establecer variable** `Latitud`; lo mismo con Longitud (`Longitud`) y Nombre (`Lugar`).
        8. Fin del Si.
        9. **Diccionario** con las claves del paso 7.1 más `lat` (`Latitud`), `lon` (`Longitud`) y `lugar` (`Lugar`).
        10. **Texto** con ese Diccionario, **Establecer nombre** y **Guardar archivo** igual que en 7.2 y 7.3. Llámalo `Pendiente`.
        11. **Obtener contenido de URL** (Get Contents of URL): `https://TU-MAC/v1/hablar`, método POST, encabezados `Authorization` = `Bearer TOKEN` y `Content-Type` = `application/json`, cuerpo **Archivo** = `Pendiente`. Llámalo `Contestación`.
        12. **Obtener valor del diccionario** (Get Dictionary Value) `conversacion_id` de `Contestación`. **Si** tiene algún valor: **Establecer variable** `Conversación`. Fin del Si.
        13. **Obtener valor del diccionario** `reintentar` de `Contestación`. **Si** no tiene ningún valor:
            1. **Obtener valor del diccionario**: todas las claves de `Contestación`. **Si** tiene algún valor:
                1. **Eliminar archivos** (Delete Files) `Pendiente`, con "Confirmar antes de eliminar" apagado.
                2. **Texto** `sí`. **Establecer variable** `En línea`.
            2. Fin del Si.
        14. Fin del Si.
        15. **Texto** "No entendí lo que contestó el servidor." **Establecer variable** `Respuesta`.
        16. **Obtener valor del diccionario** `respuesta` de `Contestación`. **Si** tiene algún valor: **Establecer variable** `Respuesta`. Fin del Si.
        17. **Obtener valor del diccionario** `esperar` de `Contestación`. **Si** tiene algún valor:
            1. **Obtener contenido de URL**: `https://TU-MAC/v1/entradas/ClientID?esperar_ms=45000`, método GET, encabezado `Authorization` = `Bearer TOKEN`.
            2. **Obtener valor del diccionario** `respuesta`. **Si** tiene algún valor: **Establecer variable** `Respuesta`. Fin del Si.
        18. Fin del Si.
        19. **Leer texto** `Respuesta`, idioma Español (México).
        20. **Si** `En línea` tiene algún valor, y dentro **Si** `Reenviados` no tiene ningún valor:
            1. **Texto** `sí`. **Establecer variable** `Reenviados`.
            2. **Obtener archivo** (Get File) `/Finanzas/pendientes`, sin mostrar el selector y con "Error si no se encuentra" apagado.
            3. **Obtener contenido de la carpeta** (Get Contents of Folder) de ese archivo.
            4. **Repetir con cada** (Repeat with Each) elemento:
                1. **Establecer variable** `Archivo` con el elemento repetido.
                2. **Obtener contenido de URL**: POST a `https://TU-MAC/v1/hablar`, mismos encabezados, cuerpo **Archivo** = `Archivo`.
                3. Lo mismo que el paso 13, pero eliminando `Archivo`, sin `En línea`.
            5. Fin del Repetir.
        21. Fin de los dos Si.
    5. Fin del Si.
4. Fin del Repetir.

## Más adelante

- En el iPhone 17 Pro Max se puede agregar la acción **Usar modelo** (Apple Intelligence, en el dispositivo) para entender el dictado sin conexión. En el iPhone 13 no existe, así que es opcional.
- Si el primer dictado después de un rato se siente lento (15 a 18 s), es el modelo cargándose. El Atajo no lo despierta al abrirse a propósito: en Atajos una petición que falla detiene todo, y sin conexión o con la Mac dormida se perdería el dictado antes de escucharlo. Para que tarde menos, se puede subir `OLLAMA_KEEP_ALIVE` en el servicio de Ollama a costa de más memoria ocupada.
