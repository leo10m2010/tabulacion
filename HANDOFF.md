# Handoff del Proyecto

## Estado actual

- Generación de tabulación migrada a **Node.js**.
- Frontend web nuevo en **React + Vite + Tailwind (estilo shadcn-like)**.
- API backend lista para consumo desde frontend (ideal para Netlify + API en Docker).
- El nombre de muestra (`nommuestra`) ahora se reemplaza automáticamente en el Excel generado, incluyendo variantes previas tipo `Beneficiaros` / `Beneficiaross`.

## Arquitectura actual

- Frontend:
  - `frontend/` (React)
  - Consume API vía `POST /generate`
- Backend:
  - `node_app/server.js` (API HTTP)
  - `node_app/generator.js` (lógica central de generación)
  - `node_app/index.js` (modo CLI para generación local)
- Plantilla:
  - `Tabulacion.xlsx` (entrada)
- Salidas:
  - `Tabulacion_generada.xlsx`
  - `Tabulacion_base.csv`

## Archivos clave

- `node_app/generator.js`: motor de generación reutilizable.
- `node_app/server.js`: endpoints API (`/health`, `/generate`, `/results/:id/...`).
- `node_app/index.js`: ejecución local CLI.
- `Dockerfile` y `docker-compose.yml`: despliegue backend en contenedor.
- `frontend/src/App.tsx`: UI completa (configuración, validaciones, generación, descargas, vista previa).
- `frontend/src/index.css`: variables de tema y modo dark.
- `frontend/netlify.toml`: configuración de build para Netlify.
- `frontend/.env.example`: variable `VITE_API_BASE_URL`.

## Endpoints API

- `GET /health`
- `POST /generate`
- `GET /results/:id`
- `GET /results/:id/xlsx`
- `GET /results/:id/csv`
- `DELETE /results/:id`

## Variables de entorno backend

- `PORT` (default: `8080`)
- `TEMPLATE_PATH` (default: `Tabulacion.xlsx`)
- `CORS_ORIGIN` (default: `*`)
- `RESULT_TTL_SECONDS` (default: `900`)
- `MAX_BODY_BYTES` (default: `4194304`)
- `PUBLIC_BASE_URL` (opcional)

## Variables de entorno frontend

- `VITE_API_BASE_URL` (ej: `http://localhost:8080` o dominio de la API en producción)

## Cómo correr local

### Opción A: API con Docker + frontend local

1. Levantar API:
   - `docker compose up --build`
2. Levantar frontend:
   - `cd frontend`
   - `npm install`
   - `npm run dev`

### Opción B: API sin Docker

1. API:
   - `cd node_app`
   - `npm install`
   - `npm run api`
2. Frontend:
   - `cd frontend`
   - `npm install`
   - `npm run dev`

## Deploy recomendado

- Frontend en Netlify:
  - Base directory: `frontend`
  - Build command: `npm run build`
  - Publish directory: `dist`
  - Env: `VITE_API_BASE_URL=https://tu-api.com`
- Backend en Render/Railway/Fly (Docker):
  - Configurar `CORS_ORIGIN=https://tu-sitio.netlify.app`
  - Asegurar que `Tabulacion.xlsx` esté disponible en contenedor (actualmente se copia en `Dockerfile`).

## Mejoras pendientes recomendadas

1. Persistencia real de resultados (S3/R2 + metadata en DB).
2. Autenticación y rate limiting de API.
3. Validación de schema JSON robusta (zod/ajv).
4. Cola de trabajos para escalar generación concurrente.
5. Historial de generaciones en frontend.

## Prompt sugerido para retomar en nueva sesión

`Lee HANDOFF.md y continúa desde el estado actual. Quiero implementar <X> sin romper generación de Excel ni frontend.`
