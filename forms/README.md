# Tutorica Forms

Servicio de llenado automático de Google Forms para los suscriptores de TesisTab:
backend Express + extensión de Chrome. Derivado del proyecto MIT "borang" de
Adib Zaini (ver `LICENSE`), recortado a su núcleo QA y autenticado contra las
claves de API de TesisTab.

## Autenticación

Cada request a `/api/qa/*` y `/api/forms/*` exige una clave en `X-API-Key`:

- **Claves de usuario** (`ttab_...`): se generan en TesisTab → Integraciones y
  se validan contra `POST /integrations/validate-key` de la API de TesisTab
  (caché de 5 minutos). Si la suscripción venció, el servicio responde 401 con
  un mensaje claro.
- **`QA_API_KEY`** (env, opcional): llave maestra de desarrollo.
- **`TESISTAB_VALIDATION=off`** (env): modo local/tests, replica el
  comportamiento original (sin validación remota; `QA_API_KEY` opcional).

## Variables de entorno

| Variable | Default | Notas |
|---|---|---|
| `PORT` | `5000` | |
| `TESISTAB_API_URL` | `https://tabulacion-api.onrender.com` | API de TesisTab |
| `SERVICE_SHARED_SECRET` | *(vacío)* | Debe coincidir con el de la API de TesisTab |
| `TESISTAB_VALIDATION` | *(activada)* | `off` para desarrollo/tests |
| `QA_API_KEY` | *(vacío)* | Llave maestra opcional |

## Desarrollo

```bash
npm install
TESISTAB_VALIDATION=off npm start   # backend en http://localhost:5000
npm test
```

## Extensión de Chrome

En `tutorica-chrome-extension/`: cargarla descomprimida desde
`chrome://extensions` (modo desarrollador) o empaquetarla para la Web Store.
El usuario pega su clave de TesisTab en el popup.
