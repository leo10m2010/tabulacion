// Construye el .docx de las 3 propuestas de titulo 100% por codigo (misma
// filosofia del repo que el Excel: nada de plantillas binarias). Parsea el
// markdown conocido y estable que devuelve el prompt maestro (ver secciones
// 3 y 4 de prompts/prompt_maestro_generador_titulos.md) y arma un documento
// Word con diseño profesional. Debe ser robusto: cualquier linea que no
// matchee un patron conocido cae a parrafo normal, nunca lanza por contenido
// inesperado.
import {
  AlignmentType,
  BorderStyle,
  convertMillimetersToTwip,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const AZUL_OSCURO = "1F3864";
const GRIS_TEXTO = "595959";
const GRIS_BORDE = "BFBFBF";
const AZUL_LINK = "0563C1";
const SHADING_CLAVE = "EDF2F9";

const FONT = "Calibri";
const SIZE_BASE = 22; // 11pt
const SIZE_TITULO_QUOTE = 26; // 13pt
const SIZE_HEADING1 = 32; // 16pt
const SIZE_HEADING2 = 24; // 12pt
const SIZE_PORTADA_TITULO = 40; // 20pt
const SIZE_PORTADA_SUB = 22; // 11pt

const LINE_1_15 = 276; // interlineado 1.15 (240 = simple)

// ── Parser de texto en linea (negritas, cursivas, hipervinculos) ───────────
// Tokeniza **negrita**, *cursiva* y URLs http(s). No soporta anidamiento
// complejo (negrita+cursiva a la vez), solo el uso simple del markdown real.
const INLINE_RE = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(https?:\/\/[^\s)\]}>,;]+)/g;

const stripTrailingPunct = (url) => {
  const match = url.match(/[.,;:)\]}]+$/);
  if (!match) return { url, trailing: "" };
  return { url: url.slice(0, -match[0].length), trailing: match[0] };
};

const makeRun = (text, extra = {}) => new TextRun({
  text, font: FONT, size: extra.size ?? SIZE_BASE, ...extra,
});

const makeHyperlinkRun = (rawUrl, extra = {}) => {
  const { url, trailing } = stripTrailingPunct(rawUrl);
  const runs = [
    new ExternalHyperlink({
      link: url,
      children: [new TextRun({
        text: url, font: FONT, size: extra.size ?? SIZE_BASE, color: AZUL_LINK, underline: {},
      })],
    }),
  ];
  if (trailing) runs.push(makeRun(trailing, extra));
  return runs;
};

// Convierte una linea de texto en un arreglo de TextRun/ExternalHyperlink,
// respetando **negrita**, *cursiva* y URLs. Si algo sale mal, degrada a un
// solo run de texto plano (nunca debe lanzar).
const parseInlineRuns = (text, extra = {}) => {
  try {
    const raw = String(text ?? "");
    const runs = [];
    let last = 0;
    let match;
    INLINE_RE.lastIndex = 0;
    while ((match = INLINE_RE.exec(raw)) !== null) {
      if (match.index > last) runs.push(makeRun(raw.slice(last, match.index), extra));
      if (match[1]) {
        runs.push(makeRun(match[1].slice(2, -2), { ...extra, bold: true }));
      } else if (match[2]) {
        runs.push(makeRun(match[2].slice(1, -1), { ...extra, italics: true }));
      } else if (match[3]) {
        runs.push(...makeHyperlinkRun(match[3], extra));
      }
      last = match.index + match[0].length;
    }
    if (last < raw.length) runs.push(makeRun(raw.slice(last), extra));
    return runs.length > 0 ? runs : [makeRun(raw, extra)];
  } catch {
    return [makeRun(String(text ?? ""))];
  }
};

// ── Reconocedores de linea ──────────────────────────────────────────────────
const TITULO_HEADING_RE = /\*\*\s*T[IÍí]TULO\s*(\d+)/i;
// Encabezado de seccion real: SIEMPRE viene envuelto en ** (p.ej.
// "**1. PROBLEMA Y PROPÓSITO A ABORDAR**"). El ** es obligatorio para no
// confundirlo con una referencia numerada suelta ("1. Pérez, J. (2023)...").
const SECTION_HEADING_RE = /^\*\*\s*(\d+)\.\s*(.+?)\s*\*\*$/;
const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEPARATOR_RE = /^[\s|:-]+$/;
const BULLET_RE = /^-\s+(.*)$/;
const REFERENCE_RE = /^(\d+)\.\s+(.*)$/;
const SUBLABEL_RE = /^\*{0,2}\s*([^*:]{1,80}?):\s*\*{0,2}\s*$/;
const SEPARATOR_RE = /^-{3,}$/;

