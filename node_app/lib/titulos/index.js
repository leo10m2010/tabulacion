// Orquestador del Generador de Titulos de Investigacion: valida el input del
// formulario (universidad, carrera, lugar, numero_variables, anio opcional),
// arma el system prompt interpolado con la plantilla que corresponda y hace
// UNA llamada a OpenRouter (GLM-5.2 + openrouter:web_search).
import { buildSystemPrompt } from "./prompt.js";
import { buildAllowedDomains } from "./universities.js";
import { requestTitulos } from "./openrouter.js";

const MAX_TEXT_LENGTH = 200;

const requireNonEmptyText = (value, label) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new Error(`${label} es obligatorio.`);
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} no puede superar ${MAX_TEXT_LENGTH} caracteres.`);
  }
  return trimmed;
};

// Acepta camelCase o snake_case para numero_variables/anio (el frontend usa
// el contrato snake_case, pero se tolera el otro por si un integrador externo
// envia camelCase).
export const normalizeTitulosInput = (payload) => {
  const universidad = requireNonEmptyText(payload?.universidad, "La universidad");
  const carrera = requireNonEmptyText(payload?.carrera, "La carrera");
  const lugar = requireNonEmptyText(payload?.lugar, "El lugar");

  const numeroVariablesRaw = String(payload?.numero_variables ?? payload?.numeroVariables ?? "").trim();
  if (!["1", "2"].includes(numeroVariablesRaw)) {
    throw new Error('El numero de variables debe ser "1" (descriptiva) o "2" (correlacional).');
  }

  let anio = String(payload?.anio ?? "").trim();
  if (anio) {
    const anioNum = Number(anio);
    if (!/^\d{4}$/.test(anio) || !Number.isFinite(anioNum) || anioNum < 2000 || anioNum > 2100) {
      throw new Error("El año debe tener 4 dígitos y estar entre 2000 y 2100.");
    }
  } else {
    anio = "";
  }

  return {
    universidad, carrera, lugar, numeroVariables: numeroVariablesRaw, anio,
  };
};

// Genera los 3 titulos: valida, arma el system prompt final y llama a la IA.
// Devuelve el markdown crudo (el frontend lo renderiza) y, si viene, el
// numero de busquedas web usadas (monitoreo de costo).
export const generateTitulos = async (payload, options = {}) => {
  const input = normalizeTitulosInput(payload);
  const systemPrompt = buildSystemPrompt(input);
  const allowedDomains = buildAllowedDomains(input.universidad);

  const { content, webSearchRequests } = await requestTitulos({
    systemPrompt,
    allowedDomains,
    options,
  });

  return {
    contenido: content,
    webSearchRequests: webSearchRequests ?? null,
  };
};
