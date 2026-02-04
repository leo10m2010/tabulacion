import io
import json
import os
import tempfile

import pandas as pd
import streamlit as st


st.set_page_config(page_title="Sistema de Tabulacion", layout="wide")


@st.cache_data(show_spinner=False)
def load_config():
    with open("Tabulacion.json", "r", encoding="utf-8") as f:
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


def parse_dimension_counts(config, dim_names):
    keys = [k for k in config.keys() if str(k).startswith("numero_pregunta")]
    counts = []
    if keys:
        def _suffix(key):
            digits = "".join(ch for ch in str(key) if ch.isdigit())
            return int(digits) if digits else 0
        for key in sorted(keys, key=_suffix):
            counts.append(sum(_to_int_list(config.get(key))))
    if counts and len(counts) == len(dim_names) and sum(counts) > 0:
        return counts
    item_counts = []
    for key in ["item", "itemv2", "itemv3"]:
        item_counts.extend(_to_int_list(config.get(key)))
    if item_counts and len(item_counts) == len(dim_names):
        return item_counts
    return []


def build_dimension_slices(dim_names, item_cols, counts):
    if not counts or len(counts) != len(dim_names) or sum(counts) != len(item_cols):
        base = len(item_cols) // len(dim_names)
        extra = len(item_cols) % len(dim_names)
        counts = [base + (1 if i < extra else 0) for i in range(len(dim_names))]
    slices = []
    start = 0
    for count in counts:
        end = start + count
        slices.append(item_cols[start:end])
        start = end
    return slices


@st.cache_data(show_spinner=False)
def load_excel_sheets():
    sheets = pd.read_excel("Tabulacion.xlsx", sheet_name=None)
    return sheets


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
        st.session_state.config_state = data
        return True
    return False


def get_item_counts(config_state):
    item_v1 = _to_int_list(config_state.get("item"))
    item_v2 = _to_int_list(config_state.get("itemv2"))
    v1_count = item_v1[0] if item_v1 else 0
    v2_count = item_v2[0] if item_v2 else 0
    return v1_count, v2_count


def generate_base_data(config_state):
    v1_count, v2_count = get_item_counts(config_state)
    if v1_count <= 0 or v2_count <= 0:
        raise ValueError("Define el numero de items V1 y V2 antes de generar.")

    try:
        total_rows = int(str(config_state.get("muestra", "0")).strip())
    except ValueError:
        total_rows = 0
    if total_rows <= 0:
        total_rows = 1

    try:
        max_response = int(str(config_state.get("respuesta", "5")).strip())
    except ValueError:
        max_response = 5
    if max_response <= 0:
        max_response = 5

    import random

    relacion_raw = str(config_state.get("relacionversa", "0")).strip().lower()
    inversa = relacion_raw in {"1", "si", "sí", "true", "inversa"}
    sign = -1 if inversa else 1

    target_corr = 0.95
    noise_std = (1 / (target_corr ** 2) - 1) ** 0.5

    def _scale_to_range(values):
        min_v = min(values)
        max_v = max(values)
        if max_v == min_v:
            mid = (1 + max_response) // 2
            return [mid for _ in values]
        scaled = []
        for v in values:
            norm = (v - min_v) / (max_v - min_v)
            mapped = 1 + norm * (max_response - 1)
            val = int(round(mapped))
            val = max(1, min(max_response, val))
            scaled.append(val)
        return scaled

    def _build_once(std):
        z_vals = [random.gauss(0, 1) for _ in range(total_rows)]
        raw_cols = {}
        for i in range(1, v1_count + 1):
            raw_cols[f"V1_{i}"] = [z + random.gauss(0, std) for z in z_vals]
        for i in range(1, v2_count + 1):
            raw_cols[f"V2_{i}"] = [sign * z + random.gauss(0, std) for z in z_vals]

        data = {}
        for key, values in raw_cols.items():
            data[key] = _scale_to_range(values)
        return pd.DataFrame(data)

    best_df = None
    best_corr = 0
    std = noise_std
    for _ in range(6):
        df = _build_once(std)
        r = compute_correlation(df, config_state)
        if abs(r) > abs(best_corr):
            best_corr = r
            best_df = df
        if abs(r) >= 0.9:
            return df
        std = max(0.05, std * 0.7)

    return best_df if best_df is not None else _build_once(0.05)


