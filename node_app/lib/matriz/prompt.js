// Carga y parseo del prompt maestro de la Matriz de Consistencia.
// El .md es la fuente de verdad (Seccion 2 = prompt de analisis de la Etapa
// 1, Seccion 3 = prompt de redaccion de la Etapa 2); se extrae por marcadores
// de encabezado + fences de codigo, nunca se copia el texto a mano en JS.
//
// IMPORTANTE (cache de prompt): ambos system prompts son ESTATICOS — no se
// interpola ningun dato del cliente. El titulo y los campos opcionales van en
// el mensaje user ("DATOS DEL ESTUDIANTE", ver openrouter.js), igual que en
// el Generador de Titulos.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(SCRIPT_DIR, "..", "..", "prompts", "prompt_maestro_matriz_consistencia.md");

// Devuelve el texto entre startMarker y endMarker (o hasta el final si no
// aparece endMarker).
const extractSection = (raw, startMarker, endMarker) => {
  const start = raw.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`No se encontro la seccion "${startMarker}" en el prompt maestro de matriz.`);
  }
  const rest = raw.slice(start + startMarker.length);
  const end = rest.indexOf(endMarker);
  return end >= 0 ? rest.slice(0, end) : rest;
};

// Extrae el primer bloque de codigo fenced (``` ... ```) dentro del segmento.
const extractFencedBlock = (segment, sectionLabel) => {
  const match = segment.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!match) {
    throw new Error(`No se encontro un bloque de codigo en la seccion "${sectionLabel}" del prompt maestro de matriz.`);
  }
  return match[1].replace(/\s+$/, "");
};

let cached = null;

// Parsea el .md y cachea el resultado (prompt de analisis + de redaccion).
export const loadMatrizPrompts = () => {
  if (cached) return cached;
  const raw = fs.readFileSync(PROMPT_PATH, "utf-8");

  const analisisSegment = extractSection(raw, "## 2. PROMPT DE ANÁLISIS", "## 3.");
  const redaccionSegment = extractSection(raw, "## 3. PROMPT DE REDACCIÓN", "## 4.");

  cached = {
    analisisPrompt: extractFencedBlock(analisisSegment, "2. PROMPT DE ANÁLISIS"),
    redaccionPrompt: extractFencedBlock(redaccionSegment, "3. PROMPT DE REDACCIÓN"),
  };
  return cached;
};

export const currentYear = () => new Date().getFullYear();

// System prompts ESTATICOS de cada etapa (100% cacheables).
export const buildAnalisisSystemPrompt = () => loadMatrizPrompts().analisisPrompt;
export const buildRedaccionSystemPrompt = () => loadMatrizPrompts().redaccionPrompt;
