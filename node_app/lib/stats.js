// Estadistica del generador: simulacion de la base de datos, correlacion de
// Pearson y pruebas de normalidad (Lilliefors y Shapiro-Wilk).

// ── Simulacion de base de datos ──────────────────────────────────────────────
const randn = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

const pearson = (x, y) => {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return Number.NaN;
  return num / den;
};

export const sumPerRow = (base, varNum, count, rows) => Array.from({ length: rows }, (_, i) => {
  let sum = 0;
  for (let c = 1; c <= count; c += 1) sum += base[`V${varNum}_${c}`][i];
  return sum;
});

export const sumRangePerRow = (base, varNum, from, to, rows) => Array.from({ length: rows }, (_, i) => {
  let sum = 0;
  for (let c = from; c <= to; c += 1) sum += base[`V${varNum}_${c}`][i];
  return sum;
});

// ── Pruebas de normalidad ────────────────────────────────────────────────────
const normCdf = (z) => {
  // Abramowitz & Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
};

const normInv = (p) => {
  // Algoritmo de Acklam para la inversa de la normal estandar.
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p <= 0 || p >= 1) return Number.NaN;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q)
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
    / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
};

// Kolmogorov-Smirnov con correccion de Lilliefors (p-valor de Dallal-Wilkinson
// 1986 y polinomios de Stephens, igual que nortest::lillie.test de R).
export const lillieforsTest = (values) => {
  const n = values.length;
  if (n < 4) return null;
  const x = [...values].sort((p, q) => p - q);
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  if (sd === 0) return null;
  let dPlus = 0;
  let dMinus = 0;
  for (let i = 0; i < n; i += 1) {
    const F = normCdf((x[i] - mean) / sd);
    dPlus = Math.max(dPlus, (i + 1) / n - F);
    dMinus = Math.max(dMinus, F - i / n);
  }
  const D = Math.max(dPlus, dMinus);
  let p = Math.exp(
    -7.01256 * D * D * (n + 2.78019) + 2.99587 * D * Math.sqrt(n + 2.78019)
    - 0.122119 + 0.974598 / Math.sqrt(n) + 1.67997 / n,
  );
  if (p > 0.1) {
    const kk = (Math.sqrt(n) - 0.01 + 0.85 / Math.sqrt(n)) * D;
    if (kk <= 0.302) p = 1;
    else if (kk <= 0.5) p = 2.76773 - 19.828315 * kk + 80.709644 * kk ** 2 - 138.55152 * kk ** 3 + 81.218052 * kk ** 4;
    else if (kk <= 0.9) p = -4.901232 + 40.662806 * kk - 97.490286 * kk ** 2 + 94.029866 * kk ** 3 - 32.355711 * kk ** 4;
    else if (kk <= 1.31) p = 6.198765 - 19.558097 * kk + 23.186922 * kk ** 2 - 12.234627 * kk ** 3 + 2.423045 * kk ** 4;
    else p = 0;
  }
  return { stat: D, p: Math.min(Math.max(p, 0), 1) };
};

// Shapiro-Wilk segun Royston (1995, algoritmo AS R94).
export const shapiroWilkTest = (values) => {
  const n = values.length;
  if (n < 3 || n > 5000) return null;
  const x = [...values].sort((p, q) => p - q);
  if (x[0] === x[n - 1]) return null;
  const m = x.map((_, i) => normInv((i + 1 - 0.375) / (n + 0.25)));
  const ssm = m.reduce((s, v) => s + v * v, 0);
  const rsn = 1 / Math.sqrt(n);
  const a = new Array(n).fill(0);
  if (n === 3) {
    a[0] = -Math.SQRT1_2;
    a[2] = Math.SQRT1_2;
  } else if (n <= 5) {
    const an = -2.706056 * rsn ** 5 + 4.434685 * rsn ** 4 - 2.07119 * rsn ** 3
      - 0.147981 * rsn ** 2 + 0.221157 * rsn + m[n - 1] / Math.sqrt(ssm);
    const phi = (ssm - 2 * m[n - 1] ** 2) / (1 - 2 * an ** 2);
    a[n - 1] = an;
    a[0] = -an;
    for (let i = 1; i < n - 1; i += 1) a[i] = m[i] / Math.sqrt(phi);
  } else {
    const an = -2.706056 * rsn ** 5 + 4.434685 * rsn ** 4 - 2.07119 * rsn ** 3
      - 0.147981 * rsn ** 2 + 0.221157 * rsn + m[n - 1] / Math.sqrt(ssm);
    const an1 = -3.582633 * rsn ** 5 + 5.682633 * rsn ** 4 - 1.752461 * rsn ** 3
      - 0.293762 * rsn ** 2 + 0.042981 * rsn + m[n - 2] / Math.sqrt(ssm);
    const phi = (ssm - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * an ** 2 - 2 * an1 ** 2);
    a[n - 1] = an;
    a[0] = -an;
    a[n - 2] = an1;
    a[1] = -an1;
    for (let i = 2; i < n - 2; i += 1) a[i] = m[i] / Math.sqrt(phi);
  }
  const mean = x.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += a[i] * x[i];
    den += (x[i] - mean) ** 2;
  }
  if (den === 0) return null;
  const W = Math.min((num * num) / den, 1);
  let p;
  if (W >= 1) {
    p = 1;
  } else if (n === 3) {
    p = (6 / Math.PI) * (Math.asin(Math.sqrt(W)) - Math.asin(Math.sqrt(0.75)));
  } else if (n <= 11) {
    const g = -2.273 + 0.459 * n;
    const mu = 0.544 - 0.39978 * n + 0.025054 * n ** 2 - 0.0006714 * n ** 3;
    const sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n ** 2 - 0.0020322 * n ** 3);
    const z = (-Math.log(g - Math.log(1 - W)) - mu) / sigma;
    p = 1 - normCdf(z);
  } else {
    const ln = Math.log(n);
    const mu = 0.0038915 * ln ** 3 - 0.083751 * ln ** 2 - 0.31082 * ln - 1.5861;
    const sigma = Math.exp(0.0030302 * ln ** 2 - 0.082676 * ln - 0.4803);
    const z = (Math.log(1 - W) - mu) / sigma;
    p = 1 - normCdf(z);
  }
  return { stat: W, p: Math.min(Math.max(p, 0), 1) };
};