def compute_correlation(df_base, config_state):
    v1_count, v2_count = get_item_counts(config_state)
    if v1_count <= 0 or v2_count <= 0:
        raise ValueError("Define el numero de items V1 y V2 antes de generar.")

    if df_base.shape[1] < v1_count + v2_count:
        raise ValueError("La base de datos no tiene suficientes columnas para V1 y V2.")

    df_numeric = df_base.apply(pd.to_numeric, errors="coerce")
    if df_numeric.isna().any().any():
        raise ValueError("La base de datos debe tener solo valores numericos.")

    v1_scores = df_numeric.iloc[:, :v1_count].sum(axis=1)
    v2_scores = df_numeric.iloc[:, v1_count:v1_count + v2_count].sum(axis=1)
    r = v1_scores.corr(v2_scores)
    if pd.isna(r):
        raise ValueError("No se pudo calcular la correlacion con los datos.")

    return float(r)


def build_excel_from_template(config_state, base_df=None):
    try:
        import pythoncom
        import win32com.client as win32
    except Exception as exc:
        raise RuntimeError("pywin32 no esta disponible") from exc

    pythoncom.CoInitialize()
    excel = None
    workbook = None
    try:
        excel = win32.DispatchEx("Excel.Application")
        excel.Visible = False
        excel.DisplayAlerts = False
        workbook = excel.Workbooks.Open(os.path.abspath("Tabulacion.xlsx"))

        dim_names = [str(x).strip() for x in config_state.get("nombre_dimension", []) if str(x).strip()]
        if not dim_names:
            dim_names = ["Dimension 1"]

        indicator_names = [str(x).strip() for x in config_state.get("nombre_indicador", []) if str(x).strip()]
        indicator_counts = _to_int_list(config_state.get("numero_indicador0"))
        if indicator_counts and len(indicator_counts) == len(dim_names):
            indicators_by_dim = []
            start = 0
            for count in indicator_counts:
                indicators_by_dim.append(indicator_names[start:start + count])
                start += count
        else:
            indicators_by_dim = [indicator_names[:]] + [[] for _ in range(len(dim_names) - 1)]

        try:
            xl_whole = win32.constants.xlWhole
            xl_values = win32.constants.xlValues
        except Exception:
            xl_whole = 1
            xl_values = -4163

        def find_all(ws, text):
            first = ws.Cells.Find(What=text, LookAt=xl_whole, LookIn=xl_values)
            if not first:
                return []
            hits = [first]
            current = ws.Cells.FindNext(first)
            while current and current.Address != first.Address:
                hits.append(current)
                current = ws.Cells.FindNext(current)
            return hits

        def update_label_right(ws, label, value=None, values=None):
            hits = find_all(ws, label)
            if not hits:
                return
            if values is None:
                for cell in hits:
                    right = cell.Offset(0, 1)
                    if not right.HasFormula:
                        right.Value = value
            else:
                for cell, val in zip(hits, values):
                    right = cell.Offset(0, 1)
                    if not right.HasFormula:
                        right.Value = val

        def update_named_list_in_row(ws, row, values):
            used_cols = ws.UsedRange.Columns.Count
            cols = []
            for col in range(1, used_cols + 1):
                cell = ws.Cells(row, col)
                if cell.Value not in (None, "") and col > 1:
                    cols.append(col)
            for col, val in zip(cols, values):
                cell = ws.Cells(row, col)
                if not cell.HasFormula:
                    cell.Value = val

        def find_row_with_value(ws, value):
            cell = ws.Cells.Find(What=value, LookAt=xl_whole, LookIn=xl_values)
            if not cell:
                return None
            return int(cell.Row)

        raw_sheets = [
            "Gesti\u00f3n de abastecimiento",
            "Satisfacci\u00f3n de los comit\u00e9s d",
        ]

        if base_df is not None and not base_df.empty:
            v1_count, v2_count = get_item_counts(config_state)
            sheet_items = [
                (raw_sheets[0], v1_count, [c for c in base_df.columns if c.startswith("V1_")]),
                (raw_sheets[1], v2_count, [c for c in base_df.columns if c.startswith("V2_")]),
            ]

            for sheet_name, item_count, cols in sheet_items:
                if item_count <= 0:
                    continue
                try:
                    ws = workbook.Worksheets(sheet_name)
                except Exception:
                    continue

                header_row = find_row_with_value(ws, "PRG.1")
                if not header_row:
                    continue

                used_cols = ws.UsedRange.Columns.Count
                prg_cols = []
                for col in range(1, used_cols + 1):
                    cell = ws.Cells(header_row, col)
                    if cell.Value and str(cell.Value).strip().upper().startswith("PRG."):
                        prg_cols.append(col)
                prg_cols = prg_cols[:item_count]

                start_row = header_row + 1
                for i, (_, row) in enumerate(base_df.iterrows()):
                    row_idx = start_row + i
                    ws.Cells(row_idx, 1).Value = f"{config_state.get('nommuestra', 'Beneficiaros')} {i + 1}"
                    values = [row[c] for c in cols[:item_count]]
                    for col, val in zip(prg_cols, values):
                        ws.Cells(row_idx, col).Value = val

        valoracion_sheets = [
            "Por Valoracion (3) Dimension",
            "Por Valoracion (3) Dimension 2",
        ]
        for idx, sheet_name in enumerate(valoracion_sheets[: len(dim_names)]):
            try:
                ws = workbook.Worksheets(sheet_name)
            except Exception:
                continue

            header_row = find_row_with_value(ws, "N\u00b0 de Personas")
            if header_row:
                row_vals = []
                if idx < len(indicators_by_dim):
                    row_vals.extend(indicators_by_dim[idx])
                row_vals.append(dim_names[idx])
                update_named_list_in_row(ws, header_row, row_vals)

            update_label_right(ws, "Variable", value=dim_names[idx])
            escala = _to_int_list(config_state.get("escala"))
            escala_val = escala[0] if escala else int(str(config_state.get("escala", 3)) or 3)
            update_label_right(ws, "Cantidad de Escalas Valorativas", value=escala_val)

            min_val = 1
            max_val = 5
            if str(config_state.get("respuesta", "")):
                try:
                    max_val = int(str(config_state.get("respuesta")))
                except ValueError:
                    max_val = 5
            update_label_right(ws, "Valor M\u00ednimo por item", value=min_val)
            update_label_right(ws, "Valor M\u00e1ximo por item", value=max_val)

            n_preg = _to_int_list(config_state.get(f"numero_pregunta{idx}"))
            if n_preg:
                update_label_right(ws, "N\u00b0 de Peguntas", values=n_preg)

        conteo_sheets = ["Por conteo Dimension", "Por conteo Dimension 2"]
        for idx, sheet_name in enumerate(conteo_sheets[: len(dim_names)]):
            try:
                ws = workbook.Worksheets(sheet_name)
            except Exception:
                continue
            header_row = None
            for row in range(1, 11):
                for col in range(1, ws.UsedRange.Columns.Count + 1):
                    cell = ws.Cells(row, col)
                    if cell.Value and str(cell.Value).strip().lower().startswith("tabla"):
                        header_row = row + 1
                        break
                if header_row:
                    break
            if header_row and idx < len(indicators_by_dim):
                update_named_list_in_row(ws, header_row, indicators_by_dim[idx])

        output = io.BytesIO()
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
        temp_file.close()
        workbook.SaveAs(os.path.abspath(temp_file.name))
        workbook.Close(SaveChanges=False)
        excel.Quit()

        with open(temp_file.name, "rb") as f:
            output.write(f.read())
        os.unlink(temp_file.name)
        output.seek(0)
        return output
    finally:
        try:
            if workbook is not None:
                workbook.Close(SaveChanges=False)
        except Exception:
            pass
        try:
            if excel is not None:
                excel.Quit()
        except Exception:
            pass
        pythoncom.CoUninitialize()


