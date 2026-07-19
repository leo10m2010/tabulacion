import { ArrowRight } from "lucide-react";
import type { AppSection, AuthUser, UseTool } from "../../lib/types";
import { NAV_GROUPS } from "../../lib/nav";

// Pantalla de inicio de la app: presenta cada herramienta con su descripción
// para que un usuario nuevo entienda qué hay. Solo navega (setActiveSection);
// no tiene estado propio ni llama a la API.
export function HomeSection({ user, onNavigate }: { user: AuthUser; onNavigate: (section: AppSection) => void }) {
  const rawName = user.email.split("@")[0];
  const firstName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  return (
    <div className="step-enter mx-auto max-w-5xl space-y-8">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">
          Hola, <span className="text-primary">{firstName}</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ¿Qué parte de tu tesis avanzamos hoy? Elige una herramienta para empezar.
        </p>
      </div>

      {NAV_GROUPS.map((group) => (
        <section key={group.id}>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => onNavigate(tool.id)}
                className="group rounded-3xl border border-border/60 bg-card p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-soft active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <tool.icon className="h-5 w-5" />
                  </div>
                  {user.role !== "admin" && (() => {
                    const left = user.uses?.[tool.id as UseTool] ?? 0;
                    return (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground">
                        {left} {left === 1 ? "uso" : "usos"}
                      </span>
                    );
                  })()}
                </div>
                <h3 className="mt-4 font-display text-base font-semibold tracking-tight">{tool.label}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{tool.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Abrir
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
