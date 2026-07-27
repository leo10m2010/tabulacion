// Presupuesto de complejidad de una generación.
//
// POR QUÉ EXISTE
// Los límites eran independientes (muestra ≤ 2.000, ítems ≤ 60 por variable) y
// se podían combinar en configuraciones que agotan la memoria del contenedor.
// El usuario lo descubría después de gastar un uso y esperar la generación.
//
// QUÉ NO HACE
// No recorta ninguna función ni reduce los máximos individuales: la muestra
// sigue llegando a 2.000 y los ítems a 60. Lo único que se rechaza es la
// COMBINACIÓN que no cabe, y el mensaje dice qué reducir para que quepa.
//
// DE DÓNDE SALE EL NÚMERO
// De medir, no de una fórmula teórica. `scripts/benchmark-generacion.mjs`
// genera cada caso en un proceso propio con el mismo techo de heap que
// producción (--max-old-space-size=400) y anota el pico de RSS:
//
//   N     ítems  vars  resultado   pico RSS
//   30    15     2     ok            161 MB
//   60    15     2     ok            195 MB
//   289   27     2     ok            350 MB
//   300   60     2     ok            423 MB
//   1000  18     1     ok            444 MB
//   2000  18     1     ok            478 MB
//   500   40     2     ok            534 MB   <- ya no cabe en el contenedor
//   1000  15     2     ok            572 MB   <- ya no cabe
//   1200  15     2     ok            574 MB   <- ya no cabe
//   800   27     2     ok            612 MB   <- ya no cabe
//   1500  15     2     OOM             —
//
// Dos lecturas importantes de esa tabla:
//
//  1. El coste NO es proporcional al número de celdas. 1000x15 son 15.000
//     celdas y gasta 572 MB; 300x60 son 18.000 y gasta 423 MB. Pesa más el
//     número de encuestados que el de ítems, porque cada encuestado añade
//     filas de fórmulas en las hojas de relaciones y dimensiones.
//  2. "ok" en local no significa "cabe en producción". El contenedor de Render
//     tiene 512 MB (verificado por su API: memory_limit = 536.870.900 bytes) y
//     el servidor HTTP ocupa ~50 MB mientras el worker genera. Un pico de
//     534 MB en el worker suma ~584 MB y el contenedor lo mata, aunque Node no
//     se haya quedado sin heap.
//
// El límite se fija donde la tabla separa limpiamente lo que cabe de lo que no.
//
// CUASIEXPERIMENTAL (2026-07-26)
// La formula de mas abajo para `cuasiexperimental: true` existia desde antes
// pero NUNCA se llamaba con esa señal: generator.js normalizaba el diseño
// cuasiexperimental con la MISMA evaluarPresupuesto del flujo correlacional,
// sin pasarle `cuasiexperimental`/`mediciones`, asi que en la practica se
// evaluaba como si fuera una variable correlacional cualquiera (sin el peso
// extra de escribir GE/GC Pretest, Postest, Seguimiento opcional, Consolidado
// y Comparaciones). El resultado: combinaciones muy por debajo de los limites
// individuales (muestra ≤ 2.000, items ≤ 60) reventaban el contenedor.
// Medido con `scripts/benchmark-generacion-cuasiexperimental.mjs` (mismo
// metodo: heap de 400 MB, pico de RSS real):
//
//   nExp+nCon  items  medic  resultado   pico RSS
//   30         12     2      ok            120 MB
//   100        10     2      ok            186 MB
//   200        60     2      ok            448 MB
//   500        20     2      ok            422 MB
//   700        15     2      ok            485 MB   <- ya al borde
//   600        20     2      ok            494 MB   <- ya al borde
//   800        10     2      ok            477 MB   <- ya al borde
//   900        10     2      ok            509 MB   <- ya no cabe
//   1000       10     2      ok            541 MB   <- ya no cabe
//   1200       10     2      ok            545 MB   <- ya no cabe
//   500        60     2      OOM             —
//   1500       15     2      OOM             —
//   100        15     3      ok            333 MB
//   200        15     3      ok            455 MB   <- ya al borde
//   600        15     3      ok            583 MB   <- ya no cabe
//   1000       15     3      OOM             —
//
// A igualdad de encuestados x items, el diseño cuasiexperimental pesa MAS que
// el correlacional de 1 variable: escribe 5 hojas completas (GE/GC Pretest y
// Postest, mas Consolidado) en vez de 1, y 7 con seguimiento (mediciones=3).
// Por eso el "+10" original (nunca calibrado: el benchmark de arriba jamas
// habia corrido el generador cuasiexperimental) se sube a "+40", que separa
// limpiamente lo medido: todo lo de arriba hasta 455 MB queda aceptado y
// todo lo de 477 MB en adelante, rechazado (el margen entre 455 y 477 es a
// proposito: mejor rechazar un poco antes que despues, dado lo poco que tarda
// en dispararse el RSS cerca del limite en este diseño).

