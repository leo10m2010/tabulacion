# Estado técnico del proyecto

Actualizado: 2026-07-01.

## Resumen

- Generación **100% por código** (`node_app/generator.js` orquesta módulos en `node_app/lib/`): `xlsx-populate` construye celdas/fórmulas/estilos y un post-procesado con `jszip` deduplica estilos e inyecta los gráficos OOXML. **No existe plantilla**: `Tabulacion.xlsx` fue eliminada del repositorio.
- API HTTP propia (`node_app/server.js`) con auth por tokens, roles, suscripciones y rate limiting.
- Frontend React/Vite en `frontend/` consumiendo la API (`POST /generate` en modo `inline`); envía la estructura jerárquica en `estructura_v1`/`estructura_v2`.
- Suite de tests con `node:test` (`cd node_app && npm test`): 22 tests de generador y API.

## Refactor por módulos (2026-07-01)

- `node_app/generator.js` (antes ~1,800 líneas) quedó como orquestador de ~70 líneas que **re-exporta la API pública** (los imports de server/tests/CLI no cambian). La lógica vive en `node_app/lib/`: `config.js` (normalización, límites, temas), `stats.js` (simulación, correlación, normalidad), `sheet-style.js` (estilos y utilidades), `narratives.js` (interpretaciones), `sheets.js` (las hojas + `buildWorkbook`) y `ooxml.js` (dedupe de estilos + gráficos).
- `frontend/src/App.tsx` (antes ~1,800 líneas) bajó a ~1,280: `lib/api.ts` centraliza todas las llamadas HTTP; `components/LoginScreen.tsx`, `components/sections/UsersSection.tsx` y `components/sections/FormsSection.tsx` son autocontenidos (estado + API propios). App conserva el wizard de 3 pasos; la siguiente pasada natural es extraer los pasos del wizard.
- Pendiente de refactor (baja prioridad, código estable): `forms/server.js` y la extensión (`content.js`).

## Migración a generador sin plantilla (2026-06-11)

- Reescritura completa de `generator.js`: el Excel se construye desde cero en cada generación (por variable: hoja base, "Ítems", "Dimensiones" y "Conteo"; globales: "Relaciones", "Correlación" e "Información"). Sin límites heredados de la plantilla: muestra 2–2,000, hasta 60 ítems por variable, escala y niveles de baremo libres.
- Formato de tesis replicado del Excel original: rótulos "Tabla N"/"Figura N", "Fuente: Encuesta aplicada"/"Elaboración: Propia", encabezados amarillos por bloque, marco verde, tabla de normalidad (KS-Lilliefors/Shapiro-Wilk calculada por el generador; en blanco con `conDatos: "0"`) y correlaciones Pearson/Spearman con Sig. bilateral.
- **Interpretaciones narrativas automáticas** por ítem, dimensión y conteo, redactadas en JS con los porcentajes reales de los datos generados (con base vacía se emite un texto guía).
- Gráficos generados por código (barras con etiquetas de datos): uno por ítem, uno por dimensión (conteo), uno por dimensión y uno consolidado por variable (frecuencia baremada).
- Deduplicación de estilos en post-procesado (xlsx-populate crea un estilo por celda: styles.xml pasaba de ~10 MB a ~5 KB).
- `conDatos: "0"` genera la base vacía para ingreso manual (las fórmulas muestran vacío, nunca errores).
- `GET /template-info` ahora reporta los límites del generador.
- Despliegue sin Docker (2026-06-11): frontend en Vercel (`frontend/vercel.json`) y API en Render (`render.yaml`, Node directo con healthcheck y disco persistente para `users.json`). Dockerfile, docker-compose y netlify.toml eliminados.
- Eliminados: `Tabulacion.xlsx`, salidas versionadas (`Tabulacion_generada.xlsx`, `Tabulacion_base.csv`), restos de la era Python en los ignores y ~800 líneas de maquinaria de adaptación de plantilla.

## Seguridad (auditoría 2026-06)

- Sin secretos por defecto: `AUTH_TOKEN_SECRET` y `ADMIN_PASSWORD` se exigen por entorno (con fallback aleatorio por arranque); `users.json` y `.env` fuera de git.
- El rol `user` puede generar (la suscripción se valida en cada request); la gestión de usuarios sigue siendo solo admin.
- El historial de git contiene un `users.json` antiguo con hash del admin y la contraseña documentada `Admin12345!`: cualquier despliegue que conserve ese usuario debe rotar la contraseña.

## Riesgos y pendientes conocidos

- Los resultados en modo `links` viven en memoria: se pierden al reiniciar y no escalan a múltiples réplicas (el frontend usa modo `inline`, que no depende de esto).
- Los gráficos se validaron estructuralmente (openpyxl los parsea contra el esquema OOXML) pero conviene una verificación visual en Excel de escritorio tras cambios al XML de charts.
- `frontend/src/App.tsx` quedó en ~1,600 líneas tras extraer `lib/` y `components/` (2026-06-11); segunda fase pendiente: extraer los pasos del wizard y la sección de usuarios.
