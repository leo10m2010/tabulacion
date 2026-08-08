// Word minimalista del Humanizador: A4 retrato, Calibri 11pt, interlineado
// 1.5, parrafos justificados. Sin portada ni titulos — el usuario pega este
// contenido dentro de su tesis. 100% por codigo (filosofia del repo).
import {
  AlignmentType,
  convertMillimetersToTwip,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { errorLogFields, structuredLog } from "../observability.js";

const FONT = "Calibri";
const SIZE_BASE = 22; // 11pt
const LINE_1_5 = 360; // interlineado 1.5 (240 = simple)

const textParagraph = (text) => new Paragraph({
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 200, line: LINE_1_5, lineRule: "auto" },
  children: [new TextRun({ text, font: FONT, size: SIZE_BASE })],
});

// Construye el .docx y devuelve un Buffer. Robustez: si algo falla, se
// entrega un documento minimo con el texto crudo antes que tumbar el job.
export const buildHumanizadorDocx = async ({ texto }) => {
  let children;
  try {
    const parrafos = String(texto ?? "").split(/\n{2,}/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
    children = parrafos.length > 0
      ? parrafos.map(textParagraph)
      : [textParagraph(String(texto ?? ""))];
  } catch (err) {
    structuredLog("warn", "document.fallback_used", {
      tool: "humanizador", format: "docx", ...errorLogFields(err),
    });
    children = [textParagraph(String(texto ?? ""))];
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
