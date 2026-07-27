// Presupuesto conjunto de complejidad.
//
// Los limites por separado (2.000 encuestados, 60 items por variable) NO
// cambian: lo que se rechaza es la COMBINACION que no cabe en los 512 MB del
// contenedor. Estas pruebas fijan las dos mitades del contrato:
//
//   a) todo lo que el benchmark midio por debajo de 480 MB se sigue aceptando;
//   b) todo lo que midio en 534 MB o mas se rechaza, con un mensaje que dice
//      que reducir.
//
// El benchmark esta en scripts/benchmark-generacion.mjs y corre con el mismo
// techo de heap que produccion.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import {
  MAX_ITEMS_POR_VARIABLE,
  MAX_MUESTRA,
  DEFAULT_CONFIG_PATH,
  normalizeConfig,
} from "../generator.js";
import {
  PRESUPUESTO_MAXIMO,
  costoGeneracion,
  evaluarPresupuesto,
  mensajePresupuesto,
  PRESUPUESTO_MAXIMO_DESCRIPTIVA,
  costoDescriptiva,
  evaluarPresupuestoDescriptiva,
  mensajePresupuestoDescriptiva,
} from "../lib/presupuesto.js";

const base = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));

// Casos medidos de verdad, con su pico de RSS. Si alguien cambia el modelo de
// coste, esta tabla dice si el cambio sigue separando lo que cabe de lo que no.
const MEDIDOS = [
  { encuestados: 30, itemsTotales: 15, variables: 2, picoMb: 161, cabe: true },
  { encuestados: 60, itemsTotales: 15, variables: 2, picoMb: 195, cabe: true },
  { encuestados: 289, itemsTotales: 27, variables: 2, picoMb: 350, cabe: true },
  { encuestados: 300, itemsTotales: 60, variables: 2, picoMb: 423, cabe: true },
  { encuestados: 1000, itemsTotales: 18, variables: 1, picoMb: 444, cabe: true },
  // A partir de aqui el worker solo ya no deja sitio al servidor HTTP dentro
  // de los 512 MB del contenedor.
  { encuestados: 500, itemsTotales: 40, variables: 2, picoMb: 534, cabe: false },
  { encuestados: 1000, itemsTotales: 15, variables: 2, picoMb: 572, cabe: false },
  { encuestados: 1200, itemsTotales: 15, variables: 2, picoMb: 574, cabe: false },
  { encuestados: 800, itemsTotales: 27, variables: 2, picoMb: 612, cabe: false },
  { encuestados: 1500, itemsTotales: 15, variables: 2, picoMb: null, cabe: false }, // OOM
];

test("el presupuesto separa lo medido que cabe de lo que no", () => {
  for (const caso of MEDIDOS) {
    const r = evaluarPresupuesto(caso);
    assert.equal(
      r.cabe, caso.cabe,
      `N=${caso.encuestados} items=${caso.itemsTotales} vars=${caso.variables} `
      + `(pico ${caso.picoMb ?? "OOM"} MB): costo ${r.costo}, esperado cabe=${caso.cabe}`,
    );
  }
});

test("el coste crece con la muestra y con los items", () => {
  const c = (n, i, v = 2) => costoGeneracion({ encuestados: n, itemsTotales: i, variables: v });
  assert.ok(c(200, 20) > c(100, 20));
  assert.ok(c(100, 40) > c(100, 20));
});

test("dos variables cuestan mas que una con los mismos items", () => {
  const una = costoGeneracion({ encuestados: 500, itemsTotales: 20, variables: 1 });
  const dos = costoGeneracion({ encuestados: 500, itemsTotales: 20, variables: 2 });
  assert.ok(dos > una, `una=${una} dos=${dos}`);
});

// ── Las funciones actuales siguen disponibles ────────────────────────────────

test("la configuracion de ejemplo del producto cabe con holgura", () => {
  const r = evaluarPresupuesto({ encuestados: 289, itemsTotales: 27, variables: 2 });
  assert.equal(r.cabe, true);
  assert.ok(r.costo < PRESUPUESTO_MAXIMO * 0.8, `costo ${r.costo} de ${PRESUPUESTO_MAXIMO}`);
});

test("los maximos por separado NO se han tocado", () => {
  assert.equal(MAX_MUESTRA, 2000);
  assert.equal(MAX_ITEMS_POR_VARIABLE, 60);
});

test("la muestra maxima sigue siendo posible con un instrumento corto", () => {
  // 2.000 encuestados siguen cabiendo: solo hay que no pedir a la vez el
  // maximo de items. Es lo que el mensaje explica.
  const r = evaluarPresupuesto({ encuestados: 2000, itemsTotales: 10, variables: 1 });
  assert.equal(r.cabe, true);
});

test("el maximo de items sigue siendo posible con una muestra normal", () => {
  const r = evaluarPresupuesto({ encuestados: 200, itemsTotales: 120, variables: 2 });
  assert.equal(r.cabe, true);
});

