import { describe, expect, it } from "vitest";
import { FALLBACK_CONFIG } from "./constants";
import { validarConfig } from "./wizard-validation";
import type { TabConfig } from "./types";

// Un error aquí no rompe ninguna pantalla: deja pasar una configuración
// incoherente y produce un Excel con números equivocados. Nadie se entera
// hasta que lo revisa un asesor de tesis, así que conviene fijarlo.

const LIMITES = { maxMuestra: 2000, maxItemsV1: 60, maxItemsV2: 60 };
const base = (cambios: Partial<TabConfig> = {}): TabConfig => ({ ...FALLBACK_CONFIG, ...cambios });

describe("configuración válida", () => {
  it("la configuración de ejemplo no reporta problemas", () => {
    // Si esto falla, la app arranca con una configuración que ella misma
    // rechaza: el usuario ve errores antes de tocar nada.
    expect(validarConfig(base(), LIMITES)).toEqual([]);
  });
});

describe("tamaños básicos", () => {
  it("exige al menos 2 encuestados", () => {
    expect(validarConfig(base({ muestra: "1" }), LIMITES)).toContainEqual(
      expect.stringMatching(/2 o más/i),
    );
    expect(validarConfig(base({ muestra: "" }), LIMITES)).toContainEqual(
      expect.stringMatching(/2 o más/i),
    );
  });

  it("exige preguntas y escala mayores que cero", () => {
    expect(validarConfig(base({ item: "0" }), LIMITES).join(" ")).toMatch(/preguntas de V1/i);
    expect(validarConfig(base({ respuesta: "0" }), LIMITES).join(" ")).toMatch(/escala de respuesta/i);
    expect(validarConfig(base({ escala: "0" }), LIMITES).join(" ")).toMatch(/niveles del baremo/i);
  });
});

describe("límites del servidor", () => {
  it("avisa antes de mandar una muestra que el backend va a rechazar", () => {
    // Sin esto se gasta un uso y varios minutos para recibir un error.
    const issues = validarConfig(base({ muestra: "5000" }), LIMITES);
    expect(issues.join(" ")).toMatch(/máximo 2000 personas/i);
  });

  it("no valida límites si el servidor aún no los informó", () => {
    // templateInfo es null hasta que responde /template-info: no se puede
    // afirmar que algo excede un límite que todavía no se conoce.
    const issues = validarConfig(base({ muestra: "5000" }), null);
    expect(issues.join(" ")).not.toMatch(/máximo/i);
  });
});

describe("porcentajes del baremo", () => {
  it("deben sumar exactamente 100", () => {
    const issues = validarConfig(base({ porcentaje: ["50", "30", "10"] }), LIMITES);
    expect(issues.join(" ")).toMatch(/100%.*actual: 90%/i);
  });

  it("acepta que sumen 100", () => {
    expect(validarConfig(base({ porcentaje: ["50", "30", "20"] }), LIMITES)).toEqual([]);
  });

  it("no se queja si aún no hay ningún porcentaje escrito", () => {
    // Mientras el usuario no ha rellenado nada, quejarse sería ruido.
    const issues = validarConfig(base({ porcentaje: [] }), LIMITES);
    expect(issues.join(" ")).not.toMatch(/100%/);
  });
});

describe("coherencia entre dimensiones e indicadores", () => {
  it("la suma por dimensión debe cuadrar con el total de indicadores", () => {
    const issues = validarConfig(base({
      nombre_indicador: ["A", "B", "C"],
      numero_indicador0: ["1", "1"], // suman 2, pero hay 3 indicadores
    }), LIMITES);
    expect(issues.join(" ")).toMatch(/suma de indicadores/i);
  });

  it("exige al menos una dimensión", () => {
    expect(validarConfig(base({ nombre_dimension: [] }), LIMITES).join(" "))
      .toMatch(/al menos una dimensión/i);
  });
});

describe("diseño cuasiexperimental", () => {
  const quasi = (cambios: Partial<TabConfig> = {}) => base({
    diseno: "cuasiexperimental",
    variable: "1",
    nExperimental: "30",
    nControl: "30",
    efectoIntervencion: "moderado",
    ...cambios,
  });

  it("exige 2 o más participantes en cada grupo", () => {
    expect(validarConfig(quasi({ nExperimental: "1" }), LIMITES).join(" "))
      .toMatch(/grupo experimental/i);
    expect(validarConfig(quasi({ nControl: "0" }), LIMITES).join(" "))
      .toMatch(/grupo control/i);
  });

  it("acepta un efecto por nombre o un número entre 0 y 3", () => {
    expect(validarConfig(quasi({ efectoIntervencion: "grande" }), LIMITES).join(" "))
      .not.toMatch(/efecto personalizado/i);
    expect(validarConfig(quasi({ efectoIntervencion: "1.5" }), LIMITES).join(" "))
      .not.toMatch(/efecto personalizado/i);
  });

  it("rechaza un efecto fuera de rango o que no es número", () => {
    expect(validarConfig(quasi({ efectoIntervencion: "9" }), LIMITES).join(" "))
      .toMatch(/entre 0 y 3/i);
    expect(validarConfig(quasi({ efectoIntervencion: "muchisimo" }), LIMITES).join(" "))
      .toMatch(/entre 0 y 3/i);
  });

  it("NO exige porcentajes de baremo", () => {
    // El cuasiexperimental no reparte encuestados por baremo: la distribución
    // la definen el efecto y la dirección. Exigir el 100% aquí bloquearía una
    // configuración perfectamente válida.
    const issues = validarConfig(quasi({ porcentaje: ["10", "10", "10"] }), LIMITES);
    expect(issues.join(" ")).not.toMatch(/100%/);
  });

  it("tampoco valida la segunda variable", () => {
    // Trabaja con una sola variable, aunque queden restos de V2 en la config.
    const issues = validarConfig(quasi({ itemv2: "0", escala_v2: "0" }), LIMITES);
    expect(issues.join(" ")).not.toMatch(/V2/);
  });
});

