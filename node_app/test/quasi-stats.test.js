// Pruebas de las estadisticas cuasiexperimentales contra valores de
// referencia calculados con scipy 1.18 (ttest_rel, ttest_ind equal_var=False,
// wilcoxon, mannwhitneyu, shapiro).
import assert from "node:assert/strict";
import test from "node:test";
import {
  describe,
  mannWhitneyUTest,
  pairedTTest,
  welchTTest,
  wilcoxonSignedRankTest,
} from "../lib/quasi-stats.js";
import { effectMagnitude, normalityFor } from "../lib/quasi-experimental.js";

const closeTo = (actual, expected, tolerance = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Se esperaba ${expected}, pero se obtuvo ${actual}`,
  );
};

test("t pareada coincide con scipy.stats.ttest_rel", () => {
  const result = pairedTTest(
    [10, 12, 9, 11, 13, 8],
    [12, 13, 11, 12, 15, 10],
  );
  closeTo(result.statistic, 7.905694150420949, 1e-9);
  closeTo(result.p, 0.0005210669895035296, 1e-9);
  assert.equal(result.df, 5);
  assert.ok(result.effectSize > 0, "dz positivo cuando el postest sube");
});

test("t de Welch coincide con scipy.stats.ttest_ind(equal_var=False)", () => {
  const result = welchTTest(
    [10, 12, 9, 11, 13, 8],
    [7, 8, 6, 9, 10, 5],
  );
  closeTo(result.statistic, 2.7774602993176547, 1e-9);
  closeTo(result.p, 0.019535605462663152, 1e-9);
  closeTo(result.df, 10, 1e-9);
});

test("t de Welch con tamaños distintos coincide con scipy", () => {
  const result = welchTTest(
    [23, 25, 21, 30, 28, 26, 24, 27],
    [20, 19, 22, 18, 21],
  );
  closeTo(result.statistic, 4.438206216322609, 1e-9);
  closeTo(result.p, 0.001013151182441068, 1e-9);
  closeTo(result.df, 10.931587837837839, 1e-9);
});

test("Wilcoxon exacto coincide con scipy.stats.wilcoxon(mode='exact')", () => {
  const differences = [6, 8, 14, 16, 23, 24, 28, 29, 41, -48, 49, 56, 60, -67, 75];
  const result = wilcoxonSignedRankTest(
    Array(differences.length).fill(0),
    differences,
  );
  assert.equal(result.statistic, 24);
  closeTo(result.p, 0.041259765625, 1e-12);
  assert.equal(result.exact, true);
});

test("Wilcoxon con empates pequeños usa permutación exhaustiva", () => {
  const result = wilcoxonSignedRankTest(
    [1, 1, 2, 2, 3, 3, 4, 4],
    [2, 2, 3, 2, 4, 4, 5, 4],
  );
  assert.equal(result.statistic, 0);
  closeTo(result.p, 0.03125, 1e-12);
  assert.equal(result.exact, true);
});

test("Wilcoxon grande con empates usa aproximación normal (scipy mode='approx')", () => {
  const pre = Array.from({ length: 30 }, (_, i) => i + 1);
  const deltas = [3, -1, 2, 4, 1, 2, -2, 3, 5, 1, 2, 3, -1, 4, 2, 1, 3, 2, -3, 4, 1, 2, 3, 1, 2, -1, 4, 3, 2, 1];
  const post = pre.map((value, i) => value + deltas[i]);
  const result = wilcoxonSignedRankTest(pre, post);
  assert.equal(result.exact, false);
  assert.equal(result.statistic, 51);
  // scipy.stats.wilcoxon(mode="approx", correction=False) -> p=0.000167397...
  closeTo(result.p, 0.0001673976394931828, 1e-6);
});

test("Mann-Whitney exacto coincide con scipy.stats.mannwhitneyu(method='exact')", () => {
  const result = mannWhitneyUTest(
    [19, 22, 16, 29, 24],
    [20, 11, 17, 12],
  );
  assert.equal(result.statistic, 3);
  assert.equal(result.u1, 17);
  assert.equal(result.u2, 3);
  closeTo(result.p, 0.1111111111111111, 1e-12);
  assert.equal(result.exact, true);
});

test("Mann-Whitney con empates usa aproximación normal con corrección (scipy asymptotic)", () => {
  const g1 = [3, 4, 2, 5, 4, 3, 5, 4, 2, 3, 4, 5, 3, 4, 2, 5, 3, 4, 5, 3];
  const g2 = [2, 3, 1, 4, 2, 3, 2, 4, 3, 2, 1, 3, 2, 4, 3, 2, 3, 1, 2, 3];
  const result = mannWhitneyUTest(g1, g2);
  assert.equal(result.exact, false);
  assert.equal(result.u1, 311.5);
  // scipy.stats.mannwhitneyu(method="asymptotic") -> p=0.00192167...
  closeTo(result.p, 0.0019216712484480109, 1e-6);
});

test("describe entrega n, media, DE, mediana y extremos", () => {
  const stats = describe([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(stats.n, 8);
  closeTo(stats.mean, 5);
  closeTo(stats.sd, 2.1380899352993947, 1e-9);
  closeTo(stats.median, 4.5);
  assert.equal(stats.min, 2);
  assert.equal(stats.max, 9);
});

test("normalityFor elige Shapiro-Wilk (n<=50) o Lilliefors (n>50)", () => {
  const small = Array.from({ length: 20 }, () => Math.random() * 10);
  assert.equal(normalityFor(small).method, "Shapiro-Wilk");
  const large = Array.from({ length: 80 }, () => Math.random() * 10);
  assert.equal(normalityFor(large).method, "Kolmogorov-Smirnov (Lilliefors)");
  // Sin variabilidad se asume compatible con normalidad (p = 1).
  const flat = normalityFor([3, 3, 3, 3, 3]);
  assert.equal(flat.p, 1);
  assert.equal(flat.normal, true);
  // Muy pocos datos: no aplicable.
  assert.equal(normalityFor([1, 2]).method, "No aplicable");
});

test("effectMagnitude clasifica d de Cohen y correlación biserial", () => {
  assert.equal(effectMagnitude({ test: "t_pareada", effectSize: 0.1 }), "trivial");
  assert.equal(effectMagnitude({ test: "t_pareada", effectSize: -0.6 }), "mediano");
  assert.equal(effectMagnitude({ test: "t_independiente_welch", effectSize: 0.9 }), "grande");
  assert.equal(effectMagnitude({ test: "wilcoxon", effectSize: 0.2 }), "pequeño");
  assert.equal(effectMagnitude({ test: "mann_whitney", effectSize: -0.55 }), "grande");
});

test("validaciones de entrada de las pruebas", () => {
  assert.throws(() => pairedTTest([1, 2], [1]), /mismo tamaño/);
  assert.throws(() => pairedTTest([1], [1]), /al menos 2 pares/);
  assert.throws(() => welchTTest([1], [1, 2]), /al menos 2 casos/);
  assert.throws(() => mannWhitneyUTest([], [1, 2]), /debe contener datos/);
  assert.throws(() => welchTTest([1, Number.NaN], [1, 2]), /no numéricos/);
});
