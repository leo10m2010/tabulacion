// CLI: genera el Excel completo desde la configuracion JSON.
// Uso: node index.js [config.json] [salida.xlsx] [--sin-datos]
import fs from "fs";
import path from "path";
import {
  DEFAULT_BASE_CSV_PATH,
  DEFAULT_CONFIG_PATH,
  DEFAULT_OUTPUT_PATH,
  generateAndWriteFiles,
} from "./generator.js";

const args = process.argv.slice(2);
const sinDatos = args.includes("--sin-datos");
const positional = args.filter((a) => !a.startsWith("--"));
const configPath = positional[0] ? path.resolve(positional[0]) : DEFAULT_CONFIG_PATH;
const outputPath = positional[1] ? path.resolve(positional[1]) : DEFAULT_OUTPUT_PATH;

if (!fs.existsSync(configPath)) {
  throw new Error(`No se encontro el archivo de configuracion: ${configPath}`);
}

const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
if (sinDatos) rawConfig.conDatos = "0";

const result = await generateAndWriteFiles(rawConfig, {
  outputPath,
  baseCsvPath: DEFAULT_BASE_CSV_PATH,
});

const resumen = result.diseno === "cuasiexperimental"
  ? `diseno=cuasiexperimental | comparaciones=${result.quasiExperimental ? result.quasiExperimental.comparisons.length + 1 : 0}`
  : `r=${result.correlation === null
    ? (sinDatos ? "n/a (sin datos)" : "n/a (1 variable)")
    : result.correlation.toFixed(3)}`;
console.log(`OK -> ${resumen} | output=${result.outputPath} | base=${result.baseCsvPath}`);
(result.warnings ?? []).forEach((w) => console.warn(`[AVISO] ${w}`));
