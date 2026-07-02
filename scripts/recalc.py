"""Recalcula todas las formulas de un .xlsx y reporta errores.

Uso:
    python scripts/recalc.py archivo.xlsx [--show PATRON]

Carga el workbook con la libreria `formulas` (pip install formulas), evalua
cada formula desde cero (sin valores cacheados) y lista toda celda cuyo
resultado sea un error de Excel (#DIV/0!, #VALUE!, #NAME?, #REF!, ...).
Sale con codigo 1 si hay errores, 0 si el archivo esta limpio.

--show PATRON imprime ademas el valor recalculado de las celdas cuya
referencia (HOJA!CELDA) contenga el patron (insensible a mayusculas), util
para verificar a mano valores clave (p. ej. --show "K45").
"""
import argparse
import re
import sys

import formulas
import numpy as np

# La consola de Windows usa cp1252 por defecto y no puede imprimir caracteres
# como α; se fuerza UTF-8 para que el reporte no reviente.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def iter_scalars(value):
    """Aplana valores de `formulas` (Ranges, arrays numpy, escalares)."""
    inner = getattr(value, "value", value)
    if isinstance(inner, np.ndarray):
        for item in inner.ravel().tolist():
            yield item
    else:
        yield inner


def is_excel_error(scalar):
    return isinstance(scalar, str) and scalar.startswith("#")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xlsx", help="ruta del .xlsx a recalcular")
    parser.add_argument("--show", default=None, help="patron de celdas a imprimir (p. ej. 'ALFA' o 'K45')")
    args = parser.parse_args()

    model = formulas.ExcelModel().loads(args.xlsx).finish()
    solution = model.calculate()

    errors = []
    shown = []
    cell_re = re.compile(r"'\[[^\]]+\]([^']+)'!(\$?[A-Z]{1,3}\$?\d+)$")
    for key, value in solution.items():
        match = cell_re.search(str(key))
        if not match:
            continue  # rangos, nombres definidos y otros nodos intermedios
        ref = f"{match.group(1)}!{match.group(2).replace('$', '')}"
        scalars = list(iter_scalars(value))
        for scalar in scalars:
            if is_excel_error(scalar):
                errors.append((ref, scalar))
        if args.show and args.show.upper() in ref.upper():
            shown.append((ref, scalars[0] if len(scalars) == 1 else scalars))

    for ref, val in sorted(shown):
        print(f"  {ref} = {val}")

    if errors:
        print(f"\n{len(errors)} celda(s) con error de formula:")
        for ref, err in sorted(set(errors)):
            print(f"  {ref}: {err}")
        sys.exit(1)

    print(f"OK: sin errores de formula en {args.xlsx}")


if __name__ == "__main__":
    main()
