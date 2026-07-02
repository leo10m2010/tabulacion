import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  Mail,
  Sparkles,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { createUser, deleteUser, listUsers, patchUser } from "../../lib/api";
import { formatDateTime, getSubscriptionLabel } from "../../lib/helpers";
import type { AuthUser } from "../../lib/types";

// Panel de administración de usuarios (solo admins). Autocontenido: todo el
// estado y las llamadas a la API viven aquí; App solo lo monta cuando la
// sección está activa (por eso carga usuarios en el mount).
export function UsersSection({ apiBaseUrl, authToken, authUser }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
}) {
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [usersStatusMessage, setUsersStatusMessage] = useState<string>("Sincroniza usuarios para ver el estado.");
  const [usersErrorMessage, setUsersErrorMessage] = useState<string | null>(null);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState<string>("");
  const [newUserPassword, setNewUserPassword] = useState<string>("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [newUserPlan, setNewUserPlan] = useState<string>("pro");
  const [newUserDays, setNewUserDays] = useState<string>("30");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [customDaysMap, setCustomDaysMap] = useState<Record<string, string>>({});

  const loadUsers = async () => {
    if (!authToken || authUser.role !== "admin") return;
    setIsUsersLoading(true);
    setUsersErrorMessage(null); setUsersStatusMessage("");
    try {
      const payload = await listUsers(apiBaseUrl, authToken);
      if (!Array.isArray(payload.users)) throw new Error(payload.error ?? "Respuesta inválida.");
      setManagedUsers(payload.users);
      setUsersErrorMessage(null); setUsersStatusMessage(`${payload.users.length} usuario(s) cargados.`);
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo obtener usuarios.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  useEffect(() => { void loadUsers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateUser = async () => {
    setUsersErrorMessage(null); setUsersStatusMessage("");
    if (!authToken) return;
    const email = newUserEmail.trim();
    if (!email || !newUserPassword) { setUsersErrorMessage("Email y contraseña son obligatorios."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setUsersErrorMessage("El email no tiene un formato válido."); return; }
    if (newUserPassword.length < 8) { setUsersErrorMessage("La contraseña debe tener al menos 8 caracteres."); return; }
    const subscriptionDays = Number.parseInt(newUserDays, 10);
    if (!Number.isFinite(subscriptionDays) || subscriptionDays <= 0) { setUsersErrorMessage("Los días de suscripción deben ser mayores a 0."); return; }
    setIsUsersLoading(true);
    try {
      await createUser(apiBaseUrl, authToken, { email, password: newUserPassword, role: newUserRole, plan: newUserPlan, subscriptionDays });
      setNewUserEmail(""); setNewUserPassword(""); setNewUserRole("user"); setNewUserPlan("pro"); setNewUserDays("30");
      setUsersErrorMessage(null); setUsersStatusMessage("Usuario creado correctamente.");
      await loadUsers();
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo crear el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const patchManagedUser = async (userId: string, patch: Record<string, unknown>, successMessage: string) => {
    if (!authToken) return;
    if (userId === authUser.id && "status" in patch) { setUsersErrorMessage("No puedes modificar tu propio estado."); return; }
    setIsUsersLoading(true); setUsersErrorMessage(null); setUsersStatusMessage("");
    try {
      await patchUser(apiBaseUrl, authToken, userId, patch);
      setUsersErrorMessage(null); setUsersStatusMessage(successMessage);
      await loadUsers();
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo actualizar el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const deleteManagedUser = async (userId: string) => {
    if (!authToken) return;
    if (userId === authUser.id) { setUsersErrorMessage("No puedes eliminar tu propia cuenta."); setConfirmDeleteId(null); return; }
    setIsUsersLoading(true); setUsersErrorMessage(null); setUsersStatusMessage("");
    setConfirmDeleteId(null);
    try {
      await deleteUser(apiBaseUrl, authToken, userId);
      setUsersErrorMessage(null); setUsersStatusMessage("Usuario eliminado.");
      await loadUsers();
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo eliminar el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Gestión de usuarios</h2>
        <p className="mt-1 text-sm text-muted-foreground">Crea cuentas y controla el acceso por suscripción.</p>
      </div>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle>Crear nuevo usuario</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium"><Mail className="h-3.5 w-3.5 text-muted-foreground" />Email</span>
              <Input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="usuario@dominio.com" />
            </label>
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium"><KeyRound className="h-3.5 w-3.5 text-muted-foreground" />Contraseña inicial</span>
              <Input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium"><UserRound className="h-3.5 w-3.5 text-muted-foreground" />Rol</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as "admin" | "user")}
              >
                <option value="user">Usuario</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-3.5 w-3.5 text-muted-foreground" />Plan</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={newUserPlan}
                onChange={(e) => setNewUserPlan(e.target.value)}
              >
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" />Días de acceso</span>
              <Input value={newUserDays} onChange={(e) => setNewUserDays(e.target.value)} placeholder="30" />
            </label>
          </div>
          {usersErrorMessage && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{usersErrorMessage}</div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{usersStatusMessage}</p>
            <Button onClick={handleCreateUser} disabled={isUsersLoading}>
              {isUsersLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Crear usuario
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Usuarios registrados</CardTitle>
              <CardDescription>Gestiona el acceso y las suscripciones.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadUsers} disabled={isUsersLoading}>
              {isUsersLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {managedUsers.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No hay usuarios cargados. Pulsa <strong>Actualizar</strong>.
            </p>
          ) : (
            managedUsers.map((user) => {
              const isSelf = user.id === authUser.id;
              const customDays = customDaysMap[user.id] ?? "30";
              return (
                <div key={user.id} className="rounded-xl border border-border/60 bg-background/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{user.email}{isSelf && <span className="ml-2 text-xs text-muted-foreground">(tú)</span>}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {user.role === "admin" ? "Administrador" : "Usuario"} · Plan {user.plan} ·
                        {user.status === "active"
                          ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Activo</>
                          : <><XCircle className="h-3.5 w-3.5 text-danger" /> Desactivado</>
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">{getSubscriptionLabel(user)}</p>
                      <p className="text-xs text-muted-foreground">Último acceso: {formatDateTime(user.lastLoginAt)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => patchManagedUser(user.id, { status: user.status === "active" ? "disabled" : "active" }, `Estado actualizado para ${user.email}.`)}
                      disabled={isUsersLoading || isSelf}
                      title={isSelf ? "No puedes modificar tu propio estado" : undefined}
                    >
                      {user.status === "active" ? "Desactivar" : "Activar"}
                    </Button>
                    <div className="flex items-center gap-1">
                      <Input
                        className="h-8 w-16 text-sm"
                        value={customDays}
                        onChange={(e) => setCustomDaysMap((prev) => ({ ...prev, [user.id]: e.target.value }))}
                        placeholder="30"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const days = Number.parseInt(customDays, 10);
                          if (!Number.isFinite(days) || days <= 0) { setUsersErrorMessage("Los días deben ser un número mayor a 0."); return; }
                          void patchManagedUser(user.id, { subscriptionDaysDelta: days }, `+${days} días para ${user.email}.`);
                        }}
                        disabled={isUsersLoading}
                        title="Añadir días de suscripción"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" />
                        días
                      </Button>
                    </div>
                    {confirmDeleteId === user.id ? (
                      <div className="flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                        <span className="text-xs text-danger">¿Eliminar?</span>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-danger hover:bg-danger/20" onClick={() => void deleteManagedUser(user.id)} disabled={isUsersLoading}>Sí</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>No</Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-danger hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
                        onClick={() => setConfirmDeleteId(user.id)}
                        disabled={isUsersLoading || isSelf}
                        title={isSelf ? "No puedes eliminar tu propia cuenta" : undefined}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Eliminar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
