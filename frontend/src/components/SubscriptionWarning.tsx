import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { AuthUser } from "../lib/types";

export const isSubscriptionExpired = (user: AuthUser) =>
  user.role !== "admin" && (!user.subscriptionEndsAt || Date.parse(user.subscriptionEndsAt) < Date.now());

// Aviso ámbar de suscripción vencida (Tabulación y Confiabilidad van por
// días; Forms va por usos y no se bloquea). No renderiza nada si está al día.
export function SubscriptionWarning({ user, children }: { user: AuthUser; children: ReactNode }) {
  if (!isSubscriptionExpired(user)) return null;
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-amber-700 dark:text-amber-300">{children}</p>
    </div>
  );
}
