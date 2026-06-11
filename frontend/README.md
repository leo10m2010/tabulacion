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

El frontend requiere autenticación para generar tabulación. Cualquier usuario
activo con suscripción vigente puede generar; la gestión de usuarios
(pestaña `Usuarios`) es solo para administradores.

El admin inicial lo crea la API en el primer arranque con `ADMIN_EMAIL` /
`ADMIN_PASSWORD`; si no defines contraseña, se genera una aleatoria y se
imprime una sola vez en la consola de la API.

## Build

```bash
npm run build
```

## Vercel

- New Project → este repositorio → **Root Directory: `frontend`** (Vite se autodetecta).
- Env var: `VITE_API_BASE_URL=https://tu-api.onrender.com` (la URL del servicio de Render).
- `vercel.json` ya incluye el rewrite del SPA.
