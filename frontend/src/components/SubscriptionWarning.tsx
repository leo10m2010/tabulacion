import { Lock } from "lucide-react";
import { USE_TOOLS } from "../lib/constants";
import { NAV_TOOLS } from "../lib/nav";
import type { AuthUser, UseTool } from "../lib/types";

// Aviso cuando al usuario no le quedan usos de la herramienta. Todas las
// herramientas funcionan por usos; los admins son ilimitados y no lo ven.
// No renderiza nada si aún hay usos.
//
// Se muestra DENTRO de la herramienta, no en su lugar: al usuario del plan
// gratuito le sirve ver qué hace la que todavía no puede usar — es lo que le
// da un motivo para ampliar el plan. Esconderla haría que el producto
// pareciera más pobre de lo que es.
//
// Es el ÚNICO sitio donde se explica que falta cuota: la sidebar solo marca el
// candado. Dos mensajes diciendo lo mismo en la misma pantalla sobran.
export function SubscriptionWarning({ user, tool, onUpgrade }: {
  user: AuthUser;
  tool: UseTool;
  // Lleva a "Mejorar mi plan". Sin esto el aviso decía "escríbenos" sin decir
  // cuánto cuesta ni dónde, que es justo donde se cae la conversión.
  onUpgrade?: (herramienta: string) => void;
}) {
  if (user.role === "admin") return null;
  const left = user.uses?.[tool] ?? 0;
  if (left > 0) return null;

  const label = USE_TOOLS.find((t) => t.id === tool)?.label ?? tool;
  const descripcion = NAV_TOOLS.find((t) => t.id === tool)?.description;

  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
        <Lock className="h-4 w-4 text-amber-700 dark:text-amber-400" />
      </span>
      <div className="space-y-1 text-sm">
        <p className="font-semibold text-amber-800 dark:text-amber-200">
          No te quedan usos de {label}
        </p>
        {descripcion && (
          <p className="text-amber-700/90 dark:text-amber-300/90">{descripcion}</p>
        )}
        <p className="text-amber-700/90 dark:text-amber-300/90">
          Puedes ver cómo funciona, pero para generar necesitas una recarga.
        </p>
        {onUpgrade && (
          <button
            onClick={() => onUpgrade(label)}
            className="pt-1 font-medium text-amber-800 underline underline-offset-4 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
          >
            Ver planes y precios
          </button>
        )}
      </div>
    </div>
  );
}
