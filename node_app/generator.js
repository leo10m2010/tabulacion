// Generador de tabulaciones 100% por codigo: construye el .xlsx completo
// (estructura, formulas reales, graficos e interpretaciones) sin depender de
// ninguna plantilla.
//
// Este archivo solo orquesta; la logica vive en lib/:
//   lib/config.js       normalizacion de la configuracion, limites y temas
//   lib/stats.js        simulacion de la base, correlacion y normalidad
//   lib/sheet-style.js  estilos y utilidades de construccion de hojas
//   lib/narratives.js   interpretaciones narrativas automaticas
//   lib/sheets.js       las hojas del workbook y buildWorkbook
//   lib/ooxml.js        deduplicacion de estilos e inyeccion de graficos OOXML
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CHART_THEMES, normalizeConfig } from "./lib/config.js";
import { buildBaseCsv, computeCorrelation, generateBaseData } from "./lib/stats.js";
import { buildWorkbook } from "./lib/sheets.js";
import { postProcessWorkbook } from "./lib/ooxml.js";

// API publica re-exportada (server, CLI y tests importan desde aqui).
export { CHART_THEMES, MAX_ITEMS_POR_VARIABLE, MAX_MUESTRA, normalizeConfig } from "./lib/config.js";
export { computeCorrelation, generateBaseData, lillieforsTest, shapiroWilkTest } from "./lib/stats.js";
export { buildWorkbook } from "./lib/sheets.js";
export { postProcessWorkbook } from "./lib/ooxml.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
export const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "Tabulacion.json");
export const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "Tabulacion_generada.xlsx");
export const DEFAULT_BASE_CSV_PATH = path.join(ROOT_DIR, "Tabulacion_base.csv");

export const generateArtifacts = async (rawConfig) => {
  const cfg = normalizeConfig(rawConfig);
  const warnings = [...cfg.warnings];

  let base = null;
  let correlation = null;
  if (cfg.conDatos) {
    base = generateBaseData(cfg);
    correlation = computeCorrelation(base, cfg);
  }
  if (cfg.variables.length < 2) {
    warnings.push("Se genero con 1 sola variable: no aplica correlacion entre variables.");
  }

  // Liberar el DOM del workbook antes del post-procesado reduce el pico de
  // memoria (importante en contenedores de 512 MB).
  let built = await buildWorkbook(cfg, base);
  const { sheetCharts } = built;
  const plainBuffer = await built.workbook.outputAsync({ type: "nodebuffer" });
  built = null;
  const excelBuffer = await postProcessWorkbook(plainBuffer, sheetCharts, CHART_THEMES[cfg.tema].colores);
  const baseCsv = buildBaseCsv(base, cfg);

  // Datos de los graficos para la vista previa del frontend (el xlsx guarda
  // formulas sin valores cacheados, asi que el navegador no puede derivarlos).
  const chartsPreview = sheetCharts
    .map(({ sheetName, charts }) => ({
      sheet: sheetName,
      charts: charts
        .filter((c) => c.preview)
        .map((c) => ({ title: c.title, categories: c.preview.categories, values: c.preview.values })),
    }))
    .filter((s) => s.charts.length > 0);

  return { correlation, excelBuffer, baseCsv, warnings, chartsPreview, tema: cfg.tema };
};

export const generateAndWriteFiles = async (config, opts = {}) => {
  const outputPath = opts.outputPath ? path.resolve(opts.outputPath) : DEFAULT_OUTPUT_PATH;
  const baseCsvPath = opts.baseCsvPath ? path.resolve(opts.baseCsvPath) : DEFAULT_BASE_CSV_PATH;

  const result = await generateArtifacts(config);
  fs.writeFileSync(outputPath, result.excelBuffer);
  fs.writeFileSync(baseCsvPath, result.baseCsv, "utf-8");

  return {
    correlation: result.correlation,
    warnings: result.warnings,
    outputPath,
    baseCsvPath,
  };
};
