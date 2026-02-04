# Sistema de Tabulacion (Streamlit)

Esta app es una version web del sistema de tabulacion que viste en las capturas. La idea es que completes toda la configuracion desde la web y al final obtengas exactamente los mismos archivos de salida:

- `Tabulacion.json` con toda la configuracion.
- `Tabulacion.xlsx` generado desde la plantilla original, manteniendo graficos y formas.

## Objetivo del sistema

- Centralizar la configuracion de la tabulacion en una sola pagina web.
- Evitar editar manualmente el JSON y el Excel.
- Conservar los graficos del Excel final como en el sistema original.

## Requisitos

- Windows con Microsoft Excel instalado.
- Python 3.10+.
- Librerias: `streamlit`, `pandas`, `openpyxl`, `pywin32`.

Instalacion recomendada:

```bash
python -m pip install streamlit pandas openpyxl pywin32
```

## Archivos clave

- `app.py`: aplicacion principal en Streamlit.
- `Tabulacion.json`: configuracion base (entrada y salida).
- `Tabulacion.xlsx`: plantilla de Excel con graficos y hojas predefinidas.

## Como funciona la web (resumen ejecutivo)

La app tiene dos pestañas principales:

1. **Configuracion**: aqui se edita todo lo necesario para la tabulacion. La app guarda los cambios en memoria y permite generar la base, calcular correlacion y descargar archivos.
2. **Tabulacion Excel**: muestra todas las hojas del Excel como tablas para consulta.

## Pestaña Configuracion (detalle)

### 1) Parametros generales

Se llenan los datos base que aparecen en la parte superior de la web original:

- Nombre de muestra.
- Numero de muestra.
- Numero de variables.
- Numero de items por variable (V1 y V2).
- Cantidad de escalas.
- Numero de respuestas.
- Relacion inversa.

Estos datos se guardan en el JSON y se usan para completar textos clave en el Excel.

### 2) Escalas y respuestas

Permite editar los textos de las escalas (Bajo, Medio, Alto) y las respuestas (Totalmente en desacuerdo, etc.).

Se guardan en:

- `nombre_escala`
- `nombre_respuesta`

### 3) Baremos

Define los rangos de interpretacion con:

- `desde`
- `hasta`
- `porcentaje`
- `cantidad`

Estos valores quedan en el JSON para futuras interpretaciones y en el Excel para mostrar tablas.

### 4) Dimensiones e indicadores

Permite definir:

- `nombre_dimension`
- `numero_dimension`
- `nombre_indicador`
- `numero_indicador0`

Estos valores se reflejan en las hojas de conteo y valoracion del Excel.

### 5) Numero de preguntas por indicador

Campos:

- `numero_pregunta0`
- `numero_pregunta1`

Se usan en las hojas de valoracion para mostrar el numero de preguntas por dimension o indicador.

### 6) Edicion avanzada

Un editor de JSON completo que permite pegar o ajustar todo el contenido en bruto. Al aplicar, el sistema reemplaza toda la configuracion con ese JSON.

### 7) Generar y descargas

- **Generar**: crea la base de datos automaticamente, calcula la correlacion Pearson y habilita las descargas.
- **Barra de progreso**: indica cada paso (base, correlacion, Excel) con mensajes.
- **Coeficiente r**: se muestra en un cuadro verde y grande.
- **Descargar JSON**: guarda el `Tabulacion.json` con la configuracion actual.
- **Descargar Excel completo (plantilla)**: genera un nuevo Excel manteniendo graficos y estructura.

Las descargas aparecen despues de presionar **Generar**.

Nota sobre la base de datos generada:

- Se crea automaticamente usando `muestra`, `item` y `itemv2`.
- La base se arma con items de V1 y luego items de V2.
- Se busca una correlacion alta: cerca de +1 si no es inversa, cerca de -1 si es inversa.

## Pestaña Tabulacion Excel

Muestra cada hoja del Excel en modo tabla para que puedas revisar si la plantilla contiene lo esperado. Esta vista es solo de consulta.

## Como se genera el Excel (detalle tecnico)

