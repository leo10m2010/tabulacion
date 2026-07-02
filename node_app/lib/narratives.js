// Narrativas (interpretaciones automaticas) que acompanan cada tabla/figura.
// Con base simulada se redactan con los porcentajes reales; sin datos se
// emite un texto guia para que el tesista complete.

const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

const sortShares = (counts, labels, total) => labels
  .map((label, i) => ({ label, count: counts[i], share: total > 0 ? counts[i] / total : 0 }))
  .sort((a, b) => b.share - a.share);

const joinShares = (shares, verb, max = 3) => {
  const top = shares.slice(0, max).filter((s) => s.count > 0);
  const parts = top.map((s, i) => `el ${fmtPct(s.share)}${i === 0 ? ` ${verb}` : ""} "${s.label}"`);
  if (parts.length > 1) {
    const last = parts.pop();
    return `${parts.join(", ")} y ${last}`;
  }
  return parts[0] ?? "";
};

export const narrativeItem = (cfg, tablaN, code, texto, counts) => {
  const ref = texto ? `${code} (${texto})` : code;
  if (!counts) {
    return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan los resultados del ítem ${ref}. `
      + `Ingrese las respuestas en la hoja base: la tabla, el gráfico y los porcentajes se actualizarán automáticamente y podrá completar esta interpretación.`;
  }
  const shares = sortShares(counts, cfg.escala.map((o) => o.etiqueta), cfg.encuestados);
  return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan los resultados del ítem ${ref}, `
    + `aplicado a los ${cfg.encuestados} ${cfg.etiquetaMuestra.toLowerCase()}: ${joinShares(shares, "respondió")}. `
    + `Por todo ello, la tendencia predominante del ítem es "${shares[0].label}".`;
};

export const narrativeDimension = (cfg, tablaN, variableName, dimName, nivelCounts, niveles) => {
  if (!nivelCounts) {
    return `En la Tabla ${tablaN} y la Figura ${tablaN} se observa la calificación de la variable ${variableName} en base a su dimensión ${dimName}. `
      + `Ingrese las respuestas en la hoja base para que la valoración, la tabla y el gráfico se calculen automáticamente.`;
  }
  const shares = sortShares(nivelCounts, niveles.map((n) => n.nombre), cfg.encuestados);
  const seguido = shares.slice(1).filter((s) => s.count > 0)
    .map((s) => `"${s.label}" con el ${fmtPct(s.share)}`)
    .join(" y ");
  return `En la Tabla ${tablaN} y la Figura ${tablaN} se puede observar que la variable ${variableName}, en base a su dimensión ${dimName}, `
    + `tiene una calificación de "${shares[0].label}" por el ${fmtPct(shares[0].share)} de los resultados`
    + `${seguido ? `, seguida de ${seguido}` : ""}. `
    + `Estos resultados fueron extraídos de las encuestas ejecutadas a los ${cfg.encuestados} ${cfg.etiquetaMuestra.toLowerCase()}; `
    + `por todo ello, la dimensión ${dimName} es "${shares[0].label}".`;
};

// `forced` indica que el metodo lo eligio el investigador ("pearson" |
// "spearman" | null para decision automatica por normalidad); `hayNoNormal`
// es el resultado real de la tabla (algun Sig. < 0.05). La narrativa nunca
// contradice la tabla: si el metodo elegido no coincide con la normalidad,
// se justifica la eleccion.
export const narrativeNormalidadAuto = (tablaN, v1Name, v2Name, useSW, method, forced = null, hayNoNormal = null) => {
  const prueba = useSW
    ? "Shapiro-Wilk (muestra ≤ 50)"
    : "Kolmogorov-Smirnov con corrección de Lilliefors (muestra > 50)";
  const noNormal = hayNoNormal ?? method === "spearman";
  const intro = noNormal
    ? `En la Tabla ${tablaN}, y basándose en la prueba de ${prueba}, se puede observar que al menos uno de los valores de significancia (Sig.) de la variable ${v1Name}, `
      + `de la variable ${v2Name} y de las dimensiones de ${v1Name} es menor que 0.05; es decir, los datos no se encuentran normalmente distribuidos. `
    : `En la Tabla ${tablaN}, y basándose en la prueba de ${prueba}, se puede observar que los valores de significancia (Sig.) de la variable ${v1Name}, `
      + `de la variable ${v2Name} y de las dimensiones de ${v1Name} son todos mayores o iguales a 0.05; es decir, los datos se encuentran normalmente distribuidos. `;
  if (method === "pearson") {
    return intro + (noNormal
      ? `No obstante, considerando el tamaño de la muestra y la robustez del estimador, se utilizó la correlación de Pearson conforme al diseño metodológico del estudio.`
      : `Por tal motivo se procederá a utilizar la prueba paramétrica de correlación de Pearson.`);
  }
  return intro + (noNormal
    ? `Por tal motivo se procederá a utilizar la prueba no paramétrica Rho de Spearman.`
    : `${forced ? "Aun así, por tratarse de datos ordinales de tipo Likert, se utilizó la prueba no paramétrica Rho de Spearman conforme al diseño metodológico del estudio." : "Por tal motivo se procederá a utilizar la prueba no paramétrica Rho de Spearman."}`);
};

export const narrativeNormalidadManual = (tablaN, v1Name, v2Name, method = "pearson") => (
  `En la Tabla ${tablaN} se presentan las pruebas de normalidad de la variable ${v1Name}, de la variable ${v2Name} y de las dimensiones de ${v1Name} `
  + `(la normalidad no se aplica a las dimensiones de la variable 2). Complete los valores con los resultados de SPSS y revise las significancias: `
  + `si todos los Sig. son mayores o iguales a 0.05, utilice la correlación de Pearson; si uno o más son menores que 0.05, utilice Rho de Spearman. `
  + `Las tablas de correlación de este archivo se generaron con ${method === "spearman" ? "Rho de Spearman" : "Pearson"}.`
);
