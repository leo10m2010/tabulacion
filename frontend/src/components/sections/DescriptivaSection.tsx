import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
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

interface DescriptivaResult {
  resumen: DescriptivaResumen;
  warnings: string[];
  xlsxUrl: string;
  fileName: string;
  previewRows: TableRows;
  generatedAt: string;
}

const TIPO_LABELS: Record<string, string> = {
  independiente: "Encuesta descriptiva (ítems independientes)",
  puntaje_sumado: "Test con puntaje sumado y baremo",
  conocimiento: "Cuestionario de conocimiento (aciertos)",
};

// Sección Tabulación Descriptiva: el usuario pega su cuestionario (o sube un
// .docx), la IA simula la base de datos como JSON y el backend construye el
// Excel (base + frecuencias/porcentajes por ítem + baremo si aplica). La
// generación corre como job en el servidor y aquí solo se hace polling.
export function DescriptivaSection({ apiBaseUrl, authToken, authUser }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
}) {
  const [texto, setTexto] = useState("");
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [nStr, setNStr] = useState(String(DEFAULT_N));
  const [nivel, setNivel] = useState<string>("");
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DescriptivaResult | null>(null);
  const xlsxUrlRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => {
    if (xlsxUrlRef.current) URL.revokeObjectURL(xlsxUrlRef.current);
    if (pollRef.current) window.clearTimeout(pollRef.current);
  }, []);

  const n = parseIntSafe(nStr) ?? DEFAULT_N;
  const issues: string[] = [];
  if (!docxFile && texto.trim().length > 0 && texto.trim().length < 30) {
    issues.push("El cuestionario pegado es demasiado corto; pega el instrumento completo.");
  }
  if (n < MIN_N || n > MAX_N) {
    issues.push(`El número de encuestados debe estar entre ${MIN_N} y ${MAX_N}.`);
  }
  const canGenerate = (texto.trim().length >= 30 || docxFile !== null) && issues.length === 0;

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

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Tabulación descriptiva</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pega tu cuestionario y recibe un Excel con la base de datos simulada, frecuencias y porcentajes
          por ítem, y la clasificación por baremo o aciertos cuando el instrumento la trae.
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
          <CardDescription>
            Pega el instrumento completo (preguntas y opciones tal como están en tu tesis) o sube el Word.
            La IA detecta sola el tipo de instrumento: encuesta simple, test con puntaje o cuestionario de conocimiento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {docxFile ? (
            <div className="flex items-center justify-between rounded-xl border-2 border-primary/40 bg-primary/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{docxFile.name}</p>
                  <p className="text-xs text-muted-foreground">Se convertirá a texto limpio antes de procesarlo.</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setDocxFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="rounded-lg p-2 text-muted-foreground transition-all hover:bg-danger/10 hover:text-danger"
                title="Quitar archivo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"Ejemplo:\nCUESTIONARIO SOBRE CONSUMO DE BEBIDAS AZUCARADAS\n\n1. Edad: ____\n2. Género: a) Masculino  b) Femenino\n3. ¿Con qué frecuencia consumes bebidas azucaradas?\n   a) Todos los días  b) 4 a 6 veces por semana  c) 1 a 3 veces por semana  d) Rara vez  e) Nunca\n..."}
              className="min-h-[220px] font-mono text-xs leading-relaxed"
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file) { setDocxFile(file); setTexto(""); }
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={phase === "working"}>
              <Upload className="h-3.5 w-3.5" />
              {docxFile ? "Cambiar .docx" : "O subir un .docx"}
            </Button>
            <span className="text-xs text-muted-foreground">Solo Word (.docx), máximo 3 MB.</span>
          </div>

          <div className="rounded-xl border border-border/60">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground"
            >
              Configuración avanzada
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showAdvanced && "rotate-180")} />
            </button>
            {showAdvanced && (
              <div className="space-y-4 border-t border-border/60 px-4 py-4">
                <div className="max-w-[220px]">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground">Encuestados a simular</span>
                    <Input className="mt-1.5" value={nStr} onChange={(e) => setNStr(e.target.value)} placeholder={String(DEFAULT_N)} />
                  </label>
                  <FieldHint text={`Por defecto ${DEFAULT_N}. Entre ${MIN_N} y ${MAX_N}; con valores altos la generación tarda más.`} />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">Nivel de preponderancia</span>
                  <FieldHint text="Qué tan marcada debe verse la problemática medida en los resultados simulados." />
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {NIVELES.map((lvl) => {
                      const selected = nivel === lvl.id;
                      return (
                        <button
                          key={lvl.id || "auto"}
                          onClick={() => setNivel(lvl.id)}
                          className={cn(
                            "rounded-xl border-2 px-3 py-2 text-left transition-all",
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
            )}
          </div>

          {issues.length > 0 && (
            <div className="space-y-1 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
              {issues.map((msg) => (
                <p key={msg} className="flex items-start gap-2"><span className="mt-0.5 shrink-0">•</span>{msg}</p>
              ))}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
          )}

          <Button size="lg" className="h-12 w-full" onClick={handleGenerate} disabled={phase === "working" || !canGenerate}>
            {phase === "working" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Generando tu base de datos... esto puede tardar 1 a 3 minutos
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                Generar tabulación descriptiva
              </>
            )}
          </Button>
          {phase === "working" && (
            <p className="text-center text-xs text-muted-foreground">
              La IA está clasificando tus preguntas y simulando encuestados coherentes. Puedes dejar esta pestaña abierta; no cierres la sesión.
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card className="step-enter rounded-2xl border-primary/30 bg-primary/5 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Check className="h-5 w-5" />
              ¡Tabulación descriptiva generada!
            </CardTitle>
            <CardDescription>Generado el {new Date(result.generatedAt).toLocaleString()}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-border/60 bg-background/80 p-4">
              <p className="text-sm font-semibold text-foreground">{result.resumen.tituloEstudio}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {TIPO_LABELS[result.resumen.tipoInstrumento] ?? result.resumen.tipoInstrumento}
                {" · "}{result.resumen.preguntas} preguntas · {result.resumen.nEncuestados} encuestados simulados
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Datos simulados: función pensada para pruebas, ensayos estadísticos y demostraciones académicas; no reemplaza datos reales.
              </p>
            </div>

            {result.warnings.length > 0 && (
              <div className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                {result.warnings.map((w) => (
                  <p key={w} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
            )}

            <a href={result.xlsxUrl} download={result.fileName} className="block">
              <div className="rounded-xl border-2 border-primary/40 bg-primary/10 p-4 text-center transition-all hover:border-primary hover:bg-primary/20">
                <Download className="mx-auto h-6 w-6 text-primary" />
                <p className="mt-2 text-sm font-semibold text-primary">Descargar Excel</p>
                <p className="text-xs text-muted-foreground">
                  Hojas "Base de datos" y "Resultados"{result.resumen.conBaremo ? ' + "Baremo"' : ""} con tablas, figuras e interpretaciones
                </p>
              </div>
            </a>

            <div>
              <p className="mb-3 text-sm font-medium">Vista previa de los resultados</p>
              <PreviewTable rows={result.previewRows} maxRows={14} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
