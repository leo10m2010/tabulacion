// Post-procesado OOXML del paquete xlsx: deduplicacion de estilos e inyeccion
// de graficos (charts + drawings), porque xlsx-populate no los soporta de
// forma nativa.
import JSZip from "jszip";
import { CHART_THEMES } from "./config.js";

const escXml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// ── Optimizacion de estilos ──────────────────────────────────────────────────
// xlsx-populate crea una entrada de estilo por celda; con miles de celdas el
// styles.xml crece sin control. Se deduplican fonts/fills/borders/cellXfs y se
// remapean los indices s="n" de cada hoja.
const dedupeSection = (xml, sectionTag, itemTag) => {
  const re = new RegExp(`<${sectionTag}\\b[^>]*>([\\s\\S]*?)</${sectionTag}>`);
  const m = xml.match(re);
  if (!m) return { xml, map: null };
  const itemRe = new RegExp(`<${itemTag}\\b[^>]*/>|<${itemTag}\\b[^>]*>[\\s\\S]*?</${itemTag}>`, "g");
  const items = m[1].match(itemRe) ?? [];
  const seen = new Map();
  const map = items.map((item) => {
    if (!seen.has(item)) seen.set(item, seen.size);
    return seen.get(item);
  });
  const unique = [...seen.keys()].join("");
  return {
    xml: xml.replace(re, `<${sectionTag} count="${seen.size}">${unique}</${sectionTag}>`),
    map,
  };
};

const remapXfAttr = (xml, attr, map) => {
  if (!map) return xml;
  return xml.replace(/<xf\b[^>]*\/?>/g, (tag) => tag.replace(
    new RegExp(`${attr}="(\\d+)"`),
    (full, idx) => `${attr}="${map[Number(idx)] ?? idx}"`,
  ));
};

const optimizeStyles = async (zip) => {
  const stylesFile = zip.file("xl/styles.xml");
  if (!stylesFile) return;
  let styles = await stylesFile.async("string");

  // Fills vacios (<fill/>) no son validos para varios lectores.
  styles = styles.replaceAll("<fill/>", '<fill><patternFill patternType="none"/></fill>');

  let fontMap;
  let fillMap;
  let borderMap;
  ({ xml: styles, map: fontMap } = dedupeSection(styles, "fonts", "font"));
  ({ xml: styles, map: fillMap } = dedupeSection(styles, "fills", "fill"));
  ({ xml: styles, map: borderMap } = dedupeSection(styles, "borders", "border"));
  styles = remapXfAttr(styles, "fontId", fontMap);
  styles = remapXfAttr(styles, "fillId", fillMap);
  styles = remapXfAttr(styles, "borderId", borderMap);

  let xfMap;
  ({ xml: styles, map: xfMap } = dedupeSection(styles, "cellXfs", "xf"));
  zip.file("xl/styles.xml", styles);

  if (!xfMap) return;
  const sheetPaths = Object.keys(zip.files).filter(
    (p) => p.startsWith("xl/worksheets/") && p.endsWith(".xml"),
  );
  for (const p of sheetPaths) {
    const xml = await zip.file(p).async("string");
    zip.file(p, xml.replace(/\bs="(\d+)"/g, (full, idx) => `s="${xfMap[Number(idx)] ?? idx}"`));
  }
};

// ── Graficos OOXML ───────────────────────────────────────────────────────────
let axisIdCounter = 100000000;

// ids de ejes deterministas por archivo (se llama al iniciar cada workbook).
export const resetAxisIds = () => {
  axisIdCounter = 100000000;
};

