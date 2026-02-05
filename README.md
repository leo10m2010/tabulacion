# Sistema de Tabulacion

Aplicacion web en Streamlit para configurar la tabulacion de tesis. La generacion de base y Excel final se hace 100% con Node.js (`xlsx-populate`) para preservar graficos y formas de la plantilla.

## Requisitos

- Python 3.10+ (UI Streamlit).
- Node.js 18+ (motor de generacion).
- Dependencias Python: `streamlit`, `pandas`.

```bash
python -m pip install streamlit pandas
cd node_app && npm install
```

## Ejecutar

```bash
python -m streamlit run app.py
```

## API para frontend (Netlify)

Además del flujo Streamlit, tienes API Node lista para un frontend estático (Netlify):

```bash
cd node_app
npm run api
```

Endpoints principales:

- `GET /health`
- `POST /auth/login`
- `GET /auth/me`
- `GET /auth/users` (admin)
- `POST /auth/users` (admin)
- `PATCH /auth/users/:id` (admin)
- `POST /generate` (solo admin)
- `GET /results/:id/xlsx`
- `GET /results/:id/csv`

Configura CORS con `CORS_ORIGIN` para permitir tu dominio Netlify.

Variables nuevas recomendadas para producción:

- `AUTH_REQUIRED=true`
- `AUTH_TOKEN_SECRET=<secreto-largo>`
- `AUTH_TOKEN_TTL_SECONDS=86400`
- `USER_STORE_PATH=/ruta/persistente/users.json`
- `ADMIN_EMAIL=<correo-admin>`
- `ADMIN_PASSWORD=<clave-admin>`

## Frontend React (estilo shadcn)

Nuevo frontend listo en `frontend/`:

```bash
cd frontend
npm install
npm run dev
```

Build para Netlify:

```bash
cd frontend
npm run build
```

Variables:

- `VITE_API_BASE_URL` (ejemplo en `frontend/.env.example`)

## Docker (API)

```bash
docker compose up --build
```

La API quedará en `http://localhost:8080`.

Credenciales iniciales por defecto (cámbialas):

- `admin@tabulacion.local`
- `Admin12345!`

## Flujo rapido

1. Completa la configuracion en la pestaña **Configuracion**.
2. Presiona **Generar**.
3. El backend Node genera:
   - `Tabulacion_base.csv`
   - `Tabulacion_generada.xlsx`
4. Descarga JSON y Excel de tabulacion desde la UI.

## Archivos importantes

- `app.py`: UI en Streamlit y orquestacion.
- `node_app/index.js`: generador Node (base + Excel).
- `Tabulacion.json`: configuracion base.
- `Tabulacion.xlsx`: plantilla original con graficos.

## Documentacion

- `DOCUMENTACION.md`: documentacion funcional.
- `GUIA_EXCEL.md`: detalles tecnicos de generacion del Excel.
- `ESTADO_TECNICO.md`: estado tecnico para continuidad.
