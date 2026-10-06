# El Atajo "Finanzas"

Un solo Atajo para registrar y preguntar. Dices lo que sea, te contesta en voz y sigue escuchando hasta que digas "listo".

Son dos Atajos: **Finanzas**, el que usas, y **Finanzas: enviar pendientes**, que manda lo que se quedó guardado sin conexión. Los nombres de las acciones están como aparecen en iOS en español, con el nombre en inglés entre paréntesis.

Antes de empezar necesitas la dirección de Tailscale de tu Mac (paso 7 de [instalacion.md](instalacion.md)) y tu token.

## Cómo funciona sin internet

El iPhone espera a la IA como máximo 5 segundos al registrar y 30 al preguntar. Si la Mac tarda más, contesta "Anotado" y lo termina sola, así que el Atajo nunca se queda colgado. En las preguntas, el paso 13 espera la respuesta un poco más.

Cada dictado se guarda primero como archivo en `iCloud Drive/Shortcuts/Finanzas/pendientes/` y se borra solo cuando el servidor confirma. Si el iPhone o la Mac no tienen conexión, el envío falla y verás un aviso de error, pero el dictado ya quedó guardado. El segundo Atajo lo envía después, y el `client_id` evita que se registre dos veces.

## Atajo 1: Finanzas

1. **Texto** (Text): la dirección, por ejemplo `https://macbook-pro-de-pedro.tu-red.ts.net`. Luego **Establecer variable** (Set Variable) `Servidor`.
2. **Texto**: tu token `fa_...`. **Establecer variable** `Token`.
3. **Texto** vacío. **Establecer variable** `Conversación`.
4. **Obtener ubicación actual** (Get Current Location). **Establecer variable** `Ubicación`.
5. **Obtener detalles de ubicaciones** (Get Details of Locations): Nombre, de `Ubicación`. **Establecer variable** `Lugar`.
6. **Repetir** (Repeat) 10 veces, y dentro:
    1. **Dictar texto** (Dictate Text): idioma Español (México), dejar de escuchar "Después de una pausa".
    2. **Coincidir texto** (Match Text) con `^(no|nada|listo|ya|es todo|gracias)\.?$`, sin distinguir mayúsculas, sobre el texto dictado.
    3. **Si** (If) las coincidencias tienen algún valor: **Detener este atajo** (Stop This Shortcut). Fin del Si.
    4. **Fecha actual** (Current Date) y **Formatear fecha** (Format Date) en ISO 8601 con hora. **Establecer variable** `Capturado`.
    5. **Número aleatorio** (Random Number) entre 100000 y 999999. **Texto**: `Capturado`-`Número aleatorio`. **Establecer variable** `ClientID`.
    6. **Diccionario** (Dictionary) con estas claves de texto:
        - `texto`: el texto dictado
        - `client_id`: `ClientID`
        - `conversacion_id`: `Conversación`
        - `lat`: Latitud de `Ubicación`
        - `lon`: Longitud de `Ubicación`
        - `lugar`: `Lugar`
        - `capturado_en`: `Capturado`
    7. **Texto** con el Diccionario adentro (así se convierte a JSON). **Establecer nombre** (Set Name): `ClientID`.json.
    8. **Guardar archivo** (Save File) en `Shortcuts/Finanzas/pendientes`, sin preguntar dónde y reemplazando si existe. **Establecer variable** `Pendiente`.
    9. **Obtener contenido de URL** (Get Contents of URL): `Servidor`/v1/hablar, método POST, encabezados `Authorization` = `Bearer Token` y `Content-Type` = `application/json`, cuerpo **Archivo** = `Pendiente`.
    10. **Obtener valor del diccionario** (Get Dictionary Value) `conversacion_id` y **Establecer variable** `Conversación`.
    11. **Obtener valor del diccionario** `error`. **Si** no tiene ningún valor: **Eliminar archivos** (Delete Files) `Pendiente`, con "Confirmar antes de eliminar" apagado. Fin del Si.
    12. **Obtener valor del diccionario** `respuesta` del resultado del paso 9 y **Establecer variable** `Respuesta`.
    13. **Obtener valor del diccionario** `esperar` del resultado del paso 9. **Si** tiene algún valor (fue una pregunta y la Mac sigue pensando):
        1. **Obtener contenido de URL**: `Servidor`/v1/entradas/`ClientID`?esperar_ms=45000, método GET, encabezado `Authorization` = `Bearer Token`.
        2. **Obtener valor del diccionario** `respuesta`. **Si** tiene algún valor: **Establecer variable** `Respuesta`. Fin del Si.
        
        Fin del Si.
    14. **Leer texto** (Speak Text) `Respuesta`.
7. Fin del Repetir.

Para lanzarlo:

- **Siri**: "Oye Siri, finanzas".
- **Botón de acción** (iPhone 15 Pro en adelante): Ajustes > Botón de acción > Atajo > Finanzas.
- **Toque atrás** (cualquier iPhone, incluido el 13): Ajustes > Accesibilidad > Tocar > Toque atrás > Doble toque > Finanzas.

## Atajo 2: Finanzas: enviar pendientes

1. **Texto** con la dirección y **Texto** con el token, como en el otro Atajo.
2. **Obtener contenido de la carpeta** (Get Contents of Folder) `Shortcuts/Finanzas/pendientes`.
3. **Repetir con cada** (Repeat with Each) archivo:
    1. **Obtener contenido de URL**: POST a `Servidor`/v1/hablar, mismos encabezados, cuerpo **Archivo** = elemento repetido.
    2. **Obtener valor del diccionario** `error`. **Si** no tiene ningún valor: **Eliminar archivos** el elemento repetido, sin confirmar. Fin del Si.
4. Fin del Repetir.

Automatízalo en la app Atajos > Automatización:

- **Wi-Fi**: al conectarse a tu red de casa, ejecutar de inmediato "Finanzas: enviar pendientes".
- **Hora del día**: todos los días a las 9:00 p. m., el mismo Atajo.

## Más adelante

- En el iPhone 17 Pro Max se puede agregar la acción **Usar modelo** (Apple Intelligence, en el dispositivo) para entender el dictado sin conexión. En el iPhone 13 no existe, así que es opcional.
- Si el primer dictado después de un rato se siente lento, es el modelo cargándose. Abrir el Atajo ya lo carga mientras hablas; si aun así tarda, se puede subir `OLLAMA_KEEP_ALIVE` en el servicio de Ollama a costa de más memoria ocupada.
