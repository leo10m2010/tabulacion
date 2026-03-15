import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XlsxPopulate from "xlsx-populate";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
export const DEFAULT_TEMPLATE_PATH = path.join(ROOT_DIR, "Tabulacion.xlsx");
export const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "Tabulacion.json");
export const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "Tabulacion_generada.xlsx");
export const DEFAULT_BASE_CSV_PATH = path.join(ROOT_DIR, "Tabulacion_base.csv");

const toInt = (value, fallback = 0) => {
  const n = parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
};

const getItemCounts = (config) => {
  const v1 = toInt(Array.isArray(config.item) ? config.item[0] : config.item, 0);
  const v2 = toInt(Array.isArray(config.itemv2) ? config.itemv2[0] : config.itemv2, 0);
  return [v1, v2];
};

const randn = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

const pearson = (x, y) => {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return Number.NaN;
  return num / den;
};

const computeCorrelation = (data, config) => {
  const [v1Count, v2Count] = getItemCounts(config);
  const rows = Object.values(data)[0]?.length ?? 0;
  if (rows === 0) throw new Error("Base vacia.");
  if (rows < 2) throw new Error("Se requieren al menos 2 filas para correlacion.");

  const v1 = Array.from({ length: rows }, (_, i) => {
    let sum = 0;
    for (let c = 1; c <= v1Count; c += 1) sum += data[`V1_${c}`][i];
    return sum;
  });
  const v2 = Array.from({ length: rows }, (_, i) => {
    let sum = 0;
    for (let c = 1; c <= v2Count; c += 1) sum += data[`V2_${c}`][i];
    return sum;
  });

  const r = pearson(v1, v2);
  if (!Number.isFinite(r)) {
    throw new Error("No se pudo calcular una correlacion valida con la base generada.");
  }
  return r;
};

const generateBaseData = (config) => {
  const [v1Count, v2Count] = getItemCounts(config);
  if (v1Count <= 0 || v2Count <= 0) {
    throw new Error("Define el numero de items V1 y V2 antes de generar.");
  }

  const rows = toInt(config.muestra, 0);
  if (rows < 2) {
    throw new Error("N° de muestra debe ser mayor o igual a 2 para calcular correlacion.");
  }
  const maxResponse = Math.max(toInt(config.respuesta, 5), 1);
  const relacion = String(config.relacionversa ?? "0").trim().toLowerCase();
  const inversa = new Set(["1", "si", "sí", "true", "inversa"]).has(relacion);
  const sign = inversa ? -1 : 1;

  const targetCorr = 0.95;
  let noiseStd = Math.sqrt(1 / (targetCorr ** 2) - 1);

  const scaleToRange = (values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const mid = Math.floor((1 + maxResponse) / 2);
      return values.map(() => mid);
    }
    return values.map((v) => {
      const norm = (v - min) / (max - min);
      const mapped = 1 + norm * (maxResponse - 1);
      const val = Math.round(mapped);
      return Math.max(1, Math.min(maxResponse, val));
    });
  };

  const buildOnce = (std) => {
    const z = Array.from({ length: rows }, () => randn());
    const cols = {};
    for (let i = 1; i <= v1Count; i += 1) {
      cols[`V1_${i}`] = z.map((v) => v + randn() * std);
    }
    for (let i = 1; i <= v2Count; i += 1) {
      cols[`V2_${i}`] = z.map((v) => sign * v + randn() * std);
    }

    const data = {};
    Object.entries(cols).forEach(([k, values]) => {
      data[k] = scaleToRange(values);
    });
    return data;
  };

  let best = null;
  let bestCorr = 0;
  for (let i = 0; i < 6; i += 1) {
    const data = buildOnce(noiseStd);
    const r = computeCorrelation(data, config);
    if (Math.abs(r) > Math.abs(bestCorr)) {
      bestCorr = r;
      best = data;
    }
    if (Math.abs(r) >= 0.9) {
      return data;
    }
    noiseStd = Math.max(0.05, noiseStd * 0.7);
  }
  return best ?? buildOnce(0.05);
};