// Peso del salto a dos variables: aparecen las hojas de relaciones y
// correlación, con una fila de fórmulas por encuestado en cada una. Se expresa
// como "ítems equivalentes" para que el coste quede en una sola unidad.
export const ITEMS_EQUIVALENTES_POR_VARIABLE_EXTRA = 30;

// Techo del presupuesto. Con él, todos los casos medidos por debajo de 480 MB
// se aceptan y todos los de 534 MB en adelante se rechazan.
export const PRESUPUESTO_MAXIMO = 30_000;

// Memoria del contenedor de producción, para poder explicarlo en el mensaje.
export const MEMORIA_CONTENEDOR_MB = 512;

/**
 * Coste estimado de una generación, en la unidad del presupuesto.
 *
 * @param {object} entrada
 * @param {number} entrada.encuestados  Tamaño de la muestra.
 * @param {number} entrada.itemsTotales Suma de ítems de todas las variables.
 * @param {number} entrada.variables    Cuántas variables tiene el instrumento.
 * @param {boolean} [entrada.cuasiexperimental] El diseño cuasiexperimental
 *   escribe 5 hojas completas de N filas (GE/GC Pretest, Postest y
 *   Consolidado), o 7 con seguimiento, en vez de 1-2 del flujo correlacional.
 * @param {number} [entrada.mediciones] 2 (pre/post) o 3 (con seguimiento).
 */
export const costoGeneracion = ({
  encuestados,
  itemsTotales,
  variables,
  cuasiexperimental = false,
  mediciones = 2,
}) => {
  const n = Math.max(0, Number(encuestados) || 0);
  const items = Math.max(0, Number(itemsTotales) || 0);
  const vars = Math.max(1, Number(variables) || 1);

  if (cuasiexperimental) {
    // Cada medición es una hoja completa de N filas con sus fórmulas de
    // puntaje y nivel; el consolidado añade otra. El "+40" (en vez del "+10"
    // original, nunca calibrado) sale de medir el generador real: ver el
    // comentario "CUASIEXPERIMENTAL" al inicio de este archivo.
    const hojas = Math.max(2, Number(mediciones) || 2) * 2 + 1;
    return Math.round(n * (items + 40) * (hojas / 5));
  }

  return Math.round(n * (items + ITEMS_EQUIVALENTES_POR_VARIABLE_EXTRA * (vars - 1)));
};

// Mayor entero en [0, techo] tal que, cambiando SOLO `campo` de `entrada`, el
// costo siga cabiendo en el presupuesto. Generico a proposito: busca sobre
// costoGeneracion en vez de despejar la formula a mano, asi que sirve igual
// para el flujo correlacional que para el cuasiexperimental (con su propio
// multiplicador por mediciones) sin duplicar ninguna de las dos aqui. Ambas
// formulas son monotonas crecientes en `encuestados` e `itemsTotales`, que es
// lo unico que necesita una busqueda binaria.
const mayorQueCabe = (entrada, campo, techo) => {
  if (techo < 1 || costoGeneracion({ ...entrada, [campo]: 1 }) > PRESUPUESTO_MAXIMO) return 0;
  let lo = 1;
  let hi = techo;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (costoGeneracion({ ...entrada, [campo]: mid }) <= PRESUPUESTO_MAXIMO) lo = mid; else hi = mid - 1;
  }
  return lo;
};

