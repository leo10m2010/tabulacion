// Normalizacion de la configuracion del generador y limites del sistema.
// Acepta tanto el formato del frontend (muestra, nombre_respuesta,
// estructura_v1, nombre_dims_v1, ...) como un formato anidado directo
// ({ encuestados, escala: [...], variables: [{ dimensiones: [...] }] }).

export const MAX_MUESTRA = 2000;
export const MAX_ITEMS_POR_VARIABLE = 60;

const CHART_COLOR = "2F5597"; // azul historico de los graficos

// Temas de color para los graficos (paletas estilo Power BI). "clasico"
// conserva el azul unico historico; los demas colorean cada barra ciclando su
// paleta, tanto en el Excel como en la vista previa del frontend (que debe
// mantener estas mismas paletas en frontend/src/lib/constants.ts).
export const CHART_THEMES = {
  clasico: { nombre: "Clásico", colores: [CHART_COLOR] },
  powerbi: { nombre: "Power BI", colores: ["118DFF", "12239E", "E66C37", "6B007B", "E044A7", "744EC2", "D9B300", "D64550"] },
  ejecutivo: { nombre: "Ejecutivo", colores: ["1F3864", "2F5597", "8EAADB", "BF9000", "767171"] },
  esmeralda: { nombre: "Esmeralda", colores: ["0B5345", "148F77", "45B39D", "82E0AA", "1E8449"] },
  atardecer: { nombre: "Atardecer", colores: ["9D0208", "D00000", "E85D04", "F48C06", "FFBA08"] },
  monocromo: { nombre: "Monocromo", colores: ["212529", "495057", "6C757D", "ADB5BD", "CED4DA"] },
};

// Niveles de correlacion para el control opcional de la simulacion. Los
// rangos son en valor absoluto: el signo lo define la relacion (directa /
// inversa) elegida por el usuario. "nula" acepta la fluctuacion muestral
// natural alrededor de 0.
export const NIVELES_CORRELACION = {
  muy_alta: { etiqueta: "Correlación muy alta", min: 0.9, max: 1.0 },
  alta: { etiqueta: "Correlación alta", min: 0.7, max: 0.89 },
  moderada: { etiqueta: "Correlación moderada", min: 0.4, max: 0.69 },
  baja: { etiqueta: "Correlación baja", min: 0.2, max: 0.39 },
  muy_baja: { etiqueta: "Correlación muy baja", min: 0.01, max: 0.19 },
  nula: { etiqueta: "Correlación nula", min: 0, max: 0.09 },
};

export const toInt = (value, fallback = 0) => {
  const n = parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
};

const buildVariableFromFlat = (raw, varNum, fallbackItems) => {
  const estructura = raw[`estructura_v${varNum}`];
  if (Array.isArray(estructura) && estructura.length > 0) {
    return estructura.map((d) => ({
      nombre: String(d.nombre ?? "").trim() || "Dimensión",
      indicadores: (Array.isArray(d.indicadores) && d.indicadores.length > 0
        ? d.indicadores
        : [{ nombre: d.nombre, items: d.items }]
      ).map((ind) => ({
        nombre: String(ind.nombre ?? "").trim() || String(d.nombre ?? "Indicador"),
        items: toInt(Array.isArray(ind.items) ? ind.items.length : ind.items, 0),
      })),
    }));
  }

  const dimNames = Array.isArray(raw[`nombre_dims_v${varNum}`]) ? raw[`nombre_dims_v${varNum}`] : [];
  const itemsPerDim = Array.isArray(raw[`items_por_dim_v${varNum}`])
    ? raw[`items_por_dim_v${varNum}`].map((v) => toInt(v, 0))
    : [];
  if (dimNames.length > 0 && itemsPerDim.length === dimNames.length) {
    return dimNames.map((nombre, i) => ({
      nombre: String(nombre).trim() || `Dimensión ${i + 1}`,
      indicadores: [{ nombre: String(nombre).trim() || `Dimensión ${i + 1}`, items: itemsPerDim[i] }],
    }));
  }

  if (fallbackItems > 0) {
    return [{
      nombre: "Dimensión única",
      indicadores: [{ nombre: "Dimensión única", items: fallbackItems }],
    }];
  }
  return [];
};

