import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  Check,
  Clock3,
  Download,
  FileSpreadsheet,
  Loader2,
  Moon,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  Zap,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";

type ConfigValue = string | string[] | number | boolean | null | undefined;
type TabConfig = Record<string, ConfigValue>;
type TableCell = string | number | boolean | null;
type TableRows = TableCell[][];

interface InlineGenerateResponse {
  correlation: number;
  baseCsv: string;
  excelBase64: string;
  excelFileName?: string;
  error?: string;
}

interface DownloadLinks {
  json: string;
  csv: string;
  xlsx: string;
}

interface GeneratedResult {
  correlation: number;
  csvRows: TableRows;
  sheetNames: string[];
  sheetData: Record<string, TableRows>;
  generatedAt: string;
}

interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  plan: string;
  subscriptionEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

interface AuthLoginResponse {
  token?: string;
  tokenExpiresAt?: string;
  user?: AuthUser;
  error?: string;
}

interface AuthUsersResponse {
  users?: AuthUser[];
  error?: string;
}

type ThemeMode = "light" | "dark";
type AppView = "landing" | "app";
type AppTabId = "config" | "excel" | "admin";

const DEFAULT_API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

const FALLBACK_CONFIG: TabConfig = {
  muestra: "289",
  item: "18",
  itemv2: "9",
  variable: "2",
  nommuestra: "Beneficiarios",
  escala: "3",
  respuesta: "5",
  relacionversa: "0",
  nombre_escala: ["Bajo", "Medio", "Alto"],
  nombre_respuesta: [
    "Totalmente en desacuerdo",
    "En desacuerdo",
    "Ni de acuerdo ni en desacuerdo",
    "De acuerdo",
    "Totalmente de acuerdo",
  ],
  desde: ["18", "42", "66"],
  hasta: ["41", "65", "90"],
  porcentaje: ["46", "35", "19"],
  cantidad: ["133", "101", "55"],
  nombre_dimension: ["Gestion de abastecimiento", "Satisfaccion del servicio"],
  numero_dimension: ["1", "2"],
  nombre_indicador: ["Planificacion", "Transparencia", "Cumplimiento normativo", "Satisfaccion del servicio"],
  numero_indicador0: ["3", "1"],
  numero_pregunta0: ["6", "6", "6"],
  numero_pregunta1: ["9"],
};

const BASE_TABS = [
  { id: "config", label: "Configuración" },
  { id: "excel", label: "Tabulación Excel" },
] as const;

const ADMIN_TAB = { id: "admin", label: "Usuarios" } as const;

const scalarFieldRows = [
  [
    { key: "nommuestra", label: "Nombre de muestra", hint: "Etiqueta que aparece en filas y tablas." },
    { key: "muestra", label: "N° de muestra", hint: "Cantidad de registros (mínimo 2)." },
    { key: "variable", label: "N° de variables", hint: "Solo referencia para tu instrumento." },
  ],
  [
    { key: "item", label: "N° de items (V1)", hint: "Preguntas de la variable 1." },
    { key: "itemv2", label: "N° de items (V2)", hint: "Preguntas de la variable 2." },
    { key: "escala", label: "Cantidad de escalas", hint: "Niveles valorativos." },
  ],
  [
    { key: "respuesta", label: "N° de respuestas", hint: "Valor máximo por item (ej: 5)." },
  ],
] as const;

const listGroups = [
  {
    title: "Escalas y respuestas",
    description: "Catálogos de texto que se imprimen en las hojas de tabulación.",
    fields: [
      { key: "nombre_escala", label: "Nombre escala", placeholder: "Ej: Bajo" },
      { key: "nombre_respuesta", label: "Nombre respuesta", placeholder: "Ej: De acuerdo" },
    ],
  },
  {
    title: "Baremos",
    description: "Rangos y distribución para interpretación.",
    fields: [
      { key: "desde", label: "Desde", placeholder: "Ej: 18" },
      { key: "hasta", label: "Hasta", placeholder: "Ej: 41" },
      { key: "porcentaje", label: "Porcentaje", placeholder: "Ej: 46" },
      { key: "cantidad", label: "Cantidad", placeholder: "Ej: 133" },
    ],
  },
  {
    title: "Dimensiones e indicadores",
    description: "Estructura conceptual de tu instrumento.",
    fields: [
      { key: "nombre_dimension", label: "Nombre dimensión", placeholder: "Ej: Gestión de abastecimiento" },
      { key: "numero_dimension", label: "Número dimensión", placeholder: "Ej: 1" },
      { key: "nombre_indicador", label: "Nombre indicador", placeholder: "Ej: Transparencia" },
      { key: "numero_indicador0", label: "Número indicador", placeholder: "Ej: 3" },
    ],
  },
  {
    title: "Preguntas por variable",
    description: "Cantidad de preguntas por bloque.",
    fields: [
      { key: "numero_pregunta0", label: "Preguntas V1", placeholder: "Ej: 6" },
      { key: "numero_pregunta1", label: "Preguntas V2", placeholder: "Ej: 9" },
    ],
  },
];

function toStringValue(value: ConfigValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value);
}

function toStringList(value: ConfigValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? ""));
}

function normalizeList(values: string[]): string[] {
  const cleaned = values.map((item) => item ?? "");
  while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === "") {
    cleaned.pop();
  }
  return cleaned;
}

