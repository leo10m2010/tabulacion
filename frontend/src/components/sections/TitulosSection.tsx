import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, GraduationCap, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import { MagicButton } from "../ui/magic-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import * as api from "../../lib/api";
import type { AuthUser } from "../../lib/types";
import { FieldHint } from "../wizard-fields";
import { SubscriptionWarning } from "../SubscriptionWarning";
import { springSoft } from "../motion-primitives";

const POLL_INTERVAL_MS = 5000;
// Margen sobre el timeout del backend a la IA (OPENROUTER_TIMEOUT_MS, 10 min
// por defecto): la busqueda web en repositorios puede sumar minutos extra.
const POLL_TIMEOUT_MS = 11 * 60 * 1000;

const OPCIONES_VARIABLES = [
  {
    id: "2" as const,
    label: "2 variables (correlacional)",
    hint: "Título con relación entre dos variables, con hipótesis y objetivo/problema relacional",
  },
  {
    id: "1" as const,
    label: "1 variable (descriptiva)",
    hint: "Título enfocado en una sola variable y sus dimensiones, sin hipótesis",
  },
];

// Fases mostradas durante la espera (el job real corre en el servidor; los
// umbrales siguen el orden y tiempos tipicos de la generacion).
const FASES = [
  { desde: 0, texto: "Analizando universidad, carrera y lugar" },
  { desde: 15, texto: "Buscando tesis en el repositorio institucional, ALICIA y RENATI" },
  { desde: 90, texto: "Redactando los tres títulos con su desarrollo completo" },
] as const;

