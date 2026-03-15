import fs from "fs";
import {
  DEFAULT_BASE_CSV_PATH,
  DEFAULT_CONFIG_PATH,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_TEMPLATE_PATH,
  generateAndWriteFiles,
} from "./generator.js";

if (!fs.existsSync(DEFAULT_CONFIG_PATH)) {
  throw new Error(`No se encontro el archivo de configuracion: ${DEFAULT_CONFIG_PATH}`);
}

const rawConfig = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
const result = await generateAndWriteFiles(rawConfig, {
  templatePath: DEFAULT_TEMPLATE_PATH,
  outputPath: DEFAULT_OUTPUT_PATH,
  baseCsvPath: DEFAULT_BASE_CSV_PATH,
});

console.log(`OK -> r=${result.correlation.toFixed(3)} | output=${result.outputPath} | base=${result.baseCsvPath}`);