/**
 * ¿Cabe esta configuración? Devuelve siempre el coste, para poder mostrarlo.
 * Cuando no cabe, `sugerencias` dice qué reducir y hasta cuánto — el usuario
 * elige qué sacrificar, no el sistema.
 */
export const evaluarPresupuesto = (entrada) => {
  const costo = costoGeneracion(entrada);
  const cabe = costo <= PRESUPUESTO_MAXIMO;
  if (cabe) return { cabe: true, costo, maximo: PRESUPUESTO_MAXIMO, sugerencias: [] };

  const n = Math.max(1, Number(entrada.encuestados) || 1);
  const items = Math.max(1, Number(entrada.itemsTotales) || 1);
  const vars = Math.max(1, Number(entrada.variables) || 1);

  const sugerencias = [];
  // Cuántos encuestados caben con los ítems actuales.
  const nMax = mayorQueCabe(entrada, "encuestados", n);
  if (nMax >= 2 && nMax < n) {
    sugerencias.push(`baja la muestra a ${nMax} encuestados o menos (ahora ${n})`);
  }
  // Cuántos ítems caben con la muestra actual.
  const itemsMax = mayorQueCabe(entrada, "itemsTotales", items);
  if (itemsMax >= 1 && itemsMax < items) {
    sugerencias.push(`baja el total de ítems a ${itemsMax} o menos (ahora ${items})`);
  }
  if (vars > 1) {
    sugerencias.push("o genera cada variable por separado, en dos archivos");
  }

  return { cabe: false, costo, maximo: PRESUPUESTO_MAXIMO, sugerencias };
};

/** Mensaje para el usuario. Explica el motivo y deja la decisión en sus manos. */
export const mensajePresupuesto = (evaluacion) => {
  const opciones = evaluacion.sugerencias.length > 0
    ? ` Para que quepa, ${evaluacion.sugerencias.join("; ")}.`
    : "";
  return (
    "Esta combinación de muestra e ítems no cabe en la memoria del servidor "
    + `(${MEMORIA_CONTENEDOR_MB} MB): su coste estimado es ${evaluacion.costo.toLocaleString("es")} `
    + `y el máximo es ${evaluacion.maximo.toLocaleString("es")}.${opciones} `
    + "Los límites por separado no cambian: la muestra sigue admitiendo hasta 2.000 "
    + "encuestados y cada variable hasta 60 ítems; lo que no cabe es esta combinación concreta."
  );
};

