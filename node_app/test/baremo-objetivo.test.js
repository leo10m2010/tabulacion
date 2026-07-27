// El baremo debe repartir a los encuestados como pidio el usuario.
//
// La interfaz pregunta "que porcentaje de personas cae en cada nivel", calcula
// las cantidades y obliga a que sumen 100. Durante mucho tiempo la simulacion
// IGNORABA ese dato: pidiendo 46/35/19 salia cualquier cosa (se midio 17/48/35
// en una corrida y 40/28/32 en otra). El Excel no inventaba numeros —contaba
// con COUNTIF los datos reales— pero lo entregado no coincidia con lo
// configurado, y sin ningun aviso.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBaseData, spearmanCorrelation } from "../generator.js";
import { normalizeConfig, NIVELES_CORRELACION } from "../lib/config.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "Tabulacion.json"), "utf-8"));

// Cuenta cuantos encuestados caen en cada banda del baremo de una variable.
const repartoReal = (base, cfg, varIndex) => {
  const variable = cfg.variables[varIndex];
  const bandas = variable.baremoVariable;
  const cuentas = bandas.map(() => 0);
  for (let r = 0; r < cfg.encuestados; r += 1) {
    let total = 0;
    for (let c = 1; c <= variable.totalItems; c += 1) {
      total += base[`V${varIndex + 1}_${c}`][r];
    }
    const i = bandas.findIndex((b) => total >= b.min && total <= b.max);
    assert.ok(i >= 0, `el total ${total} no cae en ninguna banda`);
    cuentas[i] += 1;
  }
  return cuentas;
};

describe("reparto del baremo", () => {
  test("respeta EXACTAMENTE los porcentajes pedidos", () => {
    const cfg = normalizeConfig({ ...RAW, muestra: "60" });
    const { base } = generateBaseData(cfg);
    // 46/35/19 sobre 60 -> 28/21/11
    assert.deepEqual(repartoReal(base, cfg, 0), [28, 21, 11]);
    assert.deepEqual(repartoReal(base, cfg, 1), [28, 21, 11]);
  });

  test("es estable entre corridas, no cuestion de suerte", () => {
    // Antes variaba de 17% a 40% en el primer nivel de una corrida a otra.
    for (let i = 0; i < 5; i += 1) {
      const cfg = normalizeConfig({ ...RAW, muestra: "80" });
      // 46/35/19 sobre 80 -> 37/28/15
      assert.deepEqual(repartoReal(generateBaseData(cfg).base, cfg, 0), [37, 28, 15]);
    }
  });

  test("las cantidades suman siempre el total de encuestados", () => {
    for (const n of [17, 41, 123]) {
      const cfg = normalizeConfig({ ...RAW, muestra: String(n) });
      const cuentas = repartoReal(generateBaseData(cfg).base, cfg, 0);
      assert.equal(cuentas.reduce((a, b) => a + b, 0), n, `con ${n} encuestados`);
    }
  });

  test("funciona con un reparto muy desigual", () => {
    const cfg = normalizeConfig({ ...RAW, muestra: "100", porcentaje: ["5", "10", "85"] });
    assert.deepEqual(repartoReal(generateBaseData(cfg).base, cfg, 0), [5, 10, 85]);
  });

  test("sin porcentajes no fuerza nada (no rompe configuraciones antiguas)", () => {
    const sinPct = { ...RAW, muestra: "60" };
    delete sinPct.porcentaje;
    delete sinPct.porcentaje_v2;
    const cfg = normalizeConfig(sinPct);
    assert.equal(cfg.variables[0].baremoObjetivo, undefined);
    const cuentas = repartoReal(generateBaseData(cfg).base, cfg, 0);
    assert.equal(cuentas.reduce((a, b) => a + b, 0), 60, "sigue generando datos validos");
  });
});

