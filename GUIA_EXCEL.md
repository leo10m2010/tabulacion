# Guía de generación del Excel

Cómo `node_app/generator.js` construye `Tabulacion_generada.xlsx` **100% por código** (sin plantilla, sin COM ni Excel instalado): `xlsx-populate` escribe celdas, fórmulas, estilos y merges; `jszip` post-procesa el paquete OOXML para deduplicar estilos e inyectar los gráficos.

## Enfoque

- Cada generación construye el libro completo adaptado a la configuración: cualquier muestra (2–2,000), cualquier cantidad de opciones de escala, de niveles de baremo y de dimensiones/indicadores/ítems (hasta 60 ítems por variable).
- Todas las celdas calculadas usan **fórmulas reales de Excel** protegidas con `IFERROR`/`IF`: con la base vacía no aparece ningún `#DIV/0!`, `#N/A`, `#REF!` ni `#VALUE!`. Excel recalcula todo al abrir.
- Con `conDatos: "1"` (default) la base se llena con datos simulados (correlación objetivo |r| ≥ 0.9, signo según `relacionversa`). Con `conDatos: "0"` queda vacía, lista para ingreso manual.

## Hojas generadas

Por cada variable:

1. **`<Variable>`** (hoja base)
   - Fila 1: encabezado de variable; fila 2: dimensiones combinadas; fila 3: indicadores combinados; fila 4: códigos `P1..Pn` (numeración continua entre variables).
   - Base de datos con ID 1..N y formato alterno gris, más columnas **Total** (suma del encuestado) y **Valoración** (clasificación por el baremo de la variable) al final de cada fila.
   - Estadísticos por ítem: `SUM`, `MODE.SNGL`, `AVERAGE`, `MEDIAN`, `STDEV.S` y coeficiente de variación (2 decimales).
   - Frecuencias absolutas (`COUNTIF`) y porcentajes por opción de escala, con filas Total.

2. **`Ítems <Variable>`** — un bloque por ítem (formato de tesis, marco verde):
   - Encabezado amarillo "Ítem N", rótulo "Tabla N" + texto del ítem.
   - Tabla escala | Frec. | % que referencia las frecuencias de la hoja base.
   - "Elaboración: Propia" / "Fuente: Encuesta aplicada", gráfico de barras, "Figura N" + caption.
   - **Interpretación narrativa automática** redactada con los porcentajes reales de los datos generados.

3. **`Dimensiones <Variable>`** — un bloque por dimensión más un bloque consolidado de la variable:
   - Ficha de baremo (11 campos) y tabla de niveles (rangos calculados con amplitud = rango/niveles, o tomados de `desde`/`hasta` para el consolidado).
   - Base de la dimensión que **referencia la hoja base** (`=IF('Var'!B5="","",'Var'!B5)`): al editar respuestas todo se actualiza.
   - Suma Total por encuestado y Valoración con `IF` anidado según el baremo.
   - "Tabla N" + tabla baremada (Calificación | Desde | Hasta | f | %), fuente, gráfico al costado, "Figura N" y narrativa con el nivel predominante.

4. **`Conteo <Variable>`** — un bloque por dimensión: respuestas agregadas de todos los ítems de la dimensión (`COUNTIF` sobre el rango 2D de la hoja base), % sobre N×ítems, gráfico, Figura y narrativa.

Globales: **`Relaciones`** (tabla de sumas por encuestado referenciando las hojas de dimensiones + una tabla única de pruebas de normalidad KS-Lilliefors/Shapiro-Wilk sobre V1 total, V2 total y las dimensiones de V1 —calculada por el generador con la base simulada; en blanco para SPSS con `conDatos: "0"`— con narrativa que decide Pearson o Rho de Spearman según los Sig. (todos ≥ 0.05 → Pearson; alguno < 0.05 → Spearman), y tablas de correlación —general V1-V2 y cada dimensión de V1 contra V2— con `CORREL` y Sig. bilateral vía `T.DIST.2T`; con Spearman se agregan columnas de rangos `RANK.AVG`), **`Correlación`** (r o rho vivo, r², interpretación automática y criterio) e **`Información`** (escala, niveles, instrucciones).

Los nombres de hoja se truncan a 31 caracteres y se desambiguan si colisionan.

## Post-procesado OOXML

`postProcessWorkbook()` abre el zip del xlsx y:

1. **Deduplica estilos**: xlsx-populate crea una entrada de estilo por celda (~30k con muestras grandes); se deduplican `fonts`/`fills`/`borders`/`cellXfs` y se remapean los índices `s=` de cada hoja (styles.xml: de ~10 MB a ~5 KB). También normaliza `<fill/>` vacíos.
2. **Inyecta gráficos**: escribe `xl/charts/chartN.xml` (barras, etiquetas de datos, Arial), `xl/drawings/drawingN.xml` (anclajes `twoCellAnchor`), sus `.rels`, la relación y el tag `<drawing>` en cada hoja, y los Overrides en `[Content_Types].xml`.

## Notas

- La correlación que reporta la API se calcula en JS sobre las sumas de ítems simulados; la hoja `Correlación` la calcula además con fórmula para que siga viva al editar datos.
- El CLI (`node index.js [config] [salida.xlsx] [--sin-datos]`) usa `Tabulacion.json` por defecto; `npm run plantilla` genera la variante con base vacía.
