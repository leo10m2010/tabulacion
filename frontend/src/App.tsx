import { Suspense, lazy, useEffect, useState } from "react";
import {
  ChevronRight,
  FileSpreadsheet,
  FolderOpen,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Moon,
  Sparkles,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { useRef } from "react";
import { useCallback } from "react";
import type { ReactNode } from "react";
import { cn } from "./lib/utils";


// Modulos extraidos de este archivo (ver lib/ y components/).
import type {
  AppIntent as AuthIntent,
  AppSection,
  PasoTesis,
  Proyecto,
  AppView,
  AuthUser,
  ThemeMode,
} from "./lib/types";
import * as api from "./lib/api";
import { DEFAULT_API_BASE_URL } from "./lib/constants";
import { NAV_GROUPS, NAV_TOOLS } from "./lib/nav";
import {
  resolveViewFromPath,
} from "./lib/helpers";
import { borrarTodosLosBorradores } from "./lib/wizard-draft";
import { activeProjectStorageKey, clearSensitiveSessionStorage } from "./lib/session-storage";
import { getFormsBalance } from "./lib/usage";
// La landing y el acceso van en el bundle inicial: son la primera pantalla y
// cargarlas aparte añadiría un viaje de red justo en la ruta crítica.
import { LoginScreen } from "./components/LoginScreen";
import { LandingPage } from "./components/LandingPage";

// Las secciones de la app, en cambio, se cargan bajo demanda. Antes las once
// viajaban en el chunk inicial, así que quien solo abría la landing descargaba
// igualmente el asistente de tabulación, el panel de administración y las
// cuatro herramientas de IA. Cada una es su propio chunk y solo llega cuando el
// usuario entra en ella.
// Se escriben una a una a propósito: un helper genérico obliga a ensanchar los
// tipos de las props y perderíamos el chequeo de cada sección.
const AccountSection = lazy(() =>
  import("./components/sections/AccountSection").then((m) => ({ default: m.AccountSection })));
const CronbachSection = lazy(() =>
  import("./components/sections/CronbachSection").then((m) => ({ default: m.CronbachSection })));
const DescriptivaSection = lazy(() =>
  import("./components/sections/DescriptivaSection").then((m) => ({ default: m.DescriptivaSection })));
const FormsSection = lazy(() =>
  import("./components/sections/FormsSection").then((m) => ({ default: m.FormsSection })));
const TitulosSection = lazy(() =>
  import("./components/sections/TitulosSection").then((m) => ({ default: m.TitulosSection })));
const MatrizSection = lazy(() =>
  import("./components/sections/MatrizSection").then((m) => ({ default: m.MatrizSection })));
const HumanizadorSection = lazy(() =>
  import("./components/sections/HumanizadorSection").then((m) => ({ default: m.HumanizadorSection })));
const UsersSection = lazy(() =>
  import("./components/sections/UsersSection").then((m) => ({ default: m.UsersSection })));
const HomeSection = lazy(() =>
  import("./components/sections/HomeSection").then((m) => ({ default: m.HomeSection })));
const TabulacionSection = lazy(() =>
  import("./components/sections/TabulacionSection").then((m) => ({ default: m.TabulacionSection })));
const PlanesSection = lazy(() =>
  import("./components/sections/PlanesSection").then((m) => ({ default: m.PlanesSection })));
const ProyectosSection = lazy(() =>
  import("./components/sections/ProyectosSection").then((m) => ({ default: m.ProyectosSection })));


// Esqueleto que ocupa el sitio de una sección mientras llega su chunk. Imita la
// forma real (título, subtítulo, tarjetas) en vez de centrar un spinner: así la
// página no da un salto cuando el contenido aparece.
function SectionSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-7 w-64 max-w-full rounded-lg bg-muted" />
        <div className="h-4 w-96 max-w-full rounded bg-muted/70" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-36 rounded-2xl border border-border/60 bg-muted/50" />
        <div className="h-36 rounded-2xl border border-border/60 bg-muted/50" />
      </div>
      <div className="h-56 rounded-2xl border border-border/60 bg-muted/40" />
    </div>
  );
}

