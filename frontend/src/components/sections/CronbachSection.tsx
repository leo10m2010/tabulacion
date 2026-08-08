import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "../ui/button";
import { MagicButton } from "../ui/magic-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import * as api from "../../lib/api";
import { ALPHA_LEVELS } from "../../lib/constants";
import { base64ToUint8Array, eid, parseIntSafe, workbookToSheetRows } from "../../lib/helpers";
import type { AuthUser, InstrumentoVariable, PasoTesis, Proyecto, TableRows } from "../../lib/types";
import { FieldHint } from "../wizard-fields";
import { PreviewTable } from "../PreviewTable";
import { SubscriptionWarning } from "../SubscriptionWarning";
import { ToolSteps } from "../ToolSteps";
import { TraerDelProyecto } from "../TraerDelProyecto";
import type { AccionTraer } from "../TraerDelProyecto";

const MAX_MUESTRA = 2000;
const MAX_ITEMS = 60;

interface DimRow { id: string; nombre: string; items: string }

interface CronbachResult {
  alpha: number;
  cumple: boolean;
  etiqueta: string;
  esperadoMin: number;
  esperadoMax: number;
  K: number;
  encuestados: number;
  warnings: string[];
  xlsxUrl: string;
  fileName: string;
  previewRows: TableRows;
  generatedAt: string;
}

const interpretacionAlfa = (alpha: number) => {
  if (alpha >= 0.9) return "Excelente";
  if (alpha >= 0.8) return "Buena";
  if (alpha >= 0.7) return "Aceptable";
  if (alpha >= 0.6) return "Cuestionable";
  if (alpha >= 0.5) return "Pobre";
  return "Inaceptable";
};

