import crypto from "node:crypto";

const MAX_WEBHOOK_AGE_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 30_000;
const PAYMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const timingSafeHexEqual = (expected, received) => {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const first = Buffer.from(expected, "hex");
  const second = Buffer.from(received, "hex");
  return first.length === second.length && crypto.timingSafeEqual(first, second);
};

export const taypiConfigFromEnv = (env = process.env) => {
  const publicKey = String(env.TAYPI_PUBLIC_KEY ?? "").trim();
  const secretKey = String(env.TAYPI_SECRET_KEY ?? "").trim();
  const webhookSecret = String(env.TAYPI_WEBHOOK_SECRET ?? "").trim();
  const sandbox = String(env.TAYPI_SANDBOX ?? "true").trim().toLowerCase() !== "false";
  const configuredTimeout = Number.parseInt(String(env.TAYPI_TIMEOUT_MS ?? ""), 10);
  const timeoutMs = Number.isSafeInteger(configuredTimeout)
    ? Math.min(30_000, Math.max(3_000, configuredTimeout))
    : DEFAULT_TIMEOUT_MS;
  return {
    enabled: Boolean(publicKey && secretKey && webhookSecret),
    publicKey,
    secretKey,
    webhookSecret,
    sandbox,
    timeoutMs,
    baseUrl: sandbox ? "https://sandbox.taypi.pe" : "https://app.taypi.pe",
  };
};

// Tener credenciales presentes solo significa que el servidor puede hablar
// con Taypi (incluido recibir webhooks). El checkout publico exige ademas el
// gate operativo y el entorno real: asi una clave sandbox cargada durante
// staging no convierte accidentalmente la UI de produccion en una caja de
// pagos de prueba.
export const taypiCheckoutEnabledFromEnv = (env = process.env) => {
  const config = taypiConfigFromEnv(env);
  const commercialLaunchEnabled = new Set(["1", "true", "yes", "on"])
    .has(String(env.COMMERCIAL_LAUNCH_ENABLED ?? "false").trim().toLowerCase());
  return commercialLaunchEnabled && config.enabled && !config.sandbox;
};

export const signTaypiRequest = ({ secretKey, timestamp, method, path, body = "" }) => (
  crypto
    .createHmac("sha256", secretKey)
    .update([timestamp, method.toUpperCase(), path, body].join("\n"))
    .digest("hex")
);

export const verifyTaypiWebhook = ({
  rawBody,
  signatureHeader,
  timestampHeader,
  webhookSecret,
  nowSeconds = Math.floor(Date.now() / 1000),
}) => {
  const timestamp = Number.parseInt(String(timestampHeader ?? ""), 10);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_WEBHOOK_AGE_SECONDS) {
    return false;
  }
  const received = String(signatureHeader ?? "").replace(/^sha256=/i, "").trim();
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return timingSafeHexEqual(expected, received);
};

export const parseTaypiEvent = (rawBody) => {
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new Error("El webhook de TAYPI no contiene JSON válido.");
  }
  const allowedEvents = new Set([
    "payment.completed",
    "payment.expired",
    "payment.cancelled",
    "payment.failed",
    "payment.rejected",
  ]);
  if (!allowedEvents.has(event?.event)) throw new Error("Evento TAYPI no soportado.");
  if (!PAYMENT_ID_RE.test(String(event.payment_id ?? ""))) {
    throw new Error("payment_id de TAYPI no es válido.");
  }
  if (String(event.currency ?? "") !== "PEN") throw new Error("La moneda del pago no es PEN.");
  const amountRaw = String(event.amount ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amountRaw)) {
    throw new Error("El monto del pago no es valido.");
  }
  const [whole, decimals = ""] = amountRaw.split(".");
  const amountCents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("El monto del pago no es válido.");
  }
  const expectedStatus = event.event.slice("payment.".length);
  if (String(event.status ?? "") !== expectedStatus) {
    throw new Error("El estado del pago no coincide con el evento TAYPI.");
  }
  return { ...event, amountCents };
};

