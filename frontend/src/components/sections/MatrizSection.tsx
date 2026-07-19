import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDownToLine, Check, Copy, Sparkles, Table2 } from "lucide-react";
import { Button } from "../ui/button";
import { MagicButton } from "../ui/magic-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import * as api from "../../lib/api";
import { base64ToUint8Array } from "../../lib/helpers";
import type { AuthUser, MatrizData } from "../../lib/types";
import { FieldHint } from "../wizard-fields";
import { SubscriptionWarning } from "../SubscriptionWarning";
import { ToolSteps } from "../ToolSteps";
import { springSoft } from "../motion-primitives";

const POLL_INTERVAL_MS = 5000;
// Margen sobre el timeout del backend a la IA (OPENROUTER_TIMEOUT_MS, 10 min
// por defecto): son dos llamadas + búsquedas de dimensiones.
const POLL_TIMEOUT_MS = 11 * 60 * 1000;

// Fases mostradas durante la espera (el job real corre en el servidor; los
// umbrales siguen el orden y tiempos típicos de la generación).
const FASES = [
  { desde: 0, texto: "Analizando el título: variables, conector y tipo de estudio" },
  { desde: 40, texto: "Buscando dimensiones con autores reales para cada variable" },
  { desde: 110, texto: "Redactando problemas, objetivos, hipótesis y metodología" },
] as const;

const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Serializa la matriz a texto plano para el botón "Copiar todo".
function matrizToText(m: MatrizData): string {
  const lines: string[] = ["MATRIZ DE CONSISTENCIA", m.titulo, ""];
  lines.push("PROBLEMA GENERAL:", m.problema.general, "", "PROBLEMAS ESPECÍFICOS:");
  m.problema.especificos.forEach((p) => lines.push(`- ${p}`));
  lines.push("", "OBJETIVO GENERAL:", m.objetivos.general, "", "OBJETIVOS ESPECÍFICOS:");
  m.objetivos.especificos.forEach((o) => lines.push(`- ${o}`));
  if (m.hipotesis) {
    lines.push("", "HIPÓTESIS GENERAL:", m.hipotesis.general, "", "HIPÓTESIS NULA:", m.hipotesis.nula);
    if (m.hipotesis.especificas.length > 0) {
      lines.push("", "HIPÓTESIS ESPECÍFICAS:");
      m.hipotesis.especificas.forEach((h) => lines.push(`- ${h}`));
    }
  }
  lines.push("", "VARIABLES Y DIMENSIONES:");
  m.variables.forEach((v) => {
    lines.push(`${v.rol ? `${v.rol}: ` : ""}${v.nombre}`);
    lines.push(`Dimensiones según ${v.autor}:`);
    v.dimensiones.forEach((d) => lines.push(`- ${d}`));
    lines.push(`Fuente: ${v.fuente}`, "");
  });
  lines.push("METODOLOGÍA:");
  lines.push(`Tipo de investigación: ${m.metodologia.tipo}`);
  lines.push(`Enfoque: ${m.metodologia.enfoque}`);
  lines.push(`Nivel o alcance: ${m.metodologia.nivel}`);
  lines.push(`Diseño: ${m.metodologia.diseno}`);
  lines.push(`Población: ${m.metodologia.poblacion}`);
  lines.push(`Muestra: ${m.metodologia.muestra}`);
  lines.push(`Muestreo: ${m.metodologia.muestreo}`);
  lines.push(`Técnica: ${m.metodologia.tecnica}`);
  lines.push(`Instrumento: ${m.metodologia.instrumento}`);
  return lines.join("\n");
}

// Bloques de celda de la tabla en pantalla.
function CellLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold text-foreground">{children}</p>;
}

