// Narrativas automáticas (lib/narratives.js): hueco de cobertura encontrado
// en la auditoria de pruebas (2026-07-26). El archivo entero no tenia NINGUNA
// prueba, ni directa ni indirecta: descriptiva.test.js no verifica el texto
// que estas funciones producen. Son las que calculan y redactan los
// PORCENTAJES de cada tabla/figura (regla innegociable del proyecto: nunca
// degradar el calculo de porcentajes), asi que vale la pena fijar su
// comportamiento con pruebas directas y rapidas (sin generar un Excel
// completo).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  fmtPct, sortShares, joinShares, narrativeItem, narrativeDimension,
  narrativeNormalidadAuto, narrativeNormalidadManual,
} from "../lib/narratives.js";

describe("fmtPct", () => {
  test("formatea con 2 decimales y símbolo de porcentaje", () => {
    assert.equal(fmtPct(0.5), "50.00%");
    assert.equal(fmtPct(1), "100.00%");
    assert.equal(fmtPct(0), "0.00%");
    assert.equal(fmtPct(1 / 3), "33.33%");
  });
});

describe("sortShares", () => {
  test("ordena de mayor a menor participación", () => {
    const r = sortShares([10, 30, 5], ["A", "B", "C"], 45);
    assert.deepEqual(r.map((s) => s.label), ["B", "A", "C"]);
    assert.equal(r[0].share, 30 / 45);
  });

  test("con total 0, ninguna participación es NaN (todas quedan en 0)", () => {
    const r = sortShares([0, 0], ["A", "B"], 0);
    assert.ok(r.every((s) => s.share === 0), "la division por cero debe evitarse, no producir NaN");
  });

  test("mantiene todas las etiquetas aunque su conteo sea 0", () => {
    const r = sortShares([0, 5], ["Nunca", "Siempre"], 5);
    assert.equal(r.length, 2);
    assert.equal(r[0].label, "Siempre");
    assert.equal(r[1].count, 0);
  });
});

describe("joinShares", () => {
  test("una sola participación no lleva \" y \"", () => {
    const shares = sortShares([10], ["Único"], 10);
    const texto = joinShares(shares, "respondió");
    assert.equal(texto, `el ${fmtPct(1)} respondió "Único"`);
    assert.ok(!texto.includes(" y "));
  });

  test("dos o más participaciones se unen con coma y \"y\" antes de la última", () => {
    const shares = sortShares([50, 30, 20], ["A", "B", "C"], 100);
    const texto = joinShares(shares, "respondió");
    assert.match(texto, /^el 50\.00% respondió "A", el 30\.00% "B" y el 20\.00% "C"$/);
  });

  test("respeta el límite `max` de participaciones incluidas", () => {
    const shares = sortShares([40, 30, 20, 10], ["A", "B", "C", "D"], 100);
    const texto = joinShares(shares, "respondió", 2);
    assert.ok(texto.includes("A"));
    assert.ok(texto.includes("B"));
    assert.ok(!texto.includes('"C"'));
    assert.ok(!texto.includes('"D"'));
  });

  test("filtra las participaciones con conteo 0 aunque estén dentro del límite", () => {
    const shares = sortShares([10, 0, 5], ["A", "B", "C"], 15);
    const texto = joinShares(shares, "respondió", 3);
    assert.ok(!texto.includes('"B"'), "B tiene conteo 0 y no debería aparecer en el texto");
  });

  test("sin ninguna participación con conteo, devuelve cadena vacía (no lanza)", () => {
    const shares = sortShares([0, 0], ["A", "B"], 0);
    assert.equal(joinShares(shares, "respondió"), "");
  });
});