// ── Bloques reutilizables ───────────────────────────────────────────────────
const baseParagraphOptions = () => ({
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 160, line: LINE_1_15, lineRule: "auto" },
});

const normalParagraph = (line) => new Paragraph({
  ...baseParagraphOptions(),
  children: parseInlineRuns(line),
});

const sublabelParagraph = (label) => new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { after: 120, before: 120, line: LINE_1_15, lineRule: "auto" },
  children: [makeRun(`${label}:`, { bold: true })],
});

const bulletParagraph = (text) => new Paragraph({
  bullet: { level: 0 },
  alignment: AlignmentType.LEFT,
  spacing: { after: 100, line: LINE_1_15, lineRule: "auto" },
  children: parseInlineRuns(text),
});

// Sangria francesa (APA): primera linea al margen, resto sangrado ~0.5cm.
const REFERENCE_INDENT = convertMillimetersToTwip(5); // ~0.5cm
const referenceParagraph = (text) => new Paragraph({
  alignment: AlignmentType.JUSTIFIED,
  indent: { left: REFERENCE_INDENT, hanging: REFERENCE_INDENT },
  spacing: { after: 140, line: LINE_1_15, lineRule: "auto" },
  children: parseInlineRuns(text),
});

const heading1Paragraph = (text, { pageBreakBefore = false } = {}) => new Paragraph({
  pageBreakBefore,
  spacing: { before: 0, after: 200 },
  heading: HeadingLevel.HEADING_1,
  children: [makeRun(text, { bold: true, size: SIZE_HEADING1, color: AZUL_OSCURO })],
});

const titleQuoteParagraph = (text) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 100, after: 300, line: LINE_1_15, lineRule: "auto" },
  children: parseInlineRuns(text, { bold: true, size: SIZE_TITULO_QUOTE }),
});

const heading2Paragraph = (numero, texto) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 260, after: 140 },
  children: [makeRun(`${numero}. ${texto}`, { bold: true, size: SIZE_HEADING2, color: AZUL_OSCURO })],
});

// Anchos ABSOLUTOS en twips (layout fijo). Los anchos en porcentaje sin
// layout fijo se colapsan en Word Online y otros visores (las columnas
// quedaban de un caracter de ancho, con el texto en vertical). Ancho util
// A4: 210mm - 2x25mm de margen = 160mm ~= 9072 twips; 30%/70%.
const TABLE_WIDTH_DXA = 9072;
const COL_CLAVE_DXA = 2722;
const COL_VALOR_DXA = 6350;

// Celda de tabla con bordes finos grises; `isKey` aplica negrita + sombreado.
const tableCell = (text, { isKey = false, widthDxa } = {}) => new TableCell({
  width: { size: widthDxa, type: WidthType.DXA },
  shading: isKey ? { type: ShadingType.CLEAR, fill: SHADING_CLAVE } : undefined,
  margins: { top: 100, bottom: 100, left: 150, right: 150 },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE },
    left: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE },
    right: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE },
  },
  children: [new Paragraph({
    spacing: { line: LINE_1_15, lineRule: "auto" },
    children: parseInlineRuns(text, isKey ? { bold: true } : {}),
  })],
});

const buildMethodTable = (rows) => new Table({
  width: { size: TABLE_WIDTH_DXA, type: WidthType.DXA },
  layout: TableLayoutType.FIXED,
  columnWidths: [COL_CLAVE_DXA, COL_VALOR_DXA],
  rows: rows.map(([clave, valor]) => new TableRow({
    children: [
      tableCell(clave, { isKey: true, widthDxa: COL_CLAVE_DXA }),
      tableCell(valor, { widthDxa: COL_VALOR_DXA }),
    ],
  })),
});

// Parsea una linea de tabla markdown "| Clave | Valor |" -> [clave, valor].
// Tolera columnas de mas (las junta en "valor") o de menos (rellena vacio).
const parseTableRow = (line) => {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = inner.split("|").map((c) => c.trim());
  if (cells.length <= 1) return [cells[0] ?? "", ""];
  return [cells[0], cells.slice(1).join(" | ")];
};

