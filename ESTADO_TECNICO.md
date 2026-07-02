# Estado técnico del proyecto

Actualizado: 2026-07-01.

## Resumen

- Generación **100% por código** (`node_app/generator.js` orquesta módulos en `node_app/lib/`): `xlsx-populate` construye celdas/fórmulas/estilos y un post-procesado con `jszip` deduplica estilos e inyecta los gráficos OOXML. **No existe plantilla**: `Tabulacion.xlsx` fue eliminada del repositorio.
- API HTTP propia (`node_app/server.js`) con auth por tokens, roles, suscripciones y rate limiting.
- Frontend React/Vite en `frontend/` consumiendo la API (`POST /generate` en modo `inline`); envía la estructura jerárquica en `estructura_v1`/`estructura_v2`.
- Suite de tests con `node:test` (`cd node_app && npm test`): 22 tests de generador y API.

## Hojas de conteo eliminadas + método de correlación explícito (2026-07-01)

- Se eliminaron las hojas "Conteo <Variable>": contaban las respuestas Likert agregadas por dimensión, pero la escala Likert es exclusivamente de los ítems — las dimensiones se miden por **niveles de baremo** (tabla baremada de la hoja Dimensiones). El Excel queda en 9 hojas / 33 gráficos con la config clásica.
- `metodoCorrelacion` ahora es `auto` (default) | `pearson` | `spearman`. En `auto` la prueba de normalidad decide el método de las hojas (comportamiento anterior). Con un método explícito, **ese método manda** en Relaciones/Correlación y la narrativa lo justifica sin contradecir la tabla de normalidad (p. ej. Pearson con normalidad rechazada → "considerando el tamaño de la muestra y la robustez del estimador… conforme al diseño metodológico"). Con `pearson` los ítems se discretizan con umbrales lineales (forma cuasi-normal) y el lazo de control además prefiere bases que pasan la normalidad — a N chico/medio la normalidad pasa de verdad; a N grande (~300) las sumas Likert discretas rechazan KS/SW casi siempre (propiedad estadística real), y ahí aplica la narrativa justificada.

## Control opcional de correlación (2026-07-01)

- Interruptor `controlCorrelacion` (default activado por compatibilidad): activado, el usuario elige `nivelCorrelacion` (muy_alta/alta/moderada/baja/muy_baja/nula, rangos en valor absoluto) y el generador busca adaptativamente el peso del factor compartido hasta que la correlación de las sumas caiga en el rango; desactivado, la correlación es el resultado natural (fuerza aleatoria por generación). El signo lo aporta `relacionversa` (no se vuelve a preguntar). Verificación con `metodoCorrelacion`: Spearman (default, adecuado para Likert) o Pearson. El resultado (`correlationControl`: activo, nivel, dirección, método, obtenido, rango esperado, cumple) viaja en la respuesta inline, se muestra en el paso 3 del frontend y se documenta en la hoja "Información" con el disclaimer de datos simulados.

## Simulación de datos con dispersión realista (2026-07-01)

- `generateBaseData` (`node_app/lib/stats.js`) dejó de concentrar todas las respuestas en el centro: cada ítem recibe un **perfil de distribución** aleatorio (campana, polarizado, sesgado alto/bajo o disperso, con parámetros aleatorios por ítem) aplicado como warp monótono sobre el percentil, y hay **heterogeneidad entre encuestados** (rasgo individual de estilo de respuesta + grupos latentes con medias distintas). Como los warps son monótonos sobre el mismo factor latente, la correlación objetivo se conserva (|r| ≈ 0.97-0.98, inversa incluida) y los valores siempre caen dentro del rango de la escala.

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
