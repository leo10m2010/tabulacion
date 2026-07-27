import fs from "fs";
import { normalizeConfig, NIVELES_CORRELACION } from "./lib/config.js";
import { generateBaseData } from "./lib/stats.js";

console.log("NIVELES_CORRELACION.nula:", NIVELES_CORRELACION.nula);
console.log("NIVELES_CORRELACION.muy_baja:", NIVELES_CORRELACION.muy_baja);
console.log("Solapamiento: [0.01, 0.09] pertenece a AMBOS rangos de busqueda.\n");

const base = JSON.parse(fs.readFileSync("../Tabulacion.json", "utf-8"));
const raw = { ...base, muestra: "50", nivelCorrelacion: "nula" };
const cfg = normalizeConfig(raw);

// Formula viva de la hoja "Correlacion" (sheets.js linea 789-793):
// IF(ABS(r)>=0.9,"muy alta", ... IF(ABS(r)>=0.01,"muy baja","nula"))
const clasificacionViva = (r) => {
  const a = Math.abs(r);
  if (a >= 0.9) return "muy alta";
  if (a >= 0.7) return "alta";
  if (a >= 0.4) return "moderada";
  if (a >= 0.2) return "baja";
  if (a >= 0.01) return "muy baja";
  return "nula";
};

let contradicciones = 0;
const trials = 40;
for (let i = 0; i < trials; i += 1) {
  const { control } = generateBaseData(cfg);
  const etiquetaViva = clasificacionViva(control.obtenido);
  if (control.cumple && etiquetaViva !== "nula") {
    contradicciones += 1;
    if (contradicciones <= 5) {
      console.log(
        `CONTRADICCION: nivel pedido="nula", control.cumple=true, obtenido=${control.obtenido.toFixed(4)}, `
        + `pero la formula viva de la hoja clasificaria esto como "Correlación ${etiquetaViva}".`,
      );
    }
  }
}
console.log(`\n${contradicciones}/${trials} corridas con nivel="nula" producen una contradiccion `
  + `entre el panel de control ("cumple") y la clasificacion en vivo de la hoja de correlacion.`);
