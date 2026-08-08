import { describe, expect, it } from "vitest";
import {
  aEditor,
  baremoPorDefecto,
  contarItems,
  desdeEditor,
  indicesItemsInversos,
  instrumentoATabConfig,
  matrizAInstrumento,
  tieneContenido,
} from "./instrumento";
import type { Instrumento, TabConfig } from "./types";

// El instrumento del proyecto alimenta al asistente de tabulación. Un error de
// traducción aquí no rompe ninguna pantalla: produce un Excel con la estructura
// o el baremo equivocados, y eso no lo detecta nadie hasta que lo revisa un
// asesor de tesis.

const INSTRUMENTO: Instrumento = {
  escala: ["Nunca", "A veces", "Siempre"],
  variables: [
    {
      nombre: "Clima laboral",
      dimensiones: [
        {
          nombre: "Comunicación",
          indicadores: [
            { nombre: "Claridad", items: ["P1", "P2"] },
            { nombre: "Escucha", items: ["P3"] },
          ],
        },
        { nombre: "Liderazgo", indicadores: [{ nombre: "Apoyo", items: ["P4"] }] },
      ],
      baremo: [
        { nombre: "Bajo", desde: 4, hasta: 7, porcentaje: 40 },
        { nombre: "Alto", desde: 8, hasta: 12, porcentaje: 60 },
      ],
    },
    {
      nombre: "Desempeño",
      dimensiones: [{ nombre: "Productividad", indicadores: [{ nombre: "Metas", items: ["Q1", "Q2"] }] }],
      baremo: [
        { nombre: "Bajo", desde: 2, hasta: 4, porcentaje: 50 },
        { nombre: "Alto", desde: 5, hasta: 6, porcentaje: 50 },
      ],
    },
  ],
};