function CellList({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="mt-0.5 shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// Sección Matriz de Consistencia: formulario de una sola pantalla (NO chat).
// El backend analiza el título (conector "y"/"en"/"para", tipo, enfoque,
// nivel, diseño), busca dimensiones reales con autor citable para cada
// variable y devuelve la matriz en JSON + Word apaisado.
export function MatrizSection({ apiBaseUrl, authToken, authUser }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
}) {
  const reduce = useReducedMotion() ?? false;
  const [titulo, setTitulo] = useState("");
  const [universidad, setUniversidad] = useState("");
  const [carrera, setCarrera] = useState("");
  const [poblacion, setPoblacion] = useState("");
  const [lugar, setLugar] = useState("");
  const [anio, setAnio] = useState("");
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [matriz, setMatriz] = useState<MatrizData | null>(null);
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

  const issues: string[] = [];
  if (anio.trim() && !/^\d{4}$/.test(anio.trim())) {
    issues.push("El año debe tener 4 dígitos (déjalo vacío para usar el del título o el actual).");
  }
  const canGenerate = titulo.trim().length > 0 && issues.length === 0;

  const fase = FASES.reduce((acc, f) => (elapsed >= f.desde ? f : acc), FASES[0]);
  // Progreso asintótico: avanza rápido al inicio y se acerca a 92% sin
  // llegar; el 100% real lo pone la respuesta del servidor.
  const progreso = Math.min(92, Math.round(100 * (1 - Math.exp(-elapsed / 70))));

  const pollJob = (jobId: string, startedAt: number) => {
    pollRef.current = window.setTimeout(async () => {
      try {
        const job = await api.getMatrizJob(apiBaseUrl, authToken, jobId);
        if (!aliveRef.current) return;
        if (job.status === "done" && job.matriz) {
          setMatriz(job.matriz);
          if (job.docxBase64) {
            const docxBytes = base64ToUint8Array(job.docxBase64);
            const url = URL.createObjectURL(new Blob(
              [docxBytes.buffer as ArrayBuffer],
              { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            ));
            if (docxUrlRef.current) URL.revokeObjectURL(docxUrlRef.current);
            docxUrlRef.current = url;
            setDocx({ url, fileName: job.docxFileName ?? "Matriz_de_consistencia.docx" });
          }
          setPhase("idle");
          return;
        }
        if (job.status === "error") {
          throw new Error(job.error ?? "Hubo un problema generando tu matriz de consistencia, intenta de nuevo.");
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error("La generación está tardando más de lo normal. Intenta de nuevo en unos minutos.");
        }
        pollJob(jobId, startedAt);
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : "No se pudo generar la matriz.");
        setPhase("idle");
      }
    }, POLL_INTERVAL_MS);
  };

  const handleGenerate = async () => {
    setError(null);
    setMatriz(null);
    if (docxUrlRef.current) URL.revokeObjectURL(docxUrlRef.current);
    docxUrlRef.current = null;
    setDocx(null);
    setCopied(false);
    if (!canGenerate) return;
    setPhase("working");
    try {
      const started = await api.startMatriz(apiBaseUrl, authToken, {
        titulo: titulo.trim(),
        ...(universidad.trim() ? { universidad: universidad.trim() } : {}),
        ...(carrera.trim() ? { carrera: carrera.trim() } : {}),
        ...(poblacion.trim() ? { poblacion: poblacion.trim() } : {}),
        ...(lugar.trim() ? { lugar: lugar.trim() } : {}),
        ...(anio.trim() ? { anio: anio.trim() } : {}),
      });
      pollJob(started.jobId, Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la generación.");
      setPhase("idle");
    }
  };

  const copyAll = async () => {
    if (!matriz) return;
    try {
      await navigator.clipboard.writeText(matrizToText(matriz));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert("No se pudo copiar; selecciona el texto manualmente.");
    }
  };

  const conHipotesis = Boolean(matriz?.hipotesis);

  return (
    <div className="step-enter mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-2xl font-bold tracking-tight">Matriz de consistencia</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" />
            Con IA
          </span>
        </div>
        <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">
          Pega tu título de tesis y recibe la matriz completa: problemas, objetivos, hipótesis,
          variables con dimensiones respaldadas por un autor real y la metodología coherente con tu estudio.
        </p>
      </div>

      <ToolSteps steps={[
        "Pega el título de tu tesis (lo demás es opcional)",
        "La IA redacta problema, objetivos, hipótesis y variables",
        "Descarga tu matriz completa en Word apaisado",
      ]} />

      <SubscriptionWarning user={authUser} tool="matriz" />

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Table2 className="h-5 w-5 text-primary" />
            Datos de tu investigación
          </CardTitle>
          <CardDescription className="max-w-[60ch]">
            Solo el título es obligatorio; los demás campos ayudan cuando el título no los menciona.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="block">
            <span className="text-sm font-medium">Título de tu tesis</span>
            <Textarea
              className="mt-1.5 min-h-20"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              disabled={phase === "working"}
              placeholder="Ej. La gestión administrativa y la satisfacción del usuario en la Municipalidad Distrital de Amarilis, 2026"
            />
            <FieldHint text="La IA analiza las variables y su conector (y / en / para) para deducir el tipo, nivel, diseño y enfoque del estudio." />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Universidad <span className="font-normal text-muted-foreground">(opcional)</span></span>
              <Input
                className="mt-1.5"
                value={universidad}
                onChange={(e) => setUniversidad(e.target.value)}
                disabled={phase === "working"}
                placeholder="Ej. Universidad de Huánuco"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Carrera <span className="font-normal text-muted-foreground">(opcional)</span></span>
              <Input
                className="mt-1.5"
                value={carrera}
                onChange={(e) => setCarrera(e.target.value)}
                disabled={phase === "working"}
                placeholder="Ej. Administración de Empresas"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Población <span className="font-normal text-muted-foreground">(opcional)</span></span>
              <Input
                className="mt-1.5"
                value={poblacion}
                onChange={(e) => setPoblacion(e.target.value)}
                disabled={phase === "working"}
                placeholder="Ej. 80 trabajadores administrativos"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Lugar <span className="font-normal text-muted-foreground">(opcional)</span></span>
              <Input
                className="mt-1.5"
                value={lugar}
                onChange={(e) => setLugar(e.target.value)}
                disabled={phase === "working"}
                placeholder="Ej. Huánuco, Hospital Regional..."
              />
            </label>
          </div>

          <label className="block max-w-[220px]">
            <span className="text-sm font-medium">Año <span className="font-normal text-muted-foreground">(opcional)</span></span>
            <Input
              className="mt-1.5 font-mono tabular-nums"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              disabled={phase === "working"}
              placeholder={String(new Date().getFullYear())}
            />
            <FieldHint text="Si lo dejas vacío, se usa el año del título o el actual." />
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
                    {fase.texto}… la IA busca dimensiones en fuentes reales antes de armar la matriz, esto suele tardar varios minutos.
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
                  Generar matriz de consistencia
                </MagicButton>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {matriz && (
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
                  Matriz de consistencia lista
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
                {matriz.titulo} — revisa dimensiones y autores con tu asesor: son una propuesta de partida.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/80">
                <table className="w-full min-w-[900px] border-collapse text-left align-top">
                  <thead>
                    <tr className="border-b border-border/60 bg-primary/10">
                      <th className="px-3 py-2 text-xs font-bold text-primary">Problemas</th>
                      <th className="px-3 py-2 text-xs font-bold text-primary">Objetivos</th>
                      {conHipotesis && <th className="px-3 py-2 text-xs font-bold text-primary">Hipótesis</th>}
                      <th className="px-3 py-2 text-xs font-bold text-primary">Variables y dimensiones</th>
                      <th className="px-3 py-2 text-xs font-bold text-primary">Metodología</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border-r border-border/40 px-3 py-3 align-top">
                        <CellLabel>Problema general:</CellLabel>
                        <p className="mt-1 text-xs text-muted-foreground">{matriz.problema.general}</p>
                        <div className="mt-3">
                          <CellLabel>Problemas específicos:</CellLabel>
                          <CellList items={matriz.problema.especificos} />
                        </div>
                      </td>
                      <td className="border-r border-border/40 px-3 py-3 align-top">
                        <CellLabel>Objetivo general:</CellLabel>
                        <p className="mt-1 text-xs text-muted-foreground">{matriz.objetivos.general}</p>
                        <div className="mt-3">
                          <CellLabel>Objetivos específicos:</CellLabel>
                          <CellList items={matriz.objetivos.especificos} />
                        </div>
                      </td>
                      {conHipotesis && matriz.hipotesis && (
                        <td className="border-r border-border/40 px-3 py-3 align-top">
                          <CellLabel>Hipótesis general:</CellLabel>
                          <p className="mt-1 text-xs text-muted-foreground">{matriz.hipotesis.general}</p>
                          <div className="mt-3">
                            <CellLabel>Hipótesis nula:</CellLabel>
                            <p className="mt-1 text-xs text-muted-foreground">{matriz.hipotesis.nula}</p>
                          </div>
                          {matriz.hipotesis.especificas.length > 0 && (
                            <div className="mt-3">
                              <CellLabel>Hipótesis específicas:</CellLabel>
                              <CellList items={matriz.hipotesis.especificas} />
                            </div>
                          )}
                        </td>
                      )}
                      <td className="border-r border-border/40 px-3 py-3 align-top">
                        {matriz.variables.map((v, i) => (
                          <div key={i} className={i > 0 ? "mt-4" : undefined}>
                            <CellLabel>{v.rol ? `${v.rol.charAt(0).toUpperCase()}${v.rol.slice(1)}: ` : ""}{v.nombre}</CellLabel>
                            <p className="mt-1 text-xs italic text-muted-foreground">Dimensiones según {v.autor}:</p>
                            <CellList items={v.dimensiones} />
                            <a
                              href={v.fuente}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1.5 block break-all text-[11px] text-primary underline underline-offset-2"
                            >
                              {v.fuente}
                            </a>
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <dl className="space-y-1.5 text-xs">
                          {([
                            ["Tipo de investigación", matriz.metodologia.tipo],
                            ["Enfoque", matriz.metodologia.enfoque],
                            ["Nivel o alcance", matriz.metodologia.nivel],
                            ["Diseño", matriz.metodologia.diseno],
                            ["Población", matriz.metodologia.poblacion],
                            ["Muestra", matriz.metodologia.muestra],
                            ["Muestreo", matriz.metodologia.muestreo],
                            ["Técnica", matriz.metodologia.tecnica],
                            ["Instrumento", matriz.metodologia.instrumento],
                          ] as const).map(([label, value]) => (
                            <div key={label}>
                              <dt className="inline font-semibold text-foreground">{label}: </dt>
                              <dd className="inline text-muted-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
