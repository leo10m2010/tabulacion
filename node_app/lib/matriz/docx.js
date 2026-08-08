// Construye el .docx de la Matriz de Consistencia 100% por codigo (misma
// filosofia del repo: nada de plantillas binarias). A diferencia de titulos,
// aqui NO se parsea markdown: la matriz llega como JSON validado
// (parseMatriz) y la tabla se arma de forma determinista. El documento es A4
// APAISADO (la matriz tiene 4-5 columnas con celdas multilinea).
import {
  AlignmentType,
  BorderStyle,
  convertMillimetersToTwip,
  Document,
  ExternalHyperlink,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { errorLogFields, structuredLog } from "../observability.js";

const AZUL_OSCURO = "1F3864";
const GRIS_TEXTO = "595959";
const GRIS_BORDE = "BFBFBF";
const AZUL_LINK = "0563C1";
const SHADING_HEADER = "EDF2F9";

const FONT = "Calibri";
const SIZE_CELDA = 18; // 9pt: la matriz apaisada debe caber comoda
const SIZE_FUENTE = 16; // 8pt para la URL de la fuente
const SIZE_TITULO_DOC = 32; // 16pt
const SIZE_SUBTITULO = 22; // 11pt

// Ancho util A4 apaisado: 297mm - 2x15mm de margen = 267mm ~= 15120 twips.
// Anchos ABSOLUTOS + layout FIXED (los porcentajes colapsan en Word Online,
// leccion aprendida en lib/titulos/docx.js).
const TABLE_WIDTH_DXA = 15120;
// 5 columnas (correlacional/explicativa): problemas, objetivos, hipotesis,
// variables y dimensiones, metodologia.
const WIDTHS_5 = [3200, 3200, 3200, 2600, 2920];
// 4 columnas (descriptiva, sin hipotesis).
const WIDTHS_4 = [3900, 3900, 3320, 4000];

const makeRun = (text, extra = {}) => new TextRun({
  text, font: FONT, size: extra.size ?? SIZE_CELDA, ...extra,
});

// Parrafos de celda: etiqueta en negrita, texto normal y vinieta.
const cellLabel = (text, { first = false } = {}) => new Paragraph({
  spacing: { before: first ? 0 : 160, after: 60 },
  children: [makeRun(text, { bold: true })],
});

const cellText = (text) => new Paragraph({
  spacing: { after: 80 },
  children: [makeRun(String(text ?? ""))],
});

const cellBullet = (text) => new Paragraph({
  bullet: { level: 0 },
  spacing: { after: 60 },
  children: [makeRun(String(text ?? ""))],
});

const cellSourceLink = (url) => new Paragraph({
  spacing: { before: 40, after: 80 },
  children: [
    new ExternalHyperlink({
      link: url,
      children: [new TextRun({
        text: url, font: FONT, size: SIZE_FUENTE, color: AZUL_LINK, underline: {},
      })],
    }),
  ],
});

const borders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE },
  left: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE },
  right: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE },
};

const headerCell = (text, widthDxa) => new TableCell({
  width: { size: widthDxa, type: WidthType.DXA },
  shading: { type: ShadingType.CLEAR, fill: SHADING_HEADER },
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 100, bottom: 100, left: 120, right: 120 },
  borders,
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [makeRun(text, { bold: true, color: AZUL_OSCURO })],
  })],
});

const contentCell = (paragraphs, widthDxa) => new TableCell({
  width: { size: widthDxa, type: WidthType.DXA },
  verticalAlign: VerticalAlign.TOP,
  margins: { top: 100, bottom: 100, left: 120, right: 120 },
  borders,
  children: paragraphs.length > 0 ? paragraphs : [cellText("")],
});

// ── Contenido de cada columna ───────────────────────────────────────────────
const buildSeccionParagraphs = (seccion, labelGeneral, labelEspecificos) => {
  const out = [cellLabel(labelGeneral, { first: true }), cellText(seccion.general)];
  if (seccion.especificos.length > 0) {
    out.push(cellLabel(labelEspecificos));
    for (const item of seccion.especificos) out.push(cellBullet(item));
  }
  return out;
};

const buildHipotesisParagraphs = (hipotesis) => {
  const out = [
    cellLabel("Hipótesis general:", { first: true }),
    cellText(hipotesis.general),
    cellLabel("Hipótesis nula:"),
    cellText(hipotesis.nula),
  ];
  if (hipotesis.especificas.length > 0) {
    out.push(cellLabel("Hipótesis específicas:"));
    for (const item of hipotesis.especificas) out.push(cellBullet(item));
  }
  return out;
};

