import json
import os
import re
import subprocess

import pandas as pd
import streamlit as st


st.set_page_config(page_title="Sistema de Tabulacion", layout="wide")

CONFIG_PATH = "Tabulacion.json"
TEMPLATE_XLSX_PATH = "Tabulacion.xlsx"
GENERATED_XLSX_PATH = "Tabulacion_generada.xlsx"
BASE_CSV_PATH = "Tabulacion_base.csv"


@st.cache_data(show_spinner=False)
def load_config(config_path, cache_token):
    _ = cache_token
    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        return data
    return {}


def _to_int_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        out = []
        for item in value:
            try:
                out.append(int(str(item).strip()))
            except ValueError:
                continue
        return out
    try:
        return [int(str(value).strip())]
    except ValueError:
        return []


@st.cache_data(show_spinner=False)
def load_excel_sheets(excel_path, cache_token):
    _ = cache_token
    return pd.read_excel(excel_path, sheet_name=None)


def build_config_tables(config):
    scalar_fields = {}
    list_fields = {}
    for key, value in config.items():
        if isinstance(value, list):
            list_fields[key] = value
        else:
            scalar_fields[key] = value

    scalar_df = pd.DataFrame(
        [{"Campo": k, "Valor": v} for k, v in scalar_fields.items()]
    )
    list_df = pd.DataFrame()
    if list_fields:
        max_len = max(len(v) for v in list_fields.values())
        padded = {}
        for key, values in list_fields.items():
            padded[key] = list(values) + [None] * (max_len - len(values))
        list_df = pd.DataFrame(padded)

    return scalar_df, list_df


def get_config_state(default_config):
    if "config_state" not in st.session_state:
        st.session_state.config_state = default_config.copy()
    return st.session_state.config_state


def update_list_field(config_state, key, values):
    config_state[key] = ["" if v is None else str(v) for v in values]


def update_scalar_field(config_state, key, value):
    if value is None:
        config_state[key] = ""
    else:
        config_state[key] = str(value)


def list_editor(label, values, numeric=False):
    df = pd.DataFrame({label: values})
    edited = st.data_editor(df, use_container_width=True, num_rows="dynamic")
    series = edited[label]
    if numeric:
        return [str(v) for v in series if pd.notna(v)]
    return [str(v) for v in series if pd.notna(v)]


def apply_config_from_json(raw_text, config_state):
    data = json.loads(raw_text)
    if isinstance(data, dict):
        config_state.clear()
        config_state.update(data)
        return True
    return False


def resolve_excel_preview_path():
    generated_path = os.path.abspath(GENERATED_XLSX_PATH)
    if os.path.exists(generated_path):
        return generated_path, "tabulacion generada"
    template_path = os.path.abspath(TEMPLATE_XLSX_PATH)
    if os.path.exists(template_path):
        return template_path, "plantilla base"
    return None, None


st.sidebar.title("Sistema de Tabulacion")

try:
    config_token = int(os.path.getmtime(CONFIG_PATH)) if os.path.exists(CONFIG_PATH) else 0
    config = load_config(CONFIG_PATH, config_token)
except Exception:
    config = {}

config_state = get_config_state(config)

if "excel_preview_path" not in st.session_state:
    preview_path, _ = resolve_excel_preview_path()
    st.session_state["excel_preview_path"] = preview_path

st.title("Sistema de Tabulacion")

tab_config, tab_excel = st.tabs([
    "Configuracion",
    "Tabulacion Excel",
])

