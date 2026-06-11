import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Building2, Check, Download, FileSpreadsheet, GraduationCap, Loader2, Mail, MessageCircle, Moon, Sun, UserRound } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { ThemeMode } from "../lib/types";
import { AnimatedNumber, Reveal, TiltCard, springSoft } from "./motion-primitives";

export function LandingPage({
  themeMode,
  onToggleTheme,
  onOpenApp,
}: {
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onOpenApp: () => void;
}) {
  const [billingMode, setBillingMode] = useState<"monthly" | "yearly">("monthly");
  const reduce = useReducedMotion();

  const CONTACT_EMAIL = "contacto@tutorica.com";
  const CONTACT_WHATSAPP = "51975212132"; // +51 975 212 132
  const openWhatsApp = () => {
    const text = encodeURIComponent("Hola, me interesa el Plan Institucional de TesisTab.");
    window.open(`https://wa.me/${CONTACT_WHATSAPP}?text=${text}`, "_blank", "noopener");
  };

  const plans = useMemo(
    () => [
      {
        id: "pro",
        name: "Plan Profesional",
        audience: "Tesistas y asesores",
        icon: UserRound,
        priceMonthlyUsd: "USD 29",
        priceYearlyUsd: "USD 290",
        priceMonthlyPen: "S/ 109",
        priceYearlyPen: "S/ 1,090",
        description: "Ideal para quien trabaja su tesis de forma individual con asesor propio.",
        highlights: ["1 acceso activo", "Generación de Excel y CSV", "Baremos y dimensiones configurables", "Soporte por correo"],
        cta: "Generar mi tabulación",
        featured: true,
      },
      {
        id: "business",
        name: "Plan Institucional",
        audience: "Universidades y consultoras",
        icon: Building2,
        priceMonthlyUsd: "USD 129",
        priceYearlyUsd: "USD 1,290",
        priceMonthlyPen: "S/ 485",
        priceYearlyPen: "S/ 4,850",
        description: "Para equipos que gestionan múltiples tesis con control administrativo.",
        highlights: ["Hasta 20 accesos", "Panel de administrador", "Proyectos ilimitados", "Soporte prioritario"],
        cta: "Contáctanos",
        featured: false,
      },
    ],
    [],
  );

  // Demo en bucle del flujo real del producto: calcula la tabla baremada,
  // genera el Excel y lo entrega. La primera tabla usa datos reales de una
  // generación (muestra de 289); las otras son variaciones de ejemplo.
  const PREVIEW_TABLES = [
    { dim: "Planificación", filas: [{ nivel: "Bajo", f: 133, pct: 46.0 }, { nivel: "Medio", f: 101, pct: 34.9 }, { nivel: "Alto", f: 55, pct: 19.0 }] },
    { dim: "Transparencia", filas: [{ nivel: "Bajo", f: 121, pct: 41.9 }, { nivel: "Medio", f: 109, pct: 37.7 }, { nivel: "Alto", f: 59, pct: 20.4 }] },
    { dim: "Cumplimiento", filas: [{ nivel: "Bajo", f: 96, pct: 33.2 }, { nivel: "Medio", f: 138, pct: 47.8 }, { nivel: "Alto", f: 55, pct: 19.0 }] },
  ];
  const [fase, setFase] = useState(0); // 0 tabla · 1 generando · 2 entregado
  const [dataIdx, setDataIdx] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const duraciones = [4200, 2600, 3600];
    const timer = window.setTimeout(() => {
      setFase((f) => {
        const next = (f + 1) % 3;
        if (next === 0) setDataIdx((d) => (d + 1) % PREVIEW_TABLES.length);
        return next;
      });
    }, duraciones[fase]);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, reduce]);

  const tabla = PREVIEW_TABLES[dataIdx];

  const pasos = [
    { titulo: "Configura", desc: "Variables, dimensiones, indicadores y la escala de tu instrumento, guiado paso a paso." },
    { titulo: "Genera", desc: "El sistema calcula estadísticos, baremos, frecuencias y correlación con fórmulas reales de Excel." },
    { titulo: "Descarga", desc: "Un Excel con tablas numeradas, gráficos e interpretaciones, con el formato que pide tu informe." },
  ];

  const incluye = [
    "Variables, dimensiones e indicadores configurables",
    "Baremos e intervalos calculados automáticamente",
    "Estadísticos por ítem: media, moda y desviación",
    "Frecuencias y porcentajes por escala",
    "Gráficos por ítem y por dimensión",
    "Interpretaciones narrativas bajo cada figura",
    "Correlación de Pearson entre variables",
    "Descarga en Excel y CSV",
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
    <div className="mx-auto max-w-6xl px-4">
      <header className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileSpreadsheet className="h-4 w-4" />
          </span>
          TesisTab
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onToggleTheme} aria-label={themeMode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}>
            {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenApp}>
            Iniciar sesión
          </Button>
        </div>
      </header>

      <section className="relative grid items-center gap-12 py-14 md:grid-cols-[7fr_5fr] md:py-20">
        <div aria-hidden className="hero-dots pointer-events-none absolute -inset-x-8 -top-8 bottom-0 -z-10" />
        <div aria-hidden className="pointer-events-none absolute right-0 top-1/2 -z-10 h-[420px] w-[560px] -translate-y-1/2 rounded-full bg-primary/15 blur-3xl" />

        <motion.div variants={heroStagger} initial="hidden" animate="show">
          <motion.div
            variants={heroItem}
            className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Para tesis cuantitativas
          </motion.div>
          <motion.h1 variants={heroItem} className="mt-5 text-4xl font-bold leading-[1.06] tracking-tight md:text-[3.4rem] md:leading-[1.05]">
            La tabulación de tu tesis, <span className="text-primary">lista en minutos.</span>
          </motion.h1>
          <motion.p variants={heroItem} className="mt-5 max-w-[46ch] text-base text-muted-foreground md:text-lg">
            Configura tu encuesta y descarga el Excel con baremos, frecuencias, gráficos e interpretaciones.
          </motion.p>
          <motion.div variants={heroItem} className="mt-8 flex flex-wrap items-center gap-3">
            <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }}>
              <Button size="lg" className="h-12 px-6 text-base" onClick={onOpenApp}>
                Generar mi tabulación
                <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
            <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }}>
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-6 text-base"
                onClick={() => document.getElementById("planes")?.scrollIntoView({ behavior: "smooth" })}
              >
                Ver planes
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...springSoft, delay: 0.25 }}
        >
          <TiltCard>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_32px_80px_-32px_hsl(var(--primary)/0.55)] ring-1 ring-primary/10">
              <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
                  Tabulacion_generada.xlsx
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={fase}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                      fase === 2 ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
                    )}
                  >
                    {fase === 1 && <Loader2 className="h-3 w-3 animate-spin" />}
                    {fase === 2 && <Check className="h-3 w-3" />}
                    {fase === 0 ? "Calculando" : fase === 1 ? "Generando" : "Listo"}
                  </motion.span>
                </AnimatePresence>
              </div>
              <div className="min-h-[280px]">
                <AnimatePresence mode="wait" initial={false}>
                  {fase === 0 && (
                    <motion.div
                      key={`tabla-${dataIdx}`}
                      initial={reduce ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.35 }}
                    >
                      <p className="text-sm font-semibold">Tabla {dataIdx + 1}</p>
                      <p className="text-sm text-muted-foreground">Frecuencia baremada · {tabla.dim}</p>
                      <div className="mt-5 space-y-4">
                        {tabla.filas.map((fila, i) => (
                          <div key={fila.nivel}>
                            <div className="flex items-baseline justify-between text-sm">
                              <span className="font-medium">{fila.nivel}</span>
                              <span className="font-mono text-sm">
                                <span className="font-semibold">
                                  <AnimatedNumber value={fila.f} />
                                </span>{" "}
                                <span className="text-muted-foreground">
                                  · <AnimatedNumber value={fila.pct} decimals={1} suffix="%" />
                                </span>
                              </span>
                            </div>
                            <div className="mt-2 h-2.5 w-full">
                              <motion.div
                                className="h-full w-full origin-left rounded-full bg-gradient-to-r from-primary to-primary/65"
                                initial={reduce ? false : { scaleX: 0 }}
                                animate={{ scaleX: fila.pct / 100 }}
                                transition={{ type: "spring", stiffness: 70, damping: 16, delay: 0.15 + i * 0.1 }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 flex items-baseline justify-between border-t border-border pt-3 text-sm">
                        <span className="font-semibold">Total</span>
                        <span className="font-mono tabular-nums">289 encuestados</span>
                      </div>
                    </motion.div>
                  )}

                  {fase === 1 && (
                    <motion.div
                      key="generando"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.35 }}
                    >
                      <p className="text-sm font-semibold">Generando tu Excel</p>
                      <p className="text-sm text-muted-foreground">Con fórmulas reales, listas para tu informe</p>
                      <div className="mt-6 space-y-4">
                        {["Estadísticos por ítem", "Baremos y valoraciones", "Frecuencias y porcentajes", "Gráficos e interpretaciones"].map((etapa, i) => (
                          <motion.div
                            key={etapa}
                            className="flex items-center gap-2.5 text-sm"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ ...springSoft, delay: 0.2 + i * 0.4 }}
                          >
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ ...springSoft, delay: 0.3 + i * 0.4 }}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                            >
                              <Check className="h-3 w-3" />
                            </motion.span>
                            {etapa}
                          </motion.div>
                        ))}
                        <div className="flex items-center gap-2.5 pt-1 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          Armando el archivo...
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {fase === 2 && (
                    <motion.div
                      key="entregado"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.35 }}
                      className="flex min-h-[280px] flex-col items-center justify-center text-center"
                    >
                      <motion.div
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={springSoft}
                        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_18px_44px_-16px_hsl(var(--primary)/0.8)]"
                      >
                        <FileSpreadsheet className="h-8 w-8" />
                      </motion.div>
                      <p className="mt-4 text-base font-semibold">Tu Excel está listo</p>
                      <p className="mt-1 text-sm text-muted-foreground">11 hojas, 37 gráficos e interpretaciones</p>
                      <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }} className="mt-5">
                        <Button size="sm" onClick={onOpenApp}>
                          <Download className="h-4 w-4" />
                          Descargar Excel
                        </Button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="mt-4 flex gap-1 border-t border-border pt-3">
                {["Variable 1", "Dimensiones", "Ítems", "Conteo"].map((tab, i) => (
                  <span
                    key={tab}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] transition-colors",
                      i === (fase === 0 ? 1 : fase === 1 ? 2 : 3)
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {tab}
                  </span>
                ))}
              </div>
            </div>
          </TiltCard>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Demo del flujo real: calcula, genera y entrega tu Excel.
          </p>
        </motion.div>
      </section>

      <section className="border-t border-border py-14">
        <Reveal>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">De la encuesta al Excel en tres pasos</h2>
        </Reveal>
        <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-border">
          {pasos.map((paso, i) => (
            <Reveal key={paso.titulo} delay={i * 0.1} className="md:px-8 md:first:pl-0 md:last:pr-0">
              <h3 className="text-lg font-semibold text-primary">{paso.titulo}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{paso.desc}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-14">
        <div className="grid gap-10 md:grid-cols-[2fr_3fr]">
          <Reveal>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Todo lo que tu asesor espera ver</h2>
            <p className="mt-3 max-w-[40ch] text-sm text-muted-foreground">
              El archivo sale con formato de tesis: tablas y figuras numeradas, fuente y elaboración en cada bloque.
            </p>
          </Reveal>
          <ul className="grid content-start gap-x-8 gap-y-3.5 text-sm sm:grid-cols-2">
            {incluye.map((item, i) => (
              <motion.li
                key={item}
                className="flex items-start gap-2.5"
                initial={reduce ? false : { opacity: 0, x: -14 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ ...springSoft, delay: i * 0.05 }}
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {item}
              </motion.li>
            ))}
          </ul>
        </div>
      </section>

      <section id="planes" className="border-t border-border py-14">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Planes y precios</h2>
              <p className="mt-2 text-sm text-muted-foreground">Paga en soles o dólares, mensual o anual.</p>
            </div>
            <div className="inline-flex rounded-xl border border-border bg-card p-1">
              {(["monthly", "yearly"] as const).map((mode) => (
                <button
                  key={mode}
                  className={cn(
                    "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
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

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {plans.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 0.12}>
              <motion.div
                whileHover={reduce ? undefined : { y: -4 }}
                transition={springSoft}
                className={cn(
                  "h-full rounded-2xl p-6 md:p-8",
                  plan.featured ? "border-2 border-primary bg-accent/50" : "border border-border bg-card",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <plan.icon className="h-4 w-4" />
                    {plan.audience}
                  </div>
                  {plan.featured && <Badge>Recomendado</Badge>}
                </div>
                <h3 className="mt-3 text-xl font-bold tracking-tight">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-tight">
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
                  onClick={plan.id === "business" ? openWhatsApp : onOpenApp}
                >
                  {plan.id === "business" && <MessageCircle className="h-4 w-4" />}
                  {plan.cta}
                </Button>
                {plan.id === "business" && (
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

      <Reveal className="my-14">
        <section className="rounded-2xl bg-primary px-8 py-12 text-primary-foreground md:px-12">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">¿Listo para generar tu tabulación?</h2>
              <p className="mt-2 max-w-[44ch] text-sm opacity-90">
                Entra con tu cuenta, configura tu encuesta y entrega el Excel a tu asesor.
              </p>
            </div>
            <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }}>
              <Button
                size="lg"
                className="h-12 bg-background px-6 text-base text-foreground hover:bg-background/90"
                onClick={onOpenApp}
              >
                Generar mi tabulación
                <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          </div>
        </section>
      </Reveal>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border py-8 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          TesisTab
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <a href={`mailto:${CONTACT_EMAIL}`} className="flex items-center gap-1.5 hover:text-foreground">
            <Mail className="h-4 w-4" />
            {CONTACT_EMAIL}
          </a>
          <button onClick={openWhatsApp} className="flex items-center gap-1.5 hover:text-foreground">
            <MessageCircle className="h-4 w-4" />
            +51 975 212 132
          </button>
        </div>
        <p>© {new Date().getFullYear()} TesisTab</p>
      </footer>
    </div>
  );
}