const rolLabel = (rol, index, total) => {
  const cleanRol = String(rol ?? "").trim();
  if (cleanRol) return cleanRol.charAt(0).toUpperCase() + cleanRol.slice(1);
  return total > 1 ? `Variable ${index + 1}` : "Variable";
};

const buildVariablesParagraphs = (variables) => {
  const out = [];
  variables.forEach((variable, i) => {
    out.push(new Paragraph({
      spacing: { before: i === 0 ? 0 : 200, after: 60 },
      children: [
        makeRun(`${rolLabel(variable.rol, i, variables.length)}: `, { bold: true }),
        makeRun(variable.nombre, { bold: true }),
      ],
    }));
    out.push(new Paragraph({
      spacing: { after: 60 },
      children: [makeRun(`Dimensiones según ${variable.autor}:`, { italics: true })],
    }));
    for (const dim of variable.dimensiones) out.push(cellBullet(dim));
    if (variable.fuente) out.push(cellSourceLink(variable.fuente));
  });
  return out;
};

const METODOLOGIA_LABELS = [
  ["tipo", "Tipo de investigación"],
  ["enfoque", "Enfoque"],
  ["nivel", "Nivel o alcance"],
  ["diseno", "Diseño"],
  ["poblacion", "Población"],
  ["muestra", "Muestra"],
  ["muestreo", "Muestreo"],
  ["tecnica", "Técnica"],
  ["instrumento", "Instrumento"],
];

const buildMetodologiaParagraphs = (metodologia) => METODOLOGIA_LABELS.map(([key, label], i) => new Paragraph({
  spacing: { before: i === 0 ? 0 : 80, after: 40 },
  children: [
    makeRun(`${label}: `, { bold: true }),
    makeRun(String(metodologia[key] ?? "")),
  ],
}));

// ── Documento ───────────────────────────────────────────────────────────────
const buildMatrizTable = (matriz) => {
  const conHipotesis = Boolean(matriz.hipotesis);
  const widths = conHipotesis ? WIDTHS_5 : WIDTHS_4;

  const headers = conHipotesis
    ? ["Problemas", "Objetivos", "Hipótesis", "Variables y dimensiones", "Metodología"]
    : ["Problemas", "Objetivos", "Variables y dimensiones", "Metodología"];

  const contents = [
    buildSeccionParagraphs(matriz.problema, "Problema general:", "Problemas específicos:"),
    buildSeccionParagraphs(matriz.objetivos, "Objetivo general:", "Objetivos específicos:"),
    ...(conHipotesis ? [buildHipotesisParagraphs(matriz.hipotesis)] : []),
    buildVariablesParagraphs(matriz.variables),
    buildMetodologiaParagraphs(matriz.metodologia),
  ];

  return new Table({
    width: { size: TABLE_WIDTH_DXA, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => headerCell(h, widths[i])),
      }),
      new TableRow({
        children: contents.map((paragraphs, i) => contentCell(paragraphs, widths[i])),
      }),
    ],
  });
};

const buildTitleParagraphs = (matriz) => [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [makeRun("Matriz de Consistencia", {
      bold: true, size: SIZE_TITULO_DOC, color: AZUL_OSCURO,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [makeRun(matriz.titulo, { size: SIZE_SUBTITULO, color: GRIS_TEXTO, italics: true })],
  }),
];

// Construye el .docx apaisado y devuelve un Buffer. `matriz` es el objeto ya
// validado por parseMatriz. Robustez total: si algo falla en el armado de la
// tabla, se entrega un documento minimo con el JSON crudo antes que tumbar
// el job completo.
export const buildMatrizDocx = async ({ matriz }) => {
  let children;
  try {
    children = [...buildTitleParagraphs(matriz), buildMatrizTable(matriz)];
  } catch (err) {
    structuredLog("warn", "document.fallback_used", {
      tool: "matriz", format: "docx", ...errorLogFields(err),
    });
    children = [new Paragraph({ children: [makeRun(JSON.stringify(matriz, null, 2))] })];
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_CELDA },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          // A4 APAISADO: se pasan las medidas de RETRATO (210x297) porque la
          // libreria docx intercambia width/height por su cuenta cuando la
          // orientacion es landscape (verificado en dist/index.mjs).
          size: {
            orientation: PageOrientation.LANDSCAPE,
            width: convertMillimetersToTwip(210),
            height: convertMillimetersToTwip(297),
          },
          margin: {
            top: convertMillimetersToTwip(15),
            bottom: convertMillimetersToTwip(15),
            left: convertMillimetersToTwip(15),
            right: convertMillimetersToTwip(15),
          },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
};
