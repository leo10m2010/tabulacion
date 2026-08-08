import { useEffect, useState } from "react";
import { KeyRound, Link2, Loader2, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import {
  approveDevicePairing,
  changePassword,
  deleteOwnAccount,
  linkGoogleIdentity,
  listDevices,
  listSessions,
  revokeDevice,
  revokeOtherSessions,
} from "../../lib/api";
import type { SessionInfo } from "../../lib/api";
import { USE_TOOLS } from "../../lib/constants";
import { formatDateTime } from "../../lib/helpers";
import { getFormsBalance } from "../../lib/usage";
import type { AuthUser, DeviceCredential, ThemeMode } from "../../lib/types";
import { GoogleSignInButton } from "../GoogleSignInButton";

// Sección "Mi cuenta": datos de la cuenta y cambio de contraseña
// self-service (antes solo el administrador podía restablecerla).
export function AccountSection({
  apiBaseUrl,
  authToken,
  authUser,
  googleClientId,
  themeMode,
  onTokenRefresh,
  onAccountDeleted,
}: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  googleClientId: string;
  themeMode: ThemeMode;
  onTokenRefresh: (token: string, expiresAt?: string) => void;
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
  const [devices, setDevices] = useState<DeviceCredential[]>(authUser.devices ?? []);
  const [pairingCode, setPairingCode] = useState("");
  const [devicesBusy, setDevicesBusy] = useState(false);
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [googleLinked, setGoogleLinked] = useState(
    Boolean(authUser.googleLinked || authUser.passwordEnabled === false),
  );
  const [linkPassword, setLinkPassword] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const linkGoogle = async (credential: string) => {
    if (!linkPassword) {
      setLinkError("Escribe primero la contraseña actual de tu cuenta.");
      return;
    }
    setLinkBusy(true);
    setLinkError(null);
    setLinkMessage(null);
    try {
      await linkGoogleIdentity(apiBaseUrl, authToken, linkPassword, credential);
      setGoogleLinked(true);
      setLinkPassword("");
      setLinkMessage("Google quedó vinculado. Desde ahora puedes entrar con cualquiera de los dos métodos.");
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "No se pudo vincular Google.");
    } finally {
      setLinkBusy(false);
    }
  };

  const loadConnectedDevices = async () => {
    setDevicesBusy(true);
    setDeviceError(null);
    try {
      const result = await listDevices(apiBaseUrl, authToken);
      setDevices(result.devices ?? []);
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : "No se pudieron cargar los dispositivos.");
    } finally {
      setDevicesBusy(false);
    }
  };

  useEffect(() => {
    void loadConnectedDevices();
    void loadActiveSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadActiveSessions = async () => {
    setSessionsBusy(true);
    setSessionError(null);
    try {
      const result = await listSessions(apiBaseUrl, authToken);
      setSessions((result.sessions ?? []).filter((session) => !session.revokedAt));
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "No se pudieron cargar las sesiones.");
    } finally {
      setSessionsBusy(false);
    }
  };

  const closeOtherSessions = async () => {
    setSessionsBusy(true);
    setSessionMessage(null);
    setSessionError(null);
    try {
      const result = await revokeOtherSessions(apiBaseUrl, authToken);
      setSessionMessage(result.revoked > 0
        ? `Se cerraron ${result.revoked} sesiones adicionales.`
        : "No había otras sesiones abiertas.");
      await loadActiveSessions();
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "No se pudieron cerrar las sesiones.");
      setSessionsBusy(false);
    }
  };

  const approvePairing = async () => {
    const code = pairingCode.trim().toUpperCase().replace(/[\s-]/g, "");
    setDeviceMessage(null);
    setDeviceError(null);
    if (code.length !== 8) {
      setDeviceError("Escribe el código de 8 caracteres que muestra la extensión.");
      return;
    }
    setDevicesBusy(true);
    try {
      const result = await approveDevicePairing(apiBaseUrl, authToken, code);
      setPairingCode("");
      setDeviceMessage(`Dispositivo “${result.deviceName}” aprobado. La extensión terminará la conexión automáticamente.`);
      await loadConnectedDevices();
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : "No se pudo aprobar el dispositivo.");
      setDevicesBusy(false);
    }
  };

  const disconnectDevice = async (device: DeviceCredential) => {
    if (!window.confirm(`¿Desconectar “${device.name}”? Esa instalación de Forms dejará de funcionar.`)) return;
    setDevicesBusy(true);
    setDeviceMessage(null);
    setDeviceError(null);
    try {
      await revokeDevice(apiBaseUrl, authToken, device.id);
      setDevices((current) => current.filter((item) => item.id !== device.id));
      setDeviceMessage(`“${device.name}” fue desconectado.`);
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : "No se pudo desconectar el dispositivo.");
    } finally {
      setDevicesBusy(false);
    }
  };

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
      if (result.token) onTokenRefresh(result.token, result.tokenExpiresAt);
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
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Sesiones abiertas
          </CardTitle>
          <CardDescription>
            Revisa tus accesos web y cierra todos los demás sin desconectar esta sesión.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessionError && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{sessionError}</div>}
          {sessionMessage && !sessionError && <div role="status" className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">{sessionMessage}</div>}
          <div className="space-y-2">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
                <div>
                  <p className="text-sm font-medium">{session.current ? "Esta sesión" : "Sesión web"}</p>
                  <p className="text-xs text-muted-foreground">
                    Iniciada {formatDateTime(session.createdAt)} · vence {formatDateTime(session.expiresAt)}
                  </p>
                </div>
                {session.current && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Actual</span>}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={loadActiveSessions} disabled={sessionsBusy}>
              <RefreshCw className={sessionsBusy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Actualizar
            </Button>
            <Button size="sm" variant="outline" onClick={closeOtherSessions} disabled={sessionsBusy || sessions.every((session) => session.current)}>
              Cerrar las demás
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Métodos de acceso
          </CardTitle>
          <CardDescription>
            Google se vincula de forma explícita; compartir el mismo correo nunca une cuentas automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {linkError && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{linkError}</div>}
          {linkMessage && !linkError && <div role="status" className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">{linkMessage}</div>}
          {googleLinked ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-800 dark:text-green-200">
              <ShieldCheck className="h-4 w-4" />
              Google está vinculado a esta cuenta.
            </div>
          ) : googleClientId && authUser.passwordEnabled !== false ? (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Contraseña actual</span>
                <Input
                  type="password"
                  value={linkPassword}
                  onChange={(event) => setLinkPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Confirma que esta cuenta es tuya"
                />
              </label>
              <GoogleSignInButton
                clientId={googleClientId}
                themeMode={themeMode}
                onCredential={(credential) => void linkGoogle(credential)}
                onError={setLinkError}
                disabled={linkBusy || !linkPassword}
              />
              {linkBusy && <p className="text-center text-xs text-muted-foreground">Vinculando identidad…</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Tu acceso manual permanece activo.</p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorSmartphone className="h-4 w-4 text-primary" />
            Dispositivos de Forms
          </CardTitle>
          <CardDescription>
            Vincula la extensión con un código. Funciona también si tu cuenta se creó con Google y cada instalación se puede revocar por separado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deviceError && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{deviceError}</div>}
          {deviceMessage && !deviceError && <div role="status" className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">{deviceMessage}</div>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              placeholder="Código de 8 caracteres"
              aria-label="Código de emparejamiento de Forms"
              autoComplete="off"
              maxLength={11}
              className="font-mono tracking-wider"
              onKeyDown={(event) => event.key === "Enter" && void approvePairing()}
            />
            <Button onClick={approvePairing} disabled={devicesBusy || !pairingCode.trim()}>
              {devicesBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Aprobar dispositivo
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Conectados</p>
              <Button size="sm" variant="ghost" onClick={loadConnectedDevices} disabled={devicesBusy}>
                <RefreshCw className={devicesBusy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                Actualizar
              </Button>
            </div>
            {devices.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                Todavía no hay instalaciones vinculadas.
              </p>
            ) : devices.map((device) => (
              <div key={device.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
                <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{device.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ···{device.last4} · Vinculado {formatDateTime(device.createdAt)}
                    {device.lastUsedAt ? ` · Último uso ${formatDateTime(device.lastUsedAt)}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void disconnectDevice(device)} disabled={devicesBusy}>
                  <Unplug className="h-3.5 w-3.5" />
                  Desconectar
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Mis usos</CardTitle>
          <CardDescription>
            Cada generación consume un uso de su herramienta. Forms descuenta únicamente las respuestas enviadas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {USE_TOOLS.map((tool) => {
              const forms = getFormsBalance(authUser);
              const left = tool.id === "forms"
                ? (forms.available === null ? "∞" : String(forms.available))
                : (authUser.role === "admin" ? "∞" : String(authUser.uses?.[tool.id] ?? 0));
              const used = tool.id === "forms" ? forms.consumed : (authUser.usesConsumed?.[tool.id] ?? 0);
              return (
                <div key={tool.id} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{tool.label}</p>
                  <p className="mt-0.5 font-semibold tabular-nums">
                    {left} <span className="text-xs font-normal text-muted-foreground">
                      {tool.id === "forms" ? "respuestas disponibles" : "usos disponibles"} · {used} {tool.id === "forms" ? "enviadas" : "usados"}
                      {tool.id === "forms" && forms.reserved > 0 ? ` · ${forms.reserved} reservadas` : ""}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {authUser.passwordEnabled !== false && (
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
      )}

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
