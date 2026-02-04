# Sistema de Tabulacion

Aplicacion web en Streamlit para configurar la tabulacion de tesis, generar `Tabulacion.json` y producir un `Tabulacion.xlsx` desde una plantilla conservando graficos.

## Requisitos

- Windows con Microsoft Excel instalado.
- Python 3.10+.
- Librerias: `streamlit`, `pandas`, `openpyxl`, `pywin32`.

```bash
python -m pip install streamlit pandas openpyxl pywin32
```

## Ejecutar

```bash
python -m streamlit run app.py
```

## Uso rapido

1. Completa la configuracion en la pesta\u00f1a **Configuracion**.
2. Presiona **Generar** (se crea la base automatica y la correlacion).
3. Descarga el JSON y el Excel.

## Archivos importantes

- `app.py`: app principal.
- `Tabulacion.json`: configuracion base.
- `Tabulacion.xlsx`: plantilla con graficos.

## Documentacion

- `DOCUMENTACION.md`: explicacion detallada de la web.
- `GUIA_EXCEL.md`: guia tecnica del Excel.
- `ESTADO_TECNICO.md`: estado tecnico y continuidad.
