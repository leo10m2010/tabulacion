import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { changePassword, deleteOwnAccount } from "../../lib/api";
import { USE_TOOLS } from "../../lib/constants";
import { formatDateTime } from "../../lib/helpers";
import type { AuthUser } from "../../lib/types";

// Sección "Mi cuenta": datos de la cuenta y cambio de contraseña
// self-service (antes solo el administrador podía restablecerla).
export function AccountSection({ apiBaseUrl, authToken, authUser, onTokenRefresh, onAccountDeleted }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  onTokenRefresh: (token: string) => void;
  onAccountDeleted: (mensaje: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const submitDelete = async () => {
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await deleteOwnAccount(apiBaseUrl, authToken, deleteConfirmEmail.trim());
      // La sesión ya no vale: el usuario que la tenía dejó de existir.
      onAccountDeleted([res.mensaje, res.avisoCuota].filter(Boolean).join(" "));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "No se pudo eliminar la cuenta.");
      setDeleting(false);
    }
  };

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
        <h2 className="font-display text-2xl font-bold tracking-tight">Mi cuenta</h2>
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
          <CardTitle className="text-base">Mis usos</CardTitle>
          <CardDescription>
            Cada herramienta funciona por usos: 1 uso = 1 generación o corrida. Pide recargas a tu administrador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {USE_TOOLS.map((tool) => {
              const left = authUser.role === "admin" ? "∞" : String(authUser.uses?.[tool.id] ?? 0);
              const used = authUser.usesConsumed?.[tool.id] ?? 0;
              return (
                <div key={tool.id} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{tool.label}</p>
                  <p className="mt-0.5 font-semibold tabular-nums">
                    {left} <span className="text-xs font-normal text-muted-foreground">disponibles · {used} usados</span>
                  </p>
                </div>
              );
            })}
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
          {error && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
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

      {/* Eliminar la cuenta. No es una cortesía: la política de datos de Google
          la exige a las aplicaciones que usan su inicio de sesión, y el derecho
          de supresión del RGPD apunta a lo mismo. El administrador no aparece
          aquí porque el servidor no permite que se borre a sí mismo. */}
      {authUser.role !== "admin" && (
        <Card className="rounded-2xl border-danger/40 bg-danger/[0.03] shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-danger">
              <Trash2 className="h-4 w-4" />
              Eliminar mi cuenta
            </CardTitle>
            <CardDescription>
              Se borran tu cuenta, tus usos y tu historial. No se puede deshacer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {deleteError && (
              <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{deleteError}</div>
            )}

            {!confirmingDelete ? (
              <Button
                variant="outline"
                className="border-danger/40 text-danger hover:bg-danger/10"
                onClick={() => { setConfirmingDelete(true); setDeleteError(null); }}
              >
                <Trash2 className="h-4 w-4" />
                Eliminar mi cuenta
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Para confirmar, escribe tu correo <span className="font-medium text-foreground">{authUser.email}</span>.
                  {" "}Si vuelves a registrarte pronto con este correo, la cuenta se creará sin usos de cortesía.
                </p>
                <Input
                  value={deleteConfirmEmail}
                  onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                  placeholder={authUser.email}
                  autoComplete="off"
                  aria-label={`Escribe ${authUser.email} para confirmar la eliminación de tu cuenta`}
                  // autoFocus: al confirmar, el botón "Eliminar mi cuenta" que
                  // tenía el foco se desmonta y lo sustituye este bloque; sin
                  // esto el foco caía al <body> y quien navega por teclado
                  // perdía su lugar en la página.
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setConfirmingDelete(false); setDeleteConfirmEmail(""); setDeleteError(null); }
                  }}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => { setConfirmingDelete(false); setDeleteConfirmEmail(""); setDeleteError(null); }}
                    disabled={deleting}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className="bg-danger-deep text-white hover:bg-danger-deep/90"
                    onClick={submitDelete}
                    // El botón solo se activa con el correo exacto: evita el
                    // clic accidental en una acción irreversible.
                    disabled={deleting || deleteConfirmEmail.trim().toLowerCase() !== authUser.email.toLowerCase()}
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Eliminar definitivamente
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
