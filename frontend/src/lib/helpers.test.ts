import { describe, expect, it } from "vitest";
import {
  base64ToUint8Array,
  calcBaremoIntervalos,
  defaultLevelName,
  normalizeList,
  parseIntSafe,
  toStringList,
} from "./helpers";

// Lógica pura del asistente. Un error aquí no rompe la pantalla: produce un
// Excel con números equivocados, que es mucho peor porque nadie se entera.

describe("calcBaremoIntervalos", () => {
  it("reparte el rango completo sin huecos ni solapes", () => {
    // 10 preguntas de escala 1-5 => puntajes de 10 a 50, en 3 niveles.
    const { desde, hasta } = calcBaremoIntervalos(10, 5, 3);

    expect(desde).toHaveLength(3);
    expect(hasta).toHaveLength(3);
    expect(desde[0]).toBe("10");
    expect(hasta[2]).toBe("50");

    // Cada nivel empieza justo donde acabó el anterior: un hueco dejaría
    // puntajes sin clasificar y un solape los contaría dos veces.
    for (let i = 1; i < desde.length; i += 1) {
      expect(Number(desde[i])).toBe(Number(hasta[i - 1]) + 1);
    }
  });

  it("funciona con un solo nivel", () => {
    const { desde, hasta } = calcBaremoIntervalos(4, 5, 1);
    expect(desde).toEqual(["4"]);
    expect(hasta).toEqual(["20"]);
  });

  // Esta función NO valida sus entradas a propósito: quien la llama
  // (autoCalcBaremo en App.tsx) descarta antes los valores vacíos o <= 0. Se
  // deja constancia para que nadie "arregle" aquí una validación que ya existe
  // arriba y acabe con dos comprobaciones que se contradicen.
  it("con niveles de más, ningún intervalo se sale del máximo", () => {
    const { desde, hasta } = calcBaremoIntervalos(10, 5, 8);
    expect(Number(hasta[hasta.length - 1])).toBe(50);
    expect(Number(desde[0])).toBe(10);
  });
});

describe("base64ToUint8Array", () => {
  it("reconstruye los bytes exactos", () => {
    // "PK" es la firma de un .xlsx: si esta conversión se rompe, el usuario
    // descarga un archivo corrupto sin ningún mensaje de error.
    const bytes = base64ToUint8Array(btoa("PKresto"));
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes).toHaveLength(9);
  });

  it("devuelve vacío con una cadena vacía", () => {
    expect(base64ToUint8Array("")).toHaveLength(0);
  });
});

describe("normalizeList", () => {
  it("descarta los vacíos del final", () => {
    expect(normalizeList(["Alto", "Medio", "", ""])).toEqual(["Alto", "Medio"]);
  });

  it("NO recorta espacios: el usuario puede estar escribiendo", () => {
    // Recortar mientras teclea le impediría escribir "Muy alto" (el espacio
    // desaparecería en cuanto lo pulsara).
    expect(normalizeList([" Alto "])).toEqual([" Alto "]);
  });

  it("conserva los vacíos intermedios", () => {
    // Son filas que el usuario aún no ha rellenado: borrarlas le movería las
    // de abajo mientras escribe.
    expect(normalizeList(["Alto", "", "Bajo"])).toEqual(["Alto", "", "Bajo"]);
  });
});

describe("parseIntSafe", () => {
  it("acepta números escritos como texto", () => {
    expect(parseIntSafe("42")).toBe(42);
    expect(parseIntSafe(" 7 ")).toBe(7);
  });

  it("devuelve null en vez de NaN cuando no hay número", () => {
    // NaN se propagaría en silencio por todos los cálculos.
    expect(parseIntSafe("")).toBeNull();
    expect(parseIntSafe("abc")).toBeNull();
    expect(parseIntSafe(null)).toBeNull();
    expect(parseIntSafe(undefined)).toBeNull();
  });
});

describe("toStringList", () => {
  it("solo interpreta arreglos; un valor suelto no es una lista", () => {
    // Se usa en campos de lista del asistente. Envolver un escalar convertiría
    // un campo mal tipado en una lista de un elemento y ocultaría el error.
    expect(toStringList(["uno", "dos"])).toEqual(["uno", "dos"]);
    expect(toStringList("uno")).toEqual([]);
  });

  it("devuelve lista vacía si no hay valor", () => {
    expect(toStringList(null)).toEqual([]);
    expect(toStringList(undefined)).toEqual([]);
  });
});

describe("defaultLevelName", () => {
  it("nombra los extremos de forma reconocible", () => {
    const tres = [0, 1, 2].map((i) => defaultLevelName(i, 3));
    expect(tres[0]).toMatch(/bajo/i);
    expect(tres[2]).toMatch(/alto/i);
  });
});
