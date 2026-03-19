import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  LogOut,
  Moon,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  Users,
  Zap,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────
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
type AppSection = "tabulacion" | "usuarios";
type WizardStep = 1 | 2 | 3;

// ─── Constants ───────────────────────────────────────────────────────────────
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
  nombre_escala_v2: ["Bajo", "Medio", "Alto"],
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
  desde_v2: ["9", "21", "33"],
  hasta_v2: ["20", "32", "45"],
  porcentaje_v2: ["46", "35", "19"],
  cantidad_v2: ["133", "101", "55"],
  nombre_dimension: ["Gestion de abastecimiento", "Satisfaccion del servicio"],
  numero_dimension: ["1", "2"],
  nombre_indicador: ["Planificacion", "Transparencia", "Cumplimiento normativo", "Satisfaccion del servicio"],
  numero_indicador0: ["3", "1"],
  numero_pregunta0: ["6", "6", "6"],
  numero_pregunta1: ["9"],
};

const STEP_1_FIELDS = [
  {
    key: "nommuestra",
    label: "Nombre de la muestra",
    hint: "¿Cómo se llaman las personas encuestadas? Ej: Beneficiarios, Estudiantes, Trabajadores.",
    placeholder: "Ej: Beneficiarios",
  },
  {
    key: "muestra",
    label: "Cantidad de personas encuestadas",
    hint: "Total de personas que respondieron la encuesta. Mínimo 2.",
    placeholder: "Ej: 289",
  },
  {
    key: "variable",
    label: "Número de variables",
    hint: "Cuántas variables tiene tu instrumento. Generalmente 2.",
    placeholder: "Ej: 2",
  },
  {
    key: "item",
    label: "Preguntas de la Variable 1",
    hint: "Cuántas preguntas (ítems) tiene la primera variable de tu encuesta.",
    placeholder: "Ej: 18",
  },
  {
    key: "itemv2",
    label: "Preguntas de la Variable 2",
    hint: "Cuántas preguntas (ítems) tiene la segunda variable de tu encuesta.",
    placeholder: "Ej: 9",
  },
  {
    key: "escala",
    label: "Niveles del baremo",
    hint: "Cuántos niveles tiene tu escala valorativa. Ej: 3 niveles = Bajo / Medio / Alto.",
    placeholder: "Ej: 3",
  },
  {
    key: "respuesta",
    label: "Escala de respuesta (Likert)",
    hint: "Cuántos valores tiene la escala de respuesta. Ej: 5 significa respuestas del 1 al 5.",
    placeholder: "Ej: 5",
  },
] as const;

const LIST_GROUPS = [
  {
    title: "Opciones de respuesta",
    description: "Los textos que aparecen como opciones en la encuesta. Compartido entre ambas variables.",
    fields: [
      { key: "nombre_respuesta", label: "Opciones de respuesta", placeholder: "Ej: De acuerdo" },
    ],
  },
  {
    title: "Baremo de Variable 1",
    description: "Niveles y rangos de puntajes para la primera variable.",
    variable: "v1" as const,
    fields: [
      { key: "nombre_escala", label: "Niveles del baremo", placeholder: "Ej: Bajo" },
      { key: "desde", label: "Puntaje desde", placeholder: "Ej: 18" },
      { key: "hasta", label: "Puntaje hasta", placeholder: "Ej: 41" },
      { key: "porcentaje", label: "Porcentaje (%)", placeholder: "Ej: 46" },
      { key: "cantidad", label: "Cantidad de personas", placeholder: "Ej: 133" },
    ],
  },
  {
    title: "Baremo de Variable 2",
    description: "Niveles y rangos de puntajes para la segunda variable.",
    variable: "v2" as const,
    fields: [
      { key: "nombre_escala_v2", label: "Niveles del baremo", placeholder: "Ej: Bajo" },
      { key: "desde_v2", label: "Puntaje desde", placeholder: "Ej: 9" },
      { key: "hasta_v2", label: "Puntaje hasta", placeholder: "Ej: 20" },
      { key: "porcentaje_v2", label: "Porcentaje (%)", placeholder: "Ej: 46" },
      { key: "cantidad_v2", label: "Cantidad de personas", placeholder: "Ej: 133" },
    ],
  },
  {
    title: "Dimensiones e indicadores",
    description: "La estructura conceptual de tu instrumento de investigación.",
    fields: [
      { key: "nombre_dimension", label: "Nombre de cada dimensión", placeholder: "Ej: Gestión de abastecimiento" },
      { key: "numero_dimension", label: "Número de dimensión", placeholder: "Ej: 1" },
      { key: "nombre_indicador", label: "Nombre de cada indicador", placeholder: "Ej: Transparencia" },
      { key: "numero_indicador0", label: "Indicadores por dimensión", placeholder: "Ej: 3" },
    ],
  },
  {
    title: "Preguntas por dimensión",
    description: "Cuántas preguntas hay en cada bloque de cada variable.",
    fields: [
      { key: "numero_pregunta0", label: "Preguntas de V1 por dimensión", placeholder: "Ej: 6" },
      { key: "numero_pregunta1", label: "Preguntas de V2 por dimensión", placeholder: "Ej: 9" },
    ],
  },
];

