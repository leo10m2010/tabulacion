// Conversion .docx -> markdown limpio con mammoth. Se ejecuta ANTES de
// llamar a la IA para mandar solo el contenido del instrumento (un .docx
// crudo trae XML de formato que no aporta nada y multiplica los tokens).
import mammoth from "mammoth";

const MAX_DOCX_BYTES = 3 * 1024 * 1024;

export const docxToMarkdown = async (docxBase64) => {
  let buffer;
  try {
    buffer = Buffer.from(String(docxBase64 ?? ""), "base64");
  } catch {
    throw new Error("El archivo .docx no se pudo decodificar.");
  }
  if (buffer.length === 0) {
    throw new Error("El archivo .docx llego vacio.");
  }
  if (buffer.length > MAX_DOCX_BYTES) {
    throw new Error("El archivo .docx supera el limite de 3 MB.");
  }

  let result;
  try {
    result = await mammoth.convertToMarkdown({ buffer });
  } catch (err) {
    throw new Error(`No se pudo leer el .docx (¿es un Word valido?): ${err.message}`);
  }

  const text = String(result.value ?? "").trim();
  if (!text) {
    throw new Error("El .docx no contiene texto legible.");
  }
  return text;
};
