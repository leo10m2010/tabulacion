import { useRef, useState } from "react";
import { Check, CreditCard, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { USE_TOOLS } from "../../lib/constants";
import { PLANS, openWhatsAppPlan } from "../../lib/plans";
import { cn } from "../../lib/utils";
import { getFormsBalance } from "../../lib/usage";
import { createFormsTopupCheckout, createTaypiCheckout } from "../../lib/api";
import type { AuthUser } from "../../lib/types";

// Sección "Mejorar mi plan": los mismos planes y precios que la landing
// (lib/plans.ts), pero para alguien que YA está dentro y sabe lo que le falta.
//
// Mientras no exista la pasarela de pago (Fase 3 del roadmap), contratar es
// escribir por WhatsApp. El mensaje va prerrellenado con el plan y la cuenta
// para poder atender sin volver a preguntar.
export function PlanesSection({
  apiBaseUrl,
  authToken,
  authUser,
  herramientaBloqueada,
  paymentsEnabled,
  formsTopupsEnabled = false,
}: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  // Herramienta desde la que llegó, si vino desde un aviso de "sin usos".
  // Se cuela en el mensaje de WhatsApp: es la razón real por la que escribe.
  herramientaBloqueada?: string | null;
  paymentsEnabled: boolean;
  formsTopupsEnabled?: boolean;
}) {
  const [anual, setAnual] = useState(false);
  const [payingPlan, setPayingPlan] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [topupResponses, setTopupResponses] = useState("500");
  const [topupBusy, setTopupBusy] = useState(false);
  const paymentKeys = useRef(new Map<string, string>());

  const persistentPaymentKey = (purchaseKey: string) => `taypiCheckout:${authUser.id}:${purchaseKey}`;

  const contratar = async (planId: string, planName: string) => {
    if (!paymentsEnabled) {
      openWhatsAppPlan({
        plan: planName,
        email: authUser.email,
        herramienta: herramientaBloqueada ?? undefined,
      });
      return;
    }
    const billingCycle = anual ? "yearly" : "monthly";
    const purchaseKey = `${planId}:${billingCycle}`;
    const storageKey = persistentPaymentKey(purchaseKey);
    const idempotencyKey = paymentKeys.current.get(purchaseKey)
      ?? sessionStorage.getItem(storageKey)
      ?? crypto.randomUUID();
    paymentKeys.current.set(purchaseKey, idempotencyKey);
    sessionStorage.setItem(storageKey, idempotencyKey);
    setPayingPlan(planId);
    setPaymentError(null);
    try {
      const checkout = await createTaypiCheckout(apiBaseUrl, authToken, {
        plan: planId,
        billingCycle,
        idempotencyKey,
      });
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "No se pudo iniciar el pago.");
      setPayingPlan(null);
    }
  };

  const recargarForms = async () => {
    const requestedResponses = Number(topupResponses);
    setPaymentError(null);
    if (!Number.isSafeInteger(requestedResponses) || requestedResponses < 1) {
      setPaymentError("Escribe una cantidad entera de respuestas mayor que cero.");
      return;
    }
    if (!formsTopupsEnabled) {
      openWhatsAppPlan({
        email: authUser.email,
        herramienta: `Forms: ${requestedResponses} respuestas`,
      });
      return;
    }
    const purchaseKey = `forms:${requestedResponses}`;
    const storageKey = persistentPaymentKey(purchaseKey);
    const idempotencyKey = paymentKeys.current.get(purchaseKey)
      ?? sessionStorage.getItem(storageKey)
      ?? crypto.randomUUID();
    paymentKeys.current.set(purchaseKey, idempotencyKey);
    sessionStorage.setItem(storageKey, idempotencyKey);
    setTopupBusy(true);
    try {
      const checkout = await createFormsTopupCheckout(apiBaseUrl, authToken, {
        requestedResponses,
        idempotencyKey,
      });
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "No se pudo iniciar la recarga.");
      setTopupBusy(false);
    }
  };

  const usos = authUser.uses ?? {};
  const saldo = (id: (typeof USE_TOOLS)[number]["id"]) => (
    id === "forms" ? (getFormsBalance(authUser).available ?? Number.POSITIVE_INFINITY) : (usos[id] ?? 0)
  );
  const conUsos = USE_TOOLS.filter((t) => saldo(t.id) > 0);
  const sinUsos = USE_TOOLS.filter((t) => saldo(t.id) <= 0);

  return (
    <div className="step-enter mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">Mejorar mi plan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada generación consume 1 uso. Forms se descuenta por respuesta enviada.
        </p>
      </div>

      {/* Qué tiene hoy: da sentido al precio de al lado. */}
      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">
            Tu plan actual: <span className="capitalize text-primary">{authUser.plan}</span>
          </CardTitle>
          <CardDescription>
            {conUsos.length > 0
              ? `Te quedan usos de ${conUsos.map((t) => t.label).join(", ")}.`
              : "No te quedan usos en ninguna herramienta."}
            {sinUsos.length > 0 && ` Sin usos: ${sinUsos.map((t) => t.label).join(", ")}.`}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Recargar respuestas de Forms</CardTitle>
          <CardDescription>
            Elige cualquier cantidad positiva. Solo las respuestas aceptadas consumen el saldo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1.5">
            <span className="text-sm font-medium">Cantidad de respuestas</span>
            <Input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={topupResponses}
              onChange={(event) => setTopupResponses(event.target.value)}
            />
          </label>
          <Button onClick={() => void recargarForms()} disabled={topupBusy || payingPlan !== null}>
            {topupBusy
              ? <><Loader2 className="h-4 w-4 animate-spin" />Abriendo pago…</>
              : formsTopupsEnabled
                ? <><CreditCard className="h-4 w-4" />Recargar con Taypi</>
                : <><MessageCircle className="h-4 w-4" />Solicitar recarga</>}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-3">
        <span className={cn("text-sm", !anual && "font-medium")}>Mensual</span>
        <button
          onClick={() => setAnual((v) => !v)}
          role="switch"
          aria-checked={anual}
          aria-label="Cambiar entre precio mensual y anual"
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            anual ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-1 h-4 w-4 rounded-full bg-white transition-all",
              anual ? "left-6" : "left-1",
            )}
          />
        </button>
        <span className={cn("text-sm", anual && "font-medium")}>
          Anual <span className="text-muted-foreground">(2 meses gratis)</span>
        </span>
      </div>

      <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
        {PLANS.map((plan) => {
          const actual = plan.id === authUser.plan;
          return (
            <Card
              key={plan.id}
              className={cn(
                "flex flex-col rounded-2xl shadow-sm",
                plan.featured ? "border-primary/50 bg-card" : "border-border/70 bg-card/95",
              )}
            >
              <CardHeader>
                {plan.featured && (
                  <span className="mb-2 inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                    <Sparkles className="h-3 w-3" />
                    Más elegido
                  </span>
                )}
                <CardTitle className="flex items-center gap-2 text-base">
                  <plan.icon className="h-4 w-4 text-primary" />
                  {plan.name}
                </CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <p className="pt-2">
                  <span className="font-display text-2xl font-bold tracking-tight">
                    {anual ? plan.priceYearlyPen : plan.priceMonthlyPen}
                  </span>
                  <span className="text-sm text-muted-foreground"> {" "}/ {anual ? "año" : "mes"}</span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <ul className="space-y-1.5">
                  {plan.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      {h}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={plan.featured ? "default" : "outline"}
                  disabled={payingPlan !== null}
                  onClick={() => void contratar(plan.id, plan.name)}
                >
                  {payingPlan === plan.id
                      ? (<><Loader2 className="h-4 w-4 animate-spin" />Abriendo pago…</>)
                      : paymentsEnabled
                        ? (<><CreditCard className="h-4 w-4" />{actual ? "Renovar con Taypi" : "Pagar con Taypi"}</>)
                        : (<><MessageCircle className="h-4 w-4" />{actual ? "Renovar mi plan" : "Quiero este plan"}</>)}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {paymentError && (
        <p className="text-center text-sm text-destructive" role="alert">{paymentError}</p>
      )}
      <p className="text-center text-xs text-muted-foreground">
        {paymentsEnabled
          ? "Tu plan se activa cuando Taypi confirma el pago. Si necesitas ayuda, contáctanos por WhatsApp."
          : "Te atendemos por WhatsApp para coordinar el pago y activar tu cuota."}
      </p>
      {paymentsEnabled && (
        <div className="text-center">
          <Button
            variant="ghost"
            onClick={() => openWhatsAppPlan({ email: authUser.email, herramienta: herramientaBloqueada ?? "Forms" })}
          >
            <MessageCircle className="h-4 w-4" /> Ayuda o recarga de respuestas por WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}