describe("narrativeItem", () => {
  const cfg = { escala: [{ etiqueta: "Nunca" }, { etiqueta: "Siempre" }], encuestados: 20, etiquetaMuestra: "Trabajadores" };

  test("sin conteos (aún sin datos), redacta el texto guía en vez de una interpretación", () => {
    const texto = narrativeItem(cfg, 1, "P1", "¿Le gusta su trabajo?", null);
    assert.match(texto, /Ingrese las respuestas/);
    assert.ok(texto.includes("P1 (¿Le gusta su trabajo?)"));
  });

  test("con conteos, calcula la tendencia predominante real", () => {
    const texto = narrativeItem(cfg, 3, "P2", "", [4, 16]);
    assert.ok(texto.includes("80.00%"), "16/20 = 80%");
    assert.ok(texto.includes('tendencia predominante del ítem es "Siempre"'));
  });

  test("sin texto del ítem, usa solo el código", () => {
    const texto = narrativeItem(cfg, 1, "P1", "", null);
    assert.ok(texto.includes("ítem P1."));
    assert.ok(!texto.includes("P1 ("));
  });
});

describe("narrativeDimension", () => {
  const cfg = { encuestados: 40, etiquetaMuestra: "Encuestados" };
  const niveles = [{ nombre: "Bajo" }, { nombre: "Medio" }, { nombre: "Alto" }];

  test("sin conteos, redacta el texto guía", () => {
    const texto = narrativeDimension(cfg, 2, "Clima laboral", "Comunicación", null, niveles);
    assert.match(texto, /Ingrese las respuestas/);
  });

  test("con conteos, identifica el nivel predominante y menciona los demás con datos", () => {
    const texto = narrativeDimension(cfg, 2, "Clima laboral", "Comunicación", [4, 6, 30], niveles);
    assert.ok(texto.includes('calificación de "Alto"'));
    assert.ok(texto.includes("75.00%"), "30/40 = 75%");
    assert.ok(texto.includes("seguida de"));
    assert.ok(texto.includes('la dimensión Comunicación es "Alto"'));
  });

  test("si solo el nivel predominante tiene conteo, no agrega \"seguida de\"", () => {
    const texto = narrativeDimension(cfg, 2, "Clima laboral", "Comunicación", [0, 0, 40], niveles);
    assert.ok(!texto.includes("seguida de"));
  });
});

describe("narrativeNormalidadAuto — nunca debe contradecir la tabla de Sig.", () => {
  test("datos normales + Pearson: usa el texto paramétrico simple", () => {
    const texto = narrativeNormalidadAuto(4, "V1", "V2", true, "pearson", null, false);
    assert.match(texto, /son todos mayores o iguales a 0\.05/);
    assert.match(texto, /se procederá a utilizar la prueba paramétrica de correlación de Pearson/);
  });

  test("datos NO normales pero se forzó Pearson: explica la excepción, no la oculta", () => {
    const texto = narrativeNormalidadAuto(4, "V1", "V2", true, "pearson", "pearson", true);
    assert.match(texto, /es menor que 0\.05/);
    assert.match(texto, /No obstante.*se utilizó la correlación de Pearson/s);
  });

  test("datos no normales + Spearman: texto no paramétrico simple", () => {
    const texto = narrativeNormalidadAuto(4, "V1", "V2", false, "spearman", null, true);
    assert.match(texto, /es menor que 0\.05/);
    assert.match(texto, /prueba no paramétrica Rho de Spearman/);
  });

  test("datos normales pero Spearman forzado por ser Likert ordinal: lo justifica", () => {
    const texto = narrativeNormalidadAuto(4, "V1", "V2", false, "spearman", "spearman", false);
    assert.match(texto, /son todos mayores o iguales a 0\.05/);
    assert.match(texto, /por tratarse de datos ordinales de tipo Likert/);
  });

  test("elige Shapiro-Wilk para muestras pequeñas y Kolmogorov-Smirnov para grandes", () => {
    const chico = narrativeNormalidadAuto(4, "V1", "V2", true, "pearson", null, false);
    const grande = narrativeNormalidadAuto(4, "V1", "V2", false, "pearson", null, false);
    assert.match(chico, /Shapiro-Wilk/);
    assert.match(grande, /Kolmogorov-Smirnov/);
  });
});

describe("narrativeNormalidadManual", () => {
  test("indica Pearson por defecto", () => {
    const texto = narrativeNormalidadManual(5, "V1", "V2");
    assert.match(texto, /generaron con Pearson/);
  });

  test("indica Spearman cuando se pasa explícitamente", () => {
    const texto = narrativeNormalidadManual(5, "V1", "V2", "spearman");
    assert.match(texto, /generaron con Rho de Spearman/);
  });
});
