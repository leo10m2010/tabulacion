import { Check } from "lucide-react";
import { CHART_THEMES } from "../lib/constants";
import { cn } from "../lib/utils";

// Alturas fijas de las mini-barras: un "gráfico" de muestra por tema.
const SWATCH_HEIGHTS = [55, 85, 40, 70, 100];

export function ThemePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {CHART_THEMES.map((tema) => {
        const selected = value === tema.id;
        return (
          <button
            key={tema.id}
            type="button"
            onClick={() => onChange(tema.id)}
            aria-pressed={selected}
            className={cn(
              "group relative rounded-xl border bg-background/60 p-3 text-left transition-all",
              selected
                ? "border-primary ring-2 ring-primary/40"
                : "border-border/70 hover:border-primary/40 hover:bg-accent/50",
            )}
          >
            {selected && (
              <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            )}
            <div className="flex h-14 items-end gap-1.5 rounded-md bg-muted/40 px-2 pb-1 pt-2">
              {SWATCH_HEIGHTS.map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-t-sm transition-transform group-hover:scale-y-105"
                  style={{
                    height: `${h}%`,
                    backgroundColor: tema.colores[i % tema.colores.length],
                    transformOrigin: "bottom",
                  }}
                />
              ))}
            </div>
            <p className="mt-2 text-sm font-semibold text-foreground">{tema.nombre}</p>
            <p className="text-xs text-muted-foreground">{tema.descripcion}</p>
          </button>
        );
      })}
    </div>
  );
}
