# Estado tecnico del proyecto

## Resumen ejecutivo

- La generacion de base y Excel esta migrada a Node.js (`node_app/generator.js`).
- `app.py` queda como UI/orquestador en Streamlit.
- Existe API HTTP Node (`node_app/server.js`) para frontend externo (Netlify).
- Existe frontend React en `frontend/` con estilo shadcn-like y consumo directo de la API.
- Se elimina dependencia operativa de `pywin32` y Excel COM.

## Objetivo vigente

- Configurar tabulacion desde web.
- Generar `Tabulacion_base.csv` y `Tabulacion_generada.xlsx`.
- Preservar graficos y formas de `Tabulacion.xlsx`.

## Flujo actual

1. Streamlit carga configuracion desde `Tabulacion.json`.
2. Usuario edita y valida en UI.
3. Boton **Generar**:
   - Guarda JSON.
   - Ejecuta Node (`node_app/index.js`).
   - Node genera base, correlacion y Excel final.
4. Streamlit consume resultados y habilita descargas.

## Flujo alterno (frontend externo)

1. Frontend (por ejemplo Netlify) envía `POST /generate` a la API Node.
2. API genera artefactos en memoria temporal y devuelve links con expiración.
3. Frontend descarga:
   - `GET /results/:id/xlsx`
   - `GET /results/:id/csv`

## Mejoras implementadas recientemente

- Generador Node robusto ante cambios de `cwd` (rutas basadas en `import.meta.url`).
- Validacion estricta de hojas requeridas y cabeceras `PRG.1`.
- Control de correlacion no valida (`NaN`) y requerimiento `muestra >= 2`.
- Estado UI consistente en errores (evita mostrar resultados viejos).
- Pestaña de tabulacion enfocada en el Excel generado.
- Correccion de descarga: `Tabulacion_generada.xlsx` como nombre de salida.
- Reemplazo automático del nombre de muestra en todas las hojas (incluye variantes tipo `Beneficiaross`).
- Dockerfile y `docker-compose.yml` para despliegue containerizado de la API.

## Dependencias

- Python: `streamlit`, `pandas`.
- Node.js 18+.
- Node package: `xlsx-populate`.

## Riesgos/pendientes

- No hay suite de tests automatizados (solo verificacion de sintaxis y pruebas manuales).
- El generador depende de nombres exactos de hojas y etiquetas de la plantilla.
- Si cambia estructura de `Tabulacion.xlsx`, se deben ajustar constantes/etiquetas en `node_app/generator.js`.

## Archivos clave

- `app.py`
- `node_app/index.js`
- `node_app/server.js`
- `node_app/generator.js`
- `frontend/`
- `Dockerfile`
- `docker-compose.yml`
- `Tabulacion.json`
- `Tabulacion.xlsx`
- `Tabulacion_generada.xlsx` (salida)
- `Tabulacion_base.csv` (salida)
