import { describe, expect, it } from "vitest";
import { RUTA, hecho, pasosHechos, siguientePaso } from "./ruta";
import { tiempoRelativo } from "./helpers";
import type { PasoTesis, Proyecto } from "./types";

// La ruta decide qué le dice la app al usuario que abre el inicio. Si el
// "siguiente paso" sale mal, lo manda a hacer algo que ya hizo o a saltarse
// algo que necesita.

const proyecto = (progreso: Partial<Record<PasoTesis, string>>): Proyecto => ({
  id: "p1",
  userId: "u1",
  nombre: "Tesis de prueba",
  titulo: "",
  instrumento: { escala: [], variables: [] },
  progreso,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const AYER = "2026-07-24T10:00:00.000Z";

describe("siguientePaso", () => {
  it("sin nada hecho, manda al primer paso de la ruta", () => {
    expect(siguientePaso(proyecto({}))?.id).toBe(RUTA[0].id);
  });

  it("sin proyecto no hay siguiente paso que sugerir", () => {
    expect(siguientePaso(null)?.id).toBe(RUTA[0].id);
  });

  it("salta los pasos ya hechos", () => {
    const p = proyecto({ titulos: AYER, matriz: AYER });
    expect(siguientePaso(p)?.id).toBe("instrumento");
  });

  it("un hueco en medio se retoma ahí, no al final", () => {
    // Alguien puede generar la tabulación antes de medir la confiabilidad.
    const p = proyecto({ titulos: AYER, matriz: AYER, instrumento: AYER, tabulacion: AYER });
    expect(siguientePaso(p)?.id).toBe("confiabilidad");
  });

  it("los opcionales no bloquean la ruta", () => {
    // Con todo lo obligatorio hecho, sugiere un opcional en vez de quedarse
    // pegado en él antes de tiempo.
    const obligatorios = RUTA.filter((p) => !p.opcional);
    const p = proyecto(Object.fromEntries(obligatorios.map((x) => [x.id, AYER])));
    const siguiente = siguientePaso(p);
    expect(siguiente?.opcional).toBe(true);
  });

  it("con la ruta completa no queda nada por sugerir", () => {
    const p = proyecto(Object.fromEntries(RUTA.map((x) => [x.id, AYER])));
    expect(siguientePaso(p)).toBeNull();
  });
});

describe("hecho y pasosHechos", () => {
  it("cuenta solo los pasos con fecha", () => {
    expect(pasosHechos(proyecto({}))).toBe(0);
    expect(pasosHechos(proyecto({ titulos: AYER, tabulacion: AYER }))).toBe(2);
  });

  it("sin proyecto, cero", () => {
    expect(pasosHechos(null)).toBe(0);
    expect(hecho(null, "titulos")).toBe(false);
  });
});

describe("la ruta en sí", () => {
  it("no repite pasos ni secciones inexistentes", () => {
    const ids = RUTA.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RUTA.every((p) => p.seccion.length > 0 && p.resultado.length > 0)).toBe(true);
  });
});

describe("tiempoRelativo", () => {
  it("traduce distancias en lenguaje corriente", () => {
    const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(tiempoRelativo(hace(5_000))).toBe("recién");
    expect(tiempoRelativo(hace(5 * 60_000))).toBe("hace 5 min");
    expect(tiempoRelativo(hace(3 * 3_600_000))).toBe("hace 3 h");
    expect(tiempoRelativo(hace(26 * 3_600_000))).toBe("ayer");
    expect(tiempoRelativo(hace(4 * 86_400_000))).toBe("hace 4 días");
  });

  it("una fecha futura no sale como 'hace -3 min'", () => {
    // Pasa de verdad: el reloj del servidor y el del navegador no coinciden.
    expect(tiempoRelativo(new Date(Date.now() + 60_000).toISOString())).toBe("recién");
  });

  it("sin fecha o con basura no revienta", () => {
    expect(tiempoRelativo(null)).toBe("sin fecha");
    expect(tiempoRelativo("no es una fecha")).toBe("fecha inválida");
  });
});