function PersistentSection({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <section hidden={!active} aria-hidden={!active}>
      {children}
    </section>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [appView, setAppView] = useState<AppView>(() => resolveViewFromPath());
  const [activeSection, setActiveSection] = useState<AppSection>("inicio");
  // Una herramienta ya visitada permanece montada aunque se navegue a otra
  // sección. Así sus trabajos siguen avanzando y el resultado no desaparece.
  const [mountedSections, setMountedSections] = useState<Set<AppSection>>(
    () => new Set(["inicio"]),
  );

  // El override por localStorage es una comodidad de desarrollo; en produccion
  // manda siempre VITE_API_BASE_URL (un valor viejo guardado romperia la app).
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(() =>
    (import.meta.env.DEV ? localStorage.getItem("apiBaseUrl") : null) || DEFAULT_API_BASE_URL);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("themeMode");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });


  // Configuración pública del servidor (métodos de acceso y planes). Se pide
  // antes de iniciar sesión. El registro público solo se ofrece con Google;
  // el formulario de contraseña queda como acceso para cuentas manuales.
  const [googleClientId, setGoogleClientId] = useState<string>("");
  // A qué vino el usuario. La pantalla de acceso es la misma para entrar y para
  // crear cuenta (con Google son la misma acción), pero el énfasis cambia: sin
  // esto, quien pulsa "Avanzar mi tesis" en la landing aterriza en algo que
  // parece solo un login y no sabe que ahí mismo se crea la cuenta.
  const [authIntent, setAuthIntent] = useState<AuthIntent>(
    // Si este navegador ya inició sesión alguna vez, es alguien que vuelve.
    () => (localStorage.getItem("loginEmail") ? "login" : "registro"),
  );
  // Cuotas reales del plan gratuito, servidas por /config. Se muestran en la
  // pantalla de acceso como motivo para crear la cuenta; al venir del backend
  // no se desincronizan si cambian los presets.
  const [freePlan, setFreePlan] = useState<Record<string, number> | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [formsTopupsEnabled, setFormsTopupsEnabled] = useState(false);
  const [publicConfigStatus, setPublicConfigStatus] = useState<"loading" | "ready" | "error">("loading");
  const [publicConfigRefreshKey, setPublicConfigRefreshKey] = useState(0);
  // Mensaje de bienvenida tras crear la cuenta con Google. Sin esto, alguien
  // que acaba de entrar ve herramientas bloqueadas y cree que está roto.
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  // Desde qué herramienta llegó a "Mejorar mi plan". Es la razón real por la
  // que escribe, así que viaja hasta el mensaje de WhatsApp.
  const [planDesde, setPlanDesde] = useState<string | null>(null);

  // Proyecto activo: el que usarán las herramientas cuando lean el instrumento.
  // Se recuerda entre visitas para no obligar a elegirlo cada vez.
  const [proyectoActivo, setProyectoActivo] = useState<Proyecto | null>(null);
  const [proyectoActivoId, setProyectoActivoId] = useState<string | null>(null);

  // Cuántas tesis tiene en total. El inicio lo necesita para saber si ofrecer
  // "cambiar de tesis" o "crear la primera".
  const [proyectosTotal, setProyectosTotal] = useState(0);

  const seleccionarProyecto = (p: Proyecto | null) => {
    setProyectoActivo(p);
    setProyectoActivoId(p?.id ?? null);
    if (!authUser) return;
    const key = activeProjectStorageKey(authUser.id);
    if (p) localStorage.setItem(key, p.id);
    else localStorage.removeItem(key);
  };

  // Marca un paso de la ruta como hecho en el proyecto activo.
  //
  // Es deliberadamente silencioso: si falla, el usuario ya tiene su Excel o su
  // documento y lo único que se pierde es un tilde en la lista. Interrumpirlo
  // con un error por eso sería peor que el problema.
  const marcarPasoActivo = (paso: PasoTesis) => {
    if (!proyectoActivoId || !authToken) return;
    api.marcarPaso(apiBaseUrl, authToken, proyectoActivoId, paso)
      .then((r) => setProyectoActivo(r.proyecto))
      .catch(() => {});
  };

  const irAPlanes = (desdeHerramienta?: string) => {
    setPlanDesde(desdeHerramienta ?? null);
    setActiveSection("planes");
  };

  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem("authToken") ?? "");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(() => Boolean(localStorage.getItem("authToken")));
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRefreshKey, setAuthRefreshKey] = useState(0);
  const authUserRef = useRef<AuthUser | null>(null);
  authUserRef.current = authUser;

  const resetWorkspaceState = useCallback(() => {
    clearSensitiveSessionStorage();
    borrarTodosLosBorradores();
    setProyectoActivo(null);
    setProyectoActivoId(null);
    setProyectosTotal(0);
    setPlanDesde(null);
    setWelcomeMessage(null);
    setMountedSections(new Set(["inicio"]));
    setActiveSection("inicio");
  }, []);

  const olvidarSesion = useCallback(() => {
    resetWorkspaceState();
    setAuthToken("");
    setAuthUser(null);
  }, [resetWorkspaceState]);

  const isAdmin = authUser?.role === "admin";
  const authUserId = authUser?.id;
  // Una herramienta está bloqueada si al usuario no le quedan usos. Se sigue
  // mostrando (con candado) en vez de esconderla: enseñar lo que hay detrás del
  // plan de pago es justo lo que convierte, y esconderlo haría que el producto
  // pareciera más pobre de lo que es. Los admins tienen usos ilimitados.
  const isToolLocked = (id: AppSection) => {
    if (isAdmin || !authUser) return false;
    if (id === "forms") return (getFormsBalance(authUser).available ?? Number.POSITIVE_INFINITY) <= 0;
    const usos = authUser.uses;
    if (!usos || !(id in usos)) return false;
    return (usos[id as keyof typeof usos] ?? 0) <= 0;
  };
  // Diseño de investigación elegido: correlacional (histórico) o
  // cuasiexperimental (pretest-postest con grupo experimental y control).
  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => { if (import.meta.env.DEV) localStorage.setItem("apiBaseUrl", apiBaseUrl); }, [apiBaseUrl]);
  useEffect(() => {
    if (authToken) localStorage.setItem("authToken", authToken);
    else localStorage.removeItem("authToken");
  }, [authToken]);

  // Sesión rechazada por el servidor (expiró, cambió la contraseña o se borró
  // la cuenta). Antes solo lo detectaba /generate, comparando si el mensaje
  // contenía la palabra "token": en el resto de la app la sesión moría en
  // silencio y todo fallaba sin explicar por qué.
  useEffect(() => {
    api.setUnauthorizedHandler((mensaje) => {
      olvidarSesion();
      setAuthError(mensaje);
    });
    return () => api.setUnauthorizedHandler(null);
  }, [olvidarSesion]);

  // El proyecto recordado pertenece a una cuenta concreta. La clave histórica
  // global permitía que otra cuenta intentara cargarlo durante unos instantes.
  useEffect(() => {
    if (!authUserId) return;
    setProyectoActivo(null);
    setProyectoActivoId(localStorage.getItem(activeProjectStorageKey(authUserId)));
  }, [authUserId]);

  useEffect(() => {
    if (!authUserId) return;
    setMountedSections((current) => {
      if (current.has(activeSection)) return current;
      const next = new Set(current);
      next.add(activeSection);
      return next;
    });
  }, [activeSection, authUserId]);

  // Token ya vencido al abrir la app: se descarta aquí en vez de dejar que
  // falle la primera petición y el usuario vea un error técnico.
  useEffect(() => {
    const expira = localStorage.getItem("authExpiresAt");
    if (!expira) return;
    const ts = Date.parse(expira);
    if (Number.isFinite(ts) && ts <= Date.now()) {
      olvidarSesion();
      setAuthError("Tu sesión expiró. Vuelve a iniciar sesión para continuar.");
    }
  }, [olvidarSesion]);

  // Recupera el proyecto activo recordado. Si ya no existe (lo borró), se
  // olvida en silencio en vez de dejar la app apuntando a la nada.
  useEffect(() => {
    if (!authToken || !authUserId || !proyectoActivoId) return;
    let isMounted = true;
    api.obtenerProyecto(apiBaseUrl, authToken, proyectoActivoId)
      .then((r) => { if (isMounted) setProyectoActivo(r.proyecto); })
      .catch((err) => {
        if (!isMounted) return;
        // Solo un 404 demuestra que el proyecto dejó de existir. Una caída
        // temporal conserva la selección para reintentar después.
        if (err instanceof api.ApiError && err.status === 404) {
          setProyectoActivo(null);
          setProyectoActivoId(null);
          localStorage.removeItem(activeProjectStorageKey(authUserId));
        }
      });
    return () => { isMounted = false; };
  }, [apiBaseUrl, authToken, authUserId, proyectoActivoId]);

  // Cuántas tesis hay. Se relee al volver al inicio o a la lista, que es cuando
  // el dato se usa y cuando pudo cambiar.
  useEffect(() => {
    if (!authToken || !authUserId) return;
    if (activeSection !== "inicio" && activeSection !== "proyectos") return;
    let isMounted = true;
    api.listarProyectos(apiBaseUrl, authToken)
      .then((r) => { if (isMounted) setProyectosTotal(r.proyectos.length); })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [apiBaseUrl, authToken, authUserId, activeSection]);

  // Despierta la API apenas se abre la app: si el hosting suspende el servidor
  // por inactividad (arranque en frío), el login y la generación lo encuentran
  // ya caliente.
  useEffect(() => { api.pingHealth(apiBaseUrl); }, [apiBaseUrl]);

  // Métodos de acceso disponibles. Si /config no responde no se inventa un
  // registro alternativo por correo: solo queda el acceso manual existente.
  useEffect(() => {
    let isMounted = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    setPublicConfigStatus("loading");

    const wait = (milliseconds: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, milliseconds);
      timers.add(timer);
    });

    const load = async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const cfg = await api.fetchPublicConfig(apiBaseUrl);
          if (!isMounted) return;
          setGoogleClientId(cfg.auth?.google?.enabled ? (cfg.auth.google.clientId ?? "") : "");
          setFreePlan(cfg.planes?.[cfg.planPredeterminado] ?? null);
          setPaymentsEnabled(Boolean(cfg.capabilities?.taypiPayments));
          setFormsTopupsEnabled(Boolean(cfg.capabilities?.formsTopups));
          setPublicConfigStatus("ready");
          return;
        } catch {
          if (!isMounted) return;
          if (attempt < 3) await wait(750 * (2 ** attempt));
        }
      }
      if (isMounted) setPublicConfigStatus("error");
    };

    void load();
    return () => {
      isMounted = false;
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [apiBaseUrl, publicConfigRefreshKey]);

  useEffect(() => {
    const onPop = () => setAppView(resolveViewFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    localStorage.setItem("themeMode", themeMode);
    document.documentElement.classList.toggle("dark", themeMode === "dark");
  }, [themeMode]);




  useEffect(() => {
    if (!authToken) { setAuthLoading(false); setAuthUser(null); return; }
    let isMounted = true;
    const isInitialValidation = !authUserRef.current;
    if (isInitialValidation) setAuthLoading(true);
    api.fetchMe(apiBaseUrl, authToken)
      .then((payload) => {
        if (!payload.user) throw new Error("Sesión inválida.");
        if (!isMounted) return;
        setAuthUser(payload.user);
        setAuthError(null);
      })
      .catch((err) => {
        if (!isMounted) return;
        // Un 401 ya pasó por el handler central. Una caída de red o un 5xx no
        // invalida credenciales ni borra el trabajo de la cuenta.
        if (err instanceof api.ApiError && err.status === 401) return;
        setAuthError("No pudimos conectar con el servidor. Tu sesión y tu trabajo siguen guardados; reintentaremos automáticamente.");
      })
      .finally(() => { if (isMounted && isInitialValidation) setAuthLoading(false); });
    return () => { isMounted = false; };
  }, [apiBaseUrl, authToken, authRefreshKey]);

  // Mantiene cuotas y estado frescos sin bloquear la interfaz. Recuperar el
  // foco o la conexión fuerza una lectura inmediata.
  useEffect(() => {
    if (!authToken) return;
    const refresh = () => setAuthRefreshKey((value) => value + 1);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [authToken]);


  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleLogin = async (emailRaw: string, password: string) => {
    setAuthError(null);
    const email = emailRaw.trim();
    if (!email || !password) { setAuthError("Completa email y contraseña."); return; }
    setAuthLoading(true);
    try {
      const payload = await api.login(apiBaseUrl, email, password);
      if (!payload.token || !payload.user) throw new Error(payload.error ?? "Respuesta inválida del servidor.");
      resetWorkspaceState();
      setAuthToken(payload.token);
      setAuthUser(payload.user);
      recordarSesion(email, payload.tokenExpiresAt);
    } catch (err) {
      setAuthToken(""); setAuthUser(null);
      setAuthError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Google: entrar y registrarse son la misma acción. El backend devuelve
  // `creado` para saber si acaba de nacer la cuenta y darle la bienvenida.
  const handleGoogleCredential = async (credential: string) => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const payload = await api.loginWithGoogle(apiBaseUrl, credential);
      if (!payload.token || !payload.user) throw new Error("Respuesta inválida del servidor.");
      resetWorkspaceState();
      setAuthToken(payload.token);
      setAuthUser(payload.user);
      recordarSesion(payload.user.email, payload.tokenExpiresAt);
      if (payload.creado) {
        const usos = payload.user.uses ?? null;
        const incluidas = usos
          ? NAV_TOOLS.filter((t) => (
            t.id === "forms"
              ? (getFormsBalance(payload.user!).available ?? Number.POSITIVE_INFINITY) > 0
              : (usos[t.id as keyof typeof usos] ?? 0) > 0
          )).map((t) => t.label)
          : [];
        setWelcomeMessage(
          incluidas.length > 0
            ? `¡Bienvenido! Tu cuenta gratuita ya está lista. Puedes usar ${incluidas.join(", ")}. `
              + "El resto de herramientas se desbloquean al mejorar tu plan."
            : "¡Bienvenido! Tu cuenta ya está lista.",
        );
        setActiveSection("inicio");
      }
    } catch (err) {
      setAuthToken(""); setAuthUser(null);
      setAuthError(err instanceof Error ? err.message : "No se pudo entrar con Google.");
    } finally {
      setAuthLoading(false);
    }
  };

  // La cuenta ya no existe: se cierra la sesión y se vuelve al login con el
  // mensaje de confirmación, en vez de dejar al usuario en una app cuyo token
  // acaba de dejar de valer.
  const handleAccountDeleted = (mensaje: string) => {
    olvidarSesion();
    // La cuenta ya no existe: no tiene sentido recordar su correo ni saludar
    // como a alguien que vuelve.
    localStorage.removeItem("loginEmail");
    setAuthIntent("registro");
    setActiveSection("inicio");
    setWelcomeMessage(null);
    setAuthError(mensaje);
  };

  const recordarSesion = (email: string, expiraEn?: string) => {
    localStorage.setItem("loginEmail", email);
    if (expiraEn) localStorage.setItem("authExpiresAt", expiraEn);
    setAuthIntent("login");
  };

  const handleLogout = () => {
    const tokenToRevoke = authToken;
    olvidarSesion();
    setAuthError(null);
    setActiveSection("inicio");
    if (tokenToRevoke) void api.logout(apiBaseUrl, tokenToRevoke).catch(() => undefined);
  };


  const toggleTheme = () => setThemeMode((cur) => (cur === "dark" ? "light" : "dark"));
  const goToApp = (intent: AuthIntent = "registro") => {
    setAuthIntent(localStorage.getItem("loginEmail") ? "login" : intent);
    window.history.pushState({}, "", "/app");
    setAppView("app");
  };
  const goToLanding = () => { window.history.pushState({}, "", "/"); setAppView("landing"); };

  // ── Render: Landing ────────────────────────────────────────────────────────
  if (appView === "landing") {
    return (
      <div className="min-h-[100dvh] bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)/0.55)_0%,hsl(var(--background))_55%)] pb-10 transition-colors">
        <LandingPage themeMode={themeMode} onToggleTheme={toggleTheme} onOpenApp={goToApp} />
      </div>
    );
  }

  // ── Render: Login ──────────────────────────────────────────────────────────
  if (!authUser && !authLoading) {
    return (
      <LoginScreen
        apiBaseUrl={apiBaseUrl}
        onApiBaseUrlChange={setApiBaseUrl}
        themeMode={themeMode}
        onToggleTheme={toggleTheme}
        onBackToLanding={goToLanding}
        authError={authError}
        authLoading={authLoading}
        onLogin={handleLogin}
        googleClientId={googleClientId}
        onGoogleCredential={handleGoogleCredential}
        onAuthErrorChange={setAuthError}
        intent={authIntent}
        onIntentChange={setAuthIntent}
        freePlan={freePlan}
        publicConfigStatus={publicConfigStatus}
        onRetryPublicConfig={() => setPublicConfigRefreshKey((value) => value + 1)}
        hasPendingSession={Boolean(authToken)}
        onRetrySession={() => setAuthRefreshKey((value) => value + 1)}
      />
    );
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Render: App (authenticated) ────────────────────────────────────────────
  return (
    <div className="flex min-h-[100dvh] bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)/0.45)_0%,hsl(var(--background))_55%)] transition-colors">

      {/* ── Sidebar: panel de vidrio flotante ── */}
      <aside className="sticky top-0 hidden h-screen shrink-0 p-3 md:block">
        <div className="flex h-full w-60 flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/70 shadow-soft backdrop-blur-xl">
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border/60 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <span className="font-display font-bold tracking-tight">TesisHub</span>
        </div>

        {/* Nav items */}
        {/* El menú no cabe entero en pantallas bajas: se desplaza, con una barra
            fina del color del tema (ver .scroll-discreto en index.css). */}
        <nav aria-label="Herramientas" className="scroll-discreto flex-1 space-y-1 overflow-y-auto p-3">
          <button
            onClick={() => setActiveSection("inicio")}
            aria-current={activeSection === "inicio" ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-full px-3.5 py-2.5 text-sm font-medium transition-all active:scale-[0.99]",
              activeSection === "inicio"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            Inicio
            {activeSection === "inicio" && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
          </button>

          <button
            onClick={() => setActiveSection("proyectos")}
            aria-current={activeSection === "proyectos" ? "page" : undefined}
            className={cn(
              "mt-1 flex w-full items-center gap-2.5 rounded-full px-3.5 py-2.5 text-sm font-medium transition-all active:scale-[0.99]",
              activeSection === "proyectos"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            {/* La etiqueta no cambia: si el botón se llamara como el proyecto,
                dejaría de leerse como el sitio al que se va. El proyecto activo
                va debajo, que es información distinta. */}
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate">Mis proyectos</span>
              {proyectoActivo && (
                <span className={cn(
                  "block truncate text-[11px] font-normal",
                  activeSection === "proyectos" ? "text-primary-foreground/80" : "text-muted-foreground",
                )}>
                  {proyectoActivo.nombre}
                </span>
              )}
            </span>
            {activeSection === "proyectos" && <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />}
          </button>

          {NAV_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="mb-2 mt-5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</p>
              {group.tools.map((item) => {
                const locked = isToolLocked(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    // Sin aria-current, un lector de pantalla lee once botones
                    // idénticos y no dice en cuál estás. El color solo lo
                    // comunica a quien ve la pantalla.
                    aria-current={activeSection === item.id ? "page" : undefined}
                    title={locked ? "Sin usos disponibles — pide una recarga" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-full px-3.5 py-2.5 text-left text-sm font-medium leading-tight transition-all",
                      activeSection === item.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : locked
                          ? "text-muted-foreground/60 hover:bg-accent/60 hover:text-muted-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                    {/* El candado no impide entrar: la sección explica qué
                        incluye y cómo desbloquearla. Bloquear el clic dejaría
                        al usuario sin saber qué se está perdiendo. */}
                    {locked && activeSection !== item.id && <Lock className="ml-auto h-3 w-3 shrink-0" />}
                    {activeSection === item.id && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Solo para quien tiene cuota limitada: un admin no compra planes. */}
          {!isAdmin && (
            <button
              onClick={() => irAPlanes()}
              className={cn(
                "mt-5 flex w-full items-center gap-2.5 rounded-full px-3.5 py-2.5 text-sm font-medium transition-all",
                activeSection === "planes"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-primary hover:bg-primary/10",
              )}
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              Mejorar mi plan
              {activeSection === "planes" && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
            </button>
          )}

          {isAdmin && (
            <>
              <p className="mb-2 mt-5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Administración</p>
              <button
                onClick={() => setActiveSection("usuarios")}
                aria-current={activeSection === "usuarios" ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-full px-3.5 py-2.5 text-sm font-medium transition-all active:scale-[0.99]",
                  activeSection === "usuarios"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Users className="h-4 w-4 shrink-0" />
                Usuarios
                {activeSection === "usuarios" && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </nav>

        {/* Bottom: user + theme + API config */}
        <div className="border-t border-border/60 p-3 space-y-1">
          <button
            onClick={toggleTheme}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all"
          >
            {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {themeMode === "dark" ? "Modo claro" : "Modo oscuro"}
          </button>
          <button
            onClick={() => setActiveSection("cuenta")}
            className={cn(
              "w-full rounded-xl border px-3 py-2 text-left transition-all",
              activeSection === "cuenta"
                ? "border-primary/50 bg-primary/10"
                : "border-border/60 bg-background/60 hover:border-primary/40 hover:bg-accent",
            )}
            title="Mi cuenta"
          >
            <p className="truncate text-xs font-medium text-foreground">{authUser?.email}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{authUser?.role} · Mi cuenta</p>
          </button>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-danger/10 hover:text-danger transition-all"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Mobile topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-card/80 px-4 backdrop-blur-xl md:hidden">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <span className="font-bold">TesisHub</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} aria-label="Cambiar tema" className="min-h-11 min-w-11 rounded-lg p-2 text-muted-foreground hover:bg-accent">
              {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={handleLogout} aria-label="Cerrar sesión" className="min-h-11 min-w-11 rounded-lg p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Mobile nav tabs */}
        <nav aria-label="Herramientas" className="sticky top-14 z-20 flex gap-1.5 overflow-x-auto border-b border-border/60 bg-card/80 px-3 py-2 backdrop-blur-xl md:hidden">
          {[
            { id: "inicio" as AppSection, label: "Inicio", icon: LayoutDashboard },
            { id: "proyectos" as AppSection, label: "Mis tesis", icon: FolderOpen },
            ...NAV_TOOLS,
            ...(isAdmin ? [{ id: "usuarios" as AppSection, label: "Usuarios", icon: Users }] : []),
            ...(!isAdmin ? [{ id: "planes" as AppSection, label: "Planes", icon: Sparkles }] : []),
            { id: "cuenta" as AppSection, label: "Cuenta", icon: UserRound },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              aria-current={activeSection === item.id ? "page" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all active:scale-95",
                activeSection === item.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {"mobileLabel" in item && item.mobileLabel ? item.mobileLabel : item.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-auto px-4 py-6 md:px-10 md:py-9">
          {authError && authUser && (
            <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              <span className="flex-1">{authError}</span>
              <button
                type="button"
                onClick={() => setAuthRefreshKey((value) => value + 1)}
                className="min-h-11 rounded-lg px-3 font-medium hover:bg-amber-500/10"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Bienvenida tras crear la cuenta: dice qué herramientas incluye el
              plan gratuito, para que las bloqueadas no parezcan un error. */}
          {welcomeMessage && (
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="flex-1 text-sm text-foreground">{welcomeMessage}</p>
              <button
                onClick={() => setWelcomeMessage(null)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Cerrar mensaje de bienvenida"
              >
                Entendido
              </button>
            </div>
          )}

          {/* Cada sección es un chunk aparte: mientras llega se muestra un
              esqueleto con la forma del contenido, no una pantalla en blanco.
              El aviso en vivo hace que el cambio de sección también exista para
              quien navega con lector de pantalla. */}
          <Suspense key={authUser?.id ?? "session"} fallback={<SectionSkeleton />}>

          {(activeSection === "proyectos" || mountedSections.has("proyectos")) && authUser && (
            <PersistentSection active={activeSection === "proyectos"}>
              <ProyectosSection
              apiBaseUrl={apiBaseUrl}
              authToken={authToken}
              authUser={authUser}
              proyectoActivoId={proyectoActivoId}
              onSeleccionar={seleccionarProyecto}
              />
            </PersistentSection>
          )}

          {(activeSection === "planes" || mountedSections.has("planes")) && authUser && (
            <PersistentSection active={activeSection === "planes"}>
              <PlanesSection
                apiBaseUrl={apiBaseUrl}
                authToken={authToken}
                authUser={authUser}
                herramientaBloqueada={planDesde}
                paymentsEnabled={paymentsEnabled}
                formsTopupsEnabled={formsTopupsEnabled}
              />
            </PersistentSection>
          )}

          {/* ── Inicio (dashboard) ── */}
          {(activeSection === "inicio" || mountedSections.has("inicio")) && authUser && (
            <PersistentSection active={activeSection === "inicio"}>
              <HomeSection
              user={authUser}
              proyecto={proyectoActivo}
              proyectosTotal={proyectosTotal}
              onNavigate={setActiveSection}
              />
            </PersistentSection>
          )}

          {/* ── Tabulación Wizard ── */}
          {(activeSection === "tabulacion" || mountedSections.has("tabulacion")) && authUser && (
            <PersistentSection active={activeSection === "tabulacion"}>
              <TabulacionSection
              apiBaseUrl={apiBaseUrl}
              authToken={authToken}
              authUser={authUser}
              proyecto={proyectoActivo}
              onPasoHecho={marcarPasoActivo}
              onUpgrade={irAPlanes}
              />
            </PersistentSection>
          )}

          {/* ── Tabulación descriptiva (IA) ── */}
          {(activeSection === "descriptiva" || mountedSections.has("descriptiva")) && authUser && (
            <PersistentSection active={activeSection === "descriptiva"}>
              <DescriptivaSection
              apiBaseUrl={apiBaseUrl}
              authToken={authToken}
              authUser={authUser}
              onPasoHecho={marcarPasoActivo}
              onUpgrade={irAPlanes}
              />
            </PersistentSection>
          )}

          {/* ── Confiabilidad (Alfa de Cronbach) ── */}
          {(activeSection === "confiabilidad" || mountedSections.has("confiabilidad")) && authUser && (
            <PersistentSection active={activeSection === "confiabilidad"}>
              <CronbachSection
              apiBaseUrl={apiBaseUrl}
              authToken={authToken}
              authUser={authUser}
              proyecto={proyectoActivo}
              onPasoHecho={marcarPasoActivo}
              onUpgrade={irAPlanes}
              />
            </PersistentSection>
          )}

          {/* ── Integraciones (clave de API + Tutorica Forms) ── */}
          {(activeSection === "forms" || mountedSections.has("forms")) && authUser && (
            <PersistentSection active={activeSection === "forms"}>
              <FormsSection apiBaseUrl={apiBaseUrl} authToken={authToken} authUser={authUser} onUpgrade={irAPlanes} />
            </PersistentSection>
          )}

          {/* ── Generador de Títulos de Investigación (IA) ── */}
          {(activeSection === "titulos" || mountedSections.has("titulos")) && authUser && (
            <PersistentSection active={activeSection === "titulos"}>
              <TitulosSection
              apiBaseUrl={apiBaseUrl}
              authToken={authToken}
              authUser={authUser}
              proyecto={proyectoActivo}
              onProyectoActualizado={seleccionarProyecto}
              onUpgrade={irAPlanes}
              />
            </PersistentSection>
          )}

          {/* ── Matriz de Consistencia (IA) ── */}
          {(activeSection === "matriz" || mountedSections.has("matriz")) && authUser && (
            <PersistentSection active={activeSection === "matriz"}>
              <MatrizSection
              apiBaseUrl={apiBaseUrl}
              authToken={authToken}
              authUser={authUser}
              proyecto={proyectoActivo}
              onProyectoActualizado={seleccionarProyecto}
              onPasoHecho={marcarPasoActivo}
              onUpgrade={irAPlanes}
              />
            </PersistentSection>
          )}

          {/* ── Humanizador de texto académico (IA) ── */}
          {(activeSection === "humanizador" || mountedSections.has("humanizador")) && authUser && (
            <PersistentSection active={activeSection === "humanizador"}>
              <HumanizadorSection
              apiBaseUrl={apiBaseUrl}
              authToken={authToken}
              authUser={authUser}
              onPasoHecho={marcarPasoActivo}
              onUpgrade={irAPlanes}
              />
            </PersistentSection>
          )}

          {/* ── Usuarios (admin) ── */}
          {(activeSection === "usuarios" || mountedSections.has("usuarios")) && isAdmin && authUser && (
            <PersistentSection active={activeSection === "usuarios"}>
              <UsersSection apiBaseUrl={apiBaseUrl} authToken={authToken} authUser={authUser} />
            </PersistentSection>
          )}

          {/* ── Mi cuenta ── */}
          {(activeSection === "cuenta" || mountedSections.has("cuenta")) && authUser && (
            <PersistentSection active={activeSection === "cuenta"}>
              <AccountSection
              apiBaseUrl={apiBaseUrl}
              authToken={authToken}
              authUser={authUser}
              googleClientId={googleClientId}
              themeMode={themeMode}
              onTokenRefresh={(token, expiresAt) => {
                setAuthToken(token);
                if (expiresAt) localStorage.setItem("authExpiresAt", expiresAt);
              }}
              onAccountDeleted={handleAccountDeleted}
              />
            </PersistentSection>
          )}

          </Suspense>

        </main>
      </div>
    </div>
  );
}
