// Configuración, simulación y análisis para diseños cuasiexperimentales
// pretest-postest con grupo experimental y grupo control.
//
// El contrato de variable/dimensiones/indicadores/ítems/escala/baremos es el
// mismo del flujo correlacional (lib/config.js); aquí solo se agregan los
// campos propios del diseño (tamaños de grupo, efecto, dirección, alpha).

import { MAX_MUESTRA, toInt } from "./config.js";
import { lillieforsTest, randn, shapiroWilkTest } from "./stats.js";
import { computeNiveles } from "./sheet-style.js";
import {
  describe,
  mannWhitneyUTest,
  normCdf,
  pairedTTest,
  welchTTest,
  wilcoxonSignedRankTest,
} from "./quasi-stats.js";

export const EFECTOS_CUASIEXPERIMENTALES = {
  nulo: { etiqueta: "Sin efecto", shift: 0 },
  pequeno: { etiqueta: "Efecto pequeño", shift: 0.35 },
  moderado: { etiqueta: "Efecto moderado", shift: 0.75 },
  grande: { etiqueta: "Efecto grande", shift: 1.15 },
};

const QUASI_ALIASES = new Set([
  "cuasiexperimental",
  "cuasi-experimental",
  "cuasi experimental",
  "experimental_control",
  "pretest_postest_control",
]);

const asObject = (value) => (
  value && typeof value === "object" && !Array.isArray(value) ? value : {}
);

const rawQuasi = (raw) => ({
  ...asObject(raw),
  ...asObject(raw?.cuasiexperimental),
  ...asObject(raw?.quasiExperimental),
});

const readGroupSize = (source, type) => {
  const keys = type === "experimental"
    ? ["nExperimental", "muestraExperimental", "grupoExperimental", "experimental"]
    : ["nControl", "muestraControl", "grupoControl", "control"];
  for (const key of keys) {
    const value = toInt(source[key], 0);
    if (value > 0) return value;
  }
  return 0;
};

// La modalidad se activa solo con el campo explícito de diseño: los tamaños
// de grupo por sí solos no bastan (evita activar el flujo por accidente).
export const isQuasiExperimentalConfig = (raw) => {
  const source = rawQuasi(raw);
  const design = String(
    source.diseno
    ?? source.tipoDiseno
    ?? source.tipoEstudio
    ?? source.design
    ?? "",
  ).trim().toLowerCase();
  return QUASI_ALIASES.has(design);
};

// normalizeConfig exige una muestra general. Esta función adapta el JSON
// cuasiexperimental al formato existente sin modificar config.js.
export const prepareQuasiExperimentalRawConfig = (raw) => {
  const source = rawQuasi(raw);
  const nExperimental = readGroupSize(source, "experimental");
  const nControl = readGroupSize(source, "control");
  const total = nExperimental + nControl;

  if (nExperimental < 2 || nControl < 2) {
    throw new Error("El diseño cuasiexperimental requiere al menos 2 participantes en cada grupo.");
  }
  if (total > MAX_MUESTRA) {
    throw new Error(`La muestra total máxima es ${MAX_MUESTRA} (configuraste ${total}).`);
  }

  return {
    ...raw,
    muestra: total,
    encuestados: total,
    // El análisis cuasiexperimental usa una variable dependiente medida dos veces.
    variable: "1",
  };
};

const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  return !new Set(["0", "false", "no", "off"]).has(String(value).trim().toLowerCase());
};

const parseEffect = (source) => {
  const rawEffect = source.efectoIntervencion ?? source.efecto ?? source.effect ?? "moderado";
  const text = String(rawEffect).trim();
  const numeric = Number(text);
  if (text !== "" && Number.isFinite(numeric) && numeric >= 0 && numeric <= 3) {
    return { nivel: "personalizado", etiqueta: "Efecto personalizado", shift: numeric };
  }
  const key = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const aliases = { bajo: "pequeno", pequena: "pequeno", alto: "grande", medio: "moderado" };
  const normalized = aliases[key] ?? key;
  return {
    nivel: EFECTOS_CUASIEXPERIMENTALES[normalized] ? normalized : "moderado",
    ...(EFECTOS_CUASIEXPERIMENTALES[normalized] ?? EFECTOS_CUASIEXPERIMENTALES.moderado),
  };
};