st.sidebar.title("Sistema de Tabulacion")

try:
    config = load_config()
except Exception:
    config = {}

config_state = get_config_state(config)

try:
    excel_sheets = load_excel_sheets()
except Exception:
    excel_sheets = {}

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
        update_scalar_field(config_state, "nommuestra", st.text_input("Nombre de muestra", value=str(config_state.get("nommuestra", ""))))
        update_scalar_field(config_state, "muestra", st.text_input("N° de muestra", value=str(config_state.get("muestra", ""))))
        update_scalar_field(config_state, "variable", st.text_input("N° de variables", value=str(config_state.get("variable", ""))))
    with col2:
        update_scalar_field(config_state, "item", st.text_input("N° de items (V1)", value=str(config_state.get("item", ""))))
        update_scalar_field(config_state, "itemv2", st.text_input("N° de items (V2)", value=str(config_state.get("itemv2", ""))))
        update_scalar_field(config_state, "escala", st.text_input("Cantidad de escalas", value=str(config_state.get("escala", ""))))
    with col3:
        update_scalar_field(config_state, "respuesta", st.text_input("N° de respuestas", value=str(config_state.get("respuesta", ""))))
        relacion_raw = str(config_state.get("relacionversa", "0")).strip().lower()
        relacion_idx = 1 if relacion_raw in {"1", "si", "sí", "true", "inversa"} else 0
        relacion_label = st.radio("Relacion", ["No inversa", "Inversa"], index=relacion_idx, horizontal=True)
        update_scalar_field(config_state, "relacionversa", "1" if relacion_label == "Inversa" else "0")

    st.subheader("Escalas y respuestas")
    col_a, col_b = st.columns(2)
    with col_a:
        escala_names = list_editor("Nombre escala", config_state.get("nombre_escala", []))
        update_list_field(config_state, "nombre_escala", escala_names)
    with col_b:
        respuesta_names = list_editor("Nombre respuesta", config_state.get("nombre_respuesta", []))
        update_list_field(config_state, "nombre_respuesta", respuesta_names)

    st.subheader("Baremos")
    col_c, col_d, col_e = st.columns(3)
    with col_c:
        desde_vals = list_editor("Desde", config_state.get("desde", []), numeric=True)
        update_list_field(config_state, "desde", desde_vals)
    with col_d:
        hasta_vals = list_editor("Hasta", config_state.get("hasta", []), numeric=True)
        update_list_field(config_state, "hasta", hasta_vals)
    with col_e:
        update_list_field(config_state, "porcentaje", list_editor("Porcentaje", config_state.get("porcentaje", [])))
        update_list_field(config_state, "cantidad", list_editor("Cantidad", config_state.get("cantidad", [])))

    st.subheader("Dimensiones e indicadores")
    col_f, col_g = st.columns(2)
    with col_f:
        update_list_field(config_state, "nombre_dimension", list_editor("Nombre dimension", config_state.get("nombre_dimension", [])))
        update_list_field(config_state, "numero_dimension", list_editor("Numero dimension", config_state.get("numero_dimension", [])))
    with col_g:
        update_list_field(config_state, "nombre_indicador", list_editor("Nombre indicador", config_state.get("nombre_indicador", [])))
        update_list_field(config_state, "numero_indicador0", list_editor("Numero indicador", config_state.get("numero_indicador0", [])))

    st.subheader("Numero de preguntas por indicador")
    update_list_field(config_state, "numero_pregunta0", list_editor("Preguntas V1", config_state.get("numero_pregunta0", [])))
    update_list_field(config_state, "numero_pregunta1", list_editor("Preguntas V2", config_state.get("numero_pregunta1", [])))

    st.subheader("Edicion avanzada")
    raw_json = st.text_area("JSON completo", value=json.dumps(config_state, ensure_ascii=False, indent=2), height=300)
    if st.button("Aplicar JSON"):
        try:
            apply_config_from_json(raw_json, config_state)
            st.success("JSON actualizado.")
        except Exception:
            st.error("JSON invalido. Revisa el formato.")

    scalar_df, list_df = build_config_tables(config_state)
    if not scalar_df.empty:
        st.subheader("Resumen")
        st.dataframe(scalar_df, width="stretch")
    if not list_df.empty:
        st.subheader("Listas y catalogos")
        st.dataframe(list_df, width="stretch")

    st.subheader("Generar tabulacion")
    st.caption("La base de datos se genera automaticamente con los items V1 y V2.")

    if st.button("Generar", type="primary"):
        progress = st.progress(0, text="Iniciando...")
        try:
            progress.progress(20, text="Generando base de datos...")
            df_base = generate_base_data(config_state)

            progress.progress(50, text="Calculando correlacion...")
            r_value = compute_correlation(df_base, config_state)

            progress.progress(80, text="Generando Excel con plantilla...")
            st.session_state["corr_value"] = r_value
            st.session_state["generated"] = True
            st.session_state["base_df"] = df_base
            template_output = build_excel_from_template(config_state, base_df=df_base)
            st.session_state["excel_bytes"] = template_output.getvalue()

            progress.progress(100, text="Listo")
        except Exception as exc:
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
                "Descargar Excel completo (plantilla)",
                data=excel_bytes,
                file_name="Tabulacion.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )

with tab_excel:
    st.subheader("Hojas del Excel de tabulacion")
    if not excel_sheets:
        st.info("No se pudieron cargar las hojas del Excel.")
    else:
        for name, sheet_df in excel_sheets.items():
            with st.expander(name, expanded=False):
                safe_df = sheet_df.copy()
                safe_df = safe_df.applymap(lambda v: "" if v is None else str(v))
                st.dataframe(safe_df, width="stretch")
