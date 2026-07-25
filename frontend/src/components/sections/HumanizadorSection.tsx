import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle, ArrowDownToLine, Check, Copy, Feather, Sparkles,
} from "lucide-react";
import { Button } from "../ui/button";
import { MagicButton } from "../ui/magic-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { TextDropZone } from "../TextDropZone";
import { cn } from "../../lib/utils";
import * as api from "../../lib/api";
import { base64ToUint8Array } from "../../lib/helpers";
import type { AuthUser, HumanizadorMetricas, HumanizadorMetricasLado, PasoTesis } from "../../lib/types";
import { SubscriptionWarning } from "../SubscriptionWarning";
import { ToolSteps } from "../ToolSteps";
import { springSoft } from "../motion-primitives";

const POLL_INTERVAL_MS = 5000;
// Hasta 4 bloques × 2 pasadas (llamadas cortas sin reasoning); margen sobre
// el timeout del backend a la IA.
const POLL_TIMEOUT_MS = 16 * 60 * 1000;

const MIN_PALABRAS = 50;
const MAX_PALABRAS = 3000;

// Fases mostradas durante la espera (el job real corre en el servidor).
const FASES = [
  { desde: 0, texto: "Leyendo tu texto" },
  { desde: 15, texto: "Reescribiendo con ritmo humano" },
  { desde: 90, texto: "Midiendo perplejidad y burstiness" },
  { desde: 150, texto: "Aplicando la repasada dirigida" },
] as const;

const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Filas de la tabla de métricas antes/después. `mejora` indica hacia dónde
// apunta lo bueno para colorear la variación.
const METRIC_ROWS: {
  label: string;
  hint: string;
  value: (m: HumanizadorMetricasLado) => string;
  raw: (m: HumanizadorMetricasLado) => number;
  mejora: "sube" | "baja" | "neutral";
}[] = [
  {
    label: "Variación de ritmo (CV)",
    hint: "Qué tanto cambia la longitud entre oraciones; el texto humano varía más.",
    value: (m) => m.cv.toFixed(2),
    raw: (m) => m.cv,
    mejora: "sube",
  },
  {
    label: "Oraciones de longitud media",
    hint: "Porcentaje de oraciones de 15-22 palabras; la IA concentra casi todo ahí.",
    value: (m) => `${Math.round(m.pctBanda1522)}%`,
    raw: (m) => m.pctBanda1522,
    mejora: "baja",
  },
  {
    label: "Frases delatoras de IA",
    hint: 'Muletillas típicas de la IA ("cabe destacar", "hoy en día", "en conclusión"...).',
    value: (m) => String(m.delatoras),
    raw: (m) => m.delatoras,
    mejora: "baja",
  },
  {
    label: "Palabras",
    hint: "La extensión se mantiene: es una reescritura, no un resumen.",
    value: (m) => m.palabras.toLocaleString(),
    raw: (m) => m.palabras,
    mejora: "neutral",
  },
];