export const normalizeQuasiExperimentalConfig = (raw, baseCfg) => {
  const source = rawQuasi(raw);
  const nExperimental = readGroupSize(source, "experimental");
  const nControl = readGroupSize(source, "control");
  const effect = parseEffect(source);
  const directionRaw = String(
    source.direccionEfecto ?? source.direccion ?? source.effectDirection ?? "mejora",
  ).trim().toLowerCase();
  const direction = new Set(["disminuye", "disminucion", "disminución", "reduce", "negativa", "-1"]).has(directionRaw)
    ? -1
    : 1;
  const alphaRaw = Number(source.alpha ?? source.nivelSignificancia ?? 0.05);
  const alpha = Number.isFinite(alphaRaw) && alphaRaw > 0 && alphaRaw < 1 ? alphaRaw : 0.05;
  const controlDriftRaw = Number(source.cambioControl ?? source.controlDrift ?? 0.04);
  const controlDrift = Number.isFinite(controlDriftRaw)
    ? Math.min(0.5, Math.max(-0.5, controlDriftRaw))
    : 0.04;

  // Mediciones: 2 (pretest y postest) o 3 (agrega un seguimiento posterior
  // que evalúa la persistencia del efecto de la intervención).
  const medicionesRaw = toInt(source.mediciones ?? source.numeroMediciones ?? 2, 2);
  let mediciones = medicionesRaw;
  if (medicionesRaw !== 2 && medicionesRaw !== 3) {
    baseCfg.warnings.push(`El diseño soporta 2 o 3 mediciones (configuraste ${medicionesRaw}); se usaron 2.`);
    mediciones = 2;
  }

  if (baseCfg.variables.length > 1) {
    baseCfg.warnings.push(
      "El diseño cuasiexperimental utiliza la primera variable como variable dependiente; las variables adicionales fueron ignoradas.",
    );
  }

  return {
    ...baseCfg,
    diseno: "cuasiexperimental",
    encuestados: nExperimental + nControl,
    variables: [baseCfg.variables[0]],
    cuasiexperimental: {
      nExperimental,
      nControl,
      mediciones,
      alpha,
      efectoNivel: effect.nivel,
      efectoEtiqueta: effect.etiqueta,
      efectoShift: effect.shift,
      direccion: direction,
      direccionEtiqueta: direction > 0 ? "incremento/mejora" : "disminución",
      cambioControl: controlDrift,
      controlarResultados: parseBoolean(source.controlarResultados, true),
    },
  };
};

// ── Baremos ──────────────────────────────────────────────────────────────────
const scaleInfo = (cfg) => {
  const values = [...new Set(cfg.escala.map((option) => option.valor))].sort((a, b) => a - b);
  return { values, min: values[0], max: values[values.length - 1] };
};

// Baremo de la variable completa (respeta el override desde/hasta del usuario).
export const computeVariableLevels = (cfg) => {
  const variable = cfg.variables[0];
  if (Array.isArray(variable.baremoVariable) && variable.baremoVariable.length > 0) {
    return variable.baremoVariable;
  }
  const { min, max } = scaleInfo(cfg);
  return computeNiveles(variable.totalItems, min, max, variable.niveles);
};

// Distribución de las dimensiones sobre los ítems (posiciones 1-based) y el
// baremo propio de cada dimensión, con los mismos nombres de nivel.
export const computeDimensionLayout = (cfg) => {
  const variable = cfg.variables[0];
  const { min, max } = scaleInfo(cfg);
  let item = 1;
  return variable.dimensiones.map((dimension) => {
    const count = dimension.indicadores.reduce((sum, indicator) => sum + indicator.items, 0);
    const layout = {
      nombre: dimension.nombre,
      from: item,
      to: item + count - 1,
      items: count,
      niveles: computeNiveles(count, min, max, variable.niveles),
    };
    item += count;
    return layout;
  });
};

export const classifyScore = (score, levels) => (
  levels.find((level) => score >= level.min && score <= level.max)?.nombre
  ?? levels[levels.length - 1]?.nombre
  ?? ""
);

// ── Simulación ───────────────────────────────────────────────────────────────
const discretize = (latent, values) => {
  const percentile = Math.min(0.999999, Math.max(0.000001, normCdf(latent)));
  const index = Math.min(values.length - 1, Math.floor(percentile * values.length));
  return values[index];
};

const buildItemParameters = (count) => Array.from({ length: count }, () => ({
  loading: 0.8 + Math.random() * 0.35,
  bias: (Math.random() - 0.5) * 0.75,
  noise: 0.65 + Math.random() * 0.35,
}));

