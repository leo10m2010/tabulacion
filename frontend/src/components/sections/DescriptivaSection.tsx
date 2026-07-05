import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  FileText,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { MagicButton } from "../ui/magic-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import * as api from "../../lib/api";
import { base64ToUint8Array, parseIntSafe, workbookToSheetRows } from "../../lib/helpers";
import type { AuthUser, DescriptivaResumen, TableRows } from "../../lib/types";
import { FieldHint } from "../wizard-fields";
import { PreviewTable } from "../PreviewTable";
import { SubscriptionWarning } from "../SubscriptionWarning";
import { AnimatedNumber, springSoft } from "../motion-primitives";

const DEFAULT_N = 60;
const MIN_N = 10;
const MAX_N = 200;
const NIVELES = [
  { id: "", label: "Automático", hint: "La IA decide según el instrumento" },
  { id: "ALTO", label: "Alto", hint: "Problemática muy marcada" },
  { id: "MODERADO", label: "Moderado", hint: "Tendencia intermedia" },
  { id: "LEVE", label: "Leve", hint: "Problemática poco marcada" },
] as const;

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

// Fases que se muestran durante la espera (el job real corre en el servidor;
// los umbrales siguen el orden y los tiempos típicos de la generación).
const FASES = [
  { desde: 0, texto: "Leyendo tu cuestionario" },
  { desde: 8, texto: "Clasificando preguntas y asignando pesos" },
  { desde: 25, texto: "Simulando encuestados coherentes entre sí" },
  { desde: 95, texto: "Calculando frecuencias y construyendo el Excel" },
] as const;

interface DescriptivaResult {
  resumen: DescriptivaResumen;
  warnings: string[];
  xlsxUrl: string;
  fileName: string;
  previewRows: TableRows;
  generatedAt: string;
}

const TIPO_LABELS: Record<string, string> = {
  independiente: "Encuesta descriptiva",
  puntaje_sumado: "Test con puntaje y baremo",
  conocimiento: "Cuestionario de conocimiento",
};