describe("una sola variable en diseño correlacional", () => {
  it("no valida los campos de la segunda variable", () => {
    const issues = validarConfig(base({ variable: "1", itemv2: "0", escala_v2: "0" }), LIMITES);
    expect(issues.join(" ")).not.toMatch(/V2/);
  });
});

// Dimensiones e indicadores sin ítems.
//
// El generador les asignaba un rango de columnas invertido y producía un .xlsx
// que Excel marca como dañado (openpyxl directamente se niega a abrirlo). El
// backend ya lo rechaza; aquí se avisa antes de gastar el uso.
describe("estructura sin ítems", () => {
  const conEstructura = (estructura: unknown) =>
    base({ variable: "1", estructura_v1: estructura } as Partial<TabConfig>);

  it("avisa de una dimensión sin ningún ítem", () => {
    const issues = validarConfig(conEstructura([
      { nombre: "Liderazgo", indicadores: [{ nombre: "A", items: 3 }] },
      { nombre: "Clima laboral", indicadores: [] },
    ]), null);
    expect(issues.some((m) => m.includes("Clima laboral") && m.includes("no tiene ítems"))).toBe(true);
  });

  it("avisa de un indicador sin ítems aunque la dimensión tenga otros", () => {
    const issues = validarConfig(conEstructura([
      { nombre: "Liderazgo", indicadores: [{ nombre: "Comunicación", items: 3 }, { nombre: "Escucha", items: 0 }] },
    ]), null);
    expect(issues.some((m) => m.includes("Escucha") && m.includes("no tiene ítems"))).toBe(true);
  });

  it("no se queja de una estructura completa", () => {
    const issues = validarConfig(conEstructura([
      { nombre: "Liderazgo", indicadores: [{ nombre: "Comunicación", items: 3 }] },
      { nombre: "Clima", indicadores: [{ nombre: "Ambiente", items: 2 }] },
    ]), null);
    expect(issues.filter((m) => m.includes("no tiene ítems"))).toEqual([]);
  });
});

// Presupuesto conjunto de complejidad.
//
// El aviso llega mientras el usuario sigue en el formulario, para que no gaste
// un uso en una generación que el backend rechazará igual. Los máximos por
// separado NO cambian: lo que puede no caber es la combinación.
describe("presupuesto de complejidad", () => {
  const LIM = { maxMuestra: 2000, maxItemsV1: 60, maxItemsV2: 60, presupuestoMaximo: 30000, itemsEquivalentesPorVariableExtra: 30 };
  const conPresupuesto = (cambios: Partial<TabConfig>) => validarConfig(base(cambios), LIM);
  const soloPresupuesto = (issues: string[]) => issues.filter((m) => m.includes("no cabe en la memoria"));

  it("la configuración de ejemplo no dispara el aviso", () => {
    expect(soloPresupuesto(validarConfig(base(), LIM))).toEqual([]);
  });

  it("avisa cuando la combinación no cabe", () => {
    const issues = soloPresupuesto(conPresupuesto({ muestra: "1500" }));
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/baja la muestra a \d+/);
  });

  it("dice que los límites por separado no cambian", () => {
    const issues = soloPresupuesto(conPresupuesto({ muestra: "1500" }));
    expect(issues[0]).toMatch(/2\.000/);
    expect(issues[0]).toMatch(/60 preguntas/);
  });

  it("una muestra alta con pocas preguntas sigue permitida", () => {
    // 2.000 encuestados siguen siendo posibles: la clave es no pedir a la vez
    // el máximo de preguntas.
    expect(soloPresupuesto(conPresupuesto({ muestra: "2000", item: "10", variable: "1", itemv2: "0" }))).toEqual([]);
  });

  it("sin datos de presupuesto del servidor no se avisa de nada", () => {
    // Compatibilidad: un backend anterior no sirve estos campos.
    const sinPresupuesto = { maxMuestra: 2000, maxItemsV1: 60, maxItemsV2: 60 };
    expect(soloPresupuesto(validarConfig(base({ muestra: "1500" }), sinPresupuesto))).toEqual([]);
  });
});
