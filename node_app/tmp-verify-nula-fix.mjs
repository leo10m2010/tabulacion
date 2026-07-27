import fs from "fs";
import { normalizeConfig } from "./lib/config.js";
import { generateBaseData } from "./lib/stats.js";

const base = JSON.parse(fs.readFileSync("../Tabulacion.json", "utf-8"));

const runTrial = (muestra, trials = 30) => {
  const raw = { ...base, muestra: String(muestra), nivelCorrelacion: "nula", controlCorrelacion: "1" };
  const cfg = normalizeConfig(raw);
  let cumpleCount = 0;
  const obtenidos = [];
  for (let i = 0; i < trials; i += 1) {
    const { control } = generateBaseData(cfg);
    obtenidos.push(control.obtenido);
    if (control.cumple) cumpleCount += 1;
  }
  const abs = obtenidos.map(Math.abs);
  console.log(`N=${muestra}: cumple ${cumpleCount}/${trials}, |r| max=${Math.max(...abs).toFixed(4)}, mean=${(abs.reduce((a,b)=>a+b,0)/trials).toFixed(4)}`);
};

runTrial(30);
runTrial(60);
runTrial(150);
runTrial(289);
