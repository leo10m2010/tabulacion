import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Check,
  Download,
  FlaskConical,
  HelpCircle,
  Loader2,
  Palette,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Button } from "../ui/button";
import { MagicButton } from "../ui/magic-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import * as api from "../../lib/api";
import {
  CORRELATION_LEVELS,
  FALLBACK_CONFIG,
  LIST_GROUPS,
  QUASI_DEFAULTS,
  QUASI_EFFECT_LEVELS,
  themePalette,
} from "../../lib/constants";
import {
  base64ToUint8Array,
  calcBaremoIntervalos,
  calcBaremoRange,
  correlationInfo,
  csvToRows,
  defaultLevelName,
  eid,
  normalizeList,
  parseIntSafe,
  revokeDownloadLinks,
  toStringList,
  toStringValue,
  workbookToSheetRows,
} from "../../lib/helpers";
import { instrumentoATabConfig } from "../../lib/instrumento";
import { validarConfig } from "../../lib/wizard-validation";
import { borrarBorrador, guardarBorrador, hayCambios, leerBorrador } from "../../lib/wizard-draft";
import { TraerDelProyecto } from "../TraerDelProyecto";
import { FieldHint, HierarchyEditor, ListEditorField, StepTip } from "../wizard-fields";
import { PreviewTable } from "../PreviewTable";
import { PreviewCharts } from "../PreviewCharts";
import { ThemePicker } from "../ThemePicker";
import { WizardProgress } from "../WizardProgress";
import { SubscriptionWarning } from "../SubscriptionWarning";
import type {
  AuthUser,
  DimensionDef,
  DownloadLinks,
  EstructuraDimension,
  ItemDef,
  GeneratedResult,
  PasoTesis,
  Proyecto,
  TabConfig,
  TemplateInfo,
  WizardStep,
} from "../../lib/types";

