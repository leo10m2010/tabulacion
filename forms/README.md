# TesisHub Forms

Backend compatible, extensión Chrome y worker de envíos autorizados a Google
Forms.

## Producción

La superficie HTTP se monta en `node_app/server.js`, pero la ejecución vive en
el servicio `tabulacion-forms-worker`. El API valida, reserva saldo y crea el
job. El worker reclama jobs desde Neon con leases, conserva cursor e intentos y
liquida la reserva. Reiniciar Render o cerrar Chrome no elimina el trabajo.

El API público es `https://tabulacion-api.onrender.com`. En producción se debe
configurar `CORS_ALLOWED_ORIGINS` con Vercel, localhost autorizado y el origen
`chrome-extension://` exacto; `*` se rechaza.

## Identidad de la extensión

Cada instalación solicita un código y secreto efímeros. El usuario aprueba el
código desde su sesión web Google y la extensión recibe una credencial propia.
Revocar un dispositivo no invalida los demás.

En standalone también se admite validación contra
`POST /integrations/validate-key`. `TESISTAB_VALIDATION=off` queda reservado a
desarrollo y tests.

## Cuota por respuestas

No existe un máximo fijo de 200/250. El límite efectivo es el saldo reservado:

- `reserve(apiKey, requested, meta)` reserva todo al crear.
- `settle(apiKey, reservationId, outcome)` consume aceptadas y devuelve fallidas
  o canceladas.
- `release(apiKey, reservationId, meta)` libera una creación que no llegó a
  convertirse en job.
- Las respuestas inciertas permanecen reservadas para reconciliación.

Los jobs grandes se dividen en lotes internos de 100. La API muestra
solicitadas, aceptadas, fallidas, pendientes, reservadas, porcentaje y lotes.

## API

- `POST /api/forms/jobs` o el adaptador `/api/tesistab/submit`.
- `GET /api/forms/jobs/:id` y listados por propietario.
- `POST .../:id/pause`, `/resume` y `/cancel`.
- El endpoint legado de cuerpos completos permanece limitado por TTL y cantidad
  mientras dura la compatibilidad.

La creación exige `ownOrAuthorized: true`, URL permitida, entero positivo,
estructura y `idempotencyKey`. Se respeta `Retry-After`; los `429/5xx` usan
backoff. CAPTCHA, bloqueo, formulario cerrado o estructura incompatible
detienen el trabajo con diagnóstico, sin evasión.

### Rutas condicionales multipágina

La extensión envía recorridos completos y separados en `config.multiPage`.
Cada ruta conserva sus propios `entry.*`, `pageHistory`, `partialResponse` y
tokens de navegación; el servidor nunca aplana dos ramas. El contrato v1 es:

```json
{
  "version": 1,
  "guidedCapture": true,
  "routes": [{
    "id": "route-1",
    "fallback": true,
    "when": {
      "all": [{ "field": "entry.10", "operator": "equals", "value": "Empresa" }]
    },
    "payload": {
      "entry.10": "Empresa",
      "entry.20": "RUC 123",
      "pageHistory": "0,1"
    },
    "pages": [{ "pageKey": "inicio", "entries": ["entry.10"] }]
  }]
}
```

Solo se admiten campos `entry.N` y tokens conocidos de Google Forms. Hay un
máximo de 20 rutas, 50 páginas por ruta y 16 condiciones. El backend crea un
perfil por respuesta, evalúa las condiciones sobre ese perfil y selecciona un
único recorrido. El GET del job expone cantidad y campos selectores, no los
payloads capturados.

Los adaptadores `/api/forms` y `/api/forms/submit` anuncian `Deprecation` y
`Sunset`. La fecha se configura con `LEGACY_API_SUNSET_AT` (RFC 3339); el valor
por defecto es `2026-09-07T00:00:00Z`.

## Desarrollo

```bash
npm ci
npm test
TESISTAB_VALIDATION=off npm start
npm run build:extension
```

El ZIP se genera en `dist/` a partir de `tutorica-chrome-extension/`. CI ejecuta
las pruebas, comprueba la versión del manifiesto y publica ese ZIP como artefacto.

## Worker

Variables principales:

| Variable | Valor de producción |
|---|---|
| `TESISTAB_WORKER_MODE` | `true` |
| `TESISTAB_RUN_JOBS_INLINE` | `false` |
| `FORMS_WORKER_ADAPTER` | `node_app/forms-worker-adapter.js` |
| `TESISTAB_JOB_BATCH_SIZE` | `100` |
| `TESISTAB_JOB_LEASE_MS` | `30000` |
| `LEGACY_API_SUNSET_AT` | fecha RFC 3339 del retiro del adaptador legado |
| `DATABASE_URL` | endpoint pooled de Neon |

El almacenamiento JSON es solo fallback standalone. En producción, si no se
inyecta un repositorio durable, la API de jobs responde `503`.