const generateGroup = ({
  n,
  group,
  itemParameters,
  scaleValues,
  effectShift,
  direction,
  controlDrift,
  mediciones,
}) => {
  const isExperimental = group === "Experimental";
  return Array.from({ length: n }, (_, index) => {
    const baseline = randn();
    const naturalChange = randn() * 0.22;
    const shift = direction * (isExperimental ? effectShift : controlDrift);
    const postLatent = baseline + shift + naturalChange;

    const pre = itemParameters.map(({ loading, bias, noise }) => (
      discretize(loading * baseline + bias + randn() * noise, scaleValues)
    ));
    const post = itemParameters.map(({ loading, bias, noise }) => (
      discretize(loading * postLatent + bias + randn() * noise * 0.8, scaleValues)
    ));

    const preTotal = pre.reduce((sum, value) => sum + value, 0);
    const postTotal = post.reduce((sum, value) => sum + value, 0);
    const row = {
      id: `${isExperimental ? "GE" : "GC"}-${String(index + 1).padStart(3, "0")}`,
      group,
      pre,
      post,
      preTotal,
      postTotal,
      change: postTotal - preTotal,
    };

    if (mediciones >= 3) {
      // Seguimiento: el efecto de la intervención persiste con un ligero
      // decaimiento (0.85) y variación individual propia; el control conserva
      // solo su deriva natural acumulada.
      const segShift = direction * (isExperimental ? effectShift * 0.85 : controlDrift * 1.5);
      const segLatent = baseline + segShift + randn() * 0.26;
      row.seg = itemParameters.map(({ loading, bias, noise }) => (
        discretize(loading * segLatent + bias + randn() * noise * 0.8, scaleValues)
      ));
      row.segTotal = row.seg.reduce((sum, value) => sum + value, 0);
      row.changeSeg = row.segTotal - postTotal;
    }
    return row;
  });
};

// ── Normalidad y comparaciones ───────────────────────────────────────────────
export const normalityFor = (values, alpha = 0.05) => {
  if (!Array.isArray(values) || values.length < 3) {
    return {
      method: "No aplicable",
      statistic: null,
      p: null,
      normal: false,
      alpha,
      reason: "Se requieren al menos 3 observaciones.",
    };
  }
  const allEqual = values.every((value) => value === values[0]);
  if (allEqual) {
    return {
      method: values.length <= 50 ? "Shapiro-Wilk" : "Kolmogorov-Smirnov (Lilliefors)",
      statistic: null,
      p: 1,
      normal: true,
      alpha,
      reason: "Todos los valores son iguales; no hay variabilidad.",
    };
  }
  const useShapiro = values.length <= 50;
  const result = useShapiro ? shapiroWilkTest(values) : lillieforsTest(values);
  if (!result) {
    return {
      method: useShapiro ? "Shapiro-Wilk" : "Kolmogorov-Smirnov (Lilliefors)",
      statistic: null,
      p: null,
      normal: false,
      alpha,
      reason: "No fue posible calcular la prueba.",
    };
  }
  return {
    method: useShapiro ? "Shapiro-Wilk" : "Kolmogorov-Smirnov (Lilliefors)",
    statistic: result.stat,
    p: result.p,
    normal: result.p >= alpha,
    alpha,
    reason: result.p >= alpha ? "Distribución compatible con normalidad." : "Distribución no normal.",
  };
};

const testLabel = (test) => ({
  t_pareada: "t de Student para muestras relacionadas",
  t_independiente_welch: "t de Student para muestras independientes (Welch)",
  wilcoxon: "Rangos con signo de Wilcoxon",
  mann_whitney: "U de Mann-Whitney",
}[test] ?? test);

const decisionText = (p, alpha) => (
  p < alpha ? "Se rechaza H₀" : "No se rechaza H₀"
);

// Magnitud cualitativa del tamaño del efecto (Cohen 1988 para d/dz; umbrales
// habituales para la correlación biserial por rangos).
export const effectMagnitude = (comparison) => {
  const value = Math.abs(comparison.effectSize ?? 0);
  if (!Number.isFinite(value)) return "muy grande";
  const cuts = comparison.test === "wilcoxon" || comparison.test === "mann_whitney"
    ? [0.1, 0.3, 0.5]
    : [0.2, 0.5, 0.8];
  if (value < cuts[0]) return "trivial";
  if (value < cuts[1]) return "pequeño";
  if (value < cuts[2]) return "mediano";
  return "grande";
};

