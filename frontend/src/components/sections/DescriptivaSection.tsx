import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  Sparkles,
  Wand2,
} from "lucide-react";
import { MagicButton } from "../ui/magic-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { TextDropZone } from "../TextDropZone";
import { cn } from "../../lib/utils";
import * as api from "../../lib/api";
import { base64ToUint8Array, parseIntSafe, workbookToSheetRows } from "../../lib/helpers";
import type { AuthUser, DescriptivaResumen, TableRows } from "../../lib/types";
import { FieldHint } from "../wizard-fields";
import { PreviewTable } from "../PreviewTable";
import { SubscriptionWarning } from "../SubscriptionWarning";
import { ToolSteps } from "../ToolSteps";
import { AnimatedNumber, springSoft } from "../motion-primitives";

const DEFAULT_N = 60;
const MIN_N = 10;
const MAX_N = 400;
const NIVELES = [
  { id: "", label: "Automático", hint: "La IA decide según el instrumento" },
  { id: "ALTO", label: "Alto", hint: "Problemática muy marcada" },
  { id: "MODERADO", label: "Moderado", hint: "Tendencia intermedia" },
  { id: "LEVE", label: "Leve", hint: "Problemática poco marcada" },
] as const;

const POLL_INTERVAL_MS = 5000;
// Margen sobre el timeout del backend (10 min): la generacion real con N=60
// tarda ~4 min y escala con el numero de filas pedidas.
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

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

// Ejemplo insertable desde el botón del editor (antes vivía como placeholder).
const EJEMPLO_CUESTIONARIO = `CUESTIONARIO SOBRE CONSUMO DE BEBIDAS AZUCARADAS

1. Edad: ____
2. Género: a) Masculino  b) Femenino
3. ¿Con qué frecuencia consumes bebidas azucaradas?
   a) Todos los días  b) 4 a 6 veces por semana  c) 1 a 3 veces por semana  d) Rara vez  e) Nunca`;

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [nStr, setNStr] = useState(String(DEFAULT_N));
  const [nivel, setNivel] = useState<string>("");
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DescriptivaResult | null>(null);
  // Límites vigentes del servidor; los hardcodeados son solo el fallback
  // hasta que /descriptiva/info responde (así no se desfasan al cambiarlos).
  const [limits, setLimits] = useState({ defaultN: DEFAULT_N, minN: MIN_N, maxN: MAX_N });
  const xlsxUrlRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  // Evita setState tras desmontar: la limpieza cancela el timeout pendiente,
  // pero una petición de polling ya en vuelo resuelve igual.
  const aliveRef = useRef(true);

  useEffect(() => () => {
    aliveRef.current = false;
    if (xlsxUrlRef.current) URL.revokeObjectURL(xlsxUrlRef.current);
    if (pollRef.current) window.clearTimeout(pollRef.current);
  }, []);

  useEffect(() => {
    api.getDescriptivaInfo(apiBaseUrl, authToken)
      .then((info) => {
        if (!aliveRef.current) return;
        setLimits({ defaultN: info.defaultN, minN: info.minN, maxN: info.maxN });
      })
      .catch(() => {}); // sin red o sin permiso: se quedan los defaults
  }, [apiBaseUrl, authToken]);

  // Cronómetro de la espera (solo mientras el job corre).
  useEffect(() => {
    if (phase !== "working") return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const n = parseIntSafe(nStr) ?? limits.defaultN;
  const issues: string[] = [];
  if (!docxFile && texto.trim().length > 0 && texto.trim().length < 30) {
    issues.push("El cuestionario pegado es demasiado corto; pega el instrumento completo.");
  }
  if (n < limits.minN || n > limits.maxN) {
    issues.push(`El número de encuestados debe estar entre ${limits.minN} y ${limits.maxN}.`);
  }
  const canGenerate = (texto.trim().length >= 30 || docxFile !== null) && issues.length === 0;
  // Conteo aproximado en vivo: líneas que empiezan con "1." / "2)" etc.
  const preguntasDetectadas = (texto.match(/^\s*\d+[.)]/gm) ?? []).length;

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
      // La hoja base trae valores reales; "Resultados" usa fórmulas vivas sin
      // valor cacheado y SheetJS las leería como celdas vacías.
      previewRows: parsed.data["Base de datos"] ?? parsed.data[parsed.names[0] ?? ""] ?? [],
      generatedAt: new Date().toISOString(),
    });
    setPhase("idle");
  };

  const pollJob = (jobId: string, startedAt: number) => {
    pollRef.current = window.setTimeout(async () => {
      try {
        const job = await api.getDescriptivaJob(apiBaseUrl, authToken, jobId);
        if (!aliveRef.current) return;
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
        if (!aliveRef.current) return;
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

  const clearFile = () => setDocxFile(null);

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-2xl font-bold tracking-tight">Tabulación descriptiva</h2>
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

      <ToolSteps steps={[
        "Pega tu cuestionario o sube el Word",
        "La IA simula encuestados coherentes y calcula frecuencias",
        "Descarga el Excel con base, resultados y baremo",
      ]} />

      <SubscriptionWarning user={authUser} tool="descriptiva" />

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
          {/* Zona de entrada: editor con modos pegar/subir y contador en vivo */}
          <TextDropZone
            value={texto}
            onChange={setTexto}
            file={docxFile}
            onFile={acceptFile}
            onClearFile={clearFile}
            disabled={phase === "working"}
            placeholder={"Pega aquí tu cuestionario completo, con sus preguntas y alternativas tal como están en tu tesis."}
            stats={
              <>
                {preguntasDetectadas > 0 && (
                  <span className="rounded-md bg-accent px-1.5 py-0.5 text-accent-foreground">
                    ≈ {preguntasDetectadas} pregunta{preguntasDetectadas === 1 ? "" : "s"}
                  </span>
                )}
                {texto.trim().length > 0 && <span>{texto.trim().length.toLocaleString()} caracteres</span>}
              </>
            }
            footerHint="Arrastra y suelta tu Word aquí · solo .docx, máximo 3 MB"
            example={{ label: "Ver un ejemplo", text: EJEMPLO_CUESTIONARIO }}
            fileNote="se convertirá a texto limpio antes de procesarlo"
          />

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
                    <FieldHint text={`Por defecto ${limits.defaultN}. Entre ${limits.minN} y ${limits.maxN}; con valores altos la generación tarda más.`} />
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
                <p className="mb-3 text-sm font-medium">Vista previa de la base de datos</p>
                <PreviewTable rows={result.previewRows} maxRows={14} />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