- Se abre `Tabulacion.xlsx` usando automatizacion COM (`pywin32`).
- Se ubican campos clave por texto (por ejemplo, "N° de Personas", "Variable", "Cantidad de Escalas Valorativas").
- Se escriben los valores de configuracion en las celdas adyacentes.
- Se guardan los cambios en un nuevo archivo.
- Los graficos y formas se conservan porque Excel mismo realiza el guardado.

## Como se genera la base de datos y correlacion

- Se genera una base automatica con `muestra` filas.
- Las columnas se crean como `V1_1..V1_n` y `V2_1..V2_m`.
- Los valores se ajustan para lograr una correlacion alta segun el tipo de relacion.
- La correlacion se calcula con Pearson usando la suma de V1 y la suma de V2 por fila.

## Flujo de trabajo recomendado

1. Abre la app.
2. Completa los campos de configuracion.
3. Presiona **Generar** para crear la base y el coeficiente.
4. Revisa el coeficiente de correlacion mostrado.
5. Descarga el JSON y el Excel completo (plantilla).

## Notas de continuidad

Si retomas el proyecto despues:

- La app siempre carga `Tabulacion.json` como configuracion inicial.
- `Tabulacion.xlsx` siempre debe estar en el mismo directorio.
- La generacion de Excel depende de `pywin32` y Excel instalado.

## Diagrama de flujo

```text
Inicio
  |
  v
Cargar Tabulacion.json
  |
  v
Mostrar formulario de configuracion
  |
  v
Usuario edita campos
  |
  v
Generar base de datos automatica
  |
  v
Calcular correlacion Pearson
  |
  +--> Descargar JSON -------------+
  |                                |
  |                                v
  |                         Guardar Tabulacion.json
  |
  +--> Descargar Excel (plantilla) -----+
                                        |
                                        v
                              Abrir Tabulacion.xlsx (Excel COM)
                                        |
                                        v
                              Escribir valores de configuracion
                                        |
                                        v
                              Guardar nuevo Tabulacion.xlsx
```

## Estructura del JSON (resumen)

Ejemplo de estructura base:

```json
{
  "muestra": "289",
  "item": "18",
  "variable": "2",
  "nommuestra": "Beneficiaros",
  "escala": "3",
  "nombre_escala": ["Bajo", "Medio", "Alto"],
  "respuesta": "5",
  "nombre_respuesta": [
    "Totalmente en desacuerdo",
    "En desacuerdo",
    "Ni de acuerdo ni en desacuerdo",
    "De acuerdo",
    "Totalmente de acuerdo"
  ],
  "desde": ["18", "42", "66"],
  "hasta": ["41", "65", "90"],
  "porcentaje": ["46", "35", "19"],
  "cantidad": ["133", "101", "55"],
  "nombre_dimension": [
    "Gestion de abastecimiento",
    "Satisfaccion de los comites del Programa Vaso de Leche"
  ],
  "numero_indicador0": ["3", "1"],
  "nombre_indicador": [
    "Planificacion",
    "Transparencia",
    "Cumplimiento normativo",
    "Satisfaccion del servicio"
  ],
  "numero_pregunta0": ["6", "6", "6"],
  "numero_pregunta1": ["9"]
}
```

Campos clave (resumen):

- `muestra`, `item`, `variable`, `nommuestra`: datos generales.
- `escala`, `nombre_escala`: escalas de valoracion.
- `respuesta`, `nombre_respuesta`: respuestas del instrumento.
- `desde`, `hasta`, `porcentaje`, `cantidad`: baremos.
- `nombre_dimension`, `numero_dimension`: dimensiones.
- `nombre_indicador`, `numero_indicador0`: indicadores por dimension.
- `numero_pregunta0`, `numero_pregunta1`: preguntas por indicador/variable.

## Checklist de configuracion

Antes de generar el Excel final, verifica:

- [ ] Nombre de muestra correcto.
- [ ] N° de muestra y N° de variables correctos.
- [ ] N° de items por variable (V1 y V2) correcto.
- [ ] Cantidad de escalas y respuestas correcta.
- [ ] Textos de escalas y respuestas revisados.
- [ ] Baremos (desde/hasta/porcentaje/cantidad) completos.
- [ ] Dimensiones e indicadores completos.
- [ ] Numero de preguntas por indicador completo.
- [ ] JSON descargado para respaldo.
