import assert from "node:assert/strict";
import test from "node:test";
import { metrics, redactLogValue, structuredLog } from "../lib/observability.js";

test.afterEach(() => metrics.reset());

test("logs estructurados ocultan tokens, textos, respuestas y queries firmadas", () => {
  const lines = [];
  const output = {
    log: (line) => lines.push(line),
    warn: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  structuredLog("info", "forms.job", {
    requestId: "req-1",
    authorization: "Bearer secret",
    answers: ["privado"],
    download: "https://bucket.test/file?X-Amz-Signature=secret",
  }, output);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.requestId, "req-1");
  assert.equal(parsed.authorization, "[REDACTED]");
  assert.equal(parsed.answers, "[REDACTED]");
  assert.equal(parsed.download, "[REDACTED_URL]");
});

test("métricas acumulan contadores, gauges e histogramas sin datos sensibles", () => {
  metrics.increment("forms_responses_total", 3, { outcome: "accepted" });
  metrics.increment("forms_responses_total", 2, { outcome: "accepted" });
  metrics.gauge("queue_depth", 4, { type: "forms" });
  metrics.observe("neon_latency_ms", 20);
  metrics.observe("neon_latency_ms", 40);
  assert.deepEqual(metrics.snapshot(), {
    counters: { "forms_responses_total{outcome=accepted}": 5 },
    gauges: { "queue_depth{type=forms}": 4 },
    histograms: { neon_latency_ms: { count: 2, sum: 60, max: 40 } },
  });
});

test("redacción limita profundidad y tamaño", () => {
  assert.equal(redactLogValue({ password: "x" }).password, "[REDACTED]");
  assert.match(redactLogValue("x".repeat(700)), /…$/);
});

test("redacción elimina secretos y URLs incluso dentro de mensajes", () => {
  const value = redactLogValue(
    "falló Bearer abc.def y https://bucket.test/a?X-Amz-Signature=secret ttab_supersecret",
  );
  assert.doesNotMatch(value, /abc\.def|Signature|supersecret/);
  assert.match(value, /\[REDACTED_URL\]/);
});

test("structuredLog no registra query, URL, mensaje ni stack de un error", () => {
  const lines = [];
  structuredLog("error", "search.failed", {
    query: "tema privado de investigación",
    sourceUrl: "https://repositorio.example/documento",
    errorMessage: "Bearer token-secreto",
    stack: "Error: texto privado",
    errorCode: "UPSTREAM_TIMEOUT",
    queryCount: 7,
    promptTokens: 123,
    responseLength: 456,
  }, { error: (line) => lines.push(line) });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.query, "[REDACTED]");
  assert.equal(entry.sourceUrl, "[REDACTED]");
  assert.equal(entry.errorMessage, "[REDACTED]");
  assert.equal(entry.stack, "[REDACTED]");
  assert.equal(entry.errorCode, "UPSTREAM_TIMEOUT");
  assert.equal(entry.queryCount, 7);
  assert.equal(entry.promptTokens, 123);
  assert.equal(entry.responseLength, 456);
  assert.doesNotMatch(lines[0], /privado|repositorio|token-secreto/);
});

test("métricas acotan cardinalidad y descartan valores no numéricos", () => {
  for (let index = 0; index < 1_100; index += 1) {
    metrics.increment("dynamic", 1, { reason: `reason-${index}` });
  }
  metrics.gauge("invalid", Number.NaN);
  assert.equal(Object.keys(metrics.snapshot().counters).length, 1_000);
  assert.equal("invalid" in metrics.snapshot().gauges, false);
});
