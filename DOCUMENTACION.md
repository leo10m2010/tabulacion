# Documentación funcional

Guía del flujo de uso y del contrato del JSON de configuración. Para instalación, variables de entorno y despliegue, ver `README.md`.

## Flujo de uso (frontend)

1. **Login** con email y contraseña. Cualquier usuario activo con suscripción vigente puede generar tabulaciones; la gestión de usuarios es solo para administradores.
2. **Paso 1 — Tu encuesta**: número de variables (1 o 2), nombre y tamaño de la muestra, opciones por pregunta, preguntas/dimensiones/niveles de baremo por variable, dirección de la relación (directa/inversa).
3. **Paso 2 — Escalas y estructura**: opciones de respuesta, baremos por variable (los rangos y cantidades se calculan automáticamente; los porcentajes deben sumar 100%), y estructura jerárquica dimensión → indicador → ítem de cada variable.
4. **Paso 3 — Generar**: resumen, selector de tema de gráficos (paletas estilo Power BI aplicadas al Excel y a la vista previa), validaciones (incluye los límites del generador obtenidos de `GET /template-info`) y generación. Se muestran la correlación de Pearson (si hay 2 variables), los avisos del generador, la vista previa por hoja con sus gráficos (renderizados con ECharts a partir de `chartsPreview`), y las descargas de Excel, CSV y JSON.

## Contrato del JSON de configuración

Campos escalares (strings numéricos):

- `muestra` — encuestados (2 a 2,000).
- `variable` — `"1"` o `"2"`.
- `item` / `itemv2` — preguntas por variable (máx. 60 por variable).
- `escala` / `escala_v2` — niveles del baremo por variable.
- `respuesta` — opciones por pregunta (escala Likert).
- `relacionversa` — `"0"` directa, `"1"` inversa.
- `nommuestra` — etiqueta de los encuestados (se muestra en la hoja Información).
- `conDatos` — `"1"` (default) llena la base con datos simulados; `"0"` la deja vacía para ingreso manual.

Listas (arrays de strings):

- `nombre_respuesta` — etiquetas de las opciones de respuesta.
- `nombre_escala` / `nombre_escala_v2` — nombres de los niveles del baremo.
- `desde`, `hasta`, `porcentaje`, `cantidad` (+ sufijo `_v2`) — baremo por variable.
- `nombre_dimension` — nombres de las dos **variables** (etiquetas en el Excel).
- `desde` / `hasta` (+ `_v2`) — rangos del baremo **de la variable completa** (bloque consolidado); los baremos por dimensión se calculan solos (amplitud = rango/niveles).

Estructura jerárquica (objetos anidados):

- `estructura_v1` / `estructura_v2` — `[{ nombre, indicadores: [{ nombre, items }] }]`: dimensiones con sus indicadores y número de ítems. Es la fuente preferida; si falta, se usa `nombre_dims_v*` + `items_por_dim_v*` (un indicador por dimensión).
- `nombre_items_v1` / `nombre_items_v2` — textos de los ítems (se usan en los títulos de los gráficos por ítem).

`Tabulacion.json` (raíz) es la configuración del modo CLI y sirve como ejemplo completo.

## Resultado

- `Tabulacion_generada.xlsx`: Excel construido por código. Por variable: hoja base (datos, estadísticos, frecuencias y porcentajes), `Ítems <Variable>` (tabla, gráfico, Tabla/Figura, fuente y narrativa por ítem), `Dimensiones <Variable>` (tabla ancha Suma/Nivel/Código por dimensión y consolidado referenciando la hoja base, fichas de baremo, tabla baremada con gráfico, narrativa y bloque consolidado) y `Conteo <Variable>` (agregado por dimensión). Más `Relaciones` (normalidad calculada sobre V1 total, V2 total y dimensiones de V1; correlaciones Pearson o Rho de Spearman según los Sig.: general V1-V2 y cada dimensión de V1 contra V2), `Correlación` e `Información` (con 2 variables).
- `Tabulacion_base.csv`: la base generada (columnas `V1_n`/`V2_n`, una fila por encuestado; solo cabecera con `conDatos: "0"`).
- `correlation`: correlación de Pearson entre las sumas de V1 y V2 (`null` con una sola variable o sin datos).
- `correlationControl`: resultado del control opcional de correlación de la simulación (activado/desactivado, nivel elegido, dirección directa/inversa tomada del paso de relación, método Spearman/Pearson, correlación obtenida, rango esperado y si cumple). Con el control desactivado la correlación es el resultado natural de los datos. Solo para datos simulados (pruebas y demostraciones académicas).
- `warnings`: avisos del generador (p. ej. una sola variable).

## Validaciones

- `muestra >= 2`; `item`, `itemv2`, `escala`, `respuesta` enteros > 0.
- Límites: muestra ≤ 2,000 e ítems ≤ 60 por variable (el backend los rechaza con error explícito; el frontend los valida antes vía `/template-info`).
- Porcentajes de cada baremo deben sumar 100%.
- La estructura jerárquica debe usar exactamente el número de ítems declarado.