// ── El mensaje dice que reducir, no solo que no ──────────────────────────────

test("al rechazar, propone bajar la muestra y los items con numeros concretos", () => {
  const r = evaluarPresupuesto({ encuestados: 1200, itemsTotales: 15, variables: 2 });
  assert.equal(r.cabe, false);
  const msg = mensajePresupuesto(r);
  assert.match(msg, /baja la muestra a \d+/);
  assert.match(msg, /512 MB/);
  // Y deja claro que los limites individuales no han cambiado.
  assert.match(msg, /2\.000/);
  assert.match(msg, /60 .tems/);
});

test("propone generar cada variable por separado cuando hay dos", () => {
  const r = evaluarPresupuesto({ encuestados: 1000, itemsTotales: 20, variables: 2 });
  assert.match(mensajePresupuesto(r), /por separado/);
});

// ── El backend es la autoridad, y rechaza antes de generar ───────────────────

test("normalizeConfig rechaza la combinacion que no cabe", () => {
  assert.throws(
    () => normalizeConfig({ ...base, muestra: "1500" }),
    /no cabe en la memoria del servidor/i,
  );
});

test("normalizeConfig acepta la configuracion de ejemplo sin tocar", () => {
  assert.doesNotThrow(() => normalizeConfig(base));
});

test("el rechazo ocurre en la normalizacion, antes de construir nada", () => {
  // Importa el ORDEN: si el presupuesto se comprobara despues de generar, el
  // usuario habria pagado el uso y esperado igualmente.
  let error = null;
  try { normalizeConfig({ ...base, muestra: "1800" }); } catch (e) { error = e; }
  assert.ok(error, "deberia rechazar");
  assert.match(error.message, /coste estimado/i);
});

// ── Presupuesto de Descriptiva (auditoria de rendimiento, 2026-07-26) ───────
//
// A diferencia del generador principal, Descriptiva NO corre en el worker
// aislado: un pico de memoria aqui comparte proceso con el servidor HTTP.
// Estos casos vienen de scripts/benchmark-ia.mjs (mismo heap que produccion,
// --max-old-space-size=400); ver el comentario de costoDescriptiva en
// lib/presupuesto.js para la tabla completa.
const MEDIDOS_DESCRIPTIVA = [
  { encuestados: 60, itemsTotales: 20, picoMb: 146, cabe: true },
  { encuestados: 400, itemsTotales: 20, picoMb: 262, cabe: true },
  { encuestados: 400, itemsTotales: 40, picoMb: 377, cabe: true },
  { encuestados: 200, itemsTotales: 60, picoMb: 345, cabe: true },
  // N=400/items=45 (costo 18.000) midio 387 MB, tecnicamente seguro, pero el
  // mismo costo (300x60=18.000) midio 440 MB en otra combinacion: el costo
  // por si solo no distingue ambos casos, asi que el limite se fija por
  // DEBAJO de 18.000 y este caso se rechaza a proposito (falso rechazo
  // aceptado a cambio de nunca aceptar el otro).
  { encuestados: 400, itemsTotales: 45, picoMb: 387, cabe: false },
  // A partir de aqui, sin worker que lo aisle, ya es arriesgado compartir
  // proceso con el servidor HTTP.
  { encuestados: 400, itemsTotales: 50, picoMb: 430, cabe: false },
  { encuestados: 300, itemsTotales: 60, picoMb: 440, cabe: false },
  { encuestados: 400, itemsTotales: 60, picoMb: 455, cabe: false },
  { encuestados: 200, itemsTotales: 120, picoMb: 473, cabe: false },
  { encuestados: 400, itemsTotales: 80, picoMb: 529, cabe: false },
  { encuestados: 400, itemsTotales: 120, picoMb: null, cabe: false }, // OOM
];

test("el presupuesto de descriptiva separa lo medido que cabe de lo que no", () => {
  for (const caso of MEDIDOS_DESCRIPTIVA) {
    const r = evaluarPresupuestoDescriptiva(caso);
    assert.equal(
      r.cabe, caso.cabe,
      `N=${caso.encuestados} items=${caso.itemsTotales} (pico ${caso.picoMb ?? "OOM"} MB): `
      + `costo ${r.costo}, esperado cabe=${caso.cabe}`,
    );
  }
});

test("el coste de descriptiva crece con la muestra y con los items", () => {
  assert.ok(costoDescriptiva({ encuestados: 200, itemsTotales: 20 }) > costoDescriptiva({ encuestados: 100, itemsTotales: 20 }));
  assert.ok(costoDescriptiva({ encuestados: 100, itemsTotales: 40 }) > costoDescriptiva({ encuestados: 100, itemsTotales: 20 }));
});

test("descriptiva: la muestra tipica (DEFAULT_N=60) cabe con cualquier instrumento realista", () => {
  const r = evaluarPresupuestoDescriptiva({ encuestados: 60, itemsTotales: 60 });
  assert.equal(r.cabe, true);
});

