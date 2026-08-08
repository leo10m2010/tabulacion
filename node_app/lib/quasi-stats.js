// Pruebas estadísticas para diseños pretest-postest con grupo experimental y control.
// No depende de librerías externas y puede probarse de forma aislada con Node.js.

const EPS = 1e-12;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

export const mean = (values) => {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const sampleVariance = (values) => {
  if (!Array.isArray(values) || values.length < 2) return Number.NaN;
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
};

export const sampleSd = (values) => Math.sqrt(sampleVariance(values));

export const median = (values) => {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export const describe = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return { n: 0, mean: null, sd: null, median: null, min: null, max: null };
  }
  return {
    n: values.length,
    mean: mean(values),
    sd: values.length > 1 ? sampleSd(values) : 0,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
};

// Abramowitz y Stegun 26.2.17.
export const normCdf = (z) => {
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (
    0.31938153
    + t * (-0.356563782
    + t * (1.781477937
    + t * (-1.821255978
    + t * 1.330274429)))
  );
  return z >= 0 ? 1 - tail : tail;
};

// Lanczos: logaritmo de Gamma.
const logGamma = (z) => {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  let x = 0.99999999999980993;
  const shifted = z - 1;
  for (let i = 0; i < coefficients.length; i += 1) {
    x += coefficients[i] / (shifted + i + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
};

const betaContinuedFraction = (a, b, x) => {
  const maxIterations = 200;
  const fpMin = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;

    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) < 3e-14) break;
  }
  return h;
};

const regularizedIncompleteBeta = (x, a, b) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
};

export const studentTCdf = (t, df) => {
  if (!Number.isFinite(df) || df <= 0) return Number.NaN;
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const ib = regularizedIncompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
};

export const studentTQuantile = (probability, df) => {
  if (!(probability > 0 && probability < 1) || !Number.isFinite(df) || df <= 0) {
    return Number.NaN;
  }
  if (probability === 0.5) return 0;
  if (probability < 0.5) return -studentTQuantile(1 - probability, df);
  let low = 0;
  let high = 1;
  while (studentTCdf(high, df) < probability && high < 1e6) high *= 2;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2;
    if (studentTCdf(middle, df) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
};

const twoSidedTP = (t, df) => clamp01(2 * (1 - studentTCdf(Math.abs(t), df)));

const validateNumericArray = (values, label) => {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} debe contener datos.`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} contiene valores no numéricos.`);
  }
};

export const pairedTTest = (pre, post) => {
  validateNumericArray(pre, "Pretest");
  validateNumericArray(post, "Postest");
  if (pre.length !== post.length) throw new Error("Pretest y postest deben tener el mismo tamaño.");
  if (pre.length < 2) throw new Error("La t pareada requiere al menos 2 pares.");

  const differences = post.map((value, index) => value - pre[index]);
  const avg = mean(differences);
  const sd = sampleSd(differences);
  const df = differences.length - 1;

  if (!Number.isFinite(sd) || sd < EPS) {
    const equal = Math.abs(avg) < EPS;
    return {
      test: "t_pareada",
      statistic: equal ? 0 : Math.sign(avg) * Number.POSITIVE_INFINITY,
      df,
      p: equal ? 1 : 0,
      meanDifference: avg,
      standardError: 0,
      effectSize: equal ? 0 : Math.sign(avg) * Number.POSITIVE_INFINITY,
      n: differences.length,
    };
  }

  const statistic = avg / (sd / Math.sqrt(differences.length));
  return {
    test: "t_pareada",
    statistic,
    df,
    p: twoSidedTP(statistic, df),
    meanDifference: avg,
    standardError: sd / Math.sqrt(differences.length),
    effectSize: avg / sd,
    n: differences.length,
  };
};