function parseIntSafe(value: ConfigValue): number | null {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function formatDateTime(dateIso: string | null | undefined): string {
  if (!dateIso) return "Sin fecha";
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return "Fecha inválida";
  return date.toLocaleString();
}

function getSubscriptionLabel(user: AuthUser): string {
  if (user.role === "admin") return "Sin vencimiento";
  if (!user.subscriptionEndsAt) return "Sin fecha";
  const expiresAt = new Date(user.subscriptionEndsAt);
  if (Number.isNaN(expiresAt.getTime())) return "Fecha inválida";
  if (expiresAt.getTime() < Date.now()) return `Vencida: ${expiresAt.toLocaleString()}`;
  return `Vence: ${expiresAt.toLocaleString()}`;
}

function revokeDownloadLinks(links: DownloadLinks | null) {
  if (!links) return;
  URL.revokeObjectURL(links.json);
  URL.revokeObjectURL(links.csv);
  URL.revokeObjectURL(links.xlsx);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function csvToRows(csvText: string): TableRows {
  const workbook = XLSX.read(csvText, { type: "string" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  return XLSX.utils.sheet_to_json<TableCell[]>(workbook.Sheets[firstSheet], {
    header: 1,
    raw: false,
    defval: "",
  });
}

function workbookToSheetRows(arrayBuffer: Uint8Array): { names: string[]; data: Record<string, TableRows> } {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const data: Record<string, TableRows> = {};
  workbook.SheetNames.forEach((name) => {
    data[name] = XLSX.utils.sheet_to_json<TableCell[]>(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
    });
  });
  return { names: workbook.SheetNames, data };
}

function ListEditorField({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const safeValues = values.length > 0 ? values : [""];

  const updateAt = (index: number, nextValue: string) => {
    const next = [...safeValues];
    next[index] = nextValue;
    onChange(normalizeList(next));
  };

  const removeAt = (index: number) => {
    const next = safeValues.filter((_, i) => i !== index);
    onChange(normalizeList(next));
  };

  const addItem = () => {
    onChange([...safeValues, ""]);
  };

  return (
    <div className="rounded-md border border-border/80 bg-background/70 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{label}</h4>
        <Button variant="ghost" size="sm" onClick={addItem}>
          + Agregar
        </Button>
      </div>
      <div className="space-y-2">
        {safeValues.map((value, index) => (
          <div className="flex items-center gap-2" key={`${label}-${index}`}>
            <Input
              value={value}
              placeholder={placeholder}
              onChange={(event) => updateAt(index, event.target.value)}
            />
            <Button variant="outline" size="sm" onClick={() => removeAt(index)}>
              Quitar
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewTable({ rows, maxRows = 12 }: { rows: TableRows; maxRows?: number }) {
  if (!rows.length) {
    return <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Sin datos para mostrar.</p>;
  }

  const header = rows[0] ?? [];
  const body = rows.slice(1, maxRows + 1);

  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-muted/70">
          <tr>
            {header.map((cell, idx) => (
              <th key={`h-${idx}`} className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">
                {String(cell ?? "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`r-${rowIndex}`} className="odd:bg-background even:bg-muted/30">
              {header.map((_, colIndex) => (
                <td key={`c-${rowIndex}-${colIndex}`} className="border-b border-border/70 px-3 py-2 text-muted-foreground">
                  {String(row[colIndex] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resolveViewFromPath(): AppView {
  return window.location.pathname.startsWith("/app") ? "app" : "landing";
}

function LandingPage({
  themeMode,
  onToggleTheme,
  onOpenApp,
}: {
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onOpenApp: () => void;
}) {
  const [billingMode, setBillingMode] = useState<"monthly" | "yearly">("monthly");

  const plans = useMemo(
    () => [
      {
        id: "pro",
        name: "Plan Profesional",
        audience: "Usuarios individuales",
        icon: UserRound,
        priceMonthlyUsd: "USD 29",
        priceYearlyUsd: "USD 290",
        priceMonthlyPen: "S/ 109",
        priceYearlyPen: "S/ 1,090",
        description: "Ideal para tesistas y asesores que trabajan de forma independiente.",
        highlights: [
          "1 usuario",
          "Hasta 15 proyectos activos",
          "Generación de Excel y CSV",
          "Soporte por correo",
        ],
        cta: "Comenzar ahora",
      },
      {
        id: "business",
        name: "Plan Empresa",
        audience: "Universidades y consultoras",
        icon: Building2,
        priceMonthlyUsd: "USD 129",
        priceYearlyUsd: "USD 1,290",
        priceMonthlyPen: "S/ 485",
        priceYearlyPen: "S/ 4,850",
        description: "Pensado para equipos con múltiples tesis, control administrativo y trazabilidad.",
        highlights: [
          "Hasta 20 usuarios",
          "Proyectos ilimitados",
          "Panel administrador + roles",
          "Soporte prioritario y onboarding",
        ],
        cta: "Hablar con ventas",
      },
    ],
    [],
  );

  const businessFeatures = [
    "Gestión de usuarios por administrador",
    "Asignación de suscripciones por tiempo",
    "Control de uso por cuenta",
    "Escalado para múltiples tesis por equipo",
  ];

  const productFeatures = [
    {
      title: "Generación automatizada",
      desc: "Convierte configuración en Excel de tabulación listo para informe en segundos.",
      icon: Zap,
    },
    {
      title: "Consistencia metodológica",
      desc: "Mantén reglas, dimensiones e indicadores estandarizados entre tesis.",
      icon: ShieldCheck,
    },
    {
      title: "Operación escalable",
      desc: "Maneja desde un tesista hasta equipos institucionales con múltiples proyectos.",
      icon: ChartNoAxesCombined,
    },
  ];

  return (
    <div className="container py-8">
      <header className="mb-8 overflow-hidden rounded-[28px] border border-border/70 bg-[linear-gradient(145deg,#f5f7fb_0%,#e8eef7_100%)] p-6 shadow-[0_20px_70px_rgba(15,23,42,0.12)] dark:bg-[linear-gradient(145deg,#1b2534_0%,#111827_100%)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-500/20 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-800 dark:border-slate-200/20 dark:bg-slate-100/10 dark:text-slate-100">
            <Sparkles className="h-4 w-4" />
            Sistema de Tabulación como Servicio
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onToggleTheme}>
              {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {themeMode === "dark" ? "Modo claro" : "Modo oscuro"}
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenApp}>
              Entrar al sistema
            </Button>
          </div>
        </div>
      </header>

      <section className="mb-8 grid gap-5 rounded-[28px] border border-border/70 bg-card/95 p-8 shadow-[0_18px_54px_rgba(15,23,42,0.1)] md:grid-cols-[1.4fr_1fr]">
        <div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">
            Plataforma de tabulación para tesis, con control por suscripción.
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground md:text-base">
            Centraliza la configuración metodológica, genera archivos Excel automáticamente y reduce el tiempo operativo para
            cada nueva tesis. Lista para venderse como servicio a usuarios individuales o equipos institucionales.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="lg" onClick={onOpenApp}>
              Probar generación
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={onOpenApp}>
              Ver demo comercial
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <Badge variant="muted">
              <Clock3 className="mr-1 h-3.5 w-3.5" />
              Implementación rápida
            </Badge>
            <Badge variant="muted">
              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
              Control de acceso por tiempo
            </Badge>
            <Badge variant="muted">
              <Server className="mr-1 h-3.5 w-3.5" />
              API + Docker + Netlify
            </Badge>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-400/20 bg-[linear-gradient(145deg,#f7fafc_0%,#edf2f7_100%)] p-5 dark:border-slate-200/20 dark:bg-[linear-gradient(145deg,#1e293b_0%,#0f172a_100%)]">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Qué puedes vender</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              Servicio mensual para tesistas.
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              Plan anual para consultoras y universidades.
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              Gestión de cuentas con fecha de vencimiento.
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              Generación rápida para múltiples tesis.
            </li>
          </ul>
        </div>
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-3">
        {productFeatures.map((feature) => (
          <Card key={feature.title} className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <feature.icon className="h-4 w-4 text-primary" />
                {feature.title}
              </CardTitle>
              <CardDescription>{feature.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="mb-8">
        <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Planes y precios</CardTitle>
                <CardDescription>Dos modelos comerciales para distintos tipos de cliente.</CardDescription>
              </div>
              <div className="inline-flex rounded-lg border border-border bg-background/90 p-1">
                <button
                  className={cn(
                    "rounded px-3 py-1 text-sm font-medium",
                    billingMode === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                  onClick={() => setBillingMode("monthly")}
                >
                  Mensual
                </button>
                <button
                  className={cn(
                    "rounded px-3 py-1 text-sm font-medium",
                    billingMode === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                  onClick={() => setBillingMode("yearly")}
                >
                  Anual
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-2xl border border-border/80 bg-background/90 p-5 shadow-sm">
                <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-primary">
                  <plan.icon className="h-4 w-4" />
                  {plan.audience}
                </div>
                <h3 className="text-xl font-bold">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                <div className="mt-4">
                  <p className="text-3xl font-bold">
                    {billingMode === "monthly" ? plan.priceMonthlyUsd : plan.priceYearlyUsd}
                    <span className="ml-1 text-base font-medium text-muted-foreground">
                      / {billingMode === "monthly" ? "mes" : "año"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm font-medium text-muted-foreground">
                    {billingMode === "monthly" ? plan.priceMonthlyPen : plan.priceYearlyPen}
                    <span className="ml-1">por {billingMode === "monthly" ? "mes" : "año"}</span>
                  </p>
                </div>
                <ul className="mt-4 space-y-2 text-sm">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button className="mt-5 w-full" variant={plan.id === "business" ? "outline" : "default"} onClick={onOpenApp}>
                  {plan.cta}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
          <CardHeader>
            <CardTitle>Usuarios normales</CardTitle>
            <CardDescription>Para quien necesita resolver tesis con rapidez y consistencia.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              Configuración guiada por formulario.
            </p>
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              Generación inmediata de `JSON`, `CSV` y `XLSX`.
            </p>
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              Vista previa de hojas antes de descargar.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
          <CardHeader>
            <CardTitle>Empresas / instituciones</CardTitle>
            <CardDescription>Orientado a operación continua con control de acceso.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {businessFeatures.map((item) => (
              <p key={item} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-primary" />
                {item}
              </p>
            ))}
          </CardContent>
        </Card>
      </section>

      <footer className="rounded-[28px] border border-border/70 bg-card/95 p-6 shadow-[0_16px_48px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">¿Listo para venderlo como servicio?</h3>
            <p className="text-sm text-muted-foreground">
              Puedes arrancar con esta versión y luego activar login, roles y suscripciones por fecha.
            </p>
          </div>
          <Button size="lg" onClick={onOpenApp}>
            Entrar al sistema
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const [appView, setAppView] = useState<AppView>(() => resolveViewFromPath());
  const [activeTab, setActiveTab] = useState<AppTabId>("config");
  const [config, setConfig] = useState<TabConfig>(FALLBACK_CONFIG);
  const [jsonDraft, setJsonDraft] = useState<string>(JSON.stringify(FALLBACK_CONFIG, null, 2));
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(() => localStorage.getItem("apiBaseUrl") || DEFAULT_API_BASE_URL);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const savedTheme = localStorage.getItem("themeMode");
    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  });
  const [statusMessage, setStatusMessage] = useState<string>("Listo para generar.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [downloadLinks, setDownloadLinks] = useState<DownloadLinks | null>(null);

  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem("authToken") ?? "");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(() => Boolean(localStorage.getItem("authToken")));
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>(() => localStorage.getItem("loginEmail") ?? "");
  const [loginPassword, setLoginPassword] = useState<string>("");

  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [usersStatusMessage, setUsersStatusMessage] = useState<string>("Sincroniza usuarios para ver el estado.");
  const [usersErrorMessage, setUsersErrorMessage] = useState<string | null>(null);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState<string>("");
  const [newUserPassword, setNewUserPassword] = useState<string>("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [newUserPlan, setNewUserPlan] = useState<string>("pro");
  const [newUserDays, setNewUserDays] = useState<string>("30");

  const isAdmin = authUser?.role === "admin";

  const visibleTabs = useMemo(() => {
    if (isAdmin) return [...BASE_TABS, ADMIN_TAB];
    return [];
  }, [isAdmin]);

  useEffect(() => {
    let isMounted = true;
    fetch("/default-config.json")
      .then(async (res) => {
        if (!res.ok) throw new Error("No se pudo cargar configuración inicial.");
        const data = (await res.json()) as TabConfig;
        if (!isMounted || !data || Array.isArray(data)) return;
        setConfig(data);
      })
      .catch(() => {
        // fallback local
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setJsonDraft(JSON.stringify(config, null, 2));
  }, [config]);

  useEffect(() => {
    localStorage.setItem("apiBaseUrl", apiBaseUrl);
  }, [apiBaseUrl]);

  useEffect(() => {
    if (authToken) {
      localStorage.setItem("authToken", authToken);
    } else {
      localStorage.removeItem("authToken");
    }
  }, [authToken]);

  useEffect(() => {
    const onPopState = () => setAppView(resolveViewFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    localStorage.setItem("themeMode", themeMode);
    document.documentElement.classList.toggle("dark", themeMode === "dark");
  }, [themeMode]);

  useEffect(() => () => revokeDownloadLinks(downloadLinks), [downloadLinks]);

  useEffect(() => {
    if (!authToken) {
      setAuthLoading(false);
      setAuthUser(null);
      return;
    }
    let isMounted = true;
    setAuthLoading(true);
    setAuthError(null);

    fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
      .then(async (res) => {
        const payload = (await res.json()) as { user?: AuthUser; error?: string };
        if (!res.ok || !payload.user) {
          throw new Error(payload.error ?? `Error HTTP ${res.status}`);
        }
        if (!isMounted) return;
        setAuthUser(payload.user);
      })
      .catch((error) => {
        if (!isMounted) return;
        setAuthToken("");
        setAuthUser(null);
        setAuthError(error instanceof Error ? error.message : "No se pudo validar la sesión.");
      })
      .finally(() => {
        if (!isMounted) return;
        setAuthLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    if (activeTab === "admin" && authUser?.role !== "admin") {
      setActiveTab("config");
    }
  }, [activeTab, authUser]);

  const validationMessages = useMemo(() => {
    const issues: string[] = [];
    const muestra = parseIntSafe(config.muestra);
    const item = parseIntSafe(config.item);
    const itemv2 = parseIntSafe(config.itemv2);
    const escala = parseIntSafe(config.escala);
    const respuesta = parseIntSafe(config.respuesta);

    if (muestra === null || muestra < 2) issues.push("N° de muestra debe ser mayor o igual a 2.");
    if (item === null || item <= 0) issues.push("N° de items (V1) debe ser mayor a 0.");
    if (itemv2 === null || itemv2 <= 0) issues.push("N° de items (V2) debe ser mayor a 0.");
    if (escala === null || escala <= 0) issues.push("Cantidad de escalas debe ser mayor a 0.");
    if (respuesta === null || respuesta <= 0) issues.push("N° de respuestas debe ser mayor a 0.");

    const dimensions = toStringList(config.nombre_dimension).filter((itemValue) => itemValue.trim() !== "");
    if (!dimensions.length) issues.push("Debe existir al menos una dimensión.");

    const indicatorNames = toStringList(config.nombre_indicador).filter((itemValue) => itemValue.trim() !== "");
    const indicatorCounts = toStringList(config.numero_indicador0)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (indicatorCounts.length > 0 && indicatorNames.length > 0) {
      const total = indicatorCounts.reduce((sum, value) => sum + value, 0);
      if (total !== indicatorNames.length) {
        issues.push("La suma de número indicador no coincide con los nombres de indicador.");
      }
    }

    return issues;
  }, [config]);

  const setScalar = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const setList = (key: string, values: string[]) => {
    setConfig((prev) => ({ ...prev, [key]: normalizeList(values) }));
  };

  const getScalar = (key: string) => toStringValue(config[key]);
  const getList = (key: string) => toStringList(config[key]);

  const handleApplyJson = () => {
    setErrorMessage(null);
    try {
      const parsed = JSON.parse(jsonDraft) as TabConfig;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("El JSON debe ser un objeto.");
      }
      setConfig(parsed);
      setStatusMessage("JSON aplicado correctamente.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo aplicar el JSON.");
    }
  };

  const loadUsers = async () => {
    if (!authToken || authUser?.role !== "admin") return;
    setIsUsersLoading(true);
    setUsersErrorMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const payload = (await response.json()) as AuthUsersResponse;
      if (!response.ok || !Array.isArray(payload.users)) {
        throw new Error(payload.error ?? `Error HTTP ${response.status}`);
      }
      setManagedUsers(payload.users);
      setUsersStatusMessage(`Usuarios sincronizados: ${payload.users.length}.`);
    } catch (error) {
      setUsersErrorMessage(error instanceof Error ? error.message : "No se pudo obtener usuarios.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthError(null);
    const email = loginEmail.trim();
    if (!email || !loginPassword) {
      setAuthError("Completa email y contraseña.");
      return;
    }
    setAuthLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password: loginPassword,
        }),
      });
      const payload = (await response.json()) as AuthLoginResponse;
      if (!response.ok || !payload.token || !payload.user) {
        throw new Error(payload.error ?? `Error HTTP ${response.status}`);
      }
      setAuthToken(payload.token);
      setAuthUser(payload.user);
      setLoginPassword("");
      localStorage.setItem("loginEmail", email);
      setStatusMessage("Sesión iniciada.");
      if (payload.user.role === "admin") {
        setActiveTab("admin");
      }
    } catch (error) {
      setAuthToken("");
      setAuthUser(null);
      setAuthError(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthToken("");
    setAuthUser(null);
    setManagedUsers([]);
    setAuthError(null);
    setUsersErrorMessage(null);
    setActiveTab("config");
    setStatusMessage("Sesión cerrada.");
  };

  const handleCreateUser = async () => {
    setUsersErrorMessage(null);
    if (!authToken) return;
    const email = newUserEmail.trim();
    if (!email || !newUserPassword) {
      setUsersErrorMessage("Email y contraseña son obligatorios.");
      return;
    }
    const subscriptionDays = Number.parseInt(newUserDays, 10);
    if (!Number.isFinite(subscriptionDays) || subscriptionDays <= 0) {
      setUsersErrorMessage("Los días de suscripción deben ser mayores a 0.");
      return;
    }
    setIsUsersLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          email,
          password: newUserPassword,
          role: newUserRole,
          plan: newUserPlan,
          subscriptionDays,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Error HTTP ${response.status}`);
      }
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("user");
      setNewUserPlan("pro");
      setNewUserDays("30");
      setUsersStatusMessage("Usuario creado correctamente.");
      await loadUsers();
    } catch (error) {
      setUsersErrorMessage(error instanceof Error ? error.message : "No se pudo crear el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const patchManagedUser = async (userId: string, patch: Record<string, unknown>, successMessage: string) => {
    if (!authToken) return;
    setIsUsersLoading(true);
    setUsersErrorMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Error HTTP ${response.status}`);
      }
      setUsersStatusMessage(successMessage);
      await loadUsers();
    } catch (error) {
      setUsersErrorMessage(error instanceof Error ? error.message : "No se pudo actualizar el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const deleteManagedUser = async (userId: string) => {
    if (!authToken) return;
    setIsUsersLoading(true);
    setUsersErrorMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users/${userId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Error HTTP ${response.status}`);
      }
      setUsersStatusMessage("Usuario eliminado.");
      await loadUsers();
    } catch (error) {
      setUsersErrorMessage(error instanceof Error ? error.message : "No se pudo eliminar el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const handleGenerate = async () => {
    setErrorMessage(null);
    if (!authToken || !authUser) {
      setErrorMessage("Debes iniciar sesión para generar tabulación.");
      return;
    }
    if (authUser.role !== "admin") {
      setErrorMessage("Solo el administrador puede configurar, generar y descargar tabulación.");
      return;
    }
    if (validationMessages.length > 0) {
      setErrorMessage("Corrige las validaciones antes de generar.");
      return;
    }

    setIsGenerating(true);
    setStatusMessage("Enviando configuración a la API...");

    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          config,
          responseMode: "inline",
        }),
      });

      const payload = (await response.json()) as InlineGenerateResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? `Error HTTP ${response.status}`);
      }

      if (typeof payload.correlation !== "number" || !payload.baseCsv || !payload.excelBase64) {
        throw new Error("La API respondió sin los artefactos esperados.");
      }

      setStatusMessage("Procesando resultados de tabulación...");
      const excelBytes = base64ToUint8Array(payload.excelBase64);
      const csvRows = csvToRows(payload.baseCsv);
      const parsedWorkbook = workbookToSheetRows(excelBytes);

      const nextLinks: DownloadLinks = {
        json: URL.createObjectURL(
          new Blob([JSON.stringify(config, null, 2)], { type: "application/json;charset=utf-8" }),
        ),
        csv: URL.createObjectURL(new Blob([payload.baseCsv], { type: "text/csv;charset=utf-8" })),
        xlsx: URL.createObjectURL(
          new Blob([excelBytes], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        ),
      };

      setDownloadLinks((current) => {
        revokeDownloadLinks(current);
        return nextLinks;
      });

      setResult({
        correlation: payload.correlation,
        csvRows,
        sheetNames: parsedWorkbook.names,
        sheetData: parsedWorkbook.data,
        generatedAt: new Date().toISOString(),
      });
      setSelectedSheet(parsedWorkbook.names[0] ?? "");
      setActiveTab("excel");
      setStatusMessage("Tabulación generada correctamente.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo generar la tabulación.";
      setErrorMessage(message);
      if (message.toLowerCase().includes("token")) {
        setAuthToken("");
        setAuthUser(null);
      }
      setStatusMessage("Ocurrió un error.");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleTheme = () => {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
  };

  const goToApp = () => {
    if (window.location.pathname !== "/app") {
      window.history.pushState({}, "", "/app");
    }
    setAppView("app");
  };

  const goToLanding = () => {
    if (window.location.pathname !== "/") {
      window.history.pushState({}, "", "/");
    }
    setAppView("landing");
  };

  return (
    <div
      className={cn(
        "min-h-screen pb-14 transition-colors",
        themeMode === "dark"
          ? "bg-[radial-gradient(circle_at_top,#1b2534_0%,#121825_45%,#0b0f16_100%)]"
          : "bg-[radial-gradient(circle_at_top,#e4ecf8_0%,#f6f8fc_45%,#f3f5f9_100%)]",
      )}
    >
      {appView === "landing" ? (
        <LandingPage themeMode={themeMode} onToggleTheme={toggleTheme} onOpenApp={goToApp} />
      ) : (
        <div className="container pt-8">
          {authUser ? (
            <header className="mb-6 overflow-hidden rounded-[28px] border border-border/70 bg-[linear-gradient(145deg,#f5f7fb_0%,#e8eef7_100%)] p-6 shadow-[0_20px_70px_rgba(15,23,42,0.12)] dark:bg-[linear-gradient(145deg,#1b2534_0%,#111827_100%)]">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-slate-500/20 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-800 dark:border-slate-200/20 dark:bg-slate-100/10 dark:text-slate-100">
                    <Sparkles className="h-4 w-4" />
                    Frontend Netlify + API Node
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">Sistema de Tabulación</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Configura, genera y descarga tabulación con vista previa de hojas Excel.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted" className="h-fit border border-slate-500/20 bg-white/80 text-slate-800 dark:border-slate-200/20 dark:bg-slate-100/10 dark:text-slate-100">
                    <Server className="mr-1 h-3.5 w-3.5" />
                    API: {apiBaseUrl}
                  </Badge>
                  <Badge variant="muted" className="h-fit border border-slate-500/20 bg-white/80 text-slate-800 dark:border-slate-200/20 dark:bg-slate-100/10 dark:text-slate-100">
                    <UserRound className="mr-1 h-3.5 w-3.5" />
                    {authUser.email} ({authUser.role})
                  </Badge>
                  <Button variant="outline" size="sm" onClick={goToLanding}>
                    Inicio
                  </Button>
                  <Button variant="outline" size="sm" onClick={toggleTheme}>
                    {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    {themeMode === "dark" ? "Modo claro" : "Modo oscuro"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLogout}>
                    Cerrar sesión
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <Input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="https://tu-api.com" />
                <Button variant="outline" onClick={() => window.location.reload()}>
                  <RefreshCw className="h-4 w-4" />
                  Recargar app
                </Button>
              </div>
            </header>
          ) : null}

          {!authUser ? (
            <div className="flex min-h-[78vh] items-center justify-center">
              <section className="w-full max-w-5xl overflow-hidden rounded-[28px] border border-border/70 bg-card/95 shadow-[0_20px_70px_rgba(15,23,42,0.15)]">
                <div className="grid md:grid-cols-[1.1fr_1fr]">
                <div className="relative border-b border-border/60 bg-[linear-gradient(145deg,#f5f7fb_0%,#e8eef7_100%)] p-8 text-slate-900 md:border-b-0 md:border-r dark:bg-[linear-gradient(145deg,#1b2534_0%,#111827_100%)] dark:text-slate-100">
                  <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-sky-500/10 blur-2xl dark:bg-sky-300/10" />
                  <div className="absolute -bottom-16 -left-12 h-44 w-44 rounded-full bg-amber-500/10 blur-2xl dark:bg-amber-300/10" />
                  <div className="relative">
                    <Badge className="border border-slate-500/20 bg-white/80 text-slate-800 hover:bg-white dark:border-slate-200/20 dark:bg-slate-100/10 dark:text-slate-100 dark:hover:bg-slate-100/15">
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      Acceso administrativo
                    </Badge>
                    <h2 className="mt-4 text-3xl font-bold leading-tight">Panel privado del sistema de tabulación</h2>
                    <p className="mt-3 max-w-md text-sm text-slate-700 dark:text-slate-300">
                      Esta sección permite administrar usuarios, suscripciones y el proceso completo de generación.
                    </p>
                    <div className="mt-6 space-y-3">
                      <div className="rounded-xl border border-slate-400/20 bg-white/70 p-3 text-sm dark:border-slate-200/15 dark:bg-slate-100/10">
                        Solo rol <strong>admin</strong> puede configurar, generar y descargar archivos.
                      </div>
                      <div className="rounded-xl border border-slate-400/20 bg-white/70 p-3 text-sm dark:border-slate-200/15 dark:bg-slate-100/10">
                        Si tu cuenta no tiene permisos, solicita elevación al administrador principal.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-8">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h3>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={toggleTheme}>
                        {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        {themeMode === "dark" ? "Claro" : "Oscuro"}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Ingresa con tu cuenta autorizada para continuar.</p>

                  <div className="mt-6 space-y-4">
                    {authError ? (
                      <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{authError}</div>
                    ) : null}
                    <label className="space-y-2">
                      <span className="text-sm font-medium">Email</span>
                      <Input
                        value={loginEmail}
                        onChange={(event) => setLoginEmail(event.target.value)}
                        placeholder="admin@tu-dominio.com"
                        autoComplete="email"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium">Contraseña</span>
                      <Input
                        type="password"
                        value={loginPassword}
                        onChange={(event) => setLoginPassword(event.target.value)}
                        placeholder="********"
                        autoComplete="current-password"
                      />
                    </label>
                    <Button className="h-11 w-full" onClick={handleLogin} disabled={authLoading}>
                      {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Entrar al panel
                    </Button>
                    <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                      Demo local: <strong>admin@tabulacion.local</strong> / <strong>Admin12345!</strong>
                    </div>
                  </div>
                </div>
              </div>
              </section>
            </div>
          ) : null}

          {authUser ? (
            <>
              {!isAdmin ? (
                <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                  <CardHeader>
                    <CardTitle>Acceso restringido</CardTitle>
                    <CardDescription>
                      Tu cuenta está activa, pero la configuración, generación y descarga están disponibles solo para administradores.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                      Usuario: <strong>{authUser.email}</strong>
                      <br />
                      Rol: <strong>{authUser.role}</strong>
                    </div>
                    <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
                      Solicita acceso de administrador para habilitar la operación completa del sistema.
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
          <nav className="mb-6 flex rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-sm">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition",
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab === "config" ? (
            <div className="space-y-6">
                <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Parámetros generales</CardTitle>
                  <CardDescription>Configura muestra, items y escala de respuestas.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {scalarFieldRows.map((row, rowIndex) => (
                    <div className="grid gap-4 md:grid-cols-3" key={`row-${rowIndex}`}>
                      {row.map((field) => (
                        <label className="space-y-2" key={field.key}>
                          <span className="text-sm font-medium text-foreground">{field.label}</span>
                          <Input
                            value={getScalar(field.key)}
                            onChange={(event) => setScalar(field.key, event.target.value)}
                            placeholder={field.label}
                          />
                          <p className="text-xs text-muted-foreground">{field.hint}</p>
                        </label>
                      ))}
                      {row.length < 3 ? <div /> : null}
                    </div>
                  ))}

                  <div className="rounded-md border border-border/80 p-3">
                    <p className="mb-2 text-sm font-medium text-foreground">Relación esperada</p>
                    <div className="flex gap-2">
                      <Button
                        variant={getScalar("relacionversa") === "0" ? "default" : "outline"}
                        onClick={() => setScalar("relacionversa", "0")}
                      >
                        No inversa
                      </Button>
                      <Button
                        variant={getScalar("relacionversa") === "1" ? "default" : "outline"}
                        onClick={() => setScalar("relacionversa", "1")}
                      >
                        Inversa
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {listGroups.map((group) => (
                <Card key={group.title}>
                  <CardHeader>
                    <CardTitle>{group.title}</CardTitle>
                    <CardDescription>{group.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2">
                    {group.fields.map((field) => (
                      <ListEditorField
                        key={field.key}
                        label={field.label}
                        placeholder={field.placeholder}
                        values={getList(field.key)}
                        onChange={(next) => setList(field.key, next)}
                      />
                    ))}
                  </CardContent>
                </Card>
              ))}

              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Edición avanzada JSON</CardTitle>
                  <CardDescription>Pega configuración completa para reemplazar el formulario.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={jsonDraft}
                    onChange={(event) => setJsonDraft(event.target.value)}
                    className="min-h-[260px] font-mono text-xs"
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={handleApplyJson}>
                      Aplicar JSON
                    </Button>
                    <Button variant="outline" onClick={() => setConfig(FALLBACK_CONFIG)}>
                      Restablecer base
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Validaciones</CardTitle>
                  <CardDescription>Se bloquea la generación si hay errores de consistencia.</CardDescription>
                </CardHeader>
                <CardContent>
                  {validationMessages.length > 0 ? (
                    <div className="space-y-2">
                      {validationMessages.map((issue) => (
                        <div key={issue} className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                          {issue}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-primary">
                      Configuración válida para generar.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Generación</CardTitle>
                  <CardDescription>Ejecuta la API Node para crear CSV + Excel de tabulación.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{statusMessage}</div>
                  {errorMessage ? (
                    <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{errorMessage}</div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleGenerate} disabled={isGenerating || validationMessages.length > 0} size="lg">
                      {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                      Generar tabulación
                    </Button>
                    {downloadLinks ? (
                      <>
                        <a href={downloadLinks.json} download="Tabulacion.json">
                          <Button variant="outline">
                            <Download className="h-4 w-4" />
                            Descargar JSON
                          </Button>
                        </a>
                        <a href={downloadLinks.csv} download="Tabulacion_base.csv">
                          <Button variant="outline">
                            <Download className="h-4 w-4" />
                            Descargar CSV
                          </Button>
                        </a>
                        <a href={downloadLinks.xlsx} download="Tabulacion_generada.xlsx">
                          <Button variant="outline">
                            <Download className="h-4 w-4" />
                            Descargar Excel
                          </Button>
                        </a>
                      </>
                    ) : null}
                  </div>
                  {result ? (
                    <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                      <p className="text-sm text-muted-foreground">Coeficiente de correlación</p>
                      <p className="text-3xl font-bold tracking-tight text-primary">{result.correlation.toFixed(3)}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          ) : activeTab === "excel" ? (
            <div className="space-y-6">
              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Vista previa del Excel generado</CardTitle>
                  <CardDescription>Inspecciona hojas y contenido antes de descargar.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!result ? (
                    <p className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
                      Aún no hay una generación. Ve a la pestaña <strong>Configuración</strong> y pulsa <strong>Generar tabulación</strong>.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
                        <label className="space-y-1">
                          <span className="text-sm font-medium text-foreground">Hoja</span>
                          <select
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={selectedSheet}
                            onChange={(event) => setSelectedSheet(event.target.value)}
                          >
                            {result.sheetNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="space-y-1">
                          <span className="text-sm font-medium text-foreground">Correlación</span>
                          <div className="h-10 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-primary">
                            {result.correlation.toFixed(3)}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-sm font-medium text-foreground">Generado</span>
                          <div className="h-10 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            {new Date(result.generatedAt).toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="mb-2 text-sm font-semibold">Hoja seleccionada</h4>
                        <PreviewTable rows={result.sheetData[selectedSheet] ?? []} maxRows={25} />
                      </div>

                      <div>
                        <h4 className="mb-2 text-sm font-semibold">Base CSV (primeras filas)</h4>
                        <PreviewTable rows={result.csvRows} maxRows={12} />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-6">
              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Gestión de usuarios</CardTitle>
                  <CardDescription>Crea cuentas y controla suscripción por tiempo.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium">Email</span>
                      <Input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} placeholder="usuario@dominio.com" />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium">Contraseña inicial</span>
                      <Input
                        type="password"
                        value={newUserPassword}
                        onChange={(event) => setNewUserPassword(event.target.value)}
                        placeholder="Mínimo 8 caracteres"
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="space-y-2">
                      <span className="text-sm font-medium">Rol</span>
                      <select
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={newUserRole}
                        onChange={(event) => setNewUserRole(event.target.value as "admin" | "user")}
                      >
                        <option value="user">Usuario</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium">Plan</span>
                      <Input value={newUserPlan} onChange={(event) => setNewUserPlan(event.target.value)} placeholder="pro" />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium">Días de suscripción</span>
                      <Input value={newUserDays} onChange={(event) => setNewUserDays(event.target.value)} placeholder="30" />
                    </label>
                  </div>
                  {usersErrorMessage ? (
                    <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{usersErrorMessage}</div>
                  ) : null}
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{usersStatusMessage}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleCreateUser} disabled={isUsersLoading}>
                      {isUsersLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Crear usuario
                    </Button>
                    <Button variant="outline" onClick={loadUsers} disabled={isUsersLoading}>
                      Actualizar lista
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Usuarios registrados</CardTitle>
                  <CardDescription>Acciones rápidas de estado y renovación.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {managedUsers.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No hay usuarios cargados. Pulsa <strong>Actualizar lista</strong>.
                    </p>
                  ) : (
                    managedUsers.map((user) => (
                      <div key={user.id} className="rounded-md border border-border bg-background/70 p-3">
                        <p className="text-sm font-semibold">{user.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Rol: {user.role} | Estado: {user.status} | Plan: {user.plan}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getSubscriptionLabel(user)} | Último login: {formatDateTime(user.lastLoginAt)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              patchManagedUser(
                                user.id,
                                { status: user.status === "active" ? "disabled" : "active" },
                                `Estado actualizado para ${user.email}.`,
                              )
                            }
                            disabled={isUsersLoading}
                          >
                            {user.status === "active" ? "Desactivar" : "Activar"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              patchManagedUser(user.id, { subscriptionDaysDelta: 30 }, `Suscripción extendida (+30 días) para ${user.email}.`)
                            }
                            disabled={isUsersLoading || user.role === "admin"}
                          >
                            +30 días
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => deleteManagedUser(user.id)} disabled={isUsersLoading}>
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}
                </>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
