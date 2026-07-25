import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, HelpCircle, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import type { DimensionDef } from "../lib/types";
import { eid, normalizeList } from "../lib/helpers";

// ─── Sub-components ──────────────────────────────────────────────────────────

export function FieldHint({ text }: { text: string }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
      <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
      {text}
    </p>
  );
}

export function StepTip({ icon, label, detail, color = "primary" }: { icon: React.ReactNode; label: string; detail?: string; color?: "primary" | "green" | "amber" }) {
  const styles = {
    primary: "border-primary/25 bg-primary/8 text-primary",
    green: "border-emerald-500/25 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400",
    amber: "border-amber-500/25 bg-amber-500/8 text-amber-600 dark:text-amber-400",
  } as const;
  return (
    <div className={cn("mt-2 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5", styles[color])}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <span className="text-sm font-semibold">{label}</span>
        {detail && <span className="ml-1.5 text-sm opacity-75">{detail}</span>}
      </div>
    </div>
  );
}

export function ListEditorField({
  label,
  placeholder,
  values,
  onChange,
  isPercentage = false,
  rowLabels = [],
  readOnly = false,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  isPercentage?: boolean;
  rowLabels?: string[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<string[]>(() => values.length > 0 ? [...values] : [""]);
  const [rowKeys, setRowKeys] = useState<string[]>(() => (values.length > 0 ? values : [""]).map(() => eid()));
  const prevValuesRef = useRef<string[]>(values);

  // Sync from parent when config changes externally (e.g. reset)
  useEffect(() => {
    const prev = prevValuesRef.current;
    const changed = prev.length !== values.length || values.some((v, i) => v !== prev[i]);
    if (!changed) return;
    prevValuesRef.current = [...values];
    const newRows = values.length > 0 ? [...values] : [""];
    // Si el cambio es solo el eco del último cambio local (el padre normaliza
    // o rellena la lista), no tocar nada: regenerar filas/keys desmonta los
    // inputs y roba el foco mientras el usuario escribe o borra.
    const echoOfLocal = newRows.length === rows.length && newRows.every((v, i) => v === rows[i]);
    if (echoOfLocal) return;
    setRows(newRows);
    // Cambio externo real (reset, auto-cálculo, cambio de niveles): conservar
    // las keys de las filas que sobreviven para no perder el foco.
    setRowKeys((prevKeys) => newRows.map((_, i) => prevKeys[i] ?? eid()));
  }, [values, rows]);

  const editableSum = isPercentage && rows.length > 1
    ? rows.slice(0, -1).reduce((acc, v) => { const n = parseInt(v.trim(), 10); return Number.isFinite(n) ? acc + n : acc; }, 0)
    : 0;
  const overLimit = isPercentage && rows.length > 1 && editableSum > 100;

  const applyAutoLast = (vals: string[]): string[] => {
    if (vals.length < 2) return vals;
    const sum = vals.slice(0, -1).reduce((acc, v) => {
      const n = parseInt(v.trim(), 10);
      return Number.isFinite(n) ? acc + n : acc;
    }, 0);
    const result = [...vals];
    result[result.length - 1] = String(Math.max(0, 100 - sum));
    return result;
  };

  const push = (vals: string[]) => onChange(normalizeList(vals));

  const updateAt = (index: number, val: string) => {
    const next = [...rows];
    next[index] = val;
    const final = isPercentage ? applyAutoLast(next) : next;
    setRows(final);
    push(final);
  };

  const removeAt = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    const safe = next.length > 0 ? next : [""];
    const final = isPercentage ? applyAutoLast(safe) : safe;
    setRows(final);
    setRowKeys((prev) => {
      const f = prev.filter((_, i) => i !== index);
      return f.length > 0 ? f : [eid()];
    });
    push(final);
  };

  const agregar = () => {
    let next: string[];
    if (isPercentage) {
      // Insert new editable field before the auto-calc last, recalculate last
      next = applyAutoLast([...rows.slice(0, -1), "0", rows[rows.length - 1]]);
      setRowKeys((prev) => [...prev.slice(0, -1), eid(), prev[prev.length - 1]]);
    } else {
      next = [...rows, ""];
      setRowKeys((prev) => [...prev, eid()]);
    }
    setRows(next);
    push(next);
  };

  const filledSum = rows.reduce((acc, v) => {
    const n = parseInt(v.trim(), 10);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);

  return (
    <div className="rounded-md border border-border/80 bg-background/70 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{label}{readOnly && <span className="ml-2 text-xs font-normal text-muted-foreground">(calculado automáticamente)</span>}</h4>
        {!readOnly && <Button variant="ghost" size="sm" onClick={agregar}>+ Agregar</Button>}
      </div>
      <div className="space-y-2">
        {rows.map((value, index) => {
          const isAutoCalc = isPercentage && rows.length > 1 && index === rows.length - 1;
          const effectiveReadOnly = readOnly || isAutoCalc;
          const n = parseInt(value.trim(), 10);
          const fieldNotNumeric = isPercentage && !isAutoCalc && value.trim() !== "" && !Number.isFinite(n);
          const fieldInvalid = isPercentage && !isAutoCalc && Number.isFinite(n) && n > 100;
          return (
            <div key={rowKeys[index] ?? `${label}-${index}`}>
              <div className="flex items-center gap-2">
                {rowLabels[index] && (
                  <span className="w-16 shrink-0 rounded bg-muted px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">
                    {rowLabels[index]}
                  </span>
                )}
                <Input
                  value={value}
                  placeholder={effectiveReadOnly ? "Auto" : placeholder}
                  readOnly={effectiveReadOnly}
                  onChange={(e) => updateAt(index, e.target.value)}
                  className={cn(
                    effectiveReadOnly && "cursor-not-allowed bg-muted/50 text-muted-foreground",
                    (fieldInvalid || fieldNotNumeric) && "border-danger focus-visible:ring-danger",
                  )}
                />
                {rowLabels.length === 0 && !readOnly && (
                  <Button variant="outline" size="sm" onClick={() => removeAt(index)}>
                    Quitar
                  </Button>
                )}
              </div>
              {fieldNotNumeric && <p className="mt-1 text-xs text-danger">Debe ser un número</p>}
              {fieldInvalid && <p className="mt-1 text-xs text-danger">Máximo 100%</p>}
              {isAutoCalc && <p className="mt-1 text-xs text-muted-foreground">Se calcula solo para que todo sume 100%</p>}
            </div>
          );
        })}
      </div>
      {isPercentage && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className={cn(overLimit ? "text-danger" : filledSum === 100 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400")}>
              Total: {filledSum}%
            </span>
            {overLimit && <span className="text-danger">Los valores superan 100%</span>}
            {!overLimit && filledSum < 100 && filledSum > 0 && (
              <span className="text-amber-600 dark:text-amber-400">Faltan {100 - filledSum}% — el último se ajusta solo</span>
            )}
            {filledSum === 100 && <span className="text-green-600 dark:text-green-400">✓ Completo</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function HierarchyEditor({
  label,
  totalItems,
  estructura,
  onChange,
}: {
  label: string;
  totalItems: number;
  estructura: DimensionDef[];
  onChange: (next: DimensionDef[]) => void;
}) {
  const [collapsedDims, setCollapsedDims] = useState<Set<string>>(new Set());
  const [collapsedInds, setCollapsedInds] = useState<Set<string>>(new Set());

  const usedItems = estructura.flatMap((d) => d.indicadores.flatMap((i) => i.items)).length;
  const isComplete = totalItems > 0 && usedItems === totalItems;

  const toggleDim = (id: string) => setCollapsedDims((prev) => { const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next; });
  const toggleInd = (id: string) => setCollapsedInds((prev) => { const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next; });

  const addDimension = () => onChange([...estructura, { id: eid(), nombre: "", indicadores: [] }]);
  const removeDimension = (id: string) => onChange(estructura.filter((d) => d.id !== id));
  const updateDimensionName = (id: string, nombre: string) => onChange(estructura.map((d) => d.id === id ? { ...d, nombre } : d));

  const addIndicador = (dimId: string) => onChange(estructura.map((d) =>
    d.id === dimId ? { ...d, indicadores: [...d.indicadores, { id: eid(), nombre: "", items: [] }] } : d));
  const removeIndicador = (dimId: string, indId: string) => onChange(estructura.map((d) =>
    d.id === dimId ? { ...d, indicadores: d.indicadores.filter((i) => i.id !== indId) } : d));
  const updateIndicadorName = (dimId: string, indId: string, nombre: string) => onChange(estructura.map((d) =>
    d.id === dimId ? { ...d, indicadores: d.indicadores.map((i) => i.id === indId ? { ...i, nombre } : i) } : d));

  const addItem = (dimId: string, indId: string) => onChange(estructura.map((d) =>
    d.id === dimId ? { ...d, indicadores: d.indicadores.map((i) =>
      i.id === indId ? { ...i, items: [...i.items, { id: eid(), nombre: "" }] } : i) } : d));
  const removeItem = (dimId: string, indId: string, itemId: string) => onChange(estructura.map((d) =>
    d.id === dimId ? { ...d, indicadores: d.indicadores.map((i) =>
      i.id === indId ? { ...i, items: i.items.filter((it) => it.id !== itemId) } : i) } : d));
  const updateItemName = (dimId: string, indId: string, itemId: string, nombre: string) => onChange(estructura.map((d) =>
    d.id === dimId ? { ...d, indicadores: d.indicadores.map((i) =>
      i.id === indId ? { ...i, items: i.items.map((it) => it.id === itemId ? { ...it, nombre } : it) } : i) } : d));

  return (
    <div className="space-y-2">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{label}</span>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold",
            isComplete ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
              : usedItems > totalItems ? "bg-danger/15 text-danger"
              : "bg-muted text-muted-foreground",
          )}>
            {usedItems}/{totalItems} ítems{usedItems > totalItems ? " — demasiados" : ""}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={addDimension}>+ Dimensión</Button>
      </div>

      {estructura.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Sin dimensiones. Añade la primera con el botón de arriba.
        </p>
      )}

      {estructura.map((dim, dimIdx) => {
        const dimCollapsed = collapsedDims.has(dim.id);
        const itemsBeforeDim = estructura.slice(0, dimIdx).reduce((sum, d) =>
          sum + d.indicadores.reduce((s, i) => s + i.items.length, 0), 0);
        return (
          <div key={dim.id} className="rounded-lg border border-border/80 bg-background/70">
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => toggleDim(dim.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
                <ChevronDown className={cn("h-4 w-4 transition-transform", dimCollapsed && "-rotate-90")} />
              </button>
              <span className="w-6 shrink-0 text-center text-xs font-semibold text-muted-foreground">D{dimIdx + 1}</span>
              <Input value={dim.nombre} placeholder={`Ej: Gestión administrativa, Satisfacción del usuario…`} onChange={(e) => updateDimensionName(dim.id, e.target.value)} className="h-8 flex-1 text-sm" />
              <Button variant="ghost" size="sm" onClick={() => removeDimension(dim.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-danger">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {!dimCollapsed && (
              <div className="ml-6 space-y-2 border-t border-border/60 px-3 pb-3 pt-2">
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => addIndicador(dim.id)}>+ Indicador</Button>
                </div>
                {dim.indicadores.length === 0 && (
                  <p className="py-1 text-center text-xs text-muted-foreground">Sin indicadores en esta dimensión.</p>
                )}
                {dim.indicadores.map((ind, indIdx) => {
                  const indCollapsed = collapsedInds.has(ind.id);
                  const itemsBeforeInd = dim.indicadores.slice(0, indIdx).reduce((sum, i) => sum + i.items.length, 0);
                  return (
                    <div key={ind.id} className="rounded-md border border-border/60 bg-muted/20">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button type="button" onClick={() => toggleInd(ind.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
                          <ChevronDown className={cn("h-4 w-4 transition-transform", indCollapsed && "-rotate-90")} />
                        </button>
                        <span className="w-6 shrink-0 text-center text-xs font-semibold text-muted-foreground">I{indIdx + 1}</span>
                        <Input value={ind.nombre} placeholder={`Ej: Planificación, Transparencia, Cumplimiento…`} onChange={(e) => updateIndicadorName(dim.id, ind.id, e.target.value)} className="h-8 flex-1 text-sm" />
                        <Button variant="ghost" size="sm" onClick={() => removeIndicador(dim.id, ind.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-danger">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {!indCollapsed && (
                        <div className="ml-6 space-y-1.5 border-t border-border/60 px-3 pb-3 pt-2">
                          <div className="flex justify-end">
                            <Button variant="outline" size="sm" onClick={() => addItem(dim.id, ind.id)}>+ Ítem</Button>
                          </div>
                          {ind.items.length === 0 && (
                            <p className="py-1 text-center text-xs text-muted-foreground">Sin ítems en este indicador.</p>
                          )}
                          {ind.items.map((item, itemIdx) => {
                            const globalNum = itemsBeforeDim + itemsBeforeInd + itemIdx + 1;
                            return (
                              <div key={item.id} className="flex items-center gap-2">
                                <span className="w-7 shrink-0 text-center text-xs font-semibold text-muted-foreground">P{globalNum}</span>
                                <Input value={item.nombre} placeholder={`Pregunta ${globalNum}`} onChange={(e) => updateItemName(dim.id, ind.id, item.id, e.target.value)} className="h-8 flex-1 text-sm" />
                                <Button variant="ghost" size="sm" onClick={() => removeItem(dim.id, ind.id, item.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-danger">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

