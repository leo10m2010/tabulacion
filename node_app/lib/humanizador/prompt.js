// Carga y parseo del prompt maestro del Humanizador. El .md es la fuente de
// verdad (Seccion 2 = prompt de reescritura de la pasada 1, Seccion 3 =
// prompt de la repasada dirigida); se extrae por marcadores + fences, nunca
// se copia el texto a mano en JS. (Tercera repeticion de este patron —
// titulos, matriz y aqui; si aparece una cuarta, extraer modulo compartido.)
//
// IMPORTANTE (cache de prompt): ambos system prompts son ESTATICOS. El texto
// del cliente viaja en el mensaje user ("TEXTO A REESCRIBIR" / "TEXTO
// ACTUAL", ver openrouter.js).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(SCRIPT_DIR, "..", "..", "prompts", "prompt_maestro_humanizador.md");

const extractSection = (raw, startMarker, endMarker) => {
  const start = raw.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`No se encontro la seccion "${startMarker}" en el prompt maestro del humanizador.`);
  }
  const rest = raw.slice(start + startMarker.length);
  const end = rest.indexOf(endMarker);
  return end >= 0 ? rest.slice(0, end) : rest;
};

const extractFencedBlock = (segment, sectionLabel) => {
  const match = segment.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!match) {
    throw new Error(`No se encontro un bloque de codigo en la seccion "${sectionLabel}" del prompt maestro del humanizador.`);
  }
  return match[1].replace(/\s+$/, "");
};

let cached = null;

export const loadHumanizadorPrompts = () => {
  if (cached) return cached;
  const raw = fs.readFileSync(PROMPT_PATH, "utf-8");

  const reescrituraSegment = extractSection(raw, "## 2. PROMPT DE REESCRITURA", "## 3.");
  const repasadaSegment = extractSection(raw, "## 3. PROMPT DE REPASADA DIRIGIDA", "## 4.");

  cached = {
    reescrituraPrompt: extractFencedBlock(reescrituraSegment, "2. PROMPT DE REESCRITURA"),
    repasadaPrompt: extractFencedBlock(repasadaSegment, "3. PROMPT DE REPASADA DIRIGIDA"),
  };
  return cached;
};

// System prompts ESTATICOS de cada pasada (100% cacheables).
export const buildReescrituraSystemPrompt = () => loadHumanizadorPrompts().reescrituraPrompt;
export const buildRepasadaSystemPrompt = () => loadHumanizadorPrompts().repasadaPrompt;
