// Carga y parseo del prompt maestro del Generador de Titulos de Investigacion.
// El .md es la fuente de verdad (Seccion 2 = prompt de sistema, Seccion 3 =
// Plantilla A correlacional, Seccion 4 = Plantilla B descriptiva); se extrae
// por marcadores de encabezado + fences de codigo, nunca se copia el texto a
// mano en JS (asi el .md se puede editar sin tocar codigo).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(SCRIPT_DIR, "..", "..", "prompts", "prompt_maestro_generador_titulos.md");

// Devuelve el texto entre startMarker y endMarker (o hasta el final si no
// aparece endMarker).
const extractSection = (raw, startMarker, endMarker) => {
  const start = raw.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`No se encontro la seccion "${startMarker}" en el prompt maestro de titulos.`);
  }
  const rest = raw.slice(start + startMarker.length);
  const end = rest.indexOf(endMarker);
  return end >= 0 ? rest.slice(0, end) : rest;
};

// Extrae el primer bloque de codigo fenced (``` ... ```) dentro del segmento.
const extractFencedBlock = (segment, sectionLabel) => {
  const match = segment.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!match) {
    throw new Error(`No se encontro un bloque de codigo en la seccion "${sectionLabel}" del prompt maestro de titulos.`);
  }
  // Se recorta solo el espacio final (los saltos de linea internos importan
  // para el formato del prompt).
  return match[1].replace(/\s+$/, "");
};

let cached = null;

// Parsea el .md y cachea el resultado (system prompt + ambas plantillas).
export const loadTitulosPrompts = () => {
  if (cached) return cached;
  const raw = fs.readFileSync(PROMPT_PATH, "utf-8");

  const systemSegment = extractSection(raw, "## 2. PROMPT DE SISTEMA", "## 3.");
  const plantillaASegment = extractSection(raw, "## 3. PLANTILLA A", "## 4.");
  const plantillaBSegment = extractSection(raw, "## 4. PLANTILLA B", "## 5.");

  cached = {
    systemPrompt: extractFencedBlock(systemSegment, "2. PROMPT DE SISTEMA"),
    plantillaA: extractFencedBlock(plantillaASegment, "3. PLANTILLA A"),
    plantillaB: extractFencedBlock(plantillaBSegment, "4. PLANTILLA B"),
  };
  return cached;
};

// Reemplazo global simple (split/join, sin regex): las claves de interpolar
// son fijas y no traen caracteres especiales de regex.
export const interpolate = (template, vars) => {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
};

export const currentYear = () => new Date().getFullYear();

// Arma el system prompt final: interpola los placeholders del prompt de
// sistema y le adjunta SOLO la plantilla que corresponde segun
// numero_variables ("2" = Plantilla A correlacional con hipotesis; "1" =
// Plantilla B descriptiva, sin hipotesis). Si el anio viene vacio, se usa el
// anio actual del sistema ANTES de interpolar.
export const buildSystemPrompt = ({ universidad, carrera, lugar, numeroVariables, anio }) => {
  const { systemPrompt, plantillaA, plantillaB } = loadTitulosPrompts();
  const anioFinal = String(anio ?? "").trim() || String(currentYear());
  const vars = {
    universidad, carrera, lugar, numero_variables: numeroVariables, anio: anioFinal,
  };

  const interpolatedSystem = interpolate(systemPrompt, vars);
  const esCorrelacional = numeroVariables === "2";
  const plantilla = esCorrelacional ? plantillaA : plantillaB;
  const interpolatedPlantilla = interpolate(plantilla, vars);
  const etiqueta = esCorrelacional
    ? "PLANTILLA A — estructura obligatoria de cada título:"
    : "PLANTILLA B — estructura obligatoria de cada título:";

  return `${interpolatedSystem}\n\n${etiqueta}\n\n${interpolatedPlantilla}`;
};