describe("el ajuste del baremo NO rompe la correlacion", () => {
  test("el control de correlacion sigue alcanzando su objetivo", () => {
    // El ajuste remapea los totales de forma MONOTONA, asi que el orden —y con
    // el la correlacion de rangos— se conserva. Si alguien lo cambiara por un
    // ajuste no monotono, esta prueba lo detecta.
    for (const nivel of ["muy_alta", "alta", "moderada", "baja"]) {
      const cfg = normalizeConfig({
        ...RAW, muestra: "60", controlCorrelacion: "1", nivelCorrelacion: nivel,
      });
      const { control } = generateBaseData(cfg);
      assert.equal(control.cumple, true, `nivel ${nivel}: obtenido ${control.obtenido}`);
      assert.ok(
        Math.abs(control.obtenido) >= control.esperadoMin
        && Math.abs(control.obtenido) <= control.esperadoMax,
        `nivel ${nivel}: ${control.obtenido} fuera de ${control.esperadoMin}-${control.esperadoMax}`,
      );
    }
  });

  test("la relacion inversa sigue dando correlacion negativa", () => {
    const cfg = normalizeConfig({
      ...RAW, muestra: "60", relacionversa: "1", controlCorrelacion: "1", nivelCorrelacion: "alta",
    });
    const { base, control } = generateBaseData(cfg);
    assert.ok(control.obtenido < 0, `deberia ser negativa, fue ${control.obtenido}`);
    // Y el reparto del baremo se respeta igual.
    assert.deepEqual(repartoReal(base, cfg, 0), [28, 21, 11]);
    assert.ok(spearmanCorrelation !== undefined);
  });
});

describe("el nivel 'nula' no contradice la formula viva de la hoja Correlación", () => {
  // La hoja "Correlación" (lib/sheets.js) clasifica el r obtenido con una
  // formula IF en vivo: ABS(r) >= 0.01 -> "Correlación muy baja", si no ->
  // "Correlación nula". Ese 0.01 es tambien, a proposito, el minimo del nivel
  // "muy_baja" en NIVELES_CORRELACION.
  //
  // El nivel "nula" tenia max=0.09, que SOLAPA con el rango de busqueda de
  // "muy_baja" (0.01-0.19). Consecuencia real: pedir nivel="nula" podia
  // terminar (r=0.02, por ejemplo) con el panel de control diciendo "Nivel
  // elegido: Correlación nula ... ¿Cumple el rango elegido? Sí" mientras la
  // propia hoja "Correlación", calculada con la formula de arriba sobre esos
  // mismos datos, mostraba "Correlación muy baja". Dos partes del mismo
  // archivo se contradecian sobre el mismo numero.
  test("los rangos de busqueda de NIVELES_CORRELACION no se solapan", () => {
    assert.ok(
      NIVELES_CORRELACION.nula.max < NIVELES_CORRELACION.muy_baja.min,
      `nula.max (${NIVELES_CORRELACION.nula.max}) debe quedar por debajo de `
      + `muy_baja.min (${NIVELES_CORRELACION.muy_baja.min}); si no, un mismo r `
      + "puede 'cumplir' dos niveles a la vez.",
    );
  });

  test("cuando 'nula' cumple, la formula viva de la hoja tambien lo llamaria nula", () => {
    // Formula de lib/sheets.js (addCorrelacionSheet), traducida a JS: el
    // primer umbral que se cumple manda, de mayor a menor.
    const clasificacionViva = (r) => {
      const a = Math.abs(r);
      if (a >= 0.9) return "muy_alta";
      if (a >= 0.7) return "alta";
      if (a >= 0.4) return "moderada";
      if (a >= 0.2) return "baja";
      if (a >= 0.01) return "muy_baja";
      return "nula";
    };
    for (let i = 0; i < 15; i += 1) {
      const cfg = normalizeConfig({
        ...RAW, muestra: "60", controlCorrelacion: "1", nivelCorrelacion: "nula",
      });
      const { control } = generateBaseData(cfg);
      if (!control.cumple) continue; // el fallback honesto ya avisa aparte
      assert.equal(
        clasificacionViva(control.obtenido), "nula",
        `control.cumple=true con obtenido=${control.obtenido}, pero la hoja `
        + `"Correlación" clasificaria esto como "${clasificacionViva(control.obtenido)}", `
        + "no como nula: el archivo se contradiria a si mismo.",
      );
    }
  });
});

describe("respuestas validas tras el ajuste", () => {
  test("ningun item queda fuera de la escala", () => {
    const cfg = normalizeConfig({ ...RAW, muestra: "60" });
    const { base } = generateBaseData(cfg);
    const min = Math.min(...cfg.escala.map((o) => o.valor));
    const max = Math.max(...cfg.escala.map((o) => o.valor));
    for (const [col, valores] of Object.entries(base)) {
      for (const v of valores) {
        assert.ok(Number.isInteger(v), `${col}: ${v} no es entero`);
        assert.ok(v >= min && v <= max, `${col}: ${v} fuera de ${min}..${max}`);
      }
    }
  });
});
