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
// Tope alineado a muestras reales de tesis (hasta ~400 encuestados). Con N
// altos la respuesta de la IA es muy larga: el timeout de OpenRouter y el
// aviso de la UI ya lo contemplan.
export const MAX_N = 400;
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

// La IA no cuenta filas con exactitud (pide 60 y entrega 65-72): en vez de
// reintentar (reincide y duplica costo), el sistema reconcilia a exactamente
// N. Sobran -> se recortan; faltan -> se completan duplicando perfiles ya
// simulados (cada fila es internamente coherente y en encuestas reales los
// perfiles repetidos son normales). El deficit grave (<50%) ya lo rechazo la
// validacion antes de llegar aqui.
export const reconcileRowCount = (data, n, warnings) => {
  const rows = data.datos_simulados;
  if (rows.length === n) {
    data.metadata.n_encuestados = n;
    return;
  }
  if (rows.length > n) {
    warnings.push(`La IA entregó ${rows.length} encuestados; se conservaron los ${n} solicitados.`);
    data.datos_simulados = rows.slice(0, n);
  } else {
    const faltan = n - rows.length;
    for (let i = 0; i < faltan; i += 1) {
      rows.push({ ...rows[Math.floor(Math.random() * rows.length)] });
    }
    warnings.push(
      `La IA entregó ${n - faltan} encuestados; se completaron ${faltan} duplicando perfiles simulados para alcanzar N=${n}.`,
    );
  }
  data.metadata.n_encuestados = n;
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

  reconcileRowCount(data, input.n, warnings);

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
      if (baremoLikert.invertida) {
        warnings.push(
          "La escala está listada de mayor a menor intensidad: los códigos se invirtieron para que un puntaje alto refleje mayor intensidad.",
        );
      }
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
