import { beforeEach, describe, expect, it } from "vitest";
import {
  borrarBorrador,
  borrarTodosLosBorradores,
  draftKey,
  guardarBorrador,
  hayCambios,
  leerBorrador,
} from "./wizard-draft";
import type { DimensionDef, TabConfig } from "./types";

// El asistente perdía todo lo escrito al cambiar de sección o recargar. Estas
// pruebas fijan el contrato del borrador que lo evita.

const CONFIG: TabConfig = { nombre_variable: "Clima organizacional", muestra: "60" };
const ESTRUCTURA: DimensionDef[] = [
  { id: "d1", nombre: "Liderazgo", indicadores: [{ id: "i1", nombre: "Comunicación", items: [{ id: "it1", nombre: "Mi jefe explica" }] }] },
];

beforeEach(() => localStorage.clear());

describe("guardarBorrador / leerBorrador", () => {
  it("devuelve la configuración y la estructura tal como se guardaron", () => {
    guardarBorrador("ana@uni.edu", { wizardStep: 2, config: CONFIG, estructuraV1: ESTRUCTURA, estructuraV2: [] });
    const leido = leerBorrador("ana@uni.edu");
    expect(leido?.wizardStep).toBe(2);
    expect(leido?.config).toEqual(CONFIG);
    expect(leido?.estructuraV1).toEqual(ESTRUCTURA);
    expect(leido?.estructuraV2).toEqual([]);
  });

  it("sella la fecha de guardado para poder mostrarla al recuperar", () => {
    guardarBorrador("ana@uni.edu", { wizardStep: 1, config: CONFIG, estructuraV1: [], estructuraV2: [] });
    expect(Number.isFinite(Date.parse(leerBorrador("ana@uni.edu")!.guardadoEn))).toBe(true);
  });

  it("no devuelve el borrador de otra cuenta (equipo compartido)", () => {
    guardarBorrador("ana@uni.edu", { wizardStep: 3, config: CONFIG, estructuraV1: ESTRUCTURA, estructuraV2: [] });
    expect(leerBorrador("bruno@uni.edu")).toBeNull();
    expect(leerBorrador("ana@uni.edu")).not.toBeNull();
  });

  it("trata el correo sin distinguir mayúsculas ni espacios", () => {
    expect(draftKey("  Ana@Uni.edu ")).toBe(draftKey("ana@uni.edu"));
  });

  it("descarta un borrador ilegible en vez de romper el asistente", () => {
    localStorage.setItem(draftKey("ana@uni.edu"), "{esto no es json");
    expect(leerBorrador("ana@uni.edu")).toBeNull();
  });

  it("descarta un borrador de una versión anterior del formato", () => {
    localStorage.setItem(draftKey("ana@uni.edu"), JSON.stringify({
      version: 0, guardadoEn: new Date().toISOString(), wizardStep: 1, config: {}, estructuraV1: [], estructuraV2: [],
    }));
    expect(leerBorrador("ana@uni.edu")).toBeNull();
  });

  it("descarta un borrador con un paso imposible", () => {
    localStorage.setItem(draftKey("ana@uni.edu"), JSON.stringify({
      version: 1, guardadoEn: new Date().toISOString(), wizardStep: 9, config: {}, estructuraV1: [], estructuraV2: [],
    }));
    expect(leerBorrador("ana@uni.edu")).toBeNull();
  });

  it("devuelve null cuando no hay nada guardado", () => {
    expect(leerBorrador("ana@uni.edu")).toBeNull();
  });
});

describe("borrado", () => {
  it("borrarBorrador solo afecta a la cuenta indicada", () => {
    guardarBorrador("ana@uni.edu", { wizardStep: 1, config: CONFIG, estructuraV1: [], estructuraV2: [] });
    guardarBorrador("bruno@uni.edu", { wizardStep: 1, config: CONFIG, estructuraV1: [], estructuraV2: [] });
    borrarBorrador("ana@uni.edu");
    expect(leerBorrador("ana@uni.edu")).toBeNull();
    expect(leerBorrador("bruno@uni.edu")).not.toBeNull();
  });

  it("al cerrar sesión no queda ningún instrumento en el navegador", () => {
    guardarBorrador("ana@uni.edu", { wizardStep: 1, config: CONFIG, estructuraV1: ESTRUCTURA, estructuraV2: [] });
    guardarBorrador("bruno@uni.edu", { wizardStep: 1, config: CONFIG, estructuraV1: ESTRUCTURA, estructuraV2: [] });
    localStorage.setItem("themeMode", "dark");
    borrarTodosLosBorradores();
    expect(leerBorrador("ana@uni.edu")).toBeNull();
    expect(leerBorrador("bruno@uni.edu")).toBeNull();
    // No es una limpieza a ciegas: las demás preferencias siguen ahí.
    expect(localStorage.getItem("themeMode")).toBe("dark");
  });
});

// El asistente arranca con una configuración de EJEMPLO ya rellena (nombres de
// dimensiones, ítems, baremo). Por eso la pregunta no es "¿hay contenido?"
// —siempre lo hay— sino "¿cambió algo respecto a como arrancó?". Medirlo mal
// hacía que abrir la sección y salir dejara un borrador, y que al volver la app
// anunciara "recuperamos lo que habías avanzado" sin nada que recuperar.
describe("hayCambios", () => {
  // El ejemplo real que sirve /default-config.json: viene lleno.
  const EJEMPLO: TabConfig = {
    muestra: "289",
    nombre_dimension: ["Gestión de abastecimiento", "Satisfacción del servicio"],
    nombre_items_v1: ["Ítem 1", "Ítem 2"],
  };

  it("es falso con el ejemplo intacto, aunque el ejemplo venga lleno", () => {
    expect(hayCambios(EJEMPLO, [], [], EJEMPLO)).toBe(false);
  });

  it("es falso también con una copia del ejemplo (compara valores, no identidad)", () => {
    expect(hayCambios({ ...EJEMPLO }, [], [], EJEMPLO)).toBe(false);
  });

  it("es verdadero en cuanto el usuario cambia un campo", () => {
    expect(hayCambios({ ...EJEMPLO, muestra: "120" }, [], [], EJEMPLO)).toBe(true);
  });

  it("es verdadero en cuanto el usuario renombra una dimensión", () => {
    expect(hayCambios({ ...EJEMPLO, nombre_dimension: ["Otra cosa"] }, [], [], EJEMPLO)).toBe(true);
  });

  it("es verdadero en cuanto construye estructura jerárquica", () => {
    // La estructura empieza vacía y solo la crea el usuario.
    expect(hayCambios(EJEMPLO, ESTRUCTURA, [], EJEMPLO)).toBe(true);
  });

  it("es verdadero si la estructura está solo en la segunda variable", () => {
    expect(hayCambios(EJEMPLO, [], ESTRUCTURA, EJEMPLO)).toBe(true);
  });
});
