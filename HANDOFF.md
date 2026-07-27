# Handoff del Proyecto

Actualizado: 2026-07-27. Para arranque y despliegue ver `README.md`; para estado y riesgos ver `ESTADO_TECNICO.md`.

## Qué es

Generador de tabulaciones de tesis: API Node (`node_app/`) + frontend React (`frontend/`). **El Excel se construye 100% por código** (estructura, fórmulas reales y gráficos); no hay plantilla. Además de Tabulación, la suite incluye Confiabilidad (Cronbach), Tabulación Descriptiva (IA), Generador de Títulos (IA), Matriz de Consistencia (IA) y Humanizador — y desde la Fase 4 (2026-07-25), un objeto **Proyecto de tesis** con Instrumento compartido que varias de esas herramientas leen/escriben (ver abajo).

## Archivos clave

- `node_app/generator.js` — orquestador delgado (~170 líneas) del flujo correlacional/cuasiexperimental: normalización del config, simulación de datos, construcción de hojas con xlsx-populate, y post-procesado OOXML (`postProcessWorkbook`: deduplicación de estilos + inyección de gráficos vía jszip). La lógica vive en `node_app/lib/` (un módulo por responsabilidad: `config`, `stats`, `sheets`, `ooxml`, `cronbach`, `quasi-*`, y subcarpetas por herramienta IA: `descriptiva/`, `humanizador/`, `titulos/`, `matriz/`, `proyectos/`).
- `node_app/lib/proyectos/` — el objeto "Proyecto de tesis": `index.js` normaliza y valida el Instrumento (variables → dimensiones → indicadores → ítems + escala + baremo) y el progreso por paso; `store.js` persiste en Postgres (si hay `DATABASE_URL`) o archivo JSON, fila a fila (no reescribe el arreglo completo, a diferencia de `lib/store/` de usuarios).
- `node_app/server.js` — API: auth (tokens HMAC), usuarios/roles/suscripciones, rate limiting, `/generate`, `/template-info` (límites del generador), `/proyectos` (CRUD + límite por plan), resultados temporales.
- `node_app/index.js` — modo CLI (`npm run generate`, usa `Tabulacion.json` de la raíz; `--sin-datos` deja la base vacía).
- `node_app/test/` — tests (`npm test`).
- `frontend/src/App.tsx` — shell de la app (~800 líneas): login, sidebar/nav, tema, y el switch de secciones cargadas con `React.lazy`. El wizard de Tabulación y la gestión de usuarios YA NO viven aquí: son componentes propios (`components/sections/TabulacionSection.tsx`, `components/sections/UsersSection.tsx`), igual que el resto de herramientas.
- `frontend/src/components/sections/ProyectosSection.tsx` — crear/listar/seleccionar proyectos; `frontend/src/components/TraerDelProyecto.tsx` — atajo (no obligatorio) que rellena una herramienta con el instrumento del proyecto activo.
- `render.yaml` (API en Render, Node directo, disco persistente para `users.json`), `frontend/vercel.json` (SPA en Vercel) y `.env.example` — despliegue sin Docker; secretos por entorno, nunca en el repo.

## Estado de la integración del Proyecto de tesis (Fase 4)

El objeto Proyecto existe y se usa de verdad, pero de forma **parcial** — no todas las herramientas lo consumen igual:

- **Tabulación** y **Confiabilidad**: leen el instrumento del proyecto activo vía un botón explícito "Traer del proyecto" (`TraerDelProyecto.tsx`); no escriben de vuelta.
- **Títulos** y **Matriz de Consistencia**: integración de ida y vuelta — Títulos guarda el título elegido en el proyecto; Matriz lee ese título como punto de partida y puede guardar el instrumento (variables/dimensiones) que redacta de vuelta en el proyecto.
- **Descriptiva** y **Humanizador**: **no leen ni escriben el instrumento del proyecto.** Ambas solo marcan su paso como hecho (`onPasoHecho`) cuando hay un proyecto activo. Para el Humanizador tiene sentido (no trabaja con un instrumento, sino con texto libre). Para Descriptiva es una brecha real: su entrada es un cuestionario en texto libre (pegado o `.docx`) que la IA interpreta, un formato distinto al instrumento estructurado — unificarlos es una decisión de producto (¿pre-rellenar el texto a partir del instrumento? ¿aceptar el instrumento como entrada alternativa?), no un simple cableado de props.

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
4. Decidir si Descriptiva debe leer/pre-rellenarse desde el instrumento del proyecto (ver "Estado de la integración" arriba) — es la pieza que falta para que el Proyecto cubra las 4 herramientas de la recomendación #1 de `docs/ux-audit.md`.
5. El chunk de gráficos (echarts) del frontend sigue por encima del umbral de 500 kB de Vite (505 kB tras modularizar a `echarts/core` + `BarChart` + `GridComponent/TitleComponent/TooltipComponent` + `CanvasRenderer`, ver `frontend/src/lib/echarts-lazy.ts`): ese es aproximadamente el piso de usar echarts para cualquier gráfico (el peso es zrender + el núcleo, no los componentes). Bajar de ahí exigiría cambiar de librería de gráficos, no más tree-shaking.

## Prompt sugerido para retomar en una nueva sesión

`Lee HANDOFF.md y ESTADO_TECNICO.md y continúa desde el estado actual. Quiero implementar <X> sin romper la generación de Excel ni los tests.`
