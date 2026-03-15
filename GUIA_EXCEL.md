# Guia de generacion del Excel

Esta guia describe como se genera el Excel final a partir de la plantilla `Tabulacion.xlsx`.

## Enfoque

- El motor de generacion es Node.js (`node_app/index.js`).
- Se usa `xlsx-populate` para abrir la plantilla y escribir solo celdas de datos.
- El resultado se guarda en `Tabulacion_generada.xlsx`.
- No se usa automatizacion COM ni `pywin32`.

## Preservacion de graficos

- La plantilla original se mantiene como base.
- El proceso actualiza valores en hojas objetivo y no recrea graficos.
- Los graficos, formas y formulas existentes se conservan al guardar el nuevo archivo.

## Hojas objetivo

- `Gestión de abastecimiento` (items V1).
- `Satisfacción de los comités d` (items V2).
- `Por Valoracion (3) Dimension`.
- `Por Valoracion (3) Dimension 2`.
- `Por conteo Dimension`.
- `Por conteo Dimension 2`.

## Integracion con la base generada

- En la misma ejecucion se genera `Tabulacion_base.csv`.
- Se calcula la correlacion de Pearson sobre sumas V1 y V2.
- El valor `r` se devuelve a la UI para mostrarlo en pantalla.

## Requisitos tecnicos

- `Tabulacion.xlsx` debe existir en la raiz del proyecto.
- `Tabulacion.json` debe tener una configuracion valida.
- Node.js 18+ con dependencias instaladas (`cd node_app && npm install`).