test("descriptiva: el mensaje explica que acortar y que no se descuenta el uso", () => {
  const r = evaluarPresupuestoDescriptiva({ encuestados: 400, itemsTotales: 120 });
  assert.equal(r.cabe, false);
  const msg = mensajePresupuestoDescriptiva(r);
  assert.match(msg, /acorta el cuestionario a \d+ preguntas/);
  assert.match(msg, /No se descontó tu uso/);
});

test("descriptiva: los maximos no se han tocado", () => {
  assert.equal(PRESUPUESTO_MAXIMO_DESCRIPTIVA, 16_000);
});

// ── Presupuesto cuasiexperimental (auditoria de arquitectura/backend, 2026-07-26) ──
//
// generator.js nunca le pasaba `cuasiexperimental`/`mediciones` a
// evaluarPresupuesto: el diseño se evaluaba como si fuera una variable
// correlacional cualquiera, sin el peso extra de escribir 5 (o 7, con
// seguimiento) hojas completas por encuestado. El multiplicador subio de "+10"
// (nunca calibrado) a "+40". Estos casos vienen de
// scripts/benchmark-generacion-cuasiexperimental.mjs (mismo heap que
// produccion); ver el comentario "CUASIEXPERIMENTAL" en lib/presupuesto.js
// para la tabla completa con el pico de RSS de cada uno.
const MEDIDOS_CUASIEXPERIMENTAL = [
  { encuestados: 30, itemsTotales: 12, mediciones: 2, picoMb: 120, cabe: true },
  { encuestados: 100, itemsTotales: 10, mediciones: 2, picoMb: 186, cabe: true },
  { encuestados: 200, itemsTotales: 60, mediciones: 2, picoMb: 448, cabe: true },
  { encuestados: 500, itemsTotales: 20, mediciones: 2, picoMb: 422, cabe: true },
  // A partir de aqui, el diseño cuasiexperimental (5-7 hojas completas de N
  // filas) ya no deja sitio al servidor HTTP dentro de los 512 MB del
  // contenedor.
  { encuestados: 700, itemsTotales: 15, mediciones: 2, picoMb: 485, cabe: false },
  { encuestados: 600, itemsTotales: 20, mediciones: 2, picoMb: 494, cabe: false },
  { encuestados: 800, itemsTotales: 10, mediciones: 2, picoMb: 477, cabe: false },
  { encuestados: 900, itemsTotales: 10, mediciones: 2, picoMb: 509, cabe: false },
  { encuestados: 1000, itemsTotales: 10, mediciones: 2, picoMb: 541, cabe: false },
  { encuestados: 1200, itemsTotales: 10, mediciones: 2, picoMb: 545, cabe: false },
  { encuestados: 500, itemsTotales: 60, mediciones: 2, picoMb: null, cabe: false }, // OOM
  { encuestados: 1500, itemsTotales: 15, mediciones: 2, picoMb: null, cabe: false }, // OOM
  { encuestados: 100, itemsTotales: 15, mediciones: 3, picoMb: 333, cabe: true },
  { encuestados: 200, itemsTotales: 15, mediciones: 3, picoMb: 455, cabe: true },
  { encuestados: 600, itemsTotales: 15, mediciones: 3, picoMb: 583, cabe: false },
  { encuestados: 1000, itemsTotales: 15, mediciones: 3, picoMb: null, cabe: false }, // OOM
];

test("el presupuesto cuasiexperimental separa lo medido que cabe de lo que no", () => {
  for (const caso of MEDIDOS_CUASIEXPERIMENTAL) {
    const r = evaluarPresupuesto({ ...caso, cuasiexperimental: true });
    assert.equal(
      r.cabe, caso.cabe,
      `nExp+nCon=${caso.encuestados} items=${caso.itemsTotales} mediciones=${caso.mediciones} `
      + `(pico ${caso.picoMb ?? "OOM"} MB): costo ${r.costo}, esperado cabe=${caso.cabe}`,
    );
  }
});

test("a igual N x items, el diseño cuasiexperimental pesa mas que el correlacional de 1 variable", () => {
  const correlacional = costoGeneracion({ encuestados: 500, itemsTotales: 20, variables: 1 });
  const cuasi = costoGeneracion({ encuestados: 500, itemsTotales: 20, cuasiexperimental: true, mediciones: 2 });
  assert.ok(cuasi > correlacional, `correlacional=${correlacional} cuasi=${cuasi}`);
});

test("el seguimiento (mediciones=3) cuesta mas que sin seguimiento con el mismo N x items", () => {
  const sinSeguimiento = costoGeneracion({ encuestados: 200, itemsTotales: 15, cuasiexperimental: true, mediciones: 2 });
  const conSeguimiento = costoGeneracion({ encuestados: 200, itemsTotales: 15, cuasiexperimental: true, mediciones: 3 });
  assert.ok(conSeguimiento > sinSeguimiento, `sin=${sinSeguimiento} con=${conSeguimiento}`);
});
