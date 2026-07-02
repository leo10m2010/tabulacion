import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  FileSpreadsheet,
  History,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Sparkles,
  Ticket,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import {
  createUser,
  deleteUser,
  getUsersBackup,
  listUsers,
  patchUser,
  restoreUsersBackup,
  revokeUserApiKey,
} from "../../lib/api";
import { formatDateTime, getSubscriptionLabel } from "../../lib/helpers";
import { cn } from "../../lib/utils";
import type { AuthUser } from "../../lib/types";

// Panel de administración de usuarios (solo admins). Autocontenido: todo el
// estado y las llamadas a la API viven aquí; App solo lo monta cuando la
// sección está activa (por eso carga usuarios en el mount).
//
// Modelo de acceso desacoplado: Tabulación va por suscripción (días de
// vigencia); Forms va por usos (1 uso = 1 corrida; admins ilimitados). La
// cuenta activa permite iniciar sesión aunque la suscripción esté vencida.

type StatusFilter = "todos" | "activos" | "por_vencer" | "vencidos" | "desactivados";
type RoleFilter = "todos" | "admin" | "user";

const MS_DAY = 24 * 60 * 60 * 1000;

const daysLeft = (user: AuthUser): number | null => {
  if (user.role === "admin" || !user.subscriptionEndsAt) return null;
  const ts = Date.parse(user.subscriptionEndsAt);
  if (!Number.isFinite(ts)) return null;
  return Math.ceil((ts - Date.now()) / MS_DAY);
};

const isExpired = (user: AuthUser) => {
  if (user.role === "admin") return false;
  const left = daysLeft(user);
  return left === null || left <= 0;
};

const isExpiringSoon = (user: AuthUser) => {
  const left = daysLeft(user);
  return left !== null && left > 0 && left <= 7;
};

const usesLabel = (user: AuthUser) => (
  user.role === "admin" ? "∞" : String(user.formsUsesLeft ?? 0)
);

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

