import { useState } from "react";
import { Check, FolderOpen } from "lucide-react";
import { Button } from "./ui/button";
import { tieneContenido } from "../lib/instrumento";
import type { Proyecto } from "../lib/types";

export interface AccionTraer { label: string; aplicar: () => void }

// Atajo para rellenar una herramienta con el instrumento del proyecto activo.
//
// Es un ATAJO, no una puerta: la herramienta funciona igual sin proyecto, y
// esto no aparece si no hay uno activo o si su instrumento está vacío. Rellena
// campos que el usuario puede seguir editando; no bloquea nada ni obliga a
// nada.
//
// Admite varias acciones porque hay herramientas que trabajan de a una
// variable (Confiabilidad) y un instrumento puede tener dos.
export function TraerDelProyecto({ proyecto, descripcion, acciones }: {
  proyecto: Proyecto | null;
  descripcion: string;
  acciones: AccionTraer[];
}) {
  const [traido, setTraido] = useState(false);

  if (!proyecto || !tieneContenido(proyecto.instrumento) || acciones.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/[0.06] px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{proyecto.nombre}</p>
          <p className="text-xs text-muted-foreground">{descripcion}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {traido && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Check className="h-4 w-4" />
            Datos traídos — puedes editarlos
          </span>
        )}
        {acciones.map((a) => (
          <Button
            key={a.label}
            variant="outline"
            size="sm"
            onClick={() => { a.aplicar(); setTraido(true); }}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