describe("aEditor / desdeEditor", () => {
  it("ida y vuelta no pierde ni inventa nada", () => {
    const ida = aEditor(INSTRUMENTO.variables[0]);
    expect(desdeEditor(ida)).toEqual(INSTRUMENTO.variables[0].dimensiones);
  });

  it("da un id distinto a cada fila (React las usa de key)", () => {
    const dims = aEditor(INSTRUMENTO.variables[0]);
    const ids = [
      ...dims.map((d) => d.id),
      ...dims.flatMap((d) => d.indicadores.map((i) => i.id)),
      ...dims.flatMap((d) => d.indicadores.flatMap((i) => i.items.map((it) => it.id))),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("conserva solo las posiciones inversas marcadas explicitamente", () => {
    const variable = { ...INSTRUMENTO.variables[0], itemsInversos: [2, 4] };
    const dims = aEditor(variable);
    expect(indicesItemsInversos(dims)).toEqual([2, 4]);
    expect(desdeEditor(dims)).toEqual(variable.dimensiones);
  });

  it("una variable ausente da una estructura vacía, no revienta", () => {
    expect(aEditor(undefined)).toEqual([]);
    expect(contarItems(aEditor(undefined))).toBe(0);
  });
});

describe("baremoPorDefecto", () => {
  it("los porcentajes suman exactamente 100", () => {
    for (const niveles of [2, 3, 4, 6, 7]) {
      const b = baremoPorDefecto(10, 5, niveles);
      expect(b.reduce((a, n) => a + n.porcentaje, 0)).toBe(100);
    }
  });

  it("cubre todo el rango posible sin huecos ni solapes", () => {
    // 10 ítems en escala de 1 a 5 => puntajes de 10 a 50.
    const b = baremoPorDefecto(10, 5, 3);
    expect(b[0].desde).toBe(10);
    expect(b[b.length - 1].hasta).toBe(50);
    for (let i = 1; i < b.length; i++) {
      expect(b[i].desde).toBe(b[i - 1].hasta + 1);
    }
  });

  it("sin ítems o sin escala no propone nada", () => {
    expect(baremoPorDefecto(0, 5)).toEqual([]);
    expect(baremoPorDefecto(10, 0)).toEqual([]);
  });
});

describe("tieneContenido", () => {
  it("un instrumento sin ítems no tiene nada que traer", () => {
    expect(tieneContenido({ escala: [], variables: [] })).toBe(false);
    expect(tieneContenido({
      escala: ["Sí", "No"],
      variables: [{ nombre: "V", dimensiones: [{ nombre: "D", indicadores: [] }], baremo: [] }],
    })).toBe(false);
  });

  it("con ítems, sí", () => {
    expect(tieneContenido(INSTRUMENTO)).toBe(true);
  });
});

describe("matrizAInstrumento", () => {
  const variables = [
    { nombre: "Gestión administrativa", dimensiones: ["Planificación", "Organización"] },
    { nombre: "Calidad del servicio", dimensiones: ["Fiabilidad"] },
    { nombre: "Sobrante", dimensiones: ["X"] },
  ];

  it("convierte variables y dimensiones, dejando los indicadores por escribir", () => {
    const inst = matrizAInstrumento(variables, ["Sí", "No"]);
    expect(inst.variables[0].nombre).toBe("Gestión administrativa");
    expect(inst.variables[0].dimensiones.map((d) => d.nombre)).toEqual(["Planificación", "Organización"]);
    expect(inst.variables[0].dimensiones[0].indicadores).toEqual([]);
    expect(inst.variables[0].baremo).toEqual([]);
  });

  it("corta en dos variables: es el máximo del instrumento", () => {
    expect(matrizAInstrumento(variables, []).variables).toHaveLength(2);
  });

  it("conserva la escala de respuesta que ya tenía el proyecto", () => {
    // La matriz no define la escala; perderla obligaría a reescribirla.
    expect(matrizAInstrumento(variables, ["Nunca", "Siempre"]).escala).toEqual(["Nunca", "Siempre"]);
  });
});

describe("instrumentoATabConfig", () => {
  const base: TabConfig = {
    muestra: "289",
    tema: "clasico",
    controlCorrelacion: "1",
    item: "18",
    itemv2: "9",
  };

  it("traduce estructura, escala de respuesta y baremos", () => {
    const { config, estructuraV1, estructuraV2 } = instrumentoATabConfig(INSTRUMENTO, base);

    expect(config.variable).toBe("2");
    expect(config.nombre_dimension).toEqual(["Clima laboral", "Desempeño"]);
    // 4 ítems en V1 (P1..P4) y 2 en V2 (Q1, Q2).
    expect(config.item).toBe("4");
    expect(config.itemv2).toBe("2");
    expect(config.dimensiones).toBe("2");
    expect(config.dimensiones_v2).toBe("1");

    expect(config.respuesta).toBe("3");
    expect(config.nombre_respuesta).toEqual(["Nunca", "A veces", "Siempre"]);

    expect(config.escala).toBe("2");
    expect(config.nombre_escala).toEqual(["Bajo", "Alto"]);
    expect(config.desde).toEqual(["4", "8"]);
    expect(config.hasta).toEqual(["7", "12"]);
    expect(config.porcentaje).toEqual(["40", "60"]);

    // Las claves de la segunda variable llevan sufijo _v2.
    expect(config.nombre_escala_v2).toEqual(["Bajo", "Alto"]);
    expect(config.porcentaje_v2).toEqual(["50", "50"]);

    expect(contarItems(estructuraV1)).toBe(4);
    expect(contarItems(estructuraV2)).toBe(2);
  });

  it("no pisa lo que no es del instrumento", () => {
    // La muestra, el tema y el control de correlación son decisiones de ESTA
    // generación. Traer el instrumento no puede llevárselas por delante.
    const { config } = instrumentoATabConfig(INSTRUMENTO, base);
    expect(config.muestra).toBe("289");
    expect(config.tema).toBe("clasico");
    expect(config.controlCorrelacion).toBe("1");
  });

  it("con una sola variable no toca las claves de la segunda", () => {
    const unaSola: Instrumento = { ...INSTRUMENTO, variables: [INSTRUMENTO.variables[0]] };
    const { config, estructuraV2 } = instrumentoATabConfig(unaSola, base);
    expect(config.variable).toBe("1");
    expect(config.itemv2).toBe("9");
    expect(config.nombre_escala_v2).toBeUndefined();
    expect(estructuraV2).toEqual([]);
  });

  it("sin baremo guardado no inventa uno", () => {
    // Un baremo inventado saldría en el Excel como si el usuario lo hubiera
    // pedido. Mejor dejar el del asistente, que él puede recalcular a la vista.
    const sinBaremo: Instrumento = {
      ...INSTRUMENTO,
      variables: [{ ...INSTRUMENTO.variables[0], baremo: [] }],
    };
    const conBaremoPrevio: TabConfig = { ...base, escala: "3", porcentaje: ["46", "35", "19"] };
    const { config } = instrumentoATabConfig(sinBaremo, conBaremoPrevio);
    expect(config.escala).toBe("3");
    expect(config.porcentaje).toEqual(["46", "35", "19"]);
  });

  it("traslada los items inversos aunque la variable todavia no tenga baremo", () => {
    const instrumento: Instrumento = {
      ...INSTRUMENTO,
      variables: [{ ...INSTRUMENTO.variables[0], baremo: [], itemsInversos: [2, 4] }],
    };
    const { config, estructuraV1 } = instrumentoATabConfig(instrumento, base);
    expect(config.items_inversos_v1).toEqual([2, 4]);
    expect(indicesItemsInversos(estructuraV1)).toEqual([2, 4]);
  });

  it("un instrumento vacío no rompe el asistente", () => {
    const { config, estructuraV1 } = instrumentoATabConfig({ escala: [], variables: [] }, base);
    expect(config.variable).toBe("1");
    expect(config.item).toBe("18");
    expect(estructuraV1).toEqual([]);
  });
});
