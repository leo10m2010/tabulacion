# TesisHub Forms (extensión de Chrome)

Extensión para completar y enviar respuestas automáticas en tus propios Google Forms.
Funciona junto al backend de Forms (montado en la API de TesisHub) y se
autentica con la clave de API del usuario (`ttab_...`, se genera en TesisTab > Integraciones).

**Instalación para usuarios (Chrome Web Store):**
<https://chromewebstore.google.com/detail/tutorica-forms/kdppbednjfajcjogdajmagfabidfjmem>

## Cómo funciona

1. El content script se inyecta en `docs.google.com/forms/*` y muestra un panel.
2. Al iniciar un envío captura los campos `entry.*`, completa los que falten y
   aplica el perfil configurado (Likert, distribuciones, demografía).
3. Crea un job en el backend (`POST /api/tesistab/submit`); el backend envía las
   N respuestas a Google Forms con la espera configurada.
4. El panel muestra el progreso consultando `GET /api/tesistab/jobs/:id`.

## Características

- Panel en la página: cantidad, perfil (favorable/intermedio/desfavorable/auto),
  distribución por porcentajes, demografía avanzada y herramientas CSV.
- Popup: inicio de sesión con la cuenta TesisTab (obtiene la clave de API
  automáticamente; la contraseña nunca se guarda) y pantalla de bloqueo estilo
  caja fuerte con auto-bloqueo configurable (15 min a 7 días, o nunca).
  La sesión persiste hasta que expire el auto-bloqueo o se cierre manualmente.
- Tarjeta visual de conexión (Conectado / Sin conexión); la URL del backend y
  la clave manual quedan ocultas dentro de "Diagnóstico técnico".
- Tokens de texto `{{i}}` y `{{rand}}`, y modo de aleatorización automática.
- Confirmación obligatoria de que el formulario es propio o autorizado.
- Pausa, reanudación, cancelación y progreso por respuestas.
- Captura guiada multipágina con recorridos condicionales independientes.

## Formularios con secciones condicionales

Avanza normalmente con **Siguiente**. La extensión guarda cada página antes de
que Google reemplace el DOM. Para incluir otra alternativa, llega a la última
página, pulsa **Atrás**, vuelve al punto de decisión y recorre la otra rama. Al
iniciar se mostrará cuántos recorridos completos se capturaron.

Las rutas se identifican por su secuencia de páginas y por las respuestas de
la página donde se separan. Sus campos y tokens de navegación se envían como
unidades independientes: una respuesta nunca combina preguntas exclusivas de
dos ramas. Si solo se captura un recorrido, se usa como ruta de respaldo.

## Instalación en desarrollo (Load unpacked)

1. Abre `chrome://extensions` y activa **Developer mode**.
2. **Load unpacked** y selecciona esta carpeta.
3. Por defecto apunta al backend de producción; para desarrollo local cambia la
   URL del popup a `http://localhost:5000` y levanta `forms/` con `npm start`.

## Empaquetado para la Chrome Web Store

El zip se genera desde la raíz del repo e incluye solo lo necesario
(`manifest.json`, `icons/`, `background/`, `content/`, `popup/` y `LICENSE`);
ver `tesishub-forms-extension.zip`.

## Formato del CSV

- Primera fila: cabeceras con los nombres de campo de Google (`entry.123456`).
- Cada fila siguiente es un perfil de respuesta.

## Capacidad de respuestas

La extensión no impone un máximo fijo. El backend valida la cantidad positiva
contra el saldo de respuestas de la cuenta y procesa trabajos grandes en lotes
de 100. `TESISTAB_MAX_SUBMISSIONS_PER_JOB` puede configurarse únicamente como
freno operativo de una instalación.

## Licencia

MIT