const pairedComparison = ({ name, hypotheses, pre, post, alpha, normalityTarget }) => {
  const differences = post.map((value, index) => value - pre[index]);
  // En comparaciones relacionadas la normalidad se evalúa sobre las
  // DIFERENCIAS postest-pretest, no sobre cada medición por separado.
  const normality = { target: normalityTarget, ...normalityFor(differences, alpha) };
  const result = normality.normal ? pairedTTest(pre, post) : wilcoxonSignedRankTest(pre, post);
  const magnitude = effectMagnitude(result);
  return {
    name,
    type: "paired",
    hypotheses,
    normality: [normality],
    selectedByNormality: normality.normal ? "parametric" : "nonparametric",
    ...result,
    alpha,
    testLabel: testLabel(result.test),
    decision: decisionText(result.p, alpha),
    significant: result.p < alpha,
    effectMagnitude: magnitude,
    interpretation: result.p < alpha
      ? `Existe una diferencia estadísticamente significativa entre el pretest y el postest (${testLabel(result.test)}, p = ${result.p.toFixed(3)} < α = ${alpha}), con un tamaño del efecto ${magnitude}.`
      : `No se encontró una diferencia estadísticamente significativa entre el pretest y el postest (${testLabel(result.test)}, p = ${result.p.toFixed(3)} ≥ α = ${alpha}).`,
  };
};

const independentComparison = ({ name, hypotheses, first, second, alpha, labels }) => {
  const normalityFirst = { target: labels[0], ...normalityFor(first, alpha) };
  const normalitySecond = { target: labels[1], ...normalityFor(second, alpha) };
  const parametric = normalityFirst.normal && normalitySecond.normal;
  const result = parametric ? welchTTest(first, second) : mannWhitneyUTest(first, second);
  const magnitude = effectMagnitude(result);
  return {
    name,
    type: "independent",
    hypotheses,
    normality: [normalityFirst, normalitySecond],
    selectedByNormality: parametric ? "parametric" : "nonparametric",
    ...result,
    alpha,
    testLabel: testLabel(result.test),
    decision: decisionText(result.p, alpha),
    significant: result.p < alpha,
    effectMagnitude: magnitude,
    interpretation: result.p < alpha
      ? `Existe una diferencia estadísticamente significativa entre los grupos (${testLabel(result.test)}, p = ${result.p.toFixed(3)} < α = ${alpha}), con un tamaño del efecto ${magnitude}.`
      : `No se encontró una diferencia estadísticamente significativa entre los grupos (${testLabel(result.test)}, p = ${result.p.toFixed(3)} ≥ α = ${alpha}).`,
  };
};

