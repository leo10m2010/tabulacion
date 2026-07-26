// Casos limite del generador de Excel.
//
// Todos salieron de generar archivos reales y validarlos con un lector
// independiente (openpyxl) y con el recalculo de formulas. Cubren cuatro
// defectos que producian archivos danados o cifras falsas, ninguno de ellos
// dentro del envelope que probaban las suites existentes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import XlsxPopulate from "xlsx-populate";
import {
  DEFAULT_CONFIG_PATH,
  generateArtifacts,
} from "../generator.js";
import { computeNiveles, sanitizeSheetName } from "../lib/sheet-style.js";

const baseConfig = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));

// ── Dimensiones o indicadores sin items ──────────────────────────────────────
//
// Producian endCol = startCol - 1 y el archivo salia con celdas combinadas
// invertidas ("B2:A2") y sumas como SUM(K34:J34). openpyxl se NIEGA a abrirlo.
// El usuario gastaba un uso en un .xlsx que Excel marca como danado.

test("una dimension sin items se rechaza antes de generar", async () => {
  await assert.rejects(
    () => generateArtifacts({
      ...baseConfig,
      variable: "1",
      items_por_dim_v1: ["0", "5", "4"],
      nombre_dims_v1: ["Vacia", "Dos", "Tres"],
    }),
    /no tiene items/i,
  );
});

test("da igual que la dimension vacia sea la ultima", async () => {
  await assert.rejects(
    () => generateArtifacts({
      ...baseConfig,
      variable: "1",
      items_por_dim_v1: ["5", "4", "0"],
      nombre_dims_v1: ["Una", "Dos", "Vacia"],
    }),
    /no tiene items/i,
  );
});

test("un indicador sin items tambien se rechaza", async () => {
  await assert.rejects(
    () => generateArtifacts({
      ...baseConfig,
      variable: "1",
      estructura_v1: [
        { nombre: "Dimension unica", indicadores: [
          { nombre: "Con items", items: 4 },
          { nombre: "Sin items", items: 0 },
        ] },
      ],
    }),
    /no tiene items/i,
  );
});

test("el mensaje nombra la dimension para que el usuario sepa cual arreglar", async () => {
  await assert.rejects(
    () => generateArtifacts({
      ...baseConfig,
      variable: "1",
      items_por_dim_v1: ["0", "9"],
      nombre_dims_v1: ["Clima laboral", "Comunicacion"],
    }),
    /Clima laboral/,
  );
});

test("una configuracion normal sigue generando", async () => {
  const r = await generateArtifacts({ ...baseConfig, variable: "1" });
  assert.ok(r.excelBuffer.length > 10000);
});

// ── Baremos con mas niveles que puntajes posibles ────────────────────────────
//
// La ficha de baremo mostraba filas "Desde 3, Hasta 2" y el IF anidado tenia
// umbrales muertos (dos IF(x<=2) seguidos).

