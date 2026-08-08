import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { getFormsResponsesTopup, getPurchasablePlan } from "../lib/payments/catalog.js";
import {
  createTaypiClient,
  normalizeTaypiCheckout,
  parseTaypiEvent,
  signTaypiRequest,
  verifyTaypiWebhook,
} from "../lib/payments/taypi.js";

const ENV = {
  TAYPI_PUBLIC_KEY: "taypi_pk_test_public",
  TAYPI_SECRET_KEY: "taypi_sk_test_secret",
  TAYPI_WEBHOOK_SECRET: "whsec_test",
  TAYPI_SANDBOX: "true",
  TAYPI_TIMEOUT_MS: "10000",
};

test("catálogo cobra PEN desde backend y no ofrece Institución", () => {
  assert.equal(getPurchasablePlan("esencial", "monthly").amount, "49.00");
  assert.equal(getPurchasablePlan("tesista", "yearly").amountCents, 109000);
  assert.throws(() => getPurchasablePlan("institucion", "monthly"), /no es válido/);
});

test("recarga Forms acepta cualquier entero positivo y calcula PEN en servidor", () => {
  assert.deepEqual(getFormsResponsesTopup(1200, 10), {
    kind: "forms_responses",
    requestedResponses: 1200,
    unitPriceMinor: 10,
    minimumChargeApplied: false,
    amountCents: 12000,
    amount: "120.00",
    currency: "PEN",
    name: "Recarga de 1200 respuestas de Forms",
  });
  assert.deepEqual(getFormsResponsesTopup(1, 10), {
    kind: "forms_responses",
    requestedResponses: 1,
    unitPriceMinor: 10,
    minimumChargeApplied: true,
    amountCents: 100,
    amount: "1.00",
    currency: "PEN",
    name: "Recarga de 1 respuesta de Forms",
  });
  assert.throws(() => getFormsResponsesTopup(0, 10), /entero positivo/);
  assert.throws(() => getFormsResponsesTopup(500, ""), /no está configurada/);
});

test("firma TAYPI usa timestamp, método, path y body exactos", () => {
  const signature = signTaypiRequest({
    secretKey: "secret",
    timestamp: "1710504600",
    method: "POST",
    path: "/api/v1/payments",
    body: "{\"amount\":\"50.00\"}",
  });
  const expected = crypto
    .createHmac("sha256", "secret")
    .update("1710504600\nPOST\n/api/v1/payments\n{\"amount\":\"50.00\"}")
    .digest("hex");
  assert.equal(signature, expected);
});

test("checkout exige idempotencia y nunca expone la clave secreta", async () => {
  let captured;
  const client = createTaypiClient({
    env: ENV,
    nowSeconds: () => 1710504600,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        status: 201,
        headers: { get: () => null },
        text: async () => JSON.stringify({ payment_id: "a14dfb8e-d5c2-4a69-bae4-4688fef5eac2" }),
      };
    },
  });
  await client.createCheckoutSession(
    { amount: "49.00", currency: "PEN", reference: "ORD-1" },
    "order-1",
  );
  assert.equal(captured.url, "https://sandbox.taypi.pe/api/v1/payments");
  assert.equal(captured.init.headers["Idempotency-Key"], "order-1");
  assert.equal(captured.init.headers.Authorization, `Bearer ${ENV.TAYPI_PUBLIC_KEY}`);
  assert.doesNotMatch(JSON.stringify(captured), /taypi_sk_test_secret/);
});

test("webhook valida firma, timestamp y payload PEN", () => {
  const rawBody = JSON.stringify({
    event: "payment.completed",
    payment_id: "a14dfb8e-d5c2-4a69-bae4-4688fef5eac2",
    amount: "49.00",
    currency: "PEN",
    status: "completed",
    reference: "ORD-1",
  });
  const signature = crypto.createHmac("sha256", "whsec_test").update(rawBody).digest("hex");
  assert.equal(verifyTaypiWebhook({
    rawBody,
    signatureHeader: `sha256=${signature}`,
    timestampHeader: "1710504600",
    webhookSecret: "whsec_test",
    nowSeconds: 1710504601,
  }), true);
  assert.equal(verifyTaypiWebhook({
    rawBody,
    signatureHeader: `sha256=${signature}`,
    timestampHeader: "1710504600",
    webhookSecret: "whsec_test",
    nowSeconds: 1710505000,
  }), false);
  assert.equal(parseTaypiEvent(rawBody).amountCents, 4900);
});

test("normaliza checkout oficial y rechaza redirects externos", () => {
  assert.deepEqual(normalizeTaypiCheckout({ data: {
    payment_id: "a14dfb8e-d5c2-4a69-bae4-4688fef5eac2",
    checkout_url: "https://sandbox.taypi.pe/checkout/session-1",
    expires_at: "2026-08-01T10:00:00-05:00",
  } }), {
    paymentId: "a14dfb8e-d5c2-4a69-bae4-4688fef5eac2",
    checkoutUrl: "https://sandbox.taypi.pe/checkout/session-1",
    expiresAt: "2026-08-01T10:00:00-05:00",
  });
  assert.throws(() => normalizeTaypiCheckout({ data: {
    payment_id: "a14dfb8e-d5c2-4a69-bae4-4688fef5eac2",
    checkout_url: "https://evil.example/checkout/session-1",
  } }), /no permitida/);
});

test("webhook acepta estados terminales sin acreditarlos", () => {
  for (const status of ["expired", "cancelled", "failed", "rejected"]) {
    const event = parseTaypiEvent(JSON.stringify({
      event: `payment.${status}`,
      payment_id: "a14dfb8e-d5c2-4a69-bae4-4688fef5eac2",
      amount: "49.00",
      currency: "PEN",
      status,
    }));
    assert.equal(event.status, status);
  }
});

test("webhook rechaza monto ambiguo y evento incoherente aunque estén firmados", () => {
  assert.throws(() => parseTaypiEvent(JSON.stringify({
    event: "payment.completed",
    payment_id: "a14dfb8e-d5c2-4a69-bae4-4688fef5eac2",
    amount: "49.001",
    currency: "PEN",
    status: "completed",
  })), /monto/);
  assert.throws(() => parseTaypiEvent(JSON.stringify({
    event: "payment.completed",
    payment_id: "a14dfb8e-d5c2-4a69-bae4-4688fef5eac2",
    amount: "49.00",
    currency: "PEN",
    status: "failed",
  })), /estado/);
});

test("cliente respeta Retry-After y conserva la misma idempotencia", async () => {
  const waits = [];
  const requests = [];
  const client = createTaypiClient({
    env: ENV,
    nowSeconds: () => 1_710_504_600,
    sleepImpl: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async (_url, init) => {
      requests.push(init);
      const retry = requests.length === 1;
      return {
        ok: !retry,
        status: retry ? 429 : 200,
        headers: { get: (name) => (name === "retry-after" && retry ? "2" : null) },
        text: async () => JSON.stringify(retry ? { code: "rate_limited" } : { id: "ok" }),
      };
    },
  });
  const result = await client.createCheckoutSession({ amount: "49.00" }, "same-order");
  assert.equal(result.id, "ok");
  assert.deepEqual(waits, [2000]);
  assert.equal(requests[0].headers["Idempotency-Key"], "same-order");
  assert.equal(requests[1].headers["Idempotency-Key"], "same-order");
  assert.equal(requests[0].signal instanceof AbortSignal, true);
});