function MetricasComparison({ metricas }: { metricas: HumanizadorMetricas }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/80">
      <table className="w-full min-w-[420px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border/60 bg-primary/10">
            <th className="px-3 py-2 text-xs font-bold text-primary">Métrica</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-primary">Antes</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-primary">Después</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => {
            const antes = row.raw(metricas.antes);
            const despues = row.raw(metricas.despues);
            const mejoro = row.mejora === "sube" ? despues > antes
              : row.mejora === "baja" ? despues < antes
              : false;
            return (
              <tr key={row.label} className="border-b border-border/40 last:border-b-0">
                <td className="px-3 py-2 align-top">
                  <p className="text-xs font-semibold text-foreground">{row.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{row.hint}</p>
                </td>
                <td className="px-3 py-2 text-right align-top font-mono text-xs tabular-nums text-muted-foreground">
                  {row.value(metricas.antes)}
                </td>
                <td className={cn(
                  "px-3 py-2 text-right align-top font-mono text-xs font-semibold tabular-nums",
                  row.mejora !== "neutral" && mejoro ? "text-primary" : "text-foreground",
                )}>
                  {row.value(metricas.despues)}
                  {row.mejora !== "neutral" && mejoro && <span aria-hidden> {row.mejora === "sube" ? "↑" : "↓"}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Sección Humanizador: reescribe texto académico generado con IA variando el
// ritmo (burstiness) y el léxico (perplejidad) sin tocar citas APA, cifras
// ni significado. El backend mide el resultado y aplica una repasada
// dirigida cuando sigue sonando a máquina.
export function HumanizadorSection({ apiBaseUrl, authToken, authUser, onPasoHecho, onUpgrade }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  // Marca este paso como hecho en el proyecto activo, si hay uno.
  onPasoHecho?: (paso: PasoTesis) => void;
  onUpgrade?: (herramienta: string) => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const [texto, setTexto] = useState("");
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ texto: string; metricas: HumanizadorMetricas | null } | null>(null);
  const [docx, setDocx] = useState<{ url: string; fileName: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<number | null>(null);
  const docxUrlRef = useRef<string | null>(null);
  // Evita setState tras desmontar: la limpieza cancela el timeout pendiente,
  // pero una petición de polling ya en vuelo resuelve igual.
  const aliveRef = useRef(true);

  useEffect(() => () => {
    aliveRef.current = false;
    if (pollRef.current) window.clearTimeout(pollRef.current);
    if (docxUrlRef.current) URL.revokeObjectURL(docxUrlRef.current);
  }, []);

  // Cronómetro de la espera (solo mientras el job corre).
  useEffect(() => {
    if (phase !== "working") return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const palabras = texto.trim() ? texto.trim().split(/\s+/).length : 0;
  const issues: string[] = [];
  if (!docxFile && palabras > 0 && palabras < MIN_PALABRAS) {
    issues.push(`El texto es demasiado corto (${palabras} palabras); el mínimo es ${MIN_PALABRAS}.`);
  }
  if (!docxFile && palabras > MAX_PALABRAS) {
    issues.push(`El texto supera el límite de ${MAX_PALABRAS.toLocaleString()} palabras por corrida; divídelo en partes.`);
  }
  const canGenerate = (docxFile !== null || (palabras >= MIN_PALABRAS && palabras <= MAX_PALABRAS))
    && issues.length === 0;

  const fase = FASES.reduce((acc, f) => (elapsed >= f.desde ? f : acc), FASES[0]);
  // Progreso asintótico: avanza rápido al inicio y se acerca a 92% sin
  // llegar; el 100% real lo pone la respuesta del servidor.
  const progreso = Math.min(92, Math.round(100 * (1 - Math.exp(-elapsed / 80))));

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

  const clearFile = () => setDocxFile(null);

  const pollJob = (jobId: string, startedAt: number) => {
    pollRef.current = window.setTimeout(async () => {
      try {
        const job = await api.getHumanizadorJob(apiBaseUrl, authToken, jobId);
        if (!aliveRef.current) return;
        if (job.status === "done" && job.textoHumanizado) {
          setResultado({ texto: job.textoHumanizado, metricas: job.metricas ?? null });
          if (job.docxBase64) {
            const docxBytes = base64ToUint8Array(job.docxBase64);
            const url = URL.createObjectURL(new Blob(
              [docxBytes.buffer as ArrayBuffer],
              { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            ));
            if (docxUrlRef.current) URL.revokeObjectURL(docxUrlRef.current);
            docxUrlRef.current = url;
            setDocx({ url, fileName: job.docxFileName ?? "Texto_humanizado.docx" });
          }
          setPhase("idle");
          onPasoHecho?.("humanizador");
          return;
        }
        if (job.status === "error") {
          throw new Error(job.error ?? "Hubo un problema humanizando tu texto, intenta de nuevo.");
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error("La humanización está tardando más de lo normal. Intenta de nuevo en unos minutos.");
        }
        pollJob(jobId, startedAt);
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : "No se pudo humanizar el texto.");
        setPhase("idle");
      }
    }, POLL_INTERVAL_MS);
  };

  const handleGenerate = async () => {
    setError(null);
    setResultado(null);
    if (docxUrlRef.current) URL.revokeObjectURL(docxUrlRef.current);
    docxUrlRef.current = null;
    setDocx(null);
    setCopied(false);
    if (!canGenerate) return;
    setPhase("working");
    try {
      const body: { texto?: string; docxBase64?: string } = {};
      if (docxFile) {
        body.docxBase64 = await fileToBase64(docxFile);
      } else {
        body.texto = texto.trim();
      }
      const started = await api.startHumanizador(apiBaseUrl, authToken, body);
      pollJob(started.jobId, Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la humanización.");
      setPhase("idle");
    }
  };

  const copyAll = async () => {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(resultado.texto);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert("No se pudo copiar; selecciona el texto manualmente.");
    }
  };

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-2xl font-bold tracking-tight">Humanizador de texto académico</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" />
            Con IA
          </span>
        </div>
        <p className="mt-1 max-w-[66ch] text-sm text-muted-foreground">
          Reescribe tu texto variando el ritmo de las oraciones y el léxico para que suene escrito
          por una persona, sin tocar tus citas APA, cifras ni el significado.
        </p>
      </div>

      <ToolSteps steps={[
        "Pega tu texto o sube el Word (50 a 3,000 palabras)",
        "Se reescribe por bloques conservando citas y cifras",
        "Compara las métricas y descarga el resultado en Word",
      ]} />

      <SubscriptionWarning user={authUser} tool="humanizador" onUpgrade={onUpgrade} />

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Feather className="h-5 w-5 text-primary" />
            Tu texto
          </CardTitle>
          <CardDescription className="max-w-[60ch]">
            Pega el texto (50 a 3000 palabras) o sube un Word; se procesa por bloques y se mide el resultado.
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
            placeholder={"Pega aquí el fragmento de tu tesis (marco teórico, discusión, antecedentes...).\n\nLas citas como (García, 2020) y las cifras se conservan intactas."}
            minHeightClass="min-h-[280px]"
            stats={
              palabras > 0 ? (
                <span className={cn(palabras > MAX_PALABRAS && "font-semibold text-danger")}>
                  {palabras.toLocaleString()} / {MAX_PALABRAS.toLocaleString()} palabras
                </span>
              ) : undefined
            }
            footerHint="Arrastra y suelta tu Word aquí · solo .docx, máximo 3 MB"
            fileNote="el servidor validará que tenga entre 50 y 3000 palabras"
          />

          {/* Aviso honesto: siempre visible, no solo en el resultado */}
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Sé transparente con tu asesor.</span>{" "}
              Esta herramienta mejora el ritmo y el léxico para que el texto suene más natural y ayuda
              frente a detectores débiles, pero <span className="font-semibold text-foreground">ningún
              humanizador garantiza pasar Turnitin</span> ni otros detectores de IA. Revisa el resultado
              y hazlo tuyo antes de entregarlo.
            </p>
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
                    Humanizando en el servidor
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
                    {fase.texto}… el texto se reescribe por bloques y se mide antes de entregarlo, esto suele tardar varios minutos.
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
                  <Feather className="h-5 w-5" />
                  Humanizar texto
                </MagicButton>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {resultado && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springSoft}
        >
          <Card className="rounded-2xl border-primary/30 bg-primary/5 shadow-[0_24px_60px_-28px_hsl(var(--primary)/0.4)]">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Check className="h-5 w-5" />
                  Texto humanizado listo
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={copyAll}>
                    {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copiado" : "Copiar todo"}
                  </Button>
                  {docx && (
                    <a
                      href={docx.url}
                      download={docx.fileName}
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-glow transition duration-150 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px active:scale-[0.985]"
                    >
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                      Descargar Word
                    </a>
                  )}
                </div>
              </div>
              <CardDescription>
                Verifica que tus citas y cifras sigan intactas y ajusta lo que no suene a ti: el texto final es tu responsabilidad.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {resultado.metricas && <MetricasComparison metricas={resultado.metricas} />}
              <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {resultado.texto}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
