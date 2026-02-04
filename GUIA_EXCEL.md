# Guia de generacion del Excel

Esta guia describe como se genera el Excel final a partir de la plantilla `Tabulacion.xlsx`.

## Enfoque

- Se usa automatizacion de Excel con `pywin32`.
- Se abre la plantilla original.
- Se reemplazan valores de configuracion en hojas especificas.
- Se guarda una copia nueva conservando graficos y formas.

## Hojas utilizadas

- `Por Valoracion (3) Dimension`
- `Por Valoracion (3) Dimension 2`
- `Por conteo Dimension`
- `Por conteo Dimension 2`

## Actualizaciones principales

- **Variables y dimensiones**: se escriben los nombres configurados.
- **Escalas y respuestas**: se actualizan cantidades de escalas y limites.
- **Numero de preguntas**: se coloca por indicador segun configuracion.
- **Indicadores**: se reflejan en las tablas de conteo.

## Resultado

El archivo generado mantiene:

- Graficos y formas originales.
- Formulas existentes en las hojas.
- Estructura y estilos del Excel original.

## Integracion con la base generada

- La base de datos se genera automaticamente en la web.
- Esos valores se escriben en las hojas de variables principales.
- La misma base se usa para calcular el coeficiente de correlacion.

## Nota importante

Para que la generacion funcione:

- `Tabulacion.xlsx` debe estar en el mismo directorio que `app.py`.
- Debes tener Excel instalado localmente.
