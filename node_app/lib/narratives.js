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

export const narrativeConteo = (cfg, tablaN, dimName, nItems, counts) => {
  if (!counts) {
    return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan las respuestas agregadas de los ${nItems} ítems de la dimensión ${dimName}. `
      + `Ingrese las respuestas en la hoja base para completar esta interpretación.`;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const shares = sortShares(counts, cfg.escala.map((o) => o.etiqueta), total);
  return `En la Tabla ${tablaN} y la Figura ${tablaN} se observan las ${total} respuestas agregadas de los ${nItems} ítems de la dimensión ${dimName}: `
    + `${joinShares(shares, "corresponde a")}. La opción predominante de la dimensión es "${shares[0].label}".`;
};

export const narrativeNormalidadAuto = (tablaN, v1Name, v2Name, useSW, method) => {
  const prueba = useSW
    ? "Shapiro-Wilk (muestra ≤ 50)"
    : "Kolmogorov-Smirnov con corrección de Lilliefors (muestra > 50)";
  if (method === "pearson") {
    return `En la Tabla ${tablaN}, y basándose en la prueba de ${prueba}, se puede observar que los valores de significancia (Sig.) de la variable ${v1Name}, `
      + `de la variable ${v2Name} y de las dimensiones de ${v1Name} son todos mayores o iguales a 0.05; es decir, los datos se encuentran normalmente `
      + `distribuidos. Por tal motivo se procederá a utilizar la prueba paramétrica de correlación de Pearson.`;
  }
  return `En la Tabla ${tablaN}, y basándose en la prueba de ${prueba}, se puede observar que al menos uno de los valores de significancia (Sig.) de la variable ${v1Name}, `
    + `de la variable ${v2Name} y de las dimensiones de ${v1Name} es menor que 0.05; es decir, los datos no se encuentran normalmente distribuidos. `
    + `Por tal motivo se procederá a utilizar la prueba no paramétrica Rho de Spearman.`;
};

export const narrativeNormalidadManual = (tablaN, v1Name, v2Name) => (
  `En la Tabla ${tablaN} se presentan las pruebas de normalidad de la variable ${v1Name}, de la variable ${v2Name} y de las dimensiones de ${v1Name} `
  + `(la normalidad no se aplica a las dimensiones de la variable 2). Complete los valores con los resultados de SPSS y revise las significancias: `
  + `si todos los Sig. son mayores o iguales a 0.05, utilice la correlación de Pearson; si uno o más son menores que 0.05, utilice Rho de Spearman. `
  + `Las tablas de correlación de este archivo se generaron con Pearson por defecto.`
);
