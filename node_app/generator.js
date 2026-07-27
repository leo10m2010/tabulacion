// Generador de tabulaciones 100% por codigo: construye el .xlsx completo
// (estructura, formulas reales, graficos e interpretaciones) sin depender de
// ninguna plantilla.
//
// Dos flujos segun cfg.diseno:
//   correlacional (default): hojas base, "Ítems" y "Dimensiones" por variable,
//     mas "Relaciones", "Correlación" e "Información".
//   cuasiexperimental: GE/GC Pretest y Postest, "Consolidado", "Comparaciones"
//     e "Información" (pretest-postest con grupo experimental y control).
//
// Este archivo solo orquesta; la logica vive en lib/:
//   lib/config.js             normalizacion de la configuracion, limites y temas
//   lib/stats.js              simulacion de la base, correlacion y normalidad
//   lib/sheet-style.js        estilos y utilidades de construccion de hojas
//   lib/narratives.js         interpretaciones narrativas automaticas
//   lib/sheets.js             las hojas del workbook correlacional y buildWorkbook
//   lib/ooxml.js              deduplicacion de estilos e inyeccion de graficos OOXML
//   lib/quasi-stats.js        pruebas t pareada/Welch, Wilcoxon y Mann-Whitney
//   lib/quasi-experimental.js configuracion, simulacion y analisis del diseño
//   lib/quasi-sheets.js       las hojas del workbook cuasiexperimental
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CHART_THEMES, normalizeConfig } from "./lib/config.js";
import { buildBaseCsv, computeCorrelation, generateBaseData } from "./lib/stats.js";
import { buildWorkbook } from "./lib/sheets.js";
import { postProcessWorkbook } from "./lib/ooxml.js";
import {
  buildQuasiExperimentalCsv,
  generateQuasiExperimentalData,
  isQuasiExperimentalConfig,
  normalizeQuasiExperimentalConfig,
  prepareQuasiExperimentalRawConfig,
  resolveMediciones,
} from "./lib/quasi-experimental.js";
import { buildQuasiExperimentalWorkbook } from "./lib/quasi-sheets.js";

// API publica re-exportada (server, CLI y tests importan desde aqui).
export { CHART_THEMES, MAX_ITEMS_POR_VARIABLE, MAX_MUESTRA, NIVELES_CORRELACION, normalizeConfig } from "./lib/config.js";
export { computeCorrelation, generateBaseData, lillieforsTest, shapiroWilkTest, spearmanCorrelation } from "./lib/stats.js";
export { buildWorkbook } from "./lib/sheets.js";
export { postProcessWorkbook } from "./lib/ooxml.js";
export { NIVELES_ALFA, computeCronbachAlpha, generateCronbach, normalizeCronbachConfig } from "./lib/cronbach.js";
export {
  EFECTOS_CUASIEXPERIMENTALES,
  analyzeQuasiExperimentalData,
  buildQuasiExperimentalCsv,
  classifyScore,
  computeDimensionLayout,
  computeVariableLevels,
  generateQuasiExperimentalData,
  isQuasiExperimentalConfig,
  normalityFor,
  normalizeQuasiExperimentalConfig,
  prepareQuasiExperimentalRawConfig,
  resolveMediciones,
} from "./lib/quasi-experimental.js";
export { describe, mannWhitneyUTest, pairedTTest, welchTTest, wilcoxonSignedRankTest } from "./lib/quasi-stats.js";
export { buildQuasiExperimentalWorkbook } from "./lib/quasi-sheets.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
export const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "Tabulacion.json");
export const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "Tabulacion_generada.xlsx");
export const DEFAULT_BASE_CSV_PATH = path.join(ROOT_DIR, "Tabulacion_base.csv");

const buildChartsPreview = (sheetCharts) => sheetCharts
  .map(({ sheetName, charts }) => ({
    sheet: sheetName,
    charts: charts
      .filter((c) => c.preview)
      .map((c) => ({ title: c.title, categories: c.preview.categories, values: c.preview.values })),
  }))
  .filter((s) => s.charts.length > 0);

