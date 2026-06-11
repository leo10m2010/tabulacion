# Backend Node (Generador + API)

Este módulo tiene dos modos:

- `generate`: genera archivos locales (`Tabulacion_generada.xlsx` y `Tabulacion_base.csv`).
- `api`: expone endpoints HTTP para un frontend externo (por ejemplo, Vercel).

## Requisitos

- Node.js 18+. El Excel se genera completo por código (no requiere plantilla ni Excel instalado).

## Instalación

```bash
cd node_app
npm install
```

## Uso local (CLI)

```bash
npm run generate                       # usa ../Tabulacion.json
node index.js mi-config.json salida.xlsx
npm run plantilla                      # base vacía para ingreso manual
```

Resultado:

- `Tabulacion_generada.xlsx` (o la ruta indicada)
- `Tabulacion_base.csv`

## API HTTP

```bash
npm run api
```

Variables de entorno: ver la tabla completa en el `README.md` de la raíz (incluye `AUTH_TOKEN_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, rate limiting, etc.).

## Tests

```bash
npm test
```

### Endpoints

- `GET /health`
- `POST /auth/login`, `GET /auth/me`
- `GET|POST /auth/users`, `PATCH|DELETE /auth/users/:id` (solo admin)
- `GET /template-info` (límites del generador)
- `POST /generate` (autenticado)
- `GET /results/:id`, `GET /results/:id/xlsx`, `GET /results/:id/csv`, `DELETE /results/:id`

### `POST /generate`

Requiere `Authorization: Bearer <token>` (obtenido en `/auth/login`). Puedes enviar el JSON de configuración directo, o dentro de `{ "config": { ... } }`. La respuesta incluye `correlation` (`null` con 1 variable) y `warnings`.

Opcional:

- `responseMode: "links"` (default): devuelve links temporales de descarga.
- `responseMode: "inline"`: devuelve `excelBase64` + `baseCsv` en la misma respuesta.

Ejemplo:

```json
{
  "config": {
    "muestra": "289",
    "item": "18",
    "itemv2": "9",
    "respuesta": "5",
    "relacionversa": "0",
    "nommuestra": "Ganadores"
  },
  "responseMode": "links"
}
```

## Ejemplo frontend (Vercel)

```js
const apiBase = "https://tu-api.com";

const loginRes = await fetch(`${apiBase}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const { token } = await loginRes.json();

const generateRes = await fetch(`${apiBase}/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ config }),
});
const data = await generateRes.json();

console.log("r =", data.correlation, data.warnings);
window.open(data.links.xlsx, "_blank");
```

