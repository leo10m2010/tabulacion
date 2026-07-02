// Estadistica del generador: simulacion de la base de datos, correlaciones
// (Pearson y Spearman) y pruebas de normalidad (Lilliefors y Shapiro-Wilk).
import { NIVELES_CORRELACION } from "./config.js";

// ── Simulacion de base de datos ──────────────────────────────────────────────
export const randn = () => {
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

// Rangos promedio para empates (Rho de Spearman = Pearson sobre rangos).
const rankAvg = (values) => {
  const n = values.length;
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1][0] === order[i][0]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
};

export const spearmanCorrelation = (base, cfg) => {
  const rows = cfg.encuestados;
  if (cfg.variables.length < 2) return null;
  const v1 = sumPerRow(base, 1, cfg.variables[0].totalItems, rows);
  const v2 = sumPerRow(base, 2, cfg.variables[1].totalItems, rows);
  const r = pearson(rankAvg(v1), rankAvg(v2));
  if (!Number.isFinite(r)) {
    throw new Error("No se pudo calcular una correlacion valida con la base generada.");
  }
  return r;
};

// Perfiles de distribucion por item: cada item recibe al azar una forma de
// respuesta distinta (campana, polarizada, sesgada o dispersa) mediante un
// "warp" monotono sobre el percentil 0-1. Al ser transformaciones monotonas
// del mismo factor latente, la correlacion entre variables se conserva; lo
// que cambia es la forma de cada columna, rompiendo los patrones repetitivos.
const ITEM_PROFILES = [
  { // campana: concentrado alrededor del centro, sin exagerar
    peso: 3,
    ruido: 1,
    warp: () => {
      const k = 1.5 + Math.random() * 1.1;
      return (u) => {
        const t = 2 * u - 1;
        return 0.5 * (1 + Math.sign(t) * Math.abs(t) ** k);
      };
    },
  },
  { // extremo: respuestas cargadas hacia los polos de la escala
    peso: 1.5,
    ruido: 0.9,
    warp: () => {
      const k = 0.35 + Math.random() * 0.3;
      return (u) => {
        const t = 2 * u - 1;
        return 0.5 * (1 + Math.sign(t) * Math.abs(t) ** k);
      };
    },
  },
  { // sesgado alto: la mayoria responde en la parte superior de la escala
    peso: 2,
    ruido: 1,
    warp: () => {
      const p = 0.4 + Math.random() * 0.3;
      return (u) => u ** p;
    },
  },
  { // sesgado bajo: la mayoria responde en la parte inferior de la escala
    peso: 2,
    ruido: 1,
    warp: () => {
      const p = 0.4 + Math.random() * 0.3;
      return (u) => 1 - (1 - u) ** p;
    },
  },
  { // disperso: reparto amplio entre todas las opciones
    peso: 2,
    ruido: 1.5,
    warp: () => (u) => u,
  },
];

const pickProfile = () => {
  const total = ITEM_PROFILES.reduce((acc, p) => acc + p.peso, 0);
  let r = Math.random() * total;
  for (const p of ITEM_PROFILES) {
    r -= p.peso;
    if (r <= 0) return p;
  }
  return ITEM_PROFILES[0];
};