function StatusChip({ user }: { user: AuthUser }) {
  const left = daysLeft(user);
  if (user.status !== "active") {
    return <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">Desactivado</span>;
  }
  if (isExpired(user)) {
    return <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">Vencido</span>;
  }
  if (isExpiringSoon(user)) {
    return <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Vence en {left} día{left === 1 ? "" : "s"}</span>;
  }
  return <span className="rounded-md bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400">Activo</span>;
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState("30");
  const [customUses, setCustomUses] = useState("10");
  const [resetPassword, setResetPassword] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<{ users: unknown[]; fileName: string } | null>(null);

  const selectedUser = useMemo(
    () => managedUsers.find((u) => u.id === selectedId) ?? null,
    [managedUsers, selectedId],
  );

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

  // El panel lateral se cierra con Escape.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // Al cambiar de usuario seleccionado se limpian los campos de gestión.
  useEffect(() => {
    setCustomDays("30");
    setCustomUses("10");
    setResetPassword("");
    setConfirmDeleteId(null);
  }, [selectedId]);

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
      setSelectedId(null);
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

  // ── Respaldo (exportar / importar users.json) ───────────────────────────────
  const exportBackup = async () => {
    if (!authToken) return;
    setUsersErrorMessage(null);
    try {
      const payload = await getUsersBackup(apiBaseUrl, authToken);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tesistab-usuarios-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setUsersStatusMessage(`Respaldo exportado (${payload.users.length} usuarios). Guárdalo en un lugar seguro.`);
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo exportar el respaldo.");
    }
  };

  const handleBackupFile = async (file: File) => {
    setUsersErrorMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as { users?: unknown[] } | unknown[];
      const usersArr = Array.isArray(parsed) ? parsed : parsed?.users;
      if (!Array.isArray(usersArr) || usersArr.length === 0) {
        throw new Error("El archivo no contiene un respaldo de usuarios válido.");
      }
      setPendingRestore({ users: usersArr, fileName: file.name });
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo leer el respaldo.");
    }
  };

  const confirmRestore = async () => {
    if (!authToken || !pendingRestore) return;
    setIsUsersLoading(true); setUsersErrorMessage(null);
    try {
      const result = await restoreUsersBackup(apiBaseUrl, authToken, pendingRestore.users);
      setPendingRestore(null);
      setUsersStatusMessage(`Respaldo restaurado: ${result.restored ?? pendingRestore.users.length} usuarios.`);
      await loadUsers();
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo restaurar el respaldo.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  // ── Métricas y filtros ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = managedUsers.length;
    const activos = managedUsers.filter((u) => u.status === "active").length;
    const vencidos = managedUsers.filter((u) => isExpired(u)).length;
    const porVencer = managedUsers.filter((u) => u.status === "active" && isExpiringSoon(u)).length;
    const generaciones = managedUsers.reduce((acc, u) => acc + (u.generationsCount ?? 0), 0);
    const usosRestantes = managedUsers.reduce((acc, u) => acc + (u.formsUsesLeft ?? 0), 0);
    const usosConsumidos = managedUsers.reduce((acc, u) => acc + (u.formsUsesUsed ?? 0), 0);
    return { total, activos, vencidos, porVencer, generaciones, usosRestantes, usosConsumidos };
  }, [managedUsers]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return managedUsers.filter((u) => {
      if (term && !u.email.toLowerCase().includes(term)) return false;
      if (roleFilter !== "todos" && u.role !== roleFilter) return false;
      if (statusFilter === "activos" && (u.status !== "active" || isExpired(u))) return false;
      if (statusFilter === "por_vencer" && !(u.status === "active" && isExpiringSoon(u))) return false;
      if (statusFilter === "desactivados" && u.status !== "disabled") return false;
      if (statusFilter === "vencidos" && !isExpired(u)) return false;
      return true;
    });
  }, [managedUsers, searchTerm, statusFilter, roleFilter]);

  const statusFilters: { id: StatusFilter; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "activos", label: "Activos" },
    { id: "por_vencer", label: "Por vencer" },
    { id: "vencidos", label: "Vencidos" },
    { id: "desactivados", label: "Desactivados" },
  ];
  const roleFilters: { id: RoleFilter; label: string }[] = [
    { id: "todos", label: "Todos los roles" },
    { id: "user", label: "Usuarios" },
    { id: "admin", label: "Admins" },
  ];

  const isSelf = selectedUser?.id === authUser.id;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Gestión de usuarios</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tabulación va por suscripción (días); Forms va por usos (1 uso = 1 corrida de llenado).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportBackup} disabled={isUsersLoading} title="Descarga users.json (cuentas, claves y usos)">
            <Download className="h-3.5 w-3.5" />
            Exportar respaldo
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUsersLoading}>
            <Upload className="h-3.5 w-3.5" />
            Importar
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleBackupFile(file);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" onClick={loadUsers} disabled={isUsersLoading}>
            {isUsersLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Actualizar
          </Button>
        </div>
      </div>

      {/* Confirmación de restauración (reemplaza todo el almacén) */}
      {pendingRestore && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="flex-1 text-amber-700 dark:text-amber-300">
            Restaurar <strong>{pendingRestore.fileName}</strong> reemplazará los {stats.total} usuarios actuales
            por {pendingRestore.users.length} del respaldo. Esta acción no se puede deshacer.
          </span>
          <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300" onClick={confirmRestore} disabled={isUsersLoading}>
            Sí, restaurar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingRestore(null)}>Cancelar</Button>
        </div>
      )}

      {/* Métricas globales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Usuarios activos"
          value={`${stats.activos}/${stats.total}`}
          detail="cuentas habilitadas"
        />
        <StatCard
          icon={<Clock3 className="h-3.5 w-3.5" />}
          label="Suscripciones"
          value={String(stats.vencidos)}
          detail={`vencidas · ${stats.porVencer} por vencer (≤7 días)`}
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
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border/70 bg-background/60 p-0.5">
          {statusFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={cn(
                "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-200",
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
                "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-200",
                roleFilter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla de usuarios */}
      {!hasLoaded && isUsersLoading && (
        <div className="animate-pulse space-y-2 rounded-xl border border-border/60 bg-background/60 p-4">
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-5/6 rounded bg-muted/70" />
          <div className="h-4 w-4/6 rounded bg-muted/60" />
        </div>
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

      {filteredUsers.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/60">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Usuario</th>
                <th className="px-3 py-2.5 font-medium">Suscripción</th>
                <th className="px-3 py-2.5 text-right font-medium">Usos Forms</th>
                <th className="px-3 py-2.5 text-right font-medium">Excel</th>
                <th className="px-3 py-2.5 font-medium">Último acceso</th>
                <th className="w-8 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => setSelectedId(user.id)}
                  className={cn(
                    "cursor-pointer border-b border-border/40 transition-colors duration-150 last:border-b-0",
                    selectedId === user.id ? "bg-primary/5" : "hover:bg-accent/50",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{user.email}</span>
                      {user.id === authUser.id && <span className="text-xs text-muted-foreground">(tú)</span>}
                      <span className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        user.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}>
                        {user.role === "admin" ? "Admin" : user.plan}
                      </span>
                      <StatusChip user={user} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{getSubscriptionLabel(user)}</td>
                  <td className="px-3 py-3 text-right text-sm tabular-nums">
                    <span className="font-semibold">{usesLabel(user)}</span>
                    <span className="text-xs text-muted-foreground"> · {user.formsUsesUsed ?? 0} usados</span>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{user.generationsCount ?? 0}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{formatDateTime(user.lastLoginAt)}</td>
                  <td className="px-2 py-3 text-muted-foreground"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel lateral de gestión */}
      {selectedUser && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setSelectedId(null)}
          />
          <aside className="step-enter fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border/70 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selectedUser.email}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    selectedUser.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}>
                    {selectedUser.role === "admin" ? "Admin" : `Plan ${selectedUser.plan}`}
                  </span>
                  <StatusChip user={selectedUser} />
                  {isSelf && <span className="text-[10px] text-muted-foreground">(tu cuenta)</span>}
                </div>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Cerrar panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              {/* Resumen */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ["Suscripción", getSubscriptionLabel(selectedUser)],
                  ["Último acceso", formatDateTime(selectedUser.lastLoginAt)],
                  ["Último Excel", selectedUser.lastGenerationAt ? formatDateTime(selectedUser.lastGenerationAt) : "Nunca"],
                  ["Clave API", selectedUser.hasApiKey ? `Activa ···${selectedUser.apiKeyLast4}` : "Sin clave"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{k}</p>
                    <p className="mt-0.5 truncate font-medium text-foreground">{v}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2.5">
                  <p className="text-xl font-semibold tabular-nums">{selectedUser.generationsCount ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">Excel generados</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2.5">
                  <p className="text-xl font-semibold tabular-nums">{usesLabel(selectedUser)}</p>
                  <p className="text-[11px] text-muted-foreground">usos de Forms · {selectedUser.formsUsesUsed ?? 0} consumidos</p>
                </div>
              </div>

              {/* Recargas */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recargas</p>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-9 w-20 text-sm tabular-nums"
                    value={customDays}
                    onChange={(e) => setCustomDays(e.target.value)}
                    placeholder="30"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      const days = Number.parseInt(customDays, 10);
                      if (!Number.isFinite(days) || days <= 0) { setUsersErrorMessage("Los días deben ser un número mayor a 0."); return; }
                      void patchManagedUser(selectedUser.id, { subscriptionDaysDelta: days }, `+${days} días para ${selectedUser.email}.`);
                    }}
                    disabled={isUsersLoading}
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                    Añadir días (Tabulación)
                  </Button>
                </div>
                {selectedUser.role !== "admin" && (
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-9 w-20 text-sm tabular-nums"
                      value={customUses}
                      onChange={(e) => setCustomUses(e.target.value)}
                      placeholder="10"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        const uses = Number.parseInt(customUses, 10);
                        if (!Number.isFinite(uses) || uses === 0) { setUsersErrorMessage("Los usos deben ser un número distinto de 0."); return; }
                        void patchManagedUser(selectedUser.id, { formsUsesDelta: uses }, `${uses > 0 ? "+" : ""}${uses} usos de Forms para ${selectedUser.email}.`);
                      }}
                      disabled={isUsersLoading}
                    >
                      <Ticket className="h-3.5 w-3.5" />
                      Añadir usos (Forms)
                    </Button>
                  </div>
                )}
              </div>

              {/* Cuenta */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cuenta</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">Rol</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={selectedUser.role}
                      disabled={isUsersLoading || isSelf}
                      title={isSelf ? "No puedes cambiar tu propio rol" : undefined}
                      onChange={(e) => void patchManagedUser(selectedUser.id, { role: e.target.value }, `Rol actualizado para ${selectedUser.email}.`)}
                    >
                      <option value="user">Usuario</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">Plan</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={selectedUser.plan}
                      disabled={isUsersLoading}
                      onChange={(e) => void patchManagedUser(selectedUser.id, { plan: e.target.value }, `Plan actualizado para ${selectedUser.email}.`)}
                    >
                      <option value="pro">Pro</option>
                      <option value="business">Business</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </label>
                </div>
                <div className="flex items-end gap-2">
                  <label className="block flex-1 space-y-1">
                    <span className="text-[11px] text-muted-foreground">Nueva contraseña (mínimo 8 caracteres)</span>
                    <Input
                      type="password"
                      className="h-9"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isUsersLoading || resetPassword.length < 8}
                    onClick={() => {
                      void patchManagedUser(selectedUser.id, { password: resetPassword }, `Contraseña restablecida para ${selectedUser.email}.`);
                      setResetPassword("");
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Restablecer
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patchManagedUser(selectedUser.id, { status: selectedUser.status === "active" ? "disabled" : "active" }, `Estado actualizado para ${selectedUser.email}.`)}
                    disabled={isUsersLoading || isSelf}
                    title={isSelf ? "No puedes modificar tu propio estado" : undefined}
                  >
                    {selectedUser.status === "active" ? "Desactivar cuenta" : "Activar cuenta"}
                  </Button>
                  {selectedUser.hasApiKey && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void revokeManagedApiKey(selectedUser)}
                      disabled={isUsersLoading}
                      title="Su extensión Tutorica Forms dejará de validar"
                    >
                      Revocar clave API
                    </Button>
                  )}
                  {confirmDeleteId === selectedUser.id ? (
                    <div className="flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                      <span className="text-xs text-danger">¿Eliminar?</span>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-danger hover:bg-danger/20" onClick={() => void deleteManagedUser(selectedUser.id)} disabled={isUsersLoading}>Sí</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>No</Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-danger hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
                      onClick={() => setConfirmDeleteId(selectedUser.id)}
                      disabled={isUsersLoading || isSelf}
                      title={isSelf ? "No puedes eliminar tu propia cuenta" : undefined}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar
                    </Button>
                  )}
                </div>
              </div>

              {/* Historial */}
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  Actividad reciente
                </p>
                {(selectedUser.activity ?? []).length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    Sin actividad registrada todavía.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {(selectedUser.activity ?? []).map((event, i) => (
                      <li key={`${event.at}-${i}`} className="flex items-baseline gap-2 text-xs">
                        <span className="shrink-0 text-muted-foreground tabular-nums">{formatDateTime(event.at)}</span>
                        <span className="text-foreground">{event.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