export const analyzeQuasiExperimentalData = (experimental, control, cfg) => {
  const alpha = cfg.cuasiexperimental.alpha;
  const hasSeg = cfg.cuasiexperimental.mediciones >= 3;
  const variableName = cfg.variables[0].nombre;
  const expPre = experimental.map((row) => row.preTotal);
  const expPost = experimental.map((row) => row.postTotal);
  const ctrlPre = control.map((row) => row.preTotal);
  const ctrlPost = control.map((row) => row.postTotal);
  const expSeg = hasSeg ? experimental.map((row) => row.segTotal) : null;
  const ctrlSeg = hasSeg ? control.map((row) => row.segTotal) : null;

  return {
    alpha,
    variable: variableName,
    mediciones: cfg.cuasiexperimental.mediciones,
    descriptive: {
      experimentalPre: describe(expPre),
      experimentalPost: describe(expPost),
      controlPre: describe(ctrlPre),
      controlPost: describe(ctrlPost),
      ...(hasSeg ? {
        experimentalSeg: describe(expSeg),
        controlSeg: describe(ctrlSeg),
      } : {}),
      experimentalChange: describe(experimental.map((row) => row.change)),
      controlChange: describe(control.map((row) => row.change)),
    },
    baseline: independentComparison({
      name: "Equivalencia inicial: Experimental vs. Control (pretest)",
      hypotheses: {
        nula: `H₀: No existen diferencias significativas en ${variableName} entre el grupo experimental y el grupo control en el pretest (los grupos son equivalentes al inicio).`,
        alterna: `H₁: Existen diferencias significativas en ${variableName} entre el grupo experimental y el grupo control en el pretest.`,
      },
      first: expPre,
      second: ctrlPre,
      alpha,
      labels: ["Pretest - Experimental", "Pretest - Control"],
    }),
    comparisons: [
      pairedComparison({
        name: "Grupo experimental: pretest vs. postest",
        hypotheses: {
          nula: `H₀: No existen diferencias significativas en ${variableName} entre el pretest y el postest del grupo experimental.`,
          alterna: `H₁: Existen diferencias significativas en ${variableName} entre el pretest y el postest del grupo experimental.`,
        },
        pre: expPre,
        post: expPost,
        alpha,
        normalityTarget: "Diferencias post-pre (Experimental)",
      }),
      pairedComparison({
        name: "Grupo control: pretest vs. postest",
        hypotheses: {
          nula: `H₀: No existen diferencias significativas en ${variableName} entre el pretest y el postest del grupo control.`,
          alterna: `H₁: Existen diferencias significativas en ${variableName} entre el pretest y el postest del grupo control.`,
        },
        pre: ctrlPre,
        post: ctrlPost,
        alpha,
        normalityTarget: "Diferencias post-pre (Control)",
      }),
      independentComparison({
        name: "Postest: Experimental vs. Control",
        hypotheses: {
          nula: `H₀: No existen diferencias significativas en ${variableName} entre el grupo experimental y el grupo control en el postest.`,
          alterna: `H₁: Existen diferencias significativas en ${variableName} entre el grupo experimental y el grupo control en el postest (efecto de la intervención).`,
        },
        first: expPost,
        second: ctrlPost,
        alpha,
        labels: ["Postest - Experimental", "Postest - Control"],
      }),
      ...(hasSeg ? [
        pairedComparison({
          name: "Grupo experimental: postest vs. seguimiento",
          hypotheses: {
            nula: `H₀: No existen diferencias significativas en ${variableName} entre el postest y el seguimiento del grupo experimental (el efecto de la intervención se mantiene).`,
            alterna: `H₁: Existen diferencias significativas en ${variableName} entre el postest y el seguimiento del grupo experimental.`,
          },
          pre: expPost,
          post: expSeg,
          alpha,
          normalityTarget: "Diferencias seg-post (Experimental)",
        }),
        pairedComparison({
          name: "Grupo control: postest vs. seguimiento",
          hypotheses: {
            nula: `H₀: No existen diferencias significativas en ${variableName} entre el postest y el seguimiento del grupo control.`,
            alterna: `H₁: Existen diferencias significativas en ${variableName} entre el postest y el seguimiento del grupo control.`,
          },
          pre: ctrlPost,
          post: ctrlSeg,
          alpha,
          normalityTarget: "Diferencias seg-post (Control)",
        }),
        independentComparison({
          name: "Seguimiento: Experimental vs. Control",
          hypotheses: {
            nula: `H₀: No existen diferencias significativas en ${variableName} entre el grupo experimental y el grupo control en el seguimiento.`,
            alterna: `H₁: Existen diferencias significativas en ${variableName} entre el grupo experimental y el grupo control en el seguimiento (el efecto persiste en el tiempo).`,
          },
          first: expSeg,
          second: ctrlSeg,
          alpha,
          labels: ["Seguimiento - Experimental", "Seguimiento - Control"],
        }),
      ] : []),
    ],
  };
};

// Puntaje de "distancia al patrón esperado" para controlarResultados: 0 es un
// intento perfectamente coherente (equivalencia inicial, control estable y,
// si hay efecto, cambios significativos en el GE y en el postest entre grupos).
const resultScore = (analysis, cfg) => {
  const [experimental, control, postBetween, expSeg, ctrlSeg, segBetween] = analysis.comparisons;
  const baseline = analysis.baseline;
  const { alpha, efectoShift, direccion } = cfg.cuasiexperimental;
  let score = 0;

  // Se busca equivalencia inicial y ausencia de cambio espurio en el control.
  if (baseline.p < alpha) score += 3 + (alpha - baseline.p) * 10;
  if (control.p < alpha) score += 2 + (alpha - control.p) * 10;

  if (efectoShift >= 0.2) {
    if (experimental.p >= alpha) score += 4 + (experimental.p - alpha) * 5;
    if (postBetween.p >= alpha) score += 4 + (postBetween.p - alpha) * 5;
    const expChange = analysis.descriptive.experimentalChange.mean ?? 0;
    const postDifference = (
      (analysis.descriptive.experimentalPost.mean ?? 0)
      - (analysis.descriptive.controlPost.mean ?? 0)
    );
    if (Math.sign(expChange || direccion) !== direccion) score += 3;
    if (Math.sign(postDifference || direccion) !== direccion) score += 3;
  }

  // Con seguimiento el patrón coherente es: el efecto persiste (GE post vs.
  // seg sin cambio significativo, GE vs. GC significativo en el seguimiento)
  // y el control sigue estable.
  if (segBetween) {
    if (ctrlSeg.p < alpha) score += 2 + (alpha - ctrlSeg.p) * 10;
    if (efectoShift >= 0.2) {
      if (expSeg.p < alpha) score += 2 + (alpha - expSeg.p) * 5;
      if (segBetween.p >= alpha) score += 4 + (segBetween.p - alpha) * 5;
    }
  }

  return score;
};