const writeSheetData = (sheet, headerRow, rows, rowLabels) => {
  const used = sheet.usedRange();
  const maxCol = used ? used.endCell().columnNumber() : 1;

  const prgCols = [];
  for (let c = 1; c <= maxCol; c += 1) {
    const val = sheet.cell(headerRow, c).value();
    if (typeof val === "string" && val.toUpperCase().startsWith("PRG.")) {
      prgCols.push(c);
    }
  }

  rows.forEach((row, idx) => {
    const r = headerRow + 1 + idx;
    sheet.cell(r, 1).value(rowLabels[idx]);
    row.forEach((val, j) => {
      const col = prgCols[j];
      if (col) sheet.cell(r, col).value(val);
    });
  });
};

const writeBaremoToSheet = (sheet, config, prefix = "") => {
  const nombres = Array.isArray(config.nombre_escala) ? config.nombre_escala : [];
  const desde = Array.isArray(config[`desde${prefix}`]) ? config[`desde${prefix}`] : [];
  const hasta = Array.isArray(config[`hasta${prefix}`]) ? config[`hasta${prefix}`] : [];
  const porcentaje = Array.isArray(config[`porcentaje${prefix}`]) ? config[`porcentaje${prefix}`] : [];
  const cantidad = Array.isArray(config[`cantidad${prefix}`]) ? config[`cantidad${prefix}`] : [];

  if (!nombres.length) return;

  const used = sheet.usedRange();
  if (!used) return;
  const maxRow = used.endCell().rowNumber();
  const maxCol = used.endCell().columnNumber();

  nombres.forEach((nombre, idx) => {
    if (!nombre) return;
    const nombreNorm = String(nombre).trim().toLowerCase();
    for (let r = 1; r <= maxRow; r += 1) {
      for (let c = 1; c <= maxCol; c += 1) {
        const v = sheet.cell(r, c).value();
        if (typeof v === "string" && v.trim().toLowerCase() === nombreNorm) {
          if (desde[idx] !== undefined) sheet.cell(r, c + 1).value(toInt(desde[idx], 0));
          if (hasta[idx] !== undefined) sheet.cell(r, c + 2).value(toInt(hasta[idx], 0));
          if (cantidad[idx] !== undefined) sheet.cell(r, c + 3).value(toInt(cantidad[idx], 0));
          if (porcentaje[idx] !== undefined) sheet.cell(r, c + 4).value(toInt(porcentaje[idx], 0));
        }
      }
    }
  });
};

const updateRightOfLabel = (sheet, label, value) => {
  const used = sheet.usedRange();
  if (!used) return;
  const maxRow = used.endCell().rowNumber();
  const maxCol = used.endCell().columnNumber();
  for (let r = 1; r <= maxRow; r += 1) {
    for (let c = 1; c <= maxCol; c += 1) {
      const v = sheet.cell(r, c).value();
      if (String(v ?? "").trim().toLowerCase() === label.toLowerCase()) {
        sheet.cell(r, c + 1).value(value);
      }
    }
  }
};

const updateListRow = (sheet, row, values) => {
  const used = sheet.usedRange();
  if (!used) return;
  const maxCol = used.endCell().columnNumber();
  const cols = [];
  for (let c = 2; c <= maxCol; c += 1) {
    const v = sheet.cell(row, c).value();
    if (v !== null && v !== undefined && v !== "") cols.push(c);
  }
  values.forEach((val, i) => {
    if (cols[i]) sheet.cell(row, cols[i]).value(val);
  });
};

const findRowWithValue = (sheet, value) => {
  const used = sheet.usedRange();
  if (!used) return null;
  const maxRow = used.endCell().rowNumber();
  const maxCol = used.endCell().columnNumber();
  for (let r = 1; r <= maxRow; r += 1) {
    for (let c = 1; c <= maxCol; c += 1) {
      const v = sheet.cell(r, c).value();
      if (String(v ?? "").trim() === value) return r;
    }
  }
  return null;
};

