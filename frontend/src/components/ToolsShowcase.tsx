import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, FileSpreadsheet, MousePointerClick, ShieldCheck } from "lucide-react";
import { cn } from "../lib/utils";
import { AnimatedNumber, springSoft } from "./motion-primitives";

// Showcase interactivo de la suite: lista de pasos a la izquierda y un panel
// a la derecha donde cada herramienta tiene su propia viñeta en vivo (nada de
// tres tarjetas clonadas). Auto-avanza cada INTERVALO_MS; clic para fijar.
const INTERVALO_MS = 6000;

const HERRAMIENTAS = [
  {
    id: "forms",
    paso: "Recolecta",
    nombre: "Forms",
    icon: MousePointerClick,
    desc: "Rellena tu Google Forms con perfiles y distribuciones configurables, desde una extensión de Chrome conectada a tu cuenta.",
    cta: "Conectar la extensión",
  },
  {
    id: "confiabilidad",
    paso: "Valida",
    nombre: "Confiabilidad",
    icon: ShieldCheck,
    desc: "La prueba de Alfa de Cronbach por variable, con fórmulas vivas en el Excel e interpretación automática.",
    cta: "Validar mi instrumento",
  },
  {
    id: "tabulacion",
    paso: "Tabula",
    nombre: "Tabulación",
    icon: FileSpreadsheet,
    desc: "El Excel completo con baremos, frecuencias, correlación, gráficos e interpretaciones con formato de tesis.",
    cta: "Ver qué incluye",
  },
] as const;

type ToolId = (typeof HERRAMIENTAS)[number]["id"];

// ── Viñeta Forms: un formulario Likert respondiéndose solo ──────────────────
const PREGUNTAS_FORMS = [
  { texto: "P4. El equipo comunica sus avances", marcada: 3 },
  { texto: "P5. Recibo apoyo de mi supervisor", marcada: 4 },
  { texto: "P6. Los plazos se cumplen", marcada: 2 },
];

function VignetteForms({ reduce }: { reduce: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Encuesta de tesis · Google Forms</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
          <span className="relative flex h-1.5 w-1.5">
            {!reduce && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          Corrida en curso
        </span>
      </div>
      <div className="mt-5 space-y-4">
        {PREGUNTAS_FORMS.map((pregunta, qi) => (
          <div key={pregunta.texto} className="rounded-xl border border-border/70 bg-background/60 px-4 py-3">
            <p className="text-sm">{pregunta.texto}</p>
            <div className="mt-2.5 flex items-center gap-4">
              {[0, 1, 2, 3, 4].map((dot) => {
                const seleccionado = dot === pregunta.marcada;
                return (
                  <motion.span
                    key={dot}
                    initial={reduce || !seleccionado ? false : { scale: 0.4 }}
                    animate={{ scale: 1 }}
                    transition={{ ...springSoft, delay: 0.35 + qi * 0.45 }}
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border-2",
                      seleccionado ? "border-primary bg-primary" : "border-border",
                    )}
                  >
                    {seleccionado && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </motion.span>
                );
              })}
              <span className="ml-auto text-[10px] text-muted-foreground">1 a 5</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-baseline justify-between border-t border-border pt-3 text-sm">
        <span className="font-mono tabular-nums">
          Respuesta <span className="font-semibold"><AnimatedNumber value={24} /></span> de 30
        </span>
        <span className="text-xs text-muted-foreground">1 uso = 1 corrida</span>
      </div>
    </div>
  );
}

// ── Viñeta Confiabilidad: el α con su semáforo (datos de una corrida real) ──
function VignetteAlfa({ reduce }: { reduce: boolean }) {
  const alpha = 0.963;
  // La barra del semáforo representa el rango 0.50 a 1.00.
  const posicion = ((alpha - 0.5) / 0.5) * 100;
  return (
    <div>
      <p className="text-sm font-semibold">Alfa de Cronbach · Clima organizacional</p>
      <p className="text-sm text-muted-foreground">15 ítems · 30 encuestados · Likert 1 a 5</p>
      <div className="mt-6 flex items-baseline gap-3">
        <span className="font-mono text-5xl font-bold tracking-tight">
          α = <AnimatedNumber value={alpha} decimals={3} />
        </span>
        <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400">
          Excelente
        </span>
      </div>
      <div className="mt-6">
        <div className="relative h-2.5 rounded-full bg-gradient-to-r from-red-400 via-amber-400 to-green-500">
          <motion.span
            className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-[3px] border-background bg-foreground shadow-md"
            initial={reduce ? false : { left: "3%" }}
            animate={{ left: `${posicion}%` }}
            transition={{ type: "spring", stiffness: 60, damping: 16, delay: 0.4 }}
            style={{ marginLeft: -8 }}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>0.50</span><span>0.60</span><span>0.70</span><span>0.80</span><span>0.90</span><span>1.00</span>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-4">
        {[["K", "15"], ["ΣSi²", "15.35"], ["St²", "151.11"]].map(([k, v]) => (
          <div key={k}>
            <p className="text-[11px] text-muted-foreground">{k}</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Calculado en celda con fórmulas vivas: cambia un dato y el α se recalcula.
      </p>
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">Tú eliges el nivel objetivo de la simulación:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[["Excelente", "0.90 a 0.97", true], ["Bueno", "0.80 a 0.89", false], ["Aceptable", "0.70 a 0.79", false]].map(([nombre, rango, activo]) => (
            <span
              key={nombre as string}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                activo ? "border-primary/50 bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground",
              )}
            >
              {nombre} <span className="font-mono">{rango}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Viñeta Tabulación: la tabla baremada con su interpretación narrativa ────
const FILAS_TABLA = [
  { nivel: "Bajo", f: 133, pct: "46.0%" },
  { nivel: "Medio", f: 101, pct: "34.9%" },
  { nivel: "Alto", f: 55, pct: "19.0%" },
];

function VignetteTabulacion({ reduce }: { reduce: boolean }) {
  return (
    <div>
      <div className="flex gap-1 border-b border-border pb-2.5">
        {["Variable 1", "Ítems", "Dimensiones", "Relaciones"].map((tab) => (
          <span
            key={tab}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px]",
              tab === "Dimensiones" ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
            )}
          >
            {tab}
          </span>
        ))}
      </div>
      <p className="mt-4 text-sm font-semibold">Tabla 5 · Frecuencia baremada</p>
      <p className="text-sm text-muted-foreground">Dimensión: Planificación</p>
      <div className="mt-3 overflow-hidden rounded-xl border border-border/70">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 bg-accent/60 px-4 py-2 text-xs font-semibold">
          <span>Calificación</span><span className="text-right">f</span><span className="text-right">%</span>
        </div>
        {FILAS_TABLA.map((fila, i) => (
          <motion.div
            key={fila.nivel}
            initial={reduce ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springSoft, delay: 0.2 + i * 0.12 }}
            className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-t border-border/60 px-4 py-2 text-sm"
          >
            <span>{fila.nivel}</span>
            <span className="text-right font-mono tabular-nums">{fila.f}</span>
            <span className="text-right font-mono tabular-nums text-muted-foreground">{fila.pct}</span>
          </motion.div>
        ))}
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-t border-border bg-accent/40 px-4 py-2 text-sm font-semibold">
          <span>Total</span>
          <span className="text-right font-mono tabular-nums">289</span>
          <span className="text-right font-mono tabular-nums">100%</span>
        </div>
      </div>
      <motion.p
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.7 }}
        className="mt-4 border-l-2 border-primary/50 pl-3 text-sm italic leading-relaxed text-muted-foreground"
      >
        "Se aprecia que el 46.0% de los beneficiarios percibe un nivel bajo en la dimensión
        Planificación, seguido del 34.9% en el nivel medio..."
      </motion.p>
      <p className="mt-2 text-xs text-muted-foreground">Interpretación redactada automáticamente bajo cada figura.</p>
    </div>
  );
}

