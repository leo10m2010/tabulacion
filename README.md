# Sistema de Tabulación (TesisTab)

Aplicación web para generar la tabulación de una tesis: a partir de la configuración de la encuesta (muestra, variables, dimensiones, indicadores, ítems, escala y baremos) **construye el Excel completo por código** —estructura, fórmulas reales y gráficos incluidos, sin depender de ninguna plantilla— más un CSV con la base de datos generada.

## Arquitectura

- **Backend / API**: `node_app/server.js` (Node 18+, sin frameworks). Autenticación con tokens firmados, usuarios con roles y suscripción, generación vía `POST /generate`.
- **Motor de generación**: `node_app/generator.js` (`xlsx-populate` para celdas/fórmulas + `jszip` para inyectar los gráficos OOXML). También usable por CLI: `node_app/index.js`.
- **Frontend**: `frontend/` (React + Vite + Tailwind). Wizard de 3 pasos, gestión de usuarios para admins.
- **Salidas**: `Tabulacion_generada.xlsx` y `Tabulacion_base.csv`.

## Inicio rápido (local)

```bash
# 1. API
cd node_app && npm install && npm run api      # API en http://localhost:8080

# 2. Frontend
cd frontend && npm install && npm run dev      # http://localhost:5173 (proxy /api -> :8080)

# 3. Generación directa por CLI (usa Tabulacion.json de la raíz)
cd node_app && npm run generate
# Variante sin datos simulados (base vacía para ingreso manual):
cd node_app && npm run plantilla
```

**Primer arranque**: si no configuraste `ADMIN_PASSWORD`, la API crea el admin (`ADMIN_EMAIL`, por defecto `admin@tabulacion.local`) con una **contraseña aleatoria que se imprime una sola vez en la consola**. Guárdala y cámbiala.

## Variables de entorno (API)

| Variable | Default | Notas |
|---|---|---|
| `PORT` | `8080` | |
| `CORS_ORIGIN` | `*` | En producción: lista de orígenes separados por coma |
| `AUTH_REQUIRED` | `true` | |
| `AUTH_TOKEN_SECRET` | *(vacío)* | **Obligatorio en producción.** Si falta, se genera uno aleatorio por arranque (las sesiones no sobreviven reinicios) |
| `AUTH_TOKEN_TTL_SECONDS` | `86400` | |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ver arriba | Solo se usan con el almacén de usuarios vacío |
| `USER_STORE_PATH` | `node_app/data/users.json` | El directorio `node_app/data/` está fuera de git |
| `RESULT_TTL_SECONDS` | `900` | TTL de resultados en memoria (modo `links`) |
| `MAX_BODY_BYTES` | `4194304` | |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` | `5` / `900` | Rate limiting de login |
| `PUBLIC_BASE_URL` | *(vacío)* | URL pública para los links de descarga |

En Render estas variables se definen en el dashboard del servicio (ver `render.yaml`); `.env.example` documenta cada una.

## Qué genera y con qué límites

El Excel se construye completo en cada generación, adaptado exactamente a la configuración:

- **Por variable**: hoja base (encabezados combinados de dimensiones/indicadores, códigos `P1..Pn` con numeración continua entre variables, base de datos con columnas Total y Valoración por encuestado, estadísticos por ítem con `SUM/MODE.SNGL/AVERAGE/MEDIAN/STDEV.S/CV`, frecuencias y porcentajes por escala); hoja "Ítems" (tabla Frec/% por ítem con Tabla N, gráfico, Figura N, Fuente/Elaboración e **interpretación narrativa automática**); hoja "Dimensiones" (tabla ancha única con Suma/Nivel/Código por dimensión y consolidado —la suma referencia la hoja base, sin repetir la base de datos—, ficha de baremo y tabla de niveles por dimensión, tabla baremada Calificación/Desde/Hasta/f/% con gráfico y narrativa); y hoja "Conteo" (respuestas agregadas por dimensión con gráfico y narrativa).
- **Globales**: hoja "Relaciones" (tabla de sumas por encuestado; prueba de normalidad KS-Lilliefors/Shapiro-Wilk calculada por el generador sobre V1 total, V2 total y las dimensiones de V1; decisión automática Pearson/Rho de Spearman según los Sig.; correlación general V1-V2 y de cada dimensión de V1 contra V2 con `CORREL` + Sig. bilateral), hoja "Correlación" (r o rho vivo, r², interpretación y criterio) y hoja "Información". Las hojas de presentación llevan marco verde y rótulos Tabla/Figura como el formato de tesis.
- **Temas de gráficos**: paletas predefinidas (Clásico, Power BI, Ejecutivo, Esmeralda, Atardecer, Monocromo) seleccionables desde la web (`config.tema`); colorean los gráficos del Excel y la vista previa con gráficos del paso 3.
- Todas las fórmulas están protegidas con `IFERROR`/`IF`: nunca aparecen `#DIV/0!`, `#N/A`, `#REF!` ni `#VALUE!`, incluso con la base vacía (`conDatos: "0"`).
- **Límites**: muestra de 2 a 2,000 encuestados; hasta 60 ítems por variable; cualquier cantidad de opciones de escala y de niveles de baremo.