const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Sección Tabulación Descriptiva: el usuario pega su cuestionario (o suelta un
// .docx), la IA simula la base de datos como JSON y el backend construye el
// Excel (base + frecuencias/porcentajes por ítem + baremo si corresponde). La
// generación corre como job en el servidor y aquí solo se hace polling.
export function DescriptivaSection({ apiBaseUrl, authToken, authUser }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
}) {
  const reduce = useReducedMotion() ?? false;
  const [texto, setTexto] = useState("");
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [nStr, setNStr] = useState(String(DEFAULT_N));
  const [nivel, setNivel] = useState<string>("");
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DescriptivaResult | null>(null);
  const xlsxUrlRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => {
    if (xlsxUrlRef.current) URL.revokeObjectURL(xlsxUrlRef.current);
    if (pollRef.current) window.clearTimeout(pollRef.current);
  }, []);

  // Cronómetro de la espera (solo mientras el job corre).
  useEffect(() => {
    if (phase !== "working") return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const n = parseIntSafe(nStr) ?? DEFAULT_N;
  const issues: string[] = [];
  if (!docxFile && texto.trim().length > 0 && texto.trim().length < 30) {
    issues.push("El cuestionario pegado es demasiado corto; pega el instrumento completo.");
  }
  if (n < MIN_N || n > MAX_N) {
    issues.push(`El número de encuestados debe estar entre ${MIN_N} y ${MAX_N}.`);
  }
  const canGenerate = (texto.trim().length >= 30 || docxFile !== null) && issues.length === 0;

  const fase = FASES.reduce((acc, f) => (elapsed >= f.desde ? f : acc), FASES[0]);
  // Progreso asintótico: avanza rápido al inicio y se acerca a 92% sin
  // llegar; el 100% real lo pone la descarga del resultado.
  const progreso = Math.min(92, Math.round(100 * (1 - Math.exp(-elapsed / 55))));

  const acceptFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Solo se aceptan archivos Word (.docx).");
      return;
    }
    setError(null);
    setDocxFile(file);
    setTexto("");
  };

  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });

  const finishWithExcel = async (excelBase64: string, fileName: string, warnings: string[], resumen: DescriptivaResumen) => {
    const excelBytes = base64ToUint8Array(excelBase64);
    const parsed = await workbookToSheetRows(excelBytes);
    const xlsxUrl = URL.createObjectURL(new Blob(
      [excelBytes.buffer as ArrayBuffer],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ));
    if (xlsxUrlRef.current) URL.revokeObjectURL(xlsxUrlRef.current);
    xlsxUrlRef.current = xlsxUrl;
    setResult({
      resumen,
      warnings,
      xlsxUrl,
      fileName,
      previewRows: parsed.data.Resultados ?? parsed.data[parsed.names[0] ?? ""] ?? [],
      generatedAt: new Date().toISOString(),
    });
    setPhase("idle");
  };

  const pollJob = (jobId: string, startedAt: number) => {
    pollRef.current = window.setTimeout(async () => {
      try {
        const job = await api.getDescriptivaJob(apiBaseUrl, authToken, jobId);
        if (job.status === "done" && job.excelBase64 && job.resumen) {
          await finishWithExcel(
            job.excelBase64,
            job.excelFileName ?? "Tabulacion_descriptiva.xlsx",
            job.warnings ?? [],
            job.resumen,
          );
          return;
        }
        if (job.status === "error") {
          throw new Error(job.error ?? "Hubo un problema generando tu base de datos, intenta de nuevo.");
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error("La generación está tardando más de lo normal. Intenta de nuevo en unos minutos.");
        }
        pollJob(jobId, startedAt);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo generar la tabulación descriptiva.");
        setPhase("idle");
      }
    }, POLL_INTERVAL_MS);
  };

  const handleGenerate = async () => {
    setError(null);
    setResult(null);
    if (!canGenerate) return;
    setPhase("working");
    try {
      const body: { texto?: string; docxBase64?: string; config: { n: number; nivel?: string } } = {
        config: { n, ...(nivel ? { nivel } : {}) },
      };
      if (docxFile) {
        body.docxBase64 = await fileToBase64(docxFile);
      } else {
        body.texto = texto.trim();
      }
      const started = await api.startDescriptiva(apiBaseUrl, authToken, body);
      pollJob(started.jobId, Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la generación.");
      setPhase("idle");
    }
  };

  const clearFile = () => {
    setDocxFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="text-2xl font-bold tracking-tight">Tabulación descriptiva</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" />
            Con IA
          </span>
        </div>
        <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
          Pega tu cuestionario y recibe el Excel con la base simulada, frecuencias y porcentajes
          por ítem, y la clasificación por baremo o aciertos cuando corresponde.
        </p>
      </div>

      <SubscriptionWarning user={authUser}>
        Tu suscripción de Tabulación está vencida: la tabulación descriptiva usa la misma suscripción.
        Pide al administrador que recargue tus días.
      </SubscriptionWarning>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Tu cuestionario
          </CardTitle>
          <CardDescription className="max-w-[60ch]">
            Con las preguntas y opciones tal como están en tu tesis. La IA detecta sola si es una
            encuesta simple, un test con puntaje o un cuestionario de conocimiento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Zona de entrada: textarea que también acepta soltar un .docx */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              acceptFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "relative rounded-xl transition-shadow duration-200",
              dragging && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {docxFile ? (
                <motion.div
                  key="file"
                  initial={reduce ? false : { opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.97 }}
                  transition={springSoft}
                  className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-6 py-8 text-center"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                    <FileText className="h-6 w-6 text-primary" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{docxFile.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {(docxFile.size / 1024).toFixed(0)} KB · se convertirá a texto limpio antes de procesarlo
                    </p>
                  </div>
                  <button
                    onClick={clearFile}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3.5 w-3.5" />
                    Quitar y pegar texto
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="texto"
                  initial={reduce ? false : { opacity: 0, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={springSoft}
                >
                  <Textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    disabled={phase === "working"}
                    placeholder={"Ejemplo:\nCUESTIONARIO SOBRE CONSUMO DE BEBIDAS AZUCARADAS\n\n1. Edad: ____\n2. Género: a) Masculino  b) Femenino\n3. ¿Con qué frecuencia consumes bebidas azucaradas?\n   a) Todos los días  b) 4 a 6 veces por semana  c) 1 a 3 veces por semana  d) Rara vez  e) Nunca"}
                    className="min-h-[220px] font-mono text-xs leading-relaxed"
                  />
                  <div className="mt-1.5 flex items-center justify-between px-1">
                    <p className="text-[11px] text-muted-foreground">
                      También puedes arrastrar y soltar tu Word aquí.
                    </p>
                    {texto.trim().length > 0 && (
                      <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {texto.trim().length.toLocaleString()} caracteres
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {!docxFile && (
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => acceptFile(e.target.files?.[0])}
              />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={phase === "working"}>
                <Upload className="h-3.5 w-3.5" />
                Subir un .docx
              </Button>
              <span className="text-xs text-muted-foreground">Solo Word (.docx), máximo 3 MB.</span>
            </div>
          )}

          {/* Configuración avanzada (colapsada por defecto) */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-background/40">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2">
                Configuración avanzada
                <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-accent-foreground">
                  N={n}{nivel ? ` · ${nivel.toLowerCase()}` : ""}
                </span>
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", showAdvanced && "rotate-180")} />
            </button>
            <div className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-out",
              showAdvanced ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}>
              <div className="min-h-0 overflow-hidden">
                <div className="space-y-4 border-t border-border/60 px-4 py-4">
                  <div className="max-w-[220px]">
                    <label className="block">
                      <span className="text-sm font-medium">Encuestados a simular</span>
                      <Input className="mt-1.5 font-mono tabular-nums" value={nStr} onChange={(e) => setNStr(e.target.value)} placeholder={String(DEFAULT_N)} />
                    </label>
                    <FieldHint text={`Por defecto ${DEFAULT_N}. Entre ${MIN_N} y ${MAX_N}; con valores altos la generación tarda más.`} />
                  </div>
                  <div>
                    <span className="text-sm font-medium">Nivel de preponderancia</span>
                    <FieldHint text="Qué tan marcada debe verse la problemática medida en los resultados simulados." />
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {NIVELES.map((lvl) => {
                        const selected = nivel === lvl.id;
                        return (
                          <button
                            key={lvl.id || "auto"}
                            onClick={() => setNivel(lvl.id)}
                            aria-pressed={selected}
                            className={cn(
                              "rounded-xl border-2 px-3 py-2 text-left transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              selected ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50",
                            )}
                          >
                            <span className={cn("block text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{lvl.label}</span>
                            <span className="block text-xs text-muted-foreground">{lvl.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {issues.length > 0 && (
            <div className="space-y-1 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
              {issues.map((msg) => (
                <p key={msg} className="flex items-start gap-2"><span className="mt-0.5 shrink-0">•</span>{msg}</p>
              ))}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
          )}

          {/* Botón o panel de progreso, según el estado del job */}
          <AnimatePresence mode="wait" initial={false}>
            {phase === "working" ? (
              <motion.div
                key="progreso"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={springSoft}
                className="rounded-xl border border-primary/25 bg-primary/5 px-5 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                    <span className="relative flex h-2 w-2">
                      {!reduce && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />}
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    Generando en el servidor
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{fmtElapsed(elapsed)}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/15">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    animate={{ width: `${progreso}%` }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                  />
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={fase.texto}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                    className="mt-2.5 text-xs text-muted-foreground"
                  >
                    {fase.texto}… puedes seguir usando las otras herramientas, esto suele tardar 1 a 3 minutos.
                  </motion.p>
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div
                key="boton"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springSoft}
              >
                <MagicButton
                  size="lg"
                  className="h-12 w-full"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                >
                  <Sparkles className="h-5 w-5" />
                  Generar tabulación descriptiva
                </MagicButton>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {result && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springSoft}
        >
          <Card className="rounded-2xl border-primary/30 bg-primary/5 shadow-[0_24px_60px_-28px_hsl(var(--primary)/0.4)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Check className="h-5 w-5" />
                Tabulación descriptiva lista
              </CardTitle>
              <CardDescription>Generado el {new Date(result.generatedAt).toLocaleString()}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                <p className="text-sm font-semibold" style={{ textWrap: "balance" }}>{result.resumen.tituloEstudio}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    {TIPO_LABELS[result.resumen.tipoInstrumento] ?? result.resumen.tipoInstrumento}
                  </span>
                  {result.resumen.conBaremo && (
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      {result.resumen.baremoOrigen === "likert" ? "Baremo Likert del sistema" : "Baremo del instrumento"}
                    </span>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Preguntas</p>
                    <p className="font-mono text-lg font-semibold tabular-nums">
                      <AnimatedNumber value={result.resumen.preguntas} />
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Encuestados simulados</p>
                    <p className="font-mono text-lg font-semibold tabular-nums">
                      <AnimatedNumber value={result.resumen.nEncuestados} />
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Hojas del Excel</p>
                    <p className="font-mono text-lg font-semibold tabular-nums">
                      <AnimatedNumber value={result.resumen.conBaremo ? 3 : 2} />
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Datos simulados con fines de prueba y demostración académica; no reemplazan datos reales.
                </p>
              </div>

              {result.warnings.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  {result.warnings.map((w) => (
                    <p key={w} className="flex items-start gap-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {w}
                    </p>
                  ))}
                </div>
              )}

              <a
                href={result.xlsxUrl}
                download={result.fileName}
                className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="flex items-center gap-4 rounded-xl border-2 border-primary/40 bg-primary/10 px-5 py-4 transition-all duration-200 hover:border-primary hover:bg-primary/15 group-active:scale-[0.99]">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform duration-200 group-hover:translate-y-0.5">
                    <ArrowDownToLine className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">Descargar Excel</p>
                    <p className="truncate text-xs text-muted-foreground">
                      "Base de datos" y "Resultados"{result.resumen.conBaremo ? ' + "Baremo"' : ""} · tablas, figuras e interpretaciones
                    </p>
                  </div>
                </div>
              </a>

              <div>
                <p className="mb-3 text-sm font-medium">Vista previa de los resultados</p>
                <PreviewTable rows={result.previewRows} maxRows={14} />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