// Genera la base simulada. Devuelve { base, control }: `control` describe el
// resultado del control opcional de correlacion (null con 1 sola variable).
//
// Modelo: cada persona tiene un factor compartido entre variables (cuyo peso
// `w` controla la correlacion) y un componente propio por variable que carga
// la heterogeneidad (rasgo de estilo de respuesta + grupos latentes) sin
// forzar correlacion extra. Los items agregan su propio ruido y perfil de
// distribucion, siempre dentro del rango exacto de la escala.
export const generateBaseData = (cfg) => {
  const rows = cfg.encuestados;
  const v1Count = cfg.variables[0].totalItems;
  const v2Count = cfg.variables[1]?.totalItems ?? 0;
  const minResponse = Math.min(...cfg.escala.map((o) => o.valor));
  const maxResponse = Math.max(...cfg.escala.map((o) => o.valor));
  const nOpts = maxResponse - minResponse + 1;
  const sign = cfg.relacionInversa ? -1 : 1;

  // Percentil aproximado de cada valor dentro de su columna (media/sd
  // muestrales): conserva el orden —y con el la correlacion— pero permite
  // deformar la distribucion de frecuencias con el warp del perfil.
  const discretize = (s, warp) => {
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, v) => a + (v - mean) ** 2, 0) / s.length) || 1;
    return s.map((v) => {
      const u = Math.min(0.999999, Math.max(0.000001, normCdf((v - mean) / sd)));
      const k = Math.floor(warp(u) * nOpts);
      return minResponse + Math.min(nOpts - 1, Math.max(0, k));
    });
  };

  // Heterogeneidad por persona y variable: rasgo individual (criticos /
  // optimistas) + grupos latentes con medias distintas, normalizada a sd~1.
  const groupOffsets = [-0.55, 0, 0.55];
  const heterog = () => (
    randn() + 0.35 * randn() + groupOffsets[Math.floor(Math.random() * groupOffsets.length)]
  ) / 1.15;

  // Con Pearson como metodo elegido, los items se discretizan con umbrales
  // lineales fijos en z (forma cuasi-normal, con corrimiento y apertura
  // aleatorios por item): las sumas quedan aproximadamente normales y la
  // prueba de normalidad de la hoja "Relaciones" selecciona Pearson de forma
  // estadisticamente coherente. Con Spearman se usan los perfiles dispersos.
  const modoNormal = cfg.metodoCorrelacion === "pearson";
  const discretizeLinear = (s, bias, apertura) => {
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, v) => a + (v - mean) ** 2, 0) / s.length) || 1;
    return s.map((v) => {
      const z = (v - mean) / sd + bias;
      const idx = Math.floor(((z + apertura) / (2 * apertura)) * nOpts);
      return minResponse + Math.min(nOpts - 1, Math.max(0, idx));
    });
  };

  const ITEM_STD = 0.55; // ruido por item: la correlacion se controla con w
  const buildOnce = (w) => {
    const a = Math.sqrt(Math.max(0, Math.min(1, w)));
    const b = Math.sqrt(1 - a * a);
    const shared = Array.from({ length: rows }, () => randn());
    const latent1 = shared.map((z) => a * z + b * heterog());
    const latent2 = v2Count > 0 ? shared.map((z) => sign * a * z + b * heterog()) : null;

    const data = {};
    const addColumns = (varNum, count, latent) => {
      for (let i = 1; i <= count; i += 1) {
        const carga = 0.75 + Math.random() * 0.4; // discriminacion del item
        if (modoNormal) {
          const bias = (Math.random() - 0.5) * 0.5; // corrimiento leve por item
          const apertura = 1.8 + Math.random() * 0.6; // que tanto abren los umbrales
          const s = latent.map((v) => carga * v + randn() * ITEM_STD);
          data[`V${varNum}_${i}`] = discretizeLinear(s, bias, apertura);
        } else {
          const perfil = pickProfile();
          const s = latent.map((v) => carga * v + randn() * ITEM_STD * perfil.ruido);
          data[`V${varNum}_${i}`] = discretize(s, perfil.warp());
        }
      }
    };
    addColumns(1, v1Count, latent1);
    if (v2Count > 0) addColumns(2, v2Count, latent2);
    return data;
  };

  // Misma regla de decision que la hoja "Relaciones": Shapiro-Wilk si n <= 50,
  // Kolmogorov-Smirnov (Lilliefors) si n > 50, sobre V1 total, V2 total y las
  // dimensiones de V1. true si todos los Sig. son >= 0.05 (normalidad).
  const normalityOk = (base) => {
    const targets = [];
    let from = 1;
    cfg.variables[0].dimensiones.forEach((d) => {
      const count = d.indicadores.reduce((acc, ind) => acc + ind.items, 0);
      targets.push(sumRangePerRow(base, 1, from, from + count - 1, rows));
      from += count;
    });
    targets.push(sumPerRow(base, 1, v1Count, rows));
    targets.push(sumPerRow(base, 2, v2Count, rows));
    const useSW = rows <= 50;
    return targets.every((values) => {
      const test = useSW ? shapiroWilkTest(values) : lillieforsTest(values);
      return test === null || test.p >= 0.05;
    });
  };

  // Con una sola variable no hay correlacion que controlar.
  if (v2Count === 0) return { base: buildOnce(0.6), control: null };

  // "auto" verifica con Spearman (adecuado para Likert); "pearson" con Pearson.
  const metodo = cfg.metodoCorrelacion === "pearson" ? "pearson" : "spearman";
  const measure = metodo === "pearson" ? computeCorrelation : spearmanCorrelation;
  const direccion = cfg.relacionInversa ? "inversa" : "directa";

  // Control desactivado: una sola generacion con fuerza de relacion
  // aleatoria; la correlacion obtenida es el resultado natural de los datos.
  if (!cfg.controlCorrelacion) {
    const base = buildOnce(0.15 + Math.random() * 0.7);
    return {
      base,
      control: { activo: false, direccion, metodo, obtenido: measure(base, cfg) },
    };
  }

  // Control activado: busqueda adaptativa del peso compartido w hasta que la
  // correlacion (en valor absoluto) caiga dentro del rango del nivel elegido;
  // con Pearson ademas se exige que la normalidad de las sumas pase (para que
  // la hoja "Relaciones" elija Pearson). Si no se logra, se conserva el
  // intento mas cercano.
  const nivel = cfg.nivelCorrelacion;
  const objetivo = NIVELES_CORRELACION[nivel];
  const mid = (objetivo.min + objetivo.max) / 2;
  let w = nivel === "nula" ? 0 : Math.min(0.98, mid / 0.85);
  let best = null;
  const intentos = modoNormal ? 20 : 14;
  for (let i = 0; i < intentos; i += 1) {
    const base = buildOnce(w);
    const r = measure(base, cfg);
    const abs = Math.abs(r);
    const signOk = nivel === "nula" || (sign < 0 ? r <= 0 : r >= 0);
    const distCorr = (abs < objetivo.min ? objetivo.min - abs : abs > objetivo.max ? abs - objetivo.max : 0)
      + (signOk ? 0 : 1);
    const score = distCorr + (modoNormal && !normalityOk(base) ? 0.5 : 0);
    if (!best || score < best.score) best = { base, r, distCorr, score };
    if (score === 0) break;
    if (nivel !== "nula") {
      const ratio = abs > 1e-6 ? mid / abs : 2;
      w = Math.min(0.99, Math.max(0.02, w * Math.min(2.5, Math.max(0.4, ratio))));
    }
  }
  return {
    base: best.base,
    control: {
      activo: true,
      nivel,
      etiqueta: objetivo.etiqueta,
      direccion,
      metodo,
      obtenido: best.r,
      esperadoMin: objetivo.min,
      esperadoMax: objetivo.max,
      cumple: best.distCorr === 0,
    },
  };
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
