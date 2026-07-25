import { useState } from "react";
import { Check, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { USE_TOOLS } from "../../lib/constants";
import { PLANS, openWhatsAppPlan } from "../../lib/plans";
import { cn } from "../../lib/utils";
import type { AuthUser } from "../../lib/types";

// Sección "Mejorar mi plan": los mismos planes y precios que la landing
// (lib/plans.ts), pero para alguien que YA está dentro y sabe lo que le falta.
//
// Mientras no exista la pasarela de pago (Fase 3 del roadmap), contratar es
// escribir por WhatsApp. El mensaje va prerrellenado con el plan y la cuenta
// para poder atender sin volver a preguntar.
export function PlanesSection({ authUser, herramientaBloqueada }: {
  authUser: AuthUser;
  // Herramienta desde la que llegó, si vino desde un aviso de "sin usos".
  // Se cuela en el mensaje de WhatsApp: es la razón real por la que escribe.
  herramientaBloqueada?: string | null;
}) {
  const [anual, setAnual] = useState(false);

  const usos = authUser.uses ?? {};
  const conUsos = USE_TOOLS.filter((t) => (usos[t.id] ?? 0) > 0);
  const sinUsos = USE_TOOLS.filter((t) => (usos[t.id] ?? 0) <= 0);

  return (
    <div className="step-enter mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">Mejorar mi plan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada generación consume 1 uso de su herramienta. Amplía tu cuota cuando la necesites.
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

      <div className="grid gap-4 md:grid-cols-3">
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
                  <span className="text-sm text-muted-foreground">
                    {" "}/ {anual ? "año" : "mes"} ({anual ? plan.priceYearlyUsd : plan.priceMonthlyUsd})
                  </span>
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
                  disabled={actual}
                  onClick={() => openWhatsAppPlan({
                    plan: plan.name,
                    email: authUser.email,
                    herramienta: herramientaBloqueada ?? undefined,
                  })}
                >
                  {actual ? "Tu plan actual" : (<><MessageCircle className="h-4 w-4" />Quiero este plan</>)}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Te escribimos por WhatsApp para coordinar el pago y activamos tu cuota el mismo día.
      </p>
    </div>
  );
}
