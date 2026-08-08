export const COMMERCIAL_PLANS = Object.freeze({
  esencial: Object.freeze({
    id: "esencial",
    name: "Plan Esencial",
    prices: Object.freeze({ monthly: 4900, yearly: 49000 }),
  }),
  tesista: Object.freeze({
    id: "tesista",
    name: "Plan Tesista",
    prices: Object.freeze({ monthly: 10900, yearly: 109000 }),
  }),
});

export const getPurchasablePlan = (planId, billingCycle) => {
  const plan = COMMERCIAL_PLANS[String(planId ?? "").trim().toLowerCase()];
  const cycle = String(billingCycle ?? "").trim().toLowerCase();
  if (!plan || !["monthly", "yearly"].includes(cycle)) {
    throw new Error("El plan o ciclo de facturación no es válido.");
  }
  return {
    ...plan,
    billingCycle: cycle,
    amountCents: plan.prices[cycle],
    amount: (plan.prices[cycle] / 100).toFixed(2),
    currency: "PEN",
  };
};

export const getFormsResponsesTopup = (requestedResponses, unitPriceMinor = process.env.FORMS_RESPONSE_PRICE_CENTS) => {
  const quantity = Number(requestedResponses);
  const unit = Number(unitPriceMinor);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("requestedResponses debe ser un entero positivo.");
  }
  if (!Number.isSafeInteger(unit) || unit < 1) {
    const error = new Error("La tarifa de recarga de Forms no está configurada.");
    error.code = "TOPUP_NOT_CONFIGURED";
    throw error;
  }
  const calculatedAmountMinor = quantity * unit;
  if (!Number.isSafeInteger(calculatedAmountMinor)) {
    throw new Error("La cantidad solicitada es demasiado grande.");
  }
  // TAYPI exige un cobro mínimo de S/ 1.00. La cantidad acreditada sigue
  // siendo exactamente la solicitada, incluso cuando aplica este mínimo.
  const amountCents = Math.max(100, calculatedAmountMinor);
  return {
    kind: "forms_responses",
    requestedResponses: quantity,
    unitPriceMinor: unit,
    minimumChargeApplied: calculatedAmountMinor < 100,
    amountCents,
    amount: (amountCents / 100).toFixed(2),
    currency: "PEN",
    name: `Recarga de ${quantity} ${quantity === 1 ? "respuesta" : "respuestas"} de Forms`,
  };
};
