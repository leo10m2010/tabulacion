# Estado tecnico del proyecto (para continuidad)

## Contexto

- Objetivo: app Streamlit para configurar tabulacion y generar `Tabulacion.json` y `Tabulacion.xlsx` (plantilla con graficos).
- Plataforma: Windows con Excel instalado.
- Restriccion clave: preservar dibujos/graficos del Excel usando automatizacion COM (`pywin32`).

## Arquitectura de la app

- Archivo principal: `app.py`.
- Entradas:
  - `Tabulacion.json` (config inicial).
  - `Tabulacion.xlsx` (plantilla).
- Salidas:
  - `Tabulacion.json` generado (desde UI).
  - `Tabulacion.xlsx` generado (desde plantilla via Excel COM).

## Flujo actual

1. UI carga config con `json.load`.
2. Usuario edita configuracion en pestaña **Configuracion**.
3. Boton **Generar**:
   - Genera base automatica con items de V1/V2.
   - Calcula correlacion Pearson (r) con suma V1 vs suma V2.
   - Construye Excel con plantilla y escribe valores (incluye la base generada).
4. UI muestra r en cuadro verde y habilita descargas.

## Logica de correlacion

- `generate_base_data(config_state)`:
  - Usa `muestra`, `item`, `itemv2`, `respuesta`.
  - Crea columnas `V1_1..V1_n` y `V2_1..V2_m`.
  - Ajusta valores para lograr r alto:
    - Normal: r cercano a +1.
    - Inversa: r cercano a -1.
- `compute_correlation(df_base, config_state)`:
  - Suma columnas V1 y V2 por fila.
  - Pearson entre ambas sumas.

## Excel (preservar graficos)

- `build_excel_from_template(config_state, base_df)` usa COM:
  - `pythoncom.CoInitialize()`.
  - `win32.DispatchEx("Excel.Application")`.
  - Escribe valores en hojas:
    - `Gesti\u00f3n de abastecimiento` (V1).
    - `Satisfacci\u00f3n de los comit\u00e9s d` (V2).
    - `Por Valoracion (3) Dimension`.
    - `Por Valoracion (3) Dimension 2`.
    - `Por conteo Dimension`.
    - `Por conteo Dimension 2`.
  - Guarda copia temporal y devuelve bytes.

## UI/UX actual

- Barra de progreso con pasos: base -> correlacion -> Excel.
- Coeficiente r en caja verde, texto blanco, grande.
- Vista previa de base (top 10 filas).
- Pesta\u00f1a **Tabulacion Excel** solo para consulta.

## Dependencias

- `streamlit`, `pandas`, `openpyxl`, `pywin32`.
- Excel instalado en Windows.

## Errores corregidos (resumen tecnico)

- COM: `CoInitialize` requerido para evitar `com_error`.
- Constantes: `xlWhole`/`xlValues` con fallback numerico.
- JSON: lectura con `json.load` para evitar warning.
- Excel graficos: openpyxl eliminaba dibujos; COM preserva.

## Ubicaciones clave en codigo

- Generacion base: `generate_base_data`.
- Correlacion: `compute_correlation`.
- Excel COM: `build_excel_from_template`.
- UI principal: bloque `with tab_config:`.

## Mapa de funciones (resumen)

- `load_config()` -> carga JSON base. (`app.py`:13)
- `_to_int_list()` -> normaliza listas numericas. (`app.py`:22)
- `parse_dimension_counts()` -> calcula conteo de items por dimension. (`app.py`:39)
- `build_dimension_slices()` -> divide columnas por dimension. (`app.py`:58)
- `load_excel_sheets()` -> carga hojas del Excel para vista. (`app.py`:72)
- `build_config_tables()` -> tablas resumen en UI. (`app.py`:78)
- `get_config_state()` -> cache en `st.session_state`. (`app.py`:101)
- `update_list_field()` -> actualiza listas en config. (`app.py`:107)
- `update_scalar_field()` -> actualiza escalares en config. (`app.py`:111)
- `list_editor()` -> editor de listas en UI. (`app.py`:118)
- `apply_config_from_json()` -> reemplazo completo desde JSON. (`app.py`:127)
- `get_item_counts()` -> items V1/V2. (`app.py`:135)
- `generate_base_data()` -> crea base automatica con alta correlacion. (`app.py`:143)
- `compute_correlation()` -> Pearson sobre sumas V1/V2. (`app.py`:215)
- `build_excel_from_template()` -> escribe plantilla con Excel COM. (`app.py`:236)
