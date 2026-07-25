import React, { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  Download,
  Feather,
  FileSpreadsheet,
  GraduationCap,
  MessageCircle,
  Moon,
  PieChart,
  Ruler,
  Sigma,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { ThemeMode } from "../lib/types";
import { Reveal, springSoft } from "./motion-primitives";
import { ToolsShowcase } from "./ToolsShowcase";
import { ToolsMarquee } from "./ToolsMarquee";

export function LandingPage({
  themeMode,
  onToggleTheme,
  onOpenApp,
}: {
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onOpenApp: (intent?: "login" | "registro") => void;
}) {
  const [billingMode, setBillingMode] = useState<"monthly" | "yearly">("monthly");
  const reduce = useReducedMotion();

  const CONTACT_EMAIL = "contacto@tutorica.com";
  const CONTACT_WHATSAPP = "51975212132"; // +51 975 212 132
  const openWhatsApp = () => {
    const text = encodeURIComponent("Hola, me interesa el Plan Institución de TesisHub.");
    window.open(`https://wa.me/${CONTACT_WHATSAPP}?text=${text}`, "_blank", "noopener");
  };
  const goToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  // Los tres planes funcionan por usos: cada generación o corrida consume 1
  // uso de su herramienta, y el plan carga la cuota mensual de cada una.
  const plans = useMemo(
    () => [
      {
        id: "esencial",
        name: "Plan Esencial",
        audience: "Para empezar",
        icon: UserRound,
        priceMonthlyUsd: "USD 15",
        priceYearlyUsd: "USD 150",
        priceMonthlyPen: "S/ 49",
        priceYearlyPen: "S/ 490",
        description: "Para trabajos académicos puntuales o para probar el sistema en serio.",
        highlights: [
          "2 tabulaciones y 2 pruebas de confiabilidad",
          "3 bases descriptivas con IA",
          "3 generaciones de títulos y 1 matriz",
          "5 humanizaciones de texto",
          "2 corridas de Forms",
        ],
        cta: "Avanzar mi tesis",
        featured: false,
      },
      {
        id: "tesista",
        name: "Plan Tesista",
        audience: "Tesistas y asesores",
        icon: GraduationCap,
        priceMonthlyUsd: "USD 29",
        priceYearlyUsd: "USD 290",
        priceMonthlyPen: "S/ 109",
        priceYearlyPen: "S/ 1,090",
        description: "La cuota completa para sacar adelante una tesis de principio a fin.",
        highlights: [
          "10 tabulaciones y 10 pruebas de confiabilidad",
          "10 bases descriptivas y 10 generaciones de títulos",
          "5 matrices de consistencia",
          "30 humanizaciones de texto",
          "10 corridas de Forms",
        ],
        cta: "Avanzar mi tesis",
        featured: true,
      },
      {
        id: "institucion",
        name: "Plan Institución",
        audience: "Universidades y consultoras",
        icon: Building2,
        priceMonthlyUsd: "USD 129",
        priceYearlyUsd: "USD 1,290",
        priceMonthlyPen: "S/ 485",
        priceYearlyPen: "S/ 4,850",
        description: "Para equipos que gestionan múltiples tesis con control administrativo.",
        highlights: [
          "Hasta 20 cuentas, cada una con cuota Tesista",
          "Panel de administrador",
          "Recargas por herramienta para el equipo",
          "Soporte prioritario",
        ],
        cta: "Contáctanos",
        featured: false,
      },
    ],
    [],
  );

  const pasos = [
    { titulo: "Configura", desc: "Variables, dimensiones, indicadores y la escala de tu instrumento, guiado paso a paso." },
    { titulo: "Genera", desc: "El sistema calcula estadísticos, baremos, frecuencias y correlación con fórmulas reales de Excel." },
    { titulo: "Descarga", desc: "Un Excel con tablas numeradas, gráficos e interpretaciones, con el formato que pide tu informe." },
  ];

  const faqs = [
    {
      q: "¿Qué recibo exactamente al generar?",
      a: "Un archivo Excel con 9 hojas: base de datos, estadísticos por ítem, baremos con valoración automática, frecuencias, gráficos e interpretaciones narrativas bajo cada figura. También un CSV con la base de datos.",
    },
    {
      q: "¿Funciona con mi instrumento?",
      a: "Sí. Configuras tus variables, dimensiones, indicadores e ítems, con la escala que use tu cuestionario (Likert de 3, 5, 7 o más opciones) y la cantidad de niveles de baremo que necesites.",
    },
    {
      q: "¿Puedo validar la confiabilidad de mi instrumento?",
      a: "Sí. El apartado Confiabilidad genera la prueba de Alfa de Cronbach por variable: una hoja de Excel con la matriz de respuestas, la varianza de cada ítem, el α calculado con fórmulas vivas y su interpretación automática según la escala de George y Mallery.",
    },
    {
      q: "¿Qué es Forms y cómo funciona?",
      a: "Forms rellena tu encuesta de Google Forms automáticamente, con perfiles y distribuciones configurables, desde una extensión de Chrome conectada a tu cuenta. Como todas las herramientas, funciona por usos: cada corrida de llenado consume 1 uso de Forms.",
    },
    {
      q: "¿Cuánto tarda en generarse?",
      a: "La configuración guiada toma unos minutos y la generación del Excel entre uno y dos minutos. El archivo queda listo para descargar al instante.",
    },
    {
      q: "¿Las fórmulas del Excel son reales?",
      a: "Sí. El archivo usa fórmulas reales de Excel, no valores pegados: si editas una respuesta en la base de datos, los estadísticos, baremos, gráficos y porcentajes se recalculan solos.",
    },
    {
      q: "¿El formato sirve para mi informe de tesis?",
      a: "El archivo sale con formato de tesis: tablas y figuras numeradas, con su fuente y elaboración en cada bloque, listas para copiar a tu informe o presentar a tu asesor.",
    },
    {
      q: "¿Cómo pago y qué pasa si tengo dudas?",
      a: "Los planes funcionan por usos: cada plan carga una cuota de usos por herramienta (1 uso = 1 generación o corrida), en soles o dólares y con pago mensual o anual. Para el Plan Institución o cualquier consulta, escríbenos por WhatsApp o al correo del pie de página.",
    },
  ];
  const [faqAbierta, setFaqAbierta] = useState<number | null>(0);

  // Bento de "qué incluye": 8 celdas exactas, dos destacadas con fondo tintado.
  const incluye = [
    { icon: TrendingUp, title: "Correlación de Pearson", desc: "Entre tus variables, con nivel interpretado automáticamente.", span: true, tone: "mint" as const, figure: "0.977" },
    { icon: Sigma, title: "Estadísticos por ítem", desc: "Media, moda y desviación estándar." },
    { icon: BarChart3, title: "Frecuencias y porcentajes", desc: "Por escala y por nivel de baremo." },
    { icon: PieChart, title: "Gráficos listos", desc: "Por ítem y por dimensión, con formato de figura." },
    { icon: Ruler, title: "Baremos automáticos", desc: "Intervalos y valoraciones calculados por ti." },
    { icon: Feather, title: "Interpretaciones narrativas", desc: "Un párrafo bajo cada figura, listo para tu capítulo de resultados.", span: true, tone: "amber" as const },
    { icon: SlidersHorizontal, title: "Instrumento configurable", desc: "Variables, dimensiones e indicadores a tu medida.", span: true },
    { icon: Download, title: "Excel y CSV", desc: "Fórmulas vivas que se recalculan si editas la base.", span: true },
  ];

  const heroStagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
  };
  const heroItem = {
    hidden: reduce ? {} : { opacity: 0, y: 26 },
    show: { opacity: 1, y: 0, transition: springSoft },
  };

  return (
    // overflow-x-clip evita el scroll horizontal en móvil sin romper el
    // sticky del header (clip no crea un scroll container, hidden sí).
    <div className="overflow-x-clip bg-background">
      {/* ── Header píldora sticky (única navegación y único "Iniciar sesión") ── */}
      <div className="sticky top-3 z-40 px-4">
        <header className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between rounded-full border border-border/70 bg-card/80 pl-2 pr-2 shadow-soft backdrop-blur-xl">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 transition-colors hover:bg-accent"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <FileSpreadsheet className="h-4 w-4" />
            </span>
            <span className="font-display text-base font-semibold tracking-tight">TesisHub</span>
          </button>
          <nav className="hidden items-center md:flex" aria-label="Secciones de la página">
            {[
              ["herramientas", "Herramientas"],
              ["como-funciona", "Cómo funciona"],
              ["planes", "Planes"],
              ["faq", "FAQ"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => goToSection(id)}
                className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-95"
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleTheme}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={themeMode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            >
              {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Button size="sm" onClick={() => onOpenApp("login")} className="rounded-full">
              Iniciar sesión
            </Button>
          </div>
        </header>
      </div>

      {/* ── Hero split: mensaje + producto real ── */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 md:pt-20 lg:grid-cols-[7fr_5fr] lg:gap-14">
        <motion.div variants={heroStagger} initial="hidden" animate="show">
          <motion.div
            variants={heroItem}
            className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-foreground"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Para tesis cuantitativas
          </motion.div>
          <motion.h1
            variants={heroItem}
            className="mt-5 text-balance font-display text-4xl font-bold leading-[1.05] tracking-tighter md:text-6xl"
          >
            El capítulo que más asusta de tu tesis, <span className="text-primary">listo en minutos.</span>
          </motion.h1>
          <motion.p variants={heroItem} className="mt-5 max-w-[46ch] text-base text-muted-foreground md:text-lg">
            Pega tu encuesta y descarga tablas, figuras e interpretaciones listas para tu asesor, sin
            fórmulas y sin pagar un estadístico.
          </motion.p>
          <motion.div variants={heroItem} className="mt-8 flex flex-wrap items-center gap-3">
            <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }}>
              <Button size="lg" className="h-12 px-6 text-base" onClick={() => onOpenApp("registro")}>
                Avanzar mi tesis
                <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
            <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }}>
              <Button size="lg" variant="outline" className="h-12 px-6 text-base" onClick={() => goToSection("planes")}>
                Ver planes
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Screenshot real del producto en marco de navegador */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSoft, delay: 0.2 }}
          className="relative"
        >
          <div aria-hidden className="absolute -inset-3 -z-10 rounded-[32px] bg-accent/60 dark:bg-accent/30 md:-inset-6" />
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-hero md:rotate-1">
            <div className="flex items-center gap-1.5 border-b border-border bg-muted/60 px-4 py-2.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
            </div>
            <img
              src="/app-dashboard.jpg"
              alt="Panel de TesisHub con las herramientas de estadística y redacción"
              className="aspect-[4/3] w-full object-cover object-left-top"
              loading="eager"
            />
          </div>
        </motion.div>
      </section>

      {/* ── Marquee de herramientas ── */}
      <div className="mx-auto max-w-6xl px-4 pb-4">
        <ToolsMarquee />
      </div>

      <div className="mx-auto max-w-6xl px-4">
        <section id="herramientas" className="scroll-mt-24 border-t border-border py-16">
          <Reveal>
            <h2 className="max-w-[22ch] font-display text-2xl font-bold tracking-tighter md:text-3xl">
              De la encuesta al capítulo de resultados
            </h2>
            <p className="mt-2 max-w-[54ch] text-sm text-muted-foreground">
              Tres herramientas conectadas: recolecta las respuestas, valida tu instrumento y tabula con formato de tesis.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-9">
            <ToolsShowcase onOpenApp={onOpenApp} onVerIncluye={() => goToSection("incluye")} />
          </Reveal>
        </section>

        {/* ── Cómo funciona: timeline vertical ── */}
        <section id="como-funciona" className="scroll-mt-24 border-t border-border py-16">
          <Reveal>
            <h2 className="font-display text-2xl font-bold tracking-tighter md:text-3xl">
              De la encuesta al Excel en tres pasos
            </h2>
          </Reveal>
          <ol className="mt-10 max-w-2xl space-y-0">
            {pasos.map((paso, i) => (
              <Reveal key={paso.titulo} delay={i * 0.1}>
                <li className="relative flex gap-6 pb-10 last:pb-0">
                  {i < pasos.length - 1 && (
                    <span aria-hidden className="absolute left-[17px] top-10 h-[calc(100%-2.5rem)] w-px bg-border" />
                  )}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div className="pt-1">
                    <h3 className="font-display text-lg font-semibold tracking-tight">{paso.titulo}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{paso.desc}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ── Qué incluye: bento de 8 celdas ── */}
        <section id="incluye" className="scroll-mt-24 border-t border-border py-16">
          <Reveal>
            <h2 className="font-display text-2xl font-bold tracking-tighter md:text-3xl">Todo lo que tu asesor espera ver</h2>
            <p className="mt-2 max-w-[46ch] text-sm text-muted-foreground">
              El archivo sale con formato de tesis: tablas y figuras numeradas, fuente y elaboración en cada bloque.
            </p>
          </Reveal>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {incluye.map((item, i) => (
              <Reveal
                key={item.title}
                delay={i * 0.05}
                className={cn(item.span && "sm:col-span-2")}
              >
                <div
                  className={cn(
                    "flex h-full flex-col rounded-2xl border p-5",
                    item.tone === "mint"
                      ? "border-primary/20 bg-accent"
                      : item.tone === "amber"
                        ? "border-amber-500/25 bg-amber-500/10"
                        : "border-border/70 bg-card shadow-sm",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <item.icon className={cn("h-5 w-5", item.tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-primary")} />
                    {item.figure && (
                      <span className="font-mono text-2xl font-bold tracking-tight text-accent-foreground">
                        {item.figure}
                        <span className="ml-2 align-middle font-sans text-[10px] font-medium text-muted-foreground">ejemplo</span>
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 font-display text-base font-semibold tracking-tight">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Planes ── */}
        <section id="planes" className="scroll-mt-24 border-t border-border py-16">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tighter md:text-3xl">Planes y precios</h2>
                <p className="mt-2 text-sm text-muted-foreground">Por usos: cada plan carga tu cuota de cada herramienta. En soles o dólares, mensual o anual.</p>
              </div>
              <div className="inline-flex rounded-full border border-border bg-card p-1">
                {(["monthly", "yearly"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                      billingMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setBillingMode(mode)}
                  >
                    {mode === "monthly" ? "Mensual" : "Anual"}
                  </button>
                ))}
              </div>
            </div>
          </Reveal>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {plans.map((plan, i) => (
              <Reveal key={plan.id} delay={i * 0.12}>
                <motion.div
                  whileHover={reduce ? undefined : { y: -4 }}
                  transition={springSoft}
                  className={cn(
                    "h-full rounded-2xl p-6 md:p-8",
                    plan.featured ? "border-2 border-primary bg-accent/60 shadow-soft" : "border border-border/70 bg-card shadow-sm",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <plan.icon className="h-4 w-4" />
                      {plan.audience}
                    </div>
                    {plan.featured && (
                      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400">Recomendado</Badge>
                    )}
                  </div>
                  <h3 className="mt-3 font-display text-xl font-bold tracking-tight">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                  <div className="mt-6 flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-3xl font-bold tabular-nums tracking-tight md:text-4xl">
                      {billingMode === "monthly" ? plan.priceMonthlyPen : plan.priceYearlyPen}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / {billingMode === "monthly" ? "mes" : "año"} ({billingMode === "monthly" ? plan.priceMonthlyUsd : plan.priceYearlyUsd})
                    </span>
                  </div>
                  <ul className="mt-6 space-y-2.5 text-sm">
                    {plan.highlights.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-7 w-full"
                    size="lg"
                    variant={plan.featured ? "default" : "outline"}
                    onClick={plan.id === "institucion" ? openWhatsApp : () => onOpenApp("registro")}
                  >
                    {plan.id === "institucion" && <MessageCircle className="h-4 w-4" />}
                    {plan.cta}
                  </Button>
                  {plan.id === "institucion" && (
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      o escríbenos a{" "}
                      <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">
                        {CONTACT_EMAIL}
                      </a>
                    </p>
                  )}
                </motion.div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── FAQ: lista limpia ── */}
        <section id="faq" className="scroll-mt-24 border-t border-border py-16">
          <Reveal>
            <h2 className="text-center font-display text-2xl font-bold tracking-tighter md:text-3xl">Preguntas frecuentes</h2>
          </Reveal>
          <div className="mx-auto mt-8 max-w-3xl divide-y divide-border">
            {faqs.map((faq, i) => {
              const abierta = faqAbierta === i;
              return (
                <div key={faq.q}>
                  <button
                    className="flex w-full items-center justify-between gap-4 py-5 text-left"
                    aria-expanded={abierta}
                    onClick={() => setFaqAbierta(abierta ? null : i)}
                  >
                    <span className={cn("text-sm font-semibold md:text-base", abierta && "text-primary")}>{faq.q}</span>
                    <motion.span
                      animate={{ rotate: abierta ? 180 : 0 }}
                      transition={springSoft}
                      className={cn("shrink-0", abierta ? "text-primary" : "text-muted-foreground")}
                      aria-hidden
                    >
                      <ChevronDown className="h-5 w-5" />
                    </motion.span>
                  </button>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-300 ease-out",
                      abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <p className="pb-5 pr-9 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── CTA final: banda esmeralda ── */}
        <section className="py-16">
          <Reveal>
            <div className="rounded-[32px] bg-primary-deep px-6 py-14 text-center md:px-16 md:py-20">
              <h2 className="mx-auto max-w-[18ch] text-balance font-display text-3xl font-bold leading-[1.08] tracking-tighter text-white md:text-5xl">
                ¿Listo para avanzar tu tesis?
              </h2>
              <p className="mx-auto mt-4 max-w-[46ch] text-sm text-white/75 md:text-base">
                Empieza hoy y entrega a tu asesor resultados con formato de tesis: tablas, figuras e interpretaciones.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }}>
                  <Button
                    size="lg"
                    className="h-12 bg-white px-8 text-base text-primary-deep shadow-none hover:bg-white/90"
                    onClick={() => onOpenApp("registro")}
                  >
                    Avanzar mi tesis
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </motion.div>
                <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }}>
                  <Button
                    size="lg"
                    variant="ghost"
                    className="h-12 border border-white/30 px-8 text-base text-white hover:bg-white/10 hover:text-white"
                    onClick={openWhatsApp}
                  >
                    <MessageCircle className="h-4 w-4" />
                    Hablar por WhatsApp
                  </Button>
                </motion.div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Footer ── */}
        <footer className="border-t border-border pb-10 pt-14">
          <div className="grid gap-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                </span>
                TesisHub
              </div>
              <p className="mt-3 max-w-[32ch] text-sm text-muted-foreground">
                Tabulación, confiabilidad y encuestas: la estadística de tu tesis, lista en minutos.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Producto</p>
              <ul className="mt-4 space-y-3 text-sm">
                <li><a href="#herramientas" className="text-muted-foreground hover:text-foreground">Herramientas</a></li>
                <li><a href="#como-funciona" className="text-muted-foreground hover:text-foreground">Cómo funciona</a></li>
                <li><a href="#incluye" className="text-muted-foreground hover:text-foreground">Qué incluye</a></li>
                <li><a href="#planes" className="text-muted-foreground hover:text-foreground">Planes y precios</a></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Soporte</p>
              <ul className="mt-4 space-y-3 text-sm">
                <li><a href="#faq" className="text-muted-foreground hover:text-foreground">Preguntas frecuentes</a></li>
                <li>
                  <button onClick={openWhatsApp} className="text-muted-foreground hover:text-foreground">
                    WhatsApp +51 975 212 132
                  </button>
                </li>
                <li>
                  <a href={`mailto:${CONTACT_EMAIL}`} className="text-muted-foreground hover:text-foreground">
                    {CONTACT_EMAIL}
                  </a>
                </li>
                <li>
                  <a href="/privacidad.html" className="text-muted-foreground hover:text-foreground">
                    Política de privacidad
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cuenta</p>
              <ul className="mt-4 space-y-3 text-sm">
                <li>
                  <button onClick={() => onOpenApp("login")} className="text-muted-foreground hover:text-foreground">
                    Iniciar sesión
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 border-t border-border pt-6 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} TesisHub. Todos los derechos reservados.
          </div>
        </footer>
      </div>
    </div>
  );
}
