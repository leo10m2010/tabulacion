import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronDown,
  Clock3,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Sparkles,
  Ticket,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { createUser, deleteUser, listUsers, patchUser, revokeUserApiKey } from "../../lib/api";
import { formatDateTime, getSubscriptionLabel } from "../../lib/helpers";
import { cn } from "../../lib/utils";
import type { AuthUser } from "../../lib/types";

// Panel de administración de usuarios (solo admins). Autocontenido: todo el
// estado y las llamadas a la API viven aquí; App solo lo monta cuando la
// sección está activa (por eso carga usuarios en el mount).
//
// Modelo de acceso: Tabulación va por suscripción (días de vigencia); Forms
// va por usos (1 uso = 1 corrida de llenado; los admins tienen ilimitados).

type StatusFilter = "todos" | "activos" | "desactivados" | "vencidos";
type RoleFilter = "todos" | "admin" | "user";

const isExpired = (user: AuthUser) => {
  if (user.role === "admin") return false;
  if (!user.subscriptionEndsAt) return true;
  const ts = Date.parse(user.subscriptionEndsAt);
  return !Number.isFinite(ts) || ts < Date.now();
};

function StatCard({ icon, label, value, detail }: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/95 p-3.5 transition-colors hover:border-primary/30">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detail && <p className="text-[11px] text-muted-foreground tabular-nums">{detail}</p>}
    </div>
  );
}

function UserSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border/60 bg-background/60 p-4">
      <div className="h-4 w-48 rounded bg-muted" />
      <div className="mt-2 h-3 w-72 rounded bg-muted/70" />
      <div className="mt-4 flex gap-2">
        <div className="h-8 w-24 rounded-md bg-muted/60" />
        <div className="h-8 w-28 rounded-md bg-muted/60" />
        <div className="h-8 w-28 rounded-md bg-muted/60" />
      </div>
    </div>
  );
}

