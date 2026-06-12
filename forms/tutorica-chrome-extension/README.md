# Tutorica Forms (extensión de Chrome)

Extensión para completar y enviar respuestas automáticas en tus propios Google Forms.
Funciona junto al backend de Tutorica Forms (montado en la API de TesisTab) y se
autentica con la clave de API del usuario (`ttab_...`, se genera en TesisTab > Integraciones).

## Cómo funciona

1. El content script se inyecta en `docs.google.com/forms/*` y muestra un panel.
2. Al iniciar una corrida captura los campos `entry.*`, completa los que falten y
   aplica el perfil configurado (Likert, distribuciones, demografía).
3. Crea un job en el backend (`POST /api/tesistab/submit`); el backend envía las
   N respuestas a Google Forms con la espera configurada.
4. El panel muestra el progreso consultando `GET /api/tesistab/jobs/:id`.

## Características

- Panel en la página: cantidad, perfil (favorable/intermedio/desfavorable/auto),
  distribución por porcentajes, demografía avanzada y herramientas CSV.
- Popup: URL del backend, clave de API, tema claro/oscuro y diagnóstico.
- Tokens de texto `{{i}}` y `{{rand}}`, y modo de aleatorización automática.
- Diálogo de confirmación antes de cada corrida.

## Instalación en desarrollo (Load unpacked)

1. Abre `chrome://extensions` y activa **Developer mode**.
2. **Load unpacked** y selecciona esta carpeta.
3. Por defecto apunta al backend de producción; para desarrollo local cambia la
   URL del popup a `http://localhost:5000` y levanta `forms/` con `npm start`.

## Empaquetado para la Chrome Web Store

El zip se genera desde la raíz del repo e incluye solo lo necesario
(`manifest.json`, `icons/`, `background/`, `content/`, `popup/` y `LICENSE`);
ver `tutorica-forms-extension.zip`.

## Formato del CSV

- Primera fila: cabeceras con los nombres de campo de Google (`entry.123456`).
- Cada fila siguiente es un perfil de respuesta.

## Límite por corrida

El máximo de envíos por corrida se define en `content/content.js`
(`MAX_UI_SUBMISSIONS`) y en el backend (`TESISTAB_MAX_SUBMISSIONS_PER_JOB`).

## Licencia

MIT
