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
- `GET /template-info` (límites del generador y temas de gráficos disponibles)
- `POST /generate` (autenticado)
- `GET /results/:id`, `GET /results/:id/xlsx`, `GET /results/:id/csv`, `DELETE /results/:id`

### `POST /generate`

Requiere `Authorization: Bearer <token>` (obtenido en `/auth/login`). Puedes enviar el JSON de configuración directo, o dentro de `{ "config": { ... } }`. La respuesta incluye `correlation` (`null` con 1 variable) y `warnings`.

Opcional:

- `responseMode: "links"` (default): devuelve links temporales de descarga.
- `responseMode: "inline"`: devuelve `excelBase64` + `baseCsv` en la misma respuesta, más `chartsPreview` (datos de cada gráfico por hoja, para renderizar la vista previa), `tema` y `correlationControl`.
- `config.tema`: tema de color de los gráficos del Excel (`clasico`, `powerbi`, `ejecutivo`, `esmeralda`, `atardecer`, `monocromo`; default `clasico`). Los temas disponibles se listan en `GET /template-info`.
- `config.controlCorrelacion`: `"1"` (default) controla la correlación de los datos simulados; `"0"` la deja como resultado natural.
- `config.nivelCorrelacion`: nivel objetivo cuando el control está activado — `muy_alta` (±0.90-1.00, default), `alta` (±0.70-0.89), `moderada` (±0.40-0.69), `baja` (±0.20-0.39), `muy_baja` (±0.01-0.19), `nula` (≈0). El signo lo define `relacionversa` (directa/inversa); los niveles se listan en `GET /template-info`.
- `config.metodoCorrelacion`: `auto` (default: la prueba de normalidad del Excel decide entre Pearson y Spearman), `spearman` o `pearson` (fuerzan el método en las hojas Relaciones/Correlación con narrativa justificada; con `pearson` los datos se generan con distribuciones compatibles con normalidad). La verificación del objetivo usa Spearman en `auto`/`spearman` y Pearson en `pearson`. La respuesta incluye `correlationControl` con: activo, nivel, dirección, método, correlación obtenida, rango esperado y si cumple; el mismo resumen se escribe en la hoja "Información" del Excel. Función pensada para datos simulados (pruebas y demostraciones académicas).

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