with tab_config:
    st.subheader("Configuracion base")
    st.subheader("Parametros generales")
    col1, col2, col3 = st.columns(3)
    with col1:
        update_scalar_field(
            config_state,
            "nommuestra",
            st.text_input(
                "Nombre de muestra",
                value=str(config_state.get("nommuestra", "")),
                help="Etiqueta que aparece en las filas del Excel (ej: Beneficiaros).",
            ),
        )
        update_scalar_field(
            config_state,
            "muestra",
            st.text_input(
                "N° de muestra",
                value=str(config_state.get("muestra", "")),
                help="Cantidad de registros que se generaran en la base.",
            ),
        )
        update_scalar_field(
            config_state,
            "variable",
            st.text_input(
                "N° de variables",
                value=str(config_state.get("variable", "")),
                help="Numero de variables totales (usado como referencia).",
            ),
        )
    with col2:
        update_scalar_field(
            config_state,
            "item",
            st.text_input(
                "N° de items (V1)",
                value=str(config_state.get("item", "")),
                help="Cantidad de preguntas para la variable 1.",
            ),
        )
        update_scalar_field(
            config_state,
            "itemv2",
            st.text_input(
                "N° de items (V2)",
                value=str(config_state.get("itemv2", "")),
                help="Cantidad de preguntas para la variable 2.",
            ),
        )
        update_scalar_field(
            config_state,
            "escala",
            st.text_input(
                "Cantidad de escalas",
                value=str(config_state.get("escala", "")),
                help="Numero de niveles de la escala (ej: 3).",
            ),
        )
    with col3:
        update_scalar_field(
            config_state,
            "respuesta",
            st.text_input(
                "N° de respuestas",
                value=str(config_state.get("respuesta", "")),
                help="Maximo valor posible por item (ej: 5).",
            ),
        )
        relacion_raw = str(config_state.get("relacionversa", "0")).strip().lower()
        relacion_idx = 1 if relacion_raw in {"1", "si", "sí", "true", "inversa"} else 0
        relacion_label = st.radio(
            "Relacion",
            ["No inversa", "Inversa"],
            index=relacion_idx,
            horizontal=True,
            help="Define si la correlacion esperada es positiva o negativa.",
        )
        update_scalar_field(config_state, "relacionversa", "1" if relacion_label == "Inversa" else "0")

    st.subheader("Escalas y respuestas")
    col_a, col_b = st.columns(2)
    with col_a:
        st.caption("Nombres visibles de los niveles de la escala.")
        escala_names = list_editor("Nombre escala", config_state.get("nombre_escala", []))
        update_list_field(config_state, "nombre_escala", escala_names)
    with col_b:
        st.caption("Textos de cada opcion de respuesta.")
        respuesta_names = list_editor("Nombre respuesta", config_state.get("nombre_respuesta", []))
        update_list_field(config_state, "nombre_respuesta", respuesta_names)

    st.subheader("Baremos")
    col_c, col_d, col_e = st.columns(3)
    with col_c:
        st.caption("Rangos minimos por nivel.")
        desde_vals = list_editor("Desde", config_state.get("desde", []), numeric=True)
        update_list_field(config_state, "desde", desde_vals)
    with col_d:
        st.caption("Rangos maximos por nivel.")
        hasta_vals = list_editor("Hasta", config_state.get("hasta", []), numeric=True)
        update_list_field(config_state, "hasta", hasta_vals)
    with col_e:
        st.caption("Totales de referencia por nivel.")
        update_list_field(config_state, "porcentaje", list_editor("Porcentaje", config_state.get("porcentaje", [])))
        update_list_field(config_state, "cantidad", list_editor("Cantidad", config_state.get("cantidad", [])))

    st.subheader("Dimensiones e indicadores")
    col_f, col_g = st.columns(2)
    with col_f:
        st.caption("Dimensiones principales del instrumento.")
        update_list_field(config_state, "nombre_dimension", list_editor("Nombre dimension", config_state.get("nombre_dimension", [])))
        update_list_field(config_state, "numero_dimension", list_editor("Numero dimension", config_state.get("numero_dimension", [])))
    with col_g:
        st.caption("Indicadores asociados a cada dimension.")
        update_list_field(config_state, "nombre_indicador", list_editor("Nombre indicador", config_state.get("nombre_indicador", [])))
        update_list_field(config_state, "numero_indicador0", list_editor("Numero indicador", config_state.get("numero_indicador0", [])))

    st.subheader("Numero de preguntas por indicador")
    st.caption("Cantidad de preguntas por indicador en cada variable.")
    update_list_field(config_state, "numero_pregunta0", list_editor("Preguntas V1", config_state.get("numero_pregunta0", [])))
    update_list_field(config_state, "numero_pregunta1", list_editor("Preguntas V2", config_state.get("numero_pregunta1", [])))

    st.subheader("Edicion avanzada")
    raw_json = st.text_area("JSON completo", value=json.dumps(config_state, ensure_ascii=False, indent=2), height=300)
    if st.button("Aplicar JSON"):
        try:
            if apply_config_from_json(raw_json, config_state):
                st.session_state["generated"] = False
                st.session_state["corr_value"] = None
                st.session_state["base_df"] = None
                st.session_state["excel_bytes"] = None
                st.session_state["excel_preview_path"], _ = resolve_excel_preview_path()
                st.rerun()
        except Exception:
            st.error("JSON invalido. Revisa el formato.")

    scalar_df, list_df = build_config_tables(config_state)
    if not scalar_df.empty:
        st.subheader("Resumen")
        st.dataframe(scalar_df, width="stretch")
    if not list_df.empty:
        st.subheader("Listas y catalogos")
        st.dataframe(list_df, width="stretch")

    st.subheader("Validaciones")
    validations = []
    def _is_int_ge(value, minimum):
        try:
            return int(str(value).strip()) >= minimum
        except Exception:
            return False

    if not _is_int_ge(config_state.get("muestra"), 2):
        validations.append("N° de muestra debe ser un entero mayor o igual a 2.")
    if not _is_int_ge(config_state.get("item"), 1):
        validations.append("N° de items (V1) debe ser un entero mayor a 0.")
    if not _is_int_ge(config_state.get("itemv2"), 1):
        validations.append("N° de items (V2) debe ser un entero mayor a 0.")
    if not _is_int_ge(config_state.get("escala"), 1):
        validations.append("Cantidad de escalas debe ser un entero mayor a 0.")
    if not _is_int_ge(config_state.get("respuesta"), 1):
        validations.append("N° de respuestas debe ser un entero mayor a 0.")

    dim_names = [str(x).strip() for x in config_state.get("nombre_dimension", []) if str(x).strip()]
    ind_names = [str(x).strip() for x in config_state.get("nombre_indicador", []) if str(x).strip()]
    ind_counts = _to_int_list(config_state.get("numero_indicador0"))
    if not dim_names:
        validations.append("Debe definir al menos una dimension.")
    if ind_counts and ind_names and sum(ind_counts) != len(ind_names):
        validations.append("Numero de indicadores no coincide con los nombres definidos.")

    if validations:
        for msg in validations:
            st.warning(msg)
    else:
        st.success("Configuracion valida para generar.")

    st.subheader("Generar tabulacion")
    st.caption("La base de datos se genera automaticamente con los items V1 y V2.")

    if st.button("Generar", type="primary", disabled=bool(validations)):
        progress = st.progress(0, text="Iniciando...")
        st.session_state["generated"] = False
        st.session_state["corr_value"] = None
        st.session_state["base_df"] = None
        st.session_state["excel_bytes"] = None
        try:
            progress.progress(20, text="Guardando configuracion...")
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(config_state, f, ensure_ascii=False, indent=2)

            progress.progress(50, text="Generando base y correlacion (Node)...")
            result = subprocess.run(
                ["node", "index.js"],
                cwd="node_app",
                capture_output=True,
                text=True,
                timeout=180,
            )
            if result.returncode != 0:
                raise RuntimeError((result.stderr or result.stdout or "Fallo al ejecutar Node").strip())

            output_line = result.stdout.strip()
            match = re.search(r"r=([-+]?[0-9]*\.?[0-9]+)", output_line)
            if not match:
                raise RuntimeError("No se pudo leer la correlacion desde la salida de Node.")
            r_value = float(match.group(1))

            progress.progress(80, text="Cargando resultados...")
            base_path = os.path.abspath(BASE_CSV_PATH)
            excel_path = os.path.abspath(GENERATED_XLSX_PATH)

            if not os.path.exists(base_path):
                raise FileNotFoundError(f"No se genero la base CSV esperada: {base_path}")
            if not os.path.exists(excel_path):
                raise FileNotFoundError(f"No se genero el Excel esperado: {excel_path}")

            df_base = pd.read_csv(base_path)
            with open(excel_path, "rb") as f:
                excel_bytes = f.read()

            st.session_state["base_df"] = df_base
            st.session_state["excel_bytes"] = excel_bytes
            st.session_state["corr_value"] = r_value
            st.session_state["generated"] = True
            st.session_state["excel_preview_path"] = excel_path

            progress.progress(100, text="Listo")
        except Exception as exc:
            st.session_state["generated"] = False
            st.session_state["corr_value"] = None
            st.session_state["base_df"] = None
            st.session_state["excel_bytes"] = None
            st.session_state["excel_preview_path"], _ = resolve_excel_preview_path()
            st.exception(exc)

    if st.session_state.get("generated"):
        r_value = st.session_state.get("corr_value")
        if r_value is not None:
            st.markdown(
                """
                <div style="background:#2e7d32; color:#fff; padding:14px 18px; border-radius:10px; font-size:28px; font-weight:700;">
                Coeficiente de correlacion (r): {value}
                </div>
                """.format(value=f"{r_value:.3f}"),
                unsafe_allow_html=True,
            )
        base_df = st.session_state.get("base_df")
        if base_df is not None:
            st.subheader("Vista previa de la base de datos")
            st.dataframe(base_df.head(10), width="stretch")

        st.download_button(
            "Descargar JSON",
            data=json.dumps(config_state, ensure_ascii=False, indent=2),
            file_name="Tabulacion.json",
            mime="application/json",
        )

        excel_bytes = st.session_state.get("excel_bytes")
        if excel_bytes:
            st.download_button(
                "Descargar Excel de tabulacion",
                data=excel_bytes,
                file_name="Tabulacion_generada.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )

with tab_excel:
    st.subheader("Hojas del Excel de tabulacion")
    preview_path = st.session_state.get("excel_preview_path")
    preview_label = "tabulacion generada"
    if not preview_path:
        preview_path, preview_label = resolve_excel_preview_path()
        st.session_state["excel_preview_path"] = preview_path
    elif os.path.basename(preview_path).lower() != GENERATED_XLSX_PATH.lower():
        preview_label = "plantilla base"

    if not preview_path:
        st.info("No se encontro ningun archivo Excel para mostrar.")
    else:
        st.caption(f"Mostrando: `{os.path.basename(preview_path)}` ({preview_label}).")
        try:
            cache_token = int(os.path.getmtime(preview_path))
            excel_sheets = load_excel_sheets(preview_path, cache_token)
        except Exception as exc:
            st.error(f"No se pudieron cargar las hojas del Excel: {exc}")
        else:
            for name, sheet_df in excel_sheets.items():
                with st.expander(name, expanded=False):
                    safe_df = sheet_df.fillna("").astype(str)
                    st.dataframe(safe_df, width="stretch")