// Asistente de tabulación: el generador original del producto.
//
// Vivía dentro de App.tsx, que llegó a 2.044 líneas — y era la ÚNICA
// herramienta sin sección propia, mientras las otras diez sí la tenían. Todo su
// estado (configuración, paso del asistente, estructura de dimensiones,
// resultado y enlaces de descarga) vive aquí, que es donde se usa.
export function TabulacionSection({ apiBaseUrl, authToken, authUser, proyecto, onPasoHecho, onUpgrade }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  proyecto: Proyecto | null;
  // Marca este paso como hecho en el proyecto activo, si hay uno.
  onPasoHecho?: (paso: PasoTesis) => void;
  onUpgrade?: (herramienta: string) => void;
}) {
  // El borrador se lee una sola vez, al montar. Es la misma lectura para el
  // caso de cambiar de sección (React desmonta esta sección entera) y para el
  // de recargar la página.
  const [borradorInicial] = useState(() => leerBorrador(authUser.email));
  const [borradorRecuperado, setBorradorRecuperado] = useState(() => Boolean(borradorInicial));

  const [wizardStep, setWizardStep] = useState<WizardStep>(borradorInicial?.wizardStep ?? 1);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [estructuraV1, setEstructuraV1] = useState<DimensionDef[]>(borradorInicial?.estructuraV1 ?? []);
  const [estructuraV2, setEstructuraV2] = useState<DimensionDef[]>(borradorInicial?.estructuraV2 ?? []);
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [config, setConfig] = useState<TabConfig>(borradorInicial?.config ?? FALLBACK_CONFIG);
  const [jsonDraft, setJsonDraft] = useState<string>(JSON.stringify(borradorInicial?.config ?? FALLBACK_CONFIG, null, 2));
  const [statusMessage, setStatusMessage] = useState<string>("Listo para generar.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [downloadLinks, setDownloadLinks] = useState<DownloadLinks | null>(null);
  const [templateInfo, setTemplateInfo] = useState<TemplateInfo | null>(null);

  // Configuración con la que arrancó esta sesión del asistente. Es la
  // referencia contra la que se decide si hay trabajo que guardar. Si se
  // restauró un borrador, la referencia es ese borrador: reabrir la sección y
  // salir sin tocar nada no debe reescribirlo ni volver a anunciarlo.
  const configInicialRef = useRef<TabConfig>(borradorInicial?.config ?? FALLBACK_CONFIG);

  const isQuasi = toStringValue(config.diseno) === "cuasiexperimental";

  // ── Effects ────────────────────────────────────────────────────────────────
  // Configuración de ejemplo con la que arranca el asistente. No se pide si hay
  // un borrador: llegaría después de la restauración y pisaría lo que el
  // usuario había escrito.
  useEffect(() => {
    if (borradorInicial) return;
    let isMounted = true;
    fetch("/default-config.json")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as TabConfig;
        if (!isMounted || !data || Array.isArray(data)) return;
        // El ejemplo pasa a ser el punto de partida: lo que el usuario NO ha
        // tocado no cuenta como trabajo suyo.
        configInicialRef.current = data;
        setConfig(data);
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [borradorInicial]);
  useEffect(() => { setJsonDraft(JSON.stringify(config, null, 2)); }, [config]);

  // Guarda el borrador mientras el usuario trabaja. Con retardo: escribir en
  // localStorage serializa toda la configuración, y hacerlo en cada tecla de un
  // instrumento de 60 ítems se nota al teclear.
  useEffect(() => {
    if (!hayCambios(config, estructuraV1, estructuraV2, configInicialRef.current)) return;
    const timer = window.setTimeout(() => {
      guardarBorrador(authUser.email, { wizardStep, config, estructuraV1, estructuraV2 });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [authUser.email, wizardStep, config, estructuraV1, estructuraV2]);

  // Cerrar la pestaña con trabajo sin generar. El borrador ya lo protege, pero
  // el aviso del navegador evita que alguien se vaya creyendo que perdió todo.
  // Solo mientras hay algo escrito y todavía no se generó el archivo.
  useEffect(() => {
    if (result || !hayCambios(config, estructuraV1, estructuraV2, configInicialRef.current)) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [result, config, estructuraV1, estructuraV2]);
  // Cronómetro de la generación para informar el progreso por etapas.
  useEffect(() => {
    if (!isGenerating) return;
    setGenerationElapsed(0);
    const timer = window.setInterval(() => setGenerationElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);
  useEffect(() => () => revokeDownloadLinks(downloadLinks), [downloadLinks]);
  useEffect(() => {
    if (estructuraV1.length === 0 && estructuraV2.length === 0) return;
    const v1Inds = estructuraV1.flatMap((d) => d.indicadores.map((i) => i.nombre));
    const v2Inds = estructuraV2.flatMap((d) => d.indicadores.map((i) => i.nombre));
    const hasV2 = estructuraV2.length > 0;
    const toEstructura = (dims: DimensionDef[]): EstructuraDimension[] => dims.map((d) => ({
      nombre: d.nombre,
      indicadores: d.indicadores.map((i) => ({ nombre: i.nombre, items: i.items.length })),
    }));
    setConfig((prev) => ({
      ...prev,
      nombre_indicador: [...v1Inds, ...v2Inds],
      numero_indicador0: hasV2
        ? [String(v1Inds.length), String(v2Inds.length)]
        : [String(v1Inds.length)],
      estructura_v1: toEstructura(estructuraV1),
      estructura_v2: toEstructura(estructuraV2),
      nombre_dims_v1: estructuraV1.map((d) => d.nombre),
      items_por_dim_v1: estructuraV1.map((d) => String(d.indicadores.flatMap((i) => i.items).length)),
      nombre_items_v1: estructuraV1.flatMap((d) => d.indicadores.flatMap((i) => i.items.map((it) => it.nombre))),
      nombre_dims_v2: estructuraV2.map((d) => d.nombre),
      items_por_dim_v2: estructuraV2.map((d) => String(d.indicadores.flatMap((i) => i.items).length)),
      nombre_items_v2: estructuraV2.flatMap((d) => d.indicadores.flatMap((i) => i.items.map((it) => it.nombre))),
    }));
  }, [estructuraV1, estructuraV2]);
  // En el diseño cuasiexperimental la muestra total es la suma de ambos
  // grupos; se sincroniza para que baremos y validaciones sigan funcionando.
  useEffect(() => {
    if (toStringValue(config.diseno) !== "cuasiexperimental") return;
    const total = (parseIntSafe(config.nExperimental) ?? 0) + (parseIntSafe(config.nControl) ?? 0);
    if (total > 0 && parseIntSafe(config.muestra) !== total) {
      setConfig((prev) => ({ ...prev, muestra: String(total) }));
    }
  }, [config.diseno, config.nExperimental, config.nControl, config.muestra]);
  useEffect(() => {
    const muestra = parseIntSafe(config.muestra);
    if (!muestra || muestra <= 0) return;
    setConfig((prev) => {
      const recalc = (pctKey: string, cantKey: string) => {
        const pcts = toStringList(prev[pctKey]);
        if (!pcts.length) return {};
        return {
          [cantKey]: pcts.map((v) => {
            const p = parseFloat(v.trim());
            return Number.isFinite(p) ? String(Math.round((p / 100) * muestra)) : "";
          }),
        };
      };
      return { ...prev, ...recalc("porcentaje", "cantidad"), ...recalc("porcentaje_v2", "cantidad_v2") };
    });
  }, [config.muestra]);
  // Limites del generador (muestra maxima e items por variable),
  // para validar antes de llamar a /generate.
  useEffect(() => {
    if (!authToken || !authUser) { setTemplateInfo(null); return; }
    let isMounted = true;
    api.fetchTemplateInfo(apiBaseUrl, authToken)
      .then((payload) => {
        if (!isMounted) return;
        if (typeof payload.maxMuestra === "number" && typeof payload.maxItemsV1 === "number") {
          setTemplateInfo({
            maxMuestra: payload.maxMuestra,
            maxItemsV1: payload.maxItemsV1,
            maxItemsV2: payload.maxItemsV2 ?? 0,
          });
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [apiBaseUrl, authToken, authUser]);

  // La validación vive en lib/wizard-validation.ts: es lógica pura y ahí se
  // puede probar sin renderizar la aplicación entera.
  const validationMessages = useMemo(
    () => validarConfig(config, templateInfo),
    [config, templateInfo],
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
  // Descarta el trabajo recuperado y vuelve al ejemplo inicial. Es una acción
  // destructiva explícita: el borrador se borra aquí, nunca de forma automática.
  const empezarDeCero = () => {
    borrarBorrador(authUser.email);
    setBorradorRecuperado(false);
    setEstructuraV1([]);
    setEstructuraV2([]);
    setStep2Error(null);
    setWizardStep(1);
    setResult(null);
    setErrorMessage(null);
    fetch("/default-config.json")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as TabConfig;
        if (!data || Array.isArray(data)) throw new Error();
        setConfig(data);
      })
      .catch(() => setConfig(FALLBACK_CONFIG));
  };

  // Trae el instrumento del proyecto activo al asistente. No pisa la muestra,
  // el tema ni el control de correlación: eso es de esta generación, no del
  // instrumento. Lo traído queda editable como cualquier otro campo.
  const traerInstrumento = () => {
    if (!proyecto) return;
    const { config: siguiente, estructuraV1: e1, estructuraV2: e2 } =
      instrumentoATabConfig(proyecto.instrumento, config);
    setConfig(siguiente);
    setEstructuraV1(e1);
    setEstructuraV2(e2);
    setStep2Error(null);
  };

  const setScalar = (key: string, value: string) => setConfig((prev) => {
    const updates: TabConfig = { ...prev, [key]: value };
    const resizeBaremo = (n: number, nombreKey: string, otherKeys: string[]) => {
      if (!Number.isFinite(n) || n <= 0) return;
      // nombre_escala: rellenar con nombres por defecto si quedan vacíos
      const nombres = toStringList(prev[nombreKey]);
      if (nombres.length < n) {
        updates[nombreKey] = [...nombres, ...Array.from({ length: n - nombres.length }, (_, i) => defaultLevelName(nombres.length + i, n))];
      } else if (nombres.length > n) {
        updates[nombreKey] = nombres.slice(0, n);
      }
      // otros campos: rellenar con vacíos
      otherKeys.forEach((k) => {
        const arr = toStringList(prev[k]);
        if (arr.length < n) updates[k] = [...arr, ...Array(n - arr.length).fill("")];
        else if (arr.length > n) updates[k] = arr.slice(0, n);
      });
    };
    if (key === "escala") resizeBaremo(parseInt(value.trim(), 10), "nombre_escala", ["desde", "hasta", "porcentaje", "cantidad"]);
    if (key === "escala_v2") resizeBaremo(parseInt(value.trim(), 10), "nombre_escala_v2", ["desde_v2", "hasta_v2", "porcentaje_v2", "cantidad_v2"]);
    return updates;
  });
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
    // Si se edita un campo de baremo directamente, rellenar hasta la longitud de nombre_escala
    // (normalizeList elimina vacíos del final, lo que haría perder filas al usuario)
    const padToLength = (k: string, referenceKey: string) => {
      if (key !== k) return;
      const target = toStringList(prev[referenceKey]).length;
      const arr = toStringList(updates[k]);
      if (arr.length < target) updates[k] = [...arr, ...Array(target - arr.length).fill("")];
    };
    ["desde", "hasta", "porcentaje", "cantidad"].forEach((k) => padToLength(k, "nombre_escala"));
    ["desde_v2", "hasta_v2", "porcentaje_v2", "cantidad_v2"].forEach((k) => padToLength(k, "nombre_escala_v2"));
    // Cuando cambia el porcentaje, calcular cantidad automáticamente
    const calcCantidad = (pctKey: string, cantKey: string) => {
      if (key !== pctKey) return;
      const muestra = parseIntSafe(prev.muestra);
      if (!muestra || muestra <= 0) return;
      updates[cantKey] = toStringList(updates[pctKey]).map((v) => {
        const pct = parseFloat(v.trim());
        return Number.isFinite(pct) ? String(Math.round(pct / 100 * muestra)) : "";
      });
    };
    calcCantidad("porcentaje", "cantidad");
    calcCantidad("porcentaje_v2", "cantidad_v2");
    // Auto-generar numero_dimension cuando cambian las dimensiones
    if (key === "nombre_dimension") {
      updates.numero_dimension = normalized.map((_, i) => String(i + 1));
    }
    return updates;
  });
  const getScalar = (key: string) => toStringValue(config[key]);
  const getList = (key: string) => toStringList(config[key]);
  const autoCalcBaremo = (varKey: "v1" | "v2") => {
    const isV2 = varKey === "v2";
    const preguntas = parseIntSafe(isV2 ? config.itemv2 : config.item);
    const respuesta = parseIntSafe(config.respuesta);
    const niveles = parseIntSafe(isV2 ? config.escala_v2 : config.escala);
    if (!preguntas || !respuesta || !niveles || preguntas <= 0 || respuesta <= 0 || niveles <= 0) return;
    const { desde, hasta } = calcBaremoIntervalos(preguntas, respuesta, niveles);
    setConfig((prev) => ({
      ...prev,
      [isV2 ? "desde_v2" : "desde"]: desde,
      [isV2 ? "hasta_v2" : "hasta"]: hasta,
    }));
  };

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
  const handleGenerate = async () => {
    setErrorMessage(null);
    if (!authToken || !authUser) { setErrorMessage("Debes iniciar sesión para generar tabulación."); return; }
    if (validationMessages.length > 0) { setErrorMessage("Corrige las validaciones antes de generar."); return; }
    setIsGenerating(true);
    setStatusMessage("Enviando configuración a la API...");
    try {
      const hasV2gen = (parseIntSafe(config.variable) ?? 2) >= 2;
      const dimCount = hasV2gen ? 2 : 1;
      const resolvedConfig = {
        ...config,
        nombre_dimension: Array.from({ length: dimCount }, (_, i) => {
          const val = toStringList(config.nombre_dimension)[i] ?? "";
          return val.trim() || `Variable ${i + 1}`;
        }),
      };
      const payload = await api.generateTabulacion(apiBaseUrl, authToken, resolvedConfig);
      const correlationOk = typeof payload.correlation === "number" || payload.correlation === null;
      if (!correlationOk || !payload.baseCsv || !payload.excelBase64) {
        throw new Error("La API respondió sin los artefactos esperados.");
      }
      setStatusMessage("Procesando resultados...");
      const excelBytes = base64ToUint8Array(payload.excelBase64);
      const csvRows = await csvToRows(payload.baseCsv);
      const parsedWorkbook = await workbookToSheetRows(excelBytes);
      const nextLinks: DownloadLinks = {
        json: URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json;charset=utf-8" })),
        csv: URL.createObjectURL(new Blob([payload.baseCsv], { type: "text/csv;charset=utf-8" })),
        xlsx: URL.createObjectURL(new Blob([excelBytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })),
      };
      setDownloadLinks((cur) => { revokeDownloadLinks(cur); return nextLinks; });
      setResult({
        correlation: payload.correlation,
        correlationControl: payload.correlationControl ?? null,
        quasiExperimental: payload.quasiExperimental ?? null,
        diseno: payload.diseno ?? "correlacional",
        warnings: payload.warnings ?? [],
        csvRows,
        sheetNames: parsedWorkbook.names,
        sheetData: parsedWorkbook.data,
        chartsPreview: payload.chartsPreview ?? [],
        tema: payload.tema ?? toStringValue(config.tema) ?? "clasico",
        generatedAt: new Date().toISOString(),
      });
      setSelectedSheet(parsedWorkbook.names[0] ?? "");
      setStatusMessage("Tabulación generada correctamente.");
      onPasoHecho?.("tabulacion");
    } catch (err) {
      // El 401 lo resuelve el manejador central (api.setUnauthorizedHandler):
      // aquí solo se informa del fallo.
      setErrorMessage(err instanceof Error ? err.message : "No se pudo generar la tabulación.");
      setStatusMessage("Ocurrió un error.");
    } finally {
      setIsGenerating(false);
    }
  };
  // Mensaje de progreso por etapas: con servidores que despiertan de una
  // suspensión, la generación puede tardar 1-2 minutos y el usuario debe
  // saber que todo va bien.
  const generationProgressMessage = !isGenerating
    ? statusMessage
    : generationElapsed < 8
      ? "Enviando configuración a la API..."
      : generationElapsed < 40
        ? `El servidor está procesando (${generationElapsed}s)... puede tardar hasta 2 minutos, no cierres la página.`
        : `Generando tu Excel: estadísticos, baremos y gráficos (${generationElapsed}s)... ya falta poco.`;

  return (
        <div className="mx-auto max-w-3xl">
          <div className="mb-6">
            <h2 className="font-display text-2xl font-bold tracking-tight">Generar tabulación</h2>
            <p className="mt-1 text-sm text-muted-foreground">Completa los 3 pasos para generar tu archivo Excel.</p>
          </div>

          {/* Trabajo recuperado de una visita anterior. Se anuncia siempre: si
              el formulario apareciera lleno sin explicación, el usuario no
              sabría de dónde salió ni si es suyo. */}
          {borradorRecuperado && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <Check className="h-4 w-4 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 text-sm text-foreground">
                Recuperamos lo que habías avanzado
                {borradorInicial && (
                  <span className="text-muted-foreground">
                    {" "}(guardado el {new Date(borradorInicial.guardadoEn).toLocaleString("es", {
                      day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
                    })})
                  </span>
                )}.
              </p>
              <Button variant="outline" size="sm" onClick={empezarDeCero}>
                Empezar de cero
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBorradorRecuperado(false)}>
                Continuar
              </Button>
            </div>
          )}

          {/* Tabulación exige suscripción vigente; Forms va por usos y sigue disponible. */}
          <SubscriptionWarning user={authUser} tool="tabulacion" onUpgrade={onUpgrade} />

          <WizardProgress currentStep={wizardStep} />

          {/* Step 1: Datos básicos */}
          {wizardStep === 1 && (
            <div className="step-enter space-y-5">
              <TraerDelProyecto
                proyecto={proyecto}
                descripcion="Rellena variables, dimensiones, indicadores, ítems y baremo con el instrumento que ya definiste."
                acciones={[{ label: "Traer del proyecto", aplicar: traerInstrumento }]}
              />
              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Datos de tu encuesta</CardTitle>
                  <CardDescription>Ingresa la información básica de tu instrumento de investigación.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {(() => {
                    const numVars = isQuasi ? 1 : (parseInt(getScalar("variable"), 10) || 2);
                    const hasV2 = !isQuasi && numVars >= 2;
                    return (
                      <>
                        {/* Diseño de investigación — selector */}
                        <div>
                          <div className="mb-2 flex items-center gap-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                            <p className="text-base font-semibold text-foreground">¿Cuál es el diseño de tu investigación?</p>
                          </div>
                          <FieldHint text="Correlacional: mide la relación entre variables en un solo momento. Cuasiexperimental: compara un grupo experimental y uno control con pretest y postest para evaluar una intervención." />
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => setConfig((prev) => ({ ...prev, diseno: "correlacional", variable: "2" }))}
                              className={cn(
                                "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                !isQuasi
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50",
                              )}
                            >
                              <ArrowUpDown className="h-4 w-4" />
                              Correlacional
                            </button>
                            <button
                              onClick={() => setConfig((prev) => {
                                const next: TabConfig = { ...prev, diseno: QUASI_DEFAULTS.diseno, variable: QUASI_DEFAULTS.variable };
                                (Object.keys(QUASI_DEFAULTS) as (keyof typeof QUASI_DEFAULTS)[])
                                  .forEach((key) => {
                                    if (!toStringValue(next[key]).trim()) next[key] = QUASI_DEFAULTS[key];
                                  });
                                return next;
                              })}
                              className={cn(
                                "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                isQuasi
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50",
                              )}
                            >
                              <FlaskConical className="h-4 w-4" />
                              Cuasiexperimental
                            </button>
                          </div>
                        </div>

                        {/* Número de variables — selector (solo correlacional) */}
                        {!isQuasi && (
                        <div>
                          <div className="mb-2 flex items-center gap-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                            <p className="text-base font-semibold text-foreground">¿Cuántas variables tiene tu encuesta?</p>
                          </div>
                          <FieldHint text="La mayoría de tesis usan 2 variables. Si solo tienes 1, la correlación no aplica." />
                          <div className="mt-3 flex gap-2">
                            {[1, 2].map((n) => (
                              <button
                                key={n}
                                onClick={() => setScalar("variable", String(n))}
                                className={cn(
                                  "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                  numVars === n
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                )}
                              >
                                {n} variable{n > 1 ? "s" : ""}
                              </button>
                            ))}
                          </div>
                        </div>
                        )}

                        {/* Divider: Datos generales */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Datos generales</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>

                        {/* General */}
                        <div className="grid gap-4 sm:grid-cols-2">
                          {[
                            { key: "nommuestra", label: isQuasi ? "Nombre de los participantes" : "Nombre de la muestra", hint: isQuasi ? "¿Cómo se llaman los participantes del estudio? Ej: Estudiantes, Pacientes, Trabajadores." : "¿Cómo se llaman las personas encuestadas? Ej: Beneficiarios, Estudiantes, Trabajadores.", placeholder: "Ej: Estudiantes" },
                            ...(isQuasi ? [] : [
                              { key: "muestra", label: "Cantidad de personas encuestadas", hint: "Total de personas que respondieron la encuesta. Mínimo 2.", placeholder: "Ej: 289" },
                            ]),
                            { key: "respuesta", label: "¿Cuántas opciones tiene cada pregunta?", hint: "Cuenta las alternativas de tu escala. Ej: Muy en desacuerdo / En desacuerdo / Neutral / De acuerdo / Muy de acuerdo = 5 opciones.", placeholder: "Ej: 5" },
                          ].map((field) => (
                            <div key={field.key}>
                              <label className="block">
                                <span className="text-sm font-medium text-foreground">{field.label}</span>
                                <Input className="mt-1.5" value={getScalar(field.key)} onChange={(e) => setScalar(field.key, e.target.value)} placeholder={field.placeholder} />
                              </label>
                              <FieldHint text={field.hint} />
                            </div>
                          ))}
                        </div>

                        {/* Grupos y efecto — solo cuasiexperimental */}
                        {isQuasi && (
                          <div className="rounded-xl border border-border/80 bg-background/50 p-4 space-y-5">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                              <p className="text-base font-semibold text-foreground">Grupos, mediciones y efecto de la intervención</p>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className="block">
                                  <span className="text-sm font-medium text-foreground">Cantidad del grupo experimental</span>
                                  <Input className="mt-1.5" value={getScalar("nExperimental")} onChange={(e) => setScalar("nExperimental", e.target.value)} placeholder="Ej: 30" />
                                </label>
                                <FieldHint text="Participantes que reciben la intervención. Mínimo 2." />
                              </div>
                              <div>
                                <label className="block">
                                  <span className="text-sm font-medium text-foreground">Cantidad del grupo control</span>
                                  <Input className="mt-1.5" value={getScalar("nControl")} onChange={(e) => setScalar("nControl", e.target.value)} placeholder="Ej: 30" />
                                </label>
                                <FieldHint text="Participantes que NO reciben la intervención. Mínimo 2." />
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Muestra total: <span className="font-semibold text-foreground">{(parseIntSafe(config.nExperimental) ?? 0) + (parseIntSafe(config.nControl) ?? 0)}</span> participantes.
                            </p>

                            <div>
                              <p className="text-sm font-medium text-foreground">Número de mediciones</p>
                              <FieldHint text="2 mediciones: pretest (antes de la intervención) y postest (después). 3 mediciones: agrega un seguimiento posterior que evalúa si el efecto se mantiene en el tiempo." />
                              <div className="mt-2 flex gap-2">
                                {[
                                  { id: "2", label: "2 — Pretest y Postest" },
                                  { id: "3", label: "3 — Pretest, Postest y Seguimiento" },
                                ].map((option) => (
                                  <button
                                    key={option.id}
                                    onClick={() => setScalar("mediciones", option.id)}
                                    className={cn(
                                      "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                      (getScalar("mediciones") || "2") === option.id
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <p className="text-sm font-medium text-foreground">Tamaño del efecto esperado</p>
                              <FieldHint text="Qué tanto cambia el grupo experimental después de la intervención. El grupo control se mantiene relativamente estable." />
                              {(() => {
                                const efectoActual = getScalar("efectoIntervencion") || "moderado";
                                const esNivel = QUASI_EFFECT_LEVELS.some((l) => l.id === efectoActual);
                                return (
                                  <>
                                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                                      {QUASI_EFFECT_LEVELS.map((lvl) => {
                                        const selected = efectoActual === lvl.id;
                                        return (
                                          <button
                                            key={lvl.id}
                                            onClick={() => setScalar("efectoIntervencion", lvl.id)}
                                            className={cn(
                                              "rounded-xl border-2 px-3 py-2 text-left transition-all",
                                              selected
                                                ? "border-primary bg-primary/10"
                                                : "border-border bg-background hover:border-primary/50",
                                            )}
                                          >
                                            <span className={cn("block text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{lvl.nombre}</span>
                                            <span className="block text-xs text-muted-foreground">{lvl.detalle}</span>
                                          </button>
                                        );
                                      })}
                                      <button
                                        onClick={() => { if (esNivel) setScalar("efectoIntervencion", "1.5"); }}
                                        className={cn(
                                          "rounded-xl border-2 px-3 py-2 text-left transition-all",
                                          !esNivel
                                            ? "border-primary bg-primary/10"
                                            : "border-border bg-background hover:border-primary/50",
                                        )}
                                      >
                                        <span className={cn("block text-sm font-semibold", !esNivel ? "text-primary" : "text-foreground")}>Personalizado</span>
                                        <span className="block text-xs text-muted-foreground">Define tu propia magnitud</span>
                                      </button>
                                    </div>
                                    {!esNivel && (
                                      <div className="mt-3">
                                        <label className="block">
                                          <span className="text-sm font-medium text-foreground">Magnitud personalizada (0 a 3)</span>
                                          <Input
                                            className="mt-1.5 max-w-[160px]"
                                            value={efectoActual}
                                            onChange={(e) => setScalar("efectoIntervencion", e.target.value)}
                                            placeholder="Ej: 1.5"
                                          />
                                        </label>
                                        <FieldHint text="0 = sin efecto, 0.35 ≈ bajo, 0.75 ≈ moderado, 1.15 ≈ alto. Valores mayores producen cambios más marcados." />
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>

                            <div>
                              <p className="text-sm font-medium text-foreground">Dirección del efecto</p>
                              <FieldHint text="Mejora: los puntajes del grupo experimental suben en el postest (ej: mejora del aprendizaje). Disminución: bajan (ej: reducción de la ansiedad)." />
                              <div className="mt-2 flex gap-2">
                                <button
                                  onClick={() => setScalar("direccionEfecto", "mejora")}
                                  className={cn(
                                    "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                    (getScalar("direccionEfecto") || "mejora") === "mejora"
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                  )}
                                >
                                  <TrendingUp className="h-4 w-4" />
                                  Mejora (los puntajes suben)
                                </button>
                                <button
                                  onClick={() => setScalar("direccionEfecto", "disminuye")}
                                  className={cn(
                                    "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                    getScalar("direccionEfecto") === "disminuye"
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                  )}
                                >
                                  <TrendingDown className="h-4 w-4" />
                                  Disminución (los puntajes bajan)
                                </button>
                              </div>
                            </div>

                            <div>
                              <p className="text-sm font-medium text-foreground">¿Controlar el patrón de resultados?</p>
                              <FieldHint text="Activado: se simulan hasta 80 muestras y se conserva la que mejor reproduce el patrón esperado (grupos equivalentes al inicio, control estable y cambio del experimental según el efecto elegido). Como la muestra se elige por sus p-valores, esos p-valores sobrestiman la significación y no equivalen a los de una muestra única. Desactivado: una sola simulación, sin selección — es lo que debes usar si vas a reportar los p-valores. Función pensada para datos simulados, pruebas y demostraciones académicas." />
                              {getScalar("controlarResultados") !== "0" && (
                                <p className="mt-2 flex items-start gap-2 rounded-lg border border-ambar/40 bg-ambar/10 p-2.5 text-xs text-foreground">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ambar" />
                                  <span>
                                    Con el control activado los p-valores quedan condicionados por la selección de la
                                    muestra. El Excel lo declara en la hoja "Información".
                                  </span>
                                </p>
                              )}
                              <div className="mt-2 flex gap-2">
                                <button
                                  onClick={() => setScalar("controlarResultados", "1")}
                                  className={cn(
                                    "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                    getScalar("controlarResultados") !== "0"
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                  )}
                                >
                                  Activado
                                </button>
                                <button
                                  onClick={() => setScalar("controlarResultados", "0")}
                                  className={cn(
                                    "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                                    getScalar("controlarResultados") === "0"
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                  )}
                                >
                                  Desactivado — resultado natural
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Divider: Configuración por variable */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Configuración por variable</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>

                        {/* Por variable */}
                        <div className="rounded-xl border border-border/60 bg-background/50 p-4">
                          <div className={cn("grid gap-4", hasV2 ? "grid-cols-2" : "grid-cols-1")}>
                            {/* Headers */}
                            <div className="rounded bg-primary/10 px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide text-primary">{isQuasi ? "Variable dependiente" : "Variable 1"}</div>
                            {hasV2 && <div className="rounded bg-primary/10 px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide text-primary">Variable 2</div>}
                            {/* Preguntas */}
                            <div>
                              <label className="block">
                                <span className="text-sm font-medium text-foreground">Preguntas</span>
                                <Input className="mt-1.5" value={getScalar("item")} onChange={(e) => setScalar("item", e.target.value)} placeholder="Ej: 18" />
                              </label>
                            </div>
                            {hasV2 && (
                              <div>
                                <label className="block">
                                  <span className="text-sm font-medium text-foreground">Preguntas</span>
                                  <Input className="mt-1.5" value={getScalar("itemv2")} onChange={(e) => setScalar("itemv2", e.target.value)} placeholder="Ej: 9" />
                                </label>
                              </div>
                            )}
                            <FieldHint text="Cuántas preguntas (ítems) tiene cada variable." />
                            {hasV2 && <FieldHint text="Cuántas preguntas (ítems) tiene cada variable." />}
                            {/* Dimensiones */}
                            <div>
                              <label className="block">
                                <span className="text-sm font-medium text-foreground">Dimensiones</span>
                                <Input className="mt-1.5" value={getScalar("dimensiones")} onChange={(e) => setScalar("dimensiones", e.target.value)} placeholder="Ej: 3" />
                              </label>
                            </div>
                            {hasV2 && (
                              <div>
                                <label className="block">
                                  <span className="text-sm font-medium text-foreground">Dimensiones</span>
                                  <Input className="mt-1.5" value={getScalar("dimensiones_v2")} onChange={(e) => setScalar("dimensiones_v2", e.target.value)} placeholder="Ej: 3" />
                                </label>
                              </div>
                            )}
                            <FieldHint text="En cuántos grupos temáticos se divide la variable." />
                            {hasV2 && <FieldHint text="Puede tener un número distinto al de la Variable 1." />}
                            {/* Niveles baremo */}
                            <div>
                              <label className="block">
                                <span className="text-sm font-medium text-foreground">Niveles del baremo</span>
                                <Input className="mt-1.5" value={getScalar("escala")} onChange={(e) => setScalar("escala", e.target.value)} placeholder="Ej: 3" />
                              </label>
                            </div>
                            {hasV2 && (
                              <div>
                                <label className="block">
                                  <span className="text-sm font-medium text-foreground">Niveles del baremo</span>
                                  <Input className="mt-1.5" value={getScalar("escala_v2")} onChange={(e) => setScalar("escala_v2", e.target.value)} placeholder="Ej: 3" />
                                </label>
                              </div>
                            )}
                            <FieldHint text="Cuántos niveles tiene el baremo. Ej: 3 = Bajo / Medio / Alto." />
                            {hasV2 && <FieldHint text="Puede ser diferente al de la Variable 1." />}
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Relación — solo con 2 variables */}
                  {(parseInt(getScalar("variable"), 10) || 2) >= 2 && (
                    <div className="rounded-xl border border-border/80 bg-background/50 p-4">
                      <div className="mb-2 flex items-center gap-2.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                        <p className="text-base font-semibold text-foreground">¿Las variables van en la misma dirección?</p>
                      </div>
                      <FieldHint text="Misma dirección: si una variable sube, la otra también (ej: más horas de estudio → mejores notas). Dirección opuesta: si una sube, la otra baja (ej: más estrés → menor rendimiento)." />
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => setScalar("relacionversa", "0")}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                            getScalar("relacionversa") === "0"
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:border-primary/50",
                          )}
                        >
                          <ArrowRight className="h-4 w-4" />
                          Misma dirección (directa)
                        </button>
                        <button
                          onClick={() => setScalar("relacionversa", "1")}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                            getScalar("relacionversa") === "1"
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:border-primary/50",
                          )}
                        >
                          <ArrowUpDown className="h-4 w-4" />
                          Dirección opuesta (inversa)
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Control de correlación — solo con 2 variables */}
                  {(parseInt(getScalar("variable"), 10) || 2) >= 2 && (
                    <div className="rounded-xl border border-border/80 bg-background/50 p-4">
                      <div className="mb-2 flex items-center gap-2.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                        <p className="text-base font-semibold text-foreground">¿Controlar la correlación de los datos simulados?</p>
                      </div>
                      <FieldHint text="Activado: eliges qué tan fuerte debe salir la relación entre tus variables. Desactivado: la correlación será el resultado natural de los datos. Función pensada para datos simulados, pruebas y demostraciones académicas." />
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => setScalar("controlCorrelacion", "1")}
                          className={cn(
                            "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                            getScalar("controlCorrelacion") !== "0"
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:border-primary/50",
                          )}
                        >
                          Activado
                        </button>
                        <button
                          onClick={() => setScalar("controlCorrelacion", "0")}
                          className={cn(
                            "flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all",
                            getScalar("controlCorrelacion") === "0"
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:border-primary/50",
                          )}
                        >
                          Desactivado — correlación natural
                        </button>
                      </div>

                      {getScalar("controlCorrelacion") !== "0" && (
                        <div className="mt-4">
                          <p className="text-sm font-medium text-foreground">Nivel de correlación deseado</p>
                          <FieldHint text={`La dirección no se vuelve a preguntar: ya la elegiste arriba (${getScalar("relacionversa") === "1" ? "inversa → correlación negativa" : "directa → correlación positiva"}).`} />
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {CORRELATION_LEVELS.map((lvl) => {
                              const selected = (getScalar("nivelCorrelacion") || "muy_alta") === lvl.id;
                              return (
                                <button
                                  key={lvl.id}
                                  onClick={() => setScalar("nivelCorrelacion", lvl.id)}
                                  className={cn(
                                    "rounded-xl border-2 px-3 py-2 text-left transition-all",
                                    selected
                                      ? "border-primary bg-primary/10"
                                      : "border-border bg-background hover:border-primary/50",
                                  )}
                                >
                                  <span className={cn("block text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{lvl.nombre}</span>
                                  <span className="block text-xs text-muted-foreground">{lvl.rango}</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground">Método de correlación:</span>
                              {[
                                { id: "auto", label: "Automático (según normalidad)" },
                                { id: "spearman", label: "Spearman" },
                                { id: "pearson", label: "Pearson" },
                              ].map((m) => {
                                const selected = (getScalar("metodoCorrelacion") || "auto") === m.id;
                                return (
                                  <button
                                    key={m.id}
                                    onClick={() => setScalar("metodoCorrelacion", m.id)}
                                    className={cn(
                                      "rounded-full border px-3 py-1 text-xs font-medium transition-all",
                                      selected
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                    )}
                                  >
                                    {m.label}
                                  </button>
                                );
                              })}
                            </div>
                            <FieldHint text="Automático: la prueba de normalidad del Excel decide (Pearson si los datos salen normales, Spearman si no). Si eliges Pearson o Spearman, el Excel usa ese método y la narrativa lo justifica; con Pearson además los datos se generan con distribuciones compatibles con normalidad." />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button size="lg" onClick={() => {
                  autoCalcBaremo("v1");
                  const hasV2next = (parseIntSafe(config.variable) ?? 2) >= 2;
                  if (hasV2next) autoCalcBaremo("v2");
                  // Auto-generar estructura con dimensiones e ítems repartidos.
                  // Preserva nombres existentes cuando sea posible (si el usuario ya escribió algo).
                  const initEstructura = (numItems: number, numDims: number, prev: DimensionDef[]): DimensionDef[] => {
                    const usedItems = prev.flatMap((d) => d.indicadores.flatMap((i) => i.items)).length;
                    if (usedItems === numItems && prev.length === numDims && numDims > 0) return prev;
                    const dims = Math.max(numDims, 1);
                    const base = Math.floor(numItems / dims);
                    const extra = numItems % dims;
                    // Aplanar todos los ítems previos para reutilizar nombres
                    const allPrevItems = prev.flatMap((d) => d.indicadores.flatMap((i) => i.items));
                    let globalIdx = 0;
                    return Array.from({ length: dims }, (_, di) => {
                      const count = base + (di < extra ? 1 : 0);
                      const existingDim = prev[di];
                      const items: ItemDef[] = Array.from({ length: count }, (_, k) => {
                        const existing = allPrevItems[globalIdx + k];
                        return existing ?? { id: eid(), nombre: `Ítem ${globalIdx + k + 1}` };
                      });
                      globalIdx += count;
                      return {
                        id: existingDim?.id ?? eid(),
                        nombre: existingDim?.nombre ?? "",
                        indicadores: [{
                          id: existingDim?.indicadores[0]?.id ?? eid(),
                          nombre: existingDim?.indicadores[0]?.nombre ?? "",
                          items,
                        }],
                      };
                    });
                  };
                  const numV1 = parseIntSafe(config.item) ?? 0;
                  const numV2 = parseIntSafe(config.itemv2) ?? 0;
                  const dimsV1 = Math.max(parseIntSafe(config.dimensiones) ?? 1, 1);
                  const dimsV2 = Math.max(parseIntSafe(config.dimensiones_v2) ?? 1, 1);
                  const muestra = parseIntSafe(config.muestra) ?? 0;
                  if (isQuasi) {
                    const nExp = parseIntSafe(config.nExperimental) ?? 0;
                    const nCtrl = parseIntSafe(config.nControl) ?? 0;
                    if (nExp < 2) { setErrorMessage("El grupo experimental debe tener 2 o más participantes."); return; }
                    if (nCtrl < 2) { setErrorMessage("El grupo control debe tener 2 o más participantes."); return; }
                  }
                  if (muestra <= 0) { setErrorMessage("La cantidad de personas encuestadas debe ser mayor a 0."); return; }
                  if (numV1 <= 0) { setErrorMessage("El número de preguntas de Variable 1 debe ser mayor a 0."); return; }
                  if (hasV2next && numV2 <= 0) { setErrorMessage("El número de preguntas de Variable 2 debe ser mayor a 0."); return; }
                  if (dimsV1 > numV1) {
                    setErrorMessage(`Variable 1: no puedes tener más dimensiones (${dimsV1}) que preguntas (${numV1}).`); return;
                  }
                  if (hasV2next && dimsV2 > numV2) {
                    setErrorMessage(`Variable 2: no puedes tener más dimensiones (${dimsV2}) que preguntas (${numV2}).`); return;
                  }
                  if (numV1 > 0) setEstructuraV1((prev) => initEstructura(numV1, dimsV1, prev));
                  if (hasV2next && numV2 > 0) setEstructuraV2((prev) => initEstructura(numV2, dimsV2, prev));
                  setWizardStep(2);
                  setErrorMessage(null);
                }}>
                  Siguiente: Escalas y estructura
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Escalas y estructura */}
          {wizardStep === 2 && (
            <div className="step-enter space-y-5">
              {LIST_GROUPS.filter((group) => !("variable" in group && group.variable === "v2") || (!isQuasi && parseInt(getScalar("variable"), 10) >= 2)).map((group) => (
                <Card key={group.title} className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                  <CardHeader>
                    <CardTitle>{group.title}</CardTitle>
                    <CardDescription>
                      {isQuasi && "variable" in group && group.variable === "v1"
                        ? "¿En qué nivel queda cada participante? Define los nombres de los niveles (Bajo, Medio, Alto). Los rangos exactos se calculan solos; la distribución de puntajes la determina el efecto elegido."
                        : group.description}
                    </CardDescription>
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
                  <CardContent className={cn("grid gap-3", group.fields.length > 1 && "md:grid-cols-2")}>
                    {group.fields.filter((field) => !isQuasi || !field.key.startsWith("porcentaje")).map((field) => {
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
                          readOnly={field.key === "cantidad" || field.key === "cantidad_v2"}
                          rowLabels={rowLabels}
                        />
                      );
                    })}
                  </CardContent>
                </Card>
              ))}

              {/* Estructura jerárquica — Variable 1 */}
              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Ponle nombre a tu Variable 1</CardTitle>
                  <StepTip
                    icon={<Zap className="h-4 w-4" />}
                    label="Ya armamos el esqueleto"
                    detail="— ahora escríbele un nombre a cada parte ↓"
                    color="primary"
                  />
                </CardHeader>
                <CardContent>
                  <div className="mb-5">
                    <label className="block">
                      <span className="text-sm font-medium text-foreground">Nombre de la variable</span>
                      <Input
                        className="mt-1.5"
                        value={toStringList(config.nombre_dimension)[0] ?? ""}
                        onChange={(e) => setConfig((prev) => {
                          const dims = [...toStringList(prev.nombre_dimension)];
                          while (dims.length < 1) dims.push("");
                          dims[0] = e.target.value;
                          return { ...prev, nombre_dimension: dims };
                        })}
                        placeholder="Ej: Gestión de abastecimiento"
                      />
                    </label>
                    <FieldHint text="Este nombre aparece como etiqueta de Variable 1 en el Excel generado." />
                  </div>
                  <HierarchyEditor
                    label="Variable 1"
                    totalItems={parseIntSafe(config.item) ?? 0}
                    estructura={estructuraV1}
                    onChange={setEstructuraV1}
                  />
                </CardContent>
              </Card>

              {/* Estructura jerárquica — Variable 2 */}
              {(parseIntSafe(config.variable) ?? 2) >= 2 && (
                <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                  <CardHeader>
                    <CardTitle>Ponle nombre a tu Variable 2</CardTitle>
                    <StepTip
                      icon={<Zap className="h-4 w-4" />}
                      label="Ya armamos el esqueleto"
                      detail="— ahora escríbele un nombre a cada parte de Variable 2 ↓"
                      color="primary"
                    />
                  </CardHeader>
                  <CardContent>
                    <div className="mb-5">
                      <label className="block">
                        <span className="text-sm font-medium text-foreground">Nombre de la variable</span>
                        <Input
                          className="mt-1.5"
                          value={toStringList(config.nombre_dimension)[1] ?? ""}
                          onChange={(e) => setConfig((prev) => {
                            const dims = [...toStringList(prev.nombre_dimension)];
                            while (dims.length < 2) dims.push("");
                            dims[1] = e.target.value;
                            return { ...prev, nombre_dimension: dims };
                          })}
                          placeholder="Ej: Satisfacción del servicio"
                        />
                      </label>
                      <FieldHint text="Este nombre aparece como etiqueta de Variable 2 en el Excel generado." />
                    </div>
                    <HierarchyEditor
                      label="Variable 2"
                      totalItems={parseIntSafe(config.itemv2) ?? 0}
                      estructura={estructuraV2}
                      onChange={setEstructuraV2}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Advanced JSON toggle */}
              <div className="rounded-xl border border-border/60 bg-card/60">
                <button
                  onClick={() => setShowAdvancedJson((v) => !v)}
                  aria-expanded={showAdvancedJson}
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
                      aria-label="JSON de configuración del asistente"
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
                  <div role="alert" className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {step2Error}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="lg" onClick={() => { setWizardStep(1); setStep2Error(null); }}>
                    <ArrowLeft className="h-4 w-4" />
                    Atrás
                  </Button>
                  <Button size="lg" onClick={() => {
                    const sumOf = (list: string[]) => list.reduce((acc, v) => { const n = parseInt(v.trim(), 10); return Number.isFinite(n) ? acc + n : acc; }, 0);
                    const hasV2 = !isQuasi && (parseIntSafe(config.variable) ?? 2) >= 2;
                    if (!isQuasi) {
                      const v1Sum = sumOf(getList("porcentaje"));
                      const v2Sum = hasV2 ? sumOf(getList("porcentaje_v2")) : 100;
                      if (v1Sum !== 100 || v2Sum !== 100) {
                        setStep2Error("Los porcentajes de cada variable deben sumar exactamente 100%"); return;
                      }
                    }
                    const totalV1 = parseIntSafe(config.item) ?? 0;
                    const usedV1 = estructuraV1.flatMap((d) => d.indicadores.flatMap((i) => i.items)).length;
                    if (totalV1 > 0 && usedV1 !== totalV1) {
                      setStep2Error(`La estructura de V1 tiene ${usedV1} ítems pero se esperan ${totalV1}`); return;
                    }
                    if (hasV2) {
                      const totalV2 = parseIntSafe(config.itemv2) ?? 0;
                      const usedV2 = estructuraV2.flatMap((d) => d.indicadores.flatMap((i) => i.items)).length;
                      if (totalV2 > 0 && usedV2 !== totalV2) {
                        setStep2Error(`La estructura de V2 tiene ${usedV2} ítems pero se esperan ${totalV2}`); return;
                      }
                    }
                    setStep2Error(null);
                    setWizardStep(3);
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
            <div className="step-enter space-y-5">
              {/* Summary */}
              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle>Resumen de tu configuración</CardTitle>
                  <CardDescription>Revisa que todo esté correcto antes de generar.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {(isQuasi ? [
                      { label: "Diseño", value: "Cuasiexperimental (pretest-postest)" },
                      { label: "Muestra", value: `${getScalar("nommuestra")} (${getScalar("muestra")} en total)` },
                      { label: "Grupo experimental", value: `${getScalar("nExperimental")} participantes` },
                      { label: "Grupo control", value: `${getScalar("nControl")} participantes` },
                      { label: "Mediciones", value: (getScalar("mediciones") || "2") === "3" ? "3 (Pre, Post y Seguimiento)" : "2 (Pretest y Postest)" },
                      { label: "Efecto esperado", value: QUASI_EFFECT_LEVELS.find((l) => l.id === (getScalar("efectoIntervencion") || "moderado"))?.nombre ?? `Personalizado (${getScalar("efectoIntervencion")})` },
                      { label: "Dirección", value: getScalar("direccionEfecto") === "disminuye" ? "Disminución" : "Mejora" },
                      { label: "Control de resultados", value: getScalar("controlarResultados") === "0" ? "Desactivado (natural)" : "Activado" },
                      { label: "Preguntas", value: getScalar("item") },
                      { label: "Niveles del baremo", value: getScalar("escala") },
                      { label: "Opciones por pregunta", value: `1 al ${getScalar("respuesta")}` },
                      { label: "Variable dependiente", value: getList("nombre_dimension").filter(Boolean).join(", ") || "—" },
                    ] : [
                      { label: "Muestra", value: `${getScalar("nommuestra")} (${getScalar("muestra")} personas)` },
                      { label: "Variables", value: getScalar("variable") },
                      { label: "Preguntas V1", value: getScalar("item") },
                      ...((parseIntSafe(config.variable) ?? 2) >= 2 ? [{ label: "Preguntas V2", value: getScalar("itemv2") }] : []),
                      { label: "Niveles baremo V1", value: getScalar("escala") },
                      ...((parseIntSafe(config.variable) ?? 2) >= 2 ? [{ label: "Niveles baremo V2", value: getScalar("escala_v2") }] : []),
                      { label: "Opciones por pregunta", value: `1 al ${getScalar("respuesta")}` },
                      { label: "Relación", value: getScalar("relacionversa") === "1" ? "Inversa" : "Directa" },
                      ...((parseIntSafe(config.variable) ?? 2) >= 2 ? [{
                        label: "Control de correlación",
                        value: getScalar("controlCorrelacion") === "0"
                          ? "Desactivado (natural)"
                          : (CORRELATION_LEVELS.find((l) => l.id === (getScalar("nivelCorrelacion") || "muy_alta"))?.nombre ?? "Muy alta"),
                      }] : []),
                      { label: "Variables", value: getList("nombre_dimension").filter(Boolean).join(", ") || "—" },
                    ]).map((item) => (
                      <div key={item.label} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="mt-0.5 text-sm font-semibold truncate">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Tema de los gráficos */}
              <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5 text-primary" />
                    Tema de los gráficos
                  </CardTitle>
                  <CardDescription>
                    Elige la paleta de colores para los gráficos de tu Excel. La vista previa usará el mismo tema.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ThemePicker
                    value={getScalar("tema") || "clasico"}
                    onChange={(id) => setScalar("tema", id)}
                  />
                </CardContent>
              </Card>

              {/* Validations */}
              {validationMessages.length > 0 && (
                <Card role="alert" className="rounded-2xl border-danger/40 bg-danger/5 shadow-sm">
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
                  {/* role="alert" para que un lector de pantalla lo anuncie en
                      cuanto aparece: es el resultado de una acción que el
                      usuario acaba de pedir, y sin esto fallaba en silencio. */}
                  {errorMessage && (
                    <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{errorMessage}</div>
                  )}
                  <MagicButton
                    size="lg"
                    className="h-14 w-full text-base"
                    onClick={handleGenerate}
                    disabled={isGenerating || validationMessages.length > 0}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        {`Generando tu Excel...${generationElapsed > 0 ? ` (${generationElapsed}s)` : ""}`}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-5 w-5" />
                        Generar tabulación
                      </>
                    )}
                  </MagicButton>
                  {/* aria-live="polite": el progreso cambia solo (cronómetro)
                      y debe anunciarse sin interrumpir. Sin esto, quien no ve
                      la pantalla no sabe si la generación avanza o se colgó. */}
                  <p aria-live="polite" className="text-center text-xs text-muted-foreground">{generationProgressMessage}</p>
                </CardContent>
              </Card>

              {/* Result */}
              {result && (
                <Card className="step-enter rounded-2xl border-primary/30 bg-primary/5 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-primary flex items-center gap-2">
                      <Check className="h-5 w-5" />
                      ¡Tabulación generada exitosamente!
                    </CardTitle>
                    <CardDescription>Generado el {new Date(result.generatedAt).toLocaleString()}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* Análisis cuasiexperimental: comparaciones y decisiones */}
                    {result.quasiExperimental && (
                      <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Análisis cuasiexperimental (α = {result.quasiExperimental.alpha})
                          </p>
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            Pretest-postest con grupo control
                          </span>
                        </div>
                        <div className="mt-3 space-y-2.5">
                          {[result.quasiExperimental.baseline, ...result.quasiExperimental.comparisons].map((comp) => (
                            <div key={comp.name} className="rounded-lg border border-border/60 bg-card/60 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-foreground">{comp.name}</p>
                                <span className={cn(
                                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                  comp.significant
                                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                                    : "bg-muted text-muted-foreground",
                                )}>
                                  {comp.significant ? "Diferencia significativa" : "Sin diferencia significativa"}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {comp.testLabel} · p = {comp.p.toFixed(3)} · {comp.decision} · Tamaño del efecto: {Number.isFinite(comp.effectSize) ? comp.effectSize.toFixed(3) : "—"} ({comp.effectMagnitude})
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">{comp.interpretation}</p>
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          Datos simulados: función pensada para pruebas, ensayos estadísticos y demostraciones académicas; no reemplaza datos reales. El detalle completo está en la hoja “Comparaciones” del Excel.
                        </p>
                      </div>
                    )}

                    {/* Correlation: con 1 sola variable no aplica */}
                    {!result.quasiExperimental && result.correlationControl ? (
                      <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm text-muted-foreground">
                            Correlación obtenida ({result.correlationControl.metodo === "pearson" ? "Pearson" : "Rho de Spearman"})
                            {" · "}dirección {result.correlationControl.direccion}
                          </p>
                          {result.correlationControl.activo ? (
                            result.correlationControl.cumple ? (
                              <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400">
                                ✓ Dentro del rango elegido
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                                Fuera del rango (se aproximó lo máximo posible)
                              </span>
                            )
                          ) : (
                            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                              Control desactivado — resultado natural
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-baseline gap-3">
                          <span className="text-4xl font-bold tracking-tight text-primary">{result.correlationControl.obtenido.toFixed(3)}</span>
                          <div>
                            <span className={cn("text-sm font-semibold", correlationInfo(result.correlationControl.obtenido).colorClass)}>
                              Correlación {correlationInfo(result.correlationControl.obtenido).label}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {result.correlationControl.activo
                                ? `Objetivo: ${result.correlationControl.etiqueta} (±${result.correlationControl.esperadoMin?.toFixed(2)} a ±${result.correlationControl.esperadoMax?.toFixed(2)})`
                                : correlationInfo(result.correlationControl.obtenido).explanation}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Datos simulados: función pensada para pruebas, ensayos estadísticos y demostraciones académicas; no reemplaza datos reales.
                        </p>
                      </div>
                    ) : result.correlation !== null && (
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
                    )}

                    {/* Avisos del generador */}
                    {result.warnings.length > 0 && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-1.5">
                        {result.warnings.map((w) => (
                          <p key={w} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {w}
                          </p>
                        ))}
                      </div>
                    )}

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
                          <Select
                            wrapperClassName="w-48"
                            className="h-8 rounded-lg pl-2.5 pr-8 text-xs"
                            value={selectedSheet || result.sheetNames[0]}
                            onChange={(e) => setSelectedSheet(e.target.value)}
                          >
                            {result.sheetNames.map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </Select>
                        )}
                      </div>
                      <PreviewTable rows={result.sheetData[selectedSheet || (result.sheetNames[0] ?? "")] ?? []} maxRows={10} />
                      {(() => {
                        const sheetName = selectedSheet || (result.sheetNames[0] ?? "");
                        const sheetCharts = result.chartsPreview.find((s) => s.sheet === sheetName)?.charts ?? [];
                        if (sheetCharts.length === 0) return null;
                        return (
                          <div className="mt-4">
                            <p className="mb-2 text-sm font-medium">Gráficos de esta hoja ({sheetCharts.length})</p>
                            <PreviewCharts charts={sheetCharts} palette={themePalette(result.tema)} />
                          </div>
                        );
                      })()}
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
  );
}