const parseBaremoOverride = (raw, suffix, nivelNames) => {
  const desde = Array.isArray(raw[`desde${suffix}`]) ? raw[`desde${suffix}`].map((v) => toInt(v, NaN)) : [];
  const hasta = Array.isArray(raw[`hasta${suffix}`]) ? raw[`hasta${suffix}`].map((v) => toInt(v, NaN)) : [];
  if (desde.length !== nivelNames.length || hasta.length !== nivelNames.length) return undefined;
  if (desde.some((v) => !Number.isFinite(v)) || hasta.some((v) => !Number.isFinite(v))) return undefined;
  return nivelNames.map((nombre, i) => ({ nombre, min: desde[i], max: hasta[i] }));
};

const DEFAULT_NIVEL_NAMES = {
  2: ["Bajo", "Alto"],
  3: ["Bajo", "Medio", "Alto"],
  4: ["Muy bajo", "Bajo", "Alto", "Muy alto"],
  5: ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"],
};

export const normalizeConfig = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Debes enviar una configuracion valida (objeto JSON).");
  }

  const encuestados = toInt(raw.encuestados ?? raw.muestra, 0);
  if (encuestados < 2) {
    throw new Error("N° de muestra debe ser mayor o igual a 2.");
  }
  if (encuestados > MAX_MUESTRA) {
    throw new Error(`La muestra maxima soportada es ${MAX_MUESTRA} (configuraste ${encuestados}).`);
  }

  // Escala de respuesta (opciones por item).
  let escala;
  if (Array.isArray(raw.escala) && raw.escala.some((o) => typeof o === "object" || typeof o === "string")) {
    escala = raw.escala.map((opt, i) => (typeof opt === "string"
      ? { valor: i + 1, etiqueta: opt }
      : { valor: toInt(opt.valor, i + 1), etiqueta: String(opt.etiqueta ?? opt.valor) }));
  } else {
    const labels = Array.isArray(raw.nombre_respuesta) ? raw.nombre_respuesta.map(String) : [];
    const count = labels.length > 0 ? labels.length : Math.max(toInt(raw.respuesta, 5), 2);
    escala = Array.from({ length: count }, (_, i) => ({
      valor: i + 1,
      etiqueta: labels[i] ?? `Opción ${i + 1}`,
    }));
  }
  if (escala.length < 2) throw new Error("La escala necesita al menos 2 opciones.");

  // Niveles de baremo por variable.
  const nivelesPorDefecto = (countHint) => {
    const count = Math.max(countHint, 2);
    return DEFAULT_NIVEL_NAMES[count] ?? Array.from({ length: count }, (_, i) => `Nivel ${i + 1}`);
  };
  const nivelesV1 = (Array.isArray(raw.niveles) && raw.niveles.length >= 2 && raw.niveles.map(String))
    || (Array.isArray(raw.nombre_escala) && raw.nombre_escala.length >= 2 && raw.nombre_escala.map(String))
    || nivelesPorDefecto(toInt(raw.escala, 3));
  const nivelesV2 = (Array.isArray(raw.nombre_escala_v2) && raw.nombre_escala_v2.length >= 2 && raw.nombre_escala_v2.map(String))
    || nivelesV1;

  // Variables y su estructura.
  let variables;
  if (Array.isArray(raw.variables) && raw.variables.length > 0) {
    variables = raw.variables.map((v, vi) => ({
      nombre: String(v.nombre ?? "").trim() || `Variable ${vi + 1}`,
      niveles: (Array.isArray(v.niveles) && v.niveles.length >= 2 && v.niveles.map(String)) || (vi === 0 ? nivelesV1 : nivelesV2),
      baremoVariable: undefined,
      itemNames: Array.isArray(v.nombre_items) ? v.nombre_items.map(String) : [],
      dimensiones: (v.dimensiones ?? []).map((d, di) => ({
        nombre: String(d.nombre ?? "").trim() || `Dimensión ${di + 1}`,
        indicadores: (d.indicadores ?? []).map((ind) => ({
          nombre: String(ind.nombre ?? "").trim() || "Indicador",
          items: toInt(ind.items, 0),
        })),
      })),
    }));
  } else {
    const numVars = Math.max(1, Math.min(toInt(raw.variable, 2), 2));
    const varNames = Array.isArray(raw.nombre_dimension) ? raw.nombre_dimension.map(String) : [];
    const hasContent = (v) => Array.isArray(v) && v.length > 0;
    variables = [];
    for (let vi = 0; vi < numVars; vi += 1) {
      const fallbackItems = toInt(vi === 0 ? raw.item : raw.itemv2, 0);
      if (vi === 1 && fallbackItems <= 0 && !hasContent(raw.estructura_v2) && !hasContent(raw.nombre_dims_v2)) break;
      const niveles = vi === 0 ? nivelesV1 : nivelesV2;
      variables.push({
        nombre: varNames[vi]?.trim() || `Variable ${vi + 1}`,
        niveles,
        baremoVariable: parseBaremoOverride(raw, vi === 0 ? "" : "_v2", niveles),
        itemNames: Array.isArray(raw[`nombre_items_v${vi + 1}`]) ? raw[`nombre_items_v${vi + 1}`].map(String) : [],
        dimensiones: buildVariableFromFlat(raw, vi + 1, fallbackItems),
      });
    }
  }

  variables.forEach((variable, vi) => {
    const total = variable.dimensiones.reduce(
      (acc, d) => acc + d.indicadores.reduce((a, ind) => a + ind.items, 0),
      0,
    );
    if (total <= 0) {
      throw new Error(`Define el numero de items de la Variable ${vi + 1} antes de generar.`);
    }
    if (total > MAX_ITEMS_POR_VARIABLE) {
      throw new Error(
        `El sistema soporta como maximo ${MAX_ITEMS_POR_VARIABLE} items para la Variable ${vi + 1} (configuraste ${total}).`,
      );
    }
    variable.totalItems = total;
  });
  if (variables.length === 0) {
    throw new Error("Define el numero de items V1 antes de generar.");
  }

  // Aviso si el numero de items declarado no coincide con la estructura
  // jerarquica: la estructura manda, pero el usuario debe saberlo.
  const warnings = [];
  if (!Array.isArray(raw.variables)) {
    variables.forEach((variable, vi) => {
      const declared = toInt(vi === 0 ? raw.item : raw.itemv2, 0);
      if (declared > 0 && declared !== variable.totalItems) {
        warnings.push(
          `La Variable ${vi + 1} declara ${declared} items pero su estructura define ${variable.totalItems}; se uso la estructura.`,
        );
      }
    });
  }

  const relacion = String(raw.relacionversa ?? "0").trim().toLowerCase();
  const conDatosRaw = String(raw.conDatos ?? raw.con_datos ?? "1").trim().toLowerCase();
  const temaRaw = String(raw.tema ?? "clasico").trim().toLowerCase();
  if (temaRaw && !CHART_THEMES[temaRaw]) {
    warnings.push(`El tema de graficos "${temaRaw}" no existe; se uso el tema clasico.`);
  }

  // Control opcional de la correlacion simulada. Por compatibilidad el
  // default es activado con nivel "muy_alta" (el comportamiento historico).
  const controlRaw = String(raw.controlCorrelacion ?? "1").trim().toLowerCase();
  const nivelRaw = String(raw.nivelCorrelacion ?? "muy_alta").trim().toLowerCase();
  if (nivelRaw && !NIVELES_CORRELACION[nivelRaw]) {
    warnings.push(`El nivel de correlacion "${nivelRaw}" no existe; se uso "muy_alta".`);
  }
  // Metodo de correlacion: "auto" (default) deja que la prueba de normalidad
  // del Excel decida; "pearson" o "spearman" fuerzan el metodo en las hojas
  // (con Pearson ademas se generan datos compatibles con normalidad).
  const metodoRaw = String(raw.metodoCorrelacion ?? "auto").trim().toLowerCase();

  return {
    warnings,
    titulo: String(raw.titulo ?? "").trim(),
    investigador: String(raw.investigador ?? "").trim(),
    etiquetaMuestra: String(raw.nommuestra ?? raw.etiquetaMuestra ?? "").trim() || "Encuestados",
    encuestados,
    escala,
    variables,
    relacionInversa: new Set(["1", "si", "sí", "true", "inversa"]).has(relacion),
    conDatos: !new Set(["0", "false", "no", "off"]).has(conDatosRaw),
    tema: CHART_THEMES[temaRaw] ? temaRaw : "clasico",
    controlCorrelacion: !new Set(["0", "false", "no", "off"]).has(controlRaw),
    nivelCorrelacion: NIVELES_CORRELACION[nivelRaw] ? nivelRaw : "muy_alta",
    metodoCorrelacion: ["pearson", "spearman"].includes(metodoRaw) ? metodoRaw : "auto",
  };
};