export const generateQuasiExperimentalData = (cfg) => {
  const variable = cfg.variables[0];
  const itemCount = variable.totalItems;
  const { values: scaleValues } = scaleInfo(cfg);
  const q = cfg.cuasiexperimental;
  const attempts = q.controlarResultados ? 80 : 1;
  let best = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const itemParameters = buildItemParameters(itemCount);
    const experimental = generateGroup({
      n: q.nExperimental,
      group: "Experimental",
      itemParameters,
      scaleValues,
      effectShift: q.efectoShift,
      direction: q.direccion,
      controlDrift: q.cambioControl,
      mediciones: q.mediciones,
    });
    const control = generateGroup({
      n: q.nControl,
      group: "Control",
      itemParameters,
      scaleValues,
      effectShift: q.efectoShift,
      direction: q.direccion,
      controlDrift: q.cambioControl,
      mediciones: q.mediciones,
    });
    const analysis = analyzeQuasiExperimentalData(experimental, control, cfg);
    const score = resultScore(analysis, cfg);
    if (!best || score < best.score) best = { experimental, control, analysis, score };
    if (score === 0) break;
  }

  const warnings = [];
  if (q.controlarResultados && best.score > 0) {
    warnings.push(
      "La simulación conservó el intento estadísticamente más cercano al patrón solicitado; revisa los p-valores antes de usarlo.",
    );
  }

  return { ...best, warnings };
};

// ── CSV ──────────────────────────────────────────────────────────────────────
const csvEscape = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const sumSlice = (values, from, to) => {
  let sum = 0;
  for (let i = from - 1; i < to; i += 1) sum += values[i];
  return sum;
};

export const buildQuasiExperimentalCsv = (data, cfg) => {
  const itemCount = cfg.variables[0].totalItems;
  const levels = computeVariableLevels(cfg);
  const dimensions = computeDimensionLayout(cfg);
  const hasSeg = cfg.cuasiexperimental.mediciones >= 3;
  const measurementCols = (prefix) => [
    ...Array.from({ length: itemCount }, (_, index) => `${prefix}_P${index + 1}`),
    ...dimensions.flatMap((_, di) => [`${prefix}_D${di + 1}`, `${prefix}_D${di + 1}_Nivel`]),
    `${prefix}_Total`,
    `${prefix}_Nivel`,
  ];
  const headers = [
    "ID",
    "Grupo",
    ...measurementCols("PRE"),
    ...measurementCols("POST"),
    ...(hasSeg ? measurementCols("SEG") : []),
    "Cambio",
    ...(hasSeg ? ["Cambio_Seguimiento"] : []),
  ];

  const measurementValues = (scores) => {
    const total = scores.reduce((sum, value) => sum + value, 0);
    return [
      ...scores,
      ...dimensions.flatMap((dim) => {
        const dimScore = sumSlice(scores, dim.from, dim.to);
        return [dimScore, classifyScore(dimScore, dim.niveles)];
      }),
      total,
      classifyScore(total, levels),
    ];
  };

  const rows = data ? [...data.experimental, ...data.control] : [];
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => ([
      row.id,
      row.group,
      ...measurementValues(row.pre),
      ...measurementValues(row.post),
      ...(hasSeg ? measurementValues(row.seg) : []),
      row.change,
      ...(hasSeg ? [row.changeSeg] : []),
    ].map(csvEscape).join(","))),
  ].join("\n");
};
