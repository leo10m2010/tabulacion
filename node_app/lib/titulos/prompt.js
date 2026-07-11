// Carga y parseo del prompt maestro del Generador de Titulos de Investigacion.
// El .md es la fuente de verdad (Seccion 2 = prompt de sistema, Seccion 3 =
// Plantilla A correlacional, Seccion 4 = Plantilla B descriptiva); se extrae
// por marcadores de encabezado + fences de codigo, nunca se copia el texto a
// mano en JS (asi el .md se puede editar sin tocar codigo).
//
// IMPORTANTE (cache de prompt): el system prompt es ESTATICO — no se
// interpola ningun dato del cliente. Los datos van en el mensaje user
// ("DATOS DEL ESTUDIANTE", ver openrouter.js). Con el prefijo identico en
// todas las solicitudes, el cache implicito del proveedor (cached_tokens)
// aplica entre clientes distintos y abarata los tokens de entrada. Las
// plantillas conservan sus placeholders literales ({{anio}}, [lugar]): el
// modelo los reemplaza segun las instrucciones del PASO 3, y el codigo
// valida que no quede "{{" en la respuesta final.
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
  const seleccionSegment = extractSection(raw, "## 6. PROMPT DE SELECCIÓN", "## 7.");

  cached = {
    systemPrompt: extractFencedBlock(systemSegment, "2. PROMPT DE SISTEMA"),
    plantillaA: extractFencedBlock(plantillaASegment, "3. PLANTILLA A"),
    plantillaB: extractFencedBlock(plantillaBSegment, "4. PLANTILLA B"),
    seleccionPrompt: extractFencedBlock(seleccionSegment, "6. PROMPT DE SELECCIÓN"),
  };
  return cached;
};

export const currentYear = () => new Date().getFullYear();

// System prompt ESTATICO de la Etapa 1 (seleccion de variables) del flujo en
// dos etapas: no lleva plantilla ni datos del cliente, es identico en todas
// las solicitudes (100% cacheable).
export const buildSeleccionSystemPrompt = () => loadTitulosPrompts().seleccionPrompt;

// Arma el system prompt final ESTATICO: instrucciones + SOLO la plantilla
// que corresponde segun numero_variables ("2" = Plantilla A correlacional
// con hipotesis; "1" = Plantilla B descriptiva, sin hipotesis). Solo existen
// dos variantes posibles del system prompt, ambas 100% cacheables.
export const buildSystemPrompt = (numeroVariables) => {
  const { systemPrompt, plantillaA, plantillaB } = loadTitulosPrompts();
  const esCorrelacional = numeroVariables === "2";
  const plantilla = esCorrelacional ? plantillaA : plantillaB;
  const etiqueta = esCorrelacional
    ? "PLANTILLA A — estructura obligatoria de cada título:"
    : "PLANTILLA B — estructura obligatoria de cada título:";

  return `${systemPrompt}\n\n${etiqueta}\n\n${plantilla}`;
};