// ── Presupuesto de Tabulacion Descriptiva (IA) ───────────────────────────────
//
// POR QUE EXISTE (auditoria de rendimiento, 2026-07-26)
// A diferencia del generador principal, Descriptiva NO corre en el worker
// aislado de lib/generation/: lib/descriptiva/index.js construye el .xlsx
// (xlsx-populate + graficos OOXML) en el mismo proceso que el servidor HTTP.
// Un pico de memoria aqui no solo mata ESE job (como en el worker): puede
// tumbar el proceso entero y con el TODAS las peticiones en curso de TODOS
// los usuarios. La muestra ya esta acotada (10-400, ver DEFAULT_N/MAX_N en
// lib/descriptiva/index.js) pero el numero de preguntas del instrumento NO
// tenia ningun tope: lo fija el cuestionario que el usuario pega o sube
// (hasta MAX_CUESTIONARIO_CHARS = 40.000 caracteres), que alcanza de sobra
// para 100+ items Likert cortos.
//
// DE DONDE SALE EL NUMERO
// Medido con scripts/benchmark-ia.mjs (mismo patron que benchmark-generacion:
// proceso hijo con el heap de produccion, --max-old-space-size=400), armando
// el JSON que la IA devolveria (sin llamada de red) y construyendo el .xlsx:
//
//   N     items  resultado   pico RSS
//   60    20     ok            146 MB
//   400   20     ok            262 MB
//   400   40     ok         346-377 MB
//   400   45     ok            387 MB
//   200   60     ok            345 MB
//   400   50     ok            430 MB   <- ya arriesgado
//   300   60     ok            440 MB   <- ya arriesgado
//   400   55     ok            450 MB   <- ya arriesgado
//   400   60     ok         432-455 MB  <- ya arriesgado
//   200   120    ok            473 MB   <- ya arriesgado
//   100   120    ok            401 MB   <- ya arriesgado
//   400   80     ok            529 MB   <- no cabe
//   400   120    OOM             —
//
// A diferencia del generador principal (donde la fila base son formulas y el
// costo escala sobre todo con los ENCUESTADOS), en Descriptiva la hoja "Base
// de datos" son valores planos (sin formulas): el costo dominante es el de
// la hoja "Resultados", que arma una tabla + un grafico OOXML POR PREGUNTA
// sin importar N. Por eso los items pesan mas de lo que pesarian en el
// generador principal, y el presupuesto se expresa igual (N x items) pero
// con un techo mucho mas bajo.
//
// El limite se fija donde la tabla separa limpiamente lo medido que cabe
// (<=400 MB) de lo que ya no es seguro compartiendolo con el servidor HTTP
// sin ningun worker que lo aisle.
export const PRESUPUESTO_MAXIMO_DESCRIPTIVA = 16_000;

/** Coste estimado de Descriptiva: N x items (sin variables ni cuasiexperimental). */
export const costoDescriptiva = ({ encuestados, itemsTotales }) => {
  const n = Math.max(0, Number(encuestados) || 0);
  const items = Math.max(0, Number(itemsTotales) || 0);
  return Math.round(n * items);
};

/**
 * ¿Cabe este instrumento? Se evalua DESPUES de que la IA responde (recien
 * ahi se conoce `itemsTotales`, el numero real de preguntas del
 * cuestionario) y ANTES de construir el .xlsx.
 */
export const evaluarPresupuestoDescriptiva = (entrada) => {
  const costo = costoDescriptiva(entrada);
  const cabe = costo <= PRESUPUESTO_MAXIMO_DESCRIPTIVA;
  if (cabe) return { cabe: true, costo, maximo: PRESUPUESTO_MAXIMO_DESCRIPTIVA, sugerencias: [] };

  const n = Math.max(1, Number(entrada.encuestados) || 1);
  const items = Math.max(1, Number(entrada.itemsTotales) || 1);
  const sugerencias = [];
  const nMax = Math.floor(PRESUPUESTO_MAXIMO_DESCRIPTIVA / items);
  if (nMax >= 10 && nMax < n) {
    sugerencias.push(`baja la muestra (N) a ${nMax} o menos (ahora ${n})`);
  }
  const itemsMax = Math.floor(PRESUPUESTO_MAXIMO_DESCRIPTIVA / n);
  if (itemsMax >= 1 && itemsMax < items) {
    sugerencias.push(`acorta el cuestionario a ${itemsMax} preguntas o menos (ahora ${items})`);
  }
  return { cabe: false, costo, maximo: PRESUPUESTO_MAXIMO_DESCRIPTIVA, sugerencias };
};

/** Mensaje para el usuario (error de job, no de validacion previa: el numero
 * real de preguntas solo se conoce despues de que la IA responde). */
export const mensajePresupuestoDescriptiva = (evaluacion) => {
  const opciones = evaluacion.sugerencias.length > 0
    ? ` Para tu próxima generación, ${evaluacion.sugerencias.join("; ")}.`
    : "";
  return (
    "Tu instrumento tiene demasiadas preguntas para la muestra (N) solicitada; la combinación no cabe "
    + `en la memoria del servidor.${opciones} No se descontó tu uso.`
  );
};
