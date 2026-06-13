import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Building2,
  CalendarPlus,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  HelpCircle,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Moon,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { motion, animate, useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";


// Modulos extraidos de este archivo (ver lib/ y components/).
import type {
  AppSection,
  AppView,
  AuthLoginResponse,
  AuthUser,
  AuthUsersResponse,
  DimensionDef,
  DownloadLinks,
  EstructuraDimension,
  GeneratedResult,
  IndicadorDef,
  InlineGenerateResponse,
  ItemDef,
  TabConfig,
  TemplateInfo,
  ThemeMode,
  WizardStep,
} from "./lib/types";
import { DEFAULT_API_BASE_URL, FALLBACK_CONFIG, LIST_GROUPS } from "./lib/constants";
import {
  base64ToUint8Array,
  eid,
  calcBaremoIntervalos,
  calcBaremoRange,
  correlationInfo,
  csvToRows,
  defaultLevelName,
  formatDateTime,
  getSubscriptionLabel,
  normalizeList,
  parseIntSafe,
  resolveViewFromPath,
  revokeDownloadLinks,
  toStringList,
  toStringValue,
  workbookToSheetRows,
} from "./lib/helpers";
import { springSoft } from "./components/motion-primitives";
import { FieldHint, HierarchyEditor, ListEditorField, StepTip } from "./components/wizard-fields";
import { PreviewTable } from "./components/PreviewTable";
import { WizardProgress } from "./components/WizardProgress";
import { LandingPage } from "./components/LandingPage";

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [appView, setAppView] = useState<AppView>(() => resolveViewFromPath());
  const [activeSection, setActiveSection] = useState<AppSection>("tabulacion");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [estructuraV1, setEstructuraV1] = useState<DimensionDef[]>([]);
  const [estructuraV2, setEstructuraV2] = useState<DimensionDef[]>([]);
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<string>("");

  const [config, setConfig] = useState<TabConfig>(FALLBACK_CONFIG);
  const [jsonDraft, setJsonDraft] = useState<string>(JSON.stringify(FALLBACK_CONFIG, null, 2));
  // El override por localStorage es una comodidad de desarrollo; en produccion
  // manda siempre VITE_API_BASE_URL (un valor viejo guardado romperia la app).
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(() =>
    (import.meta.env.DEV ? localStorage.getItem("apiBaseUrl") : null) || DEFAULT_API_BASE_URL);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("themeMode");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const [statusMessage, setStatusMessage] = useState<string>("Listo para generar.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [downloadLinks, setDownloadLinks] = useState<DownloadLinks | null>(null);

  const [templateInfo, setTemplateInfo] = useState<TemplateInfo | null>(null);
  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem("authToken") ?? "");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(() => Boolean(localStorage.getItem("authToken")));
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>(() => localStorage.getItem("loginEmail") ?? "");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [usersStatusMessage, setUsersStatusMessage] = useState<string>("Sincroniza usuarios para ver el estado.");

  // Clave de API del usuario (seccion Integraciones / Tutorica Forms).
  const [apiKeyInfo, setApiKeyInfo] = useState<{ hasKey: boolean; last4: string | null; createdAt: string | null } | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [usersErrorMessage, setUsersErrorMessage] = useState<string | null>(null);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState<string>("");
  const [newUserPassword, setNewUserPassword] = useState<string>("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [newUserPlan, setNewUserPlan] = useState<string>("pro");
  const [newUserDays, setNewUserDays] = useState<string>("30");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [customDaysMap, setCustomDaysMap] = useState<Record<string, string>>({});

  const isAdmin = authUser?.role === "admin";

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    fetch("/default-config.json")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as TabConfig;
        if (!isMounted || !data || Array.isArray(data)) return;
        setConfig(data);
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

  useEffect(() => { setJsonDraft(JSON.stringify(config, null, 2)); }, [config]);
  useEffect(() => { if (import.meta.env.DEV) localStorage.setItem("apiBaseUrl", apiBaseUrl); }, [apiBaseUrl]);
  useEffect(() => {
    if (authToken) localStorage.setItem("authToken", authToken);
    else localStorage.removeItem("authToken");
  }, [authToken]);

  // Despierta la API apenas se abre la app: si el hosting suspende el servidor
  // por inactividad (arranque en frío), el login y la generación lo encuentran
  // ya caliente.
  useEffect(() => {
    fetch(`${apiBaseUrl.replace(/\/$/, "")}/health`).catch(() => {});
  }, [apiBaseUrl]);

  // Cronómetro de la generación para informar el progreso por etapas.
  useEffect(() => {
    if (!isGenerating) return;
    setGenerationElapsed(0);
    const timer = window.setInterval(() => setGenerationElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);
  useEffect(() => {
    const onPop = () => setAppView(resolveViewFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    localStorage.setItem("themeMode", themeMode);
    document.documentElement.classList.toggle("dark", themeMode === "dark");
  }, [themeMode]);
  useEffect(() => () => revokeDownloadLinks(downloadLinks), [downloadLinks]);

  useEffect(() => {
    if (estructuraV1.length === 0 && estructuraV2.length === 0) return;
    const v1Inds = estructuraV1.flatMap((d) => d.indicadores.map((i) => i.nombre));
    const v2Inds = estructuraV2.flatMap((d) => d.indicadores.map((i) => i.nombre));
    const hasV2 = estructuraV2.length > 0;
    const toEstructura = (dims: DimensionDef[]): EstructuraDimension[] => dims.map((d) => ({
      nombre: d.nombre,
      indicadores: d.indicadores.map((i) => ({ nombre: i.nombre, items: i.items.length })),
    }));
    setConfig((prev) => ({
      ...prev,
      nombre_indicador: [...v1Inds, ...v2Inds],
      numero_indicador0: hasV2
        ? [String(v1Inds.length), String(v2Inds.length)]
        : [String(v1Inds.length)],
      estructura_v1: toEstructura(estructuraV1),
      estructura_v2: toEstructura(estructuraV2),
      nombre_dims_v1: estructuraV1.map((d) => d.nombre),
      items_por_dim_v1: estructuraV1.map((d) => String(d.indicadores.flatMap((i) => i.items).length)),
      nombre_items_v1: estructuraV1.flatMap((d) => d.indicadores.flatMap((i) => i.items.map((it) => it.nombre))),
      nombre_dims_v2: estructuraV2.map((d) => d.nombre),
      items_por_dim_v2: estructuraV2.map((d) => String(d.indicadores.flatMap((i) => i.items).length)),
      nombre_items_v2: estructuraV2.flatMap((d) => d.indicadores.flatMap((i) => i.items.map((it) => it.nombre))),
    }));
  }, [estructuraV1, estructuraV2]);

  useEffect(() => {
    const muestra = parseIntSafe(config.muestra);
    if (!muestra || muestra <= 0) return;
    setConfig((prev) => {
      const recalc = (pctKey: string, cantKey: string) => {
        const pcts = toStringList(prev[pctKey]);
        if (!pcts.length) return {};
        return {
          [cantKey]: pcts.map((v) => {
            const p = parseFloat(v.trim());
            return Number.isFinite(p) ? String(Math.round((p / 100) * muestra)) : "";
          }),
        };
      };
      return { ...prev, ...recalc("porcentaje", "cantidad"), ...recalc("porcentaje_v2", "cantidad_v2") };
    });
  }, [config.muestra]);

  useEffect(() => {
    if (!authToken) { setAuthLoading(false); setAuthUser(null); return; }
    let isMounted = true;
    setAuthLoading(true);
    setAuthError(null);
    fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/me`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        const payload = (await res.json()) as { user?: AuthUser; error?: string };
        if (!res.ok || !payload.user) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
        if (!isMounted) return;
        setAuthUser(payload.user);
      })
      .catch((err) => {
        if (!isMounted) return;
        setAuthToken(""); setAuthUser(null);
        setAuthError(err instanceof Error ? err.message : "No se pudo validar la sesión.");
      })
      .finally(() => { if (isMounted) setAuthLoading(false); });
    return () => { isMounted = false; };
  }, [apiBaseUrl, authToken]);

  // Limites del generador (muestra maxima e items por variable),
  // para validar antes de llamar a /generate.
  useEffect(() => {
    if (!authToken || !authUser) { setTemplateInfo(null); return; }
    let isMounted = true;
    fetch(`${apiBaseUrl.replace(/\/$/, "")}/template-info`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        if (!res.ok) return;
        const payload = (await res.json()) as Partial<TemplateInfo>;
        if (!isMounted) return;
        if (typeof payload.maxMuestra === "number" && typeof payload.maxItemsV1 === "number") {
          setTemplateInfo({
            maxMuestra: payload.maxMuestra,
            maxItemsV1: payload.maxItemsV1,
            maxItemsV2: payload.maxItemsV2 ?? 0,
          });
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [apiBaseUrl, authToken, authUser]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const validationMessages = useMemo(() => {
    const issues: string[] = [];
    const hasV2 = (parseIntSafe(config.variable) ?? 2) >= 2;
    const muestra = parseIntSafe(config.muestra);
    const item = parseIntSafe(config.item);
    const escala = parseIntSafe(config.escala);
    const respuesta = parseIntSafe(config.respuesta);
    if (muestra === null || muestra < 2) issues.push("La cantidad de personas debe ser 2 o más.");
    if (item === null || item <= 0) issues.push("Las preguntas de V1 deben ser mayor a 0.");
    if (hasV2) {
      const itemv2 = parseIntSafe(config.itemv2);
      if (itemv2 === null || itemv2 <= 0) issues.push("Las preguntas de V2 deben ser mayor a 0.");
    }
    // Limites reportados por el servidor
    if (templateInfo) {
      if (muestra !== null && muestra > templateInfo.maxMuestra) {
        issues.push(`El sistema soporta máximo ${templateInfo.maxMuestra} personas encuestadas (configuraste ${muestra}).`);
      }
      if (item !== null && item > templateInfo.maxItemsV1) {
        issues.push(`El sistema soporta máximo ${templateInfo.maxItemsV1} preguntas en la Variable 1 (configuraste ${item}).`);
      }
      if (hasV2) {
        const itemv2 = parseIntSafe(config.itemv2);
        if (itemv2 !== null && itemv2 > templateInfo.maxItemsV2) {
          issues.push(`El sistema soporta máximo ${templateInfo.maxItemsV2} preguntas en la Variable 2 (configuraste ${itemv2}).`);
        }
      }
    }
    if (escala === null || escala <= 0) issues.push("Los niveles del baremo (V1) deben ser mayor a 0.");
    if (hasV2) {
      const escala_v2 = parseIntSafe(config.escala_v2);
      if (escala_v2 === null || escala_v2 <= 0) issues.push("Los niveles del baremo (V2) deben ser mayor a 0.");
    }
    if (respuesta === null || respuesta <= 0) issues.push("La escala de respuesta debe ser mayor a 0.");
    const dimensions = toStringList(config.nombre_dimension).filter((v) => v.trim() !== "");
    if (!dimensions.length) issues.push("Debe existir al menos una dimensión.");
    const indicatorNames = toStringList(config.nombre_indicador).filter((v) => v.trim() !== "");
    const indicatorCounts = toStringList(config.numero_indicador0)
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((v) => Number.isFinite(v) && v >= 0);
    if (indicatorCounts.length > 0 && indicatorNames.length > 0) {
      const total = indicatorCounts.reduce((sum, v) => sum + v, 0);
      if (total !== indicatorNames.length) issues.push("La suma de indicadores por dimensión no coincide con el total de indicadores.");
    }

    const validatePorcentaje = (key: string, label: string) => {
      const vals = toStringList(config[key]).filter((v) => v.trim() !== "");
      const sum = vals.reduce((acc, v) => { const n = Number.parseInt(v.trim(), 10); return Number.isFinite(n) ? acc + n : acc; }, 0);
      if (vals.length > 0 && sum !== 100) {
        issues.push(`${label}: los porcentajes deben sumar exactamente 100% (actual: ${sum}%).`);
      }
    };
    validatePorcentaje("porcentaje", "Baremo V1");
    if (hasV2) validatePorcentaje("porcentaje_v2", "Baremo V2");

    return issues;
  }, [config, templateInfo]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const setScalar = (key: string, value: string) => setConfig((prev) => {
    const updates: TabConfig = { ...prev, [key]: value };
    const resizeBaremo = (n: number, nombreKey: string, otherKeys: string[]) => {
      if (!Number.isFinite(n) || n <= 0) return;
      // nombre_escala: rellenar con nombres por defecto si quedan vacíos
      const nombres = toStringList(prev[nombreKey]);
      if (nombres.length < n) {
        updates[nombreKey] = [...nombres, ...Array.from({ length: n - nombres.length }, (_, i) => defaultLevelName(nombres.length + i, n))];
      } else if (nombres.length > n) {
        updates[nombreKey] = nombres.slice(0, n);
      }
      // otros campos: rellenar con vacíos
      otherKeys.forEach((k) => {
        const arr = toStringList(prev[k]);
        if (arr.length < n) updates[k] = [...arr, ...Array(n - arr.length).fill("")];
        else if (arr.length > n) updates[k] = arr.slice(0, n);
      });
    };
    if (key === "escala") resizeBaremo(parseInt(value.trim(), 10), "nombre_escala", ["desde", "hasta", "porcentaje", "cantidad"]);
    if (key === "escala_v2") resizeBaremo(parseInt(value.trim(), 10), "nombre_escala_v2", ["desde_v2", "hasta_v2", "porcentaje_v2", "cantidad_v2"]);
    return updates;
  });
  const setList = (key: string, values: string[]) => setConfig((prev) => {
    const normalized = normalizeList(values);
    const updates: TabConfig = { ...prev, [key]: normalized };
    // Cuando cambian los niveles del baremo, sincronizar el nº de filas de los demás campos
    const syncBaremo = (dependentKeys: string[]) => {
      const n = normalized.length;
      dependentKeys.forEach((k) => {
        const arr = toStringList(prev[k]);
        if (arr.length < n) {
          updates[k] = [...arr, ...Array(n - arr.length).fill("")];
        } else if (arr.length > n) {
          updates[k] = arr.slice(0, n);
        }
      });
    };
    if (key === "nombre_escala") syncBaremo(["desde", "hasta", "porcentaje", "cantidad"]);
    if (key === "nombre_escala_v2") syncBaremo(["desde_v2", "hasta_v2", "porcentaje_v2", "cantidad_v2"]);
    // Si se edita un campo de baremo directamente, rellenar hasta la longitud de nombre_escala
    // (normalizeList elimina vacíos del final, lo que haría perder filas al usuario)
    const padToLength = (k: string, referenceKey: string) => {
      if (key !== k) return;
      const target = toStringList(prev[referenceKey]).length;
      const arr = toStringList(updates[k]);
      if (arr.length < target) updates[k] = [...arr, ...Array(target - arr.length).fill("")];
    };
    ["desde", "hasta", "porcentaje", "cantidad"].forEach((k) => padToLength(k, "nombre_escala"));
    ["desde_v2", "hasta_v2", "porcentaje_v2", "cantidad_v2"].forEach((k) => padToLength(k, "nombre_escala_v2"));
    // Cuando cambia el porcentaje, calcular cantidad automáticamente
    const calcCantidad = (pctKey: string, cantKey: string) => {
      if (key !== pctKey) return;
      const muestra = parseIntSafe(prev.muestra);
      if (!muestra || muestra <= 0) return;
      updates[cantKey] = toStringList(updates[pctKey]).map((v) => {
        const pct = parseFloat(v.trim());
        return Number.isFinite(pct) ? String(Math.round(pct / 100 * muestra)) : "";
      });
    };
    calcCantidad("porcentaje", "cantidad");
    calcCantidad("porcentaje_v2", "cantidad_v2");
    // Auto-generar numero_dimension cuando cambian las dimensiones
    if (key === "nombre_dimension") {
      updates.numero_dimension = normalized.map((_, i) => String(i + 1));
    }
    return updates;
  });
  const getScalar = (key: string) => toStringValue(config[key]);
  const getList = (key: string) => toStringList(config[key]);

  const autoCalcBaremo = (varKey: "v1" | "v2") => {
    const isV2 = varKey === "v2";
    const preguntas = parseIntSafe(isV2 ? config.itemv2 : config.item);
    const respuesta = parseIntSafe(config.respuesta);
    const niveles = parseIntSafe(isV2 ? config.escala_v2 : config.escala);
    if (!preguntas || !respuesta || !niveles || preguntas <= 0 || respuesta <= 0 || niveles <= 0) return;
    const { desde, hasta } = calcBaremoIntervalos(preguntas, respuesta, niveles);
    setConfig((prev) => ({
      ...prev,
      [isV2 ? "desde_v2" : "desde"]: desde,
      [isV2 ? "hasta_v2" : "hasta"]: hasta,
    }));
  };

  const handleApplyJson = () => {
    setErrorMessage(null);
    try {
      const parsed = JSON.parse(jsonDraft) as TabConfig;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("El JSON debe ser un objeto.");
      setConfig(parsed);
      setStatusMessage("JSON aplicado correctamente.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo aplicar el JSON.");
    }
  };

  const loadUsers = async () => {
    if (!authToken || authUser?.role !== "admin") return;
    setIsUsersLoading(true);
    setUsersErrorMessage(null); setUsersStatusMessage("");
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users`, { headers: { Authorization: `Bearer ${authToken}` } });
      const payload = (await res.json()) as AuthUsersResponse;
      if (!res.ok || !Array.isArray(payload.users)) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
      setManagedUsers(payload.users);
      setUsersErrorMessage(null); setUsersStatusMessage(`${payload.users.length} usuario(s) cargados.`);
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo obtener usuarios.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthError(null);
    const email = loginEmail.trim();
    if (!email || !loginPassword) { setAuthError("Completa email y contraseña."); return; }
    setAuthLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: loginPassword }),
      });
      const payload = (await res.json()) as AuthLoginResponse;
      if (!res.ok || !payload.token || !payload.user) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
      setAuthToken(payload.token);
      setAuthUser(payload.user);
      setLoginPassword("");
      localStorage.setItem("loginEmail", email);
      setStatusMessage("Sesión iniciada.");
    } catch (err) {
      setAuthToken(""); setAuthUser(null);
      setAuthError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthToken(""); setAuthUser(null); setManagedUsers([]);
    setAuthError(null); setUsersErrorMessage(null);
    setActiveSection("tabulacion"); setWizardStep(1);
    setStatusMessage("Sesión cerrada.");
  };

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
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ email, password: newUserPassword, role: newUserRole, plan: newUserPlan, subscriptionDays }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
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
    if (userId === authUser?.id && "status" in patch) { setUsersErrorMessage("No puedes modificar tu propio estado."); return; }
    setIsUsersLoading(true); setUsersErrorMessage(null); setUsersStatusMessage("");
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(patch),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
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
    if (userId === authUser?.id) { setUsersErrorMessage("No puedes eliminar tu propia cuenta."); setConfirmDeleteId(null); return; }
    setIsUsersLoading(true); setUsersErrorMessage(null); setUsersStatusMessage("");
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
      setUsersErrorMessage(null); setUsersStatusMessage("Usuario eliminado.");
      await loadUsers();
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo eliminar el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const handleGenerate = async () => {
    setErrorMessage(null);
    if (!authToken || !authUser) { setErrorMessage("Debes iniciar sesión para generar tabulación."); return; }
    if (validationMessages.length > 0) { setErrorMessage("Corrige las validaciones antes de generar."); return; }
    setIsGenerating(true);
    setStatusMessage("Enviando configuración a la API...");
    try {
      const hasV2gen = (parseIntSafe(config.variable) ?? 2) >= 2;
      const dimCount = hasV2gen ? 2 : 1;
      const resolvedConfig = {
        ...config,
        nombre_dimension: Array.from({ length: dimCount }, (_, i) => {
          const val = toStringList(config.nombre_dimension)[i] ?? "";
          return val.trim() || `Variable ${i + 1}`;
        }),
      };
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ config: resolvedConfig, responseMode: "inline" }),
      });
      const payload = (await res.json()) as InlineGenerateResponse;
      if (!res.ok) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
      const correlationOk = typeof payload.correlation === "number" || payload.correlation === null;
      if (!correlationOk || !payload.baseCsv || !payload.excelBase64) {
        throw new Error("La API respondió sin los artefactos esperados.");
      }
      setStatusMessage("Procesando resultados...");
      const excelBytes = base64ToUint8Array(payload.excelBase64);
      const csvRows = await csvToRows(payload.baseCsv);
      const parsedWorkbook = await workbookToSheetRows(excelBytes);
      const nextLinks: DownloadLinks = {
        json: URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json;charset=utf-8" })),
        csv: URL.createObjectURL(new Blob([payload.baseCsv], { type: "text/csv;charset=utf-8" })),
        xlsx: URL.createObjectURL(new Blob([excelBytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })),
      };
      setDownloadLinks((cur) => { revokeDownloadLinks(cur); return nextLinks; });
      setResult({ correlation: payload.correlation, warnings: payload.warnings ?? [], csvRows, sheetNames: parsedWorkbook.names, sheetData: parsedWorkbook.data, generatedAt: new Date().toISOString() });
      setSelectedSheet(parsedWorkbook.names[0] ?? "");
      setStatusMessage("Tabulación generada correctamente.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo generar la tabulación.";
      setErrorMessage(msg);
      if (msg.toLowerCase().includes("token")) { setAuthToken(""); setAuthUser(null); }
      setStatusMessage("Ocurrió un error.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Mensaje de progreso por etapas: con servidores que despiertan de una
  // suspensión, la generación puede tardar 1-2 minutos y el usuario debe
  // saber que todo va bien.
  const generationProgressMessage = !isGenerating
    ? statusMessage
    : generationElapsed < 8
      ? "Enviando configuración a la API..."
      : generationElapsed < 40
        ? `El servidor está procesando (${generationElapsed}s)... puede tardar hasta 2 minutos, no cierres la página.`
        : `Generando tu Excel: estadísticos, baremos y gráficos (${generationElapsed}s)... ya falta poco.`;

  // ── Clave de API (Integraciones) ────────────────────────────────────────────
  const loadApiKey = async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/api-key`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json();
      if (res.ok) setApiKeyInfo({ hasKey: Boolean(body.hasKey), last4: body.last4 ?? null, createdAt: body.createdAt ?? null });
    } catch {
      // Sin conexion: se reintenta al volver a entrar a la seccion.
    }
  };

  const generateApiKey = async () => {
    if (!authToken) return;
    if (apiKeyInfo?.hasKey && !window.confirm("Regenerar la clave invalida la anterior en tu extensión. ¿Continuar?")) return;
    setApiKeyBusy(true);
    setNewApiKey(null);
    setApiKeyCopied(false);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/api-key`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Error HTTP ${res.status}`);
      setNewApiKey(body.apiKey);
      setApiKeyInfo({ hasKey: true, last4: body.last4 ?? null, createdAt: body.createdAt ?? null });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "No se pudo generar la clave.");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const revokeApiKey = async () => {
    if (!authToken || !window.confirm("¿Revocar tu clave de API? La extensión dejará de funcionar hasta que generes una nueva.")) return;
    setApiKeyBusy(true);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/api-key`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`Error HTTP ${res.status}`);
      setNewApiKey(null);
      setApiKeyInfo({ hasKey: false, last4: null, createdAt: null });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "No se pudo revocar la clave.");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setApiKeyCopied(true);
      window.setTimeout(() => setApiKeyCopied(false), 2000);
    } catch {
      window.alert("No se pudo copiar; selecciona el texto manualmente.");
    }
  };

  const toggleTheme = () => setThemeMode((cur) => (cur === "dark" ? "light" : "dark"));
  const goToApp = () => { window.history.pushState({}, "", "/app"); setAppView("app"); };
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)/0.55)_0%,hsl(var(--background))_60%)] p-4 transition-colors">
        <motion.div
          className="w-full max-w-sm"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
        >
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_14px_36px_-14px_hsl(var(--primary)/0.8)]">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">TesisTab</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ingresa con tu cuenta para continuar</p>
          </div>
          <Card className="rounded-2xl border-border/70 shadow-[0_20px_70px_rgba(15,23,42,0.15)]">
            <CardContent className="space-y-4 pt-6">
              {authError && (
                <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{authError}</div>
              )}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Correo electrónico</span>
                {/* AUTOCOMPLETE: permite que el navegador recuerde el correo.
                    TODO producción: cambiar a autoComplete="off" si se prefiere no guardar */}
                <Input
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="admin@tu-dominio.com"
                  autoComplete="email"
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Contraseña</span>
                {/* AUTOCOMPLETE: permite que el navegador guarde la contraseña.
                    TODO producción: cambiar a autoComplete="new-password" para desactivarlo */}
                <div className="relative">
                  <Input
                    type={showLoginPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={showLoginPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
              <Button className="h-11 w-full" onClick={handleLogin} disabled={authLoading}>
                {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Entrar
              </Button>
              {import.meta.env.DEV && (
                <button
                  onClick={() => { setLoginEmail("admin@tabulacion.local"); setLoginPassword("Admin12345!"); }}
                  className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
                >
                  Rellenar con datos de prueba
                </button>
              )}
              <div className="flex items-center justify-between">
                <button onClick={goToLanding} className="text-xs text-muted-foreground hover:text-foreground">← Volver al inicio</button>
                <button onClick={toggleTheme} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  {themeMode === "dark" ? <><Sun className="h-3.5 w-3.5" />Modo claro</> : <><Moon className="h-3.5 w-3.5" />Modo oscuro</>}
                </button>
              </div>
            </CardContent>
          </Card>
          {/* Input de API solo visible en dev local (VITE_API_BASE_URL no definida) */}
          {import.meta.env.DEV && (
            <div className="mt-4 space-y-1">
              <p className="text-center text-xs text-muted-foreground">API: {apiBaseUrl}</p>
              <Input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://tu-api.com" className="text-xs" />
            </div>
          )}
        </motion.div>
      </div>
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
    <div className="flex min-h-[100dvh] bg-background transition-colors">

      {/* ── Sidebar ── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 bg-card/80 backdrop-blur-sm md:flex sticky top-0 h-screen">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-border/60 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <span className="font-bold tracking-tight">TesisTab</span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Herramientas</p>
          <button
            onClick={() => { setActiveSection("tabulacion"); }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
              activeSection === "tabulacion"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <FileSpreadsheet className="h-4 w-4 shrink-0" />
            Tabulación
            {activeSection === "tabulacion" && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
          </button>

          <button
            onClick={() => { setActiveSection("forms"); loadApiKey(); }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
              activeSection === "forms"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            Forms
            {activeSection === "forms" && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
          </button>

          {/* Coming soon items */}
          {[
            { label: "Análisis", icon: ChartNoAxesCombined },
          ].map((item) => (
            <div
              key={item.label}
              className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground/50"
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              <Badge variant="muted" className="ml-auto text-[9px] px-1.5 py-0">Pronto</Badge>
            </div>
          ))}

          {isAdmin && (
            <>
              <p className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Administración</p>
              <button
                onClick={() => { setActiveSection("usuarios"); loadUsers(); }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
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
          {/* URL de la API: editable solo en dev local */}
          {import.meta.env.DEV && (
            <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">API</p>
              <input
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full bg-transparent text-[11px] text-muted-foreground outline-none truncate"
                placeholder="http://localhost:8080"
              />
            </div>
          )}
          <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
            <p className="truncate text-xs font-medium text-foreground">{authUser?.email}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{authUser?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-danger/10 hover:text-danger transition-all"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Mobile topbar */}
        <header className="flex h-14 items-center justify-between border-b border-border/60 bg-card/80 px-4 md:hidden">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <span className="font-bold">TesisTab</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="rounded-lg p-2 text-muted-foreground hover:bg-accent">
              {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={handleLogout} className="rounded-lg p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Mobile nav tabs */}
        <div className="flex border-b border-border/60 bg-card/80 px-4 md:hidden">
          <button
            onClick={() => setActiveSection("tabulacion")}
            className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-all", activeSection === "tabulacion" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Tabulación
          </button>
          <button
            onClick={() => { setActiveSection("forms"); loadApiKey(); }}
            className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-all", activeSection === "forms" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Forms
          </button>
          {isAdmin && (
            <button
              onClick={() => { setActiveSection("usuarios"); loadUsers(); }}
              className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-all", activeSection === "usuarios" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
            >
              <Users className="h-3.5 w-3.5" />
              Usuarios
            </button>
          )}
        </div>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">

          {/* ── Tabulación Wizard ── */}
          {activeSection === "tabulacion" && authUser && (
            <div className="mx-auto max-w-3xl">
              <div className="mb-6">
                <h2 className="text-2xl font-bold tracking-tight">Generar tabulación</h2>
                <p className="mt-1 text-sm text-muted-foreground">Completa los 3 pasos para generar tu archivo Excel.</p>
              </div>

              <WizardProgress currentStep={wizardStep} />

              {/* Step 1: Datos básicos */}
              {wizardStep === 1 && (
                <div className="step-enter space-y-5">
                  <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                    <CardHeader>
                      <CardTitle>Datos de tu encuesta</CardTitle>
                      <CardDescription>Ingresa la información básica de tu instrumento de investigación.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {(() => {
                        const numVars = parseInt(getScalar("variable"), 10) || 2;
                        const hasV2 = numVars >= 2;
                        return (
                          <>
                            {/* Número de variables — selector */}
                            <div>
                              <div className="mb-2 flex items-center gap-2.5">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                                <p className="text-base font-semibold text-foreground">¿Cuántas variables tiene tu encuesta?</p>
                              </div>
                              <FieldHint text="La mayoría de tesis usan 2 variables. Si solo tienes 1, la correlación no aplica." />
                              <div className="mt-3 flex gap-2">
                                {[1, 2].map((n) => (
                                  <button
                                    key={n}
                                    onClick={() => setScalar("variable", String(n))}
                                    className={cn(
                                      "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                      numVars === n
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                    )}
                                  >
                                    {n} variable{n > 1 ? "s" : ""}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Divider: Datos generales */}
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Datos generales</span>
                              <div className="h-px flex-1 bg-border" />
                            </div>

                            {/* General */}
                            <div className="grid gap-4 sm:grid-cols-2">
                              {[
                                { key: "nommuestra", label: "Nombre de la muestra", hint: "¿Cómo se llaman las personas encuestadas? Ej: Beneficiarios, Estudiantes, Trabajadores.", placeholder: "Ej: Beneficiarios" },
                                { key: "muestra", label: "Cantidad de personas encuestadas", hint: "Total de personas que respondieron la encuesta. Mínimo 2.", placeholder: "Ej: 289" },
                                { key: "respuesta", label: "¿Cuántas opciones tiene cada pregunta?", hint: "Cuenta las alternativas de tu escala. Ej: Muy en desacuerdo / En desacuerdo / Neutral / De acuerdo / Muy de acuerdo = 5 opciones.", placeholder: "Ej: 5" },
                              ].map((field) => (
                                <div key={field.key}>
                                  <label className="block">
                                    <span className="text-sm font-medium text-foreground">{field.label}</span>
                                    <Input className="mt-1.5" value={getScalar(field.key)} onChange={(e) => setScalar(field.key, e.target.value)} placeholder={field.placeholder} />
                                  </label>
                                  <FieldHint text={field.hint} />
                                </div>
                              ))}
                            </div>

                            {/* Divider: Configuración por variable */}
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Configuración por variable</span>
                              <div className="h-px flex-1 bg-border" />
                            </div>

                            {/* Por variable */}
                            <div className="rounded-xl border border-border/60 bg-background/50 p-4">
                              <div className={cn("grid gap-4", hasV2 ? "grid-cols-2" : "grid-cols-1")}>
                                {/* Headers */}
                                <div className="rounded bg-primary/10 px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide text-primary">Variable 1</div>
                                {hasV2 && <div className="rounded bg-primary/10 px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide text-primary">Variable 2</div>}
                                {/* Preguntas */}
                                <div>
                                  <label className="block">
                                    <span className="text-sm font-medium text-foreground">Preguntas</span>
                                    <Input className="mt-1.5" value={getScalar("item")} onChange={(e) => setScalar("item", e.target.value)} placeholder="Ej: 18" />
                                  </label>
                                </div>
                                {hasV2 && (
                                  <div>
                                    <label className="block">
                                      <span className="text-sm font-medium text-foreground">Preguntas</span>
                                      <Input className="mt-1.5" value={getScalar("itemv2")} onChange={(e) => setScalar("itemv2", e.target.value)} placeholder="Ej: 9" />
                                    </label>
                                  </div>
                                )}
                                <FieldHint text="Cuántas preguntas (ítems) tiene cada variable." />
                                {hasV2 && <FieldHint text="Cuántas preguntas (ítems) tiene cada variable." />}
                                {/* Dimensiones */}
                                <div>
                                  <label className="block">
                                    <span className="text-sm font-medium text-foreground">Dimensiones</span>
                                    <Input className="mt-1.5" value={getScalar("dimensiones")} onChange={(e) => setScalar("dimensiones", e.target.value)} placeholder="Ej: 3" />
                                  </label>
                                </div>
                                {hasV2 && (
                                  <div>
                                    <label className="block">
                                      <span className="text-sm font-medium text-foreground">Dimensiones</span>
                                      <Input className="mt-1.5" value={getScalar("dimensiones_v2")} onChange={(e) => setScalar("dimensiones_v2", e.target.value)} placeholder="Ej: 3" />
                                    </label>
                                  </div>
                                )}
                                <FieldHint text="En cuántos grupos temáticos se divide la variable." />
                                {hasV2 && <FieldHint text="Puede tener un número distinto al de la Variable 1." />}
                                {/* Niveles baremo */}
                                <div>
                                  <label className="block">
                                    <span className="text-sm font-medium text-foreground">Niveles del baremo</span>
                                    <Input className="mt-1.5" value={getScalar("escala")} onChange={(e) => setScalar("escala", e.target.value)} placeholder="Ej: 3" />
                                  </label>
                                </div>
                                {hasV2 && (
                                  <div>
                                    <label className="block">
                                      <span className="text-sm font-medium text-foreground">Niveles del baremo</span>
                                      <Input className="mt-1.5" value={getScalar("escala_v2")} onChange={(e) => setScalar("escala_v2", e.target.value)} placeholder="Ej: 3" />
                                    </label>
                                  </div>
                                )}
                                <FieldHint text="Cuántos niveles tiene el baremo. Ej: 3 = Bajo / Medio / Alto." />
                                {hasV2 && <FieldHint text="Puede ser diferente al de la Variable 1." />}
                              </div>
                            </div>
                          </>
                        );
                      })()}

                      {/* Relación — solo con 2 variables */}
                      {(parseInt(getScalar("variable"), 10) || 2) >= 2 && (
                        <div className="rounded-xl border border-border/80 bg-background/50 p-4">
                          <div className="mb-2 flex items-center gap-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                            <p className="text-base font-semibold text-foreground">¿Las variables van en la misma dirección?</p>
                          </div>
                          <FieldHint text="Misma dirección: si una variable sube, la otra también (ej: más horas de estudio → mejores notas). Dirección opuesta: si una sube, la otra baja (ej: más estrés → menor rendimiento)." />
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => setScalar("relacionversa", "0")}
                              className={cn(
                                "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                getScalar("relacionversa") === "0"
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50",
                              )}
                            >
                              <ArrowRight className="h-4 w-4" />
                              Misma dirección (directa)
                            </button>
                            <button
                              onClick={() => setScalar("relacionversa", "1")}
                              className={cn(
                                "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                getScalar("relacionversa") === "1"
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50",
                              )}
                            >
                              <ArrowUpDown className="h-4 w-4" />
                              Dirección opuesta (inversa)
                            </button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="flex justify-end">
                    <Button size="lg" onClick={() => {
                      autoCalcBaremo("v1");
                      const hasV2next = (parseIntSafe(config.variable) ?? 2) >= 2;
                      if (hasV2next) autoCalcBaremo("v2");
                      // Auto-generar estructura con dimensiones e ítems repartidos.
                      // Preserva nombres existentes cuando sea posible (si el usuario ya escribió algo).
                      const initEstructura = (numItems: number, numDims: number, prev: DimensionDef[]): DimensionDef[] => {
                        const usedItems = prev.flatMap((d) => d.indicadores.flatMap((i) => i.items)).length;
                        if (usedItems === numItems && prev.length === numDims && numDims > 0) return prev;
                        const dims = Math.max(numDims, 1);
                        const base = Math.floor(numItems / dims);
                        const extra = numItems % dims;
                        // Aplanar todos los ítems previos para reutilizar nombres
                        const allPrevItems = prev.flatMap((d) => d.indicadores.flatMap((i) => i.items));
                        let globalIdx = 0;
                        return Array.from({ length: dims }, (_, di) => {
                          const count = base + (di < extra ? 1 : 0);
                          const existingDim = prev[di];
                          const items: ItemDef[] = Array.from({ length: count }, (_, k) => {
                            const existing = allPrevItems[globalIdx + k];
                            return existing ?? { id: eid(), nombre: `Ítem ${globalIdx + k + 1}` };
                          });
                          globalIdx += count;
                          return {
                            id: existingDim?.id ?? eid(),
                            nombre: existingDim?.nombre ?? "",
                            indicadores: [{
                              id: existingDim?.indicadores[0]?.id ?? eid(),
                              nombre: existingDim?.indicadores[0]?.nombre ?? "",
                              items,
                            }],
                          };
                        });
                      };
                      const numV1 = parseIntSafe(config.item) ?? 0;
                      const numV2 = parseIntSafe(config.itemv2) ?? 0;
                      const dimsV1 = Math.max(parseIntSafe(config.dimensiones) ?? 1, 1);
                      const dimsV2 = Math.max(parseIntSafe(config.dimensiones_v2) ?? 1, 1);
                      const muestra = parseIntSafe(config.muestra) ?? 0;
                      if (muestra <= 0) { setErrorMessage("La cantidad de personas encuestadas debe ser mayor a 0."); return; }
                      if (numV1 <= 0) { setErrorMessage("El número de preguntas de Variable 1 debe ser mayor a 0."); return; }
                      if (hasV2next && numV2 <= 0) { setErrorMessage("El número de preguntas de Variable 2 debe ser mayor a 0."); return; }
                      if (dimsV1 > numV1) {
                        setErrorMessage(`Variable 1: no puedes tener más dimensiones (${dimsV1}) que preguntas (${numV1}).`); return;
                      }
                      if (hasV2next && dimsV2 > numV2) {
                        setErrorMessage(`Variable 2: no puedes tener más dimensiones (${dimsV2}) que preguntas (${numV2}).`); return;
                      }
                      if (numV1 > 0) setEstructuraV1((prev) => initEstructura(numV1, dimsV1, prev));
                      if (hasV2next && numV2 > 0) setEstructuraV2((prev) => initEstructura(numV2, dimsV2, prev));
                      setWizardStep(2);
                      setErrorMessage(null);
                    }}>
                      Siguiente: Escalas y estructura
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Escalas y estructura */}
              {wizardStep === 2 && (
                <div className="step-enter space-y-5">
                  {LIST_GROUPS.filter((group) => !("variable" in group && group.variable === "v2") || parseInt(getScalar("variable"), 10) >= 2).map((group) => (
                    <Card key={group.title} className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                      <CardHeader>
                        <CardTitle>{group.title}</CardTitle>
                        <CardDescription>{group.description}</CardDescription>
                        {"variable" in group && group.variable === "v1" && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                            <HelpCircle className="h-3 w-3" />
                            {calcBaremoRange(getScalar("item"), getScalar("respuesta")) || "Completa los ítems y escala en el paso 1"}
                          </div>
                        )}
                        {"variable" in group && group.variable === "v2" && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                            <HelpCircle className="h-3 w-3" />
                            {calcBaremoRange(getScalar("itemv2"), getScalar("respuesta")) || "Completa los ítems y escala en el paso 1"}
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className={cn("grid gap-3", group.fields.length > 1 && "md:grid-cols-2")}>
                        {group.fields.map((field) => {
                          const isEscalaField = field.key === "nombre_escala" || field.key === "nombre_escala_v2";
                          const labelsKey = "variable" in group
                            ? (group.variable === "v1" ? "nombre_escala" : "nombre_escala_v2")
                            : "";
                          const rowLabels = !isEscalaField && labelsKey ? getList(labelsKey) : [];
                          return (
                            <ListEditorField
                              key={field.key}
                              label={field.label}
                              placeholder={field.placeholder}
                              values={getList(field.key)}
                              onChange={(next) => setList(field.key, next)}
                              isPercentage={field.key === "porcentaje" || field.key === "porcentaje_v2"}
                              readOnly={field.key === "cantidad" || field.key === "cantidad_v2"}
                              rowLabels={rowLabels}
                            />
                          );
                        })}
                      </CardContent>
                    </Card>
                  ))}

                  {/* Estructura jerárquica — Variable 1 */}
                  <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                    <CardHeader>
                      <CardTitle>Ponle nombre a tu Variable 1</CardTitle>
                      <StepTip
                        icon={<Zap className="h-4 w-4" />}
                        label="Ya armamos el esqueleto"
                        detail="— ahora escríbele un nombre a cada parte ↓"
                        color="primary"
                      />
                    </CardHeader>
                    <CardContent>
                      <div className="mb-5">
                        <label className="block">
                          <span className="text-sm font-medium text-foreground">Nombre de la variable</span>
                          <Input
                            className="mt-1.5"
                            value={toStringList(config.nombre_dimension)[0] ?? ""}
                            onChange={(e) => setConfig((prev) => {
                              const dims = [...toStringList(prev.nombre_dimension)];
                              while (dims.length < 1) dims.push("");
                              dims[0] = e.target.value;
                              return { ...prev, nombre_dimension: dims };
                            })}
                            placeholder="Ej: Gestión de abastecimiento"
                          />
                        </label>
                        <FieldHint text="Este nombre aparece como etiqueta de Variable 1 en el Excel generado." />
                      </div>
                      <HierarchyEditor
                        label="Variable 1"
                        totalItems={parseIntSafe(config.item) ?? 0}
                        estructura={estructuraV1}
                        onChange={setEstructuraV1}
                      />
                    </CardContent>
                  </Card>

                  {/* Estructura jerárquica — Variable 2 */}
                  {(parseIntSafe(config.variable) ?? 2) >= 2 && (
                    <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                      <CardHeader>
                        <CardTitle>Ponle nombre a tu Variable 2</CardTitle>
                        <StepTip
                          icon={<Zap className="h-4 w-4" />}
                          label="Ya armamos el esqueleto"
                          detail="— ahora escríbele un nombre a cada parte de Variable 2 ↓"
                          color="primary"
                        />
                      </CardHeader>
                      <CardContent>
                        <div className="mb-5">
                          <label className="block">
                            <span className="text-sm font-medium text-foreground">Nombre de la variable</span>
                            <Input
                              className="mt-1.5"
                              value={toStringList(config.nombre_dimension)[1] ?? ""}
                              onChange={(e) => setConfig((prev) => {
                                const dims = [...toStringList(prev.nombre_dimension)];
                                while (dims.length < 2) dims.push("");
                                dims[1] = e.target.value;
                                return { ...prev, nombre_dimension: dims };
                              })}
                              placeholder="Ej: Satisfacción del servicio"
                            />
                          </label>
                          <FieldHint text="Este nombre aparece como etiqueta de Variable 2 en el Excel generado." />
                        </div>
                        <HierarchyEditor
                          label="Variable 2"
                          totalItems={parseIntSafe(config.itemv2) ?? 0}
                          estructura={estructuraV2}
                          onChange={setEstructuraV2}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* Advanced JSON toggle */}
                  <div className="rounded-xl border border-border/60 bg-card/60">
                    <button
                      onClick={() => setShowAdvancedJson((v) => !v)}
                      className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span>Modo avanzado (editar JSON directamente)</span>
                      <span className="text-xs">{showAdvancedJson ? "▲ Ocultar" : "▼ Mostrar"}</span>
                    </button>
                    {showAdvancedJson && (
                      <div className="border-t border-border/60 p-4 space-y-3">
                        <Textarea
                          value={jsonDraft}
                          onChange={(e) => setJsonDraft(e.target.value)}
                          className="min-h-[200px] font-mono text-xs"
                        />
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={handleApplyJson}>Aplicar JSON</Button>
                          <Button variant="outline" size="sm" onClick={() => setConfig(FALLBACK_CONFIG)}>Restablecer valores por defecto</Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    {step2Error && (
                      <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {step2Error}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <Button variant="outline" size="lg" onClick={() => { setWizardStep(1); setStep2Error(null); }}>
                        <ArrowLeft className="h-4 w-4" />
                        Atrás
                      </Button>
                      <Button size="lg" onClick={() => {
                        const sumOf = (list: string[]) => list.reduce((acc, v) => { const n = parseInt(v.trim(), 10); return Number.isFinite(n) ? acc + n : acc; }, 0);
                        const hasV2 = (parseIntSafe(config.variable) ?? 2) >= 2;
                        const v1Sum = sumOf(getList("porcentaje"));
                        const v2Sum = hasV2 ? sumOf(getList("porcentaje_v2")) : 100;
                        if (v1Sum !== 100 || v2Sum !== 100) {
                          setStep2Error("Los porcentajes de cada variable deben sumar exactamente 100%"); return;
                        }
                        const totalV1 = parseIntSafe(config.item) ?? 0;
                        const usedV1 = estructuraV1.flatMap((d) => d.indicadores.flatMap((i) => i.items)).length;
                        if (totalV1 > 0 && usedV1 !== totalV1) {
                          setStep2Error(`La estructura de V1 tiene ${usedV1} ítems pero se esperan ${totalV1}`); return;
                        }
                        if (hasV2) {
                          const totalV2 = parseIntSafe(config.itemv2) ?? 0;
                          const usedV2 = estructuraV2.flatMap((d) => d.indicadores.flatMap((i) => i.items)).length;
                          if (totalV2 > 0 && usedV2 !== totalV2) {
                            setStep2Error(`La estructura de V2 tiene ${usedV2} ítems pero se esperan ${totalV2}`); return;
                          }
                        }
                        setStep2Error(null);
                        setWizardStep(3);
                      }}>
                        Siguiente: Generar
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Generar */}
              {wizardStep === 3 && (
                <div className="step-enter space-y-5">
                  {/* Summary */}
                  <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                    <CardHeader>
                      <CardTitle>Resumen de tu configuración</CardTitle>
                      <CardDescription>Revisa que todo esté correcto antes de generar.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                        {[
                          { label: "Muestra", value: `${getScalar("nommuestra")} (${getScalar("muestra")} personas)` },
                          { label: "Variables", value: getScalar("variable") },
                          { label: "Preguntas V1", value: getScalar("item") },
                          ...((parseIntSafe(config.variable) ?? 2) >= 2 ? [{ label: "Preguntas V2", value: getScalar("itemv2") }] : []),
                          { label: "Niveles baremo V1", value: getScalar("escala") },
                          ...((parseIntSafe(config.variable) ?? 2) >= 2 ? [{ label: "Niveles baremo V2", value: getScalar("escala_v2") }] : []),
                          { label: "Opciones por pregunta", value: `1 al ${getScalar("respuesta")}` },
                          { label: "Relación", value: getScalar("relacionversa") === "1" ? "Inversa" : "Directa" },
                          { label: "Variables", value: getList("nombre_dimension").filter(Boolean).join(", ") || "—" },
                        ].map((item) => (
                          <div key={item.label} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
                            <p className="text-xs text-muted-foreground">{item.label}</p>
                            <p className="mt-0.5 text-sm font-semibold truncate">{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Validations */}
                  {validationMessages.length > 0 && (
                    <Card className="rounded-2xl border-danger/40 bg-danger/5 shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base text-danger">Corrige estos errores antes de continuar</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {validationMessages.map((msg) => (
                          <div key={msg} className="flex items-start gap-2 text-sm text-danger">
                            <span className="mt-0.5 shrink-0">•</span>
                            {msg}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Generate button */}
                  <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                    <CardContent className="pt-6 space-y-4">
                      {errorMessage && (
                        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{errorMessage}</div>
                      )}
                      <Button
                        size="lg"
                        className="h-14 w-full text-base"
                        onClick={handleGenerate}
                        disabled={isGenerating || validationMessages.length > 0}
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin" />
                            {`Generando tu Excel...${generationElapsed > 0 ? ` (${generationElapsed}s)` : ""}`}
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-5 w-5" />
                            Generar tabulación
                          </>
                        )}
                      </Button>
                      <p className="text-center text-xs text-muted-foreground">{generationProgressMessage}</p>
                    </CardContent>
                  </Card>

                  {/* Result */}
                  {result && (
                    <Card className="step-enter rounded-2xl border-primary/30 bg-primary/5 shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-primary flex items-center gap-2">
                          <Check className="h-5 w-5" />
                          ¡Tabulación generada exitosamente!
                        </CardTitle>
                        <CardDescription>Generado el {new Date(result.generatedAt).toLocaleString()}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {/* Correlation: con 1 sola variable no aplica */}
                        {result.correlation !== null && (
                          <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                            <p className="text-sm text-muted-foreground">Coeficiente de correlación de Pearson</p>
                            <div className="mt-1 flex items-baseline gap-3">
                              <span className="text-4xl font-bold tracking-tight text-primary">{result.correlation.toFixed(3)}</span>
                              <div>
                                <span className={cn("text-sm font-semibold", correlationInfo(result.correlation).colorClass)}>
                                  Correlación {correlationInfo(result.correlation).label}
                                </span>
                                <p className="text-xs text-muted-foreground">{correlationInfo(result.correlation).explanation}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Avisos del generador */}
                        {result.warnings.length > 0 && (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-1.5">
                            {result.warnings.map((w) => (
                              <p key={w} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {w}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Downloads */}
                        {downloadLinks && (
                          <div>
                            <p className="mb-3 text-sm font-medium text-foreground">Descarga tus archivos</p>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <a href={downloadLinks.xlsx} download="Tabulacion_generada.xlsx" className="block">
                                <div className="rounded-xl border-2 border-primary/40 bg-primary/10 p-4 text-center transition-all hover:border-primary hover:bg-primary/20">
                                  <Download className="mx-auto h-6 w-6 text-primary" />
                                  <p className="mt-2 text-sm font-semibold text-primary">Descargar Excel</p>
                                  <p className="text-xs text-muted-foreground">Archivo principal</p>
                                </div>
                              </a>
                              <a href={downloadLinks.csv} download="Tabulacion_base.csv" className="block">
                                <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-center transition-all hover:border-primary/40 hover:bg-accent">
                                  <Download className="mx-auto h-5 w-5 text-muted-foreground" />
                                  <p className="mt-2 text-sm font-medium">Descargar CSV</p>
                                  <p className="text-xs text-muted-foreground">Datos base</p>
                                </div>
                              </a>
                              <a href={downloadLinks.json} download="Tabulacion.json" className="block">
                                <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-center transition-all hover:border-primary/40 hover:bg-accent">
                                  <Download className="mx-auto h-5 w-5 text-muted-foreground" />
                                  <p className="mt-2 text-sm font-medium">Descargar JSON</p>
                                  <p className="text-xs text-muted-foreground">Configuración</p>
                                </div>
                              </a>
                            </div>
                          </div>
                        )}

                        {/* Sheet preview */}
                        <div>
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-medium">Vista previa del Excel</p>
                            {result.sheetNames.length > 0 && (
                              <select
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                value={selectedSheet || result.sheetNames[0]}
                                onChange={(e) => setSelectedSheet(e.target.value)}
                              >
                                {result.sheetNames.map((name) => (
                                  <option key={name} value={name}>{name}</option>
                                ))}
                              </select>
                            )}
                          </div>
                          <PreviewTable rows={result.sheetData[selectedSheet || (result.sheetNames[0] ?? "")] ?? []} maxRows={10} />
                        </div>

                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => { setResult(null); setDownloadLinks(null); setWizardStep(1); setErrorMessage(null); }}
                        >
                          Generar otra tabulación
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex justify-start">
                    <Button variant="outline" size="lg" onClick={() => { setWizardStep(2); setErrorMessage(null); setStatusMessage("Listo para generar."); }}>
                      <ArrowLeft className="h-4 w-4" />
                      Atrás
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Integraciones (clave de API + Tutorica Forms) ── */}
          {activeSection === "forms" && authUser && (
            <div className="step-enter mx-auto max-w-3xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Forms</h2>
                <p className="mt-1 text-sm text-muted-foreground">Servicios incluidos con tu suscripción.</p>
              </div>

              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-primary" />
                        Tutorica Forms
                      </CardTitle>
                      <CardDescription className="mt-1 max-w-[52ch]">
                        Rellena tu encuesta de Google Forms automáticamente, con perfiles y distribuciones
                        configurables, desde una extensión de Chrome conectada a tu cuenta.
                      </CardDescription>
                    </div>
                    <Badge>Incluido en tu plan</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-xl border border-border bg-background/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Tu clave de API</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {apiKeyInfo === null
                            ? "Cargando estado de tu clave..."
                            : apiKeyInfo.hasKey
                              ? `Clave activa terminada en ···${apiKeyInfo.last4} (creada el ${formatDateTime(apiKeyInfo.createdAt)})`
                              : "Aún no tienes una clave. Genérala para conectar la extensión."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={generateApiKey} disabled={apiKeyBusy}>
                          {apiKeyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                          {apiKeyInfo?.hasKey ? "Regenerar" : "Generar clave"}
                        </Button>
                        {apiKeyInfo?.hasKey && (
                          <Button size="sm" variant="outline" onClick={revokeApiKey} disabled={apiKeyBusy}>
                            Revocar
                          </Button>
                        )}
                      </div>
                    </div>

                    {newApiKey && (
                      <div className="step-enter mt-4 rounded-lg border border-primary/40 bg-accent/60 p-3">
                        <p className="text-xs font-semibold text-accent-foreground">
                          Copia tu clave ahora: por seguridad no volverá a mostrarse.
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
                            {newApiKey}
                          </code>
                          <Button size="sm" variant="outline" onClick={() => copyText(newApiKey)}>
                            {apiKeyCopied ? <Check className="h-4 w-4 text-primary" /> : null}
                            {apiKeyCopied ? "Copiada" : "Copiar"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-semibold">Cómo conectar la extensión</p>
                    <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
                      {[
                        <>
                          Instala la extensión <strong className="text-foreground">Tutorica Forms</strong> desde la{" "}
                          <a
                            href="https://chromewebstore.google.com/detail/tutorica-forms/kdppbednjfajcjogdajmagfabidfjmem"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
                          >
                            Chrome Web Store
                          </a>.
                        </>,
                        <>
                          Abre la extensión e <strong className="text-foreground">inicia sesión</strong> con tu correo y
                          contraseña de TesisTab: tu clave de API se configura sola. (También puedes pegar una clave
                          manual en "Avanzado".)
                        </>,
                        <>
                          Verifica que la tarjeta de conexión del popup diga{" "}
                          <strong className="text-foreground">Conectado</strong>.
                        </>,
                        <>Abre tu encuesta de Google Forms y configura el llenado desde el panel de la extensión.</>,
                      ].map((paso, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                            {i + 1}
                          </span>
                          <span>{paso}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    La clave funciona mientras tu suscripción esté vigente. Si vence, la extensión mostrará
                    "suscripción vencida" hasta que la renueves.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Usuarios (admin) ── */}
          {activeSection === "usuarios" && isAdmin && (
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
                      const isSelf = user.id === authUser?.id;
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
          )}

        </main>
      </div>
    </div>
  );
}
