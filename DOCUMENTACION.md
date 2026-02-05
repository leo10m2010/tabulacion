# Sistema de Tabulacion (Streamlit + Node)

Aplicacion web para configurar tabulacion y generar salidas finales sin editar manualmente JSON o Excel.

## Salidas del sistema

- `Tabulacion.json`: configuracion final.
- `Tabulacion_base.csv`: base generada automaticamente.
- `Tabulacion_generada.xlsx`: Excel final construido desde plantilla.

## Arquitectura actual (Node-only para generacion)

- Frontend/UI: `app.py` (Streamlit).
- Motor de generacion CLI: `node_app/index.js`.
- Motor API HTTP: `node_app/server.js`.
- Modulo reusable de generacion: `node_app/generator.js`.
- Libreria de Excel: `xlsx-populate`.

La UI guarda configuracion y delega toda la generacion al proceso Node.

## Requisitos

- Python 3.10+.
- Node.js 18+.
- Dependencias Python: `streamlit`, `pandas`.
- Dependencias Node: `xlsx-populate` (via `npm install` en `node_app/`).

Instalacion:

```bash
python -m pip install streamlit pandas
cd node_app && npm install
```

Ejecucion:

```bash
python -m streamlit run app.py
```

API Node (para frontend externo):

```bash
cd node_app
npm run api
```

Frontend React (Netlify):

```bash
cd frontend
npm install
npm run dev
```

## Flujo funcional

1. Se carga `Tabulacion.json` en la UI.
2. El usuario edita campos en **Configuracion**.
3. Al presionar **Generar**:
   - Se guarda `Tabulacion.json`.
   - Se ejecuta `node_app/index.js`.
   - Node genera `Tabulacion_base.csv`, calcula `r` y guarda `Tabulacion_generada.xlsx`.
4. La UI:
   - Muestra el coeficiente de correlacion.
   - Muestra vista previa de la base.
   - Habilita descargas de JSON y Excel generado.
5. La pestaña **Tabulacion Excel** muestra las hojas del Excel generado para inspeccion.

## Validaciones principales

- `muestra` debe ser `>= 2` (para correlacion valida).
- `item` y `itemv2` deben ser enteros `> 0`.
- `escala` y `respuesta` deben ser enteros `> 0`.
- Debe existir al menos una dimension.
- Si hay conteo de indicadores, debe coincidir con cantidad de nombres.

## Preservacion de graficos

- El archivo final se crea a partir de `Tabulacion.xlsx`.
- Solo se actualizan celdas de datos/etiquetas.
- Los elementos graficos existentes se mantienen en `Tabulacion_generada.xlsx`.

## Archivos clave

- `app.py`: UI, validaciones y orquestacion de ejecucion Node.
- `node_app/index.js`: generacion local por CLI.
- `node_app/server.js`: API HTTP para frontend externo.
- `node_app/generator.js`: logica central de generacion.
- `Tabulacion.xlsx`: plantilla de entrada.
- `Tabulacion.json`: configuracion editable.

## Modo Netlify + Docker

Para separar frontend/backend:

1. Publica `frontend/` en Netlify.
2. Despliega la API Node (`node_app/server.js`) en un contenedor Docker.
3. Configura `CORS_ORIGIN` con tu dominio Netlify.
4. El frontend llama `POST /generate` y luego descarga resultados desde `GET /results/:id/xlsx` y `GET /results/:id/csv`.
