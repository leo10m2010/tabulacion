// Pruebas de buildHumanizadorDocx (lib/humanizador/docx.js).
//
// Este generador tampoco tenia ninguna prueba propia (humanizador-metrics.test.js
// cubre metrics.js e index.js, pero no el .docx de salida). Cubre:
//   1. El buffer es un .docx valido (zip con word/document.xml).
//   2. El texto se separa en parrafos por linea en blanco doble, tal como
//      hace el propio modulo (texto.split(/\n{2,}/)).
//   3. Robustez: nunca lanza con texto vacio o solo espacios.
//   4. La pagina es A4 RETRATO (a diferencia de la matriz, que es apaisada):
//      protege contra que un cambio futuro la deje apaisada por error.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildHumanizadorDocx } from "../lib/humanizador/docx.js";

test("buildHumanizadorDocx: zip valido con los parrafos esperados", async () => {
  const texto = "Primer párrafo del texto humanizado, con contenido de prueba.\n\n"
    + "Segundo párrafo, distinto del primero, para verificar el separador.";
  const buffer = await buildHumanizadorDocx({ texto });
  assert.ok(Buffer.isBuffer(buffer));

  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file("word/document.xml"), "el .docx debe traer word/document.xml");
  const xml = await zip.file("word/document.xml").async("string");
  assert.ok(xml.includes("Primer párrafo del texto humanizado"));
  assert.ok(xml.includes("Segundo párrafo, distinto del primero"));

  // Dos parrafos de entrada -> al menos dos <w:p> con contenido de texto.
  const parrafosConTexto = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g)?.filter((p) => /<w:t[ >]/.test(p)) ?? [];
  assert.ok(parrafosConTexto.length >= 2, `esperaba al menos 2 parrafos con texto, hubo ${parrafosConTexto.length}`);
});

test("buildHumanizadorDocx nunca lanza con texto vacio, solo espacios o indefinido", async () => {
  await assert.doesNotReject(() => buildHumanizadorDocx({ texto: "" }));
  await assert.doesNotReject(() => buildHumanizadorDocx({ texto: "   " }));
  await assert.doesNotReject(() => buildHumanizadorDocx({ texto: undefined }));
  const buffer = await buildHumanizadorDocx({}); // sin la clave `texto` en absoluto
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file("word/document.xml"));
});

test("buildHumanizadorDocx: pagina A4 RETRATO (w < h), a diferencia de la matriz apaisada", async () => {
  const buffer = await buildHumanizadorDocx({ texto: "Texto de prueba para el humanizador." });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  const match = xml.match(/<w:pgSz\s+w:w="(\d+)"\s+w:h="(\d+)"\s+w:orient="portrait"\/>/);
  assert.ok(match, `debe existir <w:pgSz .../> con w:orient="portrait": ${xml.slice(0, 200)}`);
  const [, w, h] = match.map(Number);
  assert.ok(w < h, `el humanizador debe ser retrato (w=${w}, h=${h})`);
});
