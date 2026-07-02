import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { changePassword } from "../../lib/api";
import { formatDateTime, getSubscriptionLabel } from "../../lib/helpers";
import type { AuthUser } from "../../lib/types";

// Sección "Mi cuenta": datos de la cuenta y cambio de contraseña
// self-service (antes solo el administrador podía restablecerla).
export function AccountSection({ apiBaseUrl, authToken, authUser, onTokenRefresh }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  onTokenRefresh: (token: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usesLeft = authUser.role === "admin" ? "Ilimitados" : String(authUser.formsUsesLeft ?? 0);

  const submit = async () => {
    setMessage(null); setError(null);
    if (!currentPassword) { setError("Escribe tu contraseña actual."); return; }
    if (newPassword.length < 8) { setError("La nueva contraseña debe tener al menos 8 caracteres."); return; }
    if (newPassword !== confirmPassword) { setError("La confirmación no coincide con la nueva contraseña."); return; }
    setBusy(true);
    try {
      const result = await changePassword(apiBaseUrl, authToken, currentPassword, newPassword);
      // Las demás sesiones quedan invalidadas; esta continúa con el token fresco.
      if (result.token) onTokenRefresh(result.token);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setMessage("Contraseña actualizada. Las sesiones en otros dispositivos se cerraron; úsala también en la extensión.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Mi cuenta</h2>
        <p className="mt-1 text-sm text-muted-foreground">Datos de tu cuenta y seguridad.</p>
      </div>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Resumen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              ["Email", authUser.email],
              ["Rol", authUser.role === "admin" ? "Administrador" : "Usuario"],
              ["Plan", authUser.plan],
              ["Suscripción (Tabulación)", getSubscriptionLabel(authUser)],
              ["Usos de Forms disponibles", usesLeft],
              ["Último acceso", formatDateTime(authUser.lastLoginAt)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k}</p>
                <p className="mt-0.5 truncate font-medium">{v}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Cambiar contraseña
          </CardTitle>
          <CardDescription>
            El cambio aplica también al inicio de sesión de la extensión Tutorica Forms.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
          {message && !error && (
            <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">{message}</div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Contraseña actual</span>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Nueva contraseña</span>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Confirmar nueva</span>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Cambiar contraseña
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
