// Lenguaje neutral en los artefactos y trazabilidad metodológica del control
// de patrón. Los detalles técnicos del generador no deben dominar la salida.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import XlsxPopulate from "xlsx-populate";
import {
  DEFAULT_CONFIG_PATH,
  generateArtifacts,
  generateQuasiExperimentalData,
  normalizeConfig,
  normalizeQuasiExperimentalConfig,
  prepareQuasiExperimentalRawConfig,
} from "../generator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(here, "../../examples/Tabulacion_cuasiexperimental.json");
const baseConfig = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));

// UNA sola variable: es el caso que perdía el aviso, porque sin segunda
// variable no hay control de correlación y el aviso vivía dentro de ese bloque.
const configUnaVariable = (conDatos = "1") => ({
  ...baseConfig,
  variable: "1",
  conDatos,
});

const textoDeLaHoja = async (buffer, nombreHoja) => {
  const wb = await XlsxPopulate.fromDataAsync(buffer);
  const hoja = wb.sheet(nombreHoja);
  assert.ok(hoja, `no existe la hoja ${nombreHoja}`);
  const usado = hoja.usedRange();
  return JSON.stringify(usado ? usado.value() : []);
};

test("con una sola variable el Excel usa lenguaje neutral", async () => {
  const resultado = await generateArtifacts(configUnaVariable("1"));
  // Se comprueba el supuesto de la prueba: sin 2ª variable no hay control de
  // correlación, que es exactamente donde estaba escondido el aviso.
  assert.equal(resultado.correlationControl, null, "el caso de prueba debe ser de una sola variable");

  const texto = await textoDeLaHoja(resultado.excelBuffer, "Información");
  assert.doesNotMatch(texto, /SIMULAD/i);
});

test("la plantilla vacía usa lenguaje neutral", async () => {
  const resultado = await generateArtifacts(configUnaVariable("0"));
  const texto = await textoDeLaHoja(resultado.excelBuffer, "Información");

  assert.doesNotMatch(texto, /SIMULADOS/);
});

test("con dos variables el Excel usa lenguaje neutral", async () => {
  const resultado = await generateArtifacts({ ...baseConfig, conDatos: "1" });
  const texto = await textoDeLaHoja(resultado.excelBuffer, "Información");

  assert.doesNotMatch(texto, /SIMULAD/i);
});

// La nota al pie de cada tabla de correlación afirmaba, como texto fijo, que
// la correlación era significativa al 0,01 — incluso cuando el Sig. de la
// propia tabla valía 0,96. Ahora es una fórmula que lee ese Sig.
test("la nota de significación es una fórmula que depende del Sig. calculado", async () => {
  const resultado = await generateArtifacts({
    ...baseConfig, muestra: "60", controlCorrelacion: "1", nivelCorrelacion: "nula",
  });
  const wb = await XlsxPopulate.fromDataAsync(resultado.excelBuffer);
  const hoja = wb.sheet("Relaciones");

  // Se busca la nota bajo la primera tabla de correlaciones.
  let encontrada = null;
  for (let fila = 1; fila <= 80 && !encontrada; fila += 1) {
    const f = hoja.cell(fila, 10).formula();
    if (typeof f === "string" && f.includes("significativa en el nivel 0,01")) encontrada = f;
  }

  assert.ok(encontrada, "la nota de significación debería ser una fórmula, no texto fijo");
  // Contempla los tres desenlaces, incluido el de NO significativa.
  assert.match(encontrada, /significativa en el nivel 0,05/);
  assert.match(encontrada, /no es estadísticamente significativa/);
});

test("el control del patrón de resultados avisa SIEMPRE, no solo cuando falla", () => {
  const raw = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  const cfg = normalizeQuasiExperimentalConfig(
    { ...raw, controlarResultados: "1" },
    normalizeConfig(prepareQuasiExperimentalRawConfig({ ...raw, controlarResultados: "1" })),
  );
  const resultado = generateQuasiExperimentalData(cfg);

  assert.equal(cfg.cuasiexperimental.controlarResultados, true);
  const aviso = resultado.warnings.join(" ");
  // Lo esencial: que diga que hubo selección entre bases y que eso afecta
  // a los p-valores.
  assert.match(aviso, /se evaluaron \d+ bases/i);
  assert.match(aviso, /condicionados/i);
  assert.match(aviso, /p-valores/i);
  // Y que informe de cuántos intentos se usaron de verdad.
  assert.ok(resultado.intentosUsados >= 1);
  assert.ok(resultado.intentosUsados <= resultado.intentosMaximos);
});

test("sin control del patrón no se avisa de ninguna selección", () => {
  const raw = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  const conControlOff = { ...raw, controlarResultados: "0" };
  const cfg = normalizeQuasiExperimentalConfig(
    conControlOff,
    normalizeConfig(prepareQuasiExperimentalRawConfig(conControlOff)),
  );
  const resultado = generateQuasiExperimentalData(cfg);

  assert.equal(cfg.cuasiexperimental.controlarResultados, false);
  assert.equal(resultado.intentosUsados, 1, "sin control debe generarse una sola base");
  assert.deepEqual(resultado.warnings, []);
});

test("la hoja Información del cuasiexperimental explica qué significa el control activado", async () => {
  const raw = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  const conControl = { ...raw, controlarResultados: "1" };
  const cfg = normalizeQuasiExperimentalConfig(
    conControl,
    normalizeConfig(prepareQuasiExperimentalRawConfig(conControl)),
  );
  const { excelBuffer } = await generateArtifacts(cfg);
  const texto = await textoDeLaHoja(excelBuffer, "Información");

  // "Activado" a secas no informaba de nada.
  assert.match(texto, /se conserva la que mejor se aproxima/i);
  assert.doesNotMatch(texto, /simulad/i);
});