const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Render minimalista de markdown, sin dependencias nuevas: respeta saltos de
// línea y **negritas**. Tablas/otros elementos quedan como texto plano.
function renderInlineBold(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => (
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-${i}`}>{part}</span>
  ));
}

function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((line, i) => (
        line.trim() === ""
          ? <div key={i} className="h-2" aria-hidden />
          : <p key={i} className="whitespace-pre-wrap break-words">{renderInlineBold(line, `l${i}`)}</p>
      ))}
    </div>
  );
}

// Sección Generador de Títulos de Investigación: formulario de una sola
// pantalla (NO chat, sin historial ni turnos). El backend hace UNA llamada a
// GLM-5.2 con la tool openrouter:web_search y devuelve 3 propuestas de
// título desarrolladas según la carrera, universidad y lugar indicados.
export function TitulosSection({ apiBaseUrl, authToken, authUser }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
}) {
  const reduce = useReducedMotion() ?? false;
  const [universidad, setUniversidad] = useState("");
  const [carrera, setCarrera] = useState("");
  const [lugar, setLugar] = useState("");
  const [numeroVariables, setNumeroVariables] = useState<"1" | "2">("2");
  const [anio, setAnio] = useState("");
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [contenido, setContenido] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<number | null>(null);
  // Evita setState tras desmontar: la limpieza cancela el timeout pendiente,
  // pero una petición de polling ya en vuelo resuelve igual.
  const aliveRef = useRef(true);

  useEffect(() => () => {
    aliveRef.current = false;
    if (pollRef.current) window.clearTimeout(pollRef.current);
  }, []);

  // Cronómetro de la espera (solo mientras el job corre).
  useEffect(() => {
    if (phase !== "working") return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const issues: string[] = [];
  if (anio.trim() && !/^\d{4}$/.test(anio.trim())) {
    issues.push("El año debe tener 4 dígitos (déjalo vacío para usar el año actual).");
  }
  const canGenerate = universidad.trim().length > 0
    && carrera.trim().length > 0
    && lugar.trim().length > 0
    && issues.length === 0;

  const fase = FASES.reduce((acc, f) => (elapsed >= f.desde ? f : acc), FASES[0]);
  // Progreso asintótico: avanza rápido al inicio y se acerca a 92% sin
  // llegar; el 100% real lo pone la respuesta del servidor.
  const progreso = Math.min(92, Math.round(100 * (1 - Math.exp(-elapsed / 70))));

  const pollJob = (jobId: string, startedAt: number) => {
    pollRef.current = window.setTimeout(async () => {
      try {
        const job = await api.getTitulosJob(apiBaseUrl, authToken, jobId);
        if (!aliveRef.current) return;
        if (job.status === "done" && job.contenido) {
          setContenido(job.contenido);
          setPhase("idle");
          return;
        }
        if (job.status === "error") {
          throw new Error(job.error ?? "Hubo un problema generando tus títulos, intenta de nuevo.");
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error("La generación está tardando más de lo normal. Intenta de nuevo en unos minutos.");
        }
        pollJob(jobId, startedAt);
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : "No se pudo generar los títulos.");
        setPhase("idle");
      }
    }, POLL_INTERVAL_MS);
  };

  const handleGenerate = async () => {
    setError(null);
    setContenido(null);
    setCopied(false);
    if (!canGenerate) return;
    setPhase("working");
    try {
      const started = await api.startTitulos(apiBaseUrl, authToken, {
        universidad: universidad.trim(),
        carrera: carrera.trim(),
        lugar: lugar.trim(),
        numero_variables: numeroVariables,
        ...(anio.trim() ? { anio: anio.trim() } : {}),
      });
      pollJob(started.jobId, Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la generación.");
      setPhase("idle");
    }
  };

  const copyAll = async () => {
    if (!contenido) return;
    try {
      await navigator.clipboard.writeText(contenido);
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
          <h2 className="text-2xl font-bold tracking-tight">Generador de títulos de investigación</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" />
            Con IA
          </span>
        </div>
        <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
          Completa estos datos y recibe 3 propuestas de título desarrolladas, basadas en una
          búsqueda real en el repositorio de tu universidad, ALICIA y RENATI.
        </p>
      </div>

      <SubscriptionWarning user={authUser}>
        Tu suscripción de Tabulación está vencida: el generador de títulos usa la misma suscripción.
        Pide al administrador que recargue tus días.
      </SubscriptionWarning>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Datos de tu investigación
          </CardTitle>
          <CardDescription className="max-w-[60ch]">
            Solo estos 5 datos; sin chat ni preguntas de seguimiento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Universidad</span>
              <Input
                className="mt-1.5"
                value={universidad}
                onChange={(e) => setUniversidad(e.target.value)}
                disabled={phase === "working"}
                placeholder="Ej. Universidad de Huánuco"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Carrera</span>
              <Input
                className="mt-1.5"
                value={carrera}
                onChange={(e) => setCarrera(e.target.value)}
                disabled={phase === "working"}
                placeholder="Ej. Enfermería"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">Lugar</span>
            <Input
              className="mt-1.5"
              value={lugar}
              onChange={(e) => setLugar(e.target.value)}
              disabled={phase === "working"}
              placeholder="Ej. Huánuco, distrito de Amarilis, Hospital Regional..."
            />
            <FieldHint text="Ciudad, distrito, provincia, región, institución o empresa: se usa tal cual lo escribas, sin cambios." />
          </label>

          <div>
            <span className="text-sm font-medium">Número de variables</span>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OPCIONES_VARIABLES.map((opt) => {
                const selected = numeroVariables === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setNumeroVariables(opt.id)}
                    disabled={phase === "working"}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-xl border-2 px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      selected ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50",
                    )}
                  >
                    <span className={cn("block text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>
                      {opt.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block max-w-[220px]">
            <span className="text-sm font-medium">Año</span>
            <Input
              className="mt-1.5 font-mono tabular-nums"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              disabled={phase === "working"}
              placeholder="Año actual si lo dejas vacío"
            />
          </label>

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
                    {fase.texto}… la IA busca en repositorios reales antes de proponer los títulos, esto suele tardar varios minutos.
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
                  Generar títulos
                </MagicButton>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {contenido && (
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
                  Propuestas de título listas
                </CardTitle>
                <Button size="sm" variant="outline" onClick={copyAll}>
                  {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado" : "Copiar todo"}
                </Button>
              </div>
              <CardDescription>
                Revisa antecedentes y variables: son propuestas de partida, no reemplazan tu criterio ni el de tu asesor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                <MarkdownLite text={contenido} />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
