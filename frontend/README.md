# Frontend Tabulacion (React + Vite)

Frontend web con estilo shadcn-like para configurar y generar tabulacion consumiendo la API Node.

## Desarrollo local

```bash
npm install
npm run dev
```

## Variables

Crea `.env` a partir de `.env.example`:

```bash
VITE_API_BASE_URL=http://localhost:8080
```

## Login

El frontend ahora requiere autenticación para generar tabulación.
La configuración, generación y descarga están visibles solo para rol `admin`.

- Usuario inicial local: `admin@tabulacion.local`
- Clave inicial local: `Admin12345!`

Ese usuario admin puede crear usuarios y asignar suscripción por días desde la pestaña `Usuarios`.

## Build

```bash
npm run build
```

## Netlify

- Base directory: `frontend`
- Build command: `npm run build`
- Publish directory: `dist`
- Env var: `VITE_API_BASE_URL=https://tu-api.com`

El archivo `netlify.toml` ya incluye redirect SPA.