const WIZARD_STEPS = [
  { step: 1 as const, label: "Tu encuesta", description: "Datos básicos de tu muestra" },
  { step: 2 as const, label: "Escalas y estructura", description: "Baremos, dimensiones e indicadores" },
  { step: 3 as const, label: "Generar", description: "Revisa y descarga tu Excel" },
];

// ─── Utilities ───────────────────────────────────────────────────────────────
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

function calcBaremoRange(items: string, respuesta: string): string {
  const n = parseInt(items, 10);
  const r = parseInt(respuesta, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || n <= 0 || r <= 0) return "";
  return `Rango sugerido: ${n} (mínimo) a ${n * r} (máximo)`;
}

function correlationInfo(r: number): { label: string; colorClass: string; explanation: string } {
  const abs = Math.abs(r);
  if (abs >= 0.8) return { label: "Muy alta", colorClass: "text-green-600 dark:text-green-400", explanation: "Relación muy fuerte entre las variables." };
  if (abs >= 0.6) return { label: "Alta", colorClass: "text-green-500 dark:text-green-300", explanation: "Relación fuerte entre las variables." };
  if (abs >= 0.4) return { label: "Moderada", colorClass: "text-yellow-600 dark:text-yellow-400", explanation: "Relación moderada entre las variables." };
  if (abs >= 0.2) return { label: "Baja", colorClass: "text-orange-500", explanation: "Relación débil entre las variables." };
  return { label: "Muy baja", colorClass: "text-red-500", explanation: "Relación muy débil o casi nula entre las variables." };
}

function resolveViewFromPath(): AppView {
  return window.location.pathname.startsWith("/app") ? "app" : "landing";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FieldHint({ text }: { text: string }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
      <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
      {text}
    </p>
  );
}

