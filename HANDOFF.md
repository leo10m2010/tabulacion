# Handoff del Proyecto

Actualizado: 2026-06-11. Para arranque y despliegue ver `README.md`; para estado y riesgos ver `ESTADO_TECNICO.md`.

## Qué es

Generador de tabulaciones de tesis: API Node (`node_app/`) + frontend React (`frontend/`). **El Excel se construye 100% por código** (estructura, fórmulas reales y gráficos); no hay plantilla.

## Archivos clave

- `node_app/generator.js` — motor de generación: normalización del config, simulación de datos, construcción de hojas con xlsx-populate, y post-procesado OOXML (`postProcessWorkbook`: deduplicación de estilos + inyección de gráficos vía jszip).
- `node_app/server.js` — API: auth (tokens HMAC), usuarios/roles/suscripciones, rate limiting, `/generate`, `/template-info` (límites del generador), resultados temporales.
- `node_app/index.js` — modo CLI (`npm run generate`, usa `Tabulacion.json` de la raíz; `--sin-datos` deja la base vacía).
- `node_app/test/` — tests (`npm test`).
- `frontend/src/App.tsx` — estado principal, login, wizard y gestión de usuarios (envía la estructura jerárquica en `estructura_v1`/`estructura_v2`). Módulos extraídos: `lib/` (types, constants, helpers) y `components/` (LandingPage, WizardProgress, wizard-fields, PreviewTable, motion-primitives).
- `render.yaml` (API en Render, Node directo, disco persistente para `users.json`), `frontend/vercel.json` (SPA en Vercel) y `.env.example` — despliegue sin Docker; secretos por entorno, nunca en el repo.

## Invariantes que no hay que romper

1. **El Excel generado debe abrirse en Excel sin reparaciones y con todos los gráficos** — cualquier cambio al XML de charts/drawings debe validarse (los tests verifican estructura; openpyxl parsea los charts contra el esquema).
2. **Ningún error de fórmula en el archivo** (`#DIV/0!`, `#N/A`, `#REF!`, `#VALUE!`), incluso con base vacía: toda fórmula calculada va protegida con `IFERROR`/`IF`.
3. **No generar Excel silenciosamente incorrecto** — si la configuración excede los límites, error explícito o aviso (`warnings`).
4. **Sin secretos en el repo** — `users.json`, `.env` y contraseñas quedan fuera de git; en Render se definen por el dashboard.
5. `cd node_app && npm test` debe pasar antes de cualquier entrega.

## Mejoras pendientes sugeridas (en orden)

1. Persistencia real de resultados (S3/R2 + metadatos) si se usa el modo `links`.
2. Validación de schema del JSON con zod/ajv en la API.
3. Historial de generaciones por usuario.
4. Extraer los pasos del wizard y la sección de usuarios de App.tsx (segunda fase del split).

## Prompt sugerido para retomar en una nueva sesión

`Lee HANDOFF.md y ESTADO_TECNICO.md y continúa desde el estado actual. Quiero implementar <X> sin romper la generación de Excel ni los tests.`