// ── Portada ──────────────────────────────────────────────────────────────
const buildCoverParagraphs = (input) => {
  const universidad = String(input?.universidad ?? "").trim();
  const carrera = String(input?.carrera ?? "").trim();
  const lugar = String(input?.lugar ?? "").trim();
  const anio = String(input?.anio ?? "").trim() || String(new Date().getFullYear());

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      heading: HeadingLevel.TITLE,
      children: [makeRun("Propuestas de Título de Investigación", {
        bold: true, size: SIZE_PORTADA_TITULO, color: AZUL_OSCURO,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [makeRun(`Carrera de ${carrera} — ${universidad}`, {
        size: SIZE_PORTADA_SUB, color: GRIS_TEXTO,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [makeRun(`${lugar} · ${anio}`, { size: SIZE_PORTADA_SUB, color: GRIS_TEXTO })],
    }),
    new Paragraph({
      spacing: { after: 400 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: GRIS_BORDE, space: 1 },
      },
      children: [],
    }),
  ];
};

// ── Parseo del cuerpo (por bloques de TÍTULO N) ────────────────────────────
const splitByTitulo = (contenido) => {
  const lines = String(contenido ?? "").split("\n");
  const blocks = [];
  let current = null;
  for (const rawLine of lines) {
    const match = rawLine.match(TITULO_HEADING_RE);
    if (match) {
      current = { numero: match[1], lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(rawLine);
  }
  return blocks;
};

const buildTituloParagraphs = (block, { pageBreakBefore }) => {
  const paragraphs = [heading1Paragraph(`TÍTULO ${block.numero}`, { pageBreakBefore })];
  let tituloQuoteConsumed = false;
  let enReferencias = false;
  let tableBuffer = [];

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      paragraphs.push(buildMethodTable(tableBuffer));
      tableBuffer = [];
    }
  };

  for (const rawLine of block.lines) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (SEPARATOR_RE.test(line)) { flushTable(); continue; }

    try {
      // Titulo entre comillas: la primera linea de contenido del bloque
      // (salvo que ya sea un encabezado de seccion, formato inesperado).
      if (!tituloQuoteConsumed) {
        tituloQuoteConsumed = true;
        if (!SECTION_HEADING_RE.test(line)) {
          flushTable();
          paragraphs.push(titleQuoteParagraph(line));
          continue;
        }
      }

      const sectionMatch = line.match(SECTION_HEADING_RE);
      if (sectionMatch) {
        flushTable();
        enReferencias = /REFERENCIAS/i.test(sectionMatch[2]);
        paragraphs.push(heading2Paragraph(sectionMatch[1], sectionMatch[2]));
        continue;
      }

      if (TABLE_ROW_RE.test(line) && !TABLE_SEPARATOR_RE.test(line.replace(/\|/g, ""))) {
        tableBuffer.push(parseTableRow(line));
        continue;
      }
      flushTable();

      if (enReferencias) {
        const refMatch = line.match(REFERENCE_RE);
        if (refMatch) {
          paragraphs.push(referenceParagraph(line));
          continue;
        }
      }

      const bulletMatch = line.match(BULLET_RE);
      if (bulletMatch) {
        paragraphs.push(bulletParagraph(bulletMatch[1]));
        continue;
      }

      const sublabelMatch = line.match(SUBLABEL_RE);
      if (sublabelMatch) {
        paragraphs.push(sublabelParagraph(sublabelMatch[1].trim()));
        continue;
      }

      paragraphs.push(normalParagraph(line));
    } catch {
      // Robustez: cualquier linea rara cae a parrafo plano.
      paragraphs.push(new Paragraph({ children: [makeRun(line)] }));
    }
  }
  flushTable();
  return paragraphs;
};

// Construye el .docx completo y devuelve un Buffer. `input` es el objeto ya
// normalizado por normalizeTitulosInput (universidad, carrera, lugar, anio).
// Nunca lanza por contenido inesperado del markdown (cada linea cae a
// parrafo normal en el peor caso); si algo falla igual devuelve un documento
// minimo con el contenido crudo, para no tumbar el job completo.
export const buildTitulosDocx = async ({ contenido, input }) => {
  let children;
  try {
    const cover = buildCoverParagraphs(input);
    const blocks = splitByTitulo(contenido);
    const body = blocks.flatMap((block, i) => buildTituloParagraphs(block, { pageBreakBefore: i > 0 }));
    children = [...cover, ...body.length > 0 ? body : [normalParagraph(String(contenido ?? ""))]];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[titulos] fallo el parseo de markdown a docx, se entrega contenido crudo:", err);
    children = [new Paragraph({ children: [makeRun(String(contenido ?? ""))] })];
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_BASE },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
          margin: {
            top: convertMillimetersToTwip(25),
            bottom: convertMillimetersToTwip(25),
            left: convertMillimetersToTwip(25),
            right: convertMillimetersToTwip(25),
          },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
};