function ListEditorField({
  label,
  placeholder,
  values,
  onChange,
  isPercentage = false,
  rowLabels = [],
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  isPercentage?: boolean;
  rowLabels?: string[];
}) {
  const [rows, setRows] = useState<string[]>(() => values.length > 0 ? [...values] : [""]);
  const prevValuesRef = useRef<string[]>(values);

  // Sync from parent when config changes externally (e.g. reset)
  useEffect(() => {
    const prev = prevValuesRef.current;
    const changed = prev.length !== values.length || values.some((v, i) => v !== prev[i]);
    if (changed) {
      prevValuesRef.current = [...values];
      setRows(values.length > 0 ? [...values] : [""]);
    }
  }, [values]);

  const editableSum = isPercentage && rows.length > 1
    ? rows.slice(0, -1).reduce((acc, v) => { const n = parseInt(v.trim(), 10); return Number.isFinite(n) ? acc + n : acc; }, 0)
    : 0;
  const overLimit = isPercentage && rows.length > 1 && editableSum > 100;

  const applyAutoLast = (vals: string[]): string[] => {
    if (vals.length < 2) return vals;
    const sum = vals.slice(0, -1).reduce((acc, v) => {
      const n = parseInt(v.trim(), 10);
      return Number.isFinite(n) ? acc + n : acc;
    }, 0);
    const result = [...vals];
    result[result.length - 1] = String(Math.max(0, 100 - sum));
    return result;
  };

  const push = (vals: string[]) => onChange(normalizeList(vals));

  const updateAt = (index: number, val: string) => {
    const next = [...rows];
    next[index] = val;
    const final = isPercentage ? applyAutoLast(next) : next;
    setRows(final);
    push(final);
  };

  const removeAt = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    const safe = next.length > 0 ? next : [""];
    const final = isPercentage ? applyAutoLast(safe) : safe;
    setRows(final);
    push(final);
  };

  const agregar = () => {
    let next: string[];
    if (isPercentage) {
      // Insert new editable field before the auto-calc last, recalculate last
      next = applyAutoLast([...rows.slice(0, -1), "0", rows[rows.length - 1]]);
    } else {
      next = [...rows, ""];
    }
    setRows(next);
    push(next);
  };

  const filledSum = rows.reduce((acc, v) => {
    const n = parseInt(v.trim(), 10);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);

  return (
    <div className="rounded-md border border-border/80 bg-background/70 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{label}</h4>
        <Button variant="ghost" size="sm" onClick={agregar}>
          + Agregar
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((value, index) => {
          const isAutoCalc = isPercentage && rows.length > 1 && index === rows.length - 1;
          return (
            <div className="flex items-center gap-2" key={`${label}-${index}`}>
              {rowLabels[index] && (
                <span className="w-16 shrink-0 rounded bg-muted px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">
                  {rowLabels[index]}
                </span>
              )}
              <Input
                value={value}
                placeholder={isAutoCalc ? "Auto" : placeholder}
                readOnly={isAutoCalc}
                onChange={(e) => updateAt(index, e.target.value)}
                className={cn(isAutoCalc && "cursor-not-allowed bg-muted/50 text-muted-foreground")}
              />
              {rowLabels.length === 0 && (
                <Button variant="outline" size="sm" onClick={() => removeAt(index)}>
                  Quitar
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {isPercentage && (
        <div className="mt-2 flex items-center justify-between text-xs font-medium">
          <span className={cn(overLimit ? "text-danger" : filledSum === 100 ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
            Total: {filledSum}%
          </span>
          {overLimit && <span className="text-danger">Los valores superan 100%</span>}
        </div>
      )}
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

function WizardProgress({ currentStep }: { currentStep: WizardStep }) {
  return (
    <div className="mb-8 flex items-start">
      {WIZARD_STEPS.map((stepInfo, index) => {
        const isCompleted = currentStep > stepInfo.step;
        const isActive = currentStep === stepInfo.step;
        return (
          <div key={stepInfo.step} className="flex flex-1 items-start">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-all",
                  isCompleted
                    ? "border-primary bg-primary text-primary-foreground"
                    : isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground",
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : stepInfo.step}
              </div>
              <div className="mt-2 text-center">
                <p className={cn("text-xs font-semibold", isActive ? "text-foreground" : "text-muted-foreground")}>
                  {stepInfo.label}
                </p>
                <p className="hidden text-xs text-muted-foreground sm:block">{stepInfo.description}</p>
              </div>
            </div>
            {index < WIZARD_STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-3 mt-4 h-0.5 flex-1 transition-all",
                  currentStep > stepInfo.step ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────
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
        highlights: ["1 usuario", "Hasta 15 proyectos activos", "Generación de Excel y CSV", "Soporte por correo"],
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
        highlights: ["Hasta 20 usuarios", "Proyectos ilimitados", "Panel administrador + roles", "Soporte prioritario y onboarding"],
        cta: "Hablar con ventas",
      },
    ],
    [],
  );

  const productFeatures = [
    { title: "Generación automatizada", desc: "Convierte configuración en Excel de tabulación listo para informe en segundos.", icon: Zap },
    { title: "Consistencia metodológica", desc: "Mantén reglas, dimensiones e indicadores estandarizados entre tesis.", icon: ShieldCheck },
    { title: "Operación escalable", desc: "Maneja desde un tesista hasta equipos institucionales con múltiples proyectos.", icon: ChartNoAxesCombined },
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
            Centraliza la configuración metodológica, genera archivos Excel automáticamente y reduce el tiempo operativo para cada nueva tesis.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="lg" onClick={onOpenApp}>
              Probar generación
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={onOpenApp}>
              Ver demo
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
            {["Servicio mensual para tesistas.", "Plan anual para consultoras y universidades.", "Gestión de cuentas con fecha de vencimiento.", "Generación rápida para múltiples tesis."].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-primary" />
                {item}
              </li>
            ))}
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
                {(["monthly", "yearly"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={cn(
                      "rounded px-3 py-1 text-sm font-medium",
                      billingMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                    onClick={() => setBillingMode(mode)}
                  >
                    {mode === "monthly" ? "Mensual" : "Anual"}
                  </button>
                ))}
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
                    <span className="ml-1 text-base font-medium text-muted-foreground">/ {billingMode === "monthly" ? "mes" : "año"}</span>
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

      <footer className="rounded-[28px] border border-border/70 bg-card/95 p-6 shadow-[0_16px_48px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">¿Listo para venderlo como servicio?</h3>
            <p className="text-sm text-muted-foreground">Arranca con esta versión y activa login, roles y suscripciones por fecha.</p>
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [appView, setAppView] = useState<AppView>(() => resolveViewFromPath());
  const [activeSection, setActiveSection] = useState<AppSection>("tabulacion");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<string>("");

  const [config, setConfig] = useState<TabConfig>(FALLBACK_CONFIG);
  const [jsonDraft, setJsonDraft] = useState<string>(JSON.stringify(FALLBACK_CONFIG, null, 2));
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(() => localStorage.getItem("apiBaseUrl") || DEFAULT_API_BASE_URL);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("themeMode");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const [statusMessage, setStatusMessage] = useState<string>("Listo para generar.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
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
  useEffect(() => { localStorage.setItem("apiBaseUrl", apiBaseUrl); }, [apiBaseUrl]);
  useEffect(() => {
    if (authToken) localStorage.setItem("authToken", authToken);
    else localStorage.removeItem("authToken");
  }, [authToken]);
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

  // ── Validation ─────────────────────────────────────────────────────────────
  const validationMessages = useMemo(() => {
    const issues: string[] = [];
    const muestra = parseIntSafe(config.muestra);
    const item = parseIntSafe(config.item);
    const itemv2 = parseIntSafe(config.itemv2);
    const escala = parseIntSafe(config.escala);
    const respuesta = parseIntSafe(config.respuesta);
    if (muestra === null || muestra < 2) issues.push("La cantidad de personas debe ser 2 o más.");
    if (item === null || item <= 0) issues.push("Las preguntas de V1 deben ser mayor a 0.");
    if (itemv2 === null || itemv2 <= 0) issues.push("Las preguntas de V2 deben ser mayor a 0.");
    if (escala === null || escala <= 0) issues.push("Los niveles del baremo deben ser mayor a 0.");
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
    validatePorcentaje("porcentaje_v2", "Baremo V2");

    return issues;
  }, [config]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const setScalar = (key: string, value: string) => setConfig((prev) => ({ ...prev, [key]: value }));
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
    return updates;
  });
  const getScalar = (key: string) => toStringValue(config[key]);
  const getList = (key: string) => toStringList(config[key]);

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
    setUsersErrorMessage(null);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users`, { headers: { Authorization: `Bearer ${authToken}` } });
      const payload = (await res.json()) as AuthUsersResponse;
      if (!res.ok || !Array.isArray(payload.users)) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
      setManagedUsers(payload.users);
      setUsersStatusMessage(`${payload.users.length} usuario(s) cargados.`);
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
    setUsersErrorMessage(null);
    if (!authToken) return;
    const email = newUserEmail.trim();
    if (!email || !newUserPassword) { setUsersErrorMessage("Email y contraseña son obligatorios."); return; }
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
      setUsersStatusMessage("Usuario creado correctamente.");
      await loadUsers();
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo crear el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const patchManagedUser = async (userId: string, patch: Record<string, unknown>, successMessage: string) => {
    if (!authToken) return;
    setIsUsersLoading(true); setUsersErrorMessage(null);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(patch),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
      setUsersStatusMessage(successMessage);
      await loadUsers();
    } catch (err) {
      setUsersErrorMessage(err instanceof Error ? err.message : "No se pudo actualizar el usuario.");
    } finally {
      setIsUsersLoading(false);
    }
  };

  const deleteManagedUser = async (userId: string) => {
    if (!authToken) return;
    setIsUsersLoading(true); setUsersErrorMessage(null);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
      setUsersStatusMessage("Usuario eliminado.");
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
    if (authUser.role !== "admin") { setErrorMessage("Solo el administrador puede generar tabulación."); return; }
    if (validationMessages.length > 0) { setErrorMessage("Corrige las validaciones antes de generar."); return; }
    setIsGenerating(true);
    setStatusMessage("Enviando configuración a la API...");
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ config, responseMode: "inline" }),
      });
      const payload = (await res.json()) as InlineGenerateResponse;
      if (!res.ok) throw new Error(payload.error ?? `Error HTTP ${res.status}`);
      if (typeof payload.correlation !== "number" || !payload.baseCsv || !payload.excelBase64) {
        throw new Error("La API respondió sin los artefactos esperados.");
      }
      setStatusMessage("Procesando resultados...");
      const excelBytes = base64ToUint8Array(payload.excelBase64);
      const csvRows = csvToRows(payload.baseCsv);
      const parsedWorkbook = workbookToSheetRows(excelBytes);
      const nextLinks: DownloadLinks = {
        json: URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json;charset=utf-8" })),
        csv: URL.createObjectURL(new Blob([payload.baseCsv], { type: "text/csv;charset=utf-8" })),
        xlsx: URL.createObjectURL(new Blob([excelBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })),
      };
      setDownloadLinks((cur) => { revokeDownloadLinks(cur); return nextLinks; });
      setResult({ correlation: payload.correlation, csvRows, sheetNames: parsedWorkbook.names, sheetData: parsedWorkbook.data, generatedAt: new Date().toISOString() });
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

  const toggleTheme = () => setThemeMode((cur) => (cur === "dark" ? "light" : "dark"));
  const goToApp = () => { window.history.pushState({}, "", "/app"); setAppView("app"); };
  const goToLanding = () => { window.history.pushState({}, "", "/"); setAppView("landing"); };

  // ── Render: Landing ────────────────────────────────────────────────────────
  if (appView === "landing") {
    return (
      <div className={cn("min-h-screen pb-14 transition-colors", themeMode === "dark" ? "bg-[radial-gradient(circle_at_top,#1b2534_0%,#121825_45%,#0b0f16_100%)]" : "bg-[radial-gradient(circle_at_top,#e4ecf8_0%,#f6f8fc_45%,#f3f5f9_100%)]")}>
        <LandingPage themeMode={themeMode} onToggleTheme={toggleTheme} onOpenApp={goToApp} />
      </div>
    );
  }

  // ── Render: Login ──────────────────────────────────────────────────────────
  if (!authUser && !authLoading) {
    return (
      <div className={cn("flex min-h-screen items-center justify-center p-4 transition-colors", themeMode === "dark" ? "bg-[radial-gradient(circle_at_top,#1b2534_0%,#0b0f16_100%)]" : "bg-[radial-gradient(circle_at_top,#e4ecf8_0%,#f3f5f9_100%)]")}>
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Sistema de Tabulación</h1>
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
                <Input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </label>
              <Button className="h-11 w-full" onClick={handleLogin} disabled={authLoading}>
                {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Entrar
              </Button>
              {/* TODO producción: eliminar este botón antes de lanzar a producción real */}
              <button
                onClick={() => { setLoginEmail("admin@tabulacion.local"); setLoginPassword("Admin12345!"); }}
                className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
              >
                Rellenar con datos de prueba
              </button>
              <div className="flex items-center justify-between">
                <button onClick={goToLanding} className="text-xs text-muted-foreground hover:text-foreground">← Volver al inicio</button>
                <button onClick={toggleTheme} className="text-xs text-muted-foreground hover:text-foreground">
                  {themeMode === "dark" ? "☀️ Modo claro" : "🌙 Modo oscuro"}
                </button>
              </div>
            </CardContent>
          </Card>
          {/* URL DE LA API: se configura automáticamente desde la variable VITE_API_BASE_URL.
              Solo visible aquí para ajuste manual en desarrollo local.
              TODO: eliminar este input antes de pasar a producción */}
          <div className="mt-4 space-y-1">
            <p className="text-center text-xs text-muted-foreground">API: {apiBaseUrl}</p>
            <Input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://tu-api.com" className="text-xs" />
          </div>
        </div>
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
    <div className={cn("flex min-h-screen transition-colors", themeMode === "dark" ? "bg-[radial-gradient(circle_at_top,#1b2534_0%,#0b0f16_100%)]" : "bg-[radial-gradient(circle_at_top,#e4ecf8_0%,#f3f5f9_100%)]")}>

      {/* ── Sidebar ── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 bg-card/80 backdrop-blur-sm md:flex">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-border/60 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <span className="font-bold tracking-tight">Tabulación</span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-1 p-3">
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
          {/* URL de la API: se detecta automáticamente desde VITE_API_BASE_URL.
              Editable aquí solo para ajustes manuales en desarrollo.
              TODO producción: considerar ocultar este campo o protegerlo */}
          <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">API</p>
            <input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              className="w-full bg-transparent text-[11px] text-muted-foreground outline-none truncate"
              placeholder="http://localhost:8080"
            />
          </div>
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
            <span className="font-bold">Tabulación</span>
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
          {activeSection === "tabulacion" && isAdmin && (
            <div className="mx-auto max-w-3xl">
              <div className="mb-6">
                <h2 className="text-2xl font-bold tracking-tight">Generar tabulación</h2>
                <p className="mt-1 text-sm text-muted-foreground">Completa los 3 pasos para generar tu archivo Excel.</p>
              </div>

              <WizardProgress currentStep={wizardStep} />

              {/* Step 1: Datos básicos */}
              {wizardStep === 1 && (
                <div className="space-y-5">
                  <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                    <CardHeader>
                      <CardTitle>Datos de tu encuesta</CardTitle>
                      <CardDescription>Ingresa la información básica de tu instrumento de investigación.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="grid gap-5 sm:grid-cols-2">
                        {STEP_1_FIELDS.map((field) => (
                          <div key={field.key}>
                            <label className="block">
                              <span className="text-sm font-medium text-foreground">{field.label}</span>
                              <Input
                                className="mt-1.5"
                                value={getScalar(field.key)}
                                onChange={(e) => setScalar(field.key, e.target.value)}
                                placeholder={field.placeholder}
                              />
                            </label>
                            <FieldHint text={field.hint} />
                          </div>
                        ))}
                      </div>

                      {/* Relación */}
                      <div className="rounded-xl border border-border/80 bg-background/50 p-4">
                        <p className="mb-1 text-sm font-medium text-foreground">¿Las variables van en la misma dirección?</p>
                        <FieldHint text="Relación directa: cuando V1 sube, V2 también sube. Relación inversa: cuando V1 sube, V2 baja." />
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => setScalar("relacionversa", "0")}
                            className={cn(
                              "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                              getScalar("relacionversa") === "0"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:border-primary/50",
                            )}
                          >
                            ✓ Misma dirección (directa)
                          </button>
                          <button
                            onClick={() => setScalar("relacionversa", "1")}
                            className={cn(
                              "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                              getScalar("relacionversa") === "1"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:border-primary/50",
                            )}
                          >
                            ↕ Dirección opuesta (inversa)
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex justify-end">
                    <Button size="lg" onClick={() => { setWizardStep(2); setErrorMessage(null); }}>
                      Siguiente: Escalas y estructura
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Escalas y estructura */}
              {wizardStep === 2 && (
                <div className="space-y-5">
                  {LIST_GROUPS.map((group) => (
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
                      <CardContent className="grid gap-3 md:grid-cols-2">
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
                              rowLabels={rowLabels}
                            />
                          );
                        })}
                      </CardContent>
                    </Card>
                  ))}

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
                      <p className="text-sm text-danger text-right">{step2Error}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <Button variant="outline" size="lg" onClick={() => { setWizardStep(1); setStep2Error(null); }}>
                        <ArrowLeft className="h-4 w-4" />
                        Atrás
                      </Button>
                      <Button size="lg" onClick={() => {
                        const sumOf = (list: string[]) => list.reduce((acc, v) => { const n = parseInt(v.trim(), 10); return Number.isFinite(n) ? acc + n : acc; }, 0);
                        const v1Sum = sumOf(getList("porcentaje"));
                        const v2Sum = sumOf(getList("porcentaje_v2"));
                        if (v1Sum !== 100 || v2Sum !== 100) {
                          setStep2Error("Los porcentajes de cada variable deben sumar exactamente 100%");
                        } else {
                          setStep2Error(null);
                          setWizardStep(3);
                        }
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
                <div className="space-y-5">
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
                          { label: "Preguntas V2", value: getScalar("itemv2") },
                          { label: "Niveles baremo", value: getScalar("escala") },
                          { label: "Escala Likert", value: `1 al ${getScalar("respuesta")}` },
                          { label: "Relación", value: getScalar("relacionversa") === "1" ? "Inversa" : "Directa" },
                          { label: "Dimensiones", value: getList("nombre_dimension").filter(Boolean).join(", ") || "—" },
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
                            Generando tu Excel...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-5 w-5" />
                            Generar tabulación
                          </>
                        )}
                      </Button>
                      <p className="text-center text-xs text-muted-foreground">{statusMessage}</p>
                    </CardContent>
                  </Card>

                  {/* Result */}
                  {result && (
                    <Card className="rounded-2xl border-primary/30 bg-primary/5 shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-primary flex items-center gap-2">
                          <Check className="h-5 w-5" />
                          ¡Tabulación generada exitosamente!
                        </CardTitle>
                        <CardDescription>Generado el {new Date(result.generatedAt).toLocaleString()}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {/* Correlation */}
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
                      <span className="text-sm font-medium">Email</span>
                      <Input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="usuario@dominio.com" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Contraseña inicial</span>
                      <Input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Rol</span>
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
                      <span className="text-sm font-medium">Plan</span>
                      <Input value={newUserPlan} onChange={(e) => setNewUserPlan(e.target.value)} placeholder="pro" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Días de acceso</span>
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
                    managedUsers.map((user) => (
                      <div key={user.id} className="rounded-xl border border-border/60 bg-background/60 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">{user.email}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {user.role === "admin" ? "Administrador" : "Usuario"} · Plan {user.plan} · {user.status === "active" ? "✅ Activo" : "🔴 Desactivado"}
                            </p>
                            <p className="text-xs text-muted-foreground">{getSubscriptionLabel(user)}</p>
                            <p className="text-xs text-muted-foreground">Último acceso: {formatDateTime(user.lastLoginAt)}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => patchManagedUser(user.id, { status: user.status === "active" ? "disabled" : "active" }, `Estado actualizado para ${user.email}.`)}
                            disabled={isUsersLoading}
                          >
                            {user.status === "active" ? "Desactivar" : "Activar"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => patchManagedUser(user.id, { subscriptionDaysDelta: 30 }, `+30 días para ${user.email}.`)}
                            disabled={isUsersLoading || user.role === "admin"}
                          >
                            +30 días
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-danger hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
                            onClick={() => deleteManagedUser(user.id)}
                            disabled={isUsersLoading}
                          >
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

          {/* Non-admin message */}
          {activeSection === "tabulacion" && !isAdmin && authUser && (
            <div className="mx-auto max-w-md mt-20 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold">Acceso restringido</h2>
              <p className="mt-2 text-sm text-muted-foreground">Tu cuenta está activa pero solo los administradores pueden operar el sistema. Solicita elevación de permisos.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
