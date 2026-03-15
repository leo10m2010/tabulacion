# Backend Node (Generador + API)

Este módulo tiene dos modos:

- `generate`: genera archivos locales (`Tabulacion_generada.xlsx` y `Tabulacion_base.csv`).
- `api`: expone endpoints HTTP para un frontend externo (por ejemplo, Netlify).

## Requisitos

- Node.js 18+.
- `Tabulacion.xlsx` en la raíz del proyecto.

## Instalación

```bash
cd node_app
npm install
```

## Uso local (CLI)

```bash
npm run generate
```

Resultado:

- `Tabulacion_generada.xlsx`
- `Tabulacion_base.csv`

## API HTTP

```bash
npm run api
```

Variables opcionales:

- `PORT` (default: `8080`)
- `TEMPLATE_PATH` (default: `../Tabulacion.xlsx`)
- `CORS_ORIGIN` (default: `*`)
- `RESULT_TTL_SECONDS` (default: `900`)
- `MAX_BODY_BYTES` (default: `4194304`)
- `PUBLIC_BASE_URL` (opcional, para construir links públicos en respuestas)

### Endpoints

- `GET /health`
- `POST /generate`
- `GET /results/:id`
- `GET /results/:id/xlsx`
- `GET /results/:id/csv`
- `DELETE /results/:id`

### `POST /generate`

Puedes enviar el JSON de configuración directo, o dentro de `{ "config": { ... } }`.

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

## Ejemplo frontend (Netlify)

```js
const apiBase = "https://tu-api.com";

const generateRes = await fetch(`${apiBase}/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ config }),
});
const data = await generateRes.json();

console.log("r =", data.correlation);
window.open(data.links.xlsx, "_blank");
```