export function UsersSection({ apiBaseUrl, authToken, authUser }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
}) {
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [usersStatusMessage, setUsersStatusMessage] = useState<string>("");
  const [usersErrorMessage, setUsersErrorMessage] = useState<string | null>(null);
  const [isUsersLoading, setIsUsersLoading] = useState(false);

  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [newUserPlan, setNewUserPlan] = useState("pro");
  const [newUserDays, setNewUserDays] = useState("30");
  const [newUserUses, setNewUserUses] = useState("10");
  const [showCreate, setShowCreate] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("todos");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customDaysMap, setCustomDaysMap] = useState<Record<string, string>>({});
  const [customUsesMap, setCustomUsesMap] = useState<Record<string, string>>({});
  const [resetPasswordMap, setResetPasswordMap] = useState<Record<string, string>>({});

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
      setHasLoaded(true);
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
    const formsUses = Number.parseInt(newUserUses, 10);
    if (!Number.isFinite(formsUses) || formsUses < 0) { setUsersErrorMessage("Los usos de Forms deben ser 0 o más."); return; }
    setIsUsersLoading(true);
    try {
      await createUser(apiBaseUrl, authToken, {
        email, password: newUserPassword, role: newUserRole, plan: newUserPlan, subscriptionDays, formsUses,
      });
      setNewUserEmail(""); setNewUserPassword(""); setNewUserRole("user"); setNewUserPlan("pro");
      setNewUserDays("30"); setNewUserUses("10");
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

  const revokeManagedApiKey = async (user: AuthUser) => {
    if (!authToken) return;
    setIsUsersLoading(true); setUsersErrorMessage(null); setUsersStatusMessage("");
    try {
      await revokeUserApiKey(apiBaseUrl, authToken, user.id);
      setUsersStatusMessage(`Clave de API revocada para ${user.email}: su extensión dejará de validar.`);
      await loadUsers();
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo revocar la clave.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  // ── Métricas y filtros ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = managedUsers.length;
    const activos = managedUsers.filter((u) => u.status === "active").length;
    const vencidos = managedUsers.filter((u) => isExpired(u)).length;
    const generaciones = managedUsers.reduce((acc, u) => acc + (u.generationsCount ?? 0), 0);
    const usosRestantes = managedUsers.reduce((acc, u) => acc + (u.formsUsesLeft ?? 0), 0);
    const usosConsumidos = managedUsers.reduce((acc, u) => acc + (u.formsUsesUsed ?? 0), 0);
    return { total, activos, vencidos, generaciones, usosRestantes, usosConsumidos };
  }, [managedUsers]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return managedUsers.filter((u) => {
      if (term && !u.email.toLowerCase().includes(term)) return false;
      if (roleFilter !== "todos" && u.role !== roleFilter) return false;
      if (statusFilter === "activos" && (u.status !== "active" || isExpired(u))) return false;
      if (statusFilter === "desactivados" && u.status !== "disabled") return false;
      if (statusFilter === "vencidos" && !isExpired(u)) return false;
      return true;
    });
  }, [managedUsers, searchTerm, statusFilter, roleFilter]);

  const statusFilters: { id: StatusFilter; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "activos", label: "Activos" },
    { id: "desactivados", label: "Desactivados" },
    { id: "vencidos", label: "Vencidos" },
  ];
  const roleFilters: { id: RoleFilter; label: string }[] = [
    { id: "todos", label: "Todos los roles" },
    { id: "user", label: "Usuarios" },
    { id: "admin", label: "Admins" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Gestión de usuarios</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tabulación va por suscripción (días); Forms va por usos (1 uso = 1 corrida de llenado).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadUsers} disabled={isUsersLoading}>
          {isUsersLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </div>

      {/* Métricas globales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Usuarios activos"
          value={`${stats.activos}/${stats.total}`}
          detail={`${stats.vencidos} con suscripción vencida`}
        />
        <StatCard
          icon={<Clock3 className="h-3.5 w-3.5" />}
          label="Suscripciones vencidas"
          value={String(stats.vencidos)}
          detail="requieren recarga de días"
        />
        <StatCard
          icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
          label="Excel generados"
          value={String(stats.generaciones)}
          detail="acumulado de todos los usuarios"
        />
        <StatCard
          icon={<Ticket className="h-3.5 w-3.5" />}
          label="Usos de Forms"
          value={String(stats.usosRestantes)}
          detail={`disponibles · ${stats.usosConsumidos} consumidos`}
        />
      </div>

      {/* Crear usuario (plegable para no estorbar la gestión diaria) */}
      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader className="cursor-pointer select-none py-4" onClick={() => setShowCreate((v) => !v)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Crear nuevo usuario</CardTitle>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", showCreate && "rotate-180")} />
          </div>
        </CardHeader>
        {showCreate && (
          <CardContent className="space-y-4 pt-0">
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
            <div className="grid gap-3 sm:grid-cols-4">
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
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Ticket className="h-3.5 w-3.5 text-muted-foreground" />Usos de Forms</span>
                <Input value={newUserUses} onChange={(e) => setNewUserUses(e.target.value)} placeholder="10" />
              </label>
            </div>
            <div className="flex items-center justify-end">
              <Button onClick={handleCreateUser} disabled={isUsersLoading}>
                {isUsersLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Crear usuario
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Mensajes */}
      {usersErrorMessage && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{usersErrorMessage}</div>
      )}
      {usersStatusMessage && !usersErrorMessage && (
        <p className="text-sm text-muted-foreground">{usersStatusMessage}</p>
      )}

      {/* Buscador y filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por email…"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border/70 bg-background/60 p-0.5">
          {statusFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-200",
                statusFilter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-border/70 bg-background/60 p-0.5">
          {roleFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setRoleFilter(f.id)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-200",
                roleFilter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Listado */}
      <div className="space-y-3">
        {!hasLoaded && isUsersLoading && (
          <>
            <UserSkeleton />
            <UserSkeleton />
            <UserSkeleton />
          </>
        )}

        {hasLoaded && managedUsers.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Todavía no hay usuarios</p>
            <p className="mt-1 text-xs text-muted-foreground">Crea la primera cuenta con el formulario de arriba.</p>
          </div>
        )}

        {hasLoaded && managedUsers.length > 0 && filteredUsers.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Sin resultados para este filtro</p>
            <p className="mt-1 text-xs text-muted-foreground">Prueba con otro término o limpia los filtros.</p>
          </div>
        )}

        {filteredUsers.map((user) => {
          const isSelf = user.id === authUser.id;
          const expired = isExpired(user);
          const expanded = expandedId === user.id;
          const customDays = customDaysMap[user.id] ?? "30";
          const customUses = customUsesMap[user.id] ?? "10";
          const resetPassword = resetPasswordMap[user.id] ?? "";
          return (
            <div
              key={user.id}
              className="rounded-xl border border-border/60 bg-background/60 p-4 transition-colors duration-200 hover:border-primary/25"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{user.email}</span>
                    {isSelf && <span className="text-xs font-normal text-muted-foreground">(tú)</span>}
                    <span className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      user.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}>
                      {user.role === "admin" ? "Admin" : `Plan ${user.plan}`}
                    </span>
                    <span className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      user.status !== "active"
                        ? "bg-danger/10 text-danger"
                        : expired
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "bg-green-500/15 text-green-600 dark:text-green-400",
                    )}>
                      {user.status !== "active" ? "Desactivado" : expired ? "Vencido" : "Activo"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getSubscriptionLabel(user)} · Último acceso: {formatDateTime(user.lastLoginAt)}
                  </p>
                  <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    <span><strong className="font-semibold text-foreground">{user.generationsCount ?? 0}</strong> Excel generados</span>
                    <span>
                      <strong className="font-semibold text-foreground">
                        {user.formsUsesLeft === null || user.formsUsesLeft === undefined ? (user.role === "admin" ? "∞" : 0) : user.formsUsesLeft}
                      </strong>{" "}
                      usos de Forms · {user.formsUsesUsed ?? 0} consumidos
                    </span>
                    <span>{user.hasApiKey ? `Clave API ···${user.apiKeyLast4}` : "Sin clave API"}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : user.id)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Gestionar
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-180")} />
                </button>
              </div>

              {/* Acciones rápidas: recargas de días y usos */}
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
                    className="h-8 w-16 text-sm tabular-nums"
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
                    title="Añadir días de suscripción (Tabulación)"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                    días
                  </Button>
                </div>
                {user.role !== "admin" && (
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-8 w-16 text-sm tabular-nums"
                      value={customUses}
                      onChange={(e) => setCustomUsesMap((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      placeholder="10"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const uses = Number.parseInt(customUses, 10);
                        if (!Number.isFinite(uses) || uses === 0) { setUsersErrorMessage("Los usos deben ser un número distinto de 0."); return; }
                        void patchManagedUser(user.id, { formsUsesDelta: uses }, `${uses > 0 ? "+" : ""}${uses} usos de Forms para ${user.email}.`);
                      }}
                      disabled={isUsersLoading}
                      title="Añadir usos de Forms (1 uso = 1 corrida de llenado)"
                    >
                      <Ticket className="h-3.5 w-3.5" />
                      usos
                    </Button>
                  </div>
                )}
              </div>

              {/* Gestión avanzada: rol, plan, contraseña, clave API, eliminar */}
              {expanded && (
                <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Rol</span>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={user.role}
                        disabled={isUsersLoading || isSelf}
                        title={isSelf ? "No puedes cambiar tu propio rol" : undefined}
                        onChange={(e) => void patchManagedUser(user.id, { role: e.target.value }, `Rol actualizado para ${user.email}.`)}
                      >
                        <option value="user">Usuario</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Plan</span>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={user.plan}
                        disabled={isUsersLoading}
                        onChange={(e) => void patchManagedUser(user.id, { plan: e.target.value }, `Plan actualizado para ${user.email}.`)}
                      >
                        <option value="pro">Pro</option>
                        <option value="business">Business</option>
                        <option value="enterprise">Enterprise</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-52 flex-1 space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Nueva contraseña (mínimo 8 caracteres)</span>
                      <Input
                        type="password"
                        className="h-9"
                        value={resetPassword}
                        onChange={(e) => setResetPasswordMap((prev) => ({ ...prev, [user.id]: e.target.value }))}
                        placeholder="••••••••"
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isUsersLoading || resetPassword.length < 8}
                      onClick={() => {
                        void patchManagedUser(user.id, { password: resetPassword }, `Contraseña restablecida para ${user.email}.`);
                        setResetPasswordMap((prev) => ({ ...prev, [user.id]: "" }));
                      }}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Restablecer
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {user.hasApiKey && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void revokeManagedApiKey(user)}
                        disabled={isUsersLoading}
                        title="Su extensión Tutorica Forms dejará de validar"
                      >
                        Revocar clave API ···{user.apiKeyLast4}
                      </Button>
                    )}
                    {confirmDeleteId === user.id ? (
                      <div className="flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                        <span className="text-xs text-danger">¿Eliminar esta cuenta?</span>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-danger hover:bg-danger/20" onClick={() => void deleteManagedUser(user.id)} disabled={isUsersLoading}>Sí, eliminar</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>Cancelar</Button>
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
                        Eliminar cuenta
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