La API expone los límites en `GET /template-info` (`maxMuestra`, `maxItemsV1`, `maxItemsV2`). Configuraciones que los excedan se **rechazan con error explícito**.

## Endpoints de la API

- `GET /health` — estado.
- `POST /auth/login` — `{ email, password }` → token (rate-limited).
- `GET /auth/me` — usuario actual.
- `GET|POST /auth/users`, `PATCH|DELETE /auth/users/:id` — gestión de usuarios (**solo admin**).
- `GET /template-info` — límites del generador (autenticado).
- `POST /generate` — genera tabulación (cualquier usuario activo con suscripción vigente). Body: `{ config, responseMode: "inline" | "links" }`. Devuelve `correlation` (`null` con 1 variable), `warnings`, y el Excel/CSV inline (base64) o links temporales.
- `GET /results/:id[/xlsx|/csv]`, `DELETE /results/:id` — resultados en modo `links` (en memoria, expiran).

## Tests

```bash
cd node_app && npm test
```

Cubren: estructura del Excel generado (encabezados, fórmulas, baremos, gráficos inyectados), validación de límites, correlación (directa/inversa/una variable), base vacía, colisión de nombres de hoja, auth, roles, rate limiting y generación end-to-end.

## Despliegue (Vercel + Render, sin Docker)

- **API en Render**: New → Blueprint → este repo (usa `render.yaml`: corre `node server.js` directo, healthcheck en `/health`, plan free). Al crear el servicio, Render pide los secretos: `AUTH_TOKEN_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `CORS_ORIGIN` (el dominio del frontend en Vercel). **Modo pruebas (configuración actual)**: sin disco persistente, los usuarios creados se borran cuando el servicio se reinicia o despierta; el admin inicial se recrea solo. Para producción: plan Starter + descomentar el bloque `disk` y `USER_STORE_PATH` en `render.yaml`.
- **Frontend en Vercel**: New Project → este repo → **Root Directory: `frontend`** (Vite se autodetecta; `frontend/vercel.json` añade el rewrite del SPA). Define `VITE_API_BASE_URL=https://tu-api.onrender.com` en Settings → Environment Variables.
- Nota del plan gratuito de Render: el servicio se "duerme" tras 15 min sin tráfico y la primera petición tarda ~30-60 s en despertar (cold start).

## Seguridad

- No hay secretos ni contraseñas por defecto en el código ni en la configuración de despliegue (`render.yaml` los marca `sync: false`).
- `node_app/data/users.json` (hashes scrypt con salt) está fuera de git y de la imagen. **Nota**: versiones anteriores del repositorio lo incluían con la contraseña documentada `Admin12345!`; si ese admin sigue activo en algún despliegue, cámbiale la contraseña.
- Tokens HMAC-SHA256 con expiración; rate limiting en login; usuarios con estado y suscripción verificados en cada request.

## Documentación adicional

- `DOCUMENTACION.md` — guía funcional y contrato del JSON de configuración.
- `GUIA_EXCEL.md` — cómo se construye el Excel generado (hojas, fórmulas y gráficos).
- `ESTADO_TECNICO.md` — estado técnico y riesgos conocidos.
- `HANDOFF.md` — notas de continuidad.