export const welchTTest = (first, second) => {
  validateNumericArray(first, "Primer grupo");
  validateNumericArray(second, "Segundo grupo");
  if (first.length < 2 || second.length < 2) {
    throw new Error("La t independiente requiere al menos 2 casos por grupo.");
  }

  const mean1 = mean(first);
  const mean2 = mean(second);
  const var1 = sampleVariance(first);
  const var2 = sampleVariance(second);
  const a = var1 / first.length;
  const b = var2 / second.length;
  const standardError = Math.sqrt(a + b);

  if (!Number.isFinite(standardError) || standardError < EPS) {
    const difference = mean1 - mean2;
    const equal = Math.abs(difference) < EPS;
    return {
      test: "t_independiente_welch",
      statistic: equal ? 0 : Math.sign(difference) * Number.POSITIVE_INFINITY,
      df: first.length + second.length - 2,
      p: equal ? 1 : 0,
      meanDifference: difference,
      standardError: 0,
      effectSize: equal ? 0 : Math.sign(difference) * Number.POSITIVE_INFINITY,
      n1: first.length,
      n2: second.length,
    };
  }

  const statistic = (mean1 - mean2) / standardError;
  const df = ((a + b) ** 2) / (
    (a ** 2) / (first.length - 1)
    + (b ** 2) / (second.length - 1)
  );

  const pooledSd = Math.sqrt(
    ((first.length - 1) * var1 + (second.length - 1) * var2)
    / (first.length + second.length - 2),
  );

  return {
    test: "t_independiente_welch",
    statistic,
    df,
    p: twoSidedTP(statistic, df),
    meanDifference: mean1 - mean2,
    standardError,
    effectSize: pooledSd > EPS ? (mean1 - mean2) / pooledSd : 0,
    n1: first.length,
    n2: second.length,
  };
};

export const rankAverage = (values) => {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  const tieSizes = [];
  let i = 0;

  while (i < ordered.length) {
    let j = i;
    while (j + 1 < ordered.length && ordered[j + 1].value === ordered[i].value) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[ordered[k].index] = averageRank;
    if (j > i) tieSizes.push(j - i + 1);
    i = j + 1;
  }

  return { ranks, tieSizes };
};

const exactSignedRankP = (scaledRanks, observedScaledWPlus) => {
  const total = scaledRanks.reduce((sum, rank) => sum + rank, 0);
  let probabilities = new Float64Array(total + 1);
  probabilities[0] = 1;
  let reachable = 0;

  for (const rank of scaledRanks) {
    const next = new Float64Array(total + 1);
    for (let sum = 0; sum <= reachable; sum += 1) {
      const probability = probabilities[sum];
      if (probability === 0) continue;
      next[sum] += probability * 0.5;
      next[sum + rank] += probability * 0.5;
    }
    probabilities = next;
    reachable += rank;
  }

  const observed = Math.min(observedScaledWPlus, total - observedScaledWPlus);
  let lowerTail = 0;
  for (let sum = 0; sum <= observed; sum += 1) lowerTail += probabilities[sum];
  return clamp01(2 * lowerTail);
};

export const wilcoxonSignedRankTest = (pre, post) => {
  validateNumericArray(pre, "Pretest");
  validateNumericArray(post, "Postest");
  if (pre.length !== post.length) throw new Error("Pretest y postest deben tener el mismo tamaño.");

  const nonZero = post
    .map((value, index) => value - pre[index])
    .filter((difference) => Math.abs(difference) > EPS);

  if (nonZero.length === 0) {
    return {
      test: "wilcoxon",
      statistic: 0,
      wPlus: 0,
      wMinus: 0,
      z: 0,
      p: 1,
      exact: true,
      effectSize: 0,
      n: 0,
    };
  }

  const absolute = nonZero.map(Math.abs);
  const { ranks, tieSizes } = rankAverage(absolute);
  let wPlus = 0;
  let wMinus = 0;
  nonZero.forEach((difference, index) => {
    if (difference > 0) wPlus += ranks[index];
    else wMinus += ranks[index];
  });

  const statistic = Math.min(wPlus, wMinus);
  const n = nonZero.length;
  const hasTies = tieSizes.length > 0;
  // Criterio equivalente al modo automático moderno de SciPy:
  // - sin empates: distribución exacta hasta 50 diferencias no nulas;
  // - con empates: permutación exhaustiva hasta 13 diferencias;
  // - en muestras mayores: aproximación normal con corrección por empates.
  const useExact = (!hasTies && n <= 50) || (hasTies && n <= 13);

  if (useExact) {
    const scaledRanks = ranks.map((rank) => Math.round(rank * 2));
    const observedScaledWPlus = Math.round(wPlus * 2);
    return {
      test: "wilcoxon",
      statistic,
      wPlus,
      wMinus,
      z: null,
      p: exactSignedRankP(scaledRanks, observedScaledWPlus),
      exact: true,
      effectSize: (wPlus - wMinus) / (wPlus + wMinus),
      n,
    };
  }

  const expected = (n * (n + 1)) / 4;
  const tieCorrection = tieSizes.reduce((sum, size) => sum + (size ** 3 - size), 0) / 48;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection;
  const sd = Math.sqrt(Math.max(variance, EPS));
  // SciPy/SPSS reportan normalmente la aproximación sin corrección de continuidad.
  const z = Math.abs(wPlus - expected) / sd;

  return {
    test: "wilcoxon",
    statistic,
    wPlus,
    wMinus,
    z,
    p: clamp01(2 * (1 - normCdf(Math.abs(z)))),
    exact: false,
    effectSize: (wPlus - wMinus) / (wPlus + wMinus),
    n,
  };
};

