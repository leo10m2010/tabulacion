// Orquestador de Tabulacion Descriptiva: input del usuario (texto o .docx)
// -> markdown limpio -> JSON de simulacion (OpenRouter GLM-5.2, con reintento
// y validacion estructural) -> capa calculada por el sistema -> Excel final.
import { CHART_THEMES } from "../config.js";
import { postProcessWorkbook } from "../ooxml.js";
import { docxToMarkdown } from "./docx.js";
import { requestSimulationJson } from "./openrouter.js";
import { validateSimulation } from "./validate.js";
import {
  computeAciertos, computeLikertPuntajes, computePuntajes, detectLikertBaremo,
} from "./compute.js";
import { buildDescriptivaWorkbook } from "./workbook.js";

// N por defecto que el backend fija via linea de configuracion (decision de
// producto: el default de 200 del prompt es demasiado lento/costoso para el
// flujo web; el usuario puede subirlo desde la configuracion avanzada).
export const DEFAULT_N = 60;
export const MIN_N = 10;
export const MAX_N = 200;
export const NIVELES_PREPONDERANCIA = ["ALTO", "MODERADO", "LEVE"];

export const normalizeDescriptivaInput = (payload) => {
  const texto = String(payload?.texto ?? "").trim();
  const docxBase64 = String(payload?.docxBase64 ?? "").trim();
  if (!texto && !docxBase64) {
    throw new Error("Pega tu cuestionario o sube un archivo .docx.");
  }
  if (texto && docxBase64) {
    throw new Error("Envia solo el texto pegado o solo el archivo .docx, no ambos.");
  }

  const cfg = payload?.config ?? {};
  let n = Number.parseInt(String(cfg.n ?? ""), 10);
  if (!Number.isFinite(n)) n = DEFAULT_N;
  n = Math.min(MAX_N, Math.max(MIN_N, n));

  let nivel = String(cfg.nivel ?? "").trim().toUpperCase();
  if (nivel && !NIVELES_PREPONDERANCIA.includes(nivel)) nivel = "";

  return { texto, docxBase64, n, nivel };
};

export const generateDescriptiva = async (payload, options = {}) => {
  const input = normalizeDescriptivaInput(payload);
  const warnings = [];

  const questionnaire = input.docxBase64 ? await docxToMarkdown(input.docxBase64) : input.texto;
  if (questionnaire.length < 30) {
    throw new Error("El cuestionario es demasiado corto; pega el instrumento completo.");
  }

  // El backend siempre fija N (ver DEFAULT_N); el nivel solo si el usuario lo
  // eligio (si no, la IA aplica su default del Paso -1).
  const configLine = `N=${input.n}${input.nivel ? `, nivel_preponderancia=${input.nivel}` : ""}`;

  const { data, attempts } = await requestSimulationJson({
    questionnaire,
    configLine,
    validate: validateSimulation,
    options,
  });
  if (attempts.length > 1) {
    warnings.push("La IA necesito un reintento para entregar un JSON valido.");
  }

  // Capa de clasificacion. Regla de negocio:
  // - Si el instrumento trae su PROPIA escala de medicion (puntos o
  //   respuestas correctas), se usa esa y nada mas.
  // - Si no la trae, el sistema genera baremo UNICAMENTE cuando el
  //   cuestionario es medible con escala Likert (ordinal, 3+ categorias
  //   compartidas). Con escalas dicotomicas o nominales no hay baremo.
  const tipo = data.metadata.tipo_instrumento;
  let computed = null;
  let baremoLikert = null;
  if (tipo === "puntaje_sumado") {
    computed = computePuntajes(data.preguntas, data.datos_simulados, data.baremo);
  } else if (tipo === "conocimiento") {
    computed = computeAciertos(data.preguntas, data.datos_simulados, data.baremo);
  } else {
    baremoLikert = detectLikertBaremo(data);
    if (baremoLikert) {
      computed = computeLikertPuntajes(baremoLikert, data.datos_simulados);
      warnings.push(
        `El instrumento no trae baremo propio, pero es medible con escala Likert: se construyó una clasificación `
        + `Bajo/Medio/Alto sumando ${baremoLikert.itemIds.length} ítems ordinales (escala 1 a ${baremoLikert.escala.length}).`,
      );
    }
  }
  if (computed) {
    const sinClasificar = computed.filter((c) => c.clasificacion === "Sin clasificar").length;
    if (sinClasificar > 0) {
      warnings.push(
        `${sinClasificar} encuestado(s) quedaron fuera de los rangos del baremo declarado ("Sin clasificar").`,
      );
    }
  }

  const { workbook, sheetCharts } = await buildDescriptivaWorkbook(data, computed, baremoLikert);
  const plainBuffer = await workbook.outputAsync({ type: "nodebuffer" });
  const excelBuffer = await postProcessWorkbook(plainBuffer, sheetCharts, CHART_THEMES.clasico.colores);

  return {
    excelBuffer,
    warnings,
    resumen: {
      tituloEstudio: data.metadata.titulo_estudio,
      tipoInstrumento: tipo,
      nEncuestados: data.datos_simulados.length,
      preguntas: data.preguntas.length,
      conBaremo: computed !== null,
      baremoOrigen: tipo !== "independiente" ? "instrumento" : baremoLikert ? "likert" : null,
    },
  };
};