// Serializa el workbook y aplica el post-procesado OOXML. Se recibe el objeto
// "built" completo para poder liberar el DOM del workbook antes del
// post-procesado, lo que reduce el pico de memoria (importante en
// contenedores de 512 MB).
const finishWorkbook = async (built, cfg) => {
  const { sheetCharts } = built;
  const plainBuffer = await built.workbook.outputAsync({ type: "nodebuffer" });
  built.workbook = null;
  const excelBuffer = await postProcessWorkbook(plainBuffer, sheetCharts, CHART_THEMES[cfg.tema].colores);
  return { excelBuffer, chartsPreview: buildChartsPreview(sheetCharts) };
};

const generateQuasiArtifacts = async (rawConfig) => {
  const preparedRaw = prepareQuasiExperimentalRawConfig(rawConfig);
  // El diseño cuasiexperimental escribe hojas GE/GC pretest/postest (y, con
  // seguimiento, dos mas) por cada encuestado: cuesta memoria de forma
  // distinta al flujo correlacional, y sin pasarle estas dos señas
  // (cuasiexperimental + mediciones) el presupuesto conjunto de mas abajo lo
  // trataba como una variable correlacional cualquiera y dejaba pasar
  // combinaciones que agotan la memoria del contenedor (ver
  // scripts/benchmark-generacion-cuasiexperimental.mjs).
  const commonCfg = normalizeConfig(preparedRaw, {
    presupuesto: { cuasiexperimental: true, mediciones: resolveMediciones(rawConfig) },
  });
  const cfg = normalizeQuasiExperimentalConfig(rawConfig, commonCfg);
  const warnings = [...cfg.warnings];

  const quasiData = cfg.conDatos ? generateQuasiExperimentalData(cfg) : null;
  if (quasiData?.warnings?.length) warnings.push(...quasiData.warnings);

  const built = await buildQuasiExperimentalWorkbook(cfg, quasiData);
  const { excelBuffer, chartsPreview } = await finishWorkbook(built, cfg);
  const baseCsv = buildQuasiExperimentalCsv(quasiData, cfg);

  return {
    correlation: null,
    correlationControl: null,
    quasiExperimental: quasiData?.analysis ?? null,
    excelBuffer,
    baseCsv,
    warnings,
    chartsPreview,
    tema: cfg.tema,
    diseno: "cuasiexperimental",
  };
};

export const generateArtifacts = async (rawConfig) => {
  if (isQuasiExperimentalConfig(rawConfig)) {
    return generateQuasiArtifacts(rawConfig);
  }

  const cfg = normalizeConfig(rawConfig);
  const warnings = [...cfg.warnings];

  let base = null;
  let correlation = null;
  let correlationControl = null;
  if (cfg.conDatos) {
    const generated = generateBaseData(cfg);
    base = generated.base;
    correlationControl = generated.control;
    correlation = computeCorrelation(base, cfg);
  }
  if (cfg.variables.length < 2) {
    warnings.push("Se genero con 1 sola variable: no aplica correlacion entre variables.");
  }

  const built = await buildWorkbook(cfg, base, correlationControl);
  const { excelBuffer, chartsPreview } = await finishWorkbook(built, cfg);
  const baseCsv = buildBaseCsv(base, cfg);

  return {
    correlation,
    correlationControl,
    quasiExperimental: null,
    excelBuffer,
    baseCsv,
    warnings,
    chartsPreview,
    tema: cfg.tema,
    diseno: "correlacional",
  };
};

export const generateAndWriteFiles = async (config, opts = {}) => {
  const outputPath = opts.outputPath ? path.resolve(opts.outputPath) : DEFAULT_OUTPUT_PATH;
  const baseCsvPath = opts.baseCsvPath ? path.resolve(opts.baseCsvPath) : DEFAULT_BASE_CSV_PATH;

  const result = await generateArtifacts(config);
  fs.writeFileSync(outputPath, result.excelBuffer);
  fs.writeFileSync(baseCsvPath, result.baseCsv, "utf-8");

  return {
    correlation: result.correlation,
    quasiExperimental: result.quasiExperimental,
    diseno: result.diseno,
    warnings: result.warnings,
    outputPath,
    baseCsvPath,
  };
};
