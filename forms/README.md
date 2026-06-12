# Tutorica Forms

Servicio de llenado automático de Google Forms para los suscriptores de TesisTab:
backend Express + extensión de Chrome. Derivado del proyecto MIT (ver `LICENSE`), recortado a su núcleo de llenado y autenticado contra
las claves de API de TesisTab.

## Cómo corre

En producción **se monta dentro de la API de TesisTab** (`node_app/server.js`):
ambos comparten proceso y puerto. La API delega las rutas `/api/tesistab/*`,
`/api/forms/*`, `/submit` y `/_submit` a esta app Express, y le inyecta un
validador de claves en memoria (sin llamadas HTTP). La extensión usa la misma
URL que la API: `https://tabulacion-api.onrender.com`.

Standalone (desarrollo/tests) también funciona: `node server.js` levanta su
propio servidor en `PORT`.

## Autenticación

Cada request a `/api/tesistab/*` y `/api/forms/*` exige una clave en `X-API-Key`:

- **Claves de usuario** (`ttab_...`): se generan en TesisTab → Forms. Montado en
  la API, se validan en memoria contra la lista de usuarios; standalone, contra
  `POST /integrations/validate-key` (caché de 5 minutos). Si la suscripción
  venció, responde 401 con un mensaje claro.
- **`TESISTAB_API_KEY`** (env, opcional): llave maestra de desarrollo.
- **`TESISTAB_VALIDATION=off`** (env): modo local/tests, sin validación remota.

## Variables de entorno (modo standalone)

| Variable | Default | Notas |
|---|---|---|
| `PORT` | `5000` | |
| `TESISTAB_API_URL` | `https://tabulacion-api.onrender.com` | API de TesisTab |
| `SERVICE_SHARED_SECRET` | *(vacío)* | Debe coincidir con el de la API de TesisTab |
| `TESISTAB_VALIDATION` | *(activada)* | `off` para desarrollo/tests |
| `TESISTAB_API_KEY` | *(vacío)* | Llave maestra opcional |

## Desarrollo

```bash
npm install
TESISTAB_VALIDATION=off npm start   # backend en http://localhost:5000
npm test
```

## Extensión de Chrome

En `tutorica-chrome-extension/`: cargarla descomprimida desde
`chrome://extensions` (modo desarrollador) o empaquetarla para la Web Store.
El usuario pega su clave de TesisTab en el popup; el backend por defecto ya es
`https://tabulacion-api.onrender.com`.