const buildSampleLabel = (config) => {
  const label = String(config.nommuestra ?? "").trim();
  return label || "Beneficiaros";
};

const applySampleLabelReplacements = (workbook, sampleLabel) => {
  if (!sampleLabel) return;
  const variants = [/beneficiaross/gi, /beneficiarios/gi, /beneficiaros/gi, /beneficiario/gi];
  workbook.sheets().forEach((sheet) => {
    const used = sheet.usedRange();
    if (!used) return;
    const maxRow = used.endCell().rowNumber();
    const maxCol = used.endCell().columnNumber();
    for (let r = 1; r <= maxRow; r += 1) {
      for (let c = 1; c <= maxCol; c += 1) {
        const cell = sheet.cell(r, c);
        if (cell.formula()) continue;
        const value = cell.value();
        if (typeof value !== "string") continue;
        let next = value;
        variants.forEach((pattern) => {
          next = next.replace(pattern, sampleLabel);
        });
        if (next !== value) {
          cell.value(next);
        }
      }
    }
  });
};

const getRequiredSheet = (workbook, name) => {
  const sheet = workbook.sheet(name);
  if (!sheet) {
    throw new Error(`No se encontro la hoja requerida en la plantilla: "${name}"`);
  }
  return sheet;
};

const buildBaseCsv = (base, v1Count, v2Count) => {
  const headers = [];
  for (let i = 1; i <= v1Count; i += 1) headers.push(`V1_${i}`);
  for (let i = 1; i <= v2Count; i += 1) headers.push(`V2_${i}`);

  const rows = Array.from({ length: base[headers[0]].length }, (_, i) => {
    return headers.map((h) => base[h][i]);
  });

  const csvLines = [headers.join(",")];
  rows.forEach((row) => csvLines.push(row.join(",")));
  return csvLines.join("\n");
};