const buildChartXml = (chart, colores = CHART_THEMES.clasico.colores) => {
  const ax1 = (axisIdCounter += 2);
  const ax2 = axisIdCounter + 1;
  const dLbls = '<c:dLbls>'
    + `<c:numFmt formatCode="${escXml(chart.numFmt ?? "General")}" sourceLinked="0"/>`
    + '<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>'
    + '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>'
    + '</c:dLbls>';
  // Con paletas multicolor cada punto lleva su color explicito (c:dPt); con
  // la paleta de un solo color se conserva el XML historico.
  const dPts = colores.length > 1 && chart.points
    ? Array.from({ length: chart.points }, (_, i) => '<c:dPt>'
      + `<c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/>`
      + `<c:spPr><a:solidFill><a:srgbClr val="${colores[i % colores.length]}"/></a:solidFill></c:spPr>`
      + '</c:dPt>').join("")
    : "";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<c:roundedCorners val="0"/>'
    + '<c:chart>'
    + '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r>'
    + '<a:rPr lang="es-ES" b="1" sz="1000"><a:latin typeface="Arial"/></a:rPr>'
    + `<a:t>${escXml(chart.title)}</a:t>`
    + '</a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>'
    + '<c:autoTitleDeleted val="0"/>'
    + '<c:plotArea><c:layout/>'
    + '<c:barChart>'
    + '<c:barDir val="col"/><c:grouping val="clustered"/>'
    + `<c:varyColors val="${chart.varyColors ? 1 : 0}"/>`
    + '<c:ser>'
    + '<c:idx val="0"/><c:order val="0"/>'
    + `<c:tx><c:v>${escXml(chart.seriesName ?? "Serie 1")}</c:v></c:tx>`
    + `<c:spPr><a:solidFill><a:srgbClr val="${colores[0]}"/></a:solidFill></c:spPr>`
    + '<c:invertIfNegative val="0"/>'
    + dPts
    + dLbls
    + `<c:cat><c:strRef><c:f>${escXml(chart.catRef)}</c:f></c:strRef></c:cat>`
    + `<c:val><c:numRef><c:f>${escXml(chart.valRef)}</c:f></c:numRef></c:val>`
    + '</c:ser>'
    + '<c:gapWidth val="60"/>'
    + `<c:axId val="${ax1}"/><c:axId val="${ax2}"/>`
    + '</c:barChart>'
    + `<c:catAx><c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling>`
    + '<c:delete val="0"/><c:axPos val="b"/>'
    + '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="es-ES"/></a:p></c:txPr>'
    + `<c:crossAx val="${ax2}"/><c:crosses val="autoZero"/><c:auto val="1"/>`
    + '<c:lblAlgn val="ctr"/><c:lblOffset val="100"/>'
    + '</c:catAx>'
    + `<c:valAx><c:axId val="${ax2}"/><c:scaling><c:orientation val="minMax"/></c:scaling>`
    + '<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>'
    + '<c:numFmt formatCode="General" sourceLinked="1"/>'
    + '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="es-ES"/></a:p></c:txPr>'
    + `<c:crossAx val="${ax1}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>`
    + '</c:valAx>'
    + '</c:plotArea>'
    + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>'
    + '</c:chart>'
    + '</c:chartSpace>';
};