// Sección Confiabilidad: prueba de Alfa de Cronbach por variable. Toma el
// nombre de la variable, sus dimensiones con la cantidad de ítems y el N de
// encuestados, y genera un Excel de una sola hoja con una base de alta
// consistencia interna y las fórmulas vivas (VARP, COUNT y el α en celda).
export function CronbachSection({ apiBaseUrl, authToken, authUser, proyecto, onPasoHecho, onUpgrade }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  proyecto: Proyecto | null;
  // Marca este paso como hecho en el proyecto activo, si hay uno.
  onPasoHecho?: (paso: PasoTesis) => void;
  onUpgrade?: (herramienta: string) => void;
}) {
  const [variable, setVariable] = useState("");
  const [encuestados, setEncuestados] = useState("30");
  const [dims, setDims] = useState<DimRow[]>([{ id: eid(), nombre: "", items: "15" }]);
  const [nivelAlfa, setNivelAlfa] = useState("excelente");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CronbachResult | null>(null);
  const xlsxUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (xlsxUrlRef.current) URL.revokeObjectURL(xlsxUrlRef.current);
  }, []);

  const totalItems = dims.reduce((acc, d) => acc + (parseIntSafe(d.items) ?? 0), 0);
  const n = parseIntSafe(encuestados) ?? 0;
  const issues: string[] = [];
  if (n < 5) issues.push("La cantidad de encuestados debe ser 5 o más.");
  if (n > MAX_MUESTRA) issues.push(`El sistema soporta máximo ${MAX_MUESTRA} encuestados.`);
  if (totalItems < 2) issues.push("Define al menos 2 ítems entre las dimensiones.");
  if (totalItems > MAX_ITEMS) issues.push(`El sistema soporta máximo ${MAX_ITEMS} ítems (configuraste ${totalItems}).`);

  const setDim = (id: string, patch: Partial<DimRow>) =>
    setDims((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  // El alfa se calcula por variable, así que se trae una a la vez. Si el
  // instrumento tiene dos, se ofrece un botón por cada una en vez de elegir
  // por el usuario cuál quiere validar.
  const traerVariable = (v: InstrumentoVariable) => {
    setVariable(v.nombre);
    setDims(v.dimensiones.map((d) => ({
      id: eid(),
      nombre: d.nombre,
      items: String(d.indicadores.reduce((acc, ind) => acc + ind.items.length, 0)),
    })));
    setError(null);
  };

  const variablesDelProyecto = proyecto?.instrumento.variables ?? [];
  const accionesTraer: AccionTraer[] = variablesDelProyecto.map((v, i) => ({
    label: variablesDelProyecto.length === 1
      ? "Traer del proyecto"
      : `Traer ${v.nombre || `variable ${i + 1}`}`,
    aplicar: () => traerVariable(v),
  }));

  const handleGenerate = async () => {
    setError(null);
    if (issues.length > 0) { setError("Corrige las validaciones antes de generar."); return; }
    setBusy(true);
    try {
      const payload = await api.generateCronbach(apiBaseUrl, authToken, {
        variable: variable.trim() || "Variable",
        encuestados: n,
        respuesta: 5,
        dimensiones: dims
          .filter((d) => (parseIntSafe(d.items) ?? 0) > 0)
          .map((d, i) => ({ nombre: d.nombre.trim() || `Dimensión ${i + 1}`, items: parseIntSafe(d.items) ?? 0 })),
        nivelAlfa,
      });
      if (typeof payload.alpha !== "number" || !payload.excelBase64) {
        throw new Error("La API respondió sin los resultados esperados.");
      }
      const excelBytes = base64ToUint8Array(payload.excelBase64);
      const parsed = await workbookToSheetRows(excelBytes);
      const xlsxUrl = URL.createObjectURL(new Blob(
        [excelBytes.buffer as ArrayBuffer],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      ));
      if (xlsxUrlRef.current) URL.revokeObjectURL(xlsxUrlRef.current);
      xlsxUrlRef.current = xlsxUrl;
      setResult({
        alpha: payload.alpha,
        cumple: payload.cumple,
        etiqueta: payload.etiqueta,
        esperadoMin: payload.esperadoMin,
        esperadoMax: payload.esperadoMax,
        K: payload.K,
        encuestados: payload.encuestados,
        warnings: payload.warnings ?? [],
        xlsxUrl,
        fileName: payload.excelFileName ?? "Alfa_Cronbach.xlsx",
        previewRows: parsed.data[parsed.names[0] ?? ""] ?? [],
        generatedAt: new Date().toISOString(),
      });
      onPasoHecho?.("confiabilidad");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la prueba de confiabilidad.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">Prueba de confiabilidad</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Alfa de Cronbach por variable, con una base de alta consistencia interna en una sola hoja de Excel.
        </p>
      </div>

      <ToolSteps steps={[
        "Escribe tu variable, sus dimensiones e ítems",
        "El sistema simula respuestas con alta consistencia interna",
        "Descarga el Excel con el α calculado y su interpretación",
      ]} />

      <SubscriptionWarning user={authUser} tool="confiabilidad" onUpgrade={onUpgrade} />

      <TraerDelProyecto
        proyecto={proyecto}
        descripcion="Rellena la variable y sus dimensiones con la cantidad de ítems del instrumento."
        acciones={accionesTraer}
      />

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Datos del instrumento
          </CardTitle>
          <CardDescription>
            La prueba se hace por variable: usa el mismo nombre, dimensiones y cantidad de ítems de tu encuesta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block">
                <span className="text-sm font-medium text-foreground">Nombre de la variable</span>
                <Input className="mt-1.5" value={variable} onChange={(e) => setVariable(e.target.value)} placeholder="Ej: Clima organizacional" />
              </label>
              <FieldHint text="La variable cuyo instrumento quieres validar." />
            </div>
            <div>
              <label className="block">
                <span className="text-sm font-medium text-foreground">Cantidad de encuestados</span>
                <Input className="mt-1.5" value={encuestados} onChange={(e) => setEncuestados(e.target.value)} placeholder="Ej: 30" />
              </label>
              <FieldHint text="El piloto típico usa 20 a 30 encuestados. Mínimo 5." />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Dimensiones e ítems</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDims((prev) => [...prev, { id: eid(), nombre: "", items: "" }])}
              >
                <Plus className="h-3.5 w-3.5" />
                Añadir dimensión
              </Button>
            </div>
            <div className="space-y-2">
              {dims.map((dim, i) => (
                <div key={dim.id} className="flex items-center gap-2">
                  <Input
                    value={dim.nombre}
                    onChange={(e) => setDim(dim.id, { nombre: e.target.value })}
                    placeholder={`Dimensión ${i + 1}`}
                    className="flex-1"
                  />
                  <Input
                    value={dim.items}
                    onChange={(e) => setDim(dim.id, { items: e.target.value })}
                    placeholder="Ítems"
                    className="w-24 text-center"
                  />
                  <button
                    onClick={() => setDims((prev) => (prev.length > 1 ? prev.filter((d) => d.id !== dim.id) : prev))}
                    className={cn(
                      "rounded-lg p-2 text-muted-foreground transition-all",
                      dims.length > 1 ? "hover:bg-danger/10 hover:text-danger" : "cursor-not-allowed opacity-40",
                    )}
                    title="Quitar dimensión"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <FieldHint text={`Total de ítems del instrumento: ${totalItems}. La escala de respuesta es Likert 1 a 5.`} />
          </div>

          <div>
            <span className="text-sm font-medium text-foreground">Nivel de alfa deseado</span>
            <FieldHint text="El generador ajusta la consistencia entre ítems para que el α de Cronbach caiga en el rango elegido." />
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ALPHA_LEVELS.map((lvl) => {
                const selected = nivelAlfa === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    onClick={() => setNivelAlfa(lvl.id)}
                    className={cn(
                      "rounded-xl border-2 px-3 py-2 text-left transition-all",
                      selected ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50",
                    )}
                  >
                    <span className={cn("block text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{lvl.nombre}</span>
                    <span className="block text-xs text-muted-foreground">{lvl.rango}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {issues.length > 0 && (
            <div role="alert" className="space-y-1 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
              {issues.map((msg) => (
                <p key={msg} className="flex items-start gap-2"><span className="mt-0.5 shrink-0">•</span>{msg}</p>
              ))}
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
          )}

          <MagicButton size="lg" className="h-12 w-full" onClick={handleGenerate} disabled={busy || issues.length > 0}>
            {busy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Generando la prueba...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                Generar prueba de confiabilidad
              </>
            )}
          </MagicButton>
        </CardContent>
      </Card>

      {result && (
        <Card className="step-enter rounded-2xl border-primary/30 bg-primary/5 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <Check className="h-5 w-5" />
              ¡Prueba de confiabilidad generada!
            </CardTitle>
            <CardDescription>Generado el {new Date(result.generatedAt).toLocaleString()}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-border/60 bg-background/80 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Alfa de Cronbach · {result.K} ítems · {result.encuestados} encuestados
                </p>
                {result.cumple ? (
                  <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400">
                    ✓ Dentro del nivel elegido ({result.etiqueta})
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    Fuera del rango (se aproximó lo máximo posible)
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-4xl font-bold tracking-tight text-primary">{result.alpha.toFixed(3)}</span>
                <div>
                  <span className="text-sm font-semibold text-foreground">
                    Confiabilidad {interpretacionAlfa(result.alpha).toLowerCase()}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Objetivo: {result.etiqueta} ({result.esperadoMin.toFixed(2)} a {result.esperadoMax.toFixed(2)}) · escala de George y Mallery (2003)
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Revisa la matriz de respuestas y el cálculo del alfa antes de utilizar el archivo.
              </p>
            </div>

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

            <a href={result.xlsxUrl} download={result.fileName} className="block">
              <div className="rounded-xl border-2 border-primary/40 bg-primary/10 p-4 text-center transition-all hover:border-primary hover:bg-primary/20">
                <Download className="mx-auto h-6 w-6 text-primary" />
                <p className="mt-2 text-sm font-semibold text-primary">Descargar Excel</p>
                <p className="text-xs text-muted-foreground">Hoja "Alfa de Cronbach" con fórmulas vivas</p>
              </div>
            </a>

            <div>
              <p className="mb-3 text-sm font-medium">Vista previa de la hoja</p>
              <PreviewTable rows={result.previewRows} maxRows={12} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
