import { ArrowRight, Check, FolderOpen, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { NAV_GROUPS } from "../../lib/nav";
import { RUTA, hecho, pasosHechos, siguientePaso } from "../../lib/ruta";
import { tiempoRelativo } from "../../lib/helpers";
import type { AppSection, AuthUser, Proyecto, UseTool } from "../../lib/types";

// Inicio.
//
// Antes era una rejilla de siete tarjetas idénticas: no sabía nada de quien la
// miraba y decía lo mismo el primer día que el mes siguiente. Con siete
// herramientas sueltas, la pregunta real de un tesista no es "¿qué hay?" sino
// "¿qué me toca ahora?".
//
// Ahora el inicio responde eso: si hay un proyecto activo muestra su ruta y el
// paso siguiente; si no lo hay, sigue mostrando las herramientas, porque usar
// una suelta sin crear ningún proyecto es un camino legítimo.
export function HomeSection({ user, proyecto, proyectosTotal, onNavigate }: {
  user: AuthUser;
  proyecto: Proyecto | null;
  proyectosTotal: number;
  onNavigate: (section: AppSection) => void;
}) {
  const rawName = user.email.split("@")[0];
  const firstName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const siguiente = siguientePaso(proyecto);
  const hechos = pasosHechos(proyecto);

  return (
    <div className="step-enter mx-auto max-w-5xl space-y-10">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">
          Hola, <span className="text-primary">{firstName}</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {proyecto
            ? "Esta es la ruta de tu tesis. Puedes seguirla o saltar al paso que necesites."
            : "Elige una herramienta y empieza. Si quieres que la app recuerde tu instrumento, crea un proyecto."}
        </p>
      </div>

      {proyecto ? (
        <section className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-semibold tracking-tight">{proyecto.nombre}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {hechos} de {RUTA.length} pasos · actualizado {tiempoRelativo(proyecto.updatedAt)}
              </p>
            </div>
            {proyectosTotal > 1 && (
              <Button variant="ghost" size="sm" onClick={() => onNavigate("proyectos")}>
                Cambiar de tesis
              </Button>
            )}
          </div>

          {/* La ruta como lista vertical: se lee en orden, que es justo lo que
              hay que comunicar. Una fila por paso, sin tarjetas dentro de la
              tarjeta. */}
          <ol className="mt-5 space-y-1">
            {RUTA.map((paso) => {
              const listo = hecho(proyecto, paso.id);
              const esSiguiente = siguiente?.id === paso.id;
              return (
                <li key={paso.id}>
                  <button
                    onClick={() => onNavigate(paso.seccion)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                      esSiguiente ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                        listo
                          ? "bg-primary text-primary-foreground"
                          : esSiguiente
                            ? "border border-primary text-primary"
                            : "border border-border text-muted-foreground",
                      )}
                    >
                      {listo ? <Check className="h-3.5 w-3.5" /> : RUTA.indexOf(paso) + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-sm font-medium", listo && "text-muted-foreground")}>
                          {paso.label}
                        </span>
                        {paso.opcional && !listo && (
                          <span className="text-[11px] text-muted-foreground">opcional</span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {listo ? `Hecho ${tiempoRelativo(proyecto.progreso[paso.id])}` : paso.resultado}
                      </span>
                    </span>
                    {esSiguiente && (
                      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                        Continuar
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-dashed border-border/70 p-5">
          <div className="flex min-w-0 items-start gap-2.5">
            <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {proyectosTotal > 0
                ? "Tienes proyectos guardados. Abre uno y la app te lleva por el siguiente paso."
                : "Un proyecto guarda tu instrumento y lleva la cuenta de lo que ya hiciste."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onNavigate("proyectos")}>
            {proyectosTotal > 0 ? "Ver mis proyectos" : <><Plus className="h-4 w-4" />Crear un proyecto</>}
          </Button>
        </section>
      )}

      <div className="space-y-8">
        <p className="text-sm font-medium">Todas las herramientas</p>
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
    </div>
  );
}