test("computeNiveles nunca devuelve un rango invertido", () => {
  // 1 item, escala 1-5, 5 niveles: solo hay 5 puntajes para 5 niveles.
  const niveles = computeNiveles(1, 1, 5, ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"]);
  niveles.forEach((n) => {
    assert.ok(n.max >= n.min, `nivel "${n.nombre}" invertido: ${n.min}-${n.max}`);
  });
});

test("computeNiveles aguanta el caso mas extremo sin invertir rangos", () => {
  // 3 items, escala 1-2 (Si/No), 5 niveles: solo hay 4 puntajes posibles
  // (3,4,5,6) para 5 niveles. La configuracion es imposible y se rechaza en
  // config.js; este clamp es la defensa en profundidad para que, si alguna vez
  // llegara hasta aqui, el archivo no salga con rangos invertidos.
  const niveles = computeNiveles(3, 1, 2, ["A", "B", "C", "D", "E"]);
  niveles.forEach((n) => assert.ok(n.max >= n.min, `nivel "${n.nombre}" invertido: ${n.min}-${n.max}`));
});

test("un baremo con mas niveles que puntajes posibles se rechaza con explicacion", async () => {
  await assert.rejects(
    () => generateArtifacts({
      ...baseConfig,
      variable: "1",
      respuesta: "2",
      nombre_respuesta: ["No", "Si"],
      items_por_dim_v1: ["3"],
      nombre_dims_v1: ["Unica"],
      nombre_escala: ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"],
      // Sin baremo manual: se quiere ejercitar el baremo AUTOMATICO con mas
      // niveles que puntajes posibles. Dejando el del ejemplo (3 filas) saltaria
      // antes, y con razon, el error de "5 niveles pero 3 rangos".
      desde: [],
      hasta: [],
    }),
    /puntajes distintos/i,
  );
});

test("computeNiveles no cambia el reparto normal", () => {
  // 9 items, escala 1-5, 3 niveles => 9-20 / 21-32 / 33-45 (el de siempre).
  assert.deepEqual(computeNiveles(9, 1, 5, ["Bajo", "Medio", "Alto"]), [
    { nombre: "Bajo", min: 9, max: 20 },
    { nombre: "Medio", min: 21, max: 32 },
    { nombre: "Alto", min: 33, max: 45 },
  ]);
});

// ── Nombres de hoja ──────────────────────────────────────────────────────────
//
// El trim() iba antes del slice, asi que cortar dejaba espacios finales; y el
// apostrofo no se saneaba, lo que producia nombres que Excel prohibe y
// cientos de celdas #REF! al recalcular.

test("un nombre largo no deja espacio al final al truncarse", () => {
  const nombre = sanitizeSheetName("Calidad percibida del servicio educativo en la region", new Set());
  assert.ok(nombre.length <= 31);
  assert.equal(nombre, nombre.trim(), `queda espacio al final: "${nombre}"`);
});

test("el apostrofo se sanea (Excel prohibe empezar o terminar con el)", () => {
  const nombre = sanitizeSheetName("Gestion educativas' del sector publico", new Set());
  assert.ok(!nombre.includes("'"), `el nombre conserva un apostrofo: "${nombre}"`);
  assert.ok(!nombre.startsWith("'") && !nombre.endsWith("'"));
});

test("los caracteres prohibidos por Excel se siguen saneando", () => {
  const nombre = sanitizeSheetName("Desempeno *docente* [aula] / 2026", new Set());
  assert.ok(!/[[\]*?:/\\]/.test(nombre), `quedan caracteres prohibidos: "${nombre}"`);
});

test("la deduplicacion tampoco deja espacio antes del sufijo", () => {
  const usados = new Set();
  const largo = "Calidad percibida del servicio educativo";
  sanitizeSheetName(largo, usados);
  const segundo = sanitizeSheetName(largo, usados);
  assert.ok(segundo.endsWith("(2)"));
  assert.ok(!segundo.includes("  "), `doble espacio en "${segundo}"`);
  assert.ok(segundo.length <= 31);
});

// ── N=2 ──────────────────────────────────────────────────────────────────────
//
// Con 0 grados de libertad la formula da #DIV/0!/#NUM!, y el IFERROR los
// convertia en 0: la hoja mostraba "Sig. = 0.0000", que se lee como la
// significacion mas fuerte posible justo donde no hay informacion.

test("con N=2 la significacion queda vacia, no en cero", async () => {
  const r = await generateArtifacts({ ...baseConfig, muestra: "2" });
  const wb = await XlsxPopulate.fromDataAsync(r.excelBuffer);
  const hoja = wb.sheet("Relaciones");

  let formulaSig = null;
  for (let fila = 1; fila <= 80 && !formulaSig; fila += 1) {
    const f = hoja.cell(fila, 11).formula();
    if (typeof f === "string" && f.includes("T.DIST.2T")) formulaSig = f;
  }

  assert.ok(formulaSig, "no se encontro la formula de Sig. bilateral");
  assert.ok(
    !/IFERROR\([^)]*\),0\)/.test(formulaSig) && formulaSig.includes(',""))'),
    `el respaldo del IFERROR deberia ser vacio, no 0: ${formulaSig}`,
  );
});