export const generateArtifacts = async (config, opts = {}) => {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("La configuracion enviada no es valida.");
  }

  const templatePath = opts.templatePath ? path.resolve(opts.templatePath) : DEFAULT_TEMPLATE_PATH;
  if (!fs.existsSync(templatePath)) {
    throw new Error(`No se encontro la plantilla Excel: ${templatePath}`);
  }

  const base = generateBaseData(config);
  const r = computeCorrelation(base, config);
  const sampleLabel = buildSampleLabel(config);

  const workbook = await XlsxPopulate.fromFileAsync(templatePath);

  const [v1Count, v2Count] = getItemCounts(config);
  const sheetV1 = getRequiredSheet(workbook, "Gesti\u00f3n de abastecimiento");
  const sheetV2 = getRequiredSheet(workbook, "Satisfacci\u00f3n de los comit\u00e9s d");

  const headerRowV1 = findRowWithValue(sheetV1, "PRG.1");
  const headerRowV2 = findRowWithValue(sheetV2, "PRG.1");
  if (!headerRowV1) throw new Error('No se encontro "PRG.1" en la hoja de V1.');
  if (!headerRowV2) throw new Error('No se encontro "PRG.1" en la hoja de V2.');

  const rowLabels = Array.from({ length: base.V1_1.length }, (_, i) => `${sampleLabel} ${i + 1}`);

  const rowsV1 = rowLabels.map((_, i) => {
    const vals = [];
    for (let c = 1; c <= v1Count; c += 1) vals.push(base[`V1_${c}`][i]);
    return vals;
  });
  writeSheetData(sheetV1, headerRowV1, rowsV1, rowLabels);

  const rowsV2 = rowLabels.map((_, i) => {
    const vals = [];
    for (let c = 1; c <= v2Count; c += 1) vals.push(base[`V2_${c}`][i]);
    return vals;
  });
  writeSheetData(sheetV2, headerRowV2, rowsV2, rowLabels);

  const valoracionSheets = ["Por Valoracion (3) Dimension", "Por Valoracion (3) Dimension 2"];
  valoracionSheets.forEach((name, idx) => {
    const sheet = workbook.sheet(name);
    if (!sheet) return;
    const headerRow = findRowWithValue(sheet, "N\u00b0 de Personas");
    if (headerRow) {
      const indicators = Array.isArray(config.nombre_indicador) ? config.nombre_indicador : [];
      const indCounts = Array.isArray(config.numero_indicador0) ? config.numero_indicador0.map(toInt) : [];
      let list = [];
      if (indCounts.length > 0) {
        const start = indCounts.slice(0, idx).reduce((a, b) => a + b, 0);
        const count = indCounts[idx] ?? 0;
        list = indicators.slice(start, start + count);
      } else {
        list = indicators;
      }
      const dimNames = Array.isArray(config.nombre_dimension) ? config.nombre_dimension : [];
      list.push(dimNames[idx] ?? "Dimension 1");
      updateListRow(sheet, headerRow, list);

      rowLabels.forEach((label, i) => {
        sheet.cell(headerRow + 1 + i, 1).value(label);
      });
    }

    const dimNames = Array.isArray(config.nombre_dimension) ? config.nombre_dimension : [];
    updateRightOfLabel(sheet, "Variable", dimNames[idx] ?? "Dimension 1");
    updateRightOfLabel(sheet, "Cantidad de Escalas Valorativas", toInt(config.escala, 3));
    updateRightOfLabel(sheet, "Valor M\u00ednimo por item", 1);
    updateRightOfLabel(sheet, "Valor M\u00e1ximo por item", toInt(config.respuesta, 5));

    const baremoPrefix = idx === 0 ? "" : "_v2";
    writeBaremoToSheet(sheet, config, baremoPrefix);
  });

  const conteoSheets = ["Por conteo Dimension", "Por conteo Dimension 2"];
  conteoSheets.forEach((name, idx) => {
    const sheet = workbook.sheet(name);
    if (!sheet) return;
    const used = sheet.usedRange();
    if (!used) return;
    let headerRow = null;
    for (let r = 1; r <= 10; r += 1) {
      for (let c = 1; c <= used.endCell().columnNumber(); c += 1) {
        const v = sheet.cell(r, c).value();
        if (String(v ?? "").trim().toLowerCase().startsWith("tabla")) {
          headerRow = r + 1;
          break;
        }
      }
      if (headerRow) break;
    }
    if (headerRow) {
      const indicators = Array.isArray(config.nombre_indicador) ? config.nombre_indicador : [];
      const indCounts = Array.isArray(config.numero_indicador0) ? config.numero_indicador0.map(toInt) : [];
      let list = [];
      if (indCounts.length > 0) {
        const start = indCounts.slice(0, idx).reduce((a, b) => a + b, 0);
        const count = indCounts[idx] ?? 0;
        list = indicators.slice(start, start + count);
      } else {
        list = indicators;
      }
      updateListRow(sheet, headerRow, list);
    }
  });

  applySampleLabelReplacements(workbook, sampleLabel);

  const excelBuffer = await workbook.outputAsync({ type: "nodebuffer" });
  const baseCsv = buildBaseCsv(base, v1Count, v2Count);

  return {
    correlation: r,
    excelBuffer,
    baseCsv,
  };
};

export const generateAndWriteFiles = async (config, opts = {}) => {
  const outputPath = opts.outputPath ? path.resolve(opts.outputPath) : DEFAULT_OUTPUT_PATH;
  const baseCsvPath = opts.baseCsvPath ? path.resolve(opts.baseCsvPath) : DEFAULT_BASE_CSV_PATH;
  const templatePath = opts.templatePath ? path.resolve(opts.templatePath) : DEFAULT_TEMPLATE_PATH;

  const result = await generateArtifacts(config, { templatePath });
  fs.writeFileSync(outputPath, result.excelBuffer);
  fs.writeFileSync(baseCsvPath, result.baseCsv, "utf-8");

  return {
    correlation: result.correlation,
    outputPath,
    baseCsvPath,
  };
};
