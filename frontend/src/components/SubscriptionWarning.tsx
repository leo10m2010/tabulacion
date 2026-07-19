import { AlertTriangle } from "lucide-react";
import { USE_TOOLS } from "../lib/constants";
import type { AuthUser, UseTool } from "../lib/types";

// Aviso ámbar cuando al usuario no le quedan usos de la herramienta. Todas
// las herramientas funcionan por usos; los admins son ilimitados y no ven
// el aviso. No renderiza nada si aún hay usos.
export function SubscriptionWarning({ user, tool }: { user: AuthUser; tool: UseTool }) {
  if (user.role === "admin") return null;
  const left = user.uses?.[tool] ?? 0;
  if (left > 0) return null;
  const label = USE_TOOLS.find((t) => t.id === tool)?.label ?? tool;
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-amber-700 dark:text-amber-300">
        No te quedan usos de {label}. Pide una recarga a tu administrador para seguir usando esta herramienta.
      </p>
    </div>
  );
}
