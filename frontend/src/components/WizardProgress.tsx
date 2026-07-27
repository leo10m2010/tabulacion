import { motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "../lib/utils";
import type { WizardStep } from "../lib/types";
import { WIZARD_STEPS } from "../lib/constants";
import { springSoft } from "./motion-primitives";

export function WizardProgress({ currentStep }: { currentStep: WizardStep }) {
  // El resto del frontend apaga escalados/traslados bajo prefers-reduced-motion
  // (ver ToolsShowcase, motion-primitives); este indicador se quedó fuera de esa
  // pasada: el punto activo se escalaba 1.12x y la barra de progreso hacía
  // scaleX en cada cambio de paso sin comprobar la preferencia del sistema.
  const reduce = useReducedMotion();
  return (
    <div className="mb-8 flex items-start">
      {WIZARD_STEPS.map((stepInfo, index) => {
        const isCompleted = currentStep > stepInfo.step;
        const isActive = currentStep === stepInfo.step;
        return (
          <div key={stepInfo.step} className="flex flex-1 items-start">
            <div className="flex flex-col items-center">
              <motion.div
                initial={false}
                animate={{ scale: reduce ? 1 : isActive ? 1.12 : 1 }}
                transition={reduce ? { duration: 0 } : springSoft}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors",
                  isCompleted
                    ? "border-primary bg-primary text-primary-foreground"
                    : isActive
                      ? "border-primary bg-primary/10 text-primary shadow-[0_0_0_5px_hsl(var(--primary)/0.12)]"
                      : "border-border bg-background text-muted-foreground",
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : stepInfo.step}
              </motion.div>
              <div className="mt-2 text-center">
                <p className={cn("text-xs font-semibold", isActive ? "text-foreground" : "text-muted-foreground")}>
                  {stepInfo.label}
                </p>
                <p className="hidden text-xs text-muted-foreground sm:block">{stepInfo.description}</p>
              </div>
            </div>
            {index < WIZARD_STEPS.length - 1 && (
              <div className="mx-3 mt-4 h-0.5 flex-1 overflow-hidden rounded bg-border">
                <motion.div
                  className="h-full origin-left bg-primary"
                  initial={false}
                  animate={{ scaleX: currentStep > stepInfo.step ? 1 : 0 }}
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 80, damping: 20 }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