const combinations = (n, k) => {
  const choose = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= choose; i += 1) result *= (n - choose + i) / i;
  return result;
};

const exactMannWhitneyP = (n1, n2, observedU) => {
  const totalN = n1 + n2;
  const minRankSum = (n1 * (n1 + 1)) / 2;
  const maxRankSum = (n1 * (2 * totalN - n1 + 1)) / 2;
  const dp = Array.from({ length: n1 + 1 }, () => new Float64Array(maxRankSum + 1));
  dp[0][0] = 1;

  for (let rank = 1; rank <= totalN; rank += 1) {
    const upperK = Math.min(rank, n1);
    for (let selected = upperK; selected >= 1; selected -= 1) {
      for (let sum = maxRankSum; sum >= rank; sum -= 1) {
        dp[selected][sum] += dp[selected - 1][sum - rank];
      }
    }
  }

  const totalCombinations = combinations(totalN, n1);
  let lowerTailCount = 0;
  for (let rankSum = minRankSum; rankSum <= maxRankSum; rankSum += 1) {
    const u = rankSum - minRankSum;
    if (u <= observedU + EPS) lowerTailCount += dp[n1][rankSum];
  }
  return clamp01((2 * lowerTailCount) / totalCombinations);
};

export const mannWhitneyUTest = (first, second) => {
  validateNumericArray(first, "Primer grupo");
  validateNumericArray(second, "Segundo grupo");

  const pooled = [...first, ...second];
  const { ranks, tieSizes } = rankAverage(pooled);
  const n1 = first.length;
  const n2 = second.length;
  const rankSum1 = ranks.slice(0, n1).reduce((sum, rank) => sum + rank, 0);
  const u1 = rankSum1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const statistic = Math.min(u1, u2);
  const hasTies = tieSizes.length > 0;
  const useExact = !hasTies && Math.min(n1, n2) <= 8;

  if (useExact) {
    return {
      test: "mann_whitney",
      statistic,
      u1,
      u2,
      z: null,
      p: exactMannWhitneyP(n1, n2, statistic),
      exact: true,
      effectSize: (2 * u1) / (n1 * n2) - 1,
      n1,
      n2,
    };
  }

  const totalN = n1 + n2;
  const expected = (n1 * n2) / 2;
  const tieTerm = tieSizes.reduce((sum, size) => sum + (size ** 3 - size), 0);
  const variance = (n1 * n2 / 12) * (
    totalN + 1 - tieTerm / (totalN * (totalN - 1))
  );
  const sd = Math.sqrt(Math.max(variance, EPS));
  const z = (statistic - expected + 0.5) / sd;

  return {
    test: "mann_whitney",
    statistic,
    u1,
    u2,
    z,
    p: clamp01(2 * normCdf(z)),
    exact: false,
    effectSize: (2 * u1) / (n1 * n2) - 1,
    n1,
    n2,
  };
};
