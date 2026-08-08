const SENSITIVE_KEY = /(authorization|cookie|token|password|secret|credential|question|answer|response|payload|body|text|content|query|url|stack|error.?message)/i;
const SAFE_AGGREGATE_KEY = /(count|length|bytes|tokens|duration|latency|status|code|percent|ratio|total|accepted|failed|pending|queued|active|attempt|index)$/i;
const URL_VALUE = /^https?:\/\//i;
const EMBEDDED_SECRET = /(?:\b(?:bearer|basic)\s+\S+|\bttab_[a-z0-9_-]+|\b(?:sk|whsec|taypi_sk)[-_][a-z0-9_-]{8,}|\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{8,})/gi;
const EMBEDDED_URL = /https?:\/\/[^\s"'<>]+/gi;
const MAX_METRIC_SERIES = 1_000;

const isSensitiveKey = (key) => (
  SENSITIVE_KEY.test(String(key)) && !SAFE_AGGREGATE_KEY.test(String(key))
);

const sanitizeScalar = (value) => {
  if (typeof value !== "string") return value;
  if (URL_VALUE.test(value)) return "[REDACTED_URL]";
  const withoutUrlSecrets = value.replace(EMBEDDED_URL, "[REDACTED_URL]");
  const redacted = withoutUrlSecrets.replace(EMBEDDED_SECRET, "[REDACTED]");
  return redacted.length > 512 ? `${redacted.slice(0, 512)}…` : redacted;
};

export const redactLogValue = (value, depth = 0) => {
  if (depth > 5) return "[MAX_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redactLogValue(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? "[REDACTED]" : redactLogValue(entry, depth + 1),
    ]));
  }
  return sanitizeScalar(value);
};

export const structuredLog = (level, event, fields = {}, output = console) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redactLogValue(fields),
  };
  const line = JSON.stringify(entry);
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  output[method](line);
  return entry;
};

export const errorLogFields = (error) => {
  const rawCode = String(error?.code || error?.name || "UNKNOWN_ERROR");
  const errorCode = rawCode.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 64)
    || "UNKNOWN_ERROR";
  const statusCode = Number(error?.statusCode ?? error?.status ?? error?.httpStatus);
  return {
    errorCode,
    ...(Number.isSafeInteger(statusCode) && statusCode >= 100 && statusCode <= 599
      ? { statusCode }
      : {}),
    ...(typeof error?.retryable === "boolean" ? { retryable: error.retryable } : {}),
  };
};

export const providerUsageFields = (usage) => {
  const numeric = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  return {
    promptTokens: numeric(usage?.prompt_tokens ?? usage?.input_tokens),
    completionTokens: numeric(usage?.completion_tokens ?? usage?.output_tokens),
    totalTokens: numeric(usage?.total_tokens),
  };
};

const counters = new Map();
const gauges = new Map();
const histograms = new Map();

const metricKey = (name, labels = {}) => {
  const safeName = String(name ?? "metric").replace(/[^a-zA-Z0-9_:]/g, "_").slice(0, 128);
  const suffix = Object.entries(labels).slice(0, 12)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const safeKey = String(key).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
      const safeValue = isSensitiveKey(safeKey)
        ? "redacted"
        : String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 64);
      return `${safeKey}=${safeValue}`;
    })
    .join(",");
  return suffix ? `${safeName}{${suffix}}` : safeName;
};

const canCreateSeries = (map, key) => (
  map.has(key) || counters.size + gauges.size + histograms.size < MAX_METRIC_SERIES
);

export const metrics = {
  increment(name, value = 1, labels = {}) {
    const key = metricKey(name, labels);
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !canCreateSeries(counters, key)) return;
    counters.set(key, (counters.get(key) ?? 0) + numeric);
  },
  gauge(name, value, labels = {}) {
    const key = metricKey(name, labels);
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !canCreateSeries(gauges, key)) return;
    gauges.set(key, numeric);
  },
  observe(name, value, labels = {}) {
    const key = metricKey(name, labels);
    const current = histograms.get(key) ?? { count: 0, sum: 0, max: 0 };
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !canCreateSeries(histograms, key)) return;
    current.count += 1;
    current.sum += numeric;
    current.max = Math.max(current.max, numeric);
    histograms.set(key, current);
  },
  snapshot() {
    return {
      counters: Object.fromEntries(counters),
      gauges: Object.fromEntries(gauges),
      histograms: Object.fromEntries(histograms),
    };
  },
  reset() {
    counters.clear();
    gauges.clear();
    histograms.clear();
  },
};