// La API envuelve normalmente el pago en `data`, pero algunas versiones del
// SDK devuelven ese objeto ya desempaquetado. Normalizamos ambas formas y solo
// aceptamos URLs alojadas por TAYPI para no convertir el checkout en un open
// redirect controlado por una respuesta inesperada del proveedor.
export const normalizeTaypiCheckout = (providerResult) => {
  const payment = providerResult?.data ?? providerResult ?? {};
  const paymentId = String(payment.payment_id ?? payment.id ?? "").trim();
  if (!PAYMENT_ID_RE.test(paymentId)) {
    throw new Error("Taypi no devolvió un identificador de pago válido.");
  }

  const checkoutUrl = String(payment.checkout_url ?? "").trim();
  let parsed;
  try {
    parsed = new URL(checkoutUrl);
  } catch {
    throw new Error("Taypi no devolvió una URL de checkout válida.");
  }
  const allowedHosts = new Set(["app.taypi.pe", "sandbox.taypi.pe"]);
  if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
    throw new Error("Taypi devolvió una URL de checkout no permitida.");
  }

  return {
    paymentId,
    checkoutUrl: parsed.toString(),
    expiresAt: payment.expires_at ?? null,
  };
};

export const createTaypiClient = ({
  env = process.env,
  fetchImpl = globalThis.fetch,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) => {
  const config = taypiConfigFromEnv(env);

  const retryDelayMs = (header, attempt) => {
    const raw = String(header ?? "").trim();
    if (raw) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
      }
      const dateMs = Date.parse(raw);
      if (Number.isFinite(dateMs)) {
        return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, dateMs - nowSeconds() * 1000));
      }
    }
    return 250 * 2 ** (attempt - 1);
  };

  const request = async (path, {
    method = "GET",
    payload,
    idempotencyKey,
  } = {}) => {
    if (!config.enabled) throw new Error("TAYPI no está configurado.");
    const upperMethod = method.toUpperCase();
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const baseHeaders = { Authorization: `Bearer ${config.publicKey}` };
    if (body) baseHeaders["Content-Type"] = "application/json";
    if (upperMethod === "POST") {
      const key = String(idempotencyKey ?? "").trim();
      if (!key || key.length > 255) throw new Error("Se requiere una clave de idempotencia válida.");
      baseHeaders["Idempotency-Key"] = key;
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const timestamp = String(nowSeconds());
      const headers = {
        ...baseHeaders,
        "Taypi-Signature": signTaypiRequest({
          secretKey: config.secretKey,
          timestamp,
          method: upperMethod,
          path,
          body,
        }),
        "Taypi-Timestamp": timestamp,
      };
      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}${path}`, {
          method: upperMethod,
          headers,
          signal: AbortSignal.timeout(config.timeoutMs),
          ...(body ? { body } : {}),
        });
      } catch (error) {
        if (attempt === 3) throw error;
        await sleepImpl(250 * 2 ** (attempt - 1));
        continue;
      }
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { message: text };
      }
      if (response.ok) return data;

      const retryable = response.status === 429 || response.status >= 500;
      const retryAfter = response.headers?.get?.("retry-after") ?? null;
      if (retryable && attempt < 3) {
        await sleepImpl(retryDelayMs(retryAfter, attempt));
        continue;
      }
      const error = new Error(data?.message || "TAYPI rechazó la operación.");
      error.code = data?.code || "TAYPI_ERROR";
      error.httpStatus = response.status;
      error.retryAfter = retryAfter;
      throw error;
    }
    throw new Error("TAYPI no respondió después de los reintentos.");
  };

  return {
    enabled: config.enabled,
    publicKey: config.enabled ? config.publicKey : null,
    sandbox: config.sandbox,
    createCheckoutSession(payload, idempotencyKey) {
      return request("/api/v1/payments", { method: "POST", payload, idempotencyKey });
    },
    getPayment(paymentId) {
      const id = String(paymentId ?? "").trim();
      if (!PAYMENT_ID_RE.test(id)) throw new Error("paymentId no es válido.");
      return request(`/api/v1/payments/${id}`);
    },
    verifyWebhook(rawBody, headers, now = nowSeconds()) {
      return verifyTaypiWebhook({
        rawBody,
        signatureHeader: headers["taypi-signature"],
        timestampHeader: headers["taypi-timestamp"],
        webhookSecret: config.webhookSecret,
        nowSeconds: now,
      });
    },
  };
};