const buildDrawingXml = (charts) => {
  const anchors = charts.map((chart, i) => {
    const a = chart.anchor;
    return '<xdr:twoCellAnchor>'
      + `<xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>`
      + `<xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff>`
      + `<xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
      + '<xdr:graphicFrame macro="">'
      + `<xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/>`
      + '<xdr:cNvGraphicFramePr><a:graphicFrameLocks/></xdr:cNvGraphicFramePr></xdr:nvGraphicFramePr>'
      + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
      + '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
      + ` r:id="rId${i + 1}"/>`
      + '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + anchors
    + '</xdr:wsDr>';
};

const getAttr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};

const unescapeXml = (value) => String(value)
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");

// Inyecta los graficos en el zip del xlsx: charts/*.xml, drawings/*.xml,
// rels y content types. sheetCharts: [{ sheetName, charts: [...] }].
const injectCharts = async (zip, sheetCharts, colores) => {
  const plans = sheetCharts.filter((p) => p.charts.length > 0);
  if (plans.length === 0) return;

  const readText = (p) => zip.file(p).async("string");

  const wbXml = await readText("xl/workbook.xml");
  const wbRels = await readText("xl/_rels/workbook.xml.rels");

  const nameToRid = new Map();
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = getAttr(m[0], "name");
    const rid = getAttr(m[0], "r:id");
    if (name && rid) nameToRid.set(unescapeXml(name), rid);
  }
  const ridToTarget = new Map();
  for (const m of wbRels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = getAttr(m[0], "Id");
    const target = getAttr(m[0], "Target");
    if (id && target) ridToTarget.set(id, target);
  }

  let chartIndex = 0;
  let drawingIndex = 0;
  const contentTypeOverrides = [];

  for (const plan of plans) {
    const rid = nameToRid.get(plan.sheetName);
    if (!rid) throw new Error(`No se encontro la hoja "${plan.sheetName}" en workbook.xml.`);
    const target = ridToTarget.get(rid).replace(/^\//, "").replace(/^xl\//, "");
    const sheetPath = `xl/${target}`;
    const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf("/"));
    const sheetFile = sheetPath.slice(sheetPath.lastIndexOf("/") + 1);
    const sheetRelsPath = `${sheetDir}/_rels/${sheetFile}.rels`;

    drawingIndex += 1;
    const drawingName = `drawing${drawingIndex}.xml`;

    // Charts de esta hoja.
    const chartRels = [];
    for (const chart of plan.charts) {
      chartIndex += 1;
      const chartName = `chart${chartIndex}.xml`;
      zip.file(`xl/charts/${chartName}`, buildChartXml(chart, colores));
      contentTypeOverrides.push(
        `<Override PartName="/xl/charts/${chartName}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      );
      chartRels.push(
        `<Relationship Id="rId${chartRels.length + 1}"`
        + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"'
        + ` Target="../charts/${chartName}"/>`,
      );
    }

    // Drawing + rels del drawing.
    zip.file(`xl/drawings/${drawingName}`, buildDrawingXml(plan.charts));
    zip.file(
      `xl/drawings/_rels/${drawingName}.rels`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + chartRels.join("")
      + "</Relationships>",
    );
    contentTypeOverrides.push(
      `<Override PartName="/xl/drawings/${drawingName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    );

    // Rels de la hoja: agregar la relacion al drawing.
    const relsFile = zip.file(sheetRelsPath);
    let nextRelNum = 1;
    let relsXml;
    if (relsFile) {
      relsXml = await relsFile.async("string");
      for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
        nextRelNum = Math.max(nextRelNum, parseInt(m[1], 10) + 1);
      }
    } else {
      relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    }
    const drawingRelId = `rId${nextRelNum}`;
    relsXml = relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${drawingRelId}"`
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"'
      + ` Target="../drawings/${drawingName}"/></Relationships>`,
    );
    zip.file(sheetRelsPath, relsXml);

    // Referencia al drawing dentro de la hoja.
    let sheetXml = await readText(sheetPath);
    if (!/<worksheet[^>]*xmlns:r=/.test(sheetXml)) {
      sheetXml = sheetXml.replace(
        /<worksheet /,
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
      );
    }
    sheetXml = sheetXml.replace("</worksheet>", `<drawing r:id="${drawingRelId}"/></worksheet>`);
    zip.file(sheetPath, sheetXml);
  }

  const contentTypes = await readText("[Content_Types].xml");
  zip.file("[Content_Types].xml", contentTypes.replace("</Types>", contentTypeOverrides.join("") + "</Types>"));
};

// Post-procesado del paquete xlsx: deduplicar estilos e inyectar graficos.
export const postProcessWorkbook = async (xlsxBuffer, sheetCharts, colores = CHART_THEMES.clasico.colores) => {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  await optimizeStyles(zip);
  await injectCharts(zip, sheetCharts, colores);
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
};