// ── Correlacion y base simulada ──────────────────────────────────────────────
export const computeCorrelation = (base, cfg) => {
  const rows = cfg.encuestados;
  if (cfg.variables.length < 2) return null;
  const v1 = sumPerRow(base, 1, cfg.variables[0].totalItems, rows);
  const v2 = sumPerRow(base, 2, cfg.variables[1].totalItems, rows);
  const r = pearson(v1, v2);
  if (!Number.isFinite(r)) {
    throw new Error("No se pudo calcular una correlacion valida con la base generada.");
  }
  return r;
};

export const generateBaseData = (cfg) => {
  const rows = cfg.encuestados;
  const v1Count = cfg.variables[0].totalItems;
  const v2Count = cfg.variables[1]?.totalItems ?? 0;
  const minResponse = Math.min(...cfg.escala.map((o) => o.valor));
  const maxResponse = Math.max(...cfg.escala.map((o) => o.valor));
  const sign = cfg.relacionInversa ? -1 : 1;

  const targetCorr = 0.95;
  let noiseStd = Math.sqrt(1 / (targetCorr ** 2) - 1);

  const scaleToRange = (values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const mid = Math.floor((minResponse + maxResponse) / 2);
      return values.map(() => mid);
    }
    return values.map((v) => {
      const norm = (v - min) / (max - min);
      const mapped = minResponse + norm * (maxResponse - minResponse);
      const val = Math.round(mapped);
      return Math.max(minResponse, Math.min(maxResponse, val));
    });
  };

  const buildOnce = (std) => {
    const z = Array.from({ length: rows }, () => randn());
    const cols = {};
    for (let i = 1; i <= v1Count; i += 1) {
      cols[`V1_${i}`] = z.map((v) => v + randn() * std);
    }
    for (let i = 1; i <= v2Count; i += 1) {
      cols[`V2_${i}`] = z.map((v) => sign * v + randn() * std);
    }
    const data = {};
    Object.entries(cols).forEach(([k, values]) => {
      data[k] = scaleToRange(values);
    });
    return data;
  };

  if (v2Count === 0) return buildOnce(noiseStd);

  let best = null;
  let bestCorr = 0;
  for (let i = 0; i < 6; i += 1) {
    const data = buildOnce(noiseStd);
    const r = computeCorrelation(data, cfg);
    if (Math.abs(r) > Math.abs(bestCorr)) {
      bestCorr = r;
      best = data;
    }
    if (Math.abs(r) >= 0.9) return data;
    noiseStd = Math.max(0.05, noiseStd * 0.7);
  }
  return best ?? buildOnce(0.05);
};

export const buildBaseCsv = (base, cfg) => {
  const headers = [];
  cfg.variables.forEach((variable, vi) => {
    for (let i = 1; i <= variable.totalItems; i += 1) headers.push(`V${vi + 1}_${i}`);
  });
  const lines = [headers.join(",")];
  if (base) {
    for (let r = 0; r < cfg.encuestados; r += 1) {
      lines.push(headers.map((h) => base[h][r]).join(","));
    }
  }
  return lines.join("\n");
};