// ── Showcase completo ────────────────────────────────────────────────────────
export function ToolsShowcase({ onOpenApp, onVerIncluye }: {
  onOpenApp: () => void;
  onVerIncluye: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const [activa, setActiva] = useState<ToolId>("forms");
  const [ciclo, setCiclo] = useState(0); // reinicia la barra de progreso

  useEffect(() => {
    if (reduce) return;
    const timer = window.setTimeout(() => {
      const idx = HERRAMIENTAS.findIndex((t) => t.id === activa);
      setActiva(HERRAMIENTAS[(idx + 1) % HERRAMIENTAS.length].id);
      setCiclo((c) => c + 1);
    }, INTERVALO_MS);
    return () => window.clearTimeout(timer);
  }, [activa, ciclo, reduce]);

  const seleccionar = (id: ToolId) => {
    setActiva(id);
    setCiclo((c) => c + 1);
  };

  const tool = HERRAMIENTAS.find((t) => t.id === activa)!;
  const handleCta = tool.id === "tabulacion" ? onVerIncluye : onOpenApp;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[2fr_3fr] lg:gap-12">
      {/* Pasos del flujo (tabs verticales) */}
      <div className="space-y-2.5">
        {HERRAMIENTAS.map((item) => {
          const esActiva = item.id === activa;
          return (
            <button
              key={item.id}
              onClick={() => seleccionar(item.id)}
              aria-pressed={esActiva}
              className={cn(
                "relative w-full overflow-hidden rounded-2xl border px-5 py-4 text-left transition-all",
                esActiva
                  ? "border-primary/40 bg-card shadow-sm"
                  : "border-transparent hover:border-border hover:bg-card/60",
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                  esActiva ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground",
                )}>
                  <item.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className={cn("text-xs font-semibold", esActiva ? "text-primary" : "text-muted-foreground")}>
                    {item.paso}
                  </p>
                  <p className="font-bold tracking-tight">{item.nombre}</p>
                </div>
              </div>
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-300 ease-out",
                  esActiva ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <p className="pt-2.5 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              </div>
              {esActiva && !reduce && (
                <motion.span
                  key={`progreso-${ciclo}`}
                  className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-primary/60"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: INTERVALO_MS / 1000, ease: "linear" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Panel con la viñeta en vivo de la herramienta activa */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-[0_30px_70px_-30px_hsl(var(--primary)/0.35)] md:p-7">
        <div className="min-h-[340px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activa}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.3 }}
            >
              {activa === "forms" && <VignetteForms reduce={reduce} />}
              {activa === "confiabilidad" && <VignetteAlfa reduce={reduce} />}
              {activa === "tabulacion" && <VignetteTabulacion reduce={reduce} />}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <button
            onClick={handleCta}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:underline"
          >
            {tool.cta}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <div className="flex gap-1.5" aria-hidden>
            {HERRAMIENTAS.map((item) => (
              <span
                key={item.id}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  item.id === activa ? "w-5 bg-primary" : "w-1.5 bg-border",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
