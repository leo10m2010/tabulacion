import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ClipboardType, FileText, Upload, Wand2, X } from "lucide-react";
import { cn } from "../lib/utils";
import { springSoft } from "./motion-primitives";

// Zona de entrada de texto con soporte de .docx: barra superior con los dos
// modos (pegar texto / subir Word), textarea integrado sin borde propio,
// contador en vivo y pie con la pista de arrastre. El estado y la validación
// del archivo viven en el padre; aquí solo la presentación e interacción.
export function TextDropZone({
  value,
  onChange,
  file,
  onFile,
  onClearFile,
  disabled = false,
  placeholder,
  stats,
  footerHint,
  example,
  fileNote,
  minHeightClass = "min-h-[240px]",
}: {
  value: string;
  onChange: (next: string) => void;
  file: File | null;
  onFile: (file: File | null | undefined) => void;
  onClearFile: () => void;
  disabled?: boolean;
  placeholder: string;
  stats?: ReactNode;
  footerHint: string;
  example?: { label: string; text: string };
  fileNote: string;
  minHeightClass?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draggingRef = useRef(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!draggingRef.current) {
          draggingRef.current = true;
          e.currentTarget.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
        }
      }}
      onDragLeave={(e) => {
        draggingRef.current = false;
        e.currentTarget.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
      }}
      onDrop={(e) => {
        e.preventDefault();
        draggingRef.current = false;
        e.currentTarget.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
        onFile(e.dataTransfer.files?.[0]);
      }}
      className="rounded-xl transition-shadow duration-200"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <AnimatePresence mode="wait" initial={false}>
        {file ? (
          <motion.div
            key="file"
            initial={reduce ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.97 }}
            transition={springSoft}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-6 py-8 text-center",
              minHeightClass,
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <FileText className="h-6 w-6 text-primary" />
            </span>
            <div>
              <p className="text-sm font-semibold">{file.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB · {fileNote}
              </p>
            </div>
            <button
              onClick={onClearFile}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <X className="h-3.5 w-3.5" />
              Quitar y pegar texto
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="texto"
            initial={reduce ? false : { opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={springSoft}
            className={cn(
              "overflow-hidden rounded-xl border border-input bg-background transition-colors",
              "focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/25",
              !disabled && "hover:border-muted-foreground/40 focus-within:hover:border-primary",
            )}
          >
            {/* Barra superior: modos + contador en vivo */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-2.5 py-2">
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm">
                  <ClipboardType className="h-3.5 w-3.5 text-primary" />
                  Pegar texto
                </span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Subir Word
                </button>
              </div>
              {stats && (
                <div className="flex items-center gap-2 pr-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {stats}
                </div>
              )}
            </div>

            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              placeholder={placeholder}
              className={cn(
                "block w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-60",
                minHeightClass,
              )}
            />

            {/* Pie: pista de arrastre + ejemplo insertable */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border/70 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">{footerHint}</p>
              {example && value.trim().length === 0 && (
                <button
                  onClick={() => {
                    onChange(example.text);
                    textareaRef.current?.focus();
                  }}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground transition-all hover:border-primary/60 active:scale-95 disabled:opacity-50"
                >
                  <Wand2 className="h-3 w-3" />
                  {example.label}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
