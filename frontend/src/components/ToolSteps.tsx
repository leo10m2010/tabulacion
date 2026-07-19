import { ChevronRight } from "lucide-react";

// Guía compacta de "cómo funciona" en 3 pasos, al estilo del wizard de
// Tabulación: cada herramienta la muestra bajo su encabezado para que un
// usuario nuevo entienda el flujo sin leer documentación.
export function ToolSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-accent/50 px-4 py-3 sm:flex-row sm:items-center sm:gap-2">
      {steps.map((step, i) => (
        <li key={step} className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-display text-[11px] font-bold text-primary-foreground">
            {i + 1}
          </span>
          <span className="text-xs leading-snug text-accent-foreground">{step}</span>
          {i < steps.length - 1 && (
            <ChevronRight className="ml-auto hidden h-4 w-4 shrink-0 text-primary/40 sm:block" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}
